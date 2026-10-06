// Idioma de la app (pantallas y mensajes): español o inglés. Lo que escribe la IA para las redes se elige aparte.
// Cada texto se escribe en los dos idiomas donde se usa: t("Guardar", "Save").

export type UiLang = "es" | "en";
export const LANG_COOKIE = "am-lang";

export const asLang = (v: string | null | undefined): UiLang => (v === "en" ? "en" : "es");

export type T = (es: string, en: string) => string;
export const translator = (lang: UiLang): T => (es, en) => (lang === "en" ? en : es);

/** Para fechas y números (Intl). */
export const intlLocale = (lang: UiLang) => (lang === "en" ? "en-US" : "es");

/** Error con el mensaje en los dos idiomas: las acciones muestran el del idioma de la app. */
export class BiError extends Error {
  constructor(
    message: string,
    readonly en: string,
  ) {
    super(message);
  }
}
export const bi = (es: string, en: string) => new BiError(es, en);

/** El mensaje de un error en el idioma de la app. */
export const errorText = (e: unknown, lang: UiLang): string =>
  e instanceof BiError && lang === "en" ? e.en : e instanceof Error ? e.message : String(e);
