"use server";

// Identidad de la marca más allá de lo visual: la IA propone 3 direcciones (o la saca del manual de marca), el
// dueño escoge una (cambia colores y letras de la marca) y completa o corrige el eslogan, los mensajes, la voz,
// la música y el estilo de fotos. La forma guardada está en src/lib/brand-identity-shape.ts.
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { aiEnabled, ask, askGemini, type GeminiPart } from "@/lib/ai";
import { fromAiIdentity, fromAiProposals, type IdentityContext, identityPromptFor, IdentitySchema, proposalsPrompt, ProposalsSchema } from "@/lib/brand-identity";
import { applyProposal, type BrandIdentity, fillEmpty, hasIdentity, identityFromForm, mergeFromBook, readBrandIdentity, withSeeds } from "@/lib/brand-identity-shape";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { readStudy, studyContext } from "@/lib/study-shape";
import { readWebsite, siteDigest } from "@/lib/study-web";

export type IdentityResult = { ok: boolean; message: string; at?: number; visual?: boolean } | null;

type Biz = NonNullable<Awaited<ReturnType<typeof db.business.findUnique>>>;

async function load(id: string): Promise<Biz | null> {
  return db.business.findUnique({ where: { id } });
}

const MAX_BOOK_BYTES = 18 * 1024 * 1024;

/** Lo que la IA necesita saber del negocio. Sin perfil ni estudio, lee un poco de la página web. */
async function contextOf(b: Biz, identity: BrandIdentity): Promise<IdentityContext> {
  const study = studyContext(b.study);
  let site = "";
  if (!b.aiProfile.trim() && !study && b.website.trim()) {
    try {
      site = siteDigest(await readWebsite(b.website, { maxPages: 2, totalMs: 12_000 }), 6000);
    } catch {
      site = "";
    }
  }
  return {
    name: b.name,
    website: b.website,
    aiProfile: b.aiProfile,
    study,
    site,
    color: b.color,
    color2: b.color2,
    color3: b.color3,
    fontHeading: b.fontHeading,
    fontBody: b.fontBody,
    brandVoice: b.brandVoice,
    hashtags: b.hashtags,
    identity,
  };
}

/** Gemini si hay clave (también lee el PDF del manual); si no, la IA de textos que eligió el negocio. */
async function askAi<T extends z.ZodTypeAny>(b: Biz, schema: T, p: { system: string; user: string }, maxTokens: number): Promise<z.infer<T>> {
  if (process.env.GEMINI_API_KEY) return askGemini(schema, p.system, p.user, maxTokens);
  return ask(b.aiText, schema, p.system, p.user, maxTokens);
}

/** El manual de marca guardado, igual que lo lee brandFromBook (PDF o imagen, máximo 18 MB). */
async function bookFile(url: string, t: (es: string, en: string) => string): Promise<GeminiPart> {
  if (!/^https:\/\//.test(url)) throw new Error(t("El manual no está guardado en internet, así que la IA no lo puede abrir.", "The brand book isn't stored online, so the AI can't open it."));
  const res = await fetch(url);
  if (!res.ok) throw new Error(t(`No se pudo leer el manual (${res.status}).`, `Couldn't read the brand book (${res.status}).`));
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_BOOK_BYTES) throw new Error(t("El manual es muy grande para que la IA lo lea (máximo 18 MB).", "The brand book is too large for the AI to read (18 MB max)."));
  const mimeType = (res.headers.get("content-type") || "").split(";")[0].trim() || (/\.pdf($|\?)/i.test(url) ? "application/pdf" : "image/png");
  return { inlineData: { mimeType, data: data.toString("base64") } };
}

async function store(businessId: string, identity: BrandIdentity) {
  await db.business.update({ where: { id: businessId }, data: { brandIdentity: identity } });
  revalidatePath(`/b/${businessId}/marca`);
}

const noKey = (t: (es: string, en: string) => string) =>
  t("La IA no está disponible: falta su clave en la configuración del servidor. Puedes escribir tu identidad a mano.", "The AI isn't available: its key is missing from the server settings. You can write your identity by hand.");

/** El error de la IA en palabras simples (y qué hacer). */
function aiFailed(e: unknown, lang: "es" | "en", t: (es: string, en: string) => string): string {
  return t(`La IA no pudo hacerlo: ${errorText(e, lang)} Lo que ya tenías no cambió.`, `The AI couldn't do it: ${errorText(e, lang)} What you had didn't change.`);
}

/**
 * «Proponer identidades»: con manual de marca (y `mode` "auto"), la IA saca de ahí el eslogan, los mensajes, la voz
 * y la música; sin manual (o con `mode` "ai"), propone 3 direcciones distintas para escoger.
 */
export async function proposeIdentities(businessId: string, _prev: IdentityResult, f: FormData): Promise<IdentityResult> {
  const { lang, t } = await getT();
  const b = await load(businessId);
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  if (!aiEnabled()) return { ok: false, message: noKey(t) };
  const cur = withSeeds(readBrandIdentity(b.brandIdentity), { aiProfile: b.aiProfile, avoid: readStudy(b.study)?.avoid });
  const fromBook = f.get("mode") !== "ai" && Boolean(b.brandBookUrl);
  try {
    if (fromBook) {
      if (!process.env.GEMINI_API_KEY) return { ok: false, message: t("Para leer el manual de marca hace falta la clave de Gemini (GEMINI_API_KEY).", "Reading the brand book needs the Gemini key (GEMINI_API_KEY).") };
      const p = identityPromptFor(await contextOf(b, cur), lang, "book");
      const a = await askGemini(IdentitySchema, p.system, p.user, 6000, [await bookFile(b.brandBookUrl, t)]);
      const book = fromAiIdentity(a, "book");
      if (!hasIdentity(book)) return { ok: false, message: t("La IA no encontró eslogan, mensajes, voz ni música en tu manual. Prueba las 3 propuestas de la IA.", "The AI found no slogan, messages, voice or music in your brand book. Try the AI's 3 proposals.") };
      await store(businessId, { ...mergeFromBook(cur, book), updatedAt: new Date().toISOString() });
      return { ok: true, at: Date.now(), message: t(`Listo: tu identidad salió del manual. ${a.summary}`.trim(), `Done: your identity came from the brand book. ${a.summary}`.trim()) };
    }
    const a = await askAi(b, ProposalsSchema, proposalsPrompt(await contextOf(b, cur), lang), 5000);
    const proposals = fromAiProposals(a);
    if (!proposals.length) return { ok: false, message: t("La IA no devolvió propuestas válidas. Intenta de nuevo.", "The AI didn't send back valid proposals. Please try again.") };
    // Las propuestas nuevas reemplazan a las anteriores; la identidad que ya tenías no cambia hasta que escojas una.
    await store(businessId, { ...cur, proposals, chosenProposal: "", updatedAt: cur.updatedAt });
    return { ok: true, at: Date.now(), message: t(`Listo: ${proposals.length} propuestas. ${a.summary}`.trim(), `Done: ${proposals.length} proposals. ${a.summary}`.trim()) };
  } catch (e) {
    return { ok: false, message: aiFailed(e, lang, t) };
  }
}

/**
 * «Usar esta»: los colores y letras de la propuesta pasan a la marca (los mismos campos que «Guardar la marca»), y su
 * eslogan, voz y música a la identidad. El navegador avisa después (emitBrandSaved) para que el kit y las plantillas
 * se vuelvan a crear con la marca nueva.
 */
export async function chooseIdentity(businessId: string, _prev: IdentityResult, f: FormData): Promise<IdentityResult> {
  const { t } = await getT();
  const b = await load(businessId);
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const cur = readBrandIdentity(b.brandIdentity);
  const p = cur.proposals.find((x) => x.id === String(f.get("proposal") ?? ""));
  if (!p) return { ok: false, message: t("Esa propuesta ya no está. Vuelve a cargar la página.", "That proposal is gone. Reload the page.") };
  const { identity, kit } = applyProposal(withSeeds(cur, { aiProfile: b.aiProfile, avoid: readStudy(b.study)?.avoid }), p);
  await db.business.update({
    where: { id: businessId },
    data: {
      ...kit,
      // La voz de la marca (la que siguen todos los textos) solo se llena si estaba vacía.
      ...(b.brandVoice.trim() ? {} : { brandVoice: p.voice.slice(0, 2000) }),
      brandIdentity: identity,
    },
  });
  revalidatePath(`/b/${businessId}`, "layout");
  return {
    ok: true,
    at: Date.now(),
    visual: true,
    message: t(`Listo: tu marca ahora usa «${p.name}». Estamos creando tu kit y las plantillas con los colores nuevos.`, `Done: your brand now uses “${p.name}”. We're creating your kit and templates with the new colors.`),
  };
}

/**
 * Guarda lo que el dueño escribió. Con `intent` "complete" («Completar con IA»), después la IA llena solo lo que
 * quedó vacío (lo escrito no se toca).
 */
export async function saveIdentity(businessId: string, _prev: IdentityResult, f: FormData): Promise<IdentityResult> {
  const { lang, t } = await getT();
  const b = await load(businessId);
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const get = (k: string) => String(f.get(k) ?? "");
  const mine = identityFromForm(get, readBrandIdentity(b.brandIdentity));
  await store(businessId, mine);
  if (f.get("intent") !== "complete") return { ok: true, at: Date.now(), message: t("Guardado. La IA ya escribe con esta identidad.", "Saved. The AI now writes with this identity.") };
  if (!aiEnabled()) return { ok: false, at: Date.now(), message: `${t("Guardamos lo que escribiste.", "We saved what you wrote.")} ${noKey(t)}` };
  try {
    const a = await askAi(b, IdentitySchema, identityPromptFor(await contextOf(b, mine), lang, "fill"), 6000);
    const filled = fillEmpty(mine, fromAiIdentity(a, "ai"));
    await store(businessId, { ...filled, updatedAt: new Date().toISOString() });
    return { ok: true, at: Date.now(), message: t("Listo: la IA llenó lo que faltaba. Revísalo y cambia lo que quieras.", "Done: the AI filled in what was missing. Review it and change anything you like.") };
  } catch (e) {
    return { ok: false, at: Date.now(), message: `${t("Guardamos lo que escribiste.", "We saved what you wrote.")} ${aiFailed(e, lang, t)}` };
  }
}
