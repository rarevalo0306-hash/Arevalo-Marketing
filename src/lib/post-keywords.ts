// Palabras clave en cada publicación: cuáles de las palabras del negocio van con este post, el texto alternativo
// de la foto, el nombre del archivo, los hashtags de cada red y el consejo para Google (la palabra y la ciudad en la
// primera frase). Sin servidor ni base de datos: se usa en pantalla, al publicar y en tests/post-keywords.test.ts.

/** Sin acentos, en minúsculas y con espacios simples (para comparar). */
export function plain(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").trim();
}

const STOP = new Set(
  "de del la las el los en y o a al con para por sin un una unos unas que se su sus tu tus mi mis es son the of and or for in on with to at your our from near best cerca mejor".split(" "),
);
/** Palabras que cuentan (3+ letras, sin las de relleno). */
const words = (s: string) => plain(s).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
/** Raíz corta para que «portón», «portones» y «porton» coincidan. */
const stem = (w: string) => (w.length > 5 ? w.slice(0, 5) : w.replace(/(es|s)$/, ""));

/** Une las palabras del negocio (las que sigue y las del estudio) sin repetir, las que sigue primero. */
export function mergeKeywords(...lists: (readonly string[] | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists)
    for (const k of list ?? []) {
      const t = k.replace(/\s+/g, " ").trim();
      const key = plain(t);
      if (t && key && !seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
    }
  return out;
}

/**
 * De 1 a `max` palabras clave del negocio que van con esta publicación: las que más se parecen al texto (frase
 * completa > palabras sueltas); a igualdad, la que el negocio sigue primero. Si ninguna coincide, la primera (la
 * más importante del negocio), para que el post igual sume al SEO.
 */
export function pickPostKeywords(text: string, keywords: readonly string[], max = 3): string[] {
  const list = mergeKeywords(keywords);
  if (!list.length) return [];
  const body = ` ${plain(text)} `;
  const bodyStems = new Set(words(text).map(stem));
  const scored = list.map((k, i) => {
    const ws = words(k);
    const hits = ws.filter((w) => bodyStems.has(stem(w))).length;
    const phrase = plain(k) && body.includes(` ${plain(k)} `) ? 2 : 0;
    const score = ws.length ? hits / ws.length + phrase + (hits === ws.length ? 1 : 0) : 0;
    return { k, i, score, hits, phrase };
  });
  // Que coincida la frase o casi todas sus palabras (2 de 3 no basta: «mantenimiento de cortinas» ≠ «cortinas»).
  const good = scored.filter((s) => s.hits > 0 && (s.phrase > 0 || s.hits / Math.max(1, words(s.k).length) >= 0.75)).sort((a, b) => b.score - a.score || a.i - b.i);
  const picked = good.slice(0, Math.max(1, max)).map((s) => s.k);
  return picked.length ? picked : [list[0]];
}

// ---------- Texto alternativo ----------

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Texto alternativo sin IA: «<lo que se ve> — <palabra clave> en <ciudad>». No repite la palabra si ya está en lo
 * que se ve, ni la ciudad si ya está. Máximo 200 caracteres.
 */
export function altTextFallback(what: string, keyword: string, city: string, lang: "es" | "en" = "es"): string {
  const w = what.replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
  const k = keyword.trim();
  const c = city.trim();
  const has = (s: string, part: string) => !!part && ` ${plain(s)} `.includes(` ${plain(part)} `);
  const inWord = lang === "en" ? "in" : "en";
  let tail = "";
  if (k && !has(w, k)) tail = c && !has(w, c) && !has(k, c) ? `${k} ${inWord} ${c}` : k;
  else if (c && !has(w, c)) tail = c;
  const out = w ? (tail ? `${cap(w)} — ${tail}` : cap(w)) : cap(tail);
  return out.slice(0, 200).trim();
}

/** Lo que se ve, en una frase corta, a partir del texto del post (cuando no hay descripción de la foto). */
export function whatFromText(text: string, max = 90): string {
  const clean = text.replace(/https?:\/\/\S+/g, "").replace(/#[\p{L}\p{N}_]+/gu, "").replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, "").replace(/\s+/g, " ").trim();
  const first = clean.split(/(?<=[.!?])\s|\n/)[0] ?? "";
  const cut = first.length > max ? first.slice(0, max).replace(/\s+\S*$/, "") : first;
  return cut.replace(/[.!?¡¿:;,\s]+$/, "").replace(/^[¡¿\s]+/, "");
}

// ---------- Nombre del archivo ----------

/** «Portones enrollables» + «Managua» → "portones-enrollables-managua" (sin acentos, máximo 60 letras). */
export function seoSlug(...parts: (string | undefined)[]): string {
  const seen = new Set<string>();
  const ws: string[] = [];
  for (const p of parts)
    for (const w of plain(p ?? "").replace(/ñ/g, "n").split(" "))
      if (w && !seen.has(w)) {
        seen.add(w);
        ws.push(w);
      }
  let out = "";
  for (const w of ws) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > 60) break;
    out = next;
  }
  return out;
}

// ---------- Hashtags ----------

/** Cuántos hashtags conviene poner en cada red (Google: ninguno, no sirven). */
export const HASHTAG_MAX: Record<string, number> = { instagram: 5, tiktok: 5, linkedin: 3, facebook: 3, x: 2, google: 0 };

/** «portones enrollables» → "#portonesenrollables". */
export function toHashtag(s: string): string {
  const body = plain(s).replace(/ñ/g, "n").replace(/\s+/g, "");
  return body.length >= 2 && body.length <= 40 ? `#${body}` : "";
}

const TAG_RE = /(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]{1,80})/gu;
/** Hashtags que ya están en el texto (en minúsculas y sin acentos, para comparar). */
export function tagsIn(text: string): string[] {
  return [...text.matchAll(TAG_RE)].map((m) => `#${plain(m[2]).replace(/\s+/g, "")}`);
}

/**
 * Hashtags para una red a partir de las palabras clave del post y la ciudad: sin repetir los que ya están en el
 * texto y sin pasar el máximo de la red (contando los que ya trae el texto).
 */
export function hashtagsFor(channel: string, keywords: readonly string[], city: string, text = ""): string[] {
  const max = HASHTAG_MAX[channel];
  if (!max) return [];
  const have = new Set(tagsIn(text));
  const room = Math.max(0, max - have.size);
  const out: string[] = [];
  const cityTag = toHashtag(city);
  // Hashtags cortos: sin la ciudad (va aparte) ni palabras de relleno, como mucho 3 palabras.
  const short = (k: string) => {
    const cityWords = new Set(plain(city).split(" ").filter(Boolean));
    const ws = plain(k).split(" ").filter((w) => w && !cityWords.has(w) && !STOP.has(w));
    return ws.length && ws.length <= 3 ? toHashtag(ws.join(" ")) : "";
  };
  // La primera palabra clave, la ciudad, y luego las demás palabras.
  const order = [short(keywords[0] ?? ""), cityTag, ...keywords.slice(1).map(short)];
  for (const tag of order) if (tag && !have.has(tag) && !out.includes(tag)) out.push(tag);
  return out.slice(0, room);
}

/** El texto con los hashtags al final (solo los que no estén ya). */
export function withHashtags(text: string, tags: readonly string[]): string {
  const have = new Set(tagsIn(text));
  const add = tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).filter((t) => t.length > 1 && !have.has(`#${plain(t.slice(1)).replace(/\s+/g, "")}`));
  if (!add.length) return text;
  const base = text.replace(/\s+$/, "");
  return base ? `${base}\n\n${add.join(" ")}` : add.join(" ");
}

/** Lo que escribe el dueño en «+ hashtag»: "#Portones Managua" → "#portonesmanagua". "" si no sirve. */
export function cleanHashtag(raw: string): string {
  return toHashtag(raw.replace(/^#+/, ""));
}

// ---------- Google (Perfil de Negocio) ----------

/** La primera frase del texto. */
export function firstSentence(text: string): string {
  const t = text.trim();
  const m = /^[\s\S]*?(?:[.!?](?=\s|$)|\n)/.exec(t);
  return (m ? m[0] : t).trim();
}

export type GbpHint = { missing: "keyword" | "city" | "both"; keyword: string; city: string; lead: string };

/**
 * Consejo para Google: la palabra clave principal y la ciudad deben estar en la primera frase (Google la usa para
 * entender de qué trata). null si ya están (o si no hay palabra clave). `lead` es una frase que se puede poner al
 * principio con un toque; nunca se cambia el texto sin que el dueño lo pida.
 */
export function gbpKeywordHint(text: string, keyword: string, city: string, lang: "es" | "en" = "es"): GbpHint | null {
  const k = keyword.trim();
  if (!k || !text.trim()) return null;
  const first = ` ${plain(firstSentence(text))} `;
  const firstStems = new Set(words(first).map(stem));
  const kw = words(k);
  const hasK = kw.length > 0 && kw.every((w) => firstStems.has(stem(w)));
  const c = city.trim();
  const hasC = !c || first.includes(` ${plain(c)} `) || ` ${plain(k)} `.includes(` ${plain(c)} `);
  if (hasK && hasC) return null;
  const missing = !hasK && !hasC ? "both" : !hasK ? "keyword" : "city";
  const inWord = lang === "en" ? "in" : "en";
  const lead = c && !` ${plain(k)} `.includes(` ${plain(c)} `) ? `${cap(k)} ${inWord} ${c}.` : `${cap(k)}.`;
  return { missing, keyword: k, city: c, lead };
}

/** Pone la frase con la palabra clave y la ciudad al principio del texto (si el dueño toca «Agregar»). */
export function applyGbpLead(text: string, hint: GbpHint): string {
  return `${hint.lead} ${text.trim()}`.trim();
}
