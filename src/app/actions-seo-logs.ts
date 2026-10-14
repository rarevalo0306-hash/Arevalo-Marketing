"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { deniedText, hasBusiness } from "@/lib/auth";
import { ensure } from "@/lib/ensure";
import { getT } from "@/lib/i18n-server";
import { readLogReport } from "@/lib/seo/logs";
import { saveReport } from "@/lib/seo/reports";

export type LogsResult = { ok: boolean; message: string };

/** El resumen nunca pasa de esto (las listas tienen tope); más grande = no es un resumen. */
const MAX_JSON = 300_000;

/**
 * Guarda el resumen del registro de visitas que armó el navegador (el archivo no se sube: solo los conteos, sin IPs).
 * Se vuelve a revisar todo en el servidor (readLogReport) porque viene del navegador.
 */
export async function saveLogReport(businessId: string, json: string): Promise<LogsResult> {
  ensure.text(businessId, json);
  const { t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  if (json.length > MAX_JSON) return { ok: false, message: t("El resumen es demasiado grande.", "The summary is too large.") };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, message: t("No se pudo leer el resumen.", "Couldn't read the summary.") };
  }
  const report = readLogReport(data);
  if (!report) return { ok: false, message: t("No se pudo leer el resumen.", "Couldn't read the summary.") };
  if (!report.parsed)
    return {
      ok: false,
      message: t(
        "No reconocimos ninguna visita en ese archivo. Tiene que ser el registro de visitas del servidor (access log), no el de errores.",
        "We didn't recognize any visit in that file. It must be the server's access log, not the error log.",
      ),
    };
  await saveReport(businessId, "logs", report as unknown as Prisma.InputJsonValue);
  revalidatePath(`/b/${businessId}/seo`);
  const google = report.bots.find((b) => b.id === "google")?.hits ?? 0;
  const ai = report.bots.filter((b) => ["chatgpt", "gptbot", "claude", "claudebot", "perplexity", "gemini", "meta", "bytespider", "amazon", "ccbot"].includes(b.id)).reduce((s, b) => s + b.hits, 0);
  return {
    ok: true,
    message: t(
      `Listo: leímos ${report.parsed.toLocaleString("es")} visitas. Google entró ${google.toLocaleString("es")} veces y las IAs ${ai.toLocaleString("es")}.`,
      `Done: we read ${report.parsed.toLocaleString("en-US")} visits. Google came in ${google.toLocaleString("en-US")} times and AIs ${ai.toLocaleString("en-US")}.`,
    ),
  };
}
