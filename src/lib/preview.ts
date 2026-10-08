// Cómo se ve un post en cada red antes de publicarlo: dónde corta el texto con «… más», cuántos caracteres
// acepta, qué pasa con los hashtags y los enlaces, y qué forma tiene la foto. Sin JSX ni servidor: lo usan
// los componentes de src/components/preview y se puede probar solo (tests/preview.test.ts).
import { CHANNEL_FORMATS, adaptPlan, type ChannelFormat } from "@/lib/formats";
import { DESIGN_SHAPES } from "@/lib/design-shapes";
import { channelDef, type ChannelId } from "@/lib/channels";

/** Las vistas de la vista previa. Instagram tiene dos: el feed (fotos) y el reel/historia (9:16). */
export type PreviewKind = "instagram" | "instagram-story" | "facebook" | "linkedin" | "google" | "x" | "tiktok";

export type NetworkSpec = {
  kind: PreviewKind;
  /** Canal que publica esta vista. */
  channel: ChannelId;
  name: { es: string; en: string };
  /** Límite de caracteres del texto (0 = sin límite). */
  limit: number;
  /** Dónde corta la red el texto con «… más»: caracteres y líneas (lo que llegue primero). 0 = no corta. */
  cutChars: number;
  cutLines: number;
  more: { es: string; en: string };
  /** Los enlaces del texto se pueden tocar. */
  linksClickable: boolean;
  /** X cuenta cada enlace como 23 caracteres. */
  linkWeight?: number;
  /** Máximo de hashtags que la red acepta o recomienda (0 = no sirven en esta red). */
  hashtagMax: number | null;
  /** Forma de la foto (de src/lib/formats.ts). */
  format: ChannelFormat | null;
  /** Forma vertical 9:16 (reels, historias, TikTok). */
  vertical?: boolean;
};

const fmt = (c: string) => CHANNEL_FORMATS[c] ?? null;
const VERTICAL: ChannelFormat = { shape: "story", min: 0.5, max: 0.66, es: "Vertical 9:16 (1080×1920)", en: "Vertical 9:16 (1080×1920)" };

/**
 * Reglas de cada red (octubre 2026):
 * - Instagram: 2.200 caracteres; el feed muestra ~125 caracteres (2 líneas) y «… más»; como mucho 5 hashtags;
 *   los enlaces del texto no se pueden tocar.
 * - Reels / historias / TikTok: el texto va encima del video, se ve ~1 línea.
 * - Facebook: 63.206 caracteres; en el celular corta a ~5 líneas (~240 caracteres) con «Ver más».
 * - LinkedIn: 3.000 caracteres; «…ver más» a las ~3 líneas (~210 caracteres).
 * - Perfil de Negocio de Google: 1.500 caracteres; en Google se ven ~2 líneas; los hashtags no sirven, los enlaces
 *   del texto no se tocan (se usa el botón) y Google puede rechazar posts con número de teléfono.
 * - X: 280 caracteres (cada enlace cuenta 23); 1-2 hashtags.
 */
export const NETWORKS: Record<PreviewKind, NetworkSpec> = {
  instagram: { kind: "instagram", channel: "instagram", name: { es: "Instagram", en: "Instagram" }, limit: 2200, cutChars: 125, cutLines: 2, more: { es: "más", en: "more" }, linksClickable: false, hashtagMax: 5, format: fmt("instagram") },
  "instagram-story": { kind: "instagram-story", channel: "instagram", name: { es: "Instagram · Reel", en: "Instagram · Reel" }, limit: 2200, cutChars: 55, cutLines: 1, more: { es: "más", en: "more" }, linksClickable: false, hashtagMax: 5, format: VERTICAL, vertical: true },
  facebook: { kind: "facebook", channel: "facebook", name: { es: "Facebook", en: "Facebook" }, limit: 63206, cutChars: 240, cutLines: 5, more: { es: "Ver más", en: "See more" }, linksClickable: true, hashtagMax: null, format: fmt("facebook") },
  linkedin: { kind: "linkedin", channel: "linkedin", name: { es: "LinkedIn", en: "LinkedIn" }, limit: 3000, cutChars: 210, cutLines: 3, more: { es: "ver más", en: "see more" }, linksClickable: true, hashtagMax: 5, format: fmt("linkedin") },
  google: { kind: "google", channel: "google", name: { es: "Google", en: "Google" }, limit: 1500, cutChars: 110, cutLines: 2, more: { es: "Más", en: "More" }, linksClickable: false, hashtagMax: 0, format: fmt("google") },
  x: { kind: "x", channel: "x", name: { es: "X", en: "X" }, limit: 280, cutChars: 0, cutLines: 0, more: { es: "Mostrar más", en: "Show more" }, linksClickable: true, linkWeight: 23, hashtagMax: 2, format: fmt("x") },
  tiktok: { kind: "tiktok", channel: "tiktok", name: { es: "TikTok", en: "TikTok" }, limit: channelDef("tiktok")?.limit ?? 2200, cutChars: 70, cutLines: 2, more: { es: "más", en: "more" }, linksClickable: false, hashtagMax: null, format: VERTICAL, vertical: true },
};

/** Una pestaña de la vista previa: una vista de red social, o un canal sin vista propia (email, SMS, web). */
export type PreviewView = PreviewKind | Exclude<ChannelId, "facebook" | "instagram" | "linkedin" | "google" | "x" | "tiktok">;
export const isNetworkView = (v: PreviewView): v is PreviewKind => v in NETWORKS;
/** El canal que publica una vista. */
export const channelOfView = (v: PreviewView): ChannelId => (isNetworkView(v) ? NETWORKS[v].channel : v);

/**
 * Las pestañas para los canales elegidos (en su orden). Instagram con video se ve como reel; con `stories`
 * (para cuando se publiquen historias) también se agrega la vista vertical para fotos.
 */
export function viewsFor(channels: ChannelId[], mediaType: "none" | "photo" | "video", opts: { stories?: boolean } = {}): PreviewView[] {
  const out: PreviewView[] = [];
  for (const c of channels) {
    if (c === "instagram") {
      out.push(mediaType === "video" ? "instagram-story" : "instagram");
      if (opts.stories && mediaType === "photo") out.push("instagram-story");
    } else out.push(c);
  }
  return out;
}

// ---------- Texto ----------

const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"»”]/gi;
const TAG_RE = /(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]{1,80})/gu;

export const hashtagsOf = (text: string) => [...text.matchAll(TAG_RE)].map((m) => `#${m[2]}`);
export const linksOf = (text: string) => text.match(URL_RE) ?? [];
/** Teléfonos escritos en el texto (7+ dígitos con espacios, guiones o paréntesis). */
export const hasPhone = (text: string) => (text.replace(URL_RE, "").match(/\+?\(?\d[\d\s().-]{5,}\d/g) ?? []).some((m) => m.replace(/\D/g, "").length >= 7 && !/^\d{4}\s*[-–]\s*\d{4}$/.test(m.trim()));

/** Caracteres que cuenta la red: X cuenta cada enlace como 23 y los emojis como 2. */
export function countFor(text: string, spec: Pick<NetworkSpec, "linkWeight">): number {
  if (!spec.linkWeight) return [...text].length;
  let n = 0;
  const rest = text.replace(URL_RE, () => {
    n += spec.linkWeight!;
    return "";
  });
  for (const ch of rest) n += (ch.codePointAt(0) ?? 0) > 0x2fff ? 2 : 1;
  return n;
}

/**
 * Lo que se ve antes de «… más»: corta en `cutChars` caracteres o al final de la línea `cutLines` (lo que
 * llegue primero), sin partir palabras. `cut` dice si quedó texto escondido.
 */
export function truncateForPreview(text: string, spec: Pick<NetworkSpec, "cutChars" | "cutLines">): { shown: string; cut: boolean } {
  const t = text.replace(/\s+$/, "");
  if (!spec.cutChars && !spec.cutLines) return { shown: t, cut: false };
  let end = t.length;
  if (spec.cutLines) {
    let idx = -1;
    for (let i = 0; i < spec.cutLines; i++) {
      idx = t.indexOf("\n", idx + 1);
      if (idx < 0) break;
    }
    if (idx >= 0) end = Math.min(end, idx);
  }
  if (spec.cutChars && [...t].length > spec.cutChars) end = Math.min(end, [...t].slice(0, spec.cutChars).join("").length);
  if (end >= t.length) return { shown: t, cut: false };
  let shown = t.slice(0, end);
  // Sin partir la última palabra (si la cortó a la mitad).
  if (/\S/.test(t[end] ?? "") && /\S$/.test(shown)) {
    const sp = shown.search(/\s\S*$/);
    if (sp > 0) shown = shown.slice(0, sp);
  }
  return { shown: shown.replace(/[\s,;:.\-–—]+$/, ""), cut: true };
}

/** Partes del texto para dibujarlo: texto normal, enlaces y hashtags (con su color en cada red). */
export type Piece = { kind: "text" | "link" | "tag" | "break"; value: string };
export function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  const re = new RegExp(`${URL_RE.source}|${TAG_RE.source}|\\n`, "giu");
  let last = 0;
  for (const m of text.matchAll(re)) {
    let start = m.index ?? 0;
    let value = m[0];
    if (value === "\n") {
      if (start > last) out.push({ kind: "text", value: text.slice(last, start) });
      out.push({ kind: "break", value: "\n" });
      last = start + 1;
      continue;
    }
    const kind: Piece["kind"] = /^https?:/i.test(value) ? "link" : "tag";
    if (kind === "tag" && !value.startsWith("#")) {
      // El carácter de antes del # (un espacio, un signo o un salto de línea) no es parte del hashtag.
      const before = value.slice(0, value.indexOf("#"));
      start += before.length;
      value = value.slice(before.length);
      if (before === "\n") {
        if (start - 1 > last) out.push({ kind: "text", value: text.slice(last, start - 1) });
        out.push({ kind: "break", value: "\n" });
        last = start;
      }
    }
    if (start > last) out.push({ kind: "text", value: text.slice(last, start) });
    out.push({ kind, value });
    last = start + value.length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}

export type PreviewNote = { id: string; level: "error" | "warn" | "tip"; es: string; en: string };

/** Avisos de cada red: muy largo, demasiados hashtags, enlaces que no se tocan, teléfono en Google, falta foto o video. */
export function previewNotes(text: string, spec: NetworkSpec, mediaType: "none" | "photo" | "video"): PreviewNote[] {
  const notes: PreviewNote[] = [];
  const n = countFor(text, spec);
  if (spec.limit && n > spec.limit) {
    const over = n - spec.limit;
    notes.push({ id: "limit", level: "error", es: `Sobran ${over} caracteres: ${spec.name.es} acepta ${spec.limit.toLocaleString("es")}.`, en: `${over} characters too many: ${spec.name.en} allows ${spec.limit.toLocaleString("en")}.` });
  }
  const tags = hashtagsOf(text).length;
  if (spec.hashtagMax === 0 && tags) notes.push({ id: "tags-useless", level: "tip", es: "En Google los hashtags no sirven; puedes quitarlos.", en: "Hashtags don't do anything on Google; you can remove them." });
  else if (spec.hashtagMax && tags > spec.hashtagMax) {
    notes.push(
      spec.channel === "instagram"
        ? { id: "tags-max", level: "warn", es: `Instagram acepta como mucho ${spec.hashtagMax} hashtags; tienes ${tags}.`, en: `Instagram allows up to ${spec.hashtagMax} hashtags; you have ${tags}.` }
        : { id: "tags-max", level: "tip", es: `En ${spec.name.es} conviene usar como mucho ${spec.hashtagMax} hashtags; tienes ${tags}.`, en: `On ${spec.name.en} it's best to use ${spec.hashtagMax} hashtags at most; you have ${tags}.` },
    );
  }
  if (!spec.linksClickable && linksOf(text).length) {
    notes.push(
      spec.channel === "google"
        ? { id: "links", level: "tip", es: "En Google los enlaces del texto no se pueden tocar; la publicación lleva un botón a tu página.", en: "On Google, links in the text can't be tapped; the post gets a button to your website." }
        : { id: "links", level: "tip", es: `En ${spec.name.es} los enlaces del texto no se pueden tocar. Escribe «enlace en el perfil».`, en: `On ${spec.name.en}, links in the text can't be tapped. Write "link in bio".` },
    );
  }
  if (spec.channel === "google" && hasPhone(text)) notes.push({ id: "phone", level: "warn", es: "Google puede rechazar publicaciones con un número de teléfono. Tus clientes ya tienen el botón «Llamar».", en: "Google may reject posts that include a phone number. Customers already have the Call button." });
  if (spec.channel === "instagram" && mediaType === "none") notes.push({ id: "media", level: "error", es: "Instagram necesita una foto o un video.", en: "Instagram needs a photo or a video." });
  if (spec.channel === "tiktok" && mediaType !== "video") notes.push({ id: "media", level: "error", es: "TikTok necesita un video.", en: "TikTok needs a video." });
  return notes;
}

// ---------- Foto ----------

/**
 * Proporción (ancho/alto) del cuadro de la foto en una red y cómo se ajusta: igual que al publicar
 * (mediaForChannel): "keep" se ve tal cual, "crop" se recorta, "fit" se centra sobre un fondo desenfocado.
 * Los diseños con la marca se vuelven a dibujar en la forma de la red (`design`).
 */
export function mediaFrame(spec: NetworkSpec, ratio: number | null, o: { hasText: boolean; design?: boolean }): { ratio: number; fit: "cover" | "contain" | "blur" } {
  const f = spec.format;
  if (!f) return { ratio: ratio ?? 1, fit: "cover" };
  const { w, h } = DESIGN_SHAPES[f.shape];
  const want = w / h;
  if (o.design || !ratio) return { ratio: want, fit: "cover" };
  if (spec.vertical) return { ratio: want, fit: Math.abs(ratio - want) / want < 0.03 ? "cover" : "blur" };
  const plan = adaptPlan(ratio, f, { hasText: o.hasText });
  if (plan === "keep") return { ratio: Math.min(f.max, Math.max(f.min, ratio)), fit: "cover" };
  return { ratio: want, fit: plan === "crop" ? "cover" : "blur" };
}
