// «Arréglalo por mí»: de las direcciones de los avisos (https://sitio.com/es/servicios/techo) a los archivos del código
// que hay que leer en un repositorio de Next.js con App Router: la página de esa ruta (app/(grupo)/…/[slug]/page.tsx),
// sus layouts, los archivos que importa (lib/, components/, content/: ahí suelen estar los textos y los datos de las
// páginas [slug]) y los archivos de todo el sitio (sitemap, robots, llms.txt, el layout raíz) cuando el aviso es de
// todo el sitio. Genérico (cualquier repositorio con app/ o src/app/) y puro: se prueba en tests/webfix-routes.test.ts.

export type TreeFile = { path: string; size: number };

/** Una página del App Router: el archivo y sus segmentos de dirección (sin grupos). */
export type Route = { file: string; dir: string; segments: string[] };

const PAGE_RE = /^(?:src\/)?app\/(?:(.*)\/)?page\.(?:tsx|ts|jsx|js|mdx)$/;
const CODE_EXT = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json", ".mdx", ".md"];
/** Carpetas donde puede haber código o textos de la página (las mismas que se pueden editar). */
export const SOURCE_ROOTS = ["app/", "components/", "lib/", "content/", "src/app/", "src/components/", "src/lib/", "src/content/"];

const isGroup = (s: string) => /^\(.*\)$/.test(s);
/** Carpetas privadas (_algo), rutas paralelas (@slot) e interceptadas ((.)algo) no son parte de la dirección. */
const isHidden = (s: string) => s.startsWith("_") || /^\(\.+\)/.test(s);

/** Todas las páginas del App Router en el árbol. */
export function listRoutes(tree: TreeFile[]): Route[] {
  const out: Route[] = [];
  for (const f of tree) {
    const m = PAGE_RE.exec(f.path);
    if (!m) continue;
    const parts = (m[1] ?? "").split("/").filter(Boolean);
    if (parts.some(isHidden)) continue;
    out.push({ file: f.path, dir: f.path.slice(0, f.path.lastIndexOf("/")), segments: parts.filter((p) => !isGroup(p) && !p.startsWith("@")) });
  }
  return out;
}

/** Qué tan bien calza una dirección con una ruta (más alto = más específica); null si no calza. */
export function matchScore(urlSegments: string[], route: string[]): number | null {
  let score = 0;
  let i = 0;
  for (let r = 0; r < route.length; r++) {
    const seg = route[r];
    const optCatch = /^\[\[\.\.\.[^\]]+\]\]$/.test(seg);
    const catchAll = /^\[\.\.\.[^\]]+\]$/.test(seg);
    if (optCatch || catchAll) {
      const rest = urlSegments.length - i;
      if (catchAll && rest < 1) return null;
      return r === route.length - 1 ? score + 1 : null;
    }
    if (i >= urlSegments.length) return null;
    if (/^\[[^\]]+\]$/.test(seg)) score += 2;
    else if (seg.toLowerCase() === urlSegments[i].toLowerCase()) score += 3;
    else return null;
    i++;
  }
  return i === urlSegments.length ? score : null;
}

/** Los segmentos de una dirección (solo la ruta, sin / al final ni ?…#…). */
export function urlSegments(url: string): string[] {
  let path = url;
  try {
    path = new URL(url, "https://x.invalid").pathname;
  } catch {
    // Se usa tal cual.
  }
  return path
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

/** La página que muestra esa dirección (la más específica) y los valores de sus [parámetros]. */
export function routeForUrl(url: string, routes: Route[]): { route: Route; params: string[] } | null {
  const segs = urlSegments(url);
  let best: { route: Route; score: number } | null = null;
  for (const r of routes) {
    const s = matchScore(segs, r.segments);
    if (s !== null && (!best || s > best.score)) best = { route: r, score: s };
  }
  if (!best) return null;
  const params = best.route.segments.flatMap((seg, i) => (/^\[/.test(seg) ? (seg.includes("...") ? segs.slice(i) : [segs[i]]) : [])).filter(Boolean);
  return { route: best.route, params };
}

/** Los layouts de una página, del más cercano al raíz (app/…/layout.tsx). */
export function layoutsFor(route: Route, paths: Set<string>): string[] {
  const out: string[] = [];
  const parts = route.dir.split("/");
  for (let n = parts.length; n >= 1; n--) {
    const dir = parts.slice(0, n).join("/");
    if (!/^(?:src\/)?app(\/|$)/.test(dir)) break;
    for (const ext of ["tsx", "ts", "jsx", "js"]) {
      const p = `${dir}/layout.${ext}`;
      if (paths.has(p)) out.push(p);
    }
  }
  return out;
}

/** Las rutas que importa un archivo (import … from "x", import "x", import("x"), export … from "x"). */
export function parseImports(content: string): string[] {
  const out = new Set<string>();
  const re = /(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\s+from\s+)?["']([^"'\n]+)["']|import\(\s*["']([^"'\n]+)["']\s*\)/g;
  for (const m of content.matchAll(re)) out.add(m[1] ?? m[2]);
  return [...out];
}

/** Resuelve un import local («@/lib/x», «../lib/x», «~/x») a un archivo del árbol; null si es un paquete o no existe. */
export function resolveImport(from: string, spec: string, paths: Set<string>): string | null {
  let base: string[];
  if (spec.startsWith("@/") || spec.startsWith("~/")) {
    const rest = spec.slice(2);
    base = [rest, `src/${rest}`];
  } else if (spec.startsWith(".")) {
    const dir = from.split("/").slice(0, -1);
    for (const part of spec.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") dir.pop();
      else dir.push(part);
    }
    base = [dir.join("/")];
  } else return null;
  for (const b of base) {
    if (paths.has(b)) return b;
    for (const ext of CODE_EXT) if (paths.has(`${b}${ext}`)) return `${b}${ext}`;
    for (const ext of CODE_EXT) if (paths.has(`${b}/index${ext}`)) return `${b}/index${ext}`;
  }
  return null;
}

/** Archivos que afectan a todo el sitio: sitemap, robots, llms.txt, manifest y el layout raíz (si existen). */
export function siteFiles(paths: Set<string>): string[] {
  const names = [
    "app/sitemap.ts",
    "app/sitemap.tsx",
    "app/sitemap.js",
    "app/sitemap.xml",
    "app/robots.ts",
    "app/robots.js",
    "app/robots.txt",
    "app/llms.txt/route.ts",
    "app/manifest.ts",
    "public/robots.txt",
    "public/sitemap.xml",
    "public/llms.txt",
    "app/layout.tsx",
    "app/layout.ts",
    "app/layout.jsx",
    "app/layout.js",
  ];
  return [...names, ...names.map((n) => `src/${n}`)].filter((p) => paths.has(p));
}

/** Los layouts que están justo debajo de app/ (también dentro de grupos: app/(en)/layout.tsx, app/es/layout.tsx). */
export function topLayouts(paths: Set<string>): string[] {
  return [...paths].filter((p) => /^(?:src\/)?app\/(?:[^/]+\/)?layout\.(?:tsx|ts|jsx|js)$/.test(p)).sort();
}

const inSourceRoots = (p: string) => SOURCE_ROOTS.some((r) => p.startsWith(r));

/** Avisos que se arreglan en archivos de todo el sitio (además de las páginas). */
const SITE_HINTS: { re: RegExp; files: RegExp }[] = [
  { re: /sitemap/i, files: /(^|\/)sitemap\.(ts|tsx|js|xml)$/ },
  { re: /robots|bloquea|blocks|bots/i, files: /(^|\/)robots\.(ts|js|txt)$/ },
  { re: /llms/i, files: /(^|\/)llms\.txt(\/route\.ts)?$/ },
  { re: /schema|json-ld|datos estructurados|structured data/i, files: /schema|json-?ld|structured/i },
  { re: /hreflang|idioma|language|lang/i, files: /(^|\/)layout\.(tsx|ts|jsx|js)$/ },
];

export type Target = {
  /** Dirección afectada (completa o solo la ruta). Vacío = todo el sitio. */
  url: string;
  /** Avisos que se ven en esa dirección (ids de la auditoría u otras etiquetas). */
  refs: string[];
};

export type Picked = {
  path: string;
  content: string;
  /** Las direcciones por las que se eligió (para agrupar los cambios por página); vacío = todo el sitio. */
  pages: string[];
  why: "page" | "layout" | "import" | "data" | "site";
};

export type PickOptions = {
  /** Máximo de letras en total que se mandan a la IA. */
  budget: number;
  /** Máximo de letras por archivo (los más grandes no se leen). */
  maxFile: number;
  /** Máximo de archivos. */
  maxFiles: number;
  /** Texto de las instrucciones (para pistas de todo el sitio: sitemap, robots, datos estructurados…). */
  hints?: string;
  /** Si hay avisos de todo el sitio (o no hay direcciones). */
  siteWide?: boolean;
};

export const PICK_DEFAULTS: PickOptions = { budget: 240_000, maxFile: 120_000, maxFiles: 24 };

/**
 * Elige qué archivos leer para arreglar los avisos, dentro de un presupuesto de letras. `read` trae el texto de un
 * archivo (null si es binario). Prioridad: la página de cada dirección, los datos que la página importa (y que
 * contienen el [slug] de esa dirección), los textos y ayudas que importa, los archivos de todo el sitio y los layouts.
 */
export async function pickFiles(tree: TreeFile[], targets: Target[], read: (path: string) => Promise<string | null>, opts: Partial<PickOptions> = {}): Promise<Picked[]> {
  const o = { ...PICK_DEFAULTS, ...opts };
  const files = tree.filter((f) => !f.path.includes("node_modules/"));
  const size = new Map(files.map((f) => [f.path, f.size]));
  const paths = new Set(files.map((f) => f.path));
  const routes = listRoutes(files);
  type Cand = { path: string; score: number; pages: Set<string>; why: Picked["why"]; depth: number; params: string[] };
  const cands = new Map<string, Cand>();
  const add = (path: string, score: number, why: Picked["why"], page: string | null, depth = 0, params: string[] = []) => {
    if (!paths.has(path)) return;
    const c = cands.get(path) ?? { path, score: 0, pages: new Set<string>(), why, depth, params: [] };
    if (score > c.score) {
      c.score = score;
      c.why = why;
    }
    c.depth = Math.min(c.depth, depth);
    if (page) c.pages.add(page);
    c.params.push(...params);
    cands.set(path, c);
  };

  const urls = [...new Set(targets.map((t) => t.url).filter(Boolean))];
  for (const url of urls) {
    const m = routeForUrl(url, routes);
    if (!m) continue;
    const page = urlSegments(url).length ? `/${urlSegments(url).join("/")}` : "/";
    add(m.route.file, 100, "page", page, 0, m.params);
    layoutsFor(m.route, paths).forEach((l, i) => add(l, 35 - i * 5, "layout", page));
  }
  const siteWide = o.siteWide || urls.length === 0;
  if (siteWide) {
    for (const p of siteFiles(paths)) add(p, 70, "site", null);
    for (const p of topLayouts(paths)) add(p, 55, "layout", null);
    const home = routes.filter((r) => r.segments.length === 0 || (r.segments.length === 1 && /^[a-z]{2}$/.test(r.segments[0])));
    for (const r of home) add(r.file, 60, "page", r.segments.length ? `/${r.segments[0]}` : "/");
  }
  if (o.hints) {
    for (const h of SITE_HINTS) {
      if (!h.re.test(o.hints)) continue;
      for (const p of paths) if (inSourceRoots(p) || p.startsWith("public/")) if (h.files.test(p) && (size.get(p) ?? 0) <= o.maxFile) add(p, 58, "site", null);
    }
  }

  // Leer las páginas y seguir sus imports (2 niveles), sin leer de más.
  const texts = new Map<string, string | null>();
  const load = async (p: string) => {
    if (!texts.has(p)) texts.set(p, (size.get(p) ?? 0) > o.maxFile ? null : await read(p));
    return texts.get(p) ?? null;
  };
  let reads = 0;
  for (let depth = 0; depth < 2; depth++) {
    const level = [...cands.values()].filter((c) => c.depth === depth && (c.why === "page" || c.why === "import" || c.why === "data")).sort((a, b) => b.score - a.score);
    for (const c of level) {
      if (reads++ > 60) break;
      const text = await load(c.path);
      if (text === null) continue;
      for (const spec of parseImports(text)) {
        const target = resolveImport(c.path, spec, paths);
        if (!target || !inSourceRoots(target) || /\.(css|scss)$/.test(target)) continue;
        const data = /^(?:src\/)?(lib|content)\//.test(target);
        add(target, (depth === 0 ? 80 : 50) + (data ? 5 : 0), data ? "data" : "import", null, depth + 1, c.params);
        const t = cands.get(target)!;
        c.pages.forEach((p) => t.pages.add(p));
      }
    }
  }
  // Los datos que contienen el [slug] de la dirección valen casi como la página.
  for (const c of cands.values()) {
    if (c.why !== "data" && c.why !== "import") continue;
    const params = [...new Set(c.params)].filter((p) => p.length >= 3);
    if (!params.length) continue;
    const text = await load(c.path);
    if (text && params.some((p) => text.includes(p))) c.score += 12;
  }

  const ordered = [...cands.values()].sort((a, b) => b.score - a.score || (size.get(a.path) ?? 0) - (size.get(b.path) ?? 0));
  const out: Picked[] = [];
  let used = 0;
  for (const c of ordered) {
    if (out.length >= o.maxFiles) break;
    if ((size.get(c.path) ?? 0) > o.maxFile) continue;
    const text = await load(c.path);
    if (text === null || used + text.length > o.budget) continue;
    used += text.length;
    out.push({ path: c.path, content: text, pages: [...c.pages], why: c.why });
  }
  return out;
}

/** Las direcciones de un texto (instrucciones copiadas) que son del sitio del negocio. */
export function siteUrlsIn(text: string, website: string): string[] {
  let host = "";
  try {
    host = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).host.replace(/^www\./, "");
  } catch {
    return [];
  }
  const out = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>)»,]+/g)) {
    try {
      const u = new URL(m[0].replace(/[.;:]+$/, ""));
      if (u.host.replace(/^www\./, "") === host) out.add(`${u.pathname.replace(/\/+$/, "") || "/"}`);
    } catch {
      // No es una dirección.
    }
  }
  return [...out];
}
