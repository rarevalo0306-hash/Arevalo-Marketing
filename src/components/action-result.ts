// Lo que comparten las pantallas con formularios que llaman acciones del servidor (Equipo y Organizaciones).
import { unstable_rethrow } from "next/navigation";
import type { T } from "@/lib/i18n";

/**
 * Si la acción falló sin respuesta (sin conexión, ya no es Administrador…): un mensaje en vez de la pantalla de error.
 * Un redirect de Next (sesión vencida, o se quitó el acceso a sí mismo) se deja pasar para que la app vaya a /login.
 * Sirve como TeamResult y como OrgResult: ambos aceptan { ok: false, message }.
 */
export function failed(e: unknown, t: T): { ok: false; message: string } {
  unstable_rethrow(e);
  return {
    ok: false,
    message: t("No se pudo hacer. Revisa tu conexión, recarga la página y vuelve a intentarlo.", "Couldn't do it. Check your connection, reload the page and try again."),
  };
}

/** El foco se perdió (el botón se desactivó mientras esperaba, o su fila ya no está): hay que devolverlo. */
export const focusLost = () => !document.activeElement || document.activeElement === document.body;
