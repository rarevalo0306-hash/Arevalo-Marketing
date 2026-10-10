"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { errorText, intlLocale, type UiLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import {
  BACKLINKS_LOCKED_KIND,
  fetchBulkSpamScores,
  fetchToxicLinkData,
  NoBacklinksAccessError,
  TOXIC_REFERRING_LIMIT,
} from "@/lib/seo/backlinks";
import { normalizeDomain } from "@/lib/seo/competitors";
import { dataForSeoEnabled } from "@/lib/seo/dataforseo";
import {
  buildDisavowFile,
  disavowFileName,
  IMPORT_MAX,
  OUTCOME_TEXT,
  parseBulkSpam,
  parseLinkList,
  parseOwnSites,
  parseToxicFetch,
  readToxicAudit,
  totalCountOf,
  TOXIC_AUDITS_KEEP,
  TOXIC_KIND,
  wizardOutcome,
  type Answer,
  type DecisionRecord,
  type DisavowRecord,
  type Outcome,
  type SettingsRecord,
  type ToxicAudit,
} from "@/lib/toxic-links";
import { loadToxicState } from "@/lib/toxic-links-data";

export type ToxicResult = { ok: boolean; message: string; locked?: boolean } | null;

const json = (x: unknown) => x as Prisma.InputJsonValue;
const page = (id: string) => `/b/${id}/enlaces`;
const usd = (n: number, lang: UiLang) => new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(n);

/** Solo se guardan las últimas revisiones (las decisiones, los archivos y los ajustes se quedan). */
async function pruneAudits(businessId: string) {
  const old = await db.seoReport.findMany({
    where: { businessId, kind: TOXIC_KIND, data: { path: ["type"], equals: "audit" } },
    orderBy: { createdAt: "desc" },
    skip: TOXIC_AUDITS_KEEP,
    select: { id: true },
  });
  if (old.length) await db.seoReport.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

/** Revisa con DataForSEO los sitios que enlazan al negocio (pago por uso; el costo se muestra antes en el botón). */
export async function runToxicCheck(businessId: string, _prev: ToxicResult, _f: FormData): Promise<ToxicResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  if (!dataForSeoEnabled())
    return { ok: false, message: t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).") };
  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  if (!normalizeDomain(b.website)) return { ok: false, message: t("Primero agrega la dirección de tu página web en Ajustes del negocio.", "First add your website address in Business settings.") };
  try {
    const now = new Date();
    const raw = await fetchToxicLinkData({ website: b.website, limit: TOXIC_REFERRING_LIMIT, now });
    const parsed = parseToxicFetch(raw.referring, raw.backlinks);
    const audit: ToxicAudit = {
      version: 1,
      type: "audit",
      source: "dataforseo",
      domain: raw.domain,
      createdAt: now.toISOString(),
      total: parsed.total,
      newThisMonth: raw.recent.length ? totalCountOf(raw.recent) : null,
      items: parsed.items,
      cost: raw.cost,
      notes: raw.notes,
    };
    await db.seoReport.create({ data: { businessId, kind: TOXIC_KIND, data: json(audit) } });
    await db.seoReport.deleteMany({ where: { businessId, kind: BACKLINKS_LOCKED_KIND } });
    await pruneAudits(businessId);
    revalidatePath(page(businessId));
    const state = await loadToxicState(businessId, now);
    const high = state?.counts.alto ?? 0;
    const n = parsed.items.length;
    return {
      ok: true,
      message:
        t(
          `Listo: revisamos ${n} ${n === 1 ? "sitio" : "sitios"}; ${high} ${high === 1 ? "parece" : "parecen"} de riesgo alto. Costo: ${usd(raw.cost, lang)}.`,
          `Done: we checked ${n} ${n === 1 ? "site" : "sites"}; ${high} ${high === 1 ? "looks" : "look"} high risk. Cost: ${usd(raw.cost, lang)}.`,
        ) + (raw.notes.length ? t(" Algunos datos no se pudieron traer (ver notas).", " Some data couldn't be fetched (see notes).") : ""),
    };
  } catch (e) {
    if (e instanceof NoBacklinksAccessError) {
      await db.seoReport.deleteMany({ where: { businessId, kind: BACKLINKS_LOCKED_KIND } });
      await db.seoReport.create({ data: { businessId, kind: BACKLINKS_LOCKED_KIND, data: { locked: true, at: new Date().toISOString() } } });
      revalidatePath(page(businessId));
      return {
        ok: false,
        locked: true,
        message: t(
          "Tu cuenta de DataForSEO todavía no tiene activada la parte de Enlaces. No se cobró nada. Mientras tanto, puedes importar la lista que ya tienes.",
          "Your DataForSEO account doesn't have the Links part turned on yet. Nothing was charged. Meanwhile, you can import the list you already have.",
        ),
      };
    }
    return { ok: false, message: errorText(e, lang) };
  }
}

/** Guarda la lista que el dueño ya tiene (Semrush, Ahrefs, Search Console o una lista de dominios). Gratis. */
export async function importToxicList(businessId: string, _prev: ToxicResult, f: FormData): Promise<ToxicResult> {
  void _prev;
  const { t } = await getT();
  const text = String(f.get("text") ?? "");
  const name = String(f.get("name") ?? "").slice(0, 120);
  if (!text.trim()) return { ok: false, message: t("Pega la lista o elige un archivo primero.", "Paste the list or pick a file first.") };
  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const list = parseLinkList(text);
  if (!list.items.length)
    return {
      ok: false,
      message: t(
        "No encontramos dominios ni direcciones en lo que pegaste. Revisa que sea la lista de enlaces (una por línea o el CSV exportado).",
        "We didn't find any domains or addresses in what you pasted. Make sure it's the links list (one per line or the exported CSV).",
      ),
    };
  const audit: ToxicAudit = {
    version: 1,
    type: "audit",
    source: "import",
    domain: normalizeDomain(b.website) ?? "",
    createdAt: new Date().toISOString(),
    total: null,
    newThisMonth: null,
    items: list.items,
    cost: 0,
    notes: [],
    importName: name || undefined,
    importFormat: list.format,
    skipped: list.skipped,
  };
  const hadImport = await db.seoReport.count({ where: { businessId, kind: TOXIC_KIND, data: { path: ["source"], equals: "import" } } });
  await db.seoReport.create({ data: { businessId, kind: TOXIC_KIND, data: json(audit) } });
  await pruneAudits(businessId);
  revalidatePath(page(businessId));
  const FORMAT: Record<string, [string, string]> = {
    semrush: ["de Semrush", "from Semrush"],
    ahrefs: ["de Ahrefs", "from Ahrefs"],
    gsc: ["de Search Console", "from Search Console"],
    disavow: ["de un archivo de desautorización", "from a disavow file"],
    csv: ["de una tabla", "from a table"],
    plain: ["", ""],
  };
  const [fes, fen] = FORMAT[list.format] ?? ["", ""];
  const n = list.items.length;
  return {
    ok: true,
    message:
      t(`Importamos ${n} ${n === 1 ? "dominio" : "dominios"}${fes ? ` ${fes}` : ""}.`, `Imported ${n} ${n === 1 ? "domain" : "domains"}${fen ? ` ${fen}` : ""}.`) +
      (list.skipped
        ? t(
            ` ${list.skipped} ${list.skipped === 1 ? "línea no tenía un dominio y se saltó" : "líneas no tenían un dominio y se saltaron"}.`,
            ` ${list.skipped} ${list.skipped === 1 ? "line had no domain and was skipped" : "lines had no domain and were skipped"}.`,
          )
        : "") +
      (hadImport ? t(" Reemplaza la lista que habías importado antes.", " It replaces the list you imported before.") : "") +
      (list.truncated ? t(` Solo se tomaron los primeros ${IMPORT_MAX}.`, ` Only the first ${IMPORT_MAX} were kept.`) : ""),
  };
}

/** Revisa el nivel de spam de la lista importada con DataForSEO (pago por uso; el costo se muestra antes). */
export async function checkImportSpam(businessId: string, _prev: ToxicResult, _f: FormData): Promise<ToxicResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  if (!dataForSeoEnabled())
    return { ok: false, message: t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).") };
  const rows = await db.seoReport.findMany({ where: { businessId, kind: TOXIC_KIND, data: { path: ["source"], equals: "import" } }, orderBy: { createdAt: "desc" }, take: 1 });
  const row = rows[0];
  const audit = row ? readToxicAudit(row.data) : null;
  if (!row || !audit) return { ok: false, message: t("Primero importa tu lista.", "Import your list first.") };
  try {
    const { results, cost } = await fetchBulkSpamScores(audit.items.map((i) => i.domain));
    const scores = new Map<string, number>();
    for (const r of results) for (const [d, s] of parseBulkSpam(r)) scores.set(d, s);
    const items = audit.items.map((i) => (scores.has(i.domain) ? { ...i, spamScore: scores.get(i.domain)! } : i));
    await db.seoReport.update({ where: { id: row.id }, data: { data: json({ ...audit, items, spamChecked: true, cost: Math.round((audit.cost + cost) * 10000) / 10000 }) } });
    revalidatePath(page(businessId));
    return {
      ok: true,
      message: t(`Listo: revisamos el spam de ${scores.size} dominios. Costo: ${usd(cost, lang)}.`, `Done: we checked the spam level of ${scores.size} domains. Cost: ${usd(cost, lang)}.`),
    };
  } catch (e) {
    if (e instanceof NoBacklinksAccessError)
      return {
        ok: false,
        locked: true,
        message: t("Tu cuenta de DataForSEO todavía no tiene activada la parte de Enlaces. No se cobró nada.", "Your DataForSEO account doesn't have the Links part turned on yet. Nothing was charged."),
      };
    return { ok: false, message: errorText(e, lang) };
  }
}

const ANSWERS: Answer[] = ["yes", "no", "unsure"];

/** Guarda las respuestas de «¿Necesito desautorizar?» con el resultado calculado con los datos del servidor. */
export async function saveToxicDecision(businessId: string, _prev: ToxicResult, f: FormData): Promise<ToxicResult> {
  void _prev;
  const { t } = await getT();
  const manual = String(f.get("manual") ?? "");
  const drop = String(f.get("drop") ?? "");
  if (!ANSWERS.includes(manual as Answer) || !ANSWERS.includes(drop as Answer)) return { ok: false, message: t("Responde las dos preguntas.", "Answer both questions.") };
  const state = await loadToxicState(businessId);
  if (!state) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const w = wizardOutcome({ manual: manual as Answer, drop: drop as Answer, spike: state.spike.level, high: state.counts.alto });
  const record: DecisionRecord = { version: 1, type: "decision", createdAt: new Date().toISOString(), manual: manual as Answer, drop: drop as Answer, outcome: w.outcome };
  await db.seoReport.create({ data: { businessId, kind: TOXIC_KIND, data: json(record) } });
  revalidatePath(page(businessId));
  return { ok: true, message: t(`Guardado: ${OUTCOME_TEXT[w.outcome].es}.`, `Saved: ${OUTCOME_TEXT[w.outcome].en}.`) };
}

/** Tus otros sitios y los de tus socios: nunca se marcan como dañinos ni entran al archivo. */
export async function saveOwnSites(businessId: string, _prev: ToxicResult, f: FormData): Promise<ToxicResult> {
  void _prev;
  const { t } = await getT();
  const sites = parseOwnSites(String(f.get("sites") ?? ""));
  const record: SettingsRecord = { version: 1, type: "settings", createdAt: new Date().toISOString(), ownSites: sites };
  await db.seoReport.deleteMany({ where: { businessId, kind: TOXIC_KIND, data: { path: ["type"], equals: "settings" } } });
  await db.seoReport.create({ data: { businessId, kind: TOXIC_KIND, data: json(record) } });
  revalidatePath(page(businessId));
  return { ok: true, message: sites.length ? t(`Guardado: ${sites.length} ${sites.length === 1 ? "sitio protegido" : "sitios protegidos"}.`, `Saved: ${sites.length} protected ${sites.length === 1 ? "site" : "sites"}.`) : t("Guardado.", "Saved.") };
}

export type DisavowResult = { ok: boolean; message: string; text?: string; fileName?: string; count?: number; excluded?: string[] };

/**
 * Arma el archivo para Google con los dominios elegidos (nunca tu sitio ni sitios seguros) y lo guarda en el
 * historial. Sin dominios arma el archivo «vacío» que deshace una desautorización anterior. No sube nada a Google.
 */
export async function makeDisavowFile(businessId: string, input: { domains: string[]; reason: string; outcome: Outcome | null }): Promise<DisavowResult> {
  const { lang, t } = await getT();
  const state = await loadToxicState(businessId);
  if (!state) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const site = state.business.website;
  if (!normalizeDomain(site)) return { ok: false, message: t("Primero agrega la dirección de tu página web en Ajustes del negocio.", "First add your website address in Business settings.") };
  const requested = (Array.isArray(input.domains) ? input.domains : []).filter((d): d is string => typeof d === "string").slice(0, 100_000);
  const now = new Date();
  const file = buildDisavowFile({ site, domains: requested, ownSites: state.ownSites, date: now, reason: String(input.reason ?? ""), lang });
  if (requested.length && !file.domains.length)
    return { ok: false, message: t("Ninguno de esos sitios se puede desautorizar (son tuyos o son sitios seguros).", "None of those sites can be disavowed (they're yours or safe sites).") };
  const outcome = input.outcome && ["nothing", "watch", "prepare"].includes(input.outcome) ? input.outcome : null;
  const record: DisavowRecord = { version: 1, type: "disavow", createdAt: now.toISOString(), domains: file.domains, outcome, empty: file.domains.length === 0 };
  await db.seoReport.create({ data: { businessId, kind: TOXIC_KIND, data: json(record) } });
  revalidatePath(page(businessId));
  return {
    ok: true,
    text: file.text,
    fileName: disavowFileName(site, now),
    count: file.domains.length,
    excluded: file.excluded,
    message: file.domains.length
      ? t(`Archivo listo con ${file.domains.length} ${file.domains.length === 1 ? "dominio" : "dominios"}. Todavía no se subió nada a Google.`, `File ready with ${file.domains.length} ${file.domains.length === 1 ? "domain" : "domains"}. Nothing has been uploaded to Google yet.`)
      : t("Archivo vacío listo: súbelo para quitar una desautorización anterior.", "Empty file ready: upload it to remove a previous disavow."),
  };
}
