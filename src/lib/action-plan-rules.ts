// Reglas del plan de acción único: cada reporte guardado (su JSON tal como está en SeoReport.data) se convierte en
// tareas simples (TaskDraft) que el dueño puede marcar como hechas. PURO: sin base de datos ni red, se prueba en
// tests/action-plan.test.ts. Quien lee la base de datos y guarda las tareas es src/lib/action-plan.ts.
//
// Reglas comunes:
// - `key` es estable entre corridas para el mismo hallazgo (sin fechas ni números que cambian).
// - Cada tarea dice de qué reporte salió y de qué fecha (último párrafo del detalle: «Según … del …»).
// - Lo que no tiene que ver con lo que vende el negocio no entra (vocabulario de gap.ts: isRelevantKeyword).
// - Si un reporte falta o tiene un formato viejo, la regla no devuelve nada (sin errores).
import { taskScore, type Bi, type TaskArea, type TaskDraft } from "@/lib/action-plan-shape";
import { effectiveStatus, napIssueText, type NapIssue } from "@/lib/directories";
import { GA4_BUSY_PAGE, hasKeyEventsSetUp, isLowEngagementPage, organicShare, readGa4Report } from "@/lib/ga4-shape";
import { translator } from "@/lib/i18n";
import * as auditModule from "@/lib/seo/audit";
import { ISSUE_TEXT, readAuditReport, type Issue } from "@/lib/seo/audit";
import { HINT_EASY, hintText, linkHint, readBacklinksReport, type GapDomain, type LinkHint } from "@/lib/seo/backlinks";
import { readCannibalReport } from "@/lib/seo/cannibal";
import { normalizeDomain, sameSite } from "@/lib/seo/competitors";
import { readDecayReport, shortPath } from "@/lib/seo/decay";
import { isRelevantKeyword, readGapReport } from "@/lib/seo/gap";
import { readGbpReport, readReviewsReport } from "@/lib/seo/gbp";
import { asGscReport } from "@/lib/seo/gsc";
import { readKeywordsReport } from "@/lib/seo/keywords";
import { readMapReport } from "@/lib/seo/maprank";
import { isBrandQuery, pathOf, readOnPageReport, urlKey, type IdeaId, type OnPageIdea } from "@/lib/seo/onpage";
import { readOutreachStore } from "@/lib/seo/outreach";
import type { QuestionsData } from "@/lib/seo/questions";
import { readRankReport, siteDomain } from "@/lib/seo/rank";
import { readVisibilityReport } from "@/lib/seo/visibility";
import { norm } from "@/lib/seo/writer";
import { REVIEW_SHARE_DAYS } from "@/lib/reviews-request";
import { readSettings, toxicAlert } from "@/lib/toxic-links";
import { fmtDate } from "@/lib/time";

/** Tareas abiertas como máximo: las de menor puntaje quedan fuera. */
export const PLAN_CAP = 60;

/** Lo que las reglas necesitan saber del negocio. */
export type RuleCtx = {
  businessId: string;
  /** Página web del negocio (para no sugerir su propio sitio). */
  website: string;
  /** Nombre del negocio (para no tomar búsquedas de marca como oportunidades). */
  name?: string;
  /** Vocabulario de lo que vende (businessTopicVocab en gap.ts). Vacío = no se filtra. */
  vocab: string[];
};

/** Un reporte guardado: su JSON y cuándo se guardó. */
export type Saved = { data: unknown; createdAt: Date | string };

// ---------- Ayudantes ----------

const bi = (es: string, en: string): Bi => ({ es, en });
const seo = (ctx: RuleCtx, tab: string, hash: string) => `/b/${ctx.businessId}/seo?tab=${tab}#${hash}`;
const writerHref = (ctx: RuleCtx, kw: string) => `/b/${ctx.businessId}/seo/escribir?kw=${encodeURIComponent(kw.slice(0, 80))}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const clamp3 = (n: number): 1 | 2 | 3 => (n <= 1 ? 1 : n >= 3 ? 3 : 2);
const fmtNum = (n: number, lang: "es" | "en") => new Intl.NumberFormat(lang === "en" ? "en-US" : "es-US").format(Math.round(n));

/** De qué reporte sale cada tarea (en palabras). */
const SOURCE_TEXT = {
  audit: bi("la revisión de tu página web", "your website check"),
  onpage: bi("la revisión de tus páginas", "your page review"),
  decay: bi("Search Console (páginas que pierden visitas)", "Search Console (pages losing visits)"),
  cannibal: bi("la revisión de páginas que compiten entre sí", "the competing-pages check"),
  questions: bi("las preguntas que muestra Google", "the questions Google shows"),
  rank: bi("tus posiciones en Google", "your Google rankings"),
  gsc: bi("Search Console", "Search Console"),
  ga4: bi("Google Analytics (visitas a tu página)", "Google Analytics (website visits)"),
  gap: bi("la comparación con tu competencia", "the competitor comparison"),
  backlinks: bi("la revisión de enlaces", "the backlinks check"),
  toxic: bi("la revisión de enlaces dañinos", "the toxic links check"),
  gbp: bi("tu Perfil de Google", "your Google profile"),
  reviews: bi("tus reseñas de Google", "your Google reviews"),
  maprank: bi("el mapa de Google Maps", "the Google Maps heatmap"),
  ai: bi("la revisión de las IAs", "the AI check"),
  business: bi("los datos de tu negocio", "your business details"),
  directories: bi("tu lista de directorios", "your directory checklist"),
} as const;
export type SourceName = keyof typeof SOURCE_TEXT;

/** «Según la revisión de tu página web del 6 oct 2026.» (fecha en la hora del negocio). */
export function sourceLine(source: SourceName, at: Date | string): Bi {
  const s = SOURCE_TEXT[source];
  return { es: `Según ${s.es} del ${fmtDate(at, "es")}.`, en: `Source: ${s.en}, ${fmtDate(at, "en")}.` };
}

/** El detalle: los párrafos (por qué y cómo) y al final de dónde salió. Párrafos separados por una línea en blanco. */
function detailOf(parts: (Bi | null | undefined | false)[], source: SourceName, at: Date | string): Bi {
  const list = [...parts.filter((p): p is Bi => !!p && !!(p.es || p.en)), sourceLine(source, at)];
  return { es: list.map((p) => p.es).join("\n\n"), en: list.map((p) => p.en).join("\n\n") };
}

type Draft = Omit<TaskDraft, "detail"> & { detail: Bi };
const task = (d: Draft): TaskDraft => d;

/** «a», «b» y «c» (máx. 3). */
function quoteList(items: string[], max = 3): Bi {
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  const j = (open: string, close: string, and: string, extra: string) => {
    const q = shown.map((x) => `${open}${x}${close}`);
    if (more > 0) q.push(extra);
    return q.length <= 1 ? (q[0] ?? "") : `${q.slice(0, -1).join(", ")} ${and} ${q[q.length - 1]}`;
  };
  return { es: j("«", "»", "y", `${more} más`), en: j("“", "”", "and", `${more} more`) };
}

const pathList = (urls: string[], max = 3) => quoteList(urls.map((u) => pathOf(u) || u), max);

// ---------- 1. Revisión de la página web (audit) ----------
// Se lee cada problema por su id, gravedad, grupo y páginas (de forma genérica): los problemas nuevos que agregue la
// auditoría entran solos al plan, con su texto de ISSUE_TEXT. El grupo (category) y la unidad (ISSUE_META) se usan si
// existen; si no (reportes o versiones viejas), se deducen del id.

/** Cuánto trabajo da cada problema (1 fácil · 2 medio · 3 difícil). Los que no están en la lista valen 2. */
const AUDIT_EFFORT: Record<string, 1 | 2 | 3> = {
  "page-errors": 2,
  "broken-links": 1,
  "missing-title": 1,
  "no-https": 2,
  "http-no-redirect": 2,
  "no-viewport": 2,
  noindex: 1,
  "duplicate-title": 1,
  "title-too-long": 1,
  "missing-description": 1,
  "duplicate-description": 1,
  "missing-h1": 1,
  "images-no-alt": 1,
  "slow-page": 3,
  "no-sitemap": 1,
  "no-structured-data": 1,
  "title-too-short": 1,
  "description-length": 1,
  "multiple-h1": 1,
  "thin-content": 3,
  "no-og-image": 1,
  "missing-lang": 1,
  "no-robots": 1,
  // Revisión profunda (versión 2 de la auditoría).
  "robots-blocks-site": 1,
  "sitemap-bad-urls": 1,
  "broken-images": 1,
  "orphan-pages": 1,
  "single-inlink": 1,
  "h1-same-as-title": 1,
  "llms-txt-missing": 1,
  "llms-txt-invalid": 1,
  "ai-search-bots-blocked": 1,
  "ai-training-bots-blocked": 1,
  "duplicate-content": 3,
};

/** Grupo y unidad de un problema, si la auditoría los publica (ISSUE_META en audit.ts). Sin eso, null. */
type IssueMetaLite = { category?: string; unit?: string };
const ISSUE_META_LITE: Record<string, IssueMetaLite> | null = (() => {
  const m: unknown = Reflect.get(auditModule, "ISSUE_META");
  return m && typeof m === "object" ? (m as Record<string, IssueMetaLite>) : null;
})();

/** Problemas sobre los datos del negocio para Google (schema / JSON-LD): se arreglan con la herramienta del código. */
const isSchemaIssue = (id: string, category?: string) => category === "schema" || /schema|json-?ld|structured/i.test(id);
/** Problemas sobre las IAs (llms.txt, robots de IA bloqueados…): van al área «Visibilidad en IAs». */
const isAiIssue = (id: string, category?: string) => category === "ai" || /^ai-|llms|gptbot|ia-?bot/i.test(id);

/** En qué se cuenta: páginas, enlaces, direcciones, fotos o todo el sitio. */
function issueUnit(issue: Issue): string {
  const unit = ISSUE_META_LITE?.[issue.id]?.unit;
  if (unit) return unit;
  if (issue.id === "broken-links") return "links";
  if (/urls$/.test(issue.id)) return "urls";
  if (/images$/.test(issue.id) && issue.id !== "images-no-alt") return "images";
  // Sin páginas: es un problema de todo el sitio (sitemap, robots, https…).
  return issue.pages.length === 0 && Math.max(issue.count, 0) <= 1 ? "site" : "pages";
}

const UNIT_WORDS: Record<string, [string, string, string, string]> = {
  pages: ["página", "páginas", "page", "pages"],
  links: ["enlace", "enlaces", "link", "links"],
  urls: ["dirección", "direcciones", "address", "addresses"],
  images: ["foto", "fotos", "photo", "photos"],
};

function auditEffort(issue: Issue): 1 | 2 | 3 {
  const meta = ISSUE_META_LITE?.[issue.id];
  const base = AUDIT_EFFORT[issue.id] ?? (isSchemaIssue(issue.id, meta?.category) || isAiIssue(issue.id, meta?.category) ? 1 : 2);
  // Muchas páginas con el mismo problema: más trabajo.
  return clamp3(base + (issue.pages.length > 10 || issue.count > 10 ? 1 : 0));
}

type IssueCopyBi = { es: { title: string; fix: string }; en: { title: string; fix: string } };
function issueCopy(id: string): IssueCopyBi {
  const copy = (ISSUE_TEXT as Record<string, IssueCopyBi | undefined>)[id];
  return (
    copy ?? {
      es: { title: `Problema en tu página: ${id}`, fix: "Abre la revisión de tu página para ver qué páginas tienen este problema y cómo arreglarlo." },
      en: { title: `Website issue: ${id}`, fix: "Open your website check to see which pages have this issue and how to fix it." },
    }
  );
}

/** Hasta 3 ejemplos: «/ruta (valor)». Usa los `items` de la auditoría nueva si los hay; si no, las páginas. */
function auditExamples(issue: Issue, report: NonNullable<ReturnType<typeof readAuditReport>>): Bi | null {
  if (issue.id === "broken-links" && report.site.brokenLinks.length) {
    const ex = report.site.brokenLinks.slice(0, 3);
    return {
      es: `Por ejemplo: ${ex.map((b) => `${pathOf(b.url) || b.url}${b.from[0] ? ` (en ${pathOf(b.from[0])})` : ""}`).join(", ")}.`,
      en: `For example: ${ex.map((b) => `${pathOf(b.url) || b.url}${b.from[0] ? ` (on ${pathOf(b.from[0])})` : ""}`).join(", ")}.`,
    };
  }
  const items = (issue as { items?: { url?: unknown; value?: unknown }[] }).items;
  if (Array.isArray(items) && items.length) {
    const ex = items
      .filter((i) => typeof i?.url === "string" && i.url)
      .slice(0, 3)
      .map((i) => `${pathOf(String(i.url)) || String(i.url)}${typeof i.value === "string" && i.value ? ` (${i.value.slice(0, 60)})` : ""}`);
    if (ex.length) return { es: `Por ejemplo: ${quoteList(ex).es}.`, en: `For example: ${quoteList(ex).en}.` };
  }
  if (!issue.pages.length) return null;
  return { es: `Por ejemplo: ${pathList(issue.pages).es}.`, en: `For example: ${pathList(issue.pages).en}.` };
}

/** Cada problema de la revisión de la página → una tarea. Errores urgentes, avisos importantes, notas como mejora. */
export function auditTasks(saved: Saved | null, ctx: RuleCtx): TaskDraft[] {
  const report = saved ? readAuditReport(saved.data) : null;
  if (!saved || !report) return [];
  const out: TaskDraft[] = [];
  for (const issue of report.issues) {
    const n = Math.max(issue.count, issue.pages.length);
    if (n <= 0) continue;
    const copy = issueCopy(issue.id);
    const category = (issue as { category?: string }).category ?? ISSUE_META_LITE?.[issue.id]?.category;
    const words = UNIT_WORDS[issueUnit(issue)];
    const count = words ? bi(plural(n, words[0], words[1]), plural(n, words[2], words[3])) : null;
    const total = (issue as { total?: unknown }).total;
    const schema = isSchemaIssue(issue.id, category);
    out.push(
      task({
        key: `audit:${issue.id}`,
        source: schema ? "schema" : "audit",
        area: isAiIssue(issue.id, category) ? "ia" : "web",
        title: count ? { es: `${copy.es.title} (${count.es})`, en: `${copy.en.title} (${count.en})` } : { es: copy.es.title, en: copy.en.title },
        detail: detailOf(
          [
            { es: copy.es.fix, en: copy.en.fix },
            auditExamples(issue, report),
            typeof total === "number" && total > n && bi(`En total son ${fmtNum(total, "es")} casos.`, `${fmtNum(total, "en")} cases in total.`),
            schema && bi("La herramienta «Código para Google» te arma el código listo para copiar y pegar.", "The “Code for Google” tool builds the code ready to copy and paste."),
          ],
          "audit",
          saved.createdAt,
        ),
        impact: issue.severity === "error" ? 3 : issue.severity === "warning" ? 2 : 1,
        effort: auditEffort(issue),
        href: schema ? seo(ctx, "local", "codigo-google") : seo(ctx, "web", "auditoria"),
      }),
    );
  }
  return out;
}

// ---------- 2. Datos del negocio para Google (schema LocalBusiness) ----------

/** Sin datos de negocio local en la página (y sin un problema de la revisión que ya lo diga) → tarea con la herramienta del código. */
export function schemaTasks(audit: Saved | null, ctx: RuleCtx): TaskDraft[] {
  const report = audit ? readAuditReport(audit.data) : null;
  if (!audit || !report || report.site.localBusinessSchema) return [];
  if (report.issues.some((i) => isSchemaIssue(i.id))) return [];
  if (!report.pages.length) return [];
  return [
    task({
      key: "schema:localbusiness",
      source: "schema",
      area: "web",
      title: bi("Agrega los datos de tu negocio para Google (LocalBusiness)", "Add your business details for Google (LocalBusiness)"),
      detail: detailOf(
        [
          bi(
            "Tu página no le dice a Google, en su formato, que eres un negocio local: nombre, dirección, teléfono y horario. Ayuda a salir en el mapa y en las respuestas de las IAs.",
            "Your website doesn't tell Google, in its format, that you're a local business: name, address, phone and hours. It helps you show up on the map and in AI answers.",
          ),
          bi("La herramienta «Código para Google» te lo arma: lo copias y lo pegas en tu página de inicio.", "The “Code for Google” tool builds it for you: copy it and paste it on your home page."),
        ],
        "audit",
        audit.createdAt,
      ),
      impact: 2,
      effort: 1,
      href: seo(ctx, "local", "codigo-google"),
    }),
  ];
}

// ---------- 3. Revisión de tus páginas (onpage) ----------

/** Qué hacer, en pocas palabras, para cada idea de la revisión de páginas. `{kw}` = la búsqueda de esa página. */
const IDEA_SHORT: Partial<Record<IdeaId, Bi>> = {
  noindex: bi("Deja que Google muestre la página", "Let Google show the page"),
  canonical: bi("Corrige la versión principal (canonical)", "Fix the main-version tag (canonical)"),
  "title-missing": bi("Ponle título a la página", "Give the page a title"),
  "title-keyword": bi("Pon {kw} en el título", "Put {kw} in the title"),
  "title-length": bi("Ajusta el largo del título", "Fix the title length"),
  "h1-missing": bi("Agrega un título principal (H1)", "Add a main heading (H1)"),
  "h1-keyword": bi("Pon {kw} en el título principal (H1)", "Put {kw} in the main heading (H1)"),
  "h1-multiple": bi("Deja un solo título principal (H1)", "Keep just one main heading (H1)"),
  "meta-missing": bi("Escribe la descripción para Google", "Write the description for Google"),
  "meta-keyword": bi("Pon {kw} en la descripción", "Put {kw} in the description"),
  "meta-length": bi("Ajusta el largo de la descripción", "Fix the description length"),
  "url-keyword": bi("Usa {kw} en la dirección de la página", "Use {kw} in the page address"),
  "intro-keyword": bi("Menciona {kw} al principio del texto", "Mention {kw} at the start of the text"),
  "h2-keyword": bi("Usa {kw} en un subtítulo", "Use {kw} in a subheading"),
  length: bi("Agrega más texto útil", "Add more useful text"),
  topics: bi("Cubre los temas que tocan los que salen primero", "Cover the topics the top results cover"),
  questions: bi("Responde las preguntas que hace la gente", "Answer the questions people ask"),
  terms: bi("Usa las palabras que usan los que salen primero", "Use the words the top results use"),
  "images-alt": bi("Describe las fotos (texto alternativo)", "Describe the photos (alt text)"),
  "inbound-links": bi("Enlaza esta página desde otras de tu sitio", "Link to this page from your other pages"),
  "home-link": bi("Enlaza esta página desde el inicio", "Link to this page from your home page"),
  "outbound-links": bi("Enlaza a fuentes útiles", "Link to useful sources"),
  schema: bi("Agrega los datos del negocio para Google", "Add your business details for Google"),
  speed: bi("Haz que la página cargue más rápido", "Make the page load faster"),
  "not-ranking": bi("Haz que esta página salga para {kw}", "Get this page showing for {kw}"),
  "low-ranking": bi("Sube esta página para {kw}", "Move this page up for {kw}"),
  "other-page-ranks": bi("Google muestra otra página tuya para {kw}", "Google shows another page of yours for {kw}"),
};

const IDEA_AREA: Record<OnPageIdea["category"], TaskArea> = {
  titulos: "web",
  tecnico: "web",
  enlaces: "web",
  contenido: "contenido",
  preguntas: "contenido",
  competencia: "contenido",
};

const IDEA_EFFORT: Partial<Record<IdeaId, 1 | 2 | 3>> = {
  length: 3,
  topics: 3,
  questions: 2,
  terms: 2,
  speed: 3,
  "not-ranking": 3,
  "low-ranking": 2,
  "other-page-ranks": 2,
  canonical: 2,
  "url-keyword": 2,
  "inbound-links": 2,
};

/** Ideas por página que entran al plan (las más importantes de cada una). */
export const ONPAGE_PER_PAGE = 2;

/** Las 2 ideas más importantes (alta o media) de cada página revisada → tareas. */
export function onpageTasks(saved: Saved | null, ctx: RuleCtx): TaskDraft[] {
  const report = saved ? readOnPageReport(saved.data) : null;
  if (!saved || !report) return [];
  const out: TaskDraft[] = [];
  for (const page of report.pages) {
    if (page.error || page.skipped || page.needsRecheck || page.score === null) continue;
    const path = pathOf(page.url) || page.url;
    const kw = page.keyword ?? "";
    const ideas = page.ideas.filter((i) => i.priority !== "baja").slice(0, ONPAGE_PER_PAGE);
    for (const idea of ideas) {
      const short = IDEA_SHORT[idea.id];
      const fill = (s: string, open: string, close: string) => s.replace("{kw}", kw ? `${open}${kw}${close}` : open === "«" ? "la búsqueda" : "the search");
      const head: Bi = short
        ? { es: fill(short.es, "«", "»"), en: fill(short.en, "“", "”") }
        : { es: idea.es.split(/(?<=\.)\s/)[0].slice(0, 90), en: idea.en.split(/(?<=\.)\s/)[0].slice(0, 90) };
      const list = idea.detail?.length ? bi(`Por ejemplo: ${idea.detail.slice(0, 5).join(" · ")}`, `For example: ${idea.detail.slice(0, 5).join(" · ")}`) : null;
      out.push(
        task({
          key: `onpage:${urlKey(page.url)}:${idea.id}`,
          source: "onpage",
          area: IDEA_AREA[idea.category] ?? "web",
          title: { es: `${head.es} — ${path}`, en: `${head.en} — ${path}` },
          detail: detailOf(
            [
              { es: idea.es, en: idea.en },
              list,
              !!kw && bi(`Esta página compite por «${kw}».`, `This page competes for “${kw}”.`),
            ],
            "onpage",
            saved.createdAt,
          ),
          impact: idea.priority === "alta" ? 3 : 2,
          effort: IDEA_EFFORT[idea.id] ?? 1,
          href: seo(ctx, "web", "paginas"),
        }),
      );
    }
  }
  return out;
}

// ---------- 4. Páginas que pierden visitas (decay) ----------

export const DECAY_MAX = 5;

/** Las páginas que más clics perdieron → «Actualiza la página…». */
export function decayTasks(saved: Saved | null, ctx: RuleCtx): TaskDraft[] {
  const report = saved ? readDecayReport(saved.data) : null;
  if (!saved || !report) return [];
  return [...report.pages]
    .sort((a, b) => b.clicksLost - a.clicksLost)
    .slice(0, DECAY_MAX)
    .map((p) => {
      const path = shortPath(p.url);
      const queries = p.lostQueries.map((q) => q.query);
      const why: Bi =
        p.reason === "position"
          ? bi(
              `Bajó en Google: estaba cerca del puesto ${Math.round(p.before.position)} y ahora del ${Math.round(p.now.position)}.`,
              `It dropped on Google: it was around position ${Math.round(p.before.position)} and now around ${Math.round(p.now.position)}.`,
            )
          : p.reason === "demand"
            ? bi("Menos gente busca esto ahora (puede ser la temporada). Revisa que siga al día.", "Fewer people search for this now (it may be the season). Check it's still up to date.")
            : p.reason === "ctr"
              ? bi("Google la sigue mostrando, pero la gente hace menos clic: mejora el título y la descripción.", "Google still shows it, but people click less: improve the title and description.")
              : queries.length
                ? { es: `Perdió visitas de búsquedas clave: ${quoteList(queries).es}.`, en: `It lost visits from key searches: ${quoteList(queries).en}.` }
                : bi("Perdió visitas de búsquedas clave.", "It lost visits from key searches.");
      return task({
        key: `decay:${urlKey(p.url)}`,
        source: "content",
        area: "contenido",
        title: {
          es: `Actualiza la página que perdió visitas: ${path} (−${plural(p.clicksLost, "clic", "clics")})`,
          en: `Refresh the page that lost visits: ${path} (−${plural(p.clicksLost, "click", "clicks")})`,
        },
        detail: detailOf(
          [
            {
              es: `Antes tenía ${fmtNum(p.before.clicks, "es")} clics en 28 días y ahora ${fmtNum(p.now.clicks, "es")}. ${why.es}`,
              en: `It had ${fmtNum(p.before.clicks, "en")} clicks in 28 days and now ${fmtNum(p.now.clicks, "en")}. ${why.en}`,
            },
            bi(
              "Cómo: pon al día el texto (precios y datos de este año, fotos nuevas), responde las preguntas de la gente y vuelve a publicarla.",
              "How: update the text (this year's prices and facts, new photos), answer people's questions and publish it again.",
            ),
          ],
          "decay",
          saved.createdAt,
        ),
        impact: p.reason === "demand" ? 1 : p.clicksLost >= 10 ? 3 : 2,
        effort: 2,
        href: seo(ctx, "web", "decay"),
      });
    });
}

// ---------- 5. Páginas que compiten entre sí (cannibal) ----------

export const CANNIBAL_MAX = 5;

/** Dos páginas tuyas que se pelean la misma búsqueda (alta o media) → qué hacer con ellas. */
export function cannibalTasks(saved: Saved | null, ctx: RuleCtx): TaskDraft[] {
  const report = saved ? readCannibalReport(saved.data) : null;
  if (!saved || !report) return [];
  const out: TaskDraft[] = [];
  for (const issue of report.issues) {
    if (issue.severity === "baja" || issue.fix === "zones" || issue.pages.length < 2) continue;
    if (!isRelevantKeyword(issue.query, ctx.vocab)) continue;
    const main = issue.pages.find((p) => p.main) ?? issue.pages[0];
    const other = issue.pages.find((p) => p !== main) ?? issue.pages[1];
    const a = pathOf(main.url) || main.url;
    const b = pathOf(other.url) || other.url;
    const q = issue.query;
    const how: Bi =
      issue.fix === "merge"
        ? bi(
            `Une las dos páginas en una (deja ${a}) y haz que ${b} lleve a ella con una redirección 301.`,
            `Merge both pages into one (keep ${a}) and send ${b} to it with a 301 redirect.`,
          )
        : issue.fix === "retarget"
          ? bi(`Deja ${a} para «${q}» y cambia el título y el tema de ${b} hacia otra búsqueda.`, `Keep ${a} for “${q}” and change the title and topic of ${b} to another search.`)
          : bi(
              `Desde ${b}, pon un enlace a ${a} con el texto «${issue.anchor || q}».`,
              `On ${b}, add a link to ${a} with the text “${issue.anchor || q}”.`,
            );
    out.push(
      task({
        key: `cannibal:${norm(q)}`,
        source: "content",
        area: "contenido",
        title: { es: `Dos páginas tuyas compiten por «${q}»`, en: `Two of your pages compete for “${q}”` },
        detail: detailOf(
          [bi("Cuando dos páginas tuyas se pelean la misma búsqueda, Google no sabe cuál mostrar y las dos salen más abajo.", "When two of your pages fight for the same search, Google doesn't know which to show and both rank lower."), how],
          "cannibal",
          saved.createdAt,
        ),
        impact: issue.severity === "alta" ? 3 : 2,
        effort: issue.fix === "merge" ? 3 : issue.fix === "retarget" ? 2 : 1,
        href: seo(ctx, "web", "canibalizacion"),
      }),
    );
    if (out.length >= CANNIBAL_MAX) break;
  }
  return out;
}

// ---------- 6. Preguntas que nadie responde (questions) ----------

export const QUESTIONS_MAX_TASKS = 5;

/** Preguntas de «La gente también pregunta» que tu web todavía no responde → artículo. Ya vienen filtradas por relevancia. */
export function questionTasks(data: QuestionsData | null, ctx: RuleCtx): TaskDraft[] {
  if (!data || !data.checkedAt) return [];
  const out: TaskDraft[] = [];
  for (const g of data.groups)
    for (const q of g.questions) {
      if (q.answered || out.length >= QUESTIONS_MAX_TASKS) continue;
      if (!isRelevantKeyword(q.question, ctx.vocab) && !isRelevantKeyword(g.keyword, ctx.vocab)) continue;
      out.push(
        task({
          key: `question:${norm(q.question)}`,
          source: "content",
          area: "contenido",
          title: { es: `Responde en tu web: «${q.question}»`, en: `Answer on your website: “${q.question}”` },
          detail: detailOf(
            [
              bi(
                `La gente le pregunta esto a Google cuando busca «${g.keyword}» y tu página todavía no lo responde.`,
                `People ask Google this when they search “${g.keyword}” and your website doesn't answer it yet.`,
              ),
              bi(
                "Cómo: escribe un artículo corto que lo responda (el escritor de artículos te ayuda) o agrega la respuesta a tu página del servicio.",
                "How: write a short article that answers it (the article writer helps) or add the answer to your service page.",
              ),
            ],
            "questions",
            data.checkedAt,
          ),
          impact: out.length < 2 ? 2 : 1,
          effort: 2,
          href: writerHref(ctx, q.topic || q.question),
        }),
      );
    }
  return out;
}

// ---------- 7. Casi en la primera página (rank + keywords) ----------

export const NEAR_MAX = 8;

/** Impacto según cuánta gente lo busca al mes (sin dato = bajo). */
const volumeImpact = (v: number | null | undefined): 1 | 2 | 3 => (v === null || v === undefined || v <= 0 ? 1 : v >= 50 ? 3 : v >= 10 ? 2 : 1);

/**
 * Tus palabras clave en los puestos 4 a 20 («casi»): subir unos lugares trae muchos más clics.
 * Las que no salen en los primeros 20 y sí se buscan → «Crea una página para…».
 * `rank`: los últimos reportes de posiciones (del más nuevo al más viejo; se toma el más nuevo de cada zona).
 */
export function rankTasks(rank: Saved[], keywords: Saved[], ctx: RuleCtx): TaskDraft[] {
  const volumes = new Map<string, number>();
  for (const k of keywords) {
    const r = readKeywordsReport(k.data);
    if (!r) continue;
    for (const row of [...r.keywords, ...r.ideas]) if (row.volume !== null && !volumes.has(norm(row.keyword))) volumes.set(norm(row.keyword), row.volume);
  }
  const seenZones = new Set<number>();
  const best = new Map<string, { keyword: string; position: number | null; url: string | null; map: number | null; zone: string; at: Date | string }>();
  for (const s of rank) {
    const r = readRankReport(s.data);
    if (!r || seenZones.has(r.locationCode)) continue;
    seenZones.add(r.locationCode);
    for (const row of r.rows) {
      if (row.error || !isRelevantKeyword(row.keyword, ctx.vocab)) continue;
      const k = norm(row.keyword);
      const cur = best.get(k);
      const better = !cur || (row.position !== null && (cur.position === null || row.position < cur.position));
      if (better) best.set(k, { keyword: row.keyword, position: row.position, url: row.url, map: row.localPack?.position ?? null, zone: r.location, at: s.createdAt });
    }
  }
  const out: TaskDraft[] = [];
  for (const [k, x] of best) {
    const volume = volumes.get(k) ?? null;
    const vol = volume ? bi(`Unas ${fmtNum(volume, "es")} personas la buscan al mes.`, `About ${fmtNum(volume, "en")} people search it each month.`) : null;
    if (x.position !== null && x.position >= 4 && x.position <= 20) {
      const page1 = x.position <= 10;
      const where = x.url ? bi(`Google muestra tu página ${pathOf(x.url) || x.url}.`, `Google shows your page ${pathOf(x.url) || x.url}.`) : null;
      out.push(
        task({
          key: `near:${k}`,
          source: "keywords",
          area: "google",
          title: page1
            ? { es: `Sube al top 3 con «${x.keyword}» (estás ${x.position}°)`, en: `Reach the top 3 for “${x.keyword}” (you're #${x.position})` }
            : { es: `Casi en la primera página: «${x.keyword}» (puesto ${x.position})`, en: `Almost on page one: “${x.keyword}” (#${x.position})` },
          detail: detailOf(
            [
              page1
                ? bi("Estás en la primera página, pero los 3 primeros se llevan casi todos los clics.", "You're on page one, but the top 3 get almost all the clicks.")
                : bi("Estás al principio de la segunda página: casi nadie llega ahí, pero te falta poco.", "You're near the top of page two: almost nobody gets there, but you're close."),
              vol,
              where,
              bi(
                "Cómo: pon la búsqueda en el título y en el título principal (H1), agrega texto útil con fotos y preguntas frecuentes, y enlázala desde tu página de inicio.",
                "How: put the search in the title and the main heading (H1), add useful text with photos and FAQs, and link to it from your home page.",
              ),
            ],
            "rank",
            x.at,
          ),
          impact: volumeImpact(volume),
          effort: 2,
          href: x.url ? seo(ctx, "web", "paginas") : writerHref(ctx, x.keyword),
        }),
      );
    } else if (x.position === null && volume !== null && volume >= 10) {
      const onMap = x.map !== null && x.map <= 3;
      out.push(
        task({
          key: `create:${k}`,
          source: "keywords",
          area: "contenido",
          title: { es: `Crea una página para «${x.keyword}»`, en: `Create a page for “${x.keyword}”` },
          detail: detailOf(
            [
              bi("No sales en los primeros 20 resultados de Google para esta búsqueda.", "You're not in Google's top 20 results for this search."),
              vol,
              onMap && bi("En el mapa sí sales entre los 3 primeros; una página propia te suma la lista normal.", "You do show in the top 3 on the map; a dedicated page adds the regular list."),
              bi("Cómo: una página o un artículo dedicado a esta búsqueda, con tu zona, precios o rangos, fotos reales y preguntas frecuentes.", "How: a page or article dedicated to this search, with your area, prices or ranges, real photos and FAQs."),
            ],
            "rank",
            x.at,
          ),
          impact: onMap ? 1 : clamp3(volumeImpact(volume)),
          effort: 3,
          href: writerHref(ctx, x.keyword),
        }),
      );
    }
  }
  return out.sort((a, b) => taskScore(b) - taskScore(a)).slice(0, NEAR_MAX);
}

// ---------- 8. Search Console: conectar, casi en la primera página y pocos clics ----------

export const GSC_NEAR_MAX = 5;
export const GSC_CTR_MAX = 3;

/** Sin Search Console conectado → «Conecta Search Console». Conectado → las búsquedas reales casi en la primera página. */
export function gscTasks(input: { connected: boolean; saved: Saved | null; now: Date }, ctx: RuleCtx): TaskDraft[] {
  if (!input.connected) {
    if (!ctx.website.trim()) return [];
    return [
      task({
        key: "setup:gsc",
        source: "gsc",
        area: "google",
        title: bi("Conecta Search Console", "Connect Search Console"),
        detail: detailOf(
          [
            bi(
              "Search Console es gratis y te dice las búsquedas reales con las que la gente te encuentra en Google. Con eso el plan te avisa qué páginas pierden visitas y cuáles están casi en la primera página.",
              "Search Console is free and shows the real searches people use to find you on Google. With it, the plan tells you which pages are losing visits and which are almost on page one.",
            ),
          ],
          "business",
          input.now,
        ),
        impact: 2,
        effort: 1,
        href: `/b/${ctx.businessId}/conexiones`,
      }),
    ];
  }
  const report = input.saved ? asGscReport(input.saved.data) : null;
  if (!input.saved || !report) return [];
  const at = input.saved.createdAt;
  const keep = (q: string) => !!q.trim() && isRelevantKeyword(q, ctx.vocab) && !isBrandQuery(q, ctx.name);
  const near = report.opportunities
    .filter((r) => keep(r.key) && r.position >= 4 && r.position <= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, GSC_NEAR_MAX)
    .map((r) => {
      const pos = Math.round(r.position);
      return task({
        key: `near:${norm(r.key)}`,
        source: "gsc",
        area: "google",
        title: pos <= 10 ? { es: `Sube al top 3 con «${r.key}» (estás ${pos}°)`, en: `Reach the top 3 for “${r.key}” (you're #${pos})` } : { es: `Casi en la primera página: «${r.key}» (puesto ${pos})`, en: `Almost on page one: “${r.key}” (#${pos})` },
        detail: detailOf(
          [
            bi(
              `Google te mostró ${fmtNum(r.impressions, "es")} veces para esta búsqueda en 28 días y te hicieron ${plural(r.clicks, "clic", "clics")}. Subir unos lugares trae muchos más.`,
              `Google showed you ${fmtNum(r.impressions, "en")} times for this search in 28 days and you got ${plural(r.clicks, "click", "clicks")}. Moving up a few spots brings many more.`,
            ),
            bi(
              "Cómo: pon la búsqueda en el título y en el título principal (H1) de la página que sale, agrega texto útil y enlázala desde tu inicio.",
              "How: put the search in the title and main heading (H1) of the page that shows, add useful text and link to it from your home page.",
            ),
          ],
          "gsc",
          at,
        ),
        impact: r.impressions >= 200 ? 3 : r.impressions >= 50 ? 2 : 1,
        effort: 2,
        href: seo(ctx, "web", "paginas"),
      });
    });
  const ctr = report.lowCtr
    .filter((r) => keep(r.key))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, GSC_CTR_MAX)
    .map((r) =>
      task({
        key: `ctr:${norm(r.key)}`,
        source: "gsc",
        area: "google",
        title: { es: `Te ven pero no hacen clic: «${r.key}»`, en: `People see you but don't click: “${r.key}”` },
        detail: detailOf(
          [
            bi(
              `Sales arriba (puesto ${Math.round(r.position)}) pero solo el ${(r.ctr * 100).toFixed(1)} % hace clic.`,
              `You rank high (#${Math.round(r.position)}) but only ${(r.ctr * 100).toFixed(1)}% click.`,
            ),
            bi(
              "Cómo: cambia el título y la descripción de esa página para que inviten a entrar (precio, garantía, tu zona, «llama hoy»).",
              "How: change that page's title and description so they invite the click (price, warranty, your area, “call today”).",
            ),
          ],
          "gsc",
          at,
        ),
        impact: 2,
        effort: 1,
        href: seo(ctx, "web", "paginas"),
      }),
    );
  return [...near, ...ctr];
}

// ---------- 8b. Google Analytics: visitas reales de la página ----------

/** Visitas mínimas en 28 días para que el reparto de visitas (de dónde llegan) diga algo. */
export const GA4_MIN_SESSIONS = 50;
/** Menos de esto de las visitas llegando desde Google (gratis) = muy poco. */
export const GA4_LOW_ORGANIC = 0.15;
/** Páginas con muchas visitas donde la gente se va enseguida: como máximo estas tareas. */
export const GA4_BOUNCE_MAX = 3;

/**
 * Sin Google Analytics conectado → «Conecta Google Analytics». Con el último reporte: marcar las llamadas y
 * formularios como acciones importantes, muy pocas visitas desde Google y páginas por donde entran muchos y se van.
 */
export function ga4Tasks(input: { connected: boolean; saved: Saved | null; now: Date }, ctx: RuleCtx): TaskDraft[] {
  const href = seo(ctx, "web", "ga4");
  if (!input.connected) {
    if (!ctx.website.trim()) return [];
    return [
      task({
        key: "setup:ga4",
        source: "setup",
        area: "web",
        title: bi("Conecta Google Analytics", "Connect Google Analytics"),
        detail: detailOf(
          [
            bi(
              "Es gratis y te dice cuántas personas visitan tu página, de dónde llegan y cuántas te llaman o te escriben. Con eso el plan te avisa qué páginas espantan a la gente.",
              "It's free and tells you how many people visit your website, where they come from and how many call or message you. With it, the plan tells you which pages drive people away.",
            ),
            bi(
              "Si tu página todavía no tiene Google Analytics, pídele a quien la hizo que lo instale.",
              "If your website doesn't have Google Analytics yet, ask whoever built it to install it.",
            ),
          ],
          "business",
          input.now,
        ),
        impact: 1,
        effort: 1,
        href: `/b/${ctx.businessId}/conexiones#c-ga4`,
      }),
    ];
  }
  const report = input.saved ? readGa4Report(input.saved.data) : null;
  if (!input.saved || !report) return [];
  const at = input.saved.createdAt;
  const total = report.totals.sessions;
  const out: TaskDraft[] = [];

  if (total >= GA4_BUSY_PAGE && hasKeyEventsSetUp(report) === false)
    out.push(
      task({
        key: "ga4:key-events",
        source: "ga4",
        area: "web",
        title: bi("Marca las llamadas y formularios como acciones importantes en Analytics", "Mark calls and forms as key events in Analytics"),
        detail: detailOf(
          [
            bi(
              `Tu página tuvo ${fmtNum(total, "es")} visitas en 28 días, pero Analytics no cuenta cuántas terminaron en una llamada, un WhatsApp o un formulario. Sin eso no sabes qué te trae clientes.`,
              `Your website had ${fmtNum(total, "en")} visits in 28 days, but Analytics doesn't count how many ended in a call, a WhatsApp or a form. Without that you can't tell what brings you customers.`,
            ),
            bi(
              "Cómo: pídele a quien maneja tu página que mida los clics en tu teléfono y WhatsApp y el envío del formulario, y que los marque como «eventos clave» en Google Analytics (Administrar › Eventos clave).",
              "How: ask whoever runs your website to track clicks on your phone and WhatsApp and form submissions, and mark them as \"key events\" in Google Analytics (Admin › Key events).",
            ),
          ],
          "ga4",
          at,
        ),
        impact: 2,
        effort: 1,
        href,
      }),
    );

  const share = organicShare(report);
  if (total >= GA4_MIN_SESSIONS && share < GA4_LOW_ORGANIC) {
    const pct = Math.round(share * 100);
    out.push(
      task({
        key: "ga4:organic-low",
        source: "ga4",
        area: "google",
        title: { es: `Casi nadie llega desde Google: solo el ${pct} % de tus visitas`, en: `Hardly anyone comes from Google: only ${pct}% of your visits` },
        detail: detailOf(
          [
            bi(
              `De ${fmtNum(total, "es")} visitas en 28 días, solo ${pct} de cada 100 llegaron buscando en Google (gratis). Las demás vienen de redes, anuncios o de gente que ya te conoce.`,
              `Out of ${fmtNum(total, "en")} visits in 28 days, only ${pct} in 100 came from searching on Google (free). The rest come from social media, ads or people who already know you.`,
            ),
            bi(
              "Cómo: sigue las tareas de «Posiciones en Google» de este plan: una página por cada servicio con la búsqueda en el título, texto útil y tu zona.",
              "How: follow the \"Google rankings\" tasks in this plan: one page per service with the search in the title, useful text and your area.",
            ),
          ],
          "ga4",
          at,
        ),
        impact: 2,
        effort: 3,
        href,
      }),
    );
  }

  const bounce = report.landingPages
    .filter((p) => p.key.startsWith("/") && isLowEngagementPage(p, total))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, GA4_BOUNCE_MAX)
    .map((p) => {
      const path = p.key.split("?")[0] || "/";
      const pct = Math.round(p.engagementRate * 100);
      return task({
        key: `ga4:bounce:${path.toLowerCase()}`,
        source: "content",
        area: "web",
        title: { es: `La gente entra a «${path}» y se va enseguida`, en: `People land on “${path}” and leave right away` },
        detail: detailOf(
          [
            bi(
              `${fmtNum(p.sessions, "es")} visitas entraron por esta página en 28 días y solo el ${pct} % se quedó a ver (más de 10 segundos, otra página o una acción).`,
              `${fmtNum(p.sessions, "en")} visits landed on this page in 28 days and only ${pct}% stayed (over 10 seconds, another page or an action).`,
            ),
            bi(
              "Cómo: que arriba se vea de inmediato qué ofreces y en qué zona, una foto real de tu trabajo y un botón claro para llamar o escribir por WhatsApp. Revisa que cargue rápido en el celular.",
              "How: make what you offer and where clear right at the top, add a real photo of your work and a clear button to call or WhatsApp. Check that it loads fast on mobile.",
            ),
          ],
          "ga4",
          at,
        ),
        impact: p.sessions >= Math.max(100, total * 0.25) ? 3 : 2,
        effort: 2,
        href,
      });
    });
  return [...out, ...bounce];
}

// ---------- 9. Lo que tu competencia tiene y tú no (gap) ----------

export const GAP_MISSING_MAX = 6;
export const GAP_WEAK_MAX = 4;

/** «Te faltan» (solo lo que tiene que ver con el negocio) → «Crea una página…»; «estás más abajo» → «Sube con…». */
export function gapTasks(saved: Saved | null, ctx: RuleCtx): TaskDraft[] {
  const report = saved ? readGapReport(saved.data) : null;
  if (!saved || !report) return [];
  const rows = report.rows.filter((r) => isRelevantKeyword(r.keyword, ctx.vocab) && !isBrandQuery(r.keyword, ctx.name));
  const where = report.location.name ? bi(` en ${report.location.name}`, ` in ${report.location.name}`) : bi("", "");
  const comps = (r: (typeof rows)[number]) => {
    const list = r.competitors.slice(0, 3);
    return { es: list.map((c) => `${c.domain} (${c.position}°)`).join(", "), en: list.map((c) => `${c.domain} (#${c.position})`).join(", ") };
  };
  const missing = rows
    .filter((r) => r.type === "missing")
    .slice(0, GAP_MISSING_MAX)
    .map((r) =>
      task({
        key: `create:${norm(r.keyword)}`,
        source: "content",
        area: "contenido",
        title: { es: `Crea una página o artículo para «${r.keyword}»`, en: `Create a page or article for “${r.keyword}”` },
        detail: detailOf(
          [
            {
              es: `${r.volume ? `Unas ${fmtNum(r.volume, "es")} personas la buscan al mes${where.es}. ` : ""}Tu competencia sale: ${comps(r).es}. Tú no sales.`,
              en: `${r.volume ? `About ${fmtNum(r.volume, "en")} people search it each month${where.en}. ` : ""}Your competitors show up: ${comps(r).en}. You don't.`,
            },
            bi("Cómo: una página o un artículo dedicado a esta búsqueda (el escritor de artículos te lo arma con lo que sale en Google).", "How: a page or article dedicated to this search (the article writer builds it from what ranks on Google)."),
          ],
          "gap",
          saved.createdAt,
        ),
        impact: r.volume !== null && r.volume >= 100 ? 3 : r.volume !== null && r.volume >= 20 ? 2 : 1,
        effort: r.difficulty !== null && r.difficulty > 50 ? 3 : 2,
        href: writerHref(ctx, r.keyword),
      }),
    );
  const weak = rows
    .filter((r) => r.type === "weak" && r.yourPosition !== null)
    .slice(0, GAP_WEAK_MAX)
    .map((r) =>
      task({
        key: `near:${norm(r.keyword)}`,
        source: "keywords",
        area: "google",
        title: { es: `Sube con «${r.keyword}» (estás ${r.yourPosition}°)`, en: `Move up for “${r.keyword}” (you're #${r.yourPosition})` },
        detail: detailOf(
          [
            {
              es: `Tu competencia sale más arriba: ${comps(r).es}.${r.volume ? ` Unas ${fmtNum(r.volume, "es")} personas la buscan al mes${where.es}.` : ""}`,
              en: `Your competitors rank higher: ${comps(r).en}.${r.volume ? ` About ${fmtNum(r.volume, "en")} people search it each month${where.en}.` : ""}`,
            },
            bi("Cómo: mejora la página que sale (título, texto útil, fotos, preguntas frecuentes) y enlázala desde tu inicio.", "How: improve the page that shows (title, useful text, photos, FAQs) and link to it from your home page."),
          ],
          "gap",
          saved.createdAt,
        ),
        impact: volumeImpact(r.volume),
        effort: 2,
        href: seo(ctx, "web", "paginas"),
      }),
    );
  return [...missing, ...weak];
}

// ---------- 10. Enlaces (backlinks + borradores de contacto) ----------

export const LINKS_MAX = 6;
/** Spam de los enlaces que te llegan a partir del cual se sugiere revisarlos (0-100, DataForSEO). */
export const SPAM_REVIEW = 30;
/** Orden: directorios y asociaciones primero (fáciles y confiables), lo demás después. */
const HINT_ORDER: Record<LinkHint, number> = { directory: 0, association: 1, public: 2, supplier: 3, news: 4, blog: 5, forum: 6, other: 7, social: 8 };

const linkTitle = (hint: LinkHint, d: string): Bi =>
  hint === "directory"
    ? bi(`Regístrate en ${d}`, `Get listed on ${d}`)
    : hint === "association"
      ? bi(`Aparece en la lista de socios de ${d}`, `Get on ${d}'s member list`)
      : hint === "supplier"
        ? bi(`Pide a ${d} que te ponga en su lista de clientes`, `Ask ${d} to list you as a client`)
        : hint === "news"
          ? bi(`Sal en las noticias de ${d}`, `Get featured on ${d}`)
          : bi(`Consigue un enlace en ${d}`, `Get a link on ${d}`);

/** Sitios que enlazan a tu competencia y no a ti (directorios y asociaciones primero) y el aviso de enlaces sospechosos. */
export function backlinksTasks(saved: Saved | null, outreach: Saved | null, ctx: RuleCtx): TaskDraft[] {
  const report = saved ? readBacklinksReport(saved.data) : null;
  if (!saved || !report) return [];
  const store = outreach ? readOutreachStore(outreach.data) : null;
  const how = { es: hintText(translator("es")), en: hintText(translator("en")) };
  const own = normalizeDomain(ctx.website) ?? "";
  const pick = (g: GapDomain) => ({ g, hint: g.hint });
  const list = report.gap
    .map(pick)
    .filter(({ g, hint }) => hint !== "social" && (g.spamScore === null || g.spamScore < SPAM_REVIEW) && !(own && sameSite(g.domain, own)))
    .sort((a, b) => HINT_ORDER[a.hint] - HINT_ORDER[b.hint] || b.g.linksTo.length - a.g.linksTo.length || (b.g.rank ?? 0) - (a.g.rank ?? 0))
    .slice(0, LINKS_MAX);
  const out: TaskDraft[] = list.map(({ g, hint }) => {
    const draft = store?.drafts[g.domain];
    const tier = HINT_ORDER[hint];
    return task({
      key: `link:${g.domain}`,
      source: "links",
      area: "enlaces",
      title: linkTitle(hint, g.domain),
      detail: detailOf(
        [
          {
            es: `Este sitio enlaza a tu competencia (${g.linksTo.slice(0, 3).join(", ")}) y a ti no. Cada sitio confiable que te enlaza le dice a Google que tu negocio es real.`,
            en: `This site links to your competitors (${g.linksTo.slice(0, 3).join(", ")}) but not to you. Every trusted site that links to you tells Google your business is real.`,
          },
          { es: `Cómo: ${how.es[hint].how}`, en: `How: ${how.en[hint].how}` },
          draft && bi("Ya tienes los pasos (y el correo, si hace falta) preparados en «Enlaces».", "You already have the steps (and the email, if needed) ready in “Backlinks”."),
        ],
        "backlinks",
        saved.createdAt,
      ),
      impact: tier <= 1 && g.linksTo.length >= 2 ? 3 : tier <= 3 ? 2 : 1,
      effort: HINT_EASY[hint] ? 1 : hint === "news" || hint === "public" ? 3 : 2,
      href: seo(ctx, "competencia", "enlaces"),
    });
  });
  const spam = report.summary.spamScore;
  if (spam !== null && spam >= SPAM_REVIEW)
    out.push(
      task({
        key: "links:spam",
        source: "links",
        area: "enlaces",
        title: bi("Revisa los enlaces sospechosos", "Review suspicious links"),
        detail: detailOf(
          [
            bi(
              `Los enlaces que te llegan tienen un nivel de spam de ${spam} sobre 100. Casi siempre Google ignora solo esos enlaces: no hagas nada drástico.`,
              `The links pointing to you have a spam level of ${spam} out of 100. Google almost always ignores those links on its own: don't do anything drastic.`,
            ),
            bi(
              "Abre «Enlaces dañinos» y responde las dos preguntas: solo si Google te manda un aviso de «acción manual» hace falta desautorizarlos (disavow). Desautorizar enlaces buenos te hace daño, y esta app nunca lo hace sola.",
              "Open “Toxic links” and answer the two questions: you only need to disavow if Google sends you a “manual action” notice. Disavowing good links hurts you, and this app never does it on its own.",
            ),
          ],
          "backlinks",
          saved.createdAt,
        ),
        impact: spam >= 60 ? 2 : 1,
        effort: 2,
        href: `/b/${ctx.businessId}/enlaces`,
      }),
    );
  return out;
}

// ---------- 10b. Enlaces nuevos de sitios dañinos (toxic + backlinks) ----------

/**
 * Aviso cuando llegan muchos enlaces nuevos de sitios dañinos desde la revisión anterior (src/lib/toxic-links.ts:
 * toxicAlert compara las dos últimas revisiones de «Enlaces dañinos» y las dos últimas revisiones de enlaces). La
 * tarea manda a /enlaces a responder las dos preguntas; nunca dice que hay que desautorizar.
 */
export function toxicTasks(input: { toxic: Saved[]; backlinks: Saved[] }, ctx: RuleCtx): TaskDraft[] {
  const settings = input.toxic.map((s) => readSettings(s.data)).find(Boolean);
  const alert = toxicAlert({ toxic: input.toxic, backlinks: input.backlinks, ctx: { site: ctx.website, ownSites: settings?.ownSites ?? [], name: ctx.name, vocab: ctx.vocab } });
  if (!alert) return [];
  const n = alert.count;
  return [
    task({
      key: "toxic:new",
      source: "links",
      area: "enlaces",
      title: bi(`Llegaron ${n} enlaces nuevos de sitios dañinos`, `${n} new links from harmful sites arrived`),
      detail: detailOf(
        [
          {
            es: `Desde la revisión anterior te enlazan ${plural(n, "sitio nuevo", "sitios nuevos")} con pinta de spam (por ejemplo ${quoteList(alert.domains).es}).`,
            en: `Since the previous check, ${plural(n, "new spam-looking site links", "new spam-looking sites link")} to you (for example ${quoteList(alert.domains).en}).`,
          },
          alert.attack
            ? bi(
                "Son muchos más de lo normal: puede ser un ataque. Aun así, no subas nada a Google sin antes responder las dos preguntas de «¿Necesito desautorizar?».",
                "That's far more than usual: it may be an attack. Even so, don't upload anything to Google before answering the two questions in “Do I need to disavow?”.",
              )
            : bi(
                "Casi siempre Google los ignora solo: no hagas nada drástico. Abre «Enlaces dañinos» y responde las dos preguntas para saber si hace falta algo.",
                "Google almost always ignores them on its own: don't do anything drastic. Open “Toxic links” and answer the two questions to find out whether anything is needed.",
              ),
        ],
        alert.source,
        alert.at,
      ),
      impact: alert.attack ? 2 : 1,
      effort: 1,
      href: `/b/${ctx.businessId}/enlaces`,
    }),
  ];
}

// ---------- 11. Tu Perfil de Google y reseñas (gbp + reviews) ----------

/** Título corto de cada punto del perfil que falta. */
const GBP_TITLE: Record<string, Bi> = {
  claimed: bi("Reclama tu perfil de Google", "Claim your Google profile"),
  category: bi("Elige la categoría principal de tu perfil", "Pick your profile's primary category"),
  additional: bi("Agrega categorías a tu perfil de Google", "Add categories to your Google profile"),
  description: bi("Completa la descripción de tu perfil", "Complete your profile description"),
  hours: bi("Agrega tu horario en Google", "Add your hours on Google"),
  phone: bi("Agrega tu teléfono en Google", "Add your phone number on Google"),
  website: bi("Agrega tu página web a tu perfil", "Add your website to your profile"),
  photos: bi("Sube fotos a tu perfil de Google", "Upload photos to your Google profile"),
  rating: bi("Mejora tu calificación: pide reseñas a clientes contentos", "Improve your rating: ask happy customers for reviews"),
  reviewCount: bi("Pide reseñas a tus clientes", "Ask your customers for reviews"),
  recent: bi("Consigue reseñas nuevas este mes", "Get new reviews this month"),
  replyTime: bi("Contesta las reseñas más rápido", "Reply to reviews faster"),
  attributes: bi("Agrega atributos a tu perfil", "Add attributes to your profile"),
};
const GBP_EFFORT: Record<string, 1 | 2 | 3> = { claimed: 2, rating: 3, reviewCount: 2, recent: 2, photos: 2 };
const REVIEW_CHECKS = new Set(["rating", "reviewCount", "recent", "answered", "replyTime"]);

const answeredTitle = (n: number): Bi => (n > 0 ? bi(`Responde ${plural(n, "reseña", "reseñas")}`, `Reply to ${plural(n, "review", "reviews")}`) : bi("Responde tus reseñas", "Reply to your reviews"));

/** Lo que le falta a tu perfil (horario, categorías, fotos…), las reseñas sin contestar y la calificación frente a la competencia. */
export function gbpTasks(gbp: Saved | null, reviews: Saved | null, ctx: RuleCtx): TaskDraft[] {
  const rev = reviews ? readReviewsReport(reviews.data) : null;
  const report = gbp ? readGbpReport(gbp.data, rev?.stats ?? null) : null;
  const href = seo(ctx, "local", "perfil");
  if (!report || !gbp) {
    // Sin perfil guardado pero con reseñas: al menos las que faltan por contestar.
    if (!rev || !reviews || !rev.stats.unanswered) return [];
    return [
      task({
        key: "gbp:answered",
        source: "reviews",
        area: "maps",
        title: answeredTitle(rev.stats.unanswered),
        detail: detailOf(
          [
            bi(
              `Tienes ${plural(rev.stats.unanswered, "reseña", "reseñas")} sin contestar${rev.stats.unansweredLow ? ` (${rev.stats.unansweredLow} de 3 estrellas o menos)` : ""}. Contestar todas ayuda a salir en el mapa; la IA te escribe la respuesta.`,
              `You have ${plural(rev.stats.unanswered, "unanswered review", "unanswered reviews")}${rev.stats.unansweredLow ? ` (${rev.stats.unansweredLow} with 3 stars or fewer)` : ""}. Replying to all of them helps you show on the map; the AI drafts the reply.`,
            ),
          ],
          "reviews",
          reviews.createdAt,
        ),
        impact: rev.stats.unansweredLow ? 3 : 2,
        effort: 1,
        href,
      }),
    ];
  }
  const out: TaskDraft[] = [];
  for (const c of report.checklist) {
    if (c.ok) continue;
    const isReview = REVIEW_CHECKS.has(c.id);
    const unanswered = rev?.stats.unanswered ?? 0;
    out.push(
      task({
        key: `gbp:${c.id}`,
        source: isReview ? "reviews" : "local",
        area: "maps",
        title: c.id === "answered" ? answeredTitle(unanswered) : (GBP_TITLE[c.id] ?? { es: c.es.split(/(?<=[.:])\s/)[0].slice(0, 90), en: c.en.split(/(?<=[.:])\s/)[0].slice(0, 90) }),
        detail: detailOf([{ es: c.es, en: c.en }], c.id === "answered" || c.id === "recent" || c.id === "replyTime" ? "reviews" : "gbp", c.id === "answered" && reviews ? reviews.createdAt : gbp.createdAt),
        impact: c.priority === "high" ? 3 : c.priority === "medium" ? 2 : 1,
        effort: GBP_EFFORT[c.id] ?? 1,
        href,
      }),
    );
  }
  return out;
}

// ---------- 12. Mapa de calor (maprank) ----------

export const MAP_MAX = 4;

/** Búsquedas donde sales entre los 3 primeros del mapa en menos de la mitad de tu zona. `maps`: del más nuevo al más viejo. */
export function mapTasks(maps: Saved[], ctx: RuleCtx): TaskDraft[] {
  const seen = new Set<string>();
  const out: TaskDraft[] = [];
  for (const s of maps) {
    const m = readMapReport(s.data);
    if (!m) continue;
    const k = norm(m.keyword);
    if (seen.has(k)) continue;
    seen.add(k);
    const ok = m.points.filter((p) => !p.error);
    if (!ok.length || m.top3Share >= 50) continue;
    const top3 = ok.filter((p) => p.rank !== null && p.rank <= 3).length;
    const none = ok.filter((p) => p.rank === null).length;
    const rival = m.competitors.find((c) => c.title && c.title !== m.place.title);
    out.push(
      task({
        key: `map:${k}`,
        source: "local",
        area: "maps",
        title: { es: `Sube en Google Maps para «${m.keyword}»`, en: `Move up on Google Maps for “${m.keyword}”` },
        detail: detailOf(
          [
            {
              es: `Sales entre los 3 primeros en ${top3} de ${ok.length} puntos de tu zona${none ? ` y no sales en ${none}` : ""}.${rival ? ` Quien más aparece: ${rival.title}.` : ""}`,
              en: `You're in the top 3 at ${top3} of ${ok.length} points in your area${none ? ` and don't show at ${none}` : ""}.${rival ? ` Who shows up most: ${rival.title}.` : ""}`,
            },
            bi(
              "Cómo: pide reseñas que mencionen el servicio y tu barrio, completa tu perfil de Google y publica fotos y novedades cada semana.",
              "How: ask for reviews that mention the service and your neighborhood, complete your Google profile and post photos and updates every week.",
            ),
          ],
          "maprank",
          s.createdAt,
        ),
        impact: m.top3Share < 25 ? 3 : 2,
        effort: 2,
        href: seo(ctx, "local", "mapa"),
      }),
    );
    if (out.length >= MAP_MAX) break;
  }
  return out;
}

// ---------- 13. Visibilidad en las IAs (ai) ----------

export const AI_SOURCES_MAX = 3;
/** Fuentes que no son un lugar donde «aparecer» (buscadores y mapas: eso ya es tu perfil de Google). */
const NOT_A_LISTING = /^(google|bing|apple|waze|mapquest|yahoo|duckduckgo)\./;

/** Si ChatGPT, Gemini y Claude no te recomiendan, y los directorios que ellas citan donde todavía no estás. */
export function aiTasks(saved: Saved | null, ctx: RuleCtx): TaskDraft[] {
  const report = saved ? readVisibilityReport(saved.data) : null;
  if (!saved || !report || report.score === null) return [];
  const href = seo(ctx, "ia", "ia");
  const out: TaskDraft[] = [];
  const rivals = report.topCompetitors.map((c) => c.name).filter(Boolean);
  if (report.score < 50) {
    out.push(
      task({
        key: "ai:mentions",
        source: "ai",
        area: "ia",
        title: report.score === 0 ? bi("Las IAs todavía no te recomiendan", "AIs don't recommend you yet") : bi("Las IAs casi no te recomiendan", "AIs rarely recommend you"),
        detail: detailOf(
          [
            {
              es: `Te nombran en el ${report.score} % de las respuestas.${rivals.length ? ` En tu lugar recomiendan a ${quoteList(rivals).es}.` : ""}`,
              en: `They mention you in ${report.score}% of answers.${rivals.length ? ` Instead they recommend ${quoteList(rivals).en}.` : ""}`,
            },
            bi(
              "Cómo: las IAs repiten lo que leen en tu página y en directorios. Di claro en tu web qué haces y dónde, completa tu perfil de Google y aparece en los directorios que ellas citan.",
              "How: AIs repeat what they read on your website and in directories. Say clearly on your site what you do and where, complete your Google profile and get listed in the directories they cite.",
            ),
          ],
          "ai",
          saved.createdAt,
        ),
        impact: report.score === 0 ? 3 : 2,
        effort: 2,
        href,
      }),
    );
  }
  const negative = report.sentiment?.status === "ok" ? report.sentiment.negativa : 0;
  if (negative > 0)
    out.push(
      task({
        key: "ai:negative",
        source: "ai",
        area: "ia",
        title: bi("Revisa lo malo que dicen las IAs de ti", "Check the negative things AIs say about you"),
        detail: detailOf(
          [
            bi(
              `${plural(negative, "respuesta habla", "respuestas hablan")} mal de tu negocio. Mira de dónde lo sacan (reseñas, foros) y contesta o corrige en esos lugares.`,
              `${plural(negative, "answer speaks", "answers speak")} badly about your business. See where they got it from (reviews, forums) and reply or correct it there.`,
            ),
          ],
          "ai",
          saved.createdAt,
        ),
        impact: 2,
        effort: 2,
        href,
      }),
    );
  const own = siteDomain(ctx.website);
  const sources = report.topDomains
    .filter((d) => d.count >= 2 && !(own && sameSite(d.domain, own)) && !NOT_A_LISTING.test(d.domain) && linkHint(d.domain) === "directory")
    .slice(0, AI_SOURCES_MAX);
  for (const d of sources)
    out.push(
      task({
        key: `ai:source:${d.domain}`,
        source: "ai",
        area: "ia",
        title: bi(`Aparece en ${d.domain}`, `Get listed on ${d.domain}`),
        detail: detailOf(
          [
            bi(
              `Las IAs usaron ${d.domain} como fuente en ${d.count} respuestas sobre tu tipo de negocio. Regístrate gratis con tu nombre, teléfono, zona y la dirección de tu página, igual que en Google.`,
              `AIs used ${d.domain} as a source in ${d.count} answers about your kind of business. Sign up for free with your name, phone, area and website, the same as on Google.`,
            ),
          ],
          "ai",
          saved.createdAt,
        ),
        impact: 2,
        effort: 1,
        href,
      }),
    );
  return out;
}

// ---------- 14. Lo básico del negocio (setup) ----------

export type SetupInput = { website: string; keywords: number; zones: number; study: boolean; now: Date };

/** Lo que falta para que todo lo demás funcione: página web, palabras clave, zonas y el estudio. Van al diagnóstico guiado. */
export function setupTasks(input: SetupInput, ctx: RuleCtx): TaskDraft[] {
  const href = `/b/${ctx.businessId}/diagnostico`;
  const mk = (id: string, title: Bi, why: Bi, impact: 1 | 2 | 3): TaskDraft =>
    task({ key: `setup:${id}`, source: "setup", area: id === "website" ? "web" : id === "study" ? "marca" : "google", title, detail: detailOf([why], "business", input.now), impact, effort: 1, href });
  const out: TaskDraft[] = [];
  if (!input.website.trim())
    out.push(mk("website", bi("Agrega tu página web", "Add your website"), bi("Sin la dirección de tu página no podemos revisar cómo te encuentra Google.", "Without your website address we can't check how Google finds you."), 3));
  if (!input.keywords)
    out.push(mk("keywords", bi("Elige tus palabras clave", "Pick your keywords"), bi("Son las búsquedas por las que quieres salir en Google. Te proponemos unas y tú aceptas o quitas.", "They're the searches you want to show up for on Google. We suggest some and you accept or remove them."), 3));
  if (!input.zones)
    out.push(mk("zones", bi("Elige las zonas donde trabajas", "Pick the areas you serve"), bi("Google muestra resultados distintos en cada ciudad: dinos dónde están tus clientes.", "Google shows different results in each city: tell us where your customers are."), 2));
  if (!input.study)
    out.push(mk("study", bi("Haz el estudio de tu negocio", "Run your business study"), bi("La IA lee tu página y aprende qué vendes y a quién, para que el plan no sugiera nada que no tenga que ver contigo.", "The AI reads your website and learns what you sell and to whom, so the plan never suggests anything unrelated."), 2));
  return out;
}

// ---------- 15. Directorios y reseñas ----------

/** Cuántos de los directorios más importantes se piden en el plan (los demás quedan en la pantalla). */
export const DIR_TOP = 3;

export type DirectoryPlanInput = {
  /** Los directorios del negocio, del más importante al menos (directoriesFor en directories.ts). */
  dirs: { id: string; name: string; priority: 1 | 2 | 3; kind: "listing" | "check"; why?: Bi }[];
  listings: { directory: string; status: string; napOk?: boolean | null }[];
  /** Ya hay Perfil de Google guardado o lugar elegido en el mapa (cuenta como «ya estoy» en Google). */
  googleKnown: boolean;
  /** Diferencias de nombre, dirección o teléfono (napIssues en directories.ts). */
  issues: NapIssue[];
  /** Cuándo se guardó el Perfil de Google con el que se compararon. */
  napAt: Date | string | null;
  /** Hay link de reseñas (se sabe el place_id). */
  reviewLink: boolean;
  /** La última vez que se compartió el link (envío o copia). */
  lastShared: Date | string | null;
  now: Date;
};

/** Los 3 directorios más importantes donde no estás, los que tienen datos mal, NAP distinto y el link de reseñas sin compartir. */
export function directoryTasks(input: DirectoryPlanInput, ctx: RuleCtx): TaskDraft[] {
  const page = (hash: string) => `/b/${ctx.businessId}/directorios#${hash}`;
  const out: TaskDraft[] = [];
  const top = input.dirs.filter((d) => d.kind === "listing").slice(0, DIR_TOP);
  for (const d of top) {
    if (effectiveStatus(d.id, input.listings, { googleKnown: input.googleKnown }) !== "todo") continue;
    const google = d.id === "google";
    out.push(
      task({
        key: `dir:${d.id}`,
        source: "local",
        area: "maps",
        title: google ? bi("Crea o reclama tu Perfil de Google", "Create or claim your Google Business Profile") : bi(`Regístrate en ${d.name}`, `Get listed on ${d.name}`),
        detail: detailOf(
          [
            d.why,
            bi(
              "En «Directorios y reseñas» tienes el botón para buscar si ya estás, el de registrarte y tus datos listos para copiar y pegar iguales.",
              "In “Directories & reviews” you'll find a button to check if you're already there, one to sign up, and your details ready to copy and paste exactly the same.",
            ),
          ],
          "directories",
          input.now,
        ),
        impact: d.priority >= 3 ? 3 : 2,
        effort: google ? 2 : 1,
        href: page(`dir-${d.id}`),
      }),
    );
  }
  for (const l of input.listings) {
    const d = input.dirs.find((x) => x.id === l.directory);
    if (!d) continue;
    const fix = l.status === "needs-fix" || ((l.status === "listed" || l.status === "claimed") && l.napOk === false);
    if (!fix) continue;
    out.push(
      task({
        key: `dir-fix:${d.id}`,
        source: "local",
        area: "maps",
        title: bi(`Corrige tus datos en ${d.name}`, `Fix your details on ${d.name}`),
        detail: detailOf(
          [
            bi(
              "Marcaste que tu ficha tiene datos distintos. Google confía más en un negocio cuando el nombre, la dirección y el teléfono son iguales en todos lados: cópialos de la tarjeta «Tus datos oficiales».",
              "You marked that this listing has different details. Google trusts a business more when the name, address and phone match everywhere: copy them from the “Your official details” card.",
            ),
          ],
          "directories",
          input.now,
        ),
        impact: d.priority >= 3 ? 3 : 2,
        effort: 1,
        href: page(`dir-${d.id}`),
      }),
    );
  }
  if (input.issues.length) {
    const lines = input.issues.slice(0, 3).map(napIssueText);
    const more = input.issues.length - lines.length;
    out.push(
      task({
        key: "nap:mismatch",
        source: "local",
        area: "maps",
        title: bi("Pon el mismo nombre, dirección y teléfono en todos lados", "Use the same name, address and phone everywhere"),
        detail: detailOf(
          [
            bi(
              "Si Google ve datos distintos de tu negocio en distintos sitios, confía menos en ti y te muestra menos en el mapa.",
              "When Google sees different details for your business on different sites, it trusts you less and shows you less on the map.",
            ),
            { es: lines.map((l) => `• ${l.es}`).join("\n") + (more > 0 ? `\n• Y ${more} más.` : ""), en: lines.map((l) => `• ${l.en}`).join("\n") + (more > 0 ? `\n• And ${more} more.` : "") },
          ],
          input.napAt ? "gbp" : "business",
          input.napAt ?? input.now,
        ),
        impact: 3,
        effort: 1,
        href: page("datos"),
      }),
    );
  }
  if (input.reviewLink) {
    const last = input.lastShared ? new Date(input.lastShared) : null;
    const days = last ? Math.floor((input.now.getTime() - last.getTime()) / 86_400_000) : null;
    if (days === null || days > REVIEW_SHARE_DAYS)
      out.push(
        task({
          key: "reviews:share-link",
          source: "reviews",
          area: "maps",
          title: bi("Pide reseñas: comparte tu link de Google", "Ask for reviews: share your Google link"),
          detail: detailOf(
            [
              days === null
                ? bi("Todavía no has compartido tu link de reseñas desde la app.", "You haven't shared your review link from the app yet.")
                : bi(`Hace ${days} días que no compartes tu link de reseñas.`, `It's been ${days} days since you last shared your review link.`),
              bi(
                "Las reseñas nuevas ayudan mucho a salir en el mapa. Mándalo por email o SMS a clientes que te dieron permiso, o imprime la tarjeta con el código QR. Nunca ofrezcas nada a cambio: Google lo prohíbe.",
                "New reviews help a lot to show up on the map. Send it by email or SMS to customers who gave you permission, or print the card with the QR code. Never offer anything in return: Google forbids it.",
              ),
            ],
            "business",
            input.now,
          ),
          impact: 2,
          effort: 1,
          href: page("resenas"),
        }),
      );
  }
  return out;
}

// ---------- Juntar y guardar ----------

/** Junta las tareas de todas las reglas: sin repetir la misma clave (gana la primera, por eso el orden importa). */
export function mergeDrafts(...lists: TaskDraft[][]): TaskDraft[] {
  const seen = new Set<string>();
  const out: TaskDraft[] = [];
  for (const list of lists)
    for (const d of list) {
      if (seen.has(d.key)) continue;
      seen.add(d.key);
      out.push(d);
    }
  return out;
}

/** Lo que ya está guardado de una tarea (lo que importa para decidir qué hacer con ella). */
export type ExistingTask = { id: string; key: string; status: string };

export type PlanChanges = {
  /** Tareas nuevas (quedan "todo"). */
  create: TaskDraft[];
  /** Tareas que ya estaban: se refrescan los textos y lastSeen; el estado queda como estaba (las "gone" vuelven a "todo"). */
  update: { id: string; draft: TaskDraft; status: "todo" | "done" | "dismissed" }[];
  /** Tareas "todo" que ya no salen en ningún reporte: pasan a "gone". */
  gone: string[];
  /** Tareas abiertas después de los cambios. */
  open: number;
};

/**
 * Qué cambiar en la tabla: nuevas → todo; las que ya estaban conservan hecha/no aplica; las "todo" que ya no salen →
 * gone (las hechas quedan hechas). Como máximo `cap` abiertas: entran primero las de más puntaje (taskScore).
 */
export function planChanges(existing: ExistingTask[], drafts: TaskDraft[], cap = PLAN_CAP): PlanChanges {
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const sorted = mergeDrafts(drafts)
    .map((d, i) => ({ d, i }))
    .sort((a, b) => taskScore(b.d) - taskScore(a.d) || a.i - b.i)
    .map((x) => x.d);
  const create: TaskDraft[] = [];
  const update: PlanChanges["update"] = [];
  const kept = new Set<string>();
  let open = 0;
  for (const d of sorted) {
    const ex = byKey.get(d.key);
    if (ex && (ex.status === "done" || ex.status === "dismissed")) {
      update.push({ id: ex.id, draft: d, status: ex.status });
      kept.add(d.key);
      continue;
    }
    if (open >= cap) continue;
    open++;
    kept.add(d.key);
    if (ex) update.push({ id: ex.id, draft: d, status: "todo" });
    else create.push(d);
  }
  const gone = existing.filter((e) => e.status === "todo" && !kept.has(e.key)).map((e) => e.id);
  return { create, update, gone, open };
}
