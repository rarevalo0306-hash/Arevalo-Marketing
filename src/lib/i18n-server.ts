import { cookies } from "next/headers";
import { asLang, LANG_COOKIE, translator, type UiLang } from "@/lib/i18n";

/** Idioma de la app guardado en este navegador (por defecto español). */
export async function uiLang(): Promise<UiLang> {
  try {
    return asLang((await cookies()).get(LANG_COOKIE)?.value);
  } catch {
    // Fuera de una visita (por ejemplo, el publicador automático) no hay cookies.
    return "es";
  }
}

/** Idioma y traductor para páginas y acciones del servidor. */
export async function getT() {
  const lang = await uiLang();
  return { lang, t: translator(lang) };
}
