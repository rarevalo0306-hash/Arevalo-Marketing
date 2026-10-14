// «Visitas de Google y de las IAs a tu web» (como el «Log File Analyzer» de Semrush): lee el registro de visitas del
// servidor de la página (access log) y cuenta qué robots entran (Google, Bing, ChatGPT, Claude, Perplexity…), qué
// páginas leen, cuáles les dan error y qué páginas de la web Google no visitó.
// PURO y sin servidor: el archivo se lee EN EL NAVEGADOR del dueño, línea por línea, y al servidor solo se manda el
// resumen (sin direcciones IP ni lo que va después de «?» en las direcciones). Se prueba en tests/seo-logs.test.ts.
// Formatos: el «combined» de Apache y Nginx (cPanel, Hostinger, GoDaddy…) y líneas JSON (Vercel, Cloudflare, Netlify).
// Ojo: cualquiera puede decir que es Googlebot; esto cuenta lo que cada visita dice ser.

export type BotKind = "search" | "ai" | "seo" | "other";

export type BotDef = { id: string; name: string; owner: string; kind: BotKind; re: RegExp };

/** Los robots que se reconocen, del más específico al más general (gana el primero que coincide). */
export const LOG_BOTS: BotDef[] = [
  { id: "google", name: "Googlebot", owner: "Google", kind: "search", re: /googlebot|google-inspectiontool|adsbot-google|storebot-google|googleother|apis-google|mediapartners-google/i },
  { id: "bing", name: "Bingbot", owner: "Bing (Microsoft)", kind: "search", re: /bingbot|bingpreview|msnbot|adidxbot/i },
  { id: "chatgpt", name: "ChatGPT", owner: "OpenAI", kind: "ai", re: /oai-searchbot|chatgpt-user/i },
  { id: "gptbot", name: "GPTBot", owner: "OpenAI", kind: "ai", re: /gptbot/i },
  { id: "claude", name: "Claude", owner: "Anthropic", kind: "ai", re: /claude-user|claude-searchbot/i },
  { id: "claudebot", name: "ClaudeBot", owner: "Anthropic", kind: "ai", re: /claudebot|anthropic-ai|claude-web/i },
  { id: "perplexity", name: "Perplexity", owner: "Perplexity", kind: "ai", re: /perplexitybot|perplexity-user/i },
  { id: "gemini", name: "Gemini", owner: "Google", kind: "ai", re: /google-extended|gemini-deep-research/i },
  { id: "apple", name: "Applebot", owner: "Apple", kind: "search", re: /applebot/i },
  { id: "meta", name: "Meta", owner: "Meta (Facebook)", kind: "ai", re: /meta-externalagent|meta-externalfetcher|facebookexternalhit|facebookbot/i },
  { id: "bytespider", name: "Bytespider", owner: "ByteDance (TikTok)", kind: "ai", re: /bytespider/i },
  { id: "amazon", name: "Amazonbot", owner: "Amazon", kind: "ai", re: /amazonbot/i },
  { id: "ccbot", name: "CCBot", owner: "Common Crawl", kind: "ai", re: /ccbot/i },
  { id: "duckduckgo", name: "DuckDuckBot", owner: "DuckDuckGo", kind: "search", re: /duckduckbot|duckassistbot/i },
  { id: "yandex", name: "YandexBot", owner: "Yandex", kind: "search", re: /yandex(bot|images)/i },
  { id: "baidu", name: "Baiduspider", owner: "Baidu", kind: "search", re: /baiduspider/i },
  { id: "seo", name: "Herramientas de SEO", owner: "Ahrefs, Semrush, DataForSEO…", kind: "seo", re: /ahrefsbot|semrushbot|siteauditbot|dataforseobot|mj12bot|dotbot|rogerbot|screaming frog|serpstatbot|blexbot|barkrowler/i },
  { id: "other", name: "Otros robots", owner: "", kind: "other", re: /bot\b|bot\/|crawler|spider|crawl|slurp|fetcher|scraper|python-requests|curl\/|wget\//i },
];

const BOT_IDS = new Set(LOG_BOTS.map((b) => b.id));

/** El robot que dice ser (null = una persona o algo que no se reconoce). */
export function botOf(userAgent: string): BotDef | null {
  if (!userAgent) return null;
  return LOG_BOTS.find((b) => b.re.test(userAgent)) ?? null;
}

/** ¿Googlebot desde un celular? (el que Google usa casi siempre para decidir tus posiciones). */
export const googleMobile = (ua: string) => /android|mobile|iphone/i.test(ua);

export type LogHit = { path: string; status: number; ua: string; day: string | null; ms: number | null; params: boolean };

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** "10/Oct/2026:13:55:36 -0700" → milisegundos (UTC). */
export function clfTime(s: string): number | null {
  const m = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/.exec(s.trim());
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) return null;
  let ms = Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
  if (m[7]) ms -= (m[7] === "+" ? 1 : -1) * (Number(m[8]) * 60 + Number(m[9])) * 60_000;
  return Number.isFinite(ms) ? ms : null;
}

/** La ruta sin lo que va después de «?» o «#», sin dominio, decodificada y de 200 letras como máximo. */
export function cleanPath(raw: string): { path: string; params: boolean } {
  let s = raw.trim();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "");
  const q = s.search(/[?#]/);
  const params = q >= 0 && s[q] === "?" && q < s.length - 1;
  if (q >= 0) s = s.slice(0, q);
  if (!s.startsWith("/")) s = `/${s}`;
  try {
    s = decodeURI(s);
  } catch {
    /* se deja como venía */
  }
  return { path: s.slice(0, 200), params };
}

const COMBINED = /^\S+\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(?:[A-Z]+)\s+(\S+)[^"]*"\s+(\d{3})\s+\S+(?:\s+"[^"]*"\s+"([^"]*)")?/;

/** Lee una línea del registro (combined de Apache/Nginx o JSON). null si no se entiende. */
export function parseLogLine(line: string): LogHit | null {
  const s = line.trim();
  if (!s) return null;
  if (s.startsWith("{")) {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(s) as Record<string, unknown>;
    } catch {
      return null;
    }
    const pick = (...keys: string[]) => {
      for (const k of keys) {
        const v = k.split(".").reduce<unknown>((a, p) => (a && typeof a === "object" ? (a as Record<string, unknown>)[p] : undefined), o);
        if (typeof v === "string" || typeof v === "number") return String(v);
      }
      return "";
    };
    const rawPath = pick("path", "requestPath", "request_path", "url", "uri", "ClientRequestURI", "request.path", "request.url", "proxy.path", "requestUrl");
    const status = Number(pick("status", "statusCode", "status_code", "EdgeResponseStatus", "response.status", "proxy.statusCode", "responseStatusCode"));
    const ua = pick("userAgent", "user_agent", "ua", "ClientRequestUserAgent", "request.headers.user-agent", "headers.user-agent", "proxy.userAgent", "request.userAgent");
    const time = pick("timestamp", "time", "date", "EdgeStartTimestamp", "@timestamp", "ts");
    if (!rawPath || !(status >= 100 && status < 600)) return null;
    const asNum = Number(time);
    const ms = time ? (Number.isFinite(asNum) && asNum > 0 ? (asNum > 1e15 ? asNum / 1e6 : asNum > 1e12 ? asNum : asNum * 1000) : Date.parse(time)) : NaN;
    const { path, params } = cleanPath(rawPath);
    return { path, status, ua, ms: Number.isFinite(ms) ? ms : null, day: Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null, params };
  }
  const m = COMBINED.exec(s);
  if (!m) return null;
  const ms = clfTime(m[1]);
  const { path, params } = cleanPath(m[2]);
  return { path, status: Number(m[3]), ua: m[4] ?? "", ms, day: ms === null ? null : new Date(ms).toISOString().slice(0, 10), params };
}

/** ¿Es una foto, un estilo, un script o una letra (no una página)? */
export const isResource = (path: string) => /\.(?:css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|pdf|xml|txt|json)$/i.test(path);

// ---------- Acumular (línea por línea) ----------

const MAX_PATHS = 50_000;
const MAX_ERRORS = 5_000;
const MAX_BOT_PATHS = 20_000;

type BotAcc = { hits: number; paths: Set<string>; ok: number; redirects: number; clientErrors: number; serverErrors: number; lastMs: number | null; mobile: number };

export type LogAcc = {
  lines: number;
  parsed: number;
  firstMs: number | null;
  lastMs: number | null;
  people: number;
  bots: Map<string, BotAcc>;
  days: Map<string, { google: number; ai: number }>;
  googlePaths: Map<string, number>;
  aiPaths: Map<string, number>;
  errors: Map<string, { status: number; hits: number; bots: Set<string> }>;
  googleParams: number;
  googleResources: number;
};

export function newLogAcc(): LogAcc {
  return { lines: 0, parsed: 0, firstMs: null, lastMs: null, people: 0, bots: new Map(), days: new Map(), googlePaths: new Map(), aiPaths: new Map(), errors: new Map(), googleParams: 0, googleResources: 0 };
}

const bump = (m: Map<string, number>, k: string, max = MAX_PATHS) => {
  const v = m.get(k);
  if (v !== undefined) m.set(k, v + 1);
  else if (m.size < max) m.set(k, 1);
};

/** Suma una línea del registro. */
export function addLogLine(acc: LogAcc, line: string): void {
  acc.lines++;
  const hit = parseLogLine(line);
  if (!hit) return;
  acc.parsed++;
  if (hit.ms !== null) {
    if (acc.firstMs === null || hit.ms < acc.firstMs) acc.firstMs = hit.ms;
    if (acc.lastMs === null || hit.ms > acc.lastMs) acc.lastMs = hit.ms;
  }
  const bot = botOf(hit.ua);
  if (!bot) {
    acc.people++;
    return;
  }
  let b = acc.bots.get(bot.id);
  if (!b) {
    b = { hits: 0, paths: new Set(), ok: 0, redirects: 0, clientErrors: 0, serverErrors: 0, lastMs: null, mobile: 0 };
    acc.bots.set(bot.id, b);
  }
  b.hits++;
  if (b.paths.size < MAX_BOT_PATHS) b.paths.add(hit.path);
  if (hit.status >= 500) b.serverErrors++;
  else if (hit.status >= 400) b.clientErrors++;
  else if (hit.status >= 300) b.redirects++;
  else b.ok++;
  if (hit.ms !== null && (b.lastMs === null || hit.ms > b.lastMs)) b.lastMs = hit.ms;
  if (bot.id === "google" && googleMobile(hit.ua)) b.mobile++;
  if (hit.day && (bot.id === "google" || bot.kind === "ai")) {
    const d = acc.days.get(hit.day) ?? { google: 0, ai: 0 };
    if (bot.id === "google") d.google++;
    else d.ai++;
    acc.days.set(hit.day, d);
  }
  if (bot.id === "google") {
    if (hit.params) acc.googleParams++;
    if (isResource(hit.path)) acc.googleResources++;
    else bump(acc.googlePaths, hit.path);
  } else if (bot.kind === "ai" && !isResource(hit.path)) bump(acc.aiPaths, hit.path);
  if (hit.status >= 400 && bot.kind !== "other" && bot.kind !== "seo") {
    const key = `${hit.status} ${hit.path}`;
    const e = acc.errors.get(key);
    if (e) {
      e.hits++;
      e.bots.add(bot.id);
    } else if (acc.errors.size < MAX_ERRORS) acc.errors.set(key, { status: hit.status, hits: 1, bots: new Set([bot.id]) });
  }
}

// ---------- Resumen (lo que se guarda) ----------

export type LogBotRow = { id: string; hits: number; pages: number; ok: number; redirects: number; clientErrors: number; serverErrors: number; lastSeen: string | null; mobile: number };

export type LogReport = {
  version: 1;
  createdAt: string;
  /** Nombres de los archivos leídos (máx. 5). */
  files: string[];
  lines: number;
  parsed: number;
  /** Primer y último día del registro (YYYY-MM-DD). */
  from: string | null;
  to: string | null;
  /** Visitas de personas (y de lo que no se reconoce como robot). */
  people: number;
  bots: LogBotRow[];
  /** Visitas de Google y de las IAs por día (los últimos 60). */
  days: { day: string; google: number; ai: number }[];
  topGoogle: { path: string; hits: number }[];
  topAi: { path: string; hits: number }[];
  errors: { path: string; status: number; hits: number; bots: string[] }[];
  /** Páginas de tu web (de la auditoría) que Google no visitó en todo el registro. */
  missed: string[];
  /** Cuántas páginas de tu web se compararon. */
  checked: number;
  googleParams: number;
  googleResources: number;
};

const top = (m: Map<string, number>, n: number) =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([path, hits]) => ({ path, hits }));

/** La ruta de una dirección de tu web ("https://x.com/servicios/?a=1" → "/servicios"). Sin «/» final salvo el inicio. */
export function pathOf(url: string): string {
  const { path } = cleanPath(url);
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** Arma el resumen. `sitePaths`: las páginas de tu web (auditoría) para saber cuáles no visitó Google. */
export function finishLog(acc: LogAcc, opts: { files: string[]; sitePaths?: string[]; now?: Date }): LogReport {
  const bots: LogBotRow[] = LOG_BOTS.flatMap((def) => {
    const b = acc.bots.get(def.id);
    return b
      ? [{ id: def.id, hits: b.hits, pages: b.paths.size, ok: b.ok, redirects: b.redirects, clientErrors: b.clientErrors, serverErrors: b.serverErrors, lastSeen: b.lastMs === null ? null : new Date(b.lastMs).toISOString(), mobile: b.mobile }]
      : [];
  });
  const google = acc.bots.get("google");
  const seen = new Set([...(google?.paths ?? [])].map((p) => (p.length > 1 ? p.replace(/\/+$/, "") : p)));
  const site = [...new Set((opts.sitePaths ?? []).map(pathOf))].slice(0, 500);
  const missed = google ? site.filter((p) => !seen.has(p)) : [];
  const days = [...acc.days.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-60)
    .map(([day, v]) => ({ day, ...v }));
  return {
    version: 1,
    createdAt: (opts.now ?? new Date()).toISOString(),
    files: opts.files.map((f) => f.slice(0, 120)).slice(0, 5),
    lines: acc.lines,
    parsed: acc.parsed,
    from: acc.firstMs === null ? null : new Date(acc.firstMs).toISOString().slice(0, 10),
    to: acc.lastMs === null ? null : new Date(acc.lastMs).toISOString().slice(0, 10),
    people: acc.people,
    bots,
    days,
    topGoogle: top(acc.googlePaths, 15),
    topAi: top(acc.aiPaths, 10),
    errors: [...acc.errors.entries()]
      .map(([key, e]) => ({ path: key.slice(key.indexOf(" ") + 1), status: e.status, hits: e.hits, bots: [...e.bots] }))
      .sort((a, b) => b.hits - a.hits || a.path.localeCompare(b.path))
      .slice(0, 20),
    missed: missed.slice(0, 30),
    checked: google ? site.length : 0,
    googleParams: acc.googleParams,
    googleResources: acc.googleResources,
  };
}

// ---------- Lectura (lo que llega al servidor) ----------

const num = (v: unknown, max = 1e12) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : 0);
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
const arr = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const path = (v: unknown) => {
  const s = str(v);
  return s.startsWith("/") ? s : "";
};

/**
 * Lee un resumen sin confiar en él (viene del navegador): solo los campos conocidos, números positivos, rutas que
 * empiezan con «/», robots de la lista y tamaños máximos. null si no parece un resumen.
 */
export function readLogReport(json: unknown): LogReport | null {
  const r = obj(json);
  if (r.version !== 1 || !Array.isArray(r.bots)) return null;
  const bots: LogBotRow[] = arr(r.bots, LOG_BOTS.length)
    .map(obj)
    .filter((b) => BOT_IDS.has(str(b.id)))
    .map((b) => ({ id: str(b.id), hits: num(b.hits), pages: num(b.pages), ok: num(b.ok), redirects: num(b.redirects), clientErrors: num(b.clientErrors), serverErrors: num(b.serverErrors), lastSeen: iso(b.lastSeen), mobile: num(b.mobile) }))
    .filter((b, i, all) => all.findIndex((x) => x.id === b.id) === i);
  return {
    version: 1,
    createdAt: iso(r.createdAt) ?? new Date(0).toISOString(),
    files: arr(r.files, 5).map((f) => str(f, 120)).filter(Boolean),
    lines: num(r.lines),
    parsed: num(r.parsed),
    from: day(r.from),
    to: day(r.to),
    people: num(r.people),
    bots,
    days: arr(r.days, 60)
      .map(obj)
      .map((d) => ({ day: day(d.day) ?? "", google: num(d.google), ai: num(d.ai) }))
      .filter((d) => d.day),
    topGoogle: arr(r.topGoogle, 15)
      .map(obj)
      .map((x) => ({ path: path(x.path), hits: num(x.hits) }))
      .filter((x) => x.path),
    topAi: arr(r.topAi, 10)
      .map(obj)
      .map((x) => ({ path: path(x.path), hits: num(x.hits) }))
      .filter((x) => x.path),
    errors: arr(r.errors, 20)
      .map(obj)
      .map((x) => ({ path: path(x.path), status: num(x.status, 599), hits: num(x.hits), bots: arr(x.bots, LOG_BOTS.length).map((b) => str(b, 20)).filter((b) => BOT_IDS.has(b)) }))
      .filter((x) => x.path && x.status >= 400),
    missed: arr(r.missed, 30).map(path).filter(Boolean),
    checked: num(r.checked, 500),
    googleParams: num(r.googleParams),
    googleResources: num(r.googleResources),
  };
}

/** El nombre y el dueño de un robot por su clave. */
export const botDef = (id: string) => LOG_BOTS.find((b) => b.id === id) ?? null;
