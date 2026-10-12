// «Entrar con Google»: otra forma de entrar a Matya, además de la contraseña. Solo entran los correos de LOGIN_EMAILS
// (separados por coma), y solo de Gmail o Google Workspace. Da la misma sesión que la contraseña: quitar un correo de la
// lista no saca a quien ya entró; para eso hay que cambiar APP_PASSWORD (nunca APP_SECRET, que cifra las conexiones). Usa el mismo cliente de Google que las conexiones, con su propia dirección de regreso
// (/api/auth/google/callback), que debe estar en las "Authorized redirect URIs" del cliente en Google Cloud.
import { randomBytes } from "crypto";

export const GOOGLE_LOGIN_COOKIE = "am_glogin";
/** La cookie del intento solo viaja a estas rutas y dura 10 minutos. */
export const GOOGLE_LOGIN_PATH = "/api/auth/google";
export const GOOGLE_LOGIN_MAX_AGE = 10 * 60;
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Correos que pueden entrar con Google (en minúsculas). */
export function loginEmails(raw = process.env.LOGIN_EMAILS): string[] {
  return (raw ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

/** El botón aparece solo con el cliente de Google configurado y al menos un correo permitido. */
export const googleLoginEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && loginEmails().length);

export const appBase = () => (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
export const googleLoginRedirectUri = () => `${appBase()}${GOOGLE_LOGIN_PATH}/callback`;

/** Un intento nuevo: state contra quien falsifique la respuesta, nonce contra un id_token reutilizado. */
export function newLoginFlow(): { state: string; nonce: string; cookie: string } {
  const state = randomBytes(18).toString("base64url");
  const nonce = randomBytes(18).toString("base64url");
  return { state, nonce, cookie: `${state}.${nonce}` };
}

export function readLoginFlow(cookie: string | undefined): { state: string; nonce: string } | null {
  const [state, nonce, extra] = (cookie ?? "").split(".");
  return state && nonce && extra === undefined ? { state, nonce } : null;
}

export function googleLoginUrl(state: string, nonce: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: googleLoginRedirectUri(),
    response_type: "code",
    // Solo saber quién es: correo verificado. No pide permisos sobre la cuenta.
    scope: "openid email",
    state,
    nonce,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** Lo que dice el id_token. No se revisa la firma: llega directo de Google por https al cambiar el código. */
export function idTokenClaims(idToken: string): Record<string, unknown> | null {
  const part = idToken.split(".")[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return claims && typeof claims === "object" ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type LoginCheck = { ok: true; email: string } | { ok: false; reason: "token" | "notAllowed" };

/** Acepta solo un id_token de Google, para este cliente, vigente, de este intento y con un correo verificado y permitido. */
export function checkGoogleLogin(
  claims: Record<string, unknown> | null,
  opts: { clientId: string; nonce: string; nowSec: number; allowed: string[] },
): LoginCheck {
  if (!claims || !opts.clientId) return { ok: false, reason: "token" };
  const iss = claims.iss;
  if (iss !== "accounts.google.com" && iss !== "https://accounts.google.com") return { ok: false, reason: "token" };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.clientId)) return { ok: false, reason: "token" };
  if (typeof claims.exp !== "number" || claims.exp <= opts.nowSec) return { ok: false, reason: "token" };
  if (typeof claims.nonce !== "string" || claims.nonce !== opts.nonce) return { ok: false, reason: "token" };
  if (claims.email_verified !== true && claims.email_verified !== "true") return { ok: false, reason: "notAllowed" };
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  // Google solo responde por correos de Gmail o de Google Workspace (hd). Otro correo puesto en una cuenta de Google
  // pudo cambiar de dueño desde que se verificó.
  const googleOwned = /@(gmail|googlemail)\.com$/.test(email) || (typeof claims.hd === "string" && claims.hd.length > 0);
  if (!email || !googleOwned || !opts.allowed.includes(email)) return { ok: false, reason: "notAllowed" };
  return { ok: true, email };
}
