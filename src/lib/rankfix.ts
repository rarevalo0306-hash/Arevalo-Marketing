// «✨ Que la IA mejore mis posiciones» en el servidor. Lo puro (reglas, costos, pasos) está en rankfix-shape.ts.
// - El plan es gratis: solo lee la base de datos (posiciones, auditoría, artículos, biblioteca y arreglos abiertos).
// - Al autorizar: un solo arreglo de la web («Arréglalo por mí», webfix.ts) con las páginas a mejorar, y los
//   artículos nuevos uno por uno después de responder (after): escribir → versión web → foto. El trabajo se guarda
//   como SeoReport kind "rankfix" después de cada paso; si se corta, la próxima consulta sigue donde quedó.
// - «Publicar todo» sube los artículos uno por uno (approveForSite: nunca dos veces) y publica el arreglo de la web
//   solo si su vista previa salió bien. Nada se publica sin ese clic.
import type { Prisma } from "@prisma/client";
import { after } from "next/server";
import { aiEnabled, pickText, writeSeoArticle } from "@/lib/ai";
import { logAiAction } from "@/lib/ai-actions";
import { aiImageCents } from "@/lib/campaign-shape";
import { db } from "@/lib/db";
import { bi, BiError } from "@/lib/i18n";
import { imagesEnabled, pickImage } from "@/lib/imagegen";
import {
  beginStep,
  buildPlan,
  canAfford,
  checkSelection,
  coversSearch,
  defaultSelection,
  dropLease,
  endStep,
  failItem,
  finishPublish,
  FIX_TITLE,
  hasWorkToPublish,
  improvePrompt,
  jobOpen,
  leaseActive,
  markPublished,
  markPublishFailed,
  MAX_SEARCHES,
  newRankFixJob,
  nextWork,
  planTotals,
  readRankFixJob,
  removeItem,
  resumeJob,
  RUN_BUDGET_MS,
  settle,
  STEP_MS,
  stepCents,
  stockPhoto,
  stopForBudget,
  takeLease,
  toPublish,
  usd,
  applyFixOutcome,
  writeAiCents,
  type Bi,
  type PlanRow,
  type Prices,
  type RankFixJob,
  type RankFixView,
  type SearchFacts,
  type WriteStep,
} from "@/lib/rankfix-shape";
import { readAuditReport } from "@/lib/seo/audit";
import { readZones } from "@/lib/seo/dataforseo";
import { readOnPageReport } from "@/lib/seo/onpage";
import { rankedPageName, rowAdvice, urlPath } from "@/lib/seo/plain";
import { loadPromptContext } from "@/lib/seo/prompt-context";
import type { PromptContext } from "@/lib/seo/prompt-core";
import { siteTexts } from "@/lib/seo/questions";
import { domainMatches, rankSetup, readRankReport, siteDomain, type RankReport } from "@/lib/seo/rank";
import { latestReports, saveReport } from "@/lib/seo/reports";
import { draftVersion, needsAiPick, rankArticlePhotos, readArticleSite, SITE_TEXT_CENTS, type PhotoItem, type SitePrepared } from "@/lib/seo/site-article";
import { approveForSite, chooseSitePhoto, generateSitePhoto, LIB_SELECT, prepareForSite, siteConnection } from "@/lib/seo/site-article-run";
import { coveredBy } from "@/lib/seo/topic-pick";
import { briefFor, cleanDraft, contentTargets, MAX_ARTICLES, readArticleReport, researchKeyword, scoreDraft, WRITER_SERP_COST, type ArticleReport, type WriterLang } from "@/lib/seo/writer";
import { groupByZone } from "@/lib/seo/zones";
import { loadWebFixState, publishWebFix, refreshWebFix, startWebFix } from "@/lib/webfix";
import { PICK_DEFAULTS } from "@/lib/webfix-routes";
import { canPublish, readJob, type FixView } from "@/lib/webfix-shape";

const KIND = "rankfix";
const json = (v: unknown) => v as Prisma.InputJsonValue;
const view = (id: string, job: RankFixJob): RankFixView => ({ ...job, id });
const errBi = (e: unknown): Bi =>
  e instanceof BiError ? { es: e.message, en: e.en } : { es: "Algo falló en este paso. Intenta de nuevo más tarde.", en: "Something went wrong in this step. Try again later." };

export const fixHref = (businessId: string) => `/b/${businessId}/seo?tab=web#arreglos`;
export const writerHref = (businessId: string, articleId: string) => `/b/${businessId}/seo/escribir?a=${encodeURIComponent(articleId)}`;

// ---------- Guardar y leer el trabajo ----------

async function latestJob(businessId: string): Promise<{ id: string; job: RankFixJob } | null> {
  const row = await db.seoReport.findFirst({ where: { businessId, kind: KIND }, orderBy: { createdAt: "desc" }, select: { id: true, data: true } });
  const job = row ? readRankFixJob(row.data) : null;
  return row && job ? { id: row.id, job } : null;
}

async function jobById(businessId: string, id: string): Promise<RankFixJob | null> {
  const row = await db.seoReport.findFirst({ where: { id, businessId, kind: KIND }, select: { data: true } });
  return row ? readRankFixJob(row.data) : null;
}

/**
 * Cambia el trabajo sobre lo último guardado, solo si nadie lo cambió mientras tanto (compara updatedAt). Así el
 * trabajador y el panel («Quitar», «Publicar todo») no se pisan. `fn` devuelve null para no cambiar nada.
 */
async function mutate(businessId: string, id: string, fn: (job: RankFixJob) => RankFixJob | null): Promise<RankFixJob | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await jobById(businessId, id);
    if (!cur) return null;
    const next = fn(cur);
    if (!next) return null;
    const stamp = new Date(Math.max(Date.now(), Date.parse(cur.updatedAt || "0") + 1)).toISOString();
    const saved = { ...next, updatedAt: stamp };
    const r = await db.seoReport.updateMany({ where: { id, businessId, kind: KIND, data: { path: ["updatedAt"], equals: cur.updatedAt } }, data: { data: json(saved) } });
    if (r.count === 1) return saved;
  }
  return null;
}

async function fixById(businessId: string, id: string): Promise<FixView | null> {
  if (!id) return null;
  const row = await db.seoReport.findFirst({ where: { id, businessId, kind: "webfix" }, select: { data: true } });
  const job = row ? readJob(row.data) : null;
  return job ? { ...job, id } : null;
}

// ---------- El reporte de posiciones de la zona principal (como RankPanel) ----------

export async function mainRankReport(businessId: string): Promise<RankReport | null> {
  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, seoKeywords: true } });
  if (!b) return null;
  const setup = rankSetup(b);
  if (!setup.ok) return null;
  const saved = await latestReports(businessId, "rank", 10 * setup.zones.length);
  const parsed = saved.map((r) => readRankReport(r.data));
  return groupByZone(parsed, setup.zones).get(setup.zones[0].code)?.[0] ?? null;
}

/** Las búsquedas que cubren las instrucciones de posiciones (rankItems): no sales, lejos, o la página es de otra cosa. */
export function searchesToWork(report: Pick<RankReport, "rows"> | null) {
  return (report?.rows ?? []).filter((r) => !r.error && coversSearch(rowAdvice(r).verdict, rowAdvice(r).mismatch)).slice(0, MAX_SEARCHES);
}

// ---------- El plan (gratis) ----------

export type PlanData = {
  rows: PlanRow[];
  prices: Prices;
  /** Letras de las instrucciones de cada mejora (para estimar el arreglo de la web en el navegador). */
  improveChars: Record<string, number>;
  defaults: string[];
};

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const sameTopic = (a: string, b: string) => fold(a) === fold(b) || coveredBy(a, b) || coveredBy(b, a);

async function pricesFor(b: { aiText: string; aiImage: string }): Promise<Prices> {
  return {
    serpCents: WRITER_SERP_COST * 100,
    writeCents: writeAiCents(pickText(b.aiText)),
    textCents: SITE_TEXT_CENTS,
    imageCents: imagesEnabled() ? aiImageCents(pickImage(b.aiImage)) : 0,
    fileBudget: PICK_DEFAULTS.budget,
  };
}

const LIB_WHERE = (businessId: string) => ({ businessId, kind: "photo", status: "ready", NOT: { choice: "skip" }, url: { not: "" } });

/** El plan para las búsquedas de la zona principal. null si no hay posiciones revisadas. */
export async function loadPlan(businessId: string, lang: "es" | "en", given?: RankReport | null): Promise<PlanData | null> {
  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true, aiText: true, aiImage: true } });
  if (!b) return null;
  const report = given === undefined ? await mainRankReport(businessId) : given;
  if (!report) return null;
  const work = searchesToWork(report);
  const prices = await pricesFor(b);
  if (!work.length) return { rows: [], prices, improveChars: {}, defaults: [] };

  const [[auditRow], [onpageRow], articleRows, library, webfix, ctx] = await Promise.all([
    latestReports(businessId, "audit", 1),
    latestReports(businessId, "onpage", 1),
    latestReports(businessId, "article", MAX_ARTICLES),
    db.libraryItem.findMany({ where: LIB_WHERE(businessId), select: LIB_SELECT }) as Promise<PhotoItem[]>,
    loadWebFixState(businessId),
    loadPromptContext(businessId),
  ]);
  const domain = siteDomain(b.website);
  const audit = auditRow ? readAuditReport(auditRow.data) : null;
  const onpage = onpageRow ? readOnPageReport(onpageRow.data) : null;
  // Las páginas del sitio: títulos y H1 (auditoría, «Mejora tus páginas», posiciones) y las palabras de su dirección.
  const pages: { text: string; label: string; url: string }[] = siteTexts({ audit, onpage, rank: [report], domain: b.website }).map((x) => ({ text: x.text, label: x.label, url: x.url ?? "" }));
  for (const p of audit?.pages ?? []) {
    const url = p.finalUrl || p.url;
    const path = urlPath(url);
    if (path && !p.error && (!p.status || p.status < 400)) pages.push({ text: path.replace(/[/_.-]+/g, " "), label: p.title || p.h1 || path, url });
  }
  const ownPage = (url: string) => Boolean(urlPath(url)) && (!domain || domainMatches(safeHost(url), domain));
  const articles = articleRows.flatMap((r) => {
    const a = readArticleReport(r.data);
    if (!a) return [];
    const site = readArticleSite(a.site);
    return [{ id: r.id, report: a, published: site.published }];
  });

  const facts: SearchFacts[] = work.map((row) => {
    const advice = rowAdvice(row);
    const covers = (t: string) => Boolean(t) && (fold(t) === fold(row.keyword) || coveredBy(row.keyword, t));
    const page = pages.find((p) => ownPage(p.url) && covers(p.text));
    const matching = articles.filter((a) => covers(a.report.keyword) || covers(a.report.draft.title) || covers(a.report.draft.h1));
    const art = matching.find((a) => a.published) ?? matching[0];
    const ranked = rankArticlePhotos(library, { text: row.keyword, keywords: [row.keyword] });
    return {
      keyword: row.keyword,
      position: row.position,
      mapPosition: row.localPack?.position ?? null,
      mismatch: advice.mismatch,
      rankingUrl: row.url,
      rankingIsHome: Boolean(row.url) && !urlPath(row.url ?? ""),
      rankingLabel: rankedPageName(row),
      sitePage: page ? { url: page.url, label: page.label.slice(0, 120) } : null,
      article: art ? { id: art.id, title: art.report.draft.title || art.report.keyword, publishedUrl: art.published?.url ?? "", publishedAt: art.published?.at ?? "" } : null,
      photoFits: ranked.length > 0 && !needsAiPick(ranked),
    };
  });
  const rows = buildPlan(facts, {
    fixOpen: webfix.open,
    fixUrls: webfix.job?.source.urls ?? [],
    fixHref: fixHref(businessId),
    fixReady: webfix.connected && webfix.aiReady,
    writerHref: (id) => writerHref(businessId, id),
    now: new Date(),
    sameTopic,
  });
  const improveChars: Record<string, number> = {};
  if (ctx) for (const r of rows) if (r.action === "improve") improveChars[r.key] = improvePrompt(ctx, [{ keyword: r.keyword, position: r.position, url: r.targetUrl }], lang).length;
  return { rows, prices, improveChars, defaults: defaultSelection(rows) };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// ---------- Lo que necesita la pantalla ----------

export type RankFixState = {
  /** La web está conectada (Conexiones → Sitio web, con repositorio y llave). */
  connected: boolean;
  ai: boolean;
  /** Búsquedas donde no sales o sales lejos (si es 0 no se muestra nada). */
  searches: number;
  plan: PlanData | null;
  job: RankFixView | null;
  fix: FixView | null;
};

export async function loadRankFixState(businessId: string, lang: "es" | "en", report: RankReport | null): Promise<RankFixState> {
  const [webfix, conn, last] = await Promise.all([loadWebFixState(businessId), siteConnection(businessId).catch(() => null), latestJob(businessId).catch(() => null)]);
  const connected = webfix.connected && Boolean(conn);
  const ai = aiEnabled();
  const searches = searchesToWork(report).length;
  const job = last && last.job.status !== "closed" ? view(last.id, last.job) : null;
  const fix = job?.fix.id ? await fixById(businessId, job.fix.id) : null;
  const plan = connected && ai && searches && (!job || !jobOpen(job)) ? await loadPlan(businessId, lang, report) : null;
  return { connected, ai, searches, plan, job, fix };
}

// ---------- Autorizar ----------

export type Outcome = { ok: boolean; message: Bi; job: RankFixView | null; fix: FixView | null };

/**
 * «Autorizar · hasta US$X.XX»: vuelve a armar el plan (por si algo cambió), revisa que el costo no subió, guarda el
 * trabajo, empieza el arreglo de la web (si hay páginas que mejorar) y los artículos después de responder.
 */
export async function authorizeRankFix(businessId: string, keys: string[], shownCents: number, lang: "es" | "en"): Promise<Outcome> {
  const [webfix, conn] = await Promise.all([loadWebFixState(businessId), siteConnection(businessId)]);
  if (!webfix.connected || !conn) throw bi("Primero conecta tu página web en Conexiones → Sitio web.", "First connect your website in Connections → Website.");
  if (!aiEnabled()) throw bi("Falta la clave de la IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en el servidor.", "The AI key (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY) is missing on the server.");
  const last = await latestJob(businessId);
  if (last && jobOpen(last.job)) throw bi("Ya hay una ronda en marcha. Revísala abajo.", "There's already a round in progress. Check it below.");
  const plan = await loadPlan(businessId, lang);
  if (!plan || !plan.rows.length) throw bi("No hay búsquedas para mejorar. Revisa tus posiciones otra vez.", "There are no searches to improve. Check your rankings again.");
  const sel = checkSelection(plan.rows, keys.map(String).slice(0, 40));
  if (!sel.ok) throw bi(sel.error.es, sel.error.en);
  const totals = planTotals(plan.rows, sel.keys, plan.prices, plan.improveChars);
  if (!Number.isFinite(shownCents) || totals.totalCents > Math.round(shownCents))
    throw bi(`El costo cambió desde que lo viste (ahora hasta ${usd(totals.totalCents)}). Revisa el plan otra vez.`, `The cost changed since you saw it (now up to ${usd(totals.totalCents)}). Check the plan again.`);

  const now = new Date();
  let job = newRankFixJob({ rows: plan.rows, keys: sel.keys, prices: plan.prices, totals, lang, now });
  const row = await saveReport(businessId, KIND, json(job));
  const improves = job.items.filter((x) => x.action === "improve");
  let fix: FixView | null = null;
  if (improves.length) {
    try {
      const ctx = (await loadPromptContext(businessId)) as PromptContext;
      const instructions = improvePrompt(ctx, improves.map((x) => ({ keyword: x.keyword, position: x.position, url: x.targetUrl })), lang);
      fix = await startWebFix(businessId, { source: { kind: "prompt", title: FIX_TITLE, issueIds: [], urls: improves.map((x) => x.targetUrl) }, instructions });
      const started = fix;
      job = { ...job, spentCents: job.spentCents + started.estimateCents, fix: { ...job.fix, id: started.id, estimateCents: started.estimateCents, state: "started" } };
    } catch (e) {
      const open = (await loadWebFixState(businessId)).open;
      const error: Bi = open ? { es: "Primero revisa los arreglos que ya están esperando.", en: "First review the fixes that are already waiting." } : errBi(e);
      job = {
        ...job,
        fix: { ...job.fix, state: open ? "blocked" : "failed", note: error },
        items: job.items.map((x) => (x.action === "improve" ? { ...x, state: open ? "fix_blocked" : "fix_failed", error } : x)),
      };
    }
  }
  job = settle(job, now);
  await db.seoReport.update({ where: { id: row.id }, data: { data: json(job) } });
  const writes = job.items.filter((x) => x.action === "write").length;
  await logAiAction({
    businessId,
    kind: "rank.fix.planned",
    actor: "approved",
    costCents: 0,
    summary: {
      es: `Autorizaste que la IA prepare ${writes} ${writes === 1 ? "artículo" : "artículos"} y mejore ${improves.length} ${improves.length === 1 ? "página" : "páginas"} (hasta ${usd(job.authorizedCents)}).`,
      en: `You approved the AI to prepare ${writes} ${writes === 1 ? "article" : "articles"} and improve ${improves.length} ${improves.length === 1 ? "page" : "pages"} (up to ${usd(job.authorizedCents)}).`,
    },
    detail: json({ reportId: row.id, authorizedCents: job.authorizedCents, keywords: job.items.map((x) => ({ keyword: x.keyword, action: x.action })), webfix: job.fix.id }),
  });
  if (job.status === "preparing") after(() => runRankFix(businessId, row.id));
  return {
    ok: true,
    message: { es: "Listo: la IA está preparando todo. Nada se publica hasta que tú lo revises.", en: "Done: the AI is preparing everything. Nothing is published until you review it." },
    job: view(row.id, job),
    fix,
  };
}

// ---------- El trabajo (después de responder) ----------

const WRITER_FIELDS = {
  name: true,
  website: true,
  phone: true,
  aiProfile: true,
  aiText: true,
  aiImage: true,
  brandVoice: true,
  study: true,
  seoLanguage: true,
  seoLocations: true,
  seoLocationCode: true,
  seoLocationName: true,
} as const;

/** Lo mismo que «Escribir artículo» (actions-seo-writer.ts → writeArticle), sin formulario: Google, metas, IA y puntaje. */
async function writeArticleFor(businessId: string, keyword: string): Promise<{ id: string; title: string; social: string; serpCents: number; score: number }> {
  const b = await db.business.findUnique({ where: { id: businessId }, select: WRITER_FIELDS });
  if (!b) throw bi("Negocio no encontrado.", "Business not found.");
  const zone = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName)[0];
  if (!zone) throw bi("Primero elige tu zona de Google en la pestaña «⚙ Ajustes».", "First pick your Google area in the “⚙ Settings” tab.");
  const language: WriterLang = b.seoLanguage === "en" ? "en" : "es";
  const research = await researchKeyword(keyword, zone, language);
  if (!research.organic.length) throw bi("Google no devolvió resultados para esa búsqueda en tu zona.", "Google returned no results for that search in your area.");
  const targets = contentTargets(research);
  const brief = briefFor(research, targets, zone.name);
  const draft = cleanDraft(await writeSeoArticle({ business: b, keyword, language, brief }));
  const { score, checklist } = scoreDraft(draft, keyword, targets, { phone: b.phone, website: b.website });
  const report: ArticleReport = {
    version: 1,
    keyword,
    language,
    zone: { code: zone.code, name: zone.name },
    research,
    targets,
    draft,
    score,
    checklist,
    cost: research.cost,
    provider: pickText(b.aiText) ?? "",
    createdAt: new Date().toISOString(),
  };
  const saved = await db.seoReport.create({ data: { businessId, kind: "article", data: json(report) } });
  const old = await db.seoReport.findMany({ where: { businessId, kind: "article" }, orderBy: { createdAt: "desc" }, skip: MAX_ARTICLES, select: { id: true } });
  if (old.length) await db.seoReport.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  return { id: saved.id, title: draft.title || draft.h1 || keyword, social: draft.socialPost.slice(0, 1500), serpCents: research.cost * 100, score };
}

async function loadArticle(businessId: string, articleId: string) {
  const row = await db.seoReport.findFirst({ where: { id: articleId, businessId, kind: "article" }, select: { id: true, data: true, createdAt: true } });
  const report = row ? readArticleReport(row.data) : null;
  if (!row || !report) return null;
  const site = readArticleSite(report.site);
  const fresh = site.prepared && site.prepared.draftAt === draftVersion(report) ? site.prepared : null;
  return { row, report, site, prepared: fresh };
}

/** Si un paso se cortó después de guardar el artículo: el artículo de esa búsqueda escrito después de autorizar. */
async function adoptableArticle(businessId: string, job: RankFixJob, keyword: string): Promise<{ id: string; report: ArticleReport } | null> {
  const used = new Set(job.items.map((x) => x.articleId).filter(Boolean));
  const rows = await db.seoReport.findMany({ where: { businessId, kind: "article", createdAt: { gte: new Date(job.createdAt) } }, orderBy: { createdAt: "asc" }, select: { id: true, data: true } });
  for (const r of rows) {
    const a = readArticleReport(r.data);
    if (a && !used.has(r.id) && fold(a.keyword) === fold(keyword)) return { id: r.id, report: a };
  }
  return null;
}

const photoInfo = (p: SitePrepared) => ({
  photoKind: p.photo.kind,
  thumb: p.photo.kind === "library" ? p.photo.thumb : p.photo.kind === "generated" || p.photo.kind === "current" ? p.photo.url : "",
});

/**
 * Un paso de un artículo. Primero mira (gratis) si ya está hecho — así un corte nunca repite un gasto —, después
 * revisa que alcance lo autorizado, aparta el costo, lo guarda, y recién entonces llama a Google o a la IA.
 */
async function runStep(businessId: string, id: string, job: RankFixJob, index: number, step: WriteStep, prices: Prices): Promise<"ok" | "stop"> {
  const item = job.items[index];
  const now = () => new Date();
  const save = (fn: (j: RankFixJob) => RankFixJob) => mutate(businessId, id, fn);
  const spend = async (cents: number) => {
    if (!canAfford(job, cents)) {
      await save((j) => stopForBudget(j, index, now()));
      return false;
    }
    await save((j) => beginStep(j, index, step, cents, now()));
    return true;
  };
  try {
    if (step === "write") {
      const adopt = await adoptableArticle(businessId, job, item.keyword);
      if (adopt) {
        await save((j) => endStep(j, index, "write", { articleId: adopt.id, title: adopt.report.draft.title || item.keyword, social: adopt.report.draft.socialPost.slice(0, 1500) }, now()));
        return "ok";
      }
      const reserved = stepCents("write", prices, false);
      if (!(await spend(reserved))) return "stop";
      const r = await writeArticleFor(businessId, item.keyword);
      const actual = r.serpCents + prices.writeCents;
      await save((j) => endStep(j, index, "write", { articleId: r.id, title: r.title, social: r.social }, now(), { reserved, actual }));
      await logAiAction({
        businessId,
        kind: "article.written",
        actor: "approved",
        costCents: actual,
        summary: { es: `La IA escribió el artículo «${r.title}» para la búsqueda «${item.keyword}» (${r.score}/100).`, en: `The AI wrote the article “${r.title}” for the search “${item.keyword}” (${r.score}/100).` },
        detail: json({ reportId: r.id, keyword: item.keyword, rankfix: id, score: r.score }),
      });
      return "ok";
    }
    const art = await loadArticle(businessId, item.articleId);
    if (!art) {
      await save((j) => failItem(j, index, { es: "El artículo ya no existe (lo borraron en «Escribir artículo»).", en: "The article no longer exists (it was deleted in “Write article”)." }, now()));
      return "ok";
    }
    if (step === "site") {
      if (art.prepared || art.site.published) {
        const p = art.prepared;
        await save((j) => endStep(j, index, "site", p ? photoInfo(p) : {}, now()));
        return "ok";
      }
      const reserved = stepCents("site", prices, false);
      if (!(await spend(reserved))) return "stop";
      const p = await prepareForSite(businessId, item.articleId);
      await save((j) => endStep(j, index, "site", photoInfo(p), now(), { reserved, actual: reserved }));
      return "ok";
    }
    // La foto: de la biblioteca si va con el tema (ya elegida al preparar); si no, la IA la crea (estaba en lo autorizado).
    const p = art.prepared;
    if (!p || p.photo.kind !== "generate") {
      await save((j) => endStep(j, index, "photo", p ? photoInfo(p) : {}, now()));
      return "ok";
    }
    const cents = prices.imageCents;
    if (cents <= 0) {
      const next = await chooseSitePhoto(businessId, item.articleId, "stock");
      await save((j) => endStep(j, index, "photo", photoInfo(next), now()));
      return "ok";
    }
    if (!(await spend(cents))) return "stop";
    const next = await generateSitePhoto(businessId, item.articleId, cents);
    await save((j) => endStep(j, index, "photo", photoInfo(next), now(), { reserved: cents, actual: cents }));
    return "ok";
  } catch (e) {
    if (!(e instanceof BiError)) console.error("rankfix", step, e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300));
    await save((j) => failItem(j, index, errBi(e), now()));
    return "ok";
  }
}

/** Prepara los artículos uno por uno, dentro del tiempo de esta llamada. Lo que no alcanza sigue en la próxima consulta. */
export async function runRankFix(businessId: string, id: string): Promise<void> {
  const startedAt = Date.now();
  const claimed = await mutate(businessId, id, (j) => {
    const now = new Date();
    if (j.status !== "preparing" || leaseActive(j, now)) return null;
    return takeLease(resumeJob(j, now).job, now);
  });
  if (!claimed) return;
  const b = await db.business.findUnique({ where: { id: businessId }, select: { aiText: true, aiImage: true } });
  if (!b) return;
  const prices = await pricesFor(b);
  for (let guard = 0; guard < 40; guard++) {
    const job = await jobById(businessId, id);
    if (!job || job.status !== "preparing") return;
    const w = nextWork(job);
    if (!w) {
      await mutate(businessId, id, (j) => settle(j, new Date()));
      return;
    }
    if (Date.now() - startedAt + STEP_MS[w.step] > RUN_BUDGET_MS) {
      await mutate(businessId, id, (j) => dropLease(j, new Date()));
      return;
    }
    if ((await runStep(businessId, id, job, w.index, w.step, prices)) === "stop") return;
  }
  await mutate(businessId, id, (j) => dropLease(j, new Date()));
}

/** Para el panel: lo último guardado. Si se estaba preparando y nadie lo está trabajando, sigue (después de responder). */
export async function pollRankFix(businessId: string, id: string): Promise<{ job: RankFixView | null; fix: FixView | null }> {
  const job = await jobById(businessId, id);
  if (!job) return { job: null, fix: null };
  if (job.status === "preparing" && !leaseActive(job, new Date())) after(() => runRankFix(businessId, id));
  return { job: view(id, job), fix: await fixById(businessId, job.fix.id) };
}

// ---------- Revisar ----------

export async function removeRankFixItem(businessId: string, id: string, key: string): Promise<RankFixView | null> {
  const next = await mutate(businessId, id, (j) => {
    const r = removeItem(j, key, new Date());
    return r === j ? null : r;
  });
  const job = next ?? (await jobById(businessId, id));
  return job ? view(id, job) : null;
}

/** Paró antes de la foto con IA: usar la foto del tema que ya tiene la web (gratis) y dejarlo listo. */
export async function stockPhotoRankFixItem(businessId: string, id: string, key: string): Promise<RankFixView | null> {
  const job = await jobById(businessId, id);
  const item = job?.items.find((x) => x.key === key);
  if (!job || !item || item.state !== "stopped" || item.next !== "photo" || !item.articleId) return job ? view(id, job) : null;
  await chooseSitePhoto(businessId, item.articleId, "stock");
  const next = await mutate(businessId, id, (j) => {
    const r = stockPhoto(j, key, new Date());
    return r === j ? null : r;
  });
  return view(id, next ?? job);
}

export async function closeRankFix(businessId: string, id: string): Promise<boolean> {
  const next = await mutate(businessId, id, (j) => (j.status === "ready" || j.status === "done" ? { ...j, status: "closed" } : null));
  return Boolean(next);
}

// ---------- Publicar todo ----------

async function publishedUrlOf(businessId: string, articleId: string): Promise<string> {
  const art = await loadArticle(businessId, articleId).catch(() => null);
  return art?.site.published?.url ?? "";
}

/**
 * «Publicar todo»: los artículos listos, uno por uno (cada uno vuelve a leer articles.json; approveForSite nunca
 * publica dos veces), y el arreglo de la web solo si su vista previa salió bien y se puede unir sin conflictos.
 */
export async function publishRankFix(businessId: string, id: string): Promise<Outcome> {
  const claimed = await mutate(businessId, id, (j) => {
    const now = new Date();
    if (j.status !== "ready" || !hasWorkToPublish(j)) return null;
    return takeLease({ ...j, status: "publishing" }, now);
  });
  if (!claimed) {
    const job = await jobById(businessId, id);
    return { ok: false, message: { es: "No hay nada listo para publicar (o ya se está publicando).", en: "There's nothing ready to publish (or it's already being published)." }, job: job ? view(id, job) : null, fix: job ? await fixById(businessId, job.fix.id) : null };
  }
  let published = 0;
  let failed = 0;
  let fixNote: Bi | null = null;
  try {
    for (const it of toPublish(claimed)) {
      const cur = await jobById(businessId, id);
      const x = cur?.items.find((k) => k.key === it.key);
      if (!x || (x.state !== "ready" && x.state !== "publish_failed")) continue;
      try {
        // El costo de la foto ya se pagó al preparar: aquí publicar es gratis (si alguien cambió la foto, se rechaza).
        const r = await approveForSite(businessId, x.articleId, 0);
        await mutate(businessId, id, (j) => markPublished(j, x.key, r.url, new Date()));
        published++;
      } catch (e) {
        const url = await publishedUrlOf(businessId, x.articleId);
        if (url) {
          await mutate(businessId, id, (j) => markPublished(j, x.key, url, new Date()));
          published++;
        } else {
          await mutate(businessId, id, (j) => markPublishFailed(j, x.key, errBi(e), new Date()));
          failed++;
        }
      }
    }
    if (claimed.fix.state === "started" && claimed.items.some((x) => x.state === "fix")) {
      const fx = (await refreshWebFix(businessId, claimed.fix.id).catch(() => null)) ?? (await fixById(businessId, claimed.fix.id));
      let outcome: "published" | "waiting" | "failed";
      if (!fx) {
        outcome = "failed";
        fixNote = { es: "Ya no encontramos los cambios de tus páginas.", en: "We can no longer find your page changes." };
      } else if (fx.status === "published") outcome = "published";
      else if (fx.status === "open" && canPublish(fx)) {
        const r = await publishWebFix(businessId, fx.id);
        outcome = r.ok ? "published" : "waiting";
        if (!r.ok) fixNote = r.message;
      } else if (fx.status === "open" || fx.status === "preparing") {
        outcome = "waiting";
        fixNote =
          fx.build === "failure"
            ? { es: "La vista previa de los cambios de tus páginas falló: revísalos en «Tu página web».", en: "The preview of your page changes failed: check them in “Your website”." }
            : { es: "Los cambios de tus páginas esperan su vista previa. Cuando esté lista, presiona «Publicar lo que falta».", en: "Your page changes are waiting for their preview. Once it's ready, press “Publish what's left”." };
      } else {
        outcome = "failed";
        fixNote = fx.error ?? (fx.status === "nothing" ? { es: "La IA no encontró cambios seguros para tus páginas.", en: "The AI found no safe changes for your pages." } : { es: "Los cambios de tus páginas ya no están abiertos.", en: "Your page changes are no longer open." });
      }
      if (outcome === "published") published++;
      await mutate(businessId, id, (j) => applyFixOutcome(j, outcome, fixNote, new Date()));
    }
  } finally {
    await mutate(businessId, id, (j) => finishPublish(j, new Date()));
  }
  const job = await jobById(businessId, id);
  if (published)
    await logAiAction({
      businessId,
      kind: "rank.fix.published",
      actor: "approved",
      costCents: 0,
      summary: {
        es: `Publicaste lo que preparó la IA para tus posiciones (${published} ${published === 1 ? "cosa" : "cosas"}; costo total ${usd(job?.spentCents ?? 0)}).`,
        en: `You published what the AI prepared for your rankings (${published} ${published === 1 ? "item" : "items"}; total cost ${usd(job?.spentCents ?? 0)}).`,
      },
      detail: json({ reportId: id, spentCents: job?.spentCents ?? 0, published: job?.items.filter((x) => x.state === "published").map((x) => ({ keyword: x.keyword, url: x.url })) ?? [] }),
    });
  const message: Bi =
    failed && !published
      ? { es: "No se pudo publicar. Mira el detalle de cada búsqueda.", en: "Nothing could be published. See each search for details." }
      : failed || fixNote
        ? { es: "Publicamos lo que estaba listo. Mira el detalle de lo que falta.", en: "We published what was ready. See the details of what's left." }
        : { es: "Listo. Google tarda unos días en notarlo; vuelve a revisar tus posiciones en 1–2 semanas.", en: "Done. Google takes a few days to notice; check your rankings again in 1–2 weeks." };
  return { ok: published > 0 && !failed, message, job: job ? view(id, job) : null, fix: job ? await fixById(businessId, job.fix.id) : null };
}
