// «Arréglalo por mí»: revisión estricta de los cambios que propone la IA ANTES de escribir nada en GitHub. Cada cambio
// es {path, find, replace}: se aplica solo si el archivo está permitido, `find` aparece exactamente una vez, el
// resultado es texto no vacío y no agrega scripts, código peligroso, servidores externos ni cosas que parecen llaves.
// Lo que no pasa se descarta con el motivo (en palabras sencillas). Puro: se prueba en tests/webfix-edits.test.ts.

export type Bi = { es: string; en: string };

export type ProposedEdit = { path: string; find: string; replace: string; why: Bi; issueIds: string[] };
export type AppliedChange = { path: string; why: Bi[]; issueIds: string[]; diff: string; before: string; after: string; created: boolean };
export type DroppedEdit = { path: string; reason: Bi };

/** Máximo de archivos distintos por arreglo. */
export const MAX_FILES = 20;
/** Máximo de letras de un `replace` (los arreglos son pequeños). */
export const MAX_REPLACE = 20_000;

const TEXT_EXT = /\.(tsx|ts|jsx|js|mjs|cjs|json|md|mdx|css|txt|xml)$/i;
const ALLOWED_ROOTS = ["app/", "components/", "lib/", "content/", "src/app/", "src/components/", "src/lib/", "src/content/"];
const DENIED_DIRS = new Set([".github", "scripts", "supabase", "vendor", "tests", "test", "__tests__", "node_modules", ".next", ".vercel", "e2e", "cypress", "playwright"]);
const DENIED_FILE = [
  /^package(-lock)?\.json$/i,
  /^npm-shrinkwrap\.json$/i,
  /^(yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|bun\.lock)$/i,
  /^\.env/i,
  /^next\.config\./i,
  /^proxy\.(ts|js|mjs)$/i,
  /^middleware\./i,
  /^instrumentation(-client)?\./i,
  /\.(test|spec)\.[a-z]+$/i,
  /^vercel\.json$/i,
];

/** Por qué una ruta no se puede tocar (null = permitida). */
export function pathProblem(path: string): Bi | null {
  const p = path.trim();
  if (!p || p.startsWith("/") || p.includes("\\") || p.includes("\0") || p.split("/").some((s) => s === ".." || s === "." || s === ""))
    return { es: "La dirección del archivo no es válida.", en: "The file path isn't valid." };
  const parts = p.split("/");
  const name = parts[parts.length - 1];
  if (parts.slice(0, -1).some((d) => DENIED_DIRS.has(d.toLowerCase())) || DENIED_FILE.some((re) => re.test(name)))
    return { es: "Ese archivo está protegido (configuración, pruebas o programas internos): Matya no lo toca.", en: "That file is protected (settings, tests or internal scripts): Matya doesn't touch it." };
  const publicText = /^public\/[^/]+\.(txt|xml)$/i.test(p);
  if (!publicText && !ALLOWED_ROOTS.some((r) => p.startsWith(r)))
    return { es: "Matya solo cambia las páginas, componentes, textos y datos de la web (app/, components/, lib/, content/) y los .txt/.xml de public/.", en: "Matya only changes the site's pages, components, copy and data (app/, components/, lib/, content/) and the .txt/.xml files in public/." };
  if (!TEXT_EXT.test(name)) return { es: "Solo se cambian archivos de texto o código.", en: "Only text or code files are changed." };
  return null;
}

const count = (hay: string, needle: string) => {
  if (!needle) return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
};
const countRe = (s: string, re: RegExp) => (s.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`)) ?? []).length;

/** Cosas que un arreglo de SEO nunca agrega (si ya estaban, se pueden mover; no aumentar). */
const DANGEROUS: { re: RegExp; why: Bi }[] = [
  { re: /<script\b/i, why: { es: "agregaba un <script>", en: "it added a <script>" } },
  { re: /<Script\b|next\/script/, why: { es: "agregaba un script", en: "it added a script" } },
  { re: /dangerouslySetInnerHTML/, why: { es: "usaba dangerouslySetInnerHTML", en: "it used dangerouslySetInnerHTML" } },
  { re: /\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*["'`]/, why: { es: "ejecutaba código armado con texto (eval)", en: "it ran code built from text (eval)" } },
  { re: /<iframe\b/i, why: { es: "agregaba un iframe", en: "it added an iframe" } },
  { re: /\bprocess\.env\b/, why: { es: "leía variables secretas del servidor", en: "it read server secret variables" } },
  { re: /\bdocument\.write\b|\binnerHTML\s*=/, why: { es: "escribía HTML a mano en la página", en: "it wrote raw HTML into the page" } },
];

/** Medición y publicidad: un arreglo nunca las toca. */
const TRACKING = /\bgtag\b|dataLayer|\bfbq\b|googletagmanager|google-analytics|pixel|@vercel\/analytics|@vercel\/speed-insights|clarity\.ms|hotjar|segment\.(com|io)|plausible|posthog/i;

/** Cosas que parecen llaves o contraseñas. */
const SECRET_PATTERNS = [
  /github_pat_[A-Za-z0-9_]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(re|xkeysib)[-_][A-Za-z0-9_-]{20,}/,
  /(secret|password|passwd|api[_-]?key|token|private[_-]?key)["'\s]*[:=]\s*["'`][^"'`\s]{12,}["'`]/i,
  /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\./,
];

/** Hosts de las direcciones http(s) de un texto. */
const hostsIn = (s: string) => new Set([...s.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map((m) => m[1].toLowerCase()));

/** Por qué el texto nuevo es peligroso (null = está bien). `original` es el archivo antes del cambio. */
export function contentProblem(find: string, replace: string, original: string): Bi | null {
  if (replace.length > MAX_REPLACE) return { es: "El cambio era demasiado grande para un arreglo.", en: "The change was too big for a fix." };
  for (const d of DANGEROUS) if (countRe(replace, d.re) > countRe(find, d.re)) return { es: `Descartado: ${d.why.es}.`, en: `Dropped: ${d.why.en}.` };
  if (TRACKING.test(find) || TRACKING.test(replace)) return { es: "Descartado: tocaba la medición o la publicidad de la web.", en: "Dropped: it touched the site's tracking or ads." };
  if (SECRET_PATTERNS.some((re) => re.test(replace) && !re.test(find))) return { es: "Descartado: tenía algo que parece una llave o contraseña.", en: "Dropped: it had something that looks like a key or password." };
  // Servidores externos nuevos para cargar código (src=, import(), url() de scripts).
  const known = hostsIn(original);
  for (const m of replace.matchAll(/(?:src|href)\s*=\s*\{?\s*["'`](https?:\/\/[^"'`]+)["'`]|import\s*\(\s*["'`](https?:\/\/[^"'`]+)["'`]/g)) {
    const url = m[1] ?? m[2];
    const host = url.replace(/^https?:\/\//, "").split(/[/?#]/)[0].toLowerCase();
    const isScript = /\.m?js(\?|$)/i.test(url) || Boolean(m[2]) || /src\s*=/.test(m[0]);
    if (isScript && !known.has(host)) return { es: `Descartado: cargaba algo de un servidor nuevo (${host}).`, en: `Dropped: it loaded something from a new server (${host}).` };
  }
  return null;
}

/** Un diff pequeño para mostrar: 2 líneas de contexto, las quitadas con «-» y las nuevas con «+». */
export function smallDiff(before: string, after: string, maxLines = 40): string {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  const ctx = 2;
  const lines: string[] = [];
  for (let i = Math.max(0, start - ctx); i < start; i++) lines.push(`  ${a[i]}`);
  for (let i = start; i <= endA; i++) lines.push(`- ${a[i]}`);
  for (let i = start; i <= endB; i++) lines.push(`+ ${b[i]}`);
  for (let i = endA + 1; i <= Math.min(a.length - 1, endA + ctx); i++) lines.push(`  ${a[i]}`);
  const clip = (l: string) => (l.length > 220 ? `${l.slice(0, 220)}…` : l);
  const out = lines.map(clip);
  return out.length > maxLines ? [...out.slice(0, maxLines), `… (${out.length - maxLines} líneas más / more lines)`].join("\n") : out.join("\n");
}

/** Une varios diffs de un mismo archivo (cada cambio por separado). */
const joinDiffs = (diffs: string[]) => diffs.join("\n  ⋯\n");

export type ApplyResult = { changes: AppliedChange[]; dropped: DroppedEdit[] };

/**
 * Revisa y aplica los cambios sobre los archivos actuales (`files`: ruta → texto; solo los que se leyeron). Los cambios
 * a un mismo archivo se aplican en orden y cada `find` debe estar exactamente una vez en el texto de ese momento.
 * Un archivo nuevo solo se permite en public/*.txt|xml (ej. llms.txt) con `find` vacío.
 */
export function applyEdits(edits: ProposedEdit[], files: Map<string, string>, existing: Set<string>): ApplyResult {
  const dropped: DroppedEdit[] = [];
  const work = new Map<string, { before: string; text: string; why: Bi[]; ids: Set<string>; diffs: string[]; created: boolean }>();
  for (const raw of edits) {
    const path = raw.path.trim().replace(/^\.\//, "");
    const drop = (es: string, en: string) => dropped.push({ path, reason: { es, en } });
    const bad = pathProblem(path);
    if (bad) {
      dropped.push({ path, reason: bad });
      continue;
    }
    if (!work.has(path) && work.size >= MAX_FILES) {
      drop(`Se pasaba del máximo de ${MAX_FILES} archivos por arreglo.`, `It went over the limit of ${MAX_FILES} files per fix.`);
      continue;
    }
    const find = raw.find;
    const replace = raw.replace;
    if (find === replace) {
      drop("No cambiaba nada.", "It didn't change anything.");
      continue;
    }
    if (replace.includes("\0") || find.includes("\0")) {
      drop("Tenía datos binarios.", "It had binary data.");
      continue;
    }
    let entry = work.get(path);
    if (!entry) {
      const current = files.get(path);
      if (current === undefined) {
        if (existing.has(path)) {
          drop("La IA cambió un archivo que no leyó: se descarta por seguridad.", "The AI changed a file it didn't read: dropped to be safe.");
          continue;
        }
        if (find !== "" || !/^public\/[^/]+\.(txt|xml)$/i.test(path)) {
          drop("Ese archivo no existe en tu web.", "That file doesn't exist on your website.");
          continue;
        }
        entry = { before: "", text: "", why: [], ids: new Set(), diffs: [], created: true };
      } else entry = { before: current, text: current, why: [], ids: new Set(), diffs: [], created: false };
    }
    if (!(entry.created && entry.text === "")) {
      const n = count(entry.text, find);
      if (!find || n !== 1) {
        drop(
          n === 0 ? "El texto a cambiar ya no está en el archivo (la web cambió o la IA se equivocó)." : `El texto a cambiar aparece ${n} veces: no se sabe cuál cambiar.`,
          n === 0 ? "The text to change isn't in the file (the site changed or the AI got it wrong)." : `The text to change appears ${n} times: it's unclear which one to change.`,
        );
        continue;
      }
    }
    const problem = contentProblem(find, replace, entry.text);
    if (problem) {
      dropped.push({ path, reason: problem });
      continue;
    }
    const next = entry.created && entry.text === "" ? replace : entry.text.replace(find, () => replace);
    if (!next.trim()) {
      drop("El archivo quedaba vacío.", "The file would end up empty.");
      continue;
    }
    entry.diffs.push(smallDiff(entry.text, next));
    entry.text = next;
    if (raw.why.es || raw.why.en) entry.why.push({ es: raw.why.es.slice(0, 400), en: raw.why.en.slice(0, 400) });
    raw.issueIds.forEach((id) => entry!.ids.add(String(id).slice(0, 80)));
    work.set(path, entry);
  }
  const changes: AppliedChange[] = [];
  for (const [path, e] of work) {
    if (e.text === e.before) continue;
    changes.push({ path, why: e.why, issueIds: [...e.ids], diff: joinDiffs(e.diffs), before: e.before, after: e.text, created: e.created });
  }
  return { changes, dropped };
}
