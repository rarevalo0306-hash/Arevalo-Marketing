// Campañas en el servidor: leer, cambiar de estado (empezar, pausar, reanudar, PARAR), terminar solas y avisar al dueño.
// Las reglas puras (forma de rules, checkPost, horarios) están en src/lib/campaign-shape.ts; el motor que crea las
// publicaciones automáticas está en src/lib/campaign-engine.ts.
//
// Anuncios pagados: este archivo NO importa nada de los anuncios. PARAR deja Campaign.status = "stopped" (y pausar,
// "paused"); el motor de anuncios (syncAds en src/lib/ads.ts, que corre en el cron cada minuto) revisa Campaign.status
// y pausa en Meta los anuncios de las campañas que no estén "active".

import type { Business, Campaign, Prisma } from "@prisma/client";
import { logAiAction, type AiActor } from "@/lib/ai-actions";
import {
  aiImageCents,
  campaignSlots,
  readEngine,
  readRules,
  rulesJson,
  type CampaignRules,
  type EngineState,
  STOPPABLE_STATUSES,
} from "@/lib/campaign-shape";
import { channelName, CHANNELS } from "@/lib/channels";
import { db } from "@/lib/db";
import type { UiLang } from "@/lib/i18n";
import { imagesEnabled, pickImage } from "@/lib/imagegen";
import { readTrackedKeywords } from "@/lib/seo/dataforseo";
import { renderEmail, sendSeoEmail, type EmailBlock } from "@/lib/seo/alerts";
import { escapeHtml } from "@/lib/text";
import { readInput, readStudy, topKeywords } from "@/lib/study-shape";

export type Bi = { es: string; en: string };

/** Las reglas de una campaña con el email del dueño como valor por defecto para los avisos. */
export function rulesOf(c: Pick<Campaign, "rules">, b?: { ownerEmail?: string; seoLanguage?: string }): CampaignRules {
  return readRules(c.rules, { email: b?.ownerEmail, lang: b?.seoLanguage });
}

/** Guarda las reglas sin perder el estado del motor (siempre leído de nuevo de la base de datos). */
export async function saveRules(campaignId: string, rules: CampaignRules, patch: (e: EngineState) => EngineState = (e) => e): Promise<void> {
  const cur = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { rules: true } });
  await db.campaign.update({ where: { id: campaignId }, data: { rules: rulesJson(rules, patch(readEngine(cur.rules))) as Prisma.InputJsonValue } });
}

/** Cambia solo el estado del motor (sin tocar lo que el dueño eligió). */
export async function patchEngine(campaignId: string, patch: (e: EngineState) => EngineState): Promise<void> {
  const cur = await db.campaign.findUnique({ where: { id: campaignId }, select: { rules: true } });
  if (!cur) return;
  await db.campaign.update({ where: { id: campaignId }, data: { rules: rulesJson(readRules(cur.rules), patch(readEngine(cur.rules))) as Prisma.InputJsonValue } });
}

// ---------- Palabras clave de la campaña ----------

/** Las palabras clave para los textos: las de la campaña, las que sigue el negocio en Google y las del estudio. */
export function campaignKeywords(b: { seoKeywords: unknown; study: unknown }, c: { keywords: string[] }, max = 12): string[] {
  const study = readStudy(b.study);
  const all = [...c.keywords, ...readTrackedKeywords(b.seoKeywords), ...(study ? topKeywords(study, 12) : [])];
  const seen = new Set<string>();
  return all.map((k) => k.trim()).filter((k) => k && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase())).slice(0, max);
}

/** Nombres de la competencia que conoce la app (del estudio y de lo que dijo el dueño). */
export function competitorNames(b: { study: unknown; studyInput: unknown }): string[] {
  const study = readStudy(b.study);
  const input = readInput(b.studyInput);
  const names = [...(study?.market.competitors.map((c) => c.name) ?? []), ...(input?.competitors ?? "").split(/[,;\n]/)];
  const seen = new Set<string>();
  return names
    .map((n) => n.replace(/\(.*?\)/g, "").trim())
    .filter((n) => n.length >= 3 && n.length <= 60 && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
    .slice(0, 20);
}

// ---------- Leer para las pantallas ----------

export type CampaignCard = {
  id: string;
  name: string;
  goal: string;
  mode: string;
  status: string;
  startsAt: Date;
  endsAt: Date | null;
  channels: string[];
  perWeek: number;
  planned: number;
  published: number;
  pending: number;
  drafts: number;
  failed: number;
  nextAt: Date | null;
};

const PUBLISHED = ["done", "partial"];

/** Las campañas del negocio con lo hecho y lo que falta (activas primero). */
export async function loadCampaigns(businessId: string): Promise<CampaignCard[]> {
  const rows = await db.campaign.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 60 });
  if (!rows.length) return [];
  const [groups, next] = await Promise.all([
    db.post.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: rows.map((r) => r.id) } }, _count: { _all: true } }),
    db.post.findMany({
      where: { campaignId: { in: rows.map((r) => r.id) }, status: { in: ["scheduled", "draft"] }, scheduledAt: { gte: new Date() } },
      orderBy: { scheduledAt: "asc" },
      select: { campaignId: true, scheduledAt: true },
    }),
  ]);
  const order: Record<string, number> = { active: 0, paused: 1, draft: 2, stopped: 3, ended: 4 };
  return rows
    .map((c) => {
      const count = (st: string[]) => groups.filter((g) => g.campaignId === c.id && st.includes(g.status)).reduce((s, g) => s + g._count._all, 0);
      const rules = readRules(c.rules);
      const closed = c.status === "stopped" || c.status === "ended";
      const planned = c.mode === "manual" || closed ? count(["scheduled", "draft", "publishing", "done", "partial", "failed"]) : campaignSlots(c, rules).length;
      return {
        id: c.id,
        name: c.name,
        goal: c.goal,
        mode: c.mode,
        status: c.status,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        channels: c.channels,
        perWeek: c.perWeek,
        planned,
        published: count(PUBLISHED),
        pending: count(["scheduled", "publishing"]),
        drafts: count(["draft"]),
        failed: count(["failed"]),
        nextAt: c.status === "active" ? (next.find((n) => n.campaignId === c.id)?.scheduledAt ?? null) : null,
      };
    })
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
}

/** Lo gastado en fotos y videos con IA en una campaña (centavos), según el registro (video.render lo anota src/lib/video-campaign.ts). */
export async function aiSpentCents(campaignId: string): Promise<number> {
  const r = await db.aiAction.aggregate({
    where: { campaignId, OR: [{ kind: { startsWith: "post." } }, { kind: { startsWith: "media." } }, { kind: { startsWith: "video." } }] },
    _sum: { costCents: true },
  });
  return r._sum.costCents ?? 0;
}

// ---------- Cambios de estado ----------

export type StopResult = { ok: boolean; cancelled: number; already?: boolean };

/**
 * PARAR (emergencia): la campaña queda "stopped" y TODO lo que todavía no salió se cancela al instante: las
 * programadas vuelven a borrador (no se borra ningún texto) y los borradores se quedan como borrador, fuera del
 * motor. Se hace en una transacción: la campaña se bloquea primero, así el motor no puede crear otra publicación
 * a la vez (ver createCampaignPost en campaign-engine.ts). Los anuncios: el motor de anuncios ve status "stopped".
 */
export async function stopCampaign(businessId: string, campaignId: string, opts: { actor?: AiActor; why?: Bi } = {}): Promise<StopResult> {
  const c = await db.campaign.findFirst({ where: { id: campaignId, businessId } });
  if (!c) return { ok: false, cancelled: 0 };
  if (c.status === "stopped" || c.status === "ended") return { ok: true, cancelled: 0, already: true };
  const [, moved] = await db.$transaction([
    db.campaign.update({ where: { id: campaignId }, data: { status: "stopped" } }),
    db.post.updateMany({ where: { campaignId, status: "scheduled" }, data: { status: "draft" } }),
  ]);
  const drafts = await db.post.count({ where: { campaignId, status: { in: [...STOPPABLE_STATUSES] } } });
  await patchEngine(campaignId, (e) => ({ ...e, lockedUntil: null, held: [] }));
  const actor = opts.actor ?? "owner";
  const summary: Bi = {
    es: `Campaña «${c.name}» PARADA${actor === "owner" ? " por ti" : ""}: ${moved.count} publicación(es) programada(s) cancelada(s); ${drafts} quedan como borrador sin publicar.${opts.why ? ` ${opts.why.es}` : ""}`,
    en: `Campaign “${c.name}” STOPPED${actor === "owner" ? " by you" : ""}: ${moved.count} scheduled post(s) cancelled; ${drafts} stay as unpublished drafts.${opts.why ? ` ${opts.why.en}` : ""}`,
  };
  await logAiAction({ businessId, campaignId, kind: "campaign.stopped", summary, actor, detail: { cancelled: moved.count, drafts } });
  await campaignAlert(campaignId, "stop", summary);
  return { ok: true, cancelled: moved.count };
}

/** «Parar todo»: para todas las campañas del negocio que no estén paradas o terminadas. */
export async function stopAllCampaigns(businessId: string): Promise<{ stopped: number; cancelled: number }> {
  const list = await db.campaign.findMany({ where: { businessId, status: { in: ["draft", "active", "paused"] } }, select: { id: true } });
  let cancelled = 0;
  let stopped = 0;
  for (const c of list) {
    const r = await stopCampaign(businessId, c.id, {
      why: { es: "(Parar todo.)", en: "(Stop everything.)" },
    });
    if (r.ok && !r.already) stopped++;
    cancelled += r.cancelled;
  }
  return { stopped, cancelled };
}

/**
 * Pausa: la IA deja de preparar publicaciones y las programadas que faltan vuelven a borrador (se recuerdan para
 * volver a programarlas al reanudar). `actor: "auto"` cuando la pausa la hace el motor (por errores).
 */
export async function pauseCampaign(businessId: string, campaignId: string, opts: { actor?: AiActor; why?: Bi } = {}): Promise<boolean> {
  const c = await db.campaign.findFirst({ where: { id: campaignId, businessId } });
  if (!c || c.status !== "active") return false;
  const now = new Date();
  const toHold = await db.post.findMany({ where: { campaignId, status: "scheduled", scheduledAt: { gt: now } }, select: { id: true } });
  const [, moved] = await db.$transaction([
    db.campaign.update({ where: { id: campaignId }, data: { status: "paused" } }),
    db.post.updateMany({ where: { id: { in: toHold.map((p) => p.id) }, status: "scheduled" }, data: { status: "draft" } }),
  ]);
  await patchEngine(campaignId, (e) => ({ ...e, lockedUntil: null, held: [...new Set([...e.held, ...toHold.map((p) => p.id)])] }));
  const actor = opts.actor ?? "owner";
  const summary: Bi = {
    es: `Campaña «${c.name}» en pausa${actor === "owner" ? " (la pausaste tú)" : ""}. ${moved.count} publicación(es) programada(s) quedan en espera.${opts.why ? ` ${opts.why.es}` : ""}`,
    en: `Campaign “${c.name}” paused${actor === "owner" ? " (you paused it)" : ""}. ${moved.count} scheduled post(s) are on hold.${opts.why ? ` ${opts.why.en}` : ""}`,
  };
  await logAiAction({ businessId, campaignId, kind: "campaign.paused", summary, actor, detail: { held: moved.count } });
  if (actor === "auto") await campaignAlert(campaignId, "error", summary);
  return true;
}

/** Empezar (una campaña sin empezar) o reanudar (una en pausa). Las que estaban en espera se vuelven a programar. */
export async function resumeCampaign(businessId: string, campaignId: string): Promise<boolean> {
  const c = await db.campaign.findFirst({ where: { id: campaignId, businessId } });
  if (!c || (c.status !== "paused" && c.status !== "draft")) return false;
  const now = new Date();
  if (c.endsAt && c.endsAt <= now) return false;
  const engine = readEngine(c.rules);
  const [, back] = await db.$transaction([
    db.campaign.update({ where: { id: campaignId }, data: { status: "active" } }),
    db.post.updateMany({ where: { id: { in: engine.held }, campaignId, status: "draft", scheduledAt: { gt: now } }, data: { status: "scheduled" } }),
  ]);
  await patchEngine(campaignId, (e) => ({ ...e, held: [], errorsInRow: 0, lockedUntil: null, resetAt: now.toISOString() }));
  const started = c.status === "draft";
  await logAiAction({
    businessId,
    campaignId,
    kind: started ? "campaign.started" : "campaign.resumed",
    actor: "owner",
    summary: started
      ? { es: `Empezaste la campaña «${c.name}».`, en: `You started the campaign “${c.name}”.` }
      : { es: `Reanudaste la campaña «${c.name}». ${back.count} publicación(es) en espera se volvieron a programar.`, en: `You resumed the campaign “${c.name}”. ${back.count} post(s) on hold were scheduled again.` },
  });
  return true;
}

/** Termina solas las campañas cuya fecha de fin ya pasó. */
export async function endDueCampaigns(now = new Date()): Promise<number> {
  const due = await db.campaign.findMany({ where: { status: { in: ["active", "paused", "draft"] }, endsAt: { lte: now } }, select: { id: true, businessId: true, name: true }, take: 50 });
  let n = 0;
  for (const c of due) {
    const r = await db.campaign.updateMany({ where: { id: c.id, status: { in: ["active", "paused", "draft"] } }, data: { status: "ended" } });
    if (!r.count) continue;
    n++;
    // Lo que quedó en espera por una pausa ya no sale: queda como borrador.
    await patchEngine(c.id, (e) => ({ ...e, lockedUntil: null, held: [] }));
    await logAiAction({
      businessId: c.businessId,
      campaignId: c.id,
      kind: "campaign.ended",
      summary: { es: `La campaña «${c.name}» terminó en su fecha de fin.`, en: `The campaign “${c.name}” finished on its end date.` },
    });
  }
  return n;
}

// ---------- Avisos por email ----------

export type AlertKind = "post" | "limit" | "error" | "stop";

const baseUrl = () => (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/** Arma el email de aviso de una campaña (puro, para probarlo). */
export function buildCampaignEmail(
  b: { id: string; name: string; color: string },
  c: { id: string; name: string },
  kind: AlertKind,
  summary: Bi,
  lang: UiLang,
): { subject: string; html: string; text: string } {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const titles: Record<AlertKind, [string, string]> = {
    post: ["La IA preparó una publicación", "The AI prepared a post"],
    limit: ["La IA llegó a un límite", "The AI hit a limit"],
    error: ["La campaña se pausó por errores", "The campaign was paused because of errors"],
    stop: ["Campaña parada", "Campaign stopped"],
  };
  const title = t(...titles[kind]);
  const blocks: EmailBlock[] = [
    { kind: "p", text: t(`Campaña: ${c.name}`, `Campaign: ${c.name}`) },
    { kind: "p", text: lang === "en" ? summary.en : summary.es },
    {
      kind: "p",
      muted: true,
      text: t(
        "Puedes revisar todo lo que hizo la IA, aprobar, pausar o PARAR la campaña desde Campañas en la app.",
        "You can review everything the AI did, approve, pause or STOP the campaign from Campaigns in the app.",
      ),
    },
  ];
  const offText = t(
    "Para dejar de recibir estos avisos: abre la campaña en la app, entra a «Límites» y quita la marca de cada aviso.",
    "To stop these alerts: open the campaign in the app, go to “Limits” and uncheck each alert.",
  );
  const r = renderEmail(b, lang, title, blocks, { offText });
  // renderEmail lleva el botón a la página de SEO: aquí va a la campaña.
  const seoUrl = `${baseUrl()}/b/${encodeURIComponent(b.id)}/seo`;
  const url = `${baseUrl()}/b/${encodeURIComponent(b.id)}/campanas/${encodeURIComponent(c.id)}`;
  return {
    subject: `${title} · ${c.name}`.slice(0, 150),
    html: r.html.split(escapeHtml(seoUrl)).join(escapeHtml(url)),
    text: r.text.split(seoUrl).join(url),
  };
}

/** Manda el aviso si el dueño lo pidió para ese tipo. Nunca falla (si no se puede, queda en el registro). */
export async function campaignAlert(campaignId: string, kind: AlertKind, summary: Bi): Promise<boolean> {
  try {
    const c = await db.campaign.findUnique({
      where: { id: campaignId },
      include: { business: { select: { id: true, name: true, color: true, ownerEmail: true, seoEmailLang: true, seoLanguage: true } } },
    });
    if (!c) return false;
    const rules = rulesOf(c, c.business);
    const want = { post: rules.alerts.onEveryPost, limit: rules.alerts.onLimit, error: rules.alerts.onError, stop: rules.alerts.onStop }[kind];
    const to = rules.alerts.email || c.business.ownerEmail;
    if (!want || !to) return false;
    const lang: UiLang = c.business.seoEmailLang === "en" ? "en" : "es";
    const email = buildCampaignEmail(c.business, c, kind, summary, lang);
    try {
      await sendSeoEmail({ businessId: c.businessId, to: [to], ...email });
      await logAiAction({
        businessId: c.businessId,
        campaignId,
        kind: "alert.sent",
        summary: { es: `Aviso enviado a ${to}: ${email.subject}`, en: `Alert sent to ${to}: ${email.subject}` },
        detail: { alert: kind },
      });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logAiAction({
        businessId: c.businessId,
        campaignId,
        kind: "alert.failed",
        summary: { es: `No se pudo mandar el aviso por email a ${to}.`, en: `Couldn't send the email alert to ${to}.` },
        detail: { alert: kind, error: msg.slice(0, 300) },
      });
      return false;
    }
  } catch (e) {
    console.error("campaignAlert", e);
    return false;
  }
}

// ---------- Datos para el asistente ----------

type WizardBiz = Pick<Business, "id" | "name" | "aiImage" | "study" | "studyInput" | "seoKeywords" | "ownerEmail" | "seoLanguage"> & { connections: { channel: string }[] };

/** Lo que necesita el asistente: canales (conectados o no), ideas de objetivo, servicios, palabras clave y costo de una foto con IA. */
export function wizardContext(b: WizardBiz, lang: UiLang) {
  const connected = new Set(b.connections.map((c) => c.channel));
  const study = readStudy(b.study);
  const services = (study?.services ?? []).map((s) => s.name.trim()).filter(Boolean).slice(0, 8);
  const ideas = [
    ...(study?.campaigns ?? []).map((c) => c.title.trim()),
    ...services.slice(0, 3).map((s) => (lang === "en" ? `More customers for ${s}` : `Más clientes para ${s}`)),
  ].filter(Boolean);
  return {
    channels: CHANNELS.map((c) => ({ id: c.id, name: channelName(c.id, lang), connected: connected.has(c.id) })),
    suggestions: [...new Set(ideas)].slice(0, 8),
    services,
    businessKeywords: campaignKeywords(b, { keywords: [] }),
    imageCents: imagesEnabled() ? aiImageCents(pickImage(b.aiImage)) : 0,
    competitors: competitorNames(b),
  };
}
