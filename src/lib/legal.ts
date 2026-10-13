// Páginas legales de Matya (en matya.app) y las de Google y YouTube que se enlazan al conectar sus cuentas.
import type { UiLang } from "@/lib/i18n";

export type LegalPage = "privacidad" | "condiciones" | "borrado-de-datos";

/** Una página legal de matya.app en el idioma de la app (la versión en inglés va bajo /en/). */
export const legalUrl = (page: LegalPage, lang: UiLang) => `https://matya.app/${lang === "en" ? "en/" : ""}${page}/`;

export const YOUTUBE_TERMS_URL = "https://www.youtube.com/t/terms";
export const GOOGLE_PRIVACY_URL = "https://policies.google.com/privacy";
/** Donde la persona le quita a Matya el permiso a su cuenta de Google. */
export const GOOGLE_PERMISSIONS_URL = "https://myaccount.google.com/permissions";
