"use server";

// Estudio del negocio y perfil del negocio: leer la página web, la entrevista de la IA, generar,
// guardar, borrar (con copia para recuperarlo) y crear un negocio nuevo que se arma desde su web.
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { aiEnabled, interviewQuestions, profileFromWebsite, studyBusiness } from "@/lib/ai";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import {
  CustomerOption,
  EMPTY_INPUT,
  GOALS,
  IdealCustomer,
  type Interview,
  inputFromWebProfile,
  jsonSafe,
  readDeleted,
  readInput,
  readStudy,
  StudyInput,
} from "@/lib/study-shape";
import { ownerFields } from "@/lib/owner";
import { readWebsite } from "@/lib/study-web";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const HEX = /^#[0-9a-fA-F]{6}$/;

async function business(id: string) {
  const b = await db.business.findUnique({ where: { id } });
  if (!b) {
    const { t } = await getT();
    throw new Error(t("Negocio no encontrado", "Business not found"));
  }
  return b;
}

/** "ricardopa.com" → "https://ricardopa.com". Lo que no parece una dirección queda como está. */
function websiteUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(v) ? `https://${v}` : v;
}

function jsonList<T>(f: FormData, k: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, max: number): T[] {
  let raw: unknown = [];
  try {
    raw = JSON.parse(str(f, k) || "[]");
  } catch {}
  return (Array.isArray(raw) ? raw : [])
    .map((v) => schema.safeParse(v))
    .filter((r) => r.success)
    .map((r) => r.data as T)
    .slice(0, max);
}

function studyInputFrom(f: FormData): StudyInput {
  const goal = str(f, "goal");
  let answers: unknown = [];
  try {
    answers = JSON.parse(str(f, "answers") || "[]");
  } catch {}
  const list = (Array.isArray(answers) ? answers : [])
    .map((a) => ({ question: String(a?.question ?? "").slice(0, 300), answer: String(a?.answer ?? "").trim().slice(0, 1000) }))
    .filter((a) => a.question && a.answer)
    .slice(0, 10);
  const trimmed = <T extends { name: string; why: string }>(c: T) => ({ ...c, name: c.name.trim().slice(0, 120), why: c.why.trim().slice(0, 300) });
  const ideal = jsonList(f, "idealCustomers", IdealCustomer, 12)
    .map(trimmed)
    .filter((c) => c.name)
    .map((c, i) => ({ ...c, priority: i + 1 }));
  const options = jsonList(f, "customerOptions", CustomerOption, 12).map(trimmed).filter((c) => c.name);
  return StudyInput.parse({
    services: str(f, "services").slice(0, 2000),
    customers: (ideal.length ? ideal.map((c) => c.name).join(", ") : str(f, "customers")).slice(0, 1000),
    idealCustomers: ideal,
    customerOptions: options,
    zone: str(f, "zone").slice(0, 300),
    competitors: str(f, "competitors").slice(0, 600),
    different: str(f, "different").slice(0, 1000),
    goal: GOALS.some((g) => g[0] === goal) ? goal : "llamadas",
    lang: ["es", "en", "both"].includes(str(f, "lang")) ? str(f, "lang") : "es",
    answers: list,
  });
}

// ---------- Paso 1: la información de la página web ----------

export type PrefillResult =
  | { ok: true; input: StudyInput; pages: { url: string; title: string }[]; profile: string; profileSaved: boolean; siteError: string | null }
  | { ok: false; error: string };

/**
 * La IA lee la página web (inicio, servicios, nosotros, zonas, contacto) y el perfil guardado, y llena el paso 1:
 * qué vende, dónde trabaja, clientes ideales con prioridad, idioma y meta. Se guarda como borrador del estudio
 * para no preguntarlo otra vez; si el negocio no tenía perfil, también se guarda el perfil que armó la IA.
 */
export async function prefillStudy(businessId: string): Promise<PrefillResult> {
  const b = await business(businessId);
  const { lang, t } = await getT();
  if (!aiEnabled()) return { ok: false, error: t("Falta la clave de la IA en la configuración del servidor.", "The AI key is missing from the server settings.") };
  if (!b.website.trim() && !b.aiProfile.trim())
    return { ok: false, error: t("Primero pon la dirección de tu página web en Ajustes del negocio.", "First add your website address in Business settings.") };
  const site = b.website.trim() ? await readWebsite(b.website, { maxPages: 6, totalMs: 25_000 }) : { pages: [], lang: "", error: null };
  if (!site.pages.length && !b.aiProfile.trim())
    return {
      ok: false,
      error: t(
        `No se pudo abrir tu página web (${site.error ?? "sin respuesta"}). Revisa la dirección en Ajustes o llena los datos a mano.`,
        `Your website couldn't be opened (${site.error ?? "no response"}). Check the address in Settings or fill in the details by hand.`,
      ),
    };
  try {
    const p = await profileFromWebsite(b, site, lang);
    if (!p.found && !b.aiProfile.trim())
      return { ok: false, error: t("La IA no encontró información del negocio en tu página. Llena los datos a mano.", "The AI didn't find business information on your website. Fill in the details by hand.") };
    const prev = readInput(b.studyInput) ?? EMPTY_INPUT;
    const input = inputFromWebProfile(p, prev);
    const profile = p.profile.trim().slice(0, 4000);
    const profileSaved = !b.aiProfile.trim() && !!profile;
    await db.business.update({
      where: { id: businessId },
      data: { studyInput: jsonSafe(input), ...(profileSaved && { aiProfile: profile }) },
    });
    revalidatePath(`/b/${businessId}`, "layout");
    return { ok: true, input, pages: site.pages.map((pg) => ({ url: pg.url, title: pg.title })), profile, profileSaved, siteError: site.error };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

/** Guarda lo que el dueño lleva contestado (sin generar el estudio), para no perderlo. */
export async function saveStudyDraft(businessId: string, f: FormData): Promise<void> {
  await business(businessId);
  await db.business.update({ where: { id: businessId }, data: { studyInput: jsonSafe(studyInputFrom(f)) } });
}

// ---------- Paso 2: preguntas de la IA ----------

export type InterviewResult = { ok: true; interview: Interview } | { ok: false; error: string };

/** La IA lee lo básico y devuelve preguntas solo sobre lo que falta, a la medida del negocio. */
export async function studyInterview(businessId: string, f: FormData): Promise<InterviewResult> {
  const b = await business(businessId);
  const { lang, t } = await getT();
  if (!aiEnabled()) return { ok: false, error: t("Falta la clave de la IA en la configuración del servidor.", "The AI key is missing from the server settings.") };
  const input = studyInputFrom(f);
  if (!input.services && !b.aiProfile.trim() && !b.website) return { ok: false, error: t("Cuéntale a la IA qué vendes o qué servicios das.", "Tell the AI what you sell or which services you offer.") };
  // Lo contestado en el paso 1 queda guardado aunque la IA falle.
  await db.business.update({ where: { id: businessId }, data: { studyInput: jsonSafe(input) } });
  try {
    return { ok: true, interview: await interviewQuestions(b, input, lang) };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

// ---------- Paso 3: el estudio ----------

/** `ok` = el estudio quedó guardado. `warning` = se guardó, pero algo no salió del todo (la investigación). */
export type StudyResult = { ok: boolean; message: string; warning?: boolean } | null;

/** La IA estudia el negocio (y su mercado en internet) y guarda el estudio en el mismo paso. */
export async function generateStudy(businessId: string, _prev: StudyResult, f: FormData): Promise<StudyResult> {
  const b = await business(businessId);
  const { lang, t } = await getT();
  if (!aiEnabled()) return { ok: false, message: t("Falta la clave de la IA en la configuración del servidor.", "The AI key is missing from the server settings.") };
  const input = studyInputFrom(f);
  if (!input.services && !b.aiProfile.trim() && !b.website)
    return { ok: false, message: t("Cuéntale a la IA qué vende tu negocio (o pon tu sitio web en Ajustes).", "Tell the AI what your business sells (or add your website in Settings).") };
  // Se guardan las respuestas aunque la IA falle, para no tener que escribirlas otra vez.
  await db.business.update({ where: { id: businessId }, data: { studyInput: jsonSafe(input) } });
  let study;
  let researchError: string | null;
  try {
    ({ study, researchError } = await studyBusiness(b, input, { research: f.get("research") === "on", lang }));
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
  // Guardar es parte de generar: si falla, se intenta otra vez antes de decirle al dueño.
  const saved = jsonSafe(study);
  let saveError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Si el negocio todavía no tenía perfil, el que sugiere el estudio queda como perfil (se puede corregir abajo).
      const profile = !b.aiProfile.trim() && saved.suggestedProfile.trim() ? { aiProfile: saved.suggestedProfile.trim().slice(0, 4000) } : {};
      await db.business.update({ where: { id: businessId }, data: { study: saved, studyAt: new Date(), ...profile } });
      saveError = null;
      break;
    } catch (e) {
      saveError = e;
      console.error("No se pudo guardar el estudio:", e);
    }
  }
  if (saveError) {
    return {
      ok: false,
      message: t(
        "La IA terminó el estudio, pero no se pudo guardar. Intenta de nuevo en un momento.",
        "The AI finished the study, but it couldn't be saved. Please try again in a moment.",
      ),
    };
  }
  revalidatePath(`/b/${businessId}`, "layout");
  if (researchError) {
    return {
      ok: true,
      warning: true,
      message: t(
        `Tu estudio quedó listo y guardado. No se pudo investigar en internet (${researchError}), así que se hizo con lo que ya sabe la IA; puedes actualizarlo más tarde.`,
        `Your study is ready and saved. The online research failed (${researchError}), so it was built from what the AI already knows; you can update it later.`,
      ),
    };
  }
  return {
    ok: true,
    message: study.researched
      ? t(
          `Listo y guardado: la IA investigó tu mercado (${study.sources.length} fuentes) y armó tu estudio.`,
          `Done and saved: the AI researched your market (${study.sources.length} sources) and put together your study.`,
        )
      : t("Listo y guardado: la IA armó tu estudio.", "Done and saved: the AI put together your study."),
  };
}

/** Guarda el perfil (el sugerido por el estudio, revisado por el dueño) como lo que la IA sabe del negocio. */
export async function saveStudyProfile(businessId: string, f: FormData) {
  await business(businessId);
  await db.business.update({ where: { id: businessId }, data: { aiProfile: str(f, "aiProfile").slice(0, 4000) } });
  revalidatePath(`/b/${businessId}`, "layout");
}

/**
 * Borra el estudio y las respuestas, pero guarda una copia para poder recuperarlo si fue sin querer.
 * El perfil del negocio (Ajustes) no se toca.
 */
export async function deleteStudy(businessId: string) {
  const b = await business(businessId);
  const study = readStudy(b.study);
  await db.business.update({
    where: { id: businessId },
    data: {
      study: study
        ? jsonSafe({ deleted: { at: new Date().toISOString(), study: b.study, studyInput: b.studyInput ?? null, studyAt: b.studyAt?.toISOString() ?? null } })
        : Prisma.DbNull,
      studyInput: Prisma.DbNull,
      studyAt: null,
    },
  });
  revalidatePath(`/b/${businessId}`, "layout");
}

/** Recupera el último estudio borrado, con sus respuestas. */
export async function restoreStudy(businessId: string) {
  const b = await business(businessId);
  const d = readDeleted(b.study);
  if (!d) return;
  await db.business.update({
    where: { id: businessId },
    data: {
      study: (b.study as { deleted: { study: Prisma.InputJsonValue } }).deleted.study,
      studyInput: readInput(d.studyInput) ? (d.studyInput as Prisma.InputJsonValue) : Prisma.DbNull,
      studyAt: d.studyAt ? new Date(d.studyAt) : new Date(d.at || Date.now()),
    },
  });
  revalidatePath(`/b/${businessId}`, "layout");
}

// ---------- Negocio nuevo ----------

/** Crea el negocio y lleva al dueño al estudio, donde la IA lee su página web y arma el perfil. */
export async function createBusinessFromWeb(f: FormData) {
  const { t } = await getT();
  const name = str(f, "name");
  if (!name) throw new Error(t("Escribe el nombre del negocio", "Enter the business name"));
  const color = HEX.test(str(f, "color")) ? str(f, "color") : "#126BBC";
  const website = websiteUrl(str(f, "website")).slice(0, 300);
  const owner = ownerFields(f);
  if (owner.ownerEmail === null) throw new Error(t("El correo del dueño no es válido.", "The owner's email isn't valid."));
  const b = await db.business.create({ data: { name, color, website, ...owner, ownerEmail: owner.ownerEmail } });
  redirect(website ? `/b/${b.id}/estudio?leer=1` : `/b/${b.id}/estudio`);
}
