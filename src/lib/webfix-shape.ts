// «Arréglalo por mí»: la forma de cada arreglo guardado (SeoReport kind "webfix"), sus pasos en palabras sencillas,
// el nombre de la rama, el costo estimado de la IA, las instrucciones para la IA, el texto del pull request y el
// estado de la vista previa (Vercel) leído de GitHub. Todo puro (sin base de datos ni red): lo usan el servidor
// (webfix.ts), el navegador (el panel de revisión) y las pruebas (tests/webfix-shape.test.ts).
import { z } from "zod";
import type { CheckRun, CombinedStatus, IssueComment, PullInfo } from "@/lib/github";
import type { AppliedChange, Bi, DroppedEdit } from "@/lib/webfix-edits";

export type { Bi } from "@/lib/webfix-edits";

/** La conexión de la página web (Conexiones → Sitio web: repositorio, rama y llave), la misma del publicador de artículos. */
export const SITE_CHANNEL = "seo";

// ---------- El arreglo guardado ----------

/**
 * preparing: Matya lee la web, le pregunta a la IA y escribe la rama (ver `step`).
 * open: el PR está abierto esperando la vista previa y la aprobación del dueño.
 * nothing: la IA no propuso cambios seguros (no se escribió nada). failed: algo falló (ver `error`).
 * published: se publicó (por Matya o fuera de Matya). discarded: el dueño lo descartó. closed: se cerró fuera de Matya.
 */
export type FixStatus = "preparing" | "open" | "nothing" | "failed" | "published" | "discarded" | "closed";
export type FixStep = "reading" | "asking" | "writing";
export const OPEN_STATUSES: FixStatus[] = ["preparing", "open"];
/** Si un arreglo se queda «preparando» más de esto, algo se cortó: se da por fallido. */
export const STALE_PREPARING_MS = 15 * 60_000;

export type FixSource = {
  kind: "audit" | "prompt";
  /** Lo que dice el botón (ej. «Advertencias» o «Instrucciones de las preguntas»). */
  title: string;
  issueIds: string[];
  urls: string[];
};

export type FixChange = {
  path: string;
  /** Las direcciones de la web a las que afecta (vacío = todo el sitio). */
  pages: string[];
  why: Bi[];
  issueIds: string[];
  diff: string;
  created: boolean;
};

export type FixSkipped = { issue: string; reason: Bi };

export type BuildState = "waiting" | "pending" | "success" | "failure";

export type FixJob = {
  v: 1;
  status: FixStatus;
  step: FixStep;
  source: FixSource;
  repo: string;
  base: string;
  baseSha: string;
  branch: string;
  prNumber: number;
  prUrl: string;
  headSha: string;
  summary: Bi;
  changes: FixChange[];
  skipped: FixSkipped[];
  dropped: DroppedEdit[];
  /** Archivos que se leyeron (para mostrar cuánto revisó). */
  read: string[];
  estimateCents: number;
  costCents: number;
  build: BuildState;
  previewUrl: string;
  mergeable: boolean | null;
  error: Bi | null;
  /** Falta un permiso en la llave (para mostrar los pasos para agregarlo). */
  missing: "" | "pulls" | "contents" | "statuses" | "checks";
  outside: boolean;
  createdAt: string;
  updatedAt: string;
  checkedAt: string;
  publishedAt: string;
};

export function newJob(source: FixSource, repo: string, base: string, estimateCents: number, now: Date): FixJob {
  const at = now.toISOString();
  return {
    v: 1,
    status: "preparing",
    step: "reading",
    source,
    repo,
    base,
    baseSha: "",
    branch: "",
    prNumber: 0,
    prUrl: "",
    headSha: "",
    summary: { es: "", en: "" },
    changes: [],
    skipped: [],
    dropped: [],
    read: [],
    estimateCents,
    costCents: 0,
    build: "waiting",
    previewUrl: "",
    mergeable: null,
    error: null,
    missing: "",
    outside: false,
    createdAt: at,
    updatedAt: at,
    checkedAt: "",
    publishedAt: "",
  };
}

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const biOf = (v: unknown): Bi => (v && typeof v === "object" ? { es: str((v as Bi).es), en: str((v as Bi).en) } : { es: "", en: "" });
const strs = (v: unknown, max = 50) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : []);
const STATUSES: FixStatus[] = ["preparing", "open", "nothing", "failed", "published", "discarded", "closed"];

/** Lee un arreglo guardado (tolerante: lo que falta queda vacío). null si no es un arreglo. */
export function readJob(data: unknown): FixJob | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.v !== 1 || !STATUSES.includes(d.status as FixStatus)) return null;
  const src = (d.source ?? {}) as Record<string, unknown>;
  const base = newJob({ kind: src.kind === "prompt" ? "prompt" : "audit", title: str(src.title, 200), issueIds: strs(src.issueIds), urls: strs(src.urls) }, str(d.repo, 200), str(d.base, 200), Number(d.estimateCents) || 0, new Date(str(d.createdAt) || 0));
  return {
    ...base,
    status: d.status as FixStatus,
    step: (["reading", "asking", "writing"] as const).includes(d.step as FixStep) ? (d.step as FixStep) : "reading",
    baseSha: str(d.baseSha, 80),
    branch: str(d.branch, 200),
    prNumber: Number(d.prNumber) || 0,
    prUrl: str(d.prUrl, 300),
    headSha: str(d.headSha, 80),
    summary: biOf(d.summary),
    changes: Array.isArray(d.changes)
      ? d.changes.slice(0, 40).map((c) => {
          const x = c as Record<string, unknown>;
          return { path: str(x.path, 300), pages: strs(x.pages), why: Array.isArray(x.why) ? x.why.map(biOf) : [], issueIds: strs(x.issueIds), diff: str(x.diff, 8000), created: x.created === true };
        })
      : [],
    skipped: Array.isArray(d.skipped) ? d.skipped.slice(0, 60).map((s) => ({ issue: str((s as FixSkipped).issue, 200), reason: biOf((s as FixSkipped).reason) })) : [],
    dropped: Array.isArray(d.dropped) ? d.dropped.slice(0, 60).map((s) => ({ path: str((s as DroppedEdit).path, 300), reason: biOf((s as DroppedEdit).reason) })) : [],
    read: strs(d.read, 40),
    costCents: Number(d.costCents) || 0,
    build: (["waiting", "pending", "success", "failure"] as const).includes(d.build as BuildState) ? (d.build as BuildState) : "waiting",
    previewUrl: safeUrl(str(d.previewUrl, 400)),
    mergeable: typeof d.mergeable === "boolean" ? d.mergeable : null,
    error: d.error ? biOf(d.error) : null,
    missing: (["pulls", "contents", "statuses", "checks"] as const).includes(d.missing as "pulls") ? (d.missing as FixJob["missing"]) : "",
    outside: d.outside === true,
    updatedAt: str(d.updatedAt, 40),
    checkedAt: str(d.checkedAt, 40),
    publishedAt: str(d.publishedAt, 40),
  };
}

/** Solo direcciones https (para los enlaces «Ver cómo queda» y el PR). */
export function safeUrl(u: string): string {
  try {
    const x = new URL(u);
    return x.protocol === "https:" ? x.href : "";
  } catch {
    return "";
  }
}

/** ¿El arreglo sigue abierto (bloquea otro)? Los que se quedaron «preparando» demasiado ya no cuentan. */
export function isOpen(job: FixJob, now: Date): boolean {
  if (job.status === "open") return true;
  if (job.status !== "preparing") return false;
  return now.getTime() - new Date(job.updatedAt || job.createdAt).getTime() < STALE_PREPARING_MS;
}

// ---------- Rama ----------

/** «matya/arreglos-20261010-1405» en la hora del negocio. */
export function fixBranchName(now: Date, timeZone = "America/New_York"): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `matya/arreglos-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}`;
}

// ---------- Costo ----------

/** Precio de lista de Gemini Flash (US$ por millón de tokens) y lo que suele «pensar» y responder. */
export const AI_PRICE = { inputPerM: 0.3, outputPerM: 2.5, outputTokens: 12_000 };
export const SYSTEM_CHARS = 4_000;

/** Centavos estimados para una llamada con ese tamaño de prompt (≈ 4 letras por token). Siempre al menos 1. */
export function estimateCents(promptChars: number, outputTokens = AI_PRICE.outputTokens): number {
  const usd = ((promptChars / 4) * AI_PRICE.inputPerM + outputTokens * AI_PRICE.outputPerM) / 1_000_000;
  return Math.max(1, Math.ceil(usd * 100));
}

/** Lo máximo que puede costar preparar los arreglos con estas instrucciones (todos los archivos que caben). */
export function estimateForInstructions(instructionChars: number, fileBudget: number): number {
  return estimateCents(SYSTEM_CHARS + instructionChars + fileBudget);
}

// ---------- La IA ----------

export const MAX_INSTRUCTIONS = 30_000;

export const EditsSchema = z.object({
  edits: z
    .array(
      z.object({
        path: z.string().describe("Exact path of one of the files provided, e.g. app/es/servicios/page.tsx"),
        find: z.string().describe("Exact text copied from the CURRENT file that appears exactly once (include enough surrounding characters to make it unique). Empty only to create a new public/*.txt or public/*.xml file"),
        replace: z.string().describe("The new text that replaces `find`"),
        why: z.object({ es: z.string().describe("One plain sentence in Spanish for the business owner: what changes and why"), en: z.string().describe("The same sentence in English") }),
        issueIds: z.array(z.string()).describe("The issue references this edit fixes (audit ids like title-too-long, or the item numbers from the instructions)"),
      }),
    )
    .describe("Minimal find/replace edits. At most 20 files"),
  skipped: z
    .array(z.object({ issue: z.string().describe("Issue reference or short title"), reason: z.object({ es: z.string(), en: z.string() }).describe("Plain-words reason in Spanish and English") }))
    .describe("Issues you did not fix and why (intentional noindex pages, needs facts you don't have, not in these files, owner must do it…)"),
  summary: z.object({ es: z.string(), en: z.string() }).describe("One or two plain sentences for the owner summarizing the changes"),
});
export type AiEdits = z.infer<typeof EditsSchema>;

export const FIX_SYSTEM = `You are a careful senior web developer fixing SEO problems on a small business's website. The site is a Next.js App Router project on GitHub. You receive the owner's instructions (the issues to fix) and the CURRENT content of the relevant files. You answer ONLY with find/replace edits in the given JSON shape; a program checks and applies them, and the owner reviews a preview before anything is published.

Rules:
- Keep changes minimal and surgical: change only what an issue needs. Do not refactor, reformat, rename, reorder or "improve" anything else.
- Each "find" must be copied exactly (same spaces, quotes and line breaks) from the current file and must appear exactly once in it. Prefer short but unique snippets.
- Only edit files you were given. Never create files except public/*.txt or public/*.xml (for example llms.txt) when an issue asks for it.
- Never invent facts: no new prices, licences or licence numbers, reviews, ratings, testimonials, awards, years in business, addresses, phone numbers, guarantees, statistics or promises. Reuse wording and facts that already exist in the files. If a fix needs a fact you don't have, skip it and say what is missing.
- Keep the site bilingual: when you change visible text or metadata in one language (English or Spanish), make the matching change in the other language too, with natural wording and correct Spanish accents.
- Leave intentionally hidden pages alone: privacy, terms, legal, thank-you, assistant/chat and campaign landing pages (lp) are often noindex on purpose. Do not make them indexable; list them in "skipped" with the reason.
- Never touch tracking, analytics, ads pixels, scripts, environment variables, API routes, security headers or redirects. Never add <script>, dangerouslySetInnerHTML, eval, iframes or new external hosts.
- Keep code valid TypeScript/TSX/JSON. Titles: about 50-60 characters; meta descriptions: about 140-155 characters; keep the brand suffix pattern the site already uses.
- For data-driven pages ([slug]), change the data entry in lib/ or content/ that feeds that page, not the page template, unless the template itself is wrong.
- If an issue can't be fixed in these files, or the owner must do it outside the code, put it in "skipped" with a plain reason (Spanish and English).
- "why" texts are for a non-technical owner: plain words, no code, no file names.`;

/** El mensaje para la IA: las instrucciones del dueño y el texto de cada archivo. */
export function fixUserPrompt(instructions: string, files: { path: string; content: string; pages: string[] }[]): string {
  const out = [
    "## Instructions (the issues to fix)",
    instructions.slice(0, MAX_INSTRUCTIONS),
    "",
    `## Current files (${files.length})`,
    "Only these files may be edited. Each one is shown between the markers.",
  ];
  for (const f of files) out.push("", `=== FILE: ${f.path}${f.pages.length ? ` (serves: ${f.pages.slice(0, 6).join(", ")})` : ""} ===`, f.content, `=== END FILE: ${f.path} ===`);
  return out.join("\n");
}

// ---------- El pull request ----------

export function prTitle(source: FixSource, n: number): string {
  const what = source.title.trim() ? `: ${source.title.trim().slice(0, 60)}` : "";
  return `Matya: arreglos de SEO${what} (${n} ${n === 1 ? "archivo" : "archivos"})`;
}

/** El cuerpo del PR: cada cambio con su porqué y lo que no se hizo. Nunca lleva llaves (solo textos de la IA revisados). */
export function prBody(changes: FixChange[], skipped: FixSkipped[], dropped: DroppedEdit[], summary: Bi): string {
  const out = [
    "Arreglos preparados por **Matya** a partir de la auditoría SEO. El dueño los revisa en Matya y los publica desde allí.",
    "",
    summary.es ? `> ${summary.es}` : "",
    "",
    "## Cambios",
  ];
  for (const c of changes) {
    out.push(`- \`${c.path}\`${c.pages.length ? ` (${c.pages.slice(0, 4).join(", ")})` : ""}${c.created ? " — archivo nuevo" : ""}`);
    for (const w of c.why) out.push(`  - ${w.es}${w.en ? ` / ${w.en}` : ""}`);
  }
  if (skipped.length) {
    out.push("", "## No se cambió");
    for (const s of skipped) out.push(`- ${s.issue}: ${s.reason.es}`);
  }
  if (dropped.length) {
    out.push("", "## Descartado por la revisión de seguridad de Matya");
    for (const d of dropped) out.push(`- \`${d.path}\`: ${d.reason.es}`);
  }
  out.push("", "---", "No se tocó la medición, los scripts ni la configuración. Publicar = squash merge desde Matya con el sha revisado.");
  return out.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").slice(0, 60_000);
}

/** Los cambios aplicados → lo que se guarda (sin el texto completo del archivo). */
export function toFixChanges(changes: AppliedChange[], pagesOf: Map<string, string[]>): FixChange[] {
  return changes.map((c) => ({ path: c.path, pages: pagesOf.get(c.path) ?? [], why: c.why, issueIds: c.issueIds, diff: c.diff.slice(0, 8000), created: c.created }));
}

// ---------- La vista previa (Vercel) ----------

const FAILED = new Set(["failure", "error", "cancelled", "timed_out", "action_required", "startup_failure", "stale"]);

/** Una dirección de vista previa de Vercel en un texto (status, check o comentario del bot). */
export function vercelUrlIn(text: string): string {
  const m = /https:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.vercel\.app[^\s)"'<>\]]*/.exec(text);
  return m ? safeUrl(m[0]) : "";
}

export type PreviewState = { build: BuildState; previewUrl: string };

/**
 * El estado de la vista previa del commit del PR: falló si algún status o check falló; en curso si alguno sigue;
 * lista si al menos uno salió bien y ninguno falló; «esperando» si todavía nadie reportó nada.
 */
export function previewState(status: CombinedStatus | null, checks: CheckRun[] | null, deployments: string[] = [], comments: IssueComment[] = []): PreviewState {
  const st = status?.statuses ?? [];
  const ck = checks ?? [];
  const failed = st.some((s) => s.state === "failure" || s.state === "error") || ck.some((c) => c.status === "completed" && c.conclusion && FAILED.has(c.conclusion));
  const pending = st.some((s) => s.state === "pending") || ck.some((c) => c.status !== "completed");
  const ok = st.some((s) => s.state === "success") || ck.some((c) => c.status === "completed" && (c.conclusion === "success" || c.conclusion === "neutral" || c.conclusion === "skipped"));
  const build: BuildState = failed ? "failure" : pending ? "pending" : ok ? "success" : "waiting";
  const vercelStatus = st.filter((s) => /vercel|preview|deploy/i.test(s.context));
  const candidates = [
    ...deployments,
    ...vercelStatus.map((s) => s.targetUrl),
    ...st.map((s) => s.targetUrl),
    ...ck.map((c) => c.detailsUrl),
    ...ck.map((c) => c.summary),
    ...comments.filter((c) => /vercel/i.test(c.user)).map((c) => c.body),
  ];
  let previewUrl = "";
  for (const c of candidates) {
    previewUrl = vercelUrlIn(c);
    if (previewUrl) break;
  }
  return { build, previewUrl };
}

/** ¿Se puede publicar? Solo con el PR abierto, sin conflictos y con la vista previa lista. */
export function canPublish(job: Pick<FixJob, "status" | "build" | "mergeable" | "prNumber" | "headSha">): boolean {
  return job.status === "open" && job.prNumber > 0 && Boolean(job.headSha) && job.build === "success" && job.mergeable === true;
}

/** Lo que pasó con el PR fuera de Matya: publicado (merged) o cerrado; null si sigue abierto. */
export function outsideOutcome(pr: Pick<PullInfo, "state" | "merged">): "published" | "closed" | null {
  if (pr.merged) return "published";
  if (pr.state === "closed") return "closed";
  return null;
}

// ---------- Los pasos para el dueño ----------

export type StepView = { id: string; label: Bi; state: "done" | "now" | "todo" | "bad" };

/** Los pasos del arreglo en palabras sencillas, con cuál va ahora. */
export function stepsFor(job: Pick<FixJob, "status" | "step" | "build">): StepView[] {
  const L = (es: string, en: string): Bi => ({ es, en });
  const steps: { id: string; label: Bi }[] = [
    { id: "reading", label: L("Leer el código de tu web", "Read your website's code") },
    { id: "asking", label: L("La IA prepara los arreglos", "The AI prepares the fixes") },
    { id: "writing", label: L("Guardarlos en una copia aparte (tu web no cambia)", "Save them in a separate copy (your site doesn't change)") },
    { id: "preview", label: L("Armar la vista previa", "Build the preview") },
    { id: "review", label: L("Tú revisas y publicas", "You review and publish") },
  ];
  const order = steps.map((s) => s.id);
  let now: string;
  let bad = false;
  if (job.status === "preparing") now = job.step;
  else if (job.status === "open") {
    now = job.build === "success" ? "review" : "preview";
    bad = job.build === "failure";
  } else if (job.status === "published") now = "done";
  else if (job.status === "failed") {
    now = job.step;
    bad = true;
  } else now = "done";
  const at = now === "done" ? order.length : order.indexOf(now);
  return steps.map((s, i) => ({ ...s, state: i < at ? "done" : i === at ? (bad ? "bad" : "now") : "todo" }));
}

/** Agrupa los cambios por página (las de todo el sitio al final). */
export function changesByPage(changes: FixChange[]): { page: string; changes: FixChange[] }[] {
  const groups = new Map<string, FixChange[]>();
  for (const c of changes) {
    const key = c.pages.length ? c.pages.slice(0, 3).join(" · ") : "";
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b))).map(([page, list]) => ({ page, changes: list }));
}

/** Lo que el navegador necesita de un arreglo (todo menos los textos internos). */
export type FixView = FixJob & { id: string };
