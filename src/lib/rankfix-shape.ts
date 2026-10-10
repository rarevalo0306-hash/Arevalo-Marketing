// «✨ Que la IA mejore mis posiciones»: lo puro (sin base de datos ni red; lo usan el servidor en rankfix.ts, el
// navegador en components/rankfix y las pruebas en tests/rankfix-shape.test.ts).
// 1. El plan (gratis): para cada búsqueda donde no sales o sales lejos, qué hace la IA y por qué, con reglas.
// 2. El costo: «hasta US$X.XX» con los precios reales (búsqueda en Google, escritura, traducción, foto, arreglo web).
// 3. El trabajo guardado (SeoReport kind "rankfix"): cada artículo pasa por escribir → versión web → foto, se guarda
//    después de cada paso y nunca se pasa del monto autorizado. Si se corta, sigue donde quedó.
import { absUrl, renderPrompt, type PromptContext, type PromptItem, type PromptLang } from "@/lib/seo/prompt-core";
import { estimateForInstructions } from "@/lib/webfix-shape";

export type Bi = { es: string; en: string };

/** Artículos nuevos por ronda, como máximo (lo demás queda para la próxima vez). */
export const MAX_NEW_ARTICLES = 5;
/** Las mismas búsquedas que cubren las instrucciones de posiciones (rankItems: 12 como máximo). */
export const MAX_SEARCHES = 12;
/** Un artículo publicado hace menos de esto todavía «está en camino»: Google tarda en notarlo. */
export const RECENT_DAYS = 28;
/** El título del arreglo de la web (va en el pull request). */
export const FIX_TITLE = "Mejorar mis posiciones";

// ---------- Precios ----------

/** Precio de lista de cada IA de texto (US$ por millón de tokens), como en webfix-shape (Gemini Flash). */
export const TEXT_PRICES: Record<string, { inputPerM: number; outputPerM: number }> = {
  gemini: { inputPerM: 0.3, outputPerM: 2.5 },
  openai: { inputPerM: 0.25, outputPerM: 2 },
  claude: { inputPerM: 5, outputPerM: 25 },
};
/** Lo que suele leer y escribir la IA para un artículo (las metas de Google + el artículo con su razonamiento). */
export const WRITE_AI = { promptChars: 16_000, outputTokens: 12_000 };

/** Centavos que cuesta, como mucho, que la IA escriba un artículo. Una IA desconocida se cuenta como la más cara. */
export function writeAiCents(provider: string | null | undefined): number {
  const p = TEXT_PRICES[provider ?? ""] ?? TEXT_PRICES.claude;
  const usd = ((WRITE_AI.promptChars / 4) * p.inputPerM + WRITE_AI.outputTokens * p.outputPerM) / 1_000_000;
  return Math.max(1, Math.ceil(usd * 100));
}

export type Prices = {
  /** Búsqueda en Google del escritor (WRITER_SERP_COST × 100). */
  serpCents: number;
  /** La IA escribe el artículo (writeAiCents). */
  writeCents: number;
  /** Traducir para la web bilingüe (SITE_TEXT_CENTS, ~1 centavo). */
  textCents: number;
  /** Una foto con IA (AI_IMAGE_CENTS del proveedor); 0 si no hay IA de imágenes. */
  imageCents: number;
  /** Para estimar el arreglo de la web: las letras de archivos que se leen (PICK_DEFAULTS.budget). */
  fileBudget: number;
};

/** Lo que puede costar un artículo nuevo: Google + escribir + traducir (+ foto con IA si ninguna de la biblioteca va). */
export const articleCents = (p: Prices, photo: boolean) => p.serpCents + p.writeCents + p.textCents + (photo ? p.imageCents : 0);

/** «US$0.04» redondeando hacia arriba al centavo (es un «hasta»); lo que cuesta menos de un centavo, «US$0.002». */
export const usd = (cents: number) =>
  cents > 0 && cents < 1 ? `US$${(cents / 100).toFixed(3).replace(/0+$/, "")}` : `US$${(Math.max(0, Math.ceil(cents - 1e-9)) / 100).toFixed(2)}`;

// ---------- El plan ----------

/** ¿Esta búsqueda entra? Las mismas reglas que rankItems: no sales, lejos, casi, solo el mapa, o la página es de otra cosa. */
export function coversSearch(verdict: string, mismatch: boolean): boolean {
  return verdict === "none" || verdict === "far" || verdict === "close" || verdict === "map" || mismatch;
}

/** Lo que el servidor ya sabe de cada búsqueda (gratis: posiciones, auditoría, artículos y biblioteca). */
export type SearchFacts = {
  keyword: string;
  position: number | null;
  mapPosition: number | null;
  /** La página que trata de otra cosa (rowAdvice). */
  mismatch: boolean;
  /** La página del negocio que muestra Google, si sale. */
  rankingUrl: string | null;
  rankingIsHome: boolean;
  rankingLabel: string;
  /** Una página del sitio (no la de inicio) que ya trata del tema (auditoría, «Mejora tus páginas», posiciones). */
  sitePage: { url: string; label: string } | null;
  /** Un artículo del escritor sobre ese tema (el publicado primero). */
  article: { id: string; title: string; publishedUrl: string; publishedAt: string } | null;
  /** Hay una foto de la biblioteca que va clarísimo con el tema (así la foto con IA no se cuenta). */
  photoFits: boolean;
};

export type RowAction = "improve" | "write" | "onway" | "wait";

export type PlanRow = {
  key: string;
  keyword: string;
  position: number | null;
  mapPosition: number | null;
  action: RowAction;
  why: Bi;
  /** «Mejorar»: la página a mejorar. */
  targetUrl: string;
  targetLabel: string;
  /** «En camino» o «Espera»: a dónde mirar (el artículo, el arreglo abierto). */
  href: string;
  /** «Escribir»: puede hacer falta una foto con IA. */
  photo: boolean;
  articleId: string;
};

export type PlanContext = {
  /** Hay un arreglo de la web abierto (esperando revisión o preparándose). */
  fixOpen: boolean;
  /** Las páginas de ese arreglo. */
  fixUrls: string[];
  /** El panel de revisión de los arreglos. */
  fixHref: string;
  /** Se pueden preparar arreglos de la web (Gemini conectado). */
  fixReady: boolean;
  writerHref: (articleId: string) => string;
  now: Date;
  /** ¿Dos búsquedas son el mismo tema? (para no escribir dos artículos iguales). */
  sameTopic?: (a: string, b: string) => boolean;
};

export const rowKey = (keyword: string) => keyword.replace(/\s+/g, " ").trim().toLowerCase();

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Para comparar direcciones: sin https, sin www, sin / final, sin ?… ni #…. */
export function normUrl(u: string): string {
  try {
    const x = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    return `${x.hostname.replace(/^www\./, "").toLowerCase()}${x.pathname.replace(/\/+$/, "")}`;
  } catch {
    return u.trim().toLowerCase();
  }
}

const daysSince = (iso: string, now: Date) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / 86_400_000)) : Infinity;
};

const L = (es: string, en: string): Bi => ({ es, en });

/** Qué hacer con una búsqueda, solo con reglas (sin IA). */
function decide(f: SearchFacts, ctx: PlanContext): Pick<PlanRow, "action" | "why" | "targetUrl" | "targetLabel" | "href" | "articleId"> {
  const none = { targetUrl: "", targetLabel: "", href: "", articleId: "" };
  let target: { url: string; label: string } | null = null;
  let why: Bi;
  const a = f.article;
  if (a && !a.publishedUrl)
    return { ...none, action: "onway", articleId: a.id, href: ctx.writerHref(a.id), why: L(`Ya tienes un artículo escrito sobre esto («${a.title}»): falta publicarlo.`, `You already have an article written about this (“${a.title}”): it just needs publishing.`) };
  if (a) {
    const days = daysSince(a.publishedAt, ctx.now);
    if (days < RECENT_DAYS)
      return {
        ...none,
        action: "onway",
        articleId: a.id,
        href: a.publishedUrl,
        why:
          days === 0
            ? L(`Tu artículo «${a.title}» se publicó hoy: Google tarda unas semanas en notarlo.`, `Your article “${a.title}” was published today: Google takes a few weeks to notice.`)
            : L(`Tu artículo «${a.title}» se publicó hace ${days} ${days === 1 ? "día" : "días"}: Google tarda unas semanas en notarlo.`, `Your article “${a.title}” was published ${days} ${days === 1 ? "day" : "days"} ago: Google takes a few weeks to notice.`),
      };
    target = { url: a.publishedUrl, label: a.title };
    why = L(`Tu artículo «${a.title}» ya está en tu web pero no sube: hay que reforzarlo.`, `Your article “${a.title}” is already on your website but isn't moving up: it needs strengthening.`);
  } else if (f.rankingUrl && !f.mismatch && !f.rankingIsHome) {
    target = { url: f.rankingUrl, label: f.rankingLabel };
    why = L(`Google ya muestra tu página «${f.rankingLabel}» para esta búsqueda: hay que reforzarla.`, `Google already shows your page “${f.rankingLabel}” for this search: it needs strengthening.`);
  } else if (f.sitePage) {
    target = f.sitePage;
    why = L(`Tu página «${f.sitePage.label}» ya habla de esto: hay que reforzarla para esta búsqueda.`, `Your page “${f.sitePage.label}” already covers this: it needs strengthening for this search.`);
  } else {
    why =
      f.mismatch && f.rankingUrl
        ? L(`La página tuya que sale («${f.rankingLabel}») trata de otra cosa: hace falta un artículo dedicado.`, `Your page that shows up (“${f.rankingLabel}”) is about something else: a dedicated article is needed.`)
        : f.rankingIsHome
          ? L("Solo sale tu página de inicio, que habla de todo: un artículo dedicado te ayuda a subir.", "Only your home page shows up, and it covers everything: a dedicated article helps you move up.")
          : L("Ninguna página de tu web habla de esto todavía.", "No page on your website covers this yet.");
    return { ...none, action: "write", why };
  }
  if (ctx.fixOpen) {
    if (ctx.fixUrls.some((u) => normUrl(u) === normUrl(target.url)))
      return { ...none, action: "onway", targetUrl: target.url, targetLabel: target.label, href: ctx.fixHref, why: L("Ya hay un arreglo para esa página esperando tu revisión.", "There's already a fix for that page waiting for your review.") };
    return { ...none, action: "wait", targetUrl: target.url, targetLabel: target.label, href: ctx.fixHref, why: L("Primero revisa los arreglos que ya están esperando.", "First review the fixes that are already waiting.") };
  }
  if (!ctx.fixReady)
    return { ...none, action: "wait", targetUrl: target.url, targetLabel: target.label, why: L("Para mejorar páginas hace falta la clave de Gemini en el servidor.", "Improving pages needs the Gemini key on the server.") };
  return { ...none, action: "improve", targetUrl: target.url, targetLabel: target.label, why };
}

/**
 * El plan, búsqueda por búsqueda (en el orden del reporte, máximo MAX_SEARCHES):
 * - «Ya está en camino»: hay un artículo sin publicar o publicado hace poco, o un arreglo abierto para esa página.
 * - «Mejorar una página que ya existe»: un artículo publicado hace tiempo, la página que muestra Google (si trata del
 *   tema y no es la de inicio) o una página del sitio que ya habla del tema.
 * - «Escribir un artículo nuevo»: ninguna página lo cubre. Dos búsquedas del mismo tema no dan dos artículos.
 * - «Espera»: hay que mejorar una página pero ya hay arreglos esperando la revisión del dueño.
 */
export function buildPlan(facts: SearchFacts[], ctx: PlanContext): PlanRow[] {
  const same = ctx.sameTopic ?? ((a: string, b: string) => fold(a) === fold(b));
  const rows: PlanRow[] = [];
  const seen = new Set<string>();
  for (const f of facts) {
    const key = rowKey(f.keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (rows.length >= MAX_SEARCHES) break;
    const d = decide(f, ctx);
    const row: PlanRow = { key, keyword: f.keyword.trim(), position: f.position, mapPosition: f.mapPosition, photo: d.action === "write" && !f.photoFits, ...d };
    if (row.action === "write") {
      const twin = rows.find((r) => r.action === "write" && same(r.keyword, row.keyword));
      if (twin) {
        row.action = "onway";
        row.photo = false;
        row.why = L(`Lo cubre el artículo nuevo sobre «${twin.keyword}» de esta misma lista.`, `The new article about “${twin.keyword}” in this same list covers it.`);
      }
    }
    rows.push(row);
  }
  return rows;
}

export const selectable = (r: Pick<PlanRow, "action">) => r.action === "improve" || r.action === "write";

/** Lo que va marcado al abrir el plan: todas las mejoras y los primeros MAX_NEW_ARTICLES artículos. */
export function defaultSelection(rows: PlanRow[]): string[] {
  let writes = 0;
  return rows.filter((r) => r.action === "improve" || (r.action === "write" && writes++ < MAX_NEW_ARTICLES)).map((r) => r.key);
}

/** ¿Se puede autorizar esta selección? Solo filas con trabajo, sin repetir, y como mucho MAX_NEW_ARTICLES artículos. */
export function checkSelection(rows: PlanRow[], keys: string[]): { ok: true; keys: string[] } | { ok: false; error: Bi } {
  const uniq = [...new Set(keys)];
  if (!uniq.length) return { ok: false, error: L("Marca al menos una búsqueda.", "Tick at least one search.") };
  const picked = uniq.map((k) => rows.find((r) => r.key === k));
  if (picked.some((r) => !r || !selectable(r))) return { ok: false, error: L("La lista cambió desde que la viste. Revísala otra vez.", "The list changed since you saw it. Check it again.") };
  if (picked.filter((r) => r?.action === "write").length > MAX_NEW_ARTICLES)
    return { ok: false, error: L(`Como mucho ${MAX_NEW_ARTICLES} artículos nuevos por vez.`, `At most ${MAX_NEW_ARTICLES} new articles at a time.`) };
  return { ok: true, keys: uniq };
}

export type Totals = {
  articles: number;
  photos: number;
  improves: number;
  /** Google + escribir + traducir, de todos los artículos. */
  articleCents: number;
  photoCents: number;
  fixCents: number;
  /** El total redondeado hacia arriba al centavo: lo que se autoriza. */
  totalCents: number;
  /** El costo de cada fila marcada (las mejoras se reparten el arreglo). */
  perRow: Record<string, number>;
  /** Búsquedas con trabajo que quedan sin marcar (para la próxima vez). */
  left: number;
};

/** El costo de lo marcado. `improveChars`: las letras de las instrucciones de cada mejora (un tope: «hasta»). */
export function planTotals(rows: PlanRow[], keys: string[], prices: Prices, improveChars: Record<string, number>): Totals {
  const on = new Set(keys);
  const writes = rows.filter((r) => r.action === "write" && on.has(r.key));
  const improves = rows.filter((r) => r.action === "improve" && on.has(r.key));
  const photos = writes.filter((r) => r.photo && prices.imageCents > 0).length;
  const articleCents = writes.length * (prices.serpCents + prices.writeCents + prices.textCents);
  const photoCents = photos * prices.imageCents;
  const chars = improves.reduce((s, r) => s + (improveChars[r.key] ?? 0), 0);
  const fixCents = improves.length ? estimateForInstructions(chars, prices.fileBudget) : 0;
  const perRow: Record<string, number> = {};
  for (const r of writes) perRow[r.key] = articleCents / writes.length + (r.photo ? prices.imageCents : 0);
  for (const r of improves) perRow[r.key] = fixCents / improves.length;
  return {
    articles: writes.length,
    photos,
    improves: improves.length,
    articleCents,
    photoCents,
    fixCents,
    totalCents: Math.max(0, Math.ceil(articleCents + photoCents + fixCents - 1e-9)),
    perRow,
    left: rows.filter((r) => selectable(r) && !on.has(r.key)).length,
  };
}

// ---------- Las instrucciones del arreglo de la web ----------

export type ImproveTarget = { keyword: string; position: number | null; url: string };

/** Igual que «Mejorar la página» de rankItems, pero con la página que eligió el plan. */
export function improveItems(list: ImproveTarget[], website: string, lang: PromptLang): PromptItem[] {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  return list.map((x) => ({
    tag: x.position === null ? t("no sale en los primeros 20", "not in the top 20") : t(`sale en el lugar ${x.position}`, `ranks #${x.position}`),
    title: t(`Mejorar la página para «${x.keyword}»`, `Improve the page for "${x.keyword}"`),
    how: [
      t(`Pon «${x.keyword}» en el título, el H1 y el primer párrafo de esta página, de forma natural.`, `Put "${x.keyword}" in this page's title, H1 and first paragraph, naturally.`),
      t("Agrega contenido útil sobre eso (qué incluye, para quién, zonas, preguntas frecuentes) y enlázala desde la página de inicio.", "Add useful content about it (what's included, who it's for, areas, FAQs) and link to it from the home page."),
    ],
    urls: [absUrl(x.url, website)],
  }));
}

/** El texto del arreglo: las instrucciones de posiciones solo con las mejoras marcadas. "" si no hay ninguna. */
export function improvePrompt(ctx: PromptContext, list: ImproveTarget[], lang: PromptLang): string {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  return renderPrompt({
    ctx,
    lang,
    task: t(
      "Estas son las búsquedas que el negocio quiere ganar en Google y donde todavía casi nadie lo encuentra. Mejora o crea las páginas.",
      "These are the searches the business wants to win on Google where almost nobody finds it yet. Improve or create the pages.",
    ),
    sections: [{ title: t("Búsquedas para mejorar", "Searches to improve"), items: improveItems(list, ctx.website, lang) }],
  });
}

// ---------- El trabajo guardado ----------

export type WriteStep = "write" | "site" | "photo";
export const WRITE_STEPS: WriteStep[] = ["write", "site", "photo"];

/**
 * Artículos: queued (le faltan pasos) → ready → published | publish_failed; o failed, stopped (paró por el monto
 * autorizado o queda para la próxima), removed («Quitar»).
 * Mejoras: fix (van en el arreglo de la web) → published; fix_blocked (ya había otro arreglo); fix_failed.
 */
export type ItemState = "queued" | "ready" | "failed" | "stopped" | "removed" | "published" | "publish_failed" | "fix" | "fix_blocked" | "fix_failed";

export type JobItem = {
  key: string;
  keyword: string;
  position: number | null;
  action: "write" | "improve";
  why: Bi;
  targetUrl: string;
  targetLabel: string;
  state: ItemState;
  /** El próximo paso del artículo ("done" = listo). */
  next: WriteStep | "done";
  /** El paso que empezó y no terminó (si se cortó, se sabe que ya se apartó su costo). */
  pending: WriteStep | "";
  /** Lo que se autorizó para esta fila (centavos). */
  estCents: number;
  spentCents: number;
  /** El plan contó una foto con IA. */
  photo: boolean;
  articleId: string;
  title: string;
  thumb: string;
  photoKind: "" | "library" | "generate" | "generated" | "stock" | "current";
  /** El texto para redes del escritor (para «Hacer un post»). */
  social: string;
  url: string;
  error: Bi | null;
};

export type JobStatus = "preparing" | "ready" | "publishing" | "done" | "closed";

export type JobFix = {
  /** El arreglo de la web (SeoReport kind "webfix"). */
  id: string;
  estimateCents: number;
  state: "none" | "started" | "blocked" | "failed";
  /** Lo último que pasó al publicar (esperando la vista previa, publicado…). */
  note: Bi | null;
  outcome: "" | "published" | "waiting" | "failed";
};

export type RankFixJob = {
  v: 1;
  status: JobStatus;
  lang: "es" | "en";
  authorizedCents: number;
  /** Lo gastado o apartado (los pasos de IA se cuentan por su tope; Google y las fotos por lo real). */
  spentCents: number;
  items: JobItem[];
  fix: JobFix;
  /** Por qué se detuvo antes de terminar (el monto autorizado). */
  stop: Bi | null;
  /** Hasta cuándo un trabajador tiene el trabajo (para no correr dos a la vez y retomar si se cortó). */
  lease: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
};

export type RankFixView = RankFixJob & { id: string };

/** Pasos: lo que se estima que tarda cada uno como máximo (no se empieza uno que no alcance a terminar). */
export const STEP_MS: Record<WriteStep, number> = { write: 150_000, site: 90_000, photo: 60_000 };
/** Tiempo de trabajo por llamada (la página tiene maxDuration = 300 s). */
export const RUN_BUDGET_MS = 270_000;
/** Más que maxDuration: si venció, el trabajador anterior ya no existe. */
export const LEASE_MS = 330_000;

export function newRankFixJob(input: { rows: PlanRow[]; keys: string[]; prices: Prices; totals: Totals; lang: "es" | "en"; now: Date }): RankFixJob {
  const at = input.now.toISOString();
  const on = new Set(input.keys);
  const items: JobItem[] = input.rows
    .filter((r) => selectable(r) && on.has(r.key))
    .map((r) => ({
      key: r.key,
      keyword: r.keyword,
      position: r.position,
      action: r.action === "write" ? "write" : "improve",
      why: r.why,
      targetUrl: r.targetUrl,
      targetLabel: r.targetLabel,
      state: r.action === "write" ? "queued" : "fix",
      next: r.action === "write" ? "write" : "done",
      pending: "",
      estCents: input.totals.perRow[r.key] ?? 0,
      spentCents: 0,
      photo: r.action === "write" && r.photo && input.prices.imageCents > 0,
      articleId: "",
      title: "",
      thumb: "",
      photoKind: "",
      social: "",
      url: "",
      error: null,
    }));
  return {
    v: 1,
    status: items.some((i) => i.action === "write") ? "preparing" : "ready",
    lang: input.lang,
    authorizedCents: input.totals.totalCents,
    spentCents: 0,
    items,
    fix: { id: "", estimateCents: 0, state: "none", note: null, outcome: "" },
    stop: null,
    lease: "",
    createdAt: at,
    updatedAt: at,
    publishedAt: "",
  };
}

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const biOf = (v: unknown): Bi | null => (v && typeof v === "object" ? { es: str((v as Bi).es, 500), en: str((v as Bi).en, 500) || str((v as Bi).es, 500) } : null);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const ITEM_STATES = ["queued", "ready", "failed", "stopped", "removed", "published", "publish_failed", "fix", "fix_blocked", "fix_failed"] as const;
const JOB_STATUSES = ["preparing", "ready", "publishing", "done", "closed"] as const;
const PHOTO_KINDS = ["", "library", "generate", "generated", "stock", "current"] as const;
const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : "");
/** Las miniaturas pueden ser de este mismo sitio (/media/…). */
const safeThumb = (u: string) => (/^https?:\/\//i.test(u) || /^\/(?!\/)/.test(u) ? u : "");

/** Lee un trabajo guardado sin confiar en su forma. null si no es un trabajo. */
export function readRankFixJob(data: unknown): RankFixJob | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.v !== 1 || !Array.isArray(d.items)) return null;
  const items: JobItem[] = d.items.slice(0, 40).map((raw) => {
    const x = (raw ?? {}) as Record<string, unknown>;
    const action = x.action === "improve" ? "improve" : "write";
    return {
      key: str(x.key, 200),
      keyword: str(x.keyword, 200),
      position: typeof x.position === "number" ? x.position : null,
      action,
      why: biOf(x.why) ?? { es: "", en: "" },
      targetUrl: safeHref(str(x.targetUrl, 600)),
      targetLabel: str(x.targetLabel, 300),
      state: oneOf(x.state, ITEM_STATES, action === "write" ? "queued" : "fix"),
      next: oneOf(x.next, ["write", "site", "photo", "done"] as const, action === "write" ? "write" : "done"),
      pending: oneOf(x.pending, ["", "write", "site", "photo"] as const, ""),
      estCents: num(x.estCents),
      spentCents: num(x.spentCents),
      photo: x.photo === true,
      articleId: str(x.articleId, 60),
      title: str(x.title, 300),
      thumb: safeThumb(str(x.thumb, 2000)),
      photoKind: oneOf(x.photoKind, PHOTO_KINDS, ""),
      social: str(x.social, 1500),
      url: safeHref(str(x.url, 600)),
      error: biOf(x.error),
    };
  });
  const f = (d.fix ?? {}) as Record<string, unknown>;
  return {
    v: 1,
    status: oneOf(d.status, JOB_STATUSES, "ready"),
    lang: d.lang === "en" ? "en" : "es",
    authorizedCents: num(d.authorizedCents),
    spentCents: num(d.spentCents),
    items,
    fix: {
      id: str(f.id, 60),
      estimateCents: num(f.estimateCents),
      state: oneOf(f.state, ["none", "started", "blocked", "failed"] as const, "none"),
      note: biOf(f.note),
      outcome: oneOf(f.outcome, ["", "published", "waiting", "failed"] as const, ""),
    },
    stop: biOf(d.stop),
    lease: str(d.lease, 40),
    createdAt: str(d.createdAt, 40),
    updatedAt: str(d.updatedAt, 40),
    publishedAt: str(d.publishedAt, 40),
  };
}

// ---------- La máquina de pasos ----------

const touch = (job: RankFixJob, now: Date): RankFixJob => ({ ...job, updatedAt: now.toISOString() });
const withItem = (job: RankFixJob, i: number, patch: Partial<JobItem>): RankFixJob => ({ ...job, items: job.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

export const leaseActive = (job: Pick<RankFixJob, "lease">, now: Date) => Boolean(job.lease) && Date.parse(job.lease) > now.getTime();
export const takeLease = (job: RankFixJob, now: Date): RankFixJob => touch({ ...job, lease: new Date(now.getTime() + LEASE_MS).toISOString() }, now);
export const dropLease = (job: RankFixJob, now: Date): RankFixJob => touch({ ...job, lease: "" }, now);

/** El próximo paso de algún artículo, o null si no queda nada por preparar. */
export function nextWork(job: Pick<RankFixJob, "items" | "status">): { index: number; step: WriteStep } | null {
  if (job.status !== "preparing") return null;
  const index = job.items.findIndex((x) => x.action === "write" && x.state === "queued" && x.next !== "done");
  return index < 0 ? null : { index, step: job.items[index].next as WriteStep };
}

/** Lo que se aparta antes de un paso: Google + escribir; traducir; la foto solo si hay que crearla. */
export function stepCents(step: WriteStep, prices: Prices, photoNeedsAi: boolean): number {
  if (step === "write") return prices.serpCents + prices.writeCents;
  if (step === "site") return prices.textCents;
  return photoNeedsAi ? prices.imageCents : 0;
}

/** ¿Alcanza lo autorizado para gastar esto más? Nunca se pasa del total. */
export const canAfford = (job: Pick<RankFixJob, "spentCents" | "authorizedCents">, cents: number) => job.spentCents + cents <= job.authorizedCents + 1e-9;

/** Antes de gastar: se aparta el costo y se anota el paso (se guarda antes de llamar a la IA). */
export function beginStep(job: RankFixJob, index: number, step: WriteStep, cents: number, now: Date): RankFixJob {
  const it = job.items[index];
  return touch(withItem({ ...job, spentCents: job.spentCents + cents }, index, { pending: step, spentCents: it.spentCents + cents }), now);
}

/**
 * Terminó un paso: avanza al siguiente. `reserved` es lo apartado en beginStep y `actual` lo que costó de verdad (si
 * se sabe: Google y las fotos); la diferencia se corrige. Si el dueño lo quitó mientras tanto, queda quitado.
 */
export function endStep(job: RankFixJob, index: number, step: WriteStep, patch: Partial<JobItem>, now: Date, cost?: { reserved: number; actual: number }): RankFixJob {
  const it = job.items[index];
  const fix = cost ? cost.actual - cost.reserved : 0;
  const nextStep: WriteStep | "done" = (WRITE_STEPS[WRITE_STEPS.indexOf(step) + 1] as WriteStep | undefined) ?? "done";
  const state: ItemState = it.state === "removed" ? "removed" : nextStep === "done" ? "ready" : it.state;
  return touch(withItem({ ...job, spentCents: Math.max(0, job.spentCents + fix) }, index, { ...patch, pending: "", next: nextStep, state, spentCents: Math.max(0, it.spentCents + fix) }), now);
}

/** Falló un paso: el artículo queda «no se pudo» (lo apartado no se devuelve: la IA pudo haber cobrado). */
export function failItem(job: RankFixJob, index: number, error: Bi, now: Date): RankFixJob {
  const it = job.items[index];
  return touch(withItem(job, index, { pending: "", state: it.state === "removed" ? "removed" : "failed", error }), now);
}

/** El próximo paso pasaría del monto autorizado: se para todo y lo que falta queda para la próxima vez. */
export function stopForBudget(job: RankFixJob, index: number, now: Date): RankFixJob {
  const items = job.items.map((x, j): JobItem => {
    if (j === index) return { ...x, pending: "", state: "stopped", error: L("Paró aquí para no pasar de lo que autorizaste.", "It stopped here so it wouldn't go over what you approved.") };
    if (x.action === "write" && x.state === "queued") return { ...x, pending: "", state: "stopped", error: L("Queda para la próxima vez.", "Left for next time.") };
    return x;
  });
  return touch(
    {
      ...job,
      items,
      status: "ready",
      lease: "",
      stop: L(`Paramos para no pasar de los ${usd(job.authorizedCents)} que autorizaste. Lo que está listo se puede publicar.`, `We stopped so we wouldn't go over the ${usd(job.authorizedCents)} you approved. What's ready can be published.`),
    },
    now,
  );
}

/**
 * Retomar: si el trabajador anterior se cortó (su tiempo venció) con un paso a medias, ese paso se vuelve a intentar,
 * pero lo que apartó queda contado (así nunca se pasa de lo autorizado aunque se repita). Devuelve los pasos cortados.
 */
export function resumeJob(job: RankFixJob, now: Date): { job: RankFixJob; interrupted: { index: number; step: WriteStep }[] } {
  if (leaseActive(job, now)) return { job, interrupted: [] };
  const interrupted: { index: number; step: WriteStep }[] = [];
  const items = job.items.map((x, index) => {
    if (!x.pending) return x;
    interrupted.push({ index, step: x.pending });
    return { ...x, pending: "" as const };
  });
  return { job: interrupted.length ? touch({ ...job, items }, now) : job, interrupted };
}

/** Sin pasos pendientes: el trabajo queda listo para revisar. */
export function settle(job: RankFixJob, now: Date): RankFixJob {
  if (job.status !== "preparing" || nextWork(job)) return job;
  return touch({ ...job, status: "ready", lease: "" }, now);
}

/** «Quitar»: el artículo no se publica (queda guardado en «Escribir artículo»). */
export function removeItem(job: RankFixJob, key: string, now: Date): RankFixJob {
  if (job.status === "publishing" || job.status === "done" || job.status === "closed") return job;
  const i = job.items.findIndex((x) => x.key === key && x.action === "write" && ["queued", "ready", "failed", "stopped", "publish_failed"].includes(x.state));
  if (i < 0) return job;
  return settle(touch(withItem(job, i, { state: "removed" }), now), now);
}

/** Paró antes de crear la foto con IA: se usa la foto del tema de la web (gratis) y queda listo. */
export function stockPhoto(job: RankFixJob, key: string, now: Date): RankFixJob {
  const i = job.items.findIndex((x) => x.key === key && x.state === "stopped" && x.next === "photo" && x.articleId);
  if (i < 0 || job.status === "publishing") return job;
  return touch(withItem(job, i, { state: "ready", next: "done", pending: "", photoKind: "stock", thumb: "", error: null }), now);
}

/** Los artículos que «Publicar todo» sube, en orden (los que fallaron al publicar se reintentan). */
export const toPublish = (job: Pick<RankFixJob, "items">) => job.items.filter((x) => x.action === "write" && (x.state === "ready" || x.state === "publish_failed") && x.articleId);

/** ¿Hay algo que publicar? Artículos listos o el arreglo de la web sin publicar. */
export function hasWorkToPublish(job: Pick<RankFixJob, "items" | "fix">): boolean {
  return toPublish(job).length > 0 || (job.fix.state === "started" && job.fix.outcome !== "published" && job.items.some((x) => x.state === "fix"));
}

export function markPublished(job: RankFixJob, key: string, url: string, now: Date): RankFixJob {
  const i = job.items.findIndex((x) => x.key === key);
  return i < 0 ? job : touch(withItem(job, i, { state: "published", url: safeHref(url), error: null }), now);
}

export function markPublishFailed(job: RankFixJob, key: string, error: Bi, now: Date): RankFixJob {
  const i = job.items.findIndex((x) => x.key === key);
  return i < 0 ? job : touch(withItem(job, i, { state: "publish_failed", error }), now);
}

/** Lo que pasó con el arreglo de la web al publicar. */
export function applyFixOutcome(job: RankFixJob, outcome: JobFix["outcome"], note: Bi | null, now: Date): RankFixJob {
  const items = job.items.map((x): JobItem =>
    x.state !== "fix" ? x : outcome === "published" ? { ...x, state: "published", error: null } : outcome === "failed" ? { ...x, state: "fix_failed", error: note } : x,
  );
  return touch({ ...job, items, fix: { ...job.fix, outcome, note } }, now);
}

/** Después de publicar: «done» si ya no queda nada; si algo falló o espera la vista previa, se puede volver a intentar. */
export function finishPublish(job: RankFixJob, now: Date): RankFixJob {
  return touch({ ...job, status: hasWorkToPublish(job) ? "ready" : "done", lease: "", publishedAt: now.toISOString() }, now);
}

export type JobPhase = "preparing" | "stopped" | "ready" | "partial" | "done" | "closed";

/** La pantalla que toca: preparando, parado por el monto, listo para revisar, publicado a medias, listo. */
export function jobPhase(job: Pick<RankFixJob, "status" | "stop" | "items" | "publishedAt">): JobPhase {
  if (job.status === "closed") return "closed";
  if (job.status === "done") return "done";
  if (job.status === "preparing" || job.status === "publishing") return "preparing";
  if (job.publishedAt && job.items.some((x) => x.state === "published")) return "partial";
  return job.stop ? "stopped" : "ready";
}

/** ¿Sigue abierto? (bloquea otra ronda). Los cerrados o terminados ya no. */
export const jobOpen = (job: Pick<RankFixJob, "status">) => job.status === "preparing" || job.status === "ready" || job.status === "publishing";

/** Cuántos artículos están listos y cuántos se están preparando (para el avance). */
export function progress(job: Pick<RankFixJob, "items">): { ready: number; total: number } {
  const writes = job.items.filter((x) => x.action === "write" && x.state !== "removed");
  return { ready: writes.filter((x) => x.state === "ready" || x.state === "published").length, total: writes.length };
}
