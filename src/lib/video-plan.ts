// «Videos» (Reels, TikTok, YouTube Shorts y YouTube): el guion del video, sin servidor ni base de datos.
// De una idea, el negocio y las fotos o clips reales elegidos sale un guion de 5 a 8 escenas:
// - Gancho en los primeros 2 segundos (con la palabra clave principal), escenas con movimiento suave (Ken Burns
//   hacia el punto importante de la foto: LibraryItem.enhanceInfo.focus), y cierre con logo, eslogan, teléfono y web.
// - Vertical 9:16 de 15 a 30 s para Reels/TikTok/Shorts; horizontal 16:9 para YouTube.
// - Textos de cada red siempre con las palabras clave del negocio y la ciudad: título de YouTube (≤ 100), descripción
//   con enlace y teléfono, etiquetas (≤ 500 caracteres) y textos de Instagram/TikTok/Facebook con ≤ 5 hashtags.
// Lo usan las acciones (src/app/actions-video.ts), el render (video-render.ts), la pantalla y las pruebas.
import { z } from "zod";

// ---------- Formas, movimientos y medidas ----------

export const VIDEO_FORMATS = ["vertical", "horizontal"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];
/** Tamaño del video final (y de cada cuadro que se dibuja). */
export const FORMAT_SIZE: Record<VideoFormat, { w: number; h: number }> = { vertical: { w: 1080, h: 1920 }, horizontal: { w: 1920, h: 1080 } };
/** Duración total permitida (segundos). Vertical: lo que mejor funciona en Reels/TikTok/Shorts. */
export const TOTAL_RANGE: Record<VideoFormat, [number, number]> = { vertical: [15, 30], horizontal: [20, 60] };

export const MOTIONS = ["zoom-in", "zoom-out", "pan-left", "pan-right", "still"] as const;
export type Motion = (typeof MOTIONS)[number];

/** Escenas (contando el cierre): de 5 a 8. */
export const MIN_SCENES = 5;
export const MAX_SCENES = 8;
/** Escenas con foto o clip (sin el cierre). */
export const MIN_MEDIA_SCENES = MIN_SCENES - 1;
export const MAX_MEDIA_SCENES = MAX_SCENES - 1;
export const HOOK_SEC = 2;
export const OUTRO_SEC = 3;
/** Palabras máximas del texto de cada escena (se lee de un vistazo). */
export const CAPTION_WORDS = 6;

export type Point = { x: number; y: number };

/** Una foto o clip real de «Tus fotos» que se puede usar en el video. */
export type VideoMedia = {
  id: string;
  kind: "photo" | "video";
  /** La que va en el video (la mejorada si existe y el dueño no eligió la original). */
  url: string;
  thumb: string;
  /** Lo importante de la foto (0–1), para el movimiento y el recorte. */
  focus: Point | null;
  width: number;
  height: number;
  /** Clips: cuánto dura (0 = no se sabe). */
  durationSec: number;
  /** Qué muestra, en palabras (para la IA). */
  about: string;
};

export type SceneRole = "hook" | "body" | "outro";
export type VideoScene = {
  id: string;
  role: SceneRole;
  /** id de VideoMedia ("" en el cierre). */
  mediaId: string;
  durationSec: number;
  motion: Motion;
  /** Texto sobre la escena: ≤ 6 palabras. */
  caption: string;
};

export type VideoTexts = {
  /** YouTube: título (≤ 100 caracteres, con palabra clave y ciudad; vertical con #Shorts). */
  title: string;
  /** YouTube: descripción con palabras clave, enlace y teléfono. */
  description: string;
  /** YouTube: etiquetas (≤ 500 caracteres en total). */
  tags: string[];
  /** Reel de Instagram (≤ 5 hashtags). */
  instagram: string;
  /** TikTok (≤ 5 hashtags). */
  tiktok: string;
  facebook: string;
};

export type VideoOutro = { name: string; slogan: string; phone: string; website: string; logoUrl: string; logoLightUrl: string; color: string; color2: string; fontHeading: string };
export type VideoMusic = { on: boolean; mood: string; bpm: number | null; prompt: string };

export type Storyboard = {
  v: 1;
  format: VideoFormat;
  idea: string;
  /** Palabra clave principal (va en el gancho, el título y el nombre del archivo). */
  keyword: string;
  /** Las demás palabras clave del negocio (las que se siguen y las del estudio). */
  keywords: string[];
  city: string;
  lang: "es" | "en";
  scenes: VideoScene[];
  media: VideoMedia[];
  outro: VideoOutro;
  music: VideoMusic;
  texts: VideoTexts;
  /** ai = lo escribió la IA; template = guion de respaldo (la IA no respondió). */
  source: "ai" | "template";
};

/** Lo que el guion necesita saber del negocio. */
export type PlanContext = {
  idea: string;
  format: VideoFormat;
  lang: "es" | "en";
  media: VideoMedia[];
  business: { name: string; phone: string; website: string; city: string; hashtags: string; slogan: string; logoUrl: string; logoLightUrl: string; color: string; color2: string; fontHeading: string };
  /** Palabras clave: primero las que se siguen (Business.seoKeywords), luego las del estudio. */
  keywords: string[];
  /** Música de la identidad de marca (brandIdentity.music). */
  music: { moods: string[]; genres: string[]; bpmMin: number | null; bpmMax: number | null; instruments: string[]; searchTerms: string[] } | null;
};

// ---------- Texto ----------

/** Sin tildes y en minúsculas, para comparar palabras. */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const STOP = new Set("a al con de del el en la las lo los para por que un una y o e the an of to in on for and or your our my at by is it we".split(" "));
/** Palabras con contenido (sin «de», «la», «en»…), sin tildes. */
export const contentWords = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w));

/** Recorta a `max` palabras, sin puntuación colgando y con mayúscula inicial. */
export function cleanCaption(text: string, max = CAPTION_WORDS): string {
  const words = clean(text.replace(/[#*_`"“”]/g, "")).split(" ").filter(Boolean).slice(0, max);
  let out = words.join(" ").replace(/[,;:–-]+$/, "").trim();
  if (out && words.length === max && /[¿¡]/.test(out) && !/[?!]$/.test(out)) out = out.replace(/^[¿¡]/, "");
  return out ? out[0].toLocaleUpperCase() + out.slice(1) : "";
}

/** ¿El texto lleva la palabra clave (todas sus palabras con contenido, o la mayoría si es larga)? */
export function hasKeyword(text: string, keyword: string): boolean {
  const k = contentWords(keyword);
  if (!k.length) return false;
  const t = new Set(contentWords(text).map(stemOf));
  const hits = k.filter((w) => t.has(stemOf(w))).length;
  return hits >= Math.max(1, Math.ceil(k.length * 0.66));
}
const stemOf = (w: string) => w.replace(/(es|s)$/, "");

/** La palabra clave que más se parece a la idea (o la primera). */
export function pickKeyword(idea: string, keywords: string[]): string {
  const list = keywords.map(clean).filter(Boolean);
  if (!list.length) return "";
  const words = new Set(contentWords(idea).map(stemOf));
  let best = list[0];
  let score = 0;
  for (const k of list) {
    const s = contentWords(k).filter((w) => words.has(stemOf(w))).length;
    if (s > score) {
      best = k;
      score = s;
    }
  }
  return best;
}

/** Palabras clave sin repetir (sin importar tildes ni mayúsculas). */
export function uniqueKeywords(list: string[], max = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const k = clean(raw).slice(0, 80);
    const key = fold(k);
    if (!k || seen.has(key)) continue;
    seen.add(key);
    out.push(k);
    if (out.length >= max) break;
  }
  return out;
}

const cap = (s: string) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);

/** La ciudad dentro de la palabra clave con su mayúscula: «cortinas metálicas managua» → «cortinas metálicas Managua». */
export function cityCased(keyword: string, city: string): string {
  const k = clean(keyword);
  const cw = clean(city).split(" ").filter(Boolean);
  if (!cw.length) return k;
  const words = k.split(" ");
  const target = cw.map(fold);
  for (let i = 0; i + target.length <= words.length; i++) {
    if (target.every((w, j) => fold(words[i + j]) === w)) words.splice(i, target.length, ...cw);
  }
  return words.join(" ");
}

/** «Cortinas metálicas en Managua» (sin repetir la ciudad si ya va en la palabra clave). */
export function keywordWithCity(keyword: string, city: string, lang: "es" | "en"): string {
  const k = cityCased(keyword, city);
  if (!city || !k || fold(k).includes(fold(city))) return cap(k || city);
  return cap(`${k} ${lang === "en" ? "in" : "en"} ${city}`);
}

/** «#CortinasMetalicasManagua» (sin tildes ni espacios; las redes los aceptan mejor así). */
export function hashtagOf(text: string): string {
  const parts = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/#/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const tag = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join("");
  return tag.length >= 2 ? `#${tag.slice(0, 40)}` : "";
}

/** Hashtags para Instagram/TikTok/Facebook: palabra clave, ciudad, negocio y los del kit de marca. Como mucho `max`. */
export function hashtagsFor(ctx: { keyword: string; keywords: string[]; city: string; name: string; hashtags: string }, max = 5): string[] {
  const own = [...ctx.hashtags.matchAll(/#([\p{L}\p{N}_]{2,40})/gu)].map((m) => `#${m[1]}`);
  const list = [hashtagOf(ctx.keyword), hashtagOf(ctx.city), ...own, ...ctx.keywords.slice(0, 4).map(hashtagOf), hashtagOf(ctx.name)];
  const seen = new Set<string>();
  return list.filter((h) => h && !seen.has(h.toLowerCase()) && seen.add(h.toLowerCase())).slice(0, max);
}

/**
 * Etiquetas de YouTube: sin repetir y como mucho 500 caracteres en total. YouTube cuenta las comas entre etiquetas y
 * las comillas que agrega a las que tienen espacios.
 */
export function fitTags(list: string[], maxChars = 500): string[] {
  const out: string[] = [];
  let used = 0;
  const seen = new Set<string>();
  for (const raw of list) {
    const tag = clean(raw.replace(/^#/, "").replace(/[<>,]/g, " ")).slice(0, 100);
    if (tag.length < 2 || seen.has(fold(tag))) continue;
    const cost = tag.length + (tag.includes(" ") ? 2 : 0) + (out.length ? 1 : 0);
    if (used + cost > maxChars) continue;
    seen.add(fold(tag));
    out.push(tag);
    used += cost;
  }
  return out;
}
export const tagsLength = (tags: string[]) => tags.reduce((n, t, i) => n + t.length + (t.includes(" ") ? 2 : 0) + (i ? 1 : 0), 0);

/** Corta en palabra entera sin pasarse de `max` caracteres. */
export function clip(text: string, max: number): string {
  const t = clean(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1).replace(/\s+\S*$/, "").trim();
  return (cut || t.slice(0, max)).replace(/[,;:–-]+$/, "").slice(0, max);
}

const noAngles = (s: string) => s.replace(/[<>]/g, "");

/** Título de YouTube: con la palabra clave y la ciudad, ≤ 100 caracteres; los verticales llevan #Shorts. */
export function youtubeTitle(draft: string, ctx: { keyword: string; city: string; name: string; format: VideoFormat; lang: "es" | "en" }): string {
  const shorts = ctx.format === "vertical" ? " #Shorts" : "";
  let base = clean(noAngles(draft).replace(/#shorts/gi, ""));
  const kw = keywordWithCity(ctx.keyword, ctx.city, ctx.lang);
  if (!base) base = ctx.name ? `${kw} | ${ctx.name}` : kw;
  if (ctx.keyword && !hasKeyword(base, ctx.keyword)) base = `${kw}: ${base}`;
  if (ctx.city && !fold(base).includes(fold(ctx.city))) base = `${base} ${ctx.lang === "en" ? "in" : "en"} ${ctx.city}`;
  return clip(base, 100 - shorts.length) + shorts;
}

/** Descripción de YouTube: lo que muestra, palabras clave, teléfono, enlace y hashtags (≤ 5000 caracteres). */
export function youtubeDescription(summary: string, ctx: { keyword: string; keywords: string[]; city: string; name: string; phone: string; website: string; format: VideoFormat; lang: "es" | "en"; hashtags: string[] }): string {
  const en = ctx.lang === "en";
  const lines: string[] = [];
  const kw = keywordWithCity(ctx.keyword, ctx.city, ctx.lang);
  let first = clean(noAngles(summary));
  if (ctx.keyword && !hasKeyword(first, ctx.keyword)) first = first ? `${kw}. ${first}` : `${kw}.`;
  lines.push(first);
  const more = ctx.keywords.filter((k) => fold(k) !== fold(ctx.keyword)).slice(0, 5);
  if (more.length) lines.push("", `${en ? "We also help with" : "También te ayudamos con"}: ${more.join(", ")}${ctx.city ? ` ${en ? "in" : "en"} ${ctx.city}` : ""}.`);
  const contact: string[] = [];
  if (ctx.phone) contact.push(`📞 ${ctx.phone}`);
  if (ctx.website) contact.push(`🌐 ${/^https?:\/\//i.test(ctx.website) ? ctx.website : `https://${ctx.website}`}`);
  if (contact.length) lines.push("", `${en ? "Contact" : "Contáctanos"} — ${ctx.name}`, ...contact);
  const tags = [...(ctx.format === "vertical" ? ["#Shorts"] : []), ...ctx.hashtags].slice(0, 5);
  if (tags.length) lines.push("", tags.join(" "));
  return noAngles(lines.join("\n")).slice(0, 5000);
}

/** Texto para Instagram, TikTok o Facebook: el mensaje (con palabra clave y ciudad), contacto y ≤ 5 hashtags. */
export function socialCaption(message: string, ctx: { keyword: string; city: string; phone: string; website: string; lang: "es" | "en"; hashtags: string[] }, network: "instagram" | "tiktok" | "facebook"): string {
  const en = ctx.lang === "en";
  let text = clean(message.replace(/#[\p{L}\p{N}_]+/gu, ""));
  const kw = keywordWithCity(ctx.keyword, ctx.city, ctx.lang);
  if (ctx.keyword && !hasKeyword(text, ctx.keyword)) text = text ? `${kw}: ${text}` : kw;
  else if (ctx.city && !fold(text).includes(fold(ctx.city))) text = `${text} 📍 ${ctx.city}`;
  const limit = network === "facebook" ? 1500 : network === "tiktok" ? 2000 : 2000;
  const parts = [clip(text, limit)];
  if (ctx.phone) parts.push(`📞 ${en ? "Call or WhatsApp" : "Llama o escribe por WhatsApp"}: ${ctx.phone}`);
  // Instagram y TikTok no permiten tocar enlaces en el texto: el enlace va solo en Facebook.
  if (network === "facebook" && ctx.website) parts.push(`🌐 ${/^https?:\/\//i.test(ctx.website) ? ctx.website : `https://${ctx.website}`}`);
  const tags = ctx.hashtags.slice(0, network === "facebook" ? 3 : 5);
  if (tags.length) parts.push(tags.join(" "));
  return parts.join("\n\n");
}

// ---------- Duraciones ----------

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Duración total para `mediaScenes` escenas con foto o clip (más el cierre), dentro del rango del formato. */
export function targetTotal(mediaScenes: number, format: VideoFormat): number {
  const [lo, hi] = TOTAL_RANGE[format];
  const per = format === "vertical" ? 3 : 4.5;
  return Math.min(hi, Math.max(lo, Math.round(HOOK_SEC + (mediaScenes - 1) * per + OUTRO_SEC)));
}

/**
 * Reparte el tiempo: gancho de 2 s, escenas parejas y cierre de 3 s; los clips no pasan de lo que duran.
 * Si el total queda fuera del rango del formato, se estira o se encoge.
 */
export function fitDurations(scenes: VideoScene[], media: VideoMedia[], format: VideoFormat): VideoScene[] {
  const [lo, hi] = TOTAL_RANGE[format];
  const byId = new Map(media.map((m) => [m.id, m]));
  const maxOf = (s: VideoScene) => {
    const m = byId.get(s.mediaId);
    return m?.kind === "video" && m.durationSec > 0 ? Math.max(1, m.durationSec) : format === "vertical" ? 5 : 8;
  };
  const minOf = (s: VideoScene) => (s.role === "hook" ? 1.5 : s.role === "outro" ? 2.5 : 1.5);
  const out = scenes.map((s) => {
    const want = s.role === "hook" ? HOOK_SEC : s.role === "outro" ? OUTRO_SEC : Number.isFinite(s.durationSec) && s.durationSec > 0 ? s.durationSec : 3;
    const max = s.role === "hook" ? Math.min(3, maxOf(s)) : s.role === "outro" ? 4 : maxOf(s);
    return { ...s, durationSec: round1(Math.min(max, Math.max(minOf(s), want))) };
  });
  const total = () => out.reduce((n, s) => n + s.durationSec, 0);
  // Estirar o encoger solo las escenas del medio (el gancho y el cierre se quedan).
  for (let pass = 0; pass < 4; pass++) {
    const t = total();
    const goal = t < lo ? lo : t > hi ? hi : t;
    if (Math.abs(goal - t) < 0.05) break;
    const body = out.filter((s) => s.role === "body");
    if (!body.length) break;
    const share = (goal - t) / body.length;
    for (const s of body) s.durationSec = round1(Math.min(maxOf(s), Math.max(minOf(s), s.durationSec + share)));
  }
  // Lo que quedó por el redondeo: de a 0.1 s, repartido entre las escenas del medio.
  const body = out.filter((s) => s.role === "body");
  for (let i = 0; body.length && i < 400; i++) {
    const t = round1(total());
    const dir = t < lo ? 1 : t > hi ? -1 : 0;
    if (!dir) break;
    const s = body[i % body.length];
    const next = round1(s.durationSec + dir * 0.1);
    if (next <= maxOf(s) && next >= minOf(s)) s.durationSec = next;
  }
  return out;
}

export const totalSec = (scenes: Pick<VideoScene, "durationSec">[]) => round1(scenes.reduce((n, s) => n + s.durationSec, 0));

// ---------- Movimiento (Ken Burns) ----------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ZOOM = 1.12;

/**
 * El recorte de la foto en el instante `p` (0 = inicio de la escena, 1 = final): acercándose o alejándose del punto
 * importante, o paseando de lado. Devuelve un rectángulo en píxeles de la foto con la forma del video.
 */
export function kenBurnsRect(motion: Motion, p: number, src: { w: number; h: number }, out: { w: number; h: number }, focus: Point | null): { left: number; top: number; width: number; height: number } {
  const t = clamp(Number.isFinite(p) ? p : 0, 0, 1);
  const f = focus ?? { x: 0.5, y: 0.5 };
  const ratio = out.w / out.h;
  // El rectángulo más grande con la forma del video que cabe en la foto.
  const baseW = Math.min(src.w, src.h * ratio);
  const baseH = baseW / ratio;
  const zoom = motion === "zoom-in" ? 1 + (ZOOM - 1) * t : motion === "zoom-out" ? ZOOM - (ZOOM - 1) * t : motion === "still" ? 1 : 1.1;
  const w = baseW / zoom;
  const h = baseH / zoom;
  let cx = f.x * src.w;
  const cy = f.y * src.h;
  if (motion === "pan-left" || motion === "pan-right") {
    const span = Math.min(src.w - w, src.w * 0.12);
    const dir = motion === "pan-right" ? 1 : -1;
    cx = cx + dir * span * (t - 0.5);
  }
  const left = clamp(cx - w / 2, 0, src.w - w);
  const top = clamp(cy - h / 2, 0, src.h - h);
  return { left: Math.round(left), top: Math.round(top), width: Math.max(1, Math.round(Math.min(w, src.w - Math.round(left)))), height: Math.max(1, Math.round(Math.min(h, src.h - Math.round(top)))) };
}

/** Cuántos cuadros se dibujan por escena con movimiento (el resto lo pone el video): suave pero sin pesar demasiado. */
export const MOTION_FPS = 6;
export const MAX_FRAMES = 150;
/** Cuadros de cada escena con foto (1 si está quieta), sin pasar de MAX_FRAMES en todo el video. */
export function frameCounts(scenes: Pick<VideoScene, "motion" | "durationSec" | "role" | "mediaId">[], kinds: Map<string, "photo" | "video">, fps = MOTION_FPS, max = MAX_FRAMES): number[] {
  const moving = scenes.filter((s) => s.role !== "outro" && kinds.get(s.mediaId) === "photo" && s.motion !== "still");
  const wanted = moving.reduce((n, s) => n + Math.max(2, Math.round(s.durationSec * fps)), 0);
  const scale = wanted > max ? max / wanted : 1;
  return scenes.map((s) => {
    if (s.role === "outro" || kinds.get(s.mediaId) !== "photo") return 1;
    if (s.motion === "still") return 1;
    return Math.max(2, Math.floor(Math.round(s.durationSec * fps) * scale));
  });
}

// ---------- Costo ----------

/** Precios de fal.ai (octubre 2026): FFmpeg compose US$0.0002 por segundo de video; música CassetteAI US$0.02 por minuto. */
export const PRICES = { composePerSec: 0.0002, musicPerMin: 0.02 };

/** Lo que cuesta crear el video, en centavos de dólar (redondeado hacia arriba, mínimo 1). */
export function estimateCostCents(o: { totalSec: number; music: boolean }): number {
  const usd = o.totalSec * PRICES.composePerSec + (o.music ? Math.max(1, o.totalSec) / 60 * PRICES.musicPerMin : 0);
  return Math.max(1, Math.ceil(usd * 100 - 1e-9));
}
export const usd = (cents: number) => `US$${(cents / 100).toFixed(2)}`;

// ---------- Nombre del archivo ----------

export function slugify(text: string, max = 60): string {
  return fold(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** «cortinas-metalicas-managua-reel.mp4»: lo lee Google y las redes. `suffix` evita que dos videos choquen. */
export function videoFileName(keyword: string, city: string, format: VideoFormat, suffix = ""): string {
  const base = slugify(fold(keyword).includes(fold(city)) || !city ? keyword : `${keyword} ${city}`) || "video";
  return `${base}-${format === "vertical" ? "reel" : "youtube"}${suffix ? `-${slugify(suffix, 12)}` : ""}.mp4`;
}

// ---------- Música ----------

/** Lo que se le pide a la IA de música: el ánimo y el ritmo de la marca, instrumental y libre de derechos. */
export function musicFor(m: PlanContext["music"]): VideoMusic {
  const bpm = m?.bpmMin && m?.bpmMax ? Math.round((m.bpmMin + m.bpmMax) / 2) : m?.bpmMin || m?.bpmMax || null;
  // Sin identidad de marca no se inventa un ánimo para mostrar (la música igual se pide alegre y moderna).
  const mood = clean([...(m?.moods ?? []).slice(0, 2), ...(m?.genres ?? []).slice(0, 1)].join(", "));
  const prompt = clean(
    `${[...(m?.genres ?? []).slice(0, 2), ...(m?.moods ?? []).slice(0, 3)].join(", ") || "Upbeat modern corporate"}` +
      `${m?.instruments?.length ? `, ${m.instruments.slice(0, 3).join(", ")}` : ""}` +
      `${bpm ? `, ${bpm} BPM` : ""}, instrumental background music for a short business video, no vocals, clean mix`,
  ).slice(0, 300);
  return { on: true, mood: mood.slice(0, 60), bpm, prompt };
}

// ---------- Guion ----------

const MOTION_CYCLE: Motion[] = ["zoom-in", "pan-right", "zoom-out", "pan-left"];
const sid = (i: number, role: SceneRole) => `${role}-${i}`;

/** Ideas de texto de respaldo para las escenas del medio (si la IA no respondió). */
const FALLBACK_LINES: Record<"es" | "en", string[]> = {
  es: ["Trabajo real, terminado", "Calidad que se nota", "Hecho a tu medida", "Atención rápida", "Materiales que duran", "Cotiza sin compromiso"],
  en: ["Real work, done right", "Quality you can see", "Made to fit you", "Fast service", "Built to last", "Free quote"],
};

/** Las escenas con foto o clip: cada medio una vez y, si son pocos, se repiten con otro movimiento. */
export function mediaOrder(media: VideoMedia[], wanted: number): string[] {
  if (!media.length) return [];
  const n = Math.min(MAX_MEDIA_SCENES, Math.max(MIN_MEDIA_SCENES, wanted));
  return Array.from({ length: n }, (_, i) => media[i % media.length].id);
}

/** El gancho siempre lleva la palabra clave; si el texto de la IA no la tiene, se usa la palabra clave con la ciudad. */
export function hookCaption(caption: string, keyword: string, city: string, lang: "es" | "en"): string {
  const c = cleanCaption(caption);
  if (!keyword || hasKeyword(c, keyword)) return c || cleanCaption(keywordWithCity(keyword, city, lang));
  const kc = cleanCaption(keywordWithCity(keyword, city, lang));
  return hasKeyword(kc, keyword) ? kc : cleanCaption(cityCased(keyword, city));
}

function outroCaption(ctx: PlanContext, draft = ""): string {
  return cleanCaption(ctx.business.slogan || draft || ctx.business.name);
}

/** Datos fijos del guion (todo menos escenas y textos). */
function baseOf(ctx: PlanContext, keyword: string, keywords: string[]): Omit<Storyboard, "scenes" | "texts" | "source"> {
  return {
    v: 1,
    format: ctx.format,
    idea: clean(ctx.idea).slice(0, 600),
    keyword,
    keywords,
    city: ctx.business.city,
    lang: ctx.lang,
    media: ctx.media,
    outro: {
      name: ctx.business.name,
      slogan: ctx.business.slogan,
      phone: ctx.business.phone,
      website: ctx.business.website,
      logoUrl: ctx.business.logoUrl,
      logoLightUrl: ctx.business.logoLightUrl,
      color: ctx.business.color,
      color2: ctx.business.color2,
      fontHeading: ctx.business.fontHeading,
    },
    music: musicFor(ctx.music),
  };
}

/** Todos los textos de las redes (siempre con palabra clave y ciudad). */
export function buildTexts(sb: Pick<Storyboard, "keyword" | "keywords" | "city" | "lang" | "format" | "outro">, draft: { title?: string; summary?: string; caption?: string; hashtags?: string } = {}): VideoTexts {
  const hashtags = hashtagsFor({ keyword: sb.keyword, keywords: sb.keywords, city: sb.city, name: sb.outro.name, hashtags: draft.hashtags ?? "" });
  const base = { keyword: sb.keyword, city: sb.city, lang: sb.lang, phone: sb.outro.phone, website: sb.outro.website, hashtags };
  const message = draft.caption || draft.summary || keywordWithCity(sb.keyword, sb.city, sb.lang);
  const description = youtubeDescription(draft.summary || message, { ...base, keywords: sb.keywords, name: sb.outro.name, format: sb.format });
  return {
    title: youtubeTitle(draft.title ?? "", { keyword: sb.keyword, city: sb.city, name: sb.outro.name, format: sb.format, lang: sb.lang }),
    description,
    tags: fitTags([sb.keyword, keywordWithCity(sb.keyword, sb.city, sb.lang), ...sb.keywords, sb.city, sb.outro.name]),
    instagram: socialCaption(message, base, "instagram"),
    tiktok: socialCaption(message, base, "tiktok"),
    facebook: socialCaption(message, base, "facebook"),
  };
}

/** Guion de respaldo (sin IA): gancho con la palabra clave, escenas con frases cortas y cierre con la marca. */
export function templateStoryboard(ctx: PlanContext): Storyboard {
  const keywords = uniqueKeywords(ctx.keywords);
  const keyword = pickKeyword(ctx.idea, keywords) || cleanCaption(ctx.idea, 4) || ctx.business.name;
  const base = baseOf(ctx, keyword, keywords);
  const order = mediaOrder(ctx.media, ctx.media.length);
  const lines = FALLBACK_LINES[ctx.lang];
  const scenes: VideoScene[] = order.map((mediaId, i) => ({
    id: sid(i, i === 0 ? "hook" : "body"),
    role: i === 0 ? "hook" : "body",
    mediaId,
    durationSec: 3,
    motion: MOTION_CYCLE[i % MOTION_CYCLE.length],
    caption: i === 0 ? hookCaption("", keyword, ctx.business.city, ctx.lang) : cleanCaption(lines[(i - 1) % lines.length]),
  }));
  scenes.push({ id: sid(order.length, "outro"), role: "outro", mediaId: "", durationSec: OUTRO_SEC, motion: "still", caption: outroCaption(ctx) });
  const sb: Storyboard = { ...base, scenes: fitDurations(scenes, ctx.media, ctx.format), texts: undefined as unknown as VideoTexts, source: "template" };
  sb.texts = buildTexts(sb, { summary: ctx.idea, hashtags: ctx.business.hashtags });
  return sb;
}

// ---------- La IA escribe el guion ----------

export const AiStoryboardSchema = z.object({
  scenes: z
    .array(
      z.object({
        media: z.number().int().describe("0-based index of the photo or clip from the list"),
        caption: z.string().describe("On-screen text, at most 6 words, in the content language"),
        motion: z.enum(MOTIONS).describe("Camera move over the photo: zoom-in, zoom-out, pan-left, pan-right or still"),
      }),
    )
    .describe("4 to 7 scenes in order (the closing brand scene is added automatically, do not include it)"),
  outroCaption: z.string().describe("Closing line, at most 6 words (the slogan if there is one)"),
  title: z.string().describe("YouTube title, at most 90 characters, with the main keyword and the city"),
  summary: z.string().describe("YouTube description first paragraph: 2-3 sentences with the main keyword and the city, no hashtags, no phone, no links"),
  caption: z.string().describe("Short social caption for Reels/TikTok/Facebook: 1-3 sentences with the main keyword and the city and a call to action, no hashtags"),
});
export type AiStoryboard = z.infer<typeof AiStoryboardSchema>;

/** El pedido a la IA (sin la identidad de marca: la acción la agrega con identityPrompt). */
export function storyboardPrompt(ctx: PlanContext, keyword: string, keywords: string[]): { system: string; user: string } {
  const lang = ctx.lang === "en" ? "English" : "Spanish (with correct accents)";
  const wanted = Math.min(MAX_MEDIA_SCENES, Math.max(MIN_MEDIA_SCENES, ctx.media.length));
  const system = `You are a short-form video editor for the local business "${ctx.business.name}"${ctx.business.city ? ` in ${ctx.business.city}` : ""}. You write the storyboard of a ${ctx.format === "vertical" ? "vertical 9:16 Reel/TikTok/YouTube Short of 15-30 seconds" : "horizontal 16:9 YouTube video of 20-60 seconds"} made ONLY from the business's real photos and clips.

Rules:
- Scene 1 is the hook (first 2 seconds): it must stop the scroll and contain the main keyword "${keyword}".
- Each caption has at most 6 words, plain words, no hashtags, no emojis. Use the business keywords naturally in several captions.
- Use only the photos/clips given (by index). Pick the best one for the hook. You may reuse one with a different motion if there are few.
- Never invent prices, discounts, guarantees, awards or facts that are not in the idea or the photo descriptions.
- Title, summary and caption must contain the main keyword and the city${ctx.business.city ? ` (${ctx.business.city})` : ""}.
- Write everything in ${lang}.`;
  const list = ctx.media.map((m, i) => `${i}. ${m.kind === "video" ? `CLIP (${m.durationSec ? `${Math.round(m.durationSec)} s` : "video"})` : "PHOTO"}: ${m.about || "(no description)"}`).join("\n");
  const user = `Idea for the video: ${clean(ctx.idea) || "(show our real work)"}
Main keyword: ${keyword || "(none)"}
Other business keywords: ${keywords.filter((k) => k !== keyword).slice(0, 10).join(", ") || "(none)"}
Slogan: ${ctx.business.slogan || "(none)"}

Photos and clips (index: what it shows):
${list || "(none)"}

Write ${wanted} scenes.`;
  return { system, user };
}

/** Convierte la respuesta de la IA en un guion válido (o null si no sirve). */
export function fromAi(ctx: PlanContext, ai: AiStoryboard): Storyboard | null {
  if (!ctx.media.length) return null;
  const keywords = uniqueKeywords(ctx.keywords);
  const keyword = pickKeyword(ctx.idea, keywords) || cleanCaption(ctx.idea, 4) || ctx.business.name;
  const valid = ai.scenes.filter((s) => Number.isInteger(s.media) && s.media >= 0 && s.media < ctx.media.length);
  if (!valid.length) return null;
  const want = Math.min(MAX_MEDIA_SCENES, Math.max(MIN_MEDIA_SCENES, valid.length));
  const picked = Array.from({ length: want }, (_, i) => valid[i] ?? { media: (i % ctx.media.length), caption: FALLBACK_LINES[ctx.lang][i % 6], motion: MOTION_CYCLE[i % 4] });
  const scenes: VideoScene[] = picked.map((s, i) => ({
    id: sid(i, i === 0 ? "hook" : "body"),
    role: i === 0 ? "hook" : "body",
    mediaId: ctx.media[s.media].id,
    durationSec: 3,
    motion: MOTIONS.includes(s.motion) ? s.motion : MOTION_CYCLE[i % 4],
    caption: i === 0 ? hookCaption(s.caption, keyword, ctx.business.city, ctx.lang) : cleanCaption(s.caption),
  }));
  scenes.push({ id: sid(picked.length, "outro"), role: "outro", mediaId: "", durationSec: OUTRO_SEC, motion: "still", caption: outroCaption(ctx, ai.outroCaption) });
  const sb: Storyboard = { ...baseOf(ctx, keyword, keywords), scenes: fitDurations(scenes, ctx.media, ctx.format), texts: undefined as unknown as VideoTexts, source: "ai" };
  sb.texts = buildTexts(sb, { title: ai.title, summary: ai.summary, caption: ai.caption, hashtags: ctx.business.hashtags });
  return sb;
}

// ---------- Cambios del dueño ----------

export type SceneEdit = { id: string; caption: string; motion?: Motion; mediaId?: string };

/**
 * Aplica el orden y los textos que dejó el dueño (y lo que quitó). Siempre queda un guion válido: de 4 a 7 escenas
 * con foto o clip (si quitó de más, se repiten), el gancho primero con la palabra clave, el cierre al final y el
 * total dentro del rango.
 */
export function applyEdits(sb: Storyboard, edits: SceneEdit[]): Storyboard {
  const known = new Map(sb.scenes.map((s) => [s.id, s]));
  const mediaIds = new Set(sb.media.map((m) => m.id));
  const outro = sb.scenes.find((s) => s.role === "outro");
  const body = edits
    .map((e) => {
      const s = known.get(e.id);
      if (!s || s.role === "outro") return null;
      return { ...s, caption: cleanCaption(e.caption ?? s.caption), motion: e.motion && MOTIONS.includes(e.motion) ? e.motion : s.motion, mediaId: e.mediaId && mediaIds.has(e.mediaId) ? e.mediaId : s.mediaId };
    })
    .filter((s): s is VideoScene => s !== null && mediaIds.has(s.mediaId));
  // Si quitó de más, se repiten las que quedan con otro movimiento.
  const source = body.length ? body : sb.scenes.filter((s) => s.role !== "outro");
  const list: VideoScene[] = [];
  for (let i = 0; list.length < Math.max(MIN_MEDIA_SCENES, Math.min(MAX_MEDIA_SCENES, source.length)); i++) {
    const s = source[i % source.length];
    if (!s) break;
    list.push(i < source.length ? s : { ...s, id: `${s.id}-r${i}`, motion: MOTION_CYCLE[i % 4] });
  }
  const scenes: VideoScene[] = list.map((s, i) => ({
    ...s,
    role: i === 0 ? "hook" : "body",
    durationSec: i === 0 ? HOOK_SEC : s.role === "hook" ? 3 : s.durationSec,
    caption: i === 0 ? hookCaption(s.caption, sb.keyword, sb.city, sb.lang) : s.caption,
  }));
  const outroEdit = outro ? edits.find((e) => e.id === outro.id) : undefined;
  scenes.push({ ...(outro ?? { id: "outro-x", role: "outro", mediaId: "", durationSec: OUTRO_SEC, motion: "still", caption: "" }), caption: cleanCaption(outroEdit?.caption ?? outro?.caption ?? sb.outro.slogan ?? sb.outro.name) });
  return { ...sb, scenes: fitDurations(scenes, sb.media, sb.format) };
}

/** Los textos que el dueño cambió, con los mínimos de siempre (palabra clave, ciudad, largo y hashtags). */
export function applyTextEdits(sb: Storyboard, t: Partial<VideoTexts>): VideoTexts {
  const cur = sb.texts;
  const title = t.title !== undefined ? youtubeTitle(t.title, { keyword: sb.keyword, city: sb.city, name: sb.outro.name, format: sb.format, lang: sb.lang }) : cur.title;
  const limitTags = (s: string) => {
    const tags = [...s.matchAll(/#[\p{L}\p{N}_]+/gu)].map((m) => m[0]);
    if (tags.length <= 5) return s.trim();
    let n = 0;
    return s.replace(/#[\p{L}\p{N}_]+/gu, (m) => (++n > 5 ? "" : m)).replace(/[ \t]{2,}/g, " ").trim();
  };
  return {
    title,
    description: t.description !== undefined ? t.description.replace(/[<>]/g, "").slice(0, 5000) : cur.description,
    tags: t.tags !== undefined ? fitTags(t.tags) : cur.tags,
    instagram: t.instagram !== undefined ? limitTags(t.instagram).slice(0, 2200) : cur.instagram,
    tiktok: t.tiktok !== undefined ? limitTags(t.tiktok).slice(0, 2200) : cur.tiktok,
    facebook: t.facebook !== undefined ? t.facebook.trim().slice(0, 5000) : cur.facebook,
  };
}

// ---------- Proyecto guardado ----------

export const VIDEO_KIND = "video";
export type VideoStatus = "draft" | "rendering" | "ready" | "failed" | "published";
export type FalJobRef = { statusUrl: string; responseUrl: string };
export type RenderJob = {
  stage: "music" | "compose";
  music: FalJobRef | null;
  musicUrl: string;
  compose: FalJobRef | null;
  /** Cuadros y clips ya subidos, en orden (para armar el video cuando llegue la música). */
  keyframes: { url: string; timestamp: number; duration: number }[];
  totalMs: number;
  startedAt: number;
  etaSec: number;
};
export type VideoProject = {
  v: 1;
  status: VideoStatus;
  storyboard: Storyboard;
  job: RenderJob | null;
  videoUrl: string;
  thumbUrl: string;
  error: string;
  costCents: number;
  postId: string;
  updatedAt: string;
};

const asStr = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const asNum = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

function readMedia(raw: unknown): VideoMedia | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = asStr(o.id, 64);
  const url = asStr(o.url);
  if (!id || !url) return null;
  const f = o.focus as Record<string, unknown> | null | undefined;
  const focus = f && typeof f === "object" && Number.isFinite(f.x) && Number.isFinite(f.y) ? { x: clamp(Number(f.x), 0, 1), y: clamp(Number(f.y), 0, 1) } : null;
  return { id, kind: o.kind === "video" ? "video" : "photo", url, thumb: asStr(o.thumb), focus, width: asNum(o.width), height: asNum(o.height), durationSec: asNum(o.durationSec), about: asStr(o.about, 400) };
}

function readScene(raw: unknown): VideoScene | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const role = o.role === "hook" || o.role === "outro" ? o.role : "body";
  const id = asStr(o.id, 40);
  if (!id) return null;
  return { id, role, mediaId: asStr(o.mediaId, 64), durationSec: clamp(asNum(o.durationSec, 3), 0.5, 15), motion: MOTIONS.includes(o.motion as Motion) ? (o.motion as Motion) : "still", caption: cleanCaption(asStr(o.caption, 200)) };
}

/** Lee un guion guardado sin confiar en él (null si no sirve). */
export function readStoryboard(raw: unknown): Storyboard | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const media = (Array.isArray(o.media) ? o.media : []).map(readMedia).filter((m): m is VideoMedia => m !== null);
  const scenes = (Array.isArray(o.scenes) ? o.scenes : []).map(readScene).filter((s): s is VideoScene => s !== null);
  if (!scenes.length) return null;
  const ou = (o.outro ?? {}) as Record<string, unknown>;
  const mu = (o.music ?? {}) as Record<string, unknown>;
  const tx = (o.texts ?? {}) as Record<string, unknown>;
  return {
    v: 1,
    format: o.format === "horizontal" ? "horizontal" : "vertical",
    idea: asStr(o.idea, 600),
    keyword: asStr(o.keyword, 80),
    keywords: (Array.isArray(o.keywords) ? o.keywords : []).map((k) => asStr(k, 80)).filter(Boolean).slice(0, 20),
    city: asStr(o.city, 80),
    lang: o.lang === "en" ? "en" : "es",
    scenes,
    media,
    outro: {
      name: asStr(ou.name, 120),
      slogan: asStr(ou.slogan, 120),
      phone: asStr(ou.phone, 40),
      website: asStr(ou.website, 200),
      logoUrl: asStr(ou.logoUrl),
      logoLightUrl: asStr(ou.logoLightUrl),
      color: asStr(ou.color, 9) || "#126BBC",
      color2: asStr(ou.color2, 9),
      fontHeading: asStr(ou.fontHeading, 40),
    },
    music: { on: mu.on !== false, mood: asStr(mu.mood, 60), bpm: typeof mu.bpm === "number" ? mu.bpm : null, prompt: asStr(mu.prompt, 300) },
    texts: {
      title: asStr(tx.title, 100),
      description: asStr(tx.description, 5000),
      tags: (Array.isArray(tx.tags) ? tx.tags : []).map((t) => asStr(t, 100)).filter(Boolean),
      instagram: asStr(tx.instagram, 2200),
      tiktok: asStr(tx.tiktok, 2200),
      facebook: asStr(tx.facebook, 5000),
    },
    source: o.source === "ai" ? "ai" : "template",
  };
}

function readJob(raw: unknown): RenderJob | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ref = (v: unknown): FalJobRef | null => {
    if (!v || typeof v !== "object") return null;
    const r = v as Record<string, unknown>;
    return typeof r.statusUrl === "string" && typeof r.responseUrl === "string" ? { statusUrl: r.statusUrl, responseUrl: r.responseUrl } : null;
  };
  const keyframes = (Array.isArray(o.keyframes) ? o.keyframes : [])
    .map((k) => k as Record<string, unknown>)
    .filter((k) => typeof k?.url === "string")
    .map((k) => ({ url: String(k.url), timestamp: asNum(k.timestamp), duration: asNum(k.duration) }));
  return { stage: o.stage === "compose" ? "compose" : "music", music: ref(o.music), musicUrl: asStr(o.musicUrl), compose: ref(o.compose), keyframes, totalMs: asNum(o.totalMs), startedAt: asNum(o.startedAt), etaSec: asNum(o.etaSec, 90) };
}

const STATUSES: VideoStatus[] = ["draft", "rendering", "ready", "failed", "published"];
/** Lee un proyecto de video guardado (SeoReport kind "video"); null si no sirve. */
export function readVideoProject(raw: unknown): VideoProject | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const storyboard = readStoryboard(o.storyboard);
  if (!storyboard) return null;
  return {
    v: 1,
    status: STATUSES.includes(o.status as VideoStatus) ? (o.status as VideoStatus) : "draft",
    storyboard,
    job: readJob(o.job),
    videoUrl: asStr(o.videoUrl),
    thumbUrl: asStr(o.thumbUrl),
    error: asStr(o.error, 600),
    costCents: asNum(o.costCents),
    postId: asStr(o.postId, 64),
    updatedAt: asStr(o.updatedAt, 40),
  };
}

/** Las pistas para FFmpeg compose de fal.ai: los cuadros/clips en orden y, si hay, la música debajo. */
export function composeTracks(keyframes: RenderJob["keyframes"], musicUrl: string, totalMs: number, visualType: "video" | "image" = "video") {
  const tracks: { id: string; type: "video" | "image" | "audio"; keyframes: { timestamp: number; duration: number; url: string }[] }[] = [
    { id: "visual", type: visualType, keyframes: keyframes.map((k) => ({ timestamp: Math.round(k.timestamp), duration: Math.round(k.duration), url: k.url })) },
  ];
  if (musicUrl) tracks.push({ id: "music", type: "audio", keyframes: [{ timestamp: 0, duration: Math.round(totalMs), url: musicUrl }] });
  return tracks;
}

/** Canales donde se publica cada forma de video. */
export function channelsFor(format: VideoFormat): ("instagram" | "tiktok" | "youtube" | "facebook")[] {
  return format === "vertical" ? ["instagram", "tiktok", "youtube", "facebook"] : ["youtube", "facebook"];
}
