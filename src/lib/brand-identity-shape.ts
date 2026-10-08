// Identidad de la marca más allá de lo visual (Business.brandIdentity, JSON): eslogan, mensajes clave, voz (sí / no),
// palabras que se usan y que nunca se usan, a quién le habla, música para los videos (solo libre de derechos), estilo
// de fotos y las 3 direcciones de identidad que propone la IA para escoger. Sin servidor ni base de datos: se usa en
// pantalla, en las acciones y en las pruebas.
import { BODY_FONTS, type BodyFontId, FONTS, type FontId } from "@/lib/design-shapes";

export type BiText = { es: string; en: string };

export type KeyMessage = {
  text: BiText;
  /** Por qué este mensaje importa para el cliente (texto corto para el dueño). */
  why: string;
};

export const ENERGIES = ["low", "medium", "high"] as const;
export type Energy = (typeof ENERGIES)[number];

export type IdentityVoice = {
  /** Cómo habla la marca, en 1-3 frases. */
  summary: string;
  /** Palabras de personalidad ("cercana", "experta", "directa"). */
  personality: string[];
  /** Lo que sí hace al escribir. */
  do: string[];
  /** Lo que nunca hace al escribir. */
  dont: string[];
  /** Palabras o frases que siempre usa. */
  useWords: string[];
  /** Palabras o frases que nunca usa. */
  avoidWords: string[];
};

/** Música para los videos (Fase 4): solo música libre de derechos; nunca canciones con licencia. */
export type IdentityMusic = {
  moods: string[];
  genres: string[];
  bpmMin: number | null;
  bpmMax: number | null;
  energy: Energy | "";
  instruments: string[];
  /** Qué buscar en bibliotecas de música libre de derechos (en inglés, como se busca ahí). */
  searchTerms: string[];
};

/** Una dirección de identidad propuesta por la IA. */
export type IdentityProposal = {
  id: string;
  /** Nombre de la dirección ("Confianza industrial"). */
  name: string;
  /** Principal, secundario y acento (#rrggbb). */
  palette: [string, string, string];
  paletteWhy: string;
  fontHeading: FontId;
  fontBody: BodyFontId;
  slogan: BiText;
  /** Cómo habla, en una o dos frases. */
  voice: string;
  /** Ánimo de la música ("enérgica y moderna"). */
  music: string;
  /** Titular de ejemplo de un post con esta dirección. */
  headline: string;
};

export type IdentitySource = "book" | "ai" | "manual";

export type BrandIdentity = {
  slogan: BiText;
  /** Frase corta o descripción de una línea. */
  tagline: BiText;
  /** 3-6 mensajes clave. */
  messages: KeyMessage[];
  voice: IdentityVoice;
  /** A quién le habla la marca. */
  audience: string;
  music: IdentityMusic;
  /** Qué tipo de fotos van con la marca. */
  photoStyle: string;
  proposals: IdentityProposal[];
  /** id de la propuesta elegida ("" si ninguna). */
  chosenProposal: string;
  /** De dónde salió (vacío si todavía no hay nada). */
  source: IdentitySource | "";
  /** Cuándo se aplicó una propuesta por última vez (cambia colores y letras del formulario de la marca). */
  appliedAt: string;
  updatedAt: string;
};

export const MAX_MESSAGES = 6;
export const MAX_LIST = 12;
export const MAX_PROPOSALS = 3;
const MAX_LINE = 160;
const MAX_TEXT = 600;
const HEX = /^#[0-9a-f]{6}$/;

const s = (v: unknown, max = MAX_LINE): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Texto en dos idiomas; si falta uno se queda vacío (la pantalla muestra el otro). */
export function readBi(v: unknown, max = MAX_LINE): BiText {
  if (typeof v === "string") return { es: s(v, max), en: "" };
  if (!v || typeof v !== "object") return { es: "", en: "" };
  const o = v as Record<string, unknown>;
  return { es: s(o.es, max), en: s(o.en, max) };
}

/** Lista de textos cortos sin repetidos (acepta también un texto con comas o renglones). */
export function readList(v: unknown, max = MAX_LIST, len = 80): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,;]+/) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    const t = s(x, len);
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

const bpm = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 40 && n <= 220 ? Math.round(n) : null;
};

export const hexColor = (v: unknown): string => {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return HEX.test(t) ? t : "";
};

export const asFontHeading = (v: unknown): FontId | null => (typeof v === "string" && v in FONTS ? (v as FontId) : null);
export const asFontBody = (v: unknown): BodyFontId | null => {
  if (typeof v !== "string") return null;
  const key = v.trim().toLowerCase().replace(/\s+/g, "-");
  return key in BODY_FONTS ? (key as BodyFontId) : null;
};

function readMessages(v: unknown): KeyMessage[] {
  const out: KeyMessage[] = [];
  for (const m of Array.isArray(v) ? v : []) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const text = readBi(o.text ?? o);
    if (!text.es && !text.en) continue;
    out.push({ text, why: s(o.why, 240) });
    if (out.length >= MAX_MESSAGES) break;
  }
  return out;
}

export function readProposal(v: unknown, i = 0): IdentityProposal | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const pal = Array.isArray(o.palette) ? o.palette.map(hexColor) : [];
  const c1 = pal[0] || "";
  if (!c1) return null;
  const c2 = pal[1] || c1;
  const c3 = pal[2] || c2;
  const slogan = readBi(o.slogan);
  const name = s(o.name, 60);
  if (!name && !slogan.es && !slogan.en) return null;
  return {
    id: s(o.id, 40) || `p${i + 1}`,
    name: name || `#${i + 1}`,
    palette: [c1, c2, c3],
    paletteWhy: s(o.paletteWhy, 300),
    fontHeading: asFontHeading(o.fontHeading) ?? "montserrat",
    fontBody: asFontBody(o.fontBody) ?? "open-sans",
    slogan,
    voice: s(o.voice, 400),
    music: s(o.music, 160),
    headline: s(o.headline, 90),
  };
}

export function emptyIdentity(): BrandIdentity {
  return {
    slogan: { es: "", en: "" },
    tagline: { es: "", en: "" },
    messages: [],
    voice: { summary: "", personality: [], do: [], dont: [], useWords: [], avoidWords: [] },
    audience: "",
    music: { moods: [], genres: [], bpmMin: null, bpmMax: null, energy: "", instruments: [], searchTerms: [] },
    photoStyle: "",
    proposals: [],
    chosenProposal: "",
    source: "",
    appliedAt: "",
    updatedAt: "",
  };
}

/** Lee lo guardado en la base de datos sin confiar en su forma (como readBrandAssets). */
export function readBrandIdentity(raw: unknown): BrandIdentity {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const voice = o.voice && typeof o.voice === "object" && !Array.isArray(o.voice) ? (o.voice as Record<string, unknown>) : {};
  const music = o.music && typeof o.music === "object" && !Array.isArray(o.music) ? (o.music as Record<string, unknown>) : {};
  const proposals: IdentityProposal[] = [];
  const ids = new Set<string>();
  for (const [i, p] of (Array.isArray(o.proposals) ? o.proposals : []).entries()) {
    const r = readProposal(p, i);
    if (!r || ids.has(r.id)) continue;
    ids.add(r.id);
    proposals.push(r);
    if (proposals.length >= MAX_PROPOSALS) break;
  }
  let min = bpm(music.bpmMin);
  let max = bpm(music.bpmMax);
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  const chosen = s(o.chosenProposal, 40);
  const source = o.source === "book" || o.source === "ai" || o.source === "manual" ? o.source : "";
  return {
    slogan: readBi(o.slogan, 120),
    tagline: readBi(o.tagline, 200),
    messages: readMessages(o.messages),
    voice: {
      summary: s(voice.summary, MAX_TEXT),
      personality: readList(voice.personality, 8, 40),
      do: readList(voice.do, MAX_LIST, MAX_LINE),
      dont: readList(voice.dont, MAX_LIST, MAX_LINE),
      useWords: readList(voice.useWords, 20, 60),
      avoidWords: readList(voice.avoidWords, 20, 80),
    },
    audience: s(o.audience, MAX_TEXT),
    music: {
      moods: readList(music.moods, 8, 40),
      genres: readList(music.genres, 8, 40),
      bpmMin: min,
      bpmMax: max,
      energy: (ENERGIES as readonly string[]).includes(music.energy as string) ? (music.energy as Energy) : "",
      instruments: readList(music.instruments, 10, 40),
      searchTerms: readList(music.searchTerms, 10, 60),
    },
    photoStyle: s(o.photoStyle, MAX_TEXT),
    proposals,
    chosenProposal: proposals.some((p) => p.id === chosen) ? chosen : "",
    source,
    appliedAt: typeof o.appliedAt === "string" ? o.appliedAt.slice(0, 40) : "",
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt.slice(0, 40) : "",
  };
}

/** Hay algo escrito en la identidad (sin contar las propuestas). */
export function hasIdentity(b: BrandIdentity): boolean {
  const v = b.voice;
  const m = b.music;
  return Boolean(
    b.slogan.es || b.slogan.en || b.tagline.es || b.tagline.en || b.messages.length || v.summary || v.personality.length || v.do.length || v.dont.length ||
      v.useWords.length || v.avoidWords.length || b.audience || m.moods.length || m.genres.length || m.bpmMin !== null || m.energy || m.instruments.length ||
      m.searchTerms.length || b.photoStyle,
  );
}

const emptyBi = (t: BiText) => !t.es && !t.en;

/**
 * «Completar con IA»: llena solo lo que está vacío. Lo que el dueño ya escribió (o eligió) no se toca.
 * Las propuestas, la elegida y el origen se quedan como estaban.
 */
export function fillEmpty(cur: BrandIdentity, add: BrandIdentity): BrandIdentity {
  const pick = <T,>(a: T[], b: T[]) => (a.length ? a : b);
  const bi = (a: BiText, b: BiText): BiText => (emptyBi(a) ? b : { es: a.es || b.es, en: a.en || b.en });
  return {
    ...cur,
    slogan: bi(cur.slogan, add.slogan),
    tagline: bi(cur.tagline, add.tagline),
    messages: cur.messages.length ? cur.messages : add.messages.slice(0, MAX_MESSAGES),
    voice: {
      summary: cur.voice.summary || add.voice.summary,
      personality: pick(cur.voice.personality, add.voice.personality),
      do: pick(cur.voice.do, add.voice.do),
      dont: pick(cur.voice.dont, add.voice.dont),
      useWords: pick(cur.voice.useWords, add.voice.useWords),
      avoidWords: pick(cur.voice.avoidWords, add.voice.avoidWords),
    },
    audience: cur.audience || add.audience,
    music: {
      moods: pick(cur.music.moods, add.music.moods),
      genres: pick(cur.music.genres, add.music.genres),
      bpmMin: cur.music.bpmMin ?? (cur.music.bpmMax === null ? add.music.bpmMin : null),
      bpmMax: cur.music.bpmMax ?? (cur.music.bpmMin === null ? add.music.bpmMax : null),
      energy: cur.music.energy || add.music.energy,
      instruments: pick(cur.music.instruments, add.music.instruments),
      searchTerms: pick(cur.music.searchTerms, add.music.searchTerms),
    },
    photoStyle: cur.photoStyle || add.photoStyle,
    source: cur.source || add.source,
  };
}

/**
 * Lo que trae el manual de marca manda: cada campo que el manual sí trae reemplaza al actual; lo que el manual no
 * trae se queda como estaba.
 */
export function mergeFromBook(cur: BrandIdentity, book: BrandIdentity): BrandIdentity {
  const merged = fillEmpty(book, cur);
  // El eslogan y la frase van completos (no mezclar el español del manual con un inglés viejo de otra frase).
  const whole = (b: BiText, c: BiText) => (emptyBi(b) ? c : b);
  return {
    ...merged,
    slogan: whole(book.slogan, cur.slogan),
    tagline: whole(book.tagline, cur.tagline),
    proposals: cur.proposals,
    chosenProposal: cur.chosenProposal,
    appliedAt: cur.appliedAt,
    source: "book",
  };
}

/** Los campos de la marca (los mismos que guarda el formulario de la marca) que cambia una propuesta. */
export type ProposalKit = { color: string; color2: string; color3: string; fontHeading: FontId; fontBody: string };

/**
 * «Usar esta»: los colores y letras van a la marca, y el eslogan, la voz y el ánimo de la música a la identidad.
 * El resto de la identidad (mensajes, sí / no, palabras, fotos) se queda.
 */
export function applyProposal(cur: BrandIdentity, p: IdentityProposal, now = new Date().toISOString()): { identity: BrandIdentity; kit: ProposalKit } {
  const moods = readList(p.music, 8, 40);
  return {
    kit: { color: p.palette[0], color2: p.palette[1], color3: p.palette[2], fontHeading: p.fontHeading, fontBody: BODY_FONTS[p.fontBody].name },
    identity: {
      ...cur,
      slogan: emptyBi(p.slogan) ? cur.slogan : p.slogan,
      voice: { ...cur.voice, summary: p.voice || cur.voice.summary },
      music: { ...cur.music, moods: moods.length ? moods : cur.music.moods },
      chosenProposal: p.id,
      source: cur.source === "book" ? "book" : "ai",
      appliedAt: now,
      updatedAt: now,
    },
  };
}

const FORBIDDEN = /\b(nunca|jam[aá]s|no\s+(?:decir|usar|mencionar|prometer|hablar|ofrecer|dar|garantizar|publicar)|prohibid[oa]s?|evitar|never|avoid|do\s+not|don'?t)\b/i;

/**
 * Lo que el perfil del negocio dice que nunca se dice o se promete (para empezar la lista «Nunca usar»).
 * Toma los renglones o frases que lo prohíben y, si tienen palabras entre comillas, solo esas palabras.
 */
export function seedNever(aiProfile: string): string[] {
  const parts = aiProfile
    .split(/\n+|(?<=[.!?])\s+/)
    .map((x) => x.replace(/^[\s\-•*·\d.)]+/, "").trim())
    .filter((x) => x && FORBIDDEN.test(x));
  const out: string[] = [];
  for (const p of parts) {
    const quoted = [...p.matchAll(/[“"«']([^”"»']{2,40})[”"»']/g)].map((m) => m[1].trim());
    out.push(...(quoted.length ? quoted : [p]));
  }
  return readList(out, 12, 120);
}

/**
 * Para empezar (solo si la identidad nunca se guardó): «Nunca usar» sale del perfil del negocio y «No hace» de lo
 * que el estudio dice que nunca se debe decir o prometer.
 */
export function withSeeds(cur: BrandIdentity, seeds: { aiProfile: string; avoid?: string[] }): BrandIdentity {
  if (cur.updatedAt) return cur;
  const never = cur.voice.avoidWords.length ? cur.voice.avoidWords : seedNever(seeds.aiProfile);
  const dont = cur.voice.dont.length ? cur.voice.dont : readList(seeds.avoid ?? [], MAX_LIST, MAX_LINE);
  return { ...cur, voice: { ...cur.voice, avoidWords: never, dont } };
}

/**
 * Lo que el dueño escribió en el formulario «Tu identidad» (listas: un renglón o una coma por elemento). Las
 * propuestas, la elegida y las fechas se quedan como estaban en `cur`.
 */
export function identityFromForm(get: (name: string) => string, cur: BrandIdentity, now = new Date().toISOString()): BrandIdentity {
  const messages: unknown[] = [];
  for (let i = 0; i < MAX_MESSAGES; i++) messages.push({ text: { es: get(`msg_es_${i}`), en: get(`msg_en_${i}`) }, why: get(`msg_why_${i}`) });
  const lines = (name: string) => get(name).split(/\n+/);
  const next = readBrandIdentity({
    slogan: { es: get("slogan_es"), en: get("slogan_en") },
    tagline: { es: get("tagline_es"), en: get("tagline_en") },
    messages,
    voice: {
      summary: get("voice_summary"),
      personality: get("personality"),
      do: lines("voice_do"),
      dont: lines("voice_dont"),
      useWords: get("use_words"),
      avoidWords: get("avoid_words"),
    },
    audience: get("audience"),
    music: {
      moods: get("music_moods"),
      genres: get("music_genres"),
      bpmMin: get("bpm_min"),
      bpmMax: get("bpm_max"),
      energy: get("energy"),
      instruments: get("instruments"),
      searchTerms: get("music_search"),
    },
    photoStyle: get("photo_style"),
  });
  return {
    ...next,
    proposals: cur.proposals,
    chosenProposal: cur.chosenProposal,
    appliedAt: cur.appliedAt,
    source: cur.source || (hasIdentity(next) ? "manual" : ""),
    updatedAt: now,
  };
}
