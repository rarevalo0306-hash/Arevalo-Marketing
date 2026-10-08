import { asLang, BiError, errorText, translator } from "@/lib/i18n";
import { UploadError } from "@/lib/upload";

/** Idioma que manda la página de subida (es por defecto). */
export const langOf = (body: { lang?: unknown }) => asLang(typeof body.lang === "string" ? body.lang : "");

/** El cuerpo JSON del pedido ({} si no es JSON). */
export async function readBody<B extends object>(req: Request): Promise<B & { lang?: unknown }> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b : ({} as B);
  } catch {
    return {} as B;
  }
}

/** Respuesta de error en palabras simples (los errores inesperados no muestran detalles técnicos). */
export function failure(e: unknown, lang: "es" | "en", where: string): Response {
  if (e instanceof UploadError) return Response.json({ ok: false, error: errorText(e, lang) }, { status: e.status });
  console.error(`[subir] ${where}:`, e instanceof Error ? e.message : e);
  const t = translator(lang);
  const error =
    e instanceof BiError
      ? errorText(e, lang)
      : t("Algo falló en el servidor. Espera un momento y vuelve a intentar.", "Something failed on the server. Wait a moment and try again.");
  return Response.json({ ok: false, error }, { status: 500 });
}
