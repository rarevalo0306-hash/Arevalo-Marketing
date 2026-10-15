// «Qué hizo tu competencia» (como «EyeOn» de Semrush): cada semana (si el dueño lo enciende) revisa hasta 3
// competidores y avisa por email lo nuevo: búsquedas por las que empezaron a salir, páginas nuevas, si sus visitas de
// Google subieron o bajaron y si lanzaron anuncios. Con DataForSEO, en el país de la zona principal:
// domain_rank_overview (visitas y búsquedas), ranked_keywords (sus 50 búsquedas más buscadas), relevant_pages (sus 30
// páginas con más visitas) y google/ads_search (sus anuncios de los últimos 7 días). ≈ US$0.05 por competidor.
// Lo nuevo se sabe comparando con la revisión anterior (la primera solo deja la base). Lo puro se prueba en
// tests/seo-watch.test.ts.
import { db } from "@/lib/db";
import { bi, type UiLang } from "@/lib/i18n";
import { dfsTime, parseTransparency } from "@/lib/seo/ads-research";
import { type BiText, isDirectory, normalizeDomain, parseRankedKeywords, readCompetitorsReport, resolveLocation, sameSite, withoutDirectories } from "@/lib/seo/competitors";
import { dataForSeoEnabled, dfsPost, readZones, type Zone } from "@/lib/seo/dataforseo";
import { LABS_ITEM_COST, LABS_TASK_COST } from "@/lib/seo/labs";
import { parseDomainOverview } from "@/lib/seo/lookup";

export const WATCH_KIND = "watch";
export const WATCH_CONFIG_KIND = "watch-config";
const WATCH_RUN_MARK = "watch-run";
export const WATCH_MAX = 3;
export const WATCH_KEYWORDS = 50;
export const WATCH_PAGES = 30;
const DAY = 86_400_000;

/** Lo máximo que cuesta revisar `n` competidores (3 llamadas de Labs y una de anuncios por competidor). */
export function watchCostEstimate(n: number): number {
  const k = Math.max(1, Math.min(WATCH_MAX, n));
  return Math.ceil(Math.round(k * (3 * LABS_TASK_COST + (1 + WATCH_KEYWORDS + WATCH_PAGES) * LABS_ITEM_COST + 0.002) * 1e6) / 1e3) / 1000;
}

export type WatchConfig = { enabled: boolean; domains: string[]; updatedAt: string };

/** Lo que se guarda de cada competidor (para comparar la próxima vez). */
export type WatchSnapshot = {
  domain: string;
  traffic: number | null;
  keywordsCount: number | null;
  paidKeywords: number | null;
  /** Sus búsquedas más buscadas donde sale (con su lugar). */
  keywords: { keyword: string; position: number; volume: number | null }[];
  pages: string[];
  /** Anuncios con fecha en los últimos 7 días y los que empezaron esta semana. */
  adsRunning: number | null;
  adsNew: number | null;
  ok: boolean;
};

export type WatchChange =
  | { kind: "new-keywords"; keywords: { keyword: string; position: number; volume: number | null }[] }
  | { kind: "new-pages"; pages: string[] }
  | { kind: "traffic"; from: number; to: number; pct: number }
  | { kind: "ads"; running: number; started: number }
  | { kind: "paid"; from: number; to: number };

export type WatchCompetitor = WatchSnapshot & { changes: WatchChange[]; first: boolean };

export type WatchReport = { country: string; competitors: WatchCompetitor[]; auto: boolean; notes: BiText[]; cost: number; createdAt: string };

// ---------- Puros ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** relevant_pages: items[].page_address (sin dominio, sin «?», sin «/» final). */
export function parsePages(result: unknown[]): string[] {
  const out: string[] = [];
  for (const raw of arr(obj(result[0]).items)) {
    const addr = str(obj(raw).page_address).trim();
    if (!addr) continue;
    let path = addr.replace(/^[a-z]+:\/\/[^/]+/i, "").split(/[?#]/)[0] || "/";
    if (path.length > 1) path = path.replace(/\/+$/, "");
    if (!out.includes(path)) out.push(path.slice(0, 200));
  }
  return out;
}

/**
 * Lo que cambió desde la revisión anterior: búsquedas nuevas en sus primeros 20 (y que antes no tenía), páginas nuevas,
 * visitas de Google (si cambiaron 20 % o más, con al menos 50 visitas), anuncios nuevos y búsquedas pagadas.
 */
export function watchChanges(cur: WatchSnapshot, prev: WatchSnapshot | null): WatchChange[] {
  if (!prev || !prev.ok || !cur.ok) return [];
  const out: WatchChange[] = [];
  const before = new Set(prev.keywords.map((k) => k.keyword));
  const fresh = cur.keywords.filter((k) => !before.has(k.keyword) && k.position <= 20).slice(0, 8);
  // Si la lista anterior estaba vacía (no se pudo leer), no se cuenta todo como nuevo.
  if (fresh.length && prev.keywords.length) out.push({ kind: "new-keywords", keywords: fresh });
  const oldPages = new Set(prev.pages);
  const pages = cur.pages.filter((p) => !oldPages.has(p)).slice(0, 8);
  if (pages.length && prev.pages.length) out.push({ kind: "new-pages", pages });
  if (cur.traffic !== null && prev.traffic !== null && Math.max(cur.traffic, prev.traffic) >= 50 && prev.traffic > 0) {
    const pct = Math.round(((cur.traffic - prev.traffic) / prev.traffic) * 100);
    if (Math.abs(pct) >= 20) out.push({ kind: "traffic", from: Math.round(prev.traffic), to: Math.round(cur.traffic), pct });
  }
  if ((cur.adsNew ?? 0) > 0) out.push({ kind: "ads", running: cur.adsRunning ?? 0, started: cur.adsNew ?? 0 });
  if (cur.paidKeywords !== null && prev.paidKeywords !== null && cur.paidKeywords !== prev.paidKeywords && Math.abs(cur.paidKeywords - prev.paidKeywords) >= 5)
    out.push({ kind: "paid", from: prev.paidKeywords, to: cur.paidKeywords });
  return out;
}

/** El cambio en palabras simples. */
export function changeText(c: WatchChange, lang: UiLang): string {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const n = (v: number) => new Intl.NumberFormat(lang === "en" ? "en-US" : "es").format(v);
  switch (c.kind) {
    case "new-keywords":
      return t(
        `Empezó a salir en ${c.keywords.length} ${c.keywords.length === 1 ? "búsqueda nueva" : "búsquedas nuevas"}: ${c.keywords.map((k) => `«${k.keyword}» (#${k.position})`).join(", ")}.`,
        `Started ranking for ${c.keywords.length} new ${c.keywords.length === 1 ? "search" : "searches"}: ${c.keywords.map((k) => `“${k.keyword}” (#${k.position})`).join(", ")}.`,
      );
    case "new-pages":
      return t(`Tiene ${c.pages.length} ${c.pages.length === 1 ? "página nueva" : "páginas nuevas"} con visitas: ${c.pages.join(", ")}.`, `Has ${c.pages.length} new ${c.pages.length === 1 ? "page" : "pages"} getting visits: ${c.pages.join(", ")}.`);
    case "traffic":
      return c.pct > 0
        ? t(`Sus visitas de Google subieron ${c.pct} % (de ${n(c.from)} a ${n(c.to)} al mes).`, `Its Google visits went up ${c.pct}% (from ${n(c.from)} to ${n(c.to)} a month).`)
        : t(`Sus visitas de Google bajaron ${Math.abs(c.pct)} % (de ${n(c.from)} a ${n(c.to)} al mes).`, `Its Google visits went down ${Math.abs(c.pct)}% (from ${n(c.from)} to ${n(c.to)} a month).`);
    case "ads":
      return t(`Lanzó ${c.started} ${c.started === 1 ? "anuncio nuevo" : "anuncios nuevos"} en Google esta semana (${c.running} activos).`, `Launched ${c.started} new Google ${c.started === 1 ? "ad" : "ads"} this week (${c.running} active).`);
    case "paid":
      return c.to > c.from
        ? t(`Ahora paga anuncios en más búsquedas: de ${n(c.from)} a ${n(c.to)}.`, `Now pays for ads on more searches: from ${n(c.from)} to ${n(c.to)}.`)
        : t(`Paga anuncios en menos búsquedas: de ${n(c.from)} a ${n(c.to)}.`, `Pays for ads on fewer searches: from ${n(c.from)} to ${n(c.to)}.`);
  }
}

/** ¿Ya toca la revisión de la semana? (más de 7 días menos unas horas desde la última). */
export const watchIsDue = (lastMs: number, nowMs: number) => nowMs - lastMs > 7 * DAY - 6 * 3600_000;

export function readWatchConfig(json: unknown): WatchConfig {
  const r = obj(json);
  return {
    enabled: r.enabled === true,
    domains: arr(r.domains)
      .map((d) => normalizeDomain(str(d)))
      .filter((d): d is string => !!d)
      .slice(0, WATCH_MAX),
    updatedAt: str(r.updatedAt),
  };
}

const readSnapshot = (v: unknown): WatchSnapshot => {
  const s = obj(v);
  return {
    domain: str(s.domain),
    traffic: num(s.traffic),
    keywordsCount: num(s.keywordsCount),
    paidKeywords: num(s.paidKeywords),
    keywords: arr(s.keywords)
      .map(obj)
      .map((k) => ({ keyword: str(k.keyword), position: num(k.position) ?? 0, volume: num(k.volume) }))
      .filter((k) => k.keyword)
      .slice(0, WATCH_KEYWORDS),
    pages: arr(s.pages)
      .map((p) => str(p))
      .filter((p) => p.startsWith("/"))
      .slice(0, WATCH_PAGES),
    adsRunning: num(s.adsRunning),
    adsNew: num(s.adsNew),
    ok: s.ok === true,
  };
};

const CHANGE_KINDS = ["new-keywords", "new-pages", "traffic", "ads", "paid"];

/** Lee una revisión guardada sin confiar en su forma; null si no es válida. */
export function readWatchReport(json: unknown): WatchReport | null {
  const r = obj(json);
  if (!Array.isArray(r.competitors) || !str(r.createdAt)) return null;
  return {
    country: str(r.country),
    competitors: arr(r.competitors)
      .map((c) => ({ ...readSnapshot(c), changes: arr(obj(c).changes).filter((x) => CHANGE_KINDS.includes(str(obj(x).kind))) as WatchChange[], first: obj(c).first === true }))
      .filter((c) => c.domain)
      .slice(0, WATCH_MAX),
    auto: r.auto === true,
    notes: arr(r.notes)
      .map(obj)
      .filter((n) => typeof n.es === "string" && typeof n.en === "string")
      .map((n) => ({ es: n.es as string, en: n.en as string })),
    cost: num(r.cost) ?? 0,
    createdAt: str(r.createdAt),
  };
}

/** Los competidores a vigilar: los que eligió el dueño o, si no eligió, los 3 primeros de su reporte de competencia. */
export function watchDomains(config: WatchConfig, competitors: string[], self: string | null): string[] {
  const own = self ? normalizeDomain(self) : null;
  const out: string[] = [];
  for (const raw of config.domains.length ? config.domains : competitors) {
    const d = normalizeDomain(raw);
    if (!d || (own && sameSite(d, own)) || isDirectory(d) || out.some((x) => sameSite(x, d))) continue;
    out.push(d);
    if (out.length >= WATCH_MAX) break;
  }
  return out;
}

// ---------- Llamadas ----------

/** Revisa a cada competidor y lo compara con la revisión anterior. */
export async function runWatch(input: { domains: string[]; zone: Zone; language: string; previous: WatchReport | null; auto: boolean; now?: Date }): Promise<WatchReport> {
  if (!input.domains.length) throw bi("Todavía no sabemos quién es tu competencia: búscala primero en «Tu competencia en Google».", "We don't know your competitors yet: look them up first in “Your competition on Google”.");
  const now = input.now ?? new Date();
  const loc = await resolveLocation(input.zone.code, input.zone.name, input.language);
  const base = { location_code: loc.countryCode, language_code: loc.language };
  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const notes: BiText[] = [];
  let cost = 0;
  const competitors = await Promise.all(
    input.domains.slice(0, WATCH_MAX).map(async (domain): Promise<WatchCompetitor> => {
      const [ov, kw, pages, ads] = await Promise.allSettled([
        dfsPost<unknown>("/dataforseo_labs/google/domain_rank_overview/live", { target: domain, ...base }),
        dfsPost<unknown>("/dataforseo_labs/google/ranked_keywords/live", { target: domain, ...base, item_types: ["organic"], limit: WATCH_KEYWORDS, order_by: ["keyword_data.keyword_info.search_volume,desc"], filters: ["ranked_serp_element.serp_item.rank_group", "<=", 20] }),
        dfsPost<unknown>("/dataforseo_labs/google/relevant_pages/live", { target: domain, ...base, item_types: ["organic"], limit: WATCH_PAGES, order_by: ["metrics.organic.etv,desc"] }),
        dfsPost<unknown>("/serp/google/ads_search/live/advanced", { target: domain, location_code: loc.countryCode, platform: "google_search", date_from: weekAgo, date_to: today, depth: 40 }),
      ]);
      const snap: WatchSnapshot = { domain, traffic: null, keywordsCount: null, paidKeywords: null, keywords: [], pages: [], adsRunning: null, adsNew: null, ok: false };
      if (ov.status === "fulfilled") {
        cost += ov.value.cost;
        const o = parseDomainOverview(ov.value.result);
        snap.traffic = o?.traffic ?? null;
        snap.keywordsCount = o?.keywords ?? null;
        snap.paidKeywords = o?.paidKeywords ?? null;
        snap.ok = true;
      }
      if (kw.status === "fulfilled") {
        cost += kw.value.cost;
        snap.keywords = parseRankedKeywords(kw.value.result).top.map((k) => ({ keyword: k.keyword, position: k.position, volume: k.volume }));
        snap.ok = true;
      }
      if (pages.status === "fulfilled") {
        cost += pages.value.cost;
        snap.pages = parsePages(pages.value.result);
      }
      if (ads.status === "fulfilled") {
        cost += ads.value.cost;
        const tr = parseTransparency(ads.value.result, now.getTime());
        const items = arr(obj(ads.value.result[0]).items).map(obj);
        snap.adsRunning = tr.total;
        snap.adsNew = items.filter((it) => {
          const first = dfsTime(it.first_shown);
          return first !== null && now.getTime() - Date.parse(first) < 7 * DAY;
        }).length;
      }
      if (!snap.ok) notes.push({ es: `No se pudo revisar ${domain} esta vez.`, en: `Couldn't check ${domain} this time.` });
      const prev = input.previous?.competitors.find((c) => c.domain === domain) ?? null;
      return { ...snap, changes: watchChanges(snap, prev), first: !prev };
    }),
  );
  if (!competitors.some((c) => c.ok)) throw bi("DataForSEO no pudo revisar a tu competencia esta vez. Intenta más tarde.", "DataForSEO couldn't check your competitors this time. Try later.");
  return { country: loc.countryName, competitors, auto: input.auto, notes, cost: Math.round(cost * 10000) / 10000, createdAt: now.toISOString() };
}

/**
 * La revisión automática de la semana (la llama el cron cada minuto): busca UN negocio con la vigilancia encendida cuya
 * última revisión tenga más de 7 días, la hace, la guarda y manda el email si hubo cambios y hay a quién mandarlo.
 */
export async function runDueCompetitorWatch(now = new Date()): Promise<{ businessId: string; ok: boolean; sent?: boolean; error?: string } | null> {
  if (!dataForSeoEnabled()) return null;
  const configs = await db.seoReport.findMany({ where: { kind: WATCH_CONFIG_KIND }, orderBy: { createdAt: "desc" }, select: { businessId: true, data: true }, take: 500 });
  const latest = new Map<string, WatchConfig>();
  for (const c of configs) if (!latest.has(c.businessId)) latest.set(c.businessId, readWatchConfig(c.data));
  const enabled = [...latest.entries()].filter(([, c]) => c.enabled).map(([id]) => id);
  if (!enabled.length) return null;
  const marks = await db.seoReport.findMany({
    where: { businessId: { in: enabled }, kind: { in: [WATCH_KIND, WATCH_RUN_MARK] } },
    orderBy: { createdAt: "desc" },
    select: { businessId: true, kind: true, createdAt: true },
  });
  const lastOf = (id: string, kind: string) => marks.find((m) => m.businessId === id && m.kind === kind)?.createdAt.getTime() ?? 0;
  const due = enabled
    .map((id) => ({ id, last: lastOf(id, WATCH_KIND), tried: lastOf(id, WATCH_RUN_MARK) }))
    .filter((x) => watchIsDue(x.last, now.getTime()) && now.getTime() - x.tried > 6 * 3600_000)
    .sort((a, b) => a.last - b.last)[0];
  if (!due) return null;
  // Reservar el turno (si otra llamada del cron lo reservó antes, no hacer nada).
  const mark = await db.seoReport.create({ data: { businessId: due.id, kind: WATCH_RUN_MARK, data: { at: now.toISOString() } } });
  const first = await db.seoReport.findFirst({ where: { businessId: due.id, kind: WATCH_RUN_MARK, createdAt: { gte: new Date(now.getTime() - 6 * 3600_000) } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
  if (first && first.id !== mark.id) return null;
  await db.seoReport.deleteMany({ where: { businessId: due.id, kind: WATCH_RUN_MARK, createdAt: { lt: new Date(now.getTime() - 30 * DAY) } } });
  try {
    const { report, sent } = await watchBusiness(due.id, latest.get(due.id) as WatchConfig, true, now);
    return { businessId: due.id, ok: Boolean(report), sent };
  } catch (e) {
    return { businessId: due.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Revisa la competencia de un negocio (a mano o automática), guarda el reporte y, si es automática y hubo cambios, manda el email. */
export async function watchBusiness(businessId: string, config: WatchConfig, auto: boolean, now = new Date()): Promise<{ report: WatchReport; sent: boolean }> {
  const b = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { id: true, name: true, color: true, website: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, seoLanguage: true, seoAlertEmail: true, seoEmailLang: true },
  });
  const zone = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName)[0];
  if (!zone) throw bi("Primero elige la zona donde buscan tus clientes en «⚙ Ajustes».", "First pick the area where your customers search in “⚙ Settings”.");
  const [compRow, prevRow] = await Promise.all([
    db.seoReport.findFirst({ where: { businessId, kind: "competitors" }, orderBy: { createdAt: "desc" }, select: { data: true } }),
    db.seoReport.findFirst({ where: { businessId, kind: WATCH_KIND }, orderBy: { createdAt: "desc" }, select: { data: true } }),
  ]);
  const comp = compRow ? readCompetitorsReport(compRow.data) : null;
  const domains = watchDomains(config, comp ? withoutDirectories(comp).report.competitors.map((c) => c.domain) : [], b.website);
  const report = await runWatch({ domains, zone, language: b.seoLanguage === "en" ? "en" : "es", previous: prevRow ? readWatchReport(prevRow.data) : null, auto, now });
  await db.seoReport.create({ data: { businessId, kind: WATCH_KIND, data: report as unknown as object } });
  let sent = false;
  const changes = report.competitors.reduce((s, c) => s + c.changes.length, 0);
  if (auto && changes) {
    const { alertRecipients, renderEmail, sendSeoEmail } = await import("@/lib/seo/alerts");
    const to = alertRecipients(b.seoAlertEmail);
    if (to.length) {
      const lang: UiLang = b.seoEmailLang === "en" ? "en" : "es";
      const email = watchEmail(b, report, lang, renderEmail);
      await sendSeoEmail({ businessId, to, ...email });
      sent = true;
    }
  }
  return { report, sent };
}

/** El email de la semana: un bloque por competidor con lo que cambió. */
export function watchEmail(
  b: { id: string; name: string; color: string },
  report: WatchReport,
  lang: UiLang,
  render: (business: { id: string; name: string; color: string }, lang: UiLang, title: string, blocks: ({ kind: "h"; text: string } | { kind: "p"; text: string; muted?: boolean } | { kind: "list"; items: { text: string }[] })[], opts?: { anchor?: string; offText?: string }) => { html: string; text: string },
): { subject: string; html: string; text: string } {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const title = t("Lo que hizo tu competencia esta semana", "What your competitors did this week");
  const blocks = report.competitors
    .filter((c) => c.changes.length)
    .flatMap((c) => [{ kind: "h" as const, text: c.domain }, { kind: "list" as const, items: c.changes.map((x) => ({ text: changeText(x, lang) })) }]);
  const { html, text } = render(b, lang, title, [{ kind: "p", text: t("Revisamos a tu competencia en Google. Esto es lo nuevo:", "We checked your competitors on Google. Here's what's new:") }, ...blocks], {
    anchor: "?tab=competencia#vigilancia",
    offText: t("Para dejar de recibir este email: en SEO → Competencia, apaga «Revisar cada semana».", "To stop this email: in SEO → Competitors, turn off “Check every week”."),
  });
  return { subject: `${title} · ${b.name}`, html, text };
}
