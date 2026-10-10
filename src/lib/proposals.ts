// Motor de propuestas de la IA: busca mejoras con los resultados (reglas fijas primero), le pide a la IA que las
// redacte en palabras sencillas y que agregue 1-2 ideas creativas, y las guarda (AiProposal) para que el dueño las
// acepte o las rechace. Al aceptar, el cambio se aplica en una transacción, revisado otra vez contra el estado y los
// topes de ese momento, y queda en el registro (AiAction «proposal.applied»). «Deshacer» durante 24 horas.
//
// runProposals(now): una vez por semana por negocio (lo llama el cron). proposeNow(businessId): botón «Buscar mejoras ahora».
// En campañas 100% IA con «La IA puede aplicar sola las propuestas de bajo riesgo» encendido, los horarios y formatos
// se aplican solos (actor "auto").

import { Prisma, type AiProposal, type Campaign } from "@prisma/client";
import { z } from "zod";
import { getAdsSettings, pauseAd } from "@/lib/ads";
import { monthSpentCents, readCampaignAds } from "@/lib/ads-shape";
import { askGemini } from "@/lib/ai";
import { logAiAction, type AiActor } from "@/lib/ai-actions";
import { identityPrompt } from "@/lib/brand-identity";
import { addDays, localParts, readEngine, readRules, rulesJson, usableTimes } from "@/lib/campaign-shape";
import { CHANNEL_IDS } from "@/lib/channels";
import { db } from "@/lib/db";
import { readGa4Report } from "@/lib/ga4-shape";
import { errorText } from "@/lib/i18n";
import {
  adDailyProblems,
  appliedSummary,
  asKind,
  bareAction,
  campaignProblems,
  canAutoApply,
  canUndo,
  isDuplicate,
  isExpired,
  isReversible,
  MAX_TRACKED_KEYWORDS,
  patchFields,
  PROPOSALS_AI_CENTS,
  readAction,
  readDetail,
  readEvidence,
  readFields,
  readTitle,
  tzOf,
  validateAction,
  withFields,
  EXPIRE_DAYS,
  type AppliedRecord,
  type ApplyContext,
  type Bi,
  type CampaignState,
  type ExistingProposal,
  type ProposalAction,
} from "@/lib/proposals-shape";
import { detectProposals, statsFromPosts, statsFromSummary, type PostStat, type ProposalDraft, type RankMoveLite, type RulesInput } from "@/lib/proposals-rules";
import { resultsSummary } from "@/lib/results";
import { readTrackedKeywords } from "@/lib/seo/dataforseo";
import { asGscReport } from "@/lib/seo/gsc";
import { readRankReport } from "@/lib/seo/rank";
import { latestReports, saveReport } from "@/lib/seo/reports";
import { rememberChoices } from "@/lib/seo/setup";
import { businessDay, localToUtc } from "@/lib/time";

const DAY_MS = 86_400_000;
/** Cuántos días de resultados se miran. */
export const LOOKBACK_DAYS = 28;
/** Cada cuánto se buscan propuestas solas (por negocio). */
export const RUN_EVERY_DAYS = 7;
/** «Buscar mejoras ahora»: como mucho una vez cada 10 minutos. */
export const NOW_COOLDOWN_MS = 10 * 60_000;
const json = (v: unknown) => v as Prisma.InputJsonValue;
const B = (es: string, en: string): Bi => ({ es, en });

// ---------- Leer el estado ----------

/** Una campaña guardada → lo que necesitan las reglas y la revisión. */
export function campaignState(c: Pick<Campaign, "id" | "name" | "status" | "mode" | "channels" | "perWeek" | "keywords" | "rules" | "budgetCents" | "spentCents" | "ads">): CampaignState {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    mode: c.mode,
    channels: c.channels,
    perWeek: c.perWeek,
    keywords: c.keywords,
    rules: readRules(c.rules),
    budgetCents: c.budgetCents,
    spentCents: c.spentCents,
    ads: readCampaignAds(c.ads),
  };
}

/**
 * Respaldo: resultados de cada publicación del período leídos directo de PostMetric (solo si el resumen de
 * resultados, src/lib/results.ts, no se pudo leer).
 */
export async function loadPostStats(businessId: string, from: Date, to: Date): Promise<PostStat[]> {
  const targets = await db.postTarget.findMany({
    where: { status: "sent", sentAt: { gte: from, lte: to }, post: { businessId } },
    select: {
      channel: true,
      sentAt: true,
      post: { select: { id: true, kind: true, campaignId: true } },
      metrics: { orderBy: { fetchedAt: "desc" }, take: 1, select: { reach: true, impressions: true, likes: true, comments: true, shares: true, saves: true, clicks: true } },
    },
    take: 2000,
  });
  return targets
    .filter((t) => t.sentAt && t.metrics.length)
    .map((t) => {
      const m = t.metrics[0];
      const kind = (["post", "carousel", "story", "video"] as const).find((k) => k === t.post.kind) ?? "post";
      return {
        postId: t.post.id,
        campaignId: t.post.campaignId,
        kind,
        channel: t.channel,
        at: t.sentAt as Date,
        reach: m.reach,
        impressions: m.impressions,
        engagement: m.likes + m.comments + m.shares + m.saves,
      };
    });
}

/** Respaldo: cómo se movieron las posiciones entre las dos últimas revisiones (misma zona). */
function rankMovesFrom(rows: unknown[]): RankMoveLite[] | null {
  const now = readRankReport(rows[0]);
  const before = readRankReport(rows[1]);
  if (!now || !before || now.locationCode !== before.locationCode) return null;
  const prev = new Map(before.rows.filter((r) => !r.error).map((r) => [r.keyword.toLowerCase(), r.position]));
  return now.rows.filter((r) => !r.error && prev.has(r.keyword.toLowerCase())).map((r) => ({ keyword: r.keyword, now: r.position, prev: prev.get(r.keyword.toLowerCase()) ?? null }));
}

/** Tope del mes y lo gastado este mes en anuncios (todas las campañas). Si no se puede leer: 0 (y nada sube). */
async function moneyContext(businessId: string, now: Date): Promise<{ monthlyCapCents: number; monthSpentCents: number }> {
  const month = businessDay(now).slice(0, 7);
  const [cap, rows] = await Promise.all([
    getAdsSettings(businessId)
      .then((s) => s.monthlyCapCents)
      .catch(() => 0),
    db.campaign.findMany({ where: { businessId, ads: { not: Prisma.DbNull } }, select: { ads: true } }),
  ]);
  return { monthlyCapCents: cap, monthSpentCents: monthSpentCents(rows.flatMap((r) => readCampaignAds(r.ads).items), month) };
}

const connectedOf = (rows: { channel: string }[]) => rows.map((r) => r.channel).filter((c) => (CHANNEL_IDS as string[]).includes(c));

async function applyContext(businessId: string, campaignId: string | null, now: Date, withMoney: boolean): Promise<ApplyContext> {
  const [b, campaign, money] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: { seoKeywords: true, connections: { select: { channel: true } } } }),
    campaignId ? db.campaign.findFirst({ where: { id: campaignId, businessId } }) : Promise.resolve(null),
    withMoney ? moneyContext(businessId, now) : Promise.resolve({ monthlyCapCents: 0, monthSpentCents: 0 }),
  ]);
  return {
    campaign: campaign ? campaignState(campaign) : null,
    connected: connectedOf(b?.connections ?? []),
    tracked: readTrackedKeywords(b?.seoKeywords),
    ...money,
    now,
  };
}

/** Todo lo que miran las reglas para un negocio. */
export async function loadRulesInput(businessId: string, now: Date): Promise<{ input: RulesInput; extra: AiContext }> {
  const b = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { name: true, timezone: true, seoKeywords: true, aiProfile: true, brandIdentity: true, seoLanguage: true, connections: { select: { channel: true } } },
  });
  const from = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);
  const tz = tzOf(b);
  const [summary, campaigns, gscRows, rankRows, ga4Rows, money, tasks] = await Promise.all([
    // La fuente de los números: el mismo resumen que ve el dueño en Resultados.
    resultsSummary(businessId, from, now).catch((e) => {
      console.error("proposals: resultsSummary", e);
      return null;
    }),
    db.campaign.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 30 }),
    latestReports(businessId, "gsc", 1),
    latestReports(businessId, "rank", 2),
    latestReports(businessId, "ga4", 1),
    moneyContext(businessId, now),
    db.actionTask.findMany({ where: { businessId, status: "todo" }, orderBy: [{ impact: "desc" }, { lastSeen: "desc" }], take: 5, select: { title: true } }),
  ]);
  const stats = summary ? statsFromSummary(summary) : statsFromPosts(await loadPostStats(businessId, from, now), tz, rankMovesFrom(rankRows.map((r) => r.data)));
  const input: RulesInput = {
    now,
    from,
    to: now,
    tz,
    businessName: b.name,
    stats,
    campaigns: campaigns.map(campaignState),
    connected: connectedOf(b.connections),
    tracked: readTrackedKeywords(b.seoKeywords),
    gsc: asGscReport(gscRows[0]?.data),
    ...money,
  };
  const ga4 = readGa4Report(ga4Rows[0]?.data);
  return {
    input,
    extra: {
      name: b.name,
      aiProfile: b.aiProfile,
      brandIdentity: b.brandIdentity,
      lang: b.seoLanguage === "en" ? "en" : "es",
      plan: tasks.map((t) => readTitle(t.title).es).filter(Boolean),
      visits: ga4 ? `${ga4.totals.sessions} website visits in the last 28 days (before: ${ga4.previous.sessions})` : "",
    },
  };
}

// ---------- La IA: redactar y 1-2 ideas ----------

export type AiContext = { name: string; aiProfile: string; brandIdentity: unknown; lang: "es" | "en"; plan: string[]; visits: string };

export const WordingSchema = z.object({
  items: z
    .array(
      z.object({
        ref: z.string().describe("The ref of the proposal being reworded, exactly as given"),
        titleEs: z.string().describe("Spanish title, max 70 characters, plain words"),
        titleEn: z.string().describe("English title, max 70 characters, plain words"),
        detailEs: z.string().describe("Spanish: 1-2 short sentences, why and what changes, keep every number"),
        detailEn: z.string().describe("English: 1-2 short sentences, why and what changes, keep every number"),
      }),
    )
    .max(12),
  ideas: z
    .array(
      z.object({
        campaignRef: z.string().describe("Exact id of one listed campaign, or empty string"),
        titleEs: z.string(),
        titleEn: z.string(),
        whyEs: z.string().describe("Spanish: 1-2 sentences, why this idea fits the business and its results"),
        whyEn: z.string(),
        postText: z.string().describe("Ready-to-post text in the business language, max 600 characters, no prices, no promises, never names competitors"),
      }),
    )
    .max(2),
});
export type Wording = z.infer<typeof WordingSchema>;

export function wordingPrompt(drafts: ProposalDraft[], campaigns: CampaignState[], x: AiContext): { system: string; user: string } {
  const system = `You help the owner of a small local business improve their marketing. You receive improvement proposals that were found with fixed rules from real results.
1. Reword each proposal's title (max 70 characters) and detail (1-2 short sentences) in plain, friendly Spanish and English for a non-technical owner. No jargon (no "CTR", "engagement", "CPM"). Keep every number, name, time and money amount exactly as given. Never invent data or change what the proposal does.
2. Add up to 2 creative ideas: a ready-to-post text for one of the listed campaigns (campaignRef = its id) that fits the business, its results and its action plan. If no campaign is listed, leave campaignRef empty and make it a short tip instead.
Never write about politics, religion, prices or discounts, guarantees, or competitors.
${identityPrompt({ brandIdentity: x.brandIdentity })}`;
  const user = [
    `Business: ${x.name}`,
    x.aiProfile && `Profile:\n${x.aiProfile.slice(0, 1500)}`,
    x.visits && `Website: ${x.visits}`,
    x.plan.length > 0 && `Action plan (top tasks):\n${x.plan.map((p) => `- ${p}`).join("\n")}`,
    campaigns.length > 0 && `Campaigns:\n${campaigns.map((c) => `- id ${c.id}: "${c.name}" (${c.status}), keywords: ${c.keywords.join(", ") || "none"}`).join("\n")}`,
    `Business language for post texts: ${x.lang === "en" ? "English" : "Spanish"}`,
    `Proposals:\n${drafts.map((d, i) => `- ref p${i} [${d.kind}] ${d.title.en} — ${d.detail.en} Data: ${d.evidence.facts.map((f) => `${f.label.en}: ${f.value.split("|").pop()}`).join("; ")}`).join("\n") || "(none)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system, user };
}

const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

/** Junta lo que redactó la IA con las propuestas (si algo falta o viene vacío, se queda el texto de la regla). */
export function mergeWording(drafts: ProposalDraft[], w: Wording, ideaCampaigns: CampaignState[], now: Date, tz: string): ProposalDraft[] {
  const byRef = new Map(w.items.map((i) => [i.ref.trim(), i]));
  const out = drafts.map((d, i) => {
    const it = byRef.get(`p${i}`);
    if (!it) return d;
    const title = { es: clip(it.titleEs, 90) || d.title.es, en: clip(it.titleEn, 90) || d.title.en };
    const detail = { es: clip(it.detailEs, 400) || d.detail.es, en: clip(it.detailEn, 400) || d.detail.en };
    return { ...d, title, detail };
  });
  const period = { from: localParts(new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS), tz).day, to: localParts(now, tz).day };
  for (const idea of w.ideas.slice(0, 2)) {
    const title = { es: clip(idea.titleEs, 90), en: clip(idea.titleEn, 90) || clip(idea.titleEs, 90) };
    if (!title.es) continue;
    const c = ideaCampaigns.find((x) => x.id === idea.campaignRef.trim()) ?? null;
    const text = idea.postText.trim().slice(0, 1200);
    const action: ProposalAction | null = c && text ? { type: "post.draft", campaignId: c.id, text, postKind: "post" } : null;
    const keyText = (text || title.es).toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, " ").trim().slice(0, 40);
    out.push({
      kind: action ? "content" : "other",
      campaignId: c?.id ?? null,
      impact: 1,
      title,
      detail: { es: clip(idea.whyEs, 400), en: clip(idea.whyEn, 400) || clip(idea.whyEs, 400) },
      action,
      evidence: {
        key: `${action ? "content" : "other"}:${c?.id ?? "-"}:${keyText}`,
        rule: "ai",
        period,
        facts: [],
        source: B("Idea de la IA con tus resultados y tu plan de acción", "AI idea based on your results and your action plan"),
        change: action ? [{ label: B("Borrador nuevo en la campaña", "New draft in the campaign"), before: "—", after: `${text.slice(0, 160)}${text.length > 160 ? "…" : ""}` }] : [],
      },
    });
  }
  return out;
}

const aiReady = () => Boolean(process.env.GEMINI_API_KEY);

// ---------- Crear propuestas ----------

/** Las propuestas recientes del negocio con su clave (para no repetir). */
async function existingKeys(businessId: string, now: Date): Promise<ExistingProposal[]> {
  const rows = await db.aiProposal.findMany({
    where: { businessId, createdAt: { gte: new Date(now.getTime() - 60 * DAY_MS) } },
    select: { status: true, createdAt: true, decidedAt: true, evidence: true },
  });
  return rows.map((r) => ({ key: readEvidence(r.evidence).key, status: r.status, createdAt: r.createdAt, decidedAt: r.decidedAt }));
}

/** Vence las propuestas sin decidir de más de 14 días (de un negocio, o de todos). */
export async function expireProposals(now: Date, businessId?: string): Promise<number> {
  const r = await db.aiProposal.updateMany({
    where: { ...(businessId ? { businessId } : {}), status: "proposed", createdAt: { lt: new Date(now.getTime() - EXPIRE_DAYS * DAY_MS) } },
    data: { status: "expired", decidedAt: now },
  });
  return r.count;
}

export type RunOutcome = { created: number; autoApplied: number; aiUsed: boolean; costCents: number; aiError?: Bi; skipped: number };

/** Busca propuestas para un negocio, las guarda y aplica solas las de bajo riesgo permitidas. */
export async function generateProposals(businessId: string, now: Date, opts: { actor: AiActor; useAi?: boolean } = { actor: "auto" }): Promise<RunOutcome> {
  await expireProposals(now, businessId);
  const { input, extra } = await loadRulesInput(businessId, now);
  const existing = await existingKeys(businessId, now);
  let drafts = detectProposals(input).filter((d) => !isDuplicate(d.evidence.key, existing, now));
  const ideaCampaigns = input.campaigns.filter((c) => (c.status === "active" || c.status === "draft") && c.channels.some((ch) => input.connected.includes(ch)));
  let aiUsed = false;
  let aiError: Bi | undefined;
  if ((opts.useAi ?? true) && aiReady() && (drafts.length > 0 || ideaCampaigns.length > 0)) {
    try {
      const p = wordingPrompt(drafts, ideaCampaigns, extra);
      const w = await askGemini(WordingSchema, p.system, p.user, 4000);
      aiUsed = true;
      const ctx = (c: CampaignState | null): ApplyContext => ({ campaign: c, connected: input.connected, tracked: input.tracked, monthlyCapCents: input.monthlyCapCents, monthSpentCents: input.monthSpentCents, now });
      drafts = mergeWording(drafts, w, ideaCampaigns, now, input.tz).filter(
        (d) =>
          d.evidence.rule !== "ai" ||
          (!isDuplicate(d.evidence.key, existing, now) && (!d.action || !validateAction(d.action, ctx(input.campaigns.find((c) => c.id === d.campaignId) ?? null)).length)),
      );
    } catch (e) {
      aiError = { es: errorText(e, "es"), en: errorText(e, "en") };
    }
  }
  const costCents = aiUsed ? PROPOSALS_AI_CENTS : 0;
  const created: AiProposal[] = [];
  for (const d of drafts) {
    created.push(
      await db.aiProposal.create({
        data: {
          businessId,
          campaignId: d.campaignId,
          kind: d.kind,
          title: json(d.title),
          detail: json(d.detail),
          impact: d.impact,
          status: "proposed",
          action: d.action ? json(d.action) : Prisma.JsonNull,
          evidence: json(d.evidence),
        },
      }),
    );
  }
  let autoApplied = 0;
  for (const p of created) {
    const c = input.campaigns.find((x) => x.id === p.campaignId) ?? null;
    const a = readAction(p.action);
    if (!canAutoApply(asKind(p.kind), a ? bareAction(a) : null, c)) continue;
    const r = await acceptProposal(p.id, { businessId, actor: "auto", now });
    if (r.ok) autoApplied++;
  }
  await saveReport(
    businessId,
    "proposals",
    json({
      version: 1,
      at: now.toISOString(),
      period: { from: input.from.toISOString(), to: input.to.toISOString() },
      created: created.length,
      ids: created.map((p) => p.id),
      autoApplied,
      aiUsed,
      costCents,
      by: opts.actor,
      ...(aiError ? { aiError } : {}),
    }),
  );
  if (created.length || costCents) {
    await logAiAction({
      businessId,
      kind: "proposal.run",
      actor: opts.actor,
      costCents,
      summary: created.length
        ? { es: `La IA revisó tus resultados y dejó ${created.length} ${created.length === 1 ? "propuesta" : "propuestas"} para ti.`, en: `The AI reviewed your results and left ${created.length} ${created.length === 1 ? "proposal" : "proposals"} for you.` }
        : { es: "La IA revisó tus resultados: por ahora no hay mejoras nuevas.", en: "The AI reviewed your results: no new improvements for now." },
      detail: json({ created: created.map((p) => p.id), autoApplied, aiUsed }),
    });
  }
  return { created: created.length, autoApplied, aiUsed, costCents, skipped: 0, ...(aiError ? { aiError } : {}) };
}

/**
 * La llama el cron: vence lo viejo y busca propuestas en los negocios que no tuvieron una corrida en 7 días.
 * Como mucho `maxBusinesses` por llamada (el cron corre cada minuto, así que todos se atienden pronto).
 */
export async function runProposals(now = new Date(), opts: { maxBusinesses?: number } = {}): Promise<{ businesses: number; created: number; autoApplied: number; expired: number; errors: number }> {
  const expired = await expireProposals(now);
  const since = new Date(now.getTime() - RUN_EVERY_DAYS * DAY_MS);
  const [businesses, recent] = await Promise.all([
    db.business.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } }),
    db.seoReport.findMany({ where: { kind: "proposals", createdAt: { gte: since } }, select: { businessId: true } }),
  ]);
  const done = new Set(recent.map((r) => r.businessId));
  const due = businesses.filter((b) => !done.has(b.id)).slice(0, opts.maxBusinesses ?? 2);
  let created = 0;
  let autoApplied = 0;
  let errors = 0;
  for (const b of due) {
    try {
      const r = await generateProposals(b.id, now, { actor: "auto" });
      created += r.created;
      autoApplied += r.autoApplied;
    } catch (e) {
      errors++;
      console.error("runProposals", b.id, e);
      // Se anota la corrida para no reintentar cada minuto: se vuelve a intentar en una semana (o con el botón).
      await saveReport(b.id, "proposals", json({ version: 1, at: now.toISOString(), created: 0, error: errorText(e, "es") })).catch(() => undefined);
    }
  }
  return { businesses: due.length, created, autoApplied, expired, errors };
}

/** «Buscar mejoras ahora» (el dueño lo pide). Como mucho una vez cada 10 minutos. */
export async function proposeNow(businessId: string, now = new Date()): Promise<RunOutcome & { tooSoon?: boolean }> {
  const last = await db.seoReport.findFirst({ where: { businessId, kind: "proposals" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (last && now.getTime() - last.createdAt.getTime() < NOW_COOLDOWN_MS) return { created: 0, autoApplied: 0, aiUsed: false, costCents: 0, skipped: 0, tooSoon: true };
  return generateProposals(businessId, now, { actor: "approved" });
}

/** Cuántas propuestas nuevas esperan al dueño (para el Inicio y el menú). */
export function openProposalCount(businessId: string, now = new Date()) {
  return db.aiProposal.count({ where: { businessId, status: "proposed", createdAt: { gte: new Date(now.getTime() - EXPIRE_DAYS * DAY_MS) } } });
}

// ---------- Aceptar, rechazar, deshacer ----------

export type DecideResult = { ok: boolean; message: Bi };

const NOT_FOUND = B("Esa propuesta ya no existe.", "That proposal no longer exists.");
const ALREADY = B("Esa propuesta ya se decidió.", "That proposal was already decided.");
const fail = (message: Bi): DecideResult => ({ ok: false, message });
const joinBi = (ps: Bi[]): Bi => ({ es: ps.map((p) => p.es).join(" "), en: ps.map((p) => p.en).join(" ") });

type Tx = Prisma.TransactionClient;

/** Una excepción con sus dos idiomas (para cortar la transacción y devolver el motivo). */
class Refused extends Error {
  constructor(public bi: Bi) {
    super(bi.es);
  }
}

async function lockCampaign(tx: Tx, businessId: string, campaignId: string) {
  await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${campaignId} FOR UPDATE`;
  const row = await tx.campaign.findFirst({ where: { id: campaignId, businessId } });
  if (!row) throw new Refused(B("La campaña ya no existe.", "The campaign no longer exists."));
  return row;
}

async function writeCampaign(tx: Tx, row: Campaign, next: CampaignState) {
  await tx.campaign.update({
    where: { id: row.id },
    data: { rules: json(rulesJson(next.rules, readEngine(row.rules))), perWeek: next.perWeek, channels: next.channels, keywords: next.keywords },
  });
}

/** Aplica la acción dentro de la transacción (con la fila bloqueada). Devuelve antes y después. */
async function applyInTx(tx: Tx, businessId: string, a: ProposalAction, ctx: ApplyContext, now: Date): Promise<Omit<AppliedRecord, "at" | "actor">> {
  if (a.type === "keyword.track") {
    await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR UPDATE`;
    const b = await tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { seoKeywords: true } });
    const tracked = readTrackedKeywords(b.seoKeywords);
    const problems = validateAction(a, { ...ctx, tracked });
    if (problems.length) throw new Refused(joinBi(problems));
    const have = new Set(tracked.map((k) => k.toLowerCase()));
    const added = a.keywords.map((k) => k.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80)).filter((k) => k && !have.has(k));
    const next = [...tracked, ...added].slice(0, MAX_TRACKED_KEYWORDS);
    await tx.business.update({ where: { id: businessId }, data: { seoKeywords: next } });
    return { before: { keywords: tracked }, after: { keywords: next, added }, reversible: true };
  }
  const row = await lockCampaign(tx, businessId, a.campaignId);
  const c = campaignState(row);
  const problems = validateAction(a, { ...ctx, campaign: c });
  if (problems.length) throw new Refused(joinBi(problems));
  if (a.type === "campaign.update") {
    const { before, after } = patchFields(c, a.patch);
    await writeCampaign(tx, row, withFields(c, after));
    return { before, after, reversible: true };
  }
  if (a.type === "ad.daily") {
    const ad = c.ads.items.find((x) => x.id === a.adId)!;
    const ads = { ...c.ads, items: c.ads.items.map((x) => (x.id === a.adId ? { ...x, dailyCents: a.dailyCents } : x)) };
    await tx.campaign.update({ where: { id: row.id }, data: { ads: json(ads) } });
    return { before: { adId: ad.id, dailyCents: ad.dailyCents }, after: { adId: ad.id, dailyCents: a.dailyCents }, reversible: true };
  }
  if (a.type === "post.draft") {
    const tz = c.rules.timezone;
    const scheduledAt = localToUtc(addDays(localParts(now, tz).day, 2), 0, usableTimes(c.rules)[0], tz);
    const channels = c.channels.filter((ch) => ctx.connected.includes(ch));
    const post = await tx.post.create({
      data: {
        businessId,
        campaignId: c.id,
        text: a.text,
        source: "ai",
        status: "draft",
        kind: a.postKind,
        scheduledAt,
        targets: { create: channels.map((channel) => ({ channel })) },
      },
      select: { id: true },
    });
    return { before: {}, after: { postId: post.id, scheduledAt: scheduledAt.toISOString() }, reversible: true, postId: post.id };
  }
  throw new Refused(B("Ese cambio no se aplica aquí.", "That change isn't applied here."));
}

/**
 * Acepta una propuesta: la aplica (revisada otra vez contra el estado y los topes de ahora), la marca aplicada y lo
 * anota en el registro. Un consejo sin cambio queda «aceptado». `actor: "auto"` = la IA la aplicó sola (bajo riesgo).
 */
export async function acceptProposal(id: string, opts: { businessId?: string; actor?: "approved" | "auto"; now?: Date } = {}): Promise<DecideResult> {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "approved";
  const p = await db.aiProposal.findUnique({ where: { id } });
  if (!p || (opts.businessId && p.businessId !== opts.businessId)) return fail(NOT_FOUND);
  if (p.status !== "proposed") return fail(ALREADY);
  if (isExpired(p, now)) {
    await db.aiProposal.update({ where: { id }, data: { status: "expired", decidedAt: now } });
    return fail(B("Esa propuesta venció (pasaron más de 14 días). Busca mejoras otra vez.", "That proposal expired (more than 14 days passed). Look for improvements again."));
  }
  const title = readTitle(p.title);
  const stored = readAction(p.action);
  if (!stored) {
    if (actor === "auto") return fail(B("Un consejo no se aplica solo.", "A tip isn't applied on its own."));
    const r = await db.aiProposal.updateMany({ where: { id, status: "proposed" }, data: { status: "accepted", decidedAt: now } });
    return r.count ? { ok: true, message: B("Anotado. Este es un consejo: lo haces tú cuando quieras.", "Noted. This is a tip: you do it whenever you want.") } : fail(ALREADY);
  }
  const action = bareAction(stored);
  if (actor === "auto") {
    // Solo lo de bajo riesgo, y solo si la campaña (leída de nuevo) sigue permitiéndolo.
    const c = action.type === "keyword.track" ? null : await db.campaign.findFirst({ where: { id: action.campaignId, businessId: p.businessId } });
    if (!canAutoApply(asKind(p.kind), action, c ? campaignState(c) : null)) return fail(B("Esta propuesta necesita tu aprobación.", "This proposal needs your approval."));
  }
  const campaignId = action.type === "keyword.track" ? null : action.campaignId;
  const ctx = await applyContext(p.businessId, campaignId, now, action.type === "ad.daily" || action.type === "ad.pause");

  if (action.type === "ad.pause") {
    // Pausar habla con Meta (fuera de la transacción): primero se «toma» la propuesta para no aplicarla dos veces.
    const problems = validateAction(action, ctx);
    if (problems.length) return fail(joinBi(problems));
    const claimed = await db.aiProposal.updateMany({ where: { id, status: "proposed" }, data: { status: "accepted", decidedAt: now } });
    if (!claimed.count) return fail(ALREADY);
    try {
      await pauseAd(p.businessId, action.campaignId, action.adId, now);
    } catch (e) {
      await db.aiProposal.update({ where: { id }, data: { status: "proposed", decidedAt: null } });
      return fail({ es: errorText(e, "es"), en: errorText(e, "en") });
    }
    const applied: AppliedRecord = { at: now.toISOString(), actor, before: { adId: action.adId, status: "on" }, after: { adId: action.adId, status: "paused" }, reversible: false };
    await db.$transaction(async (tx) => {
      await tx.aiProposal.update({ where: { id }, data: { status: "applied", appliedAt: now, action: json({ ...action, applied }) } });
      await logInTx(tx, p, actor, appliedSummary(title, actor), applied, action);
    });
    return { ok: true, message: B("Listo: el anuncio quedó pausado. Para volver a encenderlo, ve a Anuncios.", "Done: the ad is paused. To turn it back on, go to Ads.") };
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AiProposal" WHERE id = ${id} FOR UPDATE`;
      const cur = await tx.aiProposal.findUnique({ where: { id }, select: { status: true } });
      if (cur?.status !== "proposed") throw new Refused(ALREADY);
      const res = await applyInTx(tx, p.businessId, action, ctx, now);
      const applied: AppliedRecord = { at: now.toISOString(), actor, ...res, reversible: res.reversible && isReversible(action) };
      await tx.aiProposal.update({ where: { id }, data: { status: "applied", decidedAt: now, appliedAt: now, action: json({ ...action, applied }) } });
      await logInTx(tx, p, actor, appliedSummary(title, actor), applied, action);
    });
  } catch (e) {
    if (e instanceof Refused) return fail(e.bi);
    throw e;
  }
  if (action.type === "keyword.track") await rememberChoices(p.businessId, [], action.keywords).catch(() => undefined);
  return {
    ok: true,
    message:
      action.type === "post.draft"
        ? B("Listo: la idea quedó como borrador en la campaña. Apruébala cuando quieras.", "Done: the idea is now a draft in the campaign. Approve it whenever you want.")
        : B("Listo: el cambio ya se aplicó. Puedes deshacerlo durante 24 horas.", "Done: the change is applied. You can undo it for 24 hours."),
  };
}

async function logInTx(tx: Tx, p: Pick<AiProposal, "id" | "businessId" | "kind" | "title">, actor: AiActor, summary: Bi, applied: AppliedRecord, action: ProposalAction, undone = false) {
  await tx.aiAction.create({
    data: {
      businessId: p.businessId,
      campaignId: action.type === "keyword.track" ? null : action.campaignId,
      kind: undone ? "proposal.undone" : "proposal.applied",
      summary: { es: summary.es.slice(0, 500), en: summary.en.slice(0, 500) },
      detail: json({ proposalId: p.id, proposalKind: p.kind, change: action.type, before: applied.before, after: applied.after, ...(action.type === "ad.pause" || action.type === "ad.daily" ? { adId: action.adId } : {}) }),
      actor,
      costCents: 0,
      postId: applied.postId ?? null,
    },
  });
}

export async function rejectProposal(id: string, reason?: string, opts: { businessId?: string; now?: Date } = {}): Promise<DecideResult> {
  const now = opts.now ?? new Date();
  const p = await db.aiProposal.findUnique({ where: { id }, select: { businessId: true, status: true, detail: true } });
  if (!p || (opts.businessId && p.businessId !== opts.businessId)) return fail(NOT_FOUND);
  const why = (reason ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const detail = { ...readDetail(p.detail), ...(why ? { rejectReason: why } : {}) };
  const r = await db.aiProposal.updateMany({ where: { id, status: "proposed" }, data: { status: "rejected", decidedAt: now, detail: json(detail) } });
  if (!r.count) return fail(ALREADY);
  return { ok: true, message: B("Rechazada. La IA no volverá a proponer esto en un mes.", "Rejected. The AI won't propose this again for a month.") };
}

/** «Deshacer» (24 horas): vuelve a dejar todo como estaba, revisado otra vez. La propuesta queda rechazada. */
export async function undoProposal(id: string, opts: { businessId?: string; now?: Date } = {}): Promise<DecideResult> {
  const now = opts.now ?? new Date();
  const p = await db.aiProposal.findUnique({ where: { id } });
  if (!p || (opts.businessId && p.businessId !== opts.businessId)) return fail(NOT_FOUND);
  const stored = readAction(p.action);
  if (!stored || !canUndo({ status: p.status, action: stored }, now))
    return fail(B("Esto ya no se puede deshacer (pasaron 24 horas o no tiene vuelta atrás).", "This can't be undone anymore (24 hours passed or it can't be reversed)."));
  const applied = stored.applied!;
  const action = bareAction(stored);
  const ctx = await applyContext(p.businessId, action.type === "keyword.track" ? null : action.campaignId, now, action.type === "ad.daily");
  try {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AiProposal" WHERE id = ${id} FOR UPDATE`;
      const cur = await tx.aiProposal.findUnique({ where: { id }, select: { status: true } });
      if (cur?.status !== "applied") throw new Refused(ALREADY);
      await revertInTx(tx, p.businessId, action, applied, ctx);
      const undone: AppliedRecord = { ...applied, undoneAt: now.toISOString() };
      const detail = { ...readDetail(p.detail), rejectReason: "undone" };
      await tx.aiProposal.update({ where: { id }, data: { status: "rejected", decidedAt: now, action: json({ ...action, applied: undone }), detail: json(detail) } });
      await logInTx(tx, p, "owner", appliedSummary(readTitle(p.title), "owner", true), { ...applied, before: applied.after, after: applied.before }, action, true);
    });
  } catch (e) {
    if (e instanceof Refused) return fail(e.bi);
    throw e;
  }
  return { ok: true, message: B("Listo: quedó como estaba antes.", "Done: it's back to how it was.") };
}

async function revertInTx(tx: Tx, businessId: string, a: ProposalAction, applied: AppliedRecord, ctx: ApplyContext) {
  if (a.type === "keyword.track") {
    await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR UPDATE`;
    const b = await tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { seoKeywords: true } });
    const added = new Set((Array.isArray(applied.after.added) ? applied.after.added : []).filter((k): k is string => typeof k === "string"));
    await tx.business.update({ where: { id: businessId }, data: { seoKeywords: readTrackedKeywords(b.seoKeywords).filter((k) => !added.has(k.toLowerCase())) } });
    return;
  }
  const row = await lockCampaign(tx, businessId, a.campaignId);
  const c = campaignState(row);
  if (a.type === "campaign.update") {
    const before = readFields(applied.before);
    const problems = campaignProblems(c, before, ctx.connected, readFields(applied.after));
    if (problems.length) throw new Refused(joinBi(problems));
    await writeCampaign(tx, row, withFields(c, before));
    return;
  }
  if (a.type === "ad.daily") {
    const prev = typeof applied.before.dailyCents === "number" ? applied.before.dailyCents : null;
    const ad = c.ads.items.find((x) => x.id === a.adId);
    if (prev === null || !ad) throw new Refused(B("El anuncio ya no existe.", "The ad no longer exists."));
    const problems = adDailyProblems(ad, prev, c, ctx);
    if (problems.length) throw new Refused(joinBi(problems));
    await tx.campaign.update({ where: { id: row.id }, data: { ads: json({ ...c.ads, items: c.ads.items.map((x) => (x.id === a.adId ? { ...x, dailyCents: prev } : x)) }) } });
    return;
  }
  if (a.type === "post.draft") {
    const postId = applied.postId;
    const post = postId ? await tx.post.findFirst({ where: { id: postId, businessId }, select: { status: true } }) : null;
    if (post && post.status !== "draft") throw new Refused(B("Esa publicación ya se aprobó: bórrala desde la campaña si no la quieres.", "That post was already approved: delete it from the campaign if you don't want it."));
    if (post) await tx.post.delete({ where: { id: postId } });
    return;
  }
  throw new Refused(B("Esto no se puede deshacer.", "This can't be undone."));
}
