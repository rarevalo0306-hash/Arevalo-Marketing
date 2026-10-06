"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { saveReport } from "@/lib/seo/reports";
import { checkVisibility, cleanQuestions, PROVIDER_SHORT, providerErrors, suggestQuestions, visibilityProviders } from "@/lib/seo/visibility";

export type VisibilityRunResult = { ok: boolean; message: string } | null;
export type SuggestQuestionsResult = { ok: true; questions: string[] } | { ok: false; error: string };

const BUSINESS_FIELDS = { id: true, name: true, website: true, aiProfile: true, aiText: true, study: true, studyInput: true } as const;

async function findBusiness(id: string) {
  return db.business.findUnique({ where: { id }, select: BUSINESS_FIELDS });
}

/** La IA propone 3 a 5 preguntas de clientes para probar si las IAs recomiendan al negocio. */
export async function suggestVisibilityQuestions(businessId: string): Promise<SuggestQuestionsResult> {
  const { lang, t } = await getT();
  const b = await findBusiness(businessId);
  if (!b) return { ok: false, error: t("Negocio no encontrado.", "Business not found.") };
  if (!visibilityProviders().length)
    return { ok: false, error: t("Falta la clave de la IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en el servidor.", "The AI key (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY) is missing on the server.") };
  try {
    return { ok: true, questions: await suggestQuestions(b, lang) };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

/** Hace las preguntas a ChatGPT, Gemini y Claude (con búsqueda en internet), guarda el reporte y dice cómo salió. */
export async function runVisibility(businessId: string, _prev: VisibilityRunResult, f: FormData): Promise<VisibilityRunResult> {
  const { lang, t } = await getT();
  const b = await findBusiness(businessId);
  if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  if (!visibilityProviders().length)
    return {
      ok: false,
      message: t(
        "Para revisar si las IAs te recomiendan hace falta la clave de al menos una IA con búsqueda en internet (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en la configuración del servidor.",
        "To check whether AIs recommend you, the server needs the key of at least one AI with web search (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY).",
      ),
    };
  const questions = cleanQuestions(f.getAll("question"));
  if (!questions.length) return { ok: false, message: t("Escribe al menos una pregunta.", "Write at least one question.") };
  try {
    const report = await checkVisibility(b, questions, lang);
    await saveReport(businessId, "ai", report);
    revalidatePath(`/b/${businessId}/seo`);
    const failed = report.results.filter((r) => r.error).length;
    const ok = report.results.length - failed;
    const mentioned = report.results.filter((r) => r.mentioned).length;
    // Por qué falló cada IA, en palabras simples (por ejemplo, Gemini llegó a su límite gratis por minuto).
    const warn = failed
      ? providerErrors(report.results)
          .map((w) =>
            w.failed === w.total
              ? t(` ${PROVIDER_SHORT[w.provider]} no se pudo revisar: ${w.reason.es}`, ` ${PROVIDER_SHORT[w.provider]} couldn't be checked: ${w.reason.en}`)
              : t(` ${PROVIDER_SHORT[w.provider]} no contestó ${w.failed} de ${w.total}: ${w.reason.es}`, ` ${PROVIDER_SHORT[w.provider]} didn't answer ${w.failed} of ${w.total}: ${w.reason.en}`),
          )
          .join("")
      : "";
    return {
      ok: true,
      message:
        t(
          `Listo: apareces en ${mentioned} de ${ok} respuestas (${report.score ?? 0}%).`,
          `Done: you show up in ${mentioned} of ${ok} answers (${report.score ?? 0}%).`,
        ) + warn,
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
