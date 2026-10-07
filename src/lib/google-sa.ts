import { createSign } from "crypto";
import { bi } from "@/lib/i18n";

// Cuenta de servicio de Google de la app (sin que el dueño inicie sesión): el dueño comparte su carpeta de Drive con el
// correo de esta cuenta como Lector y la app la lee. La llave llega completa en GOOGLE_SERVICE_ACCOUNT_JSON.

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
};

/** Lee la llave JSON (también acepta el JSON en base64 o con los saltos de línea escapados dos veces). */
export function readServiceAccount(raw: string | undefined = process.env.GOOGLE_SERVICE_ACCOUNT_JSON): ServiceAccount | null {
  let text = (raw ?? "").trim();
  if (!text) return null;
  if (!text.startsWith("{")) {
    try {
      text = Buffer.from(text, "base64").toString("utf8").trim();
    } catch {
      return null;
    }
  }
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const email = typeof o.client_email === "string" ? o.client_email.trim() : "";
    const key = typeof o.private_key === "string" ? o.private_key.replace(/\\n/g, "\n") : "";
    if (!email || !key.includes("PRIVATE KEY")) return null;
    return {
      client_email: email,
      private_key: key,
      project_id: typeof o.project_id === "string" ? o.project_id : undefined,
      token_uri: typeof o.token_uri === "string" && o.token_uri.startsWith("https://") ? o.token_uri : undefined,
    };
  } catch {
    return null;
  }
}

/** ¿Está la cuenta de servicio configurada en el servidor? */
export const serviceAccountEnabled = () => readServiceAccount() !== null;

/** El correo con el que el dueño comparte la carpeta ("" si falta configurarla). */
export const serviceAccountEmail = () => readServiceAccount()?.client_email ?? "";

const b64url = (v: Buffer | string) => Buffer.from(v).toString("base64url");

/** El JWT firmado (RS256) que se cambia por un permiso de acceso. `now` en segundos (para las pruebas). */
export function buildJwt(sa: ServiceAccount, scope: string, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope,
      aud: sa.token_uri ?? TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const input = `${header}.${claims}`;
  let signature: Buffer;
  try {
    signature = createSign("RSA-SHA256").update(input).end().sign(sa.private_key);
  } catch {
    throw bi(
      "La llave de la cuenta de servicio (GOOGLE_SERVICE_ACCOUNT_JSON) no es válida. Vuelve a pegar el archivo JSON completo.",
      "The service account key (GOOGLE_SERVICE_ACCOUNT_JSON) isn't valid. Paste the whole JSON file again.",
    );
  }
  return `${input}.${b64url(signature)}`;
}

export const notConfigured = () =>
  bi(
    "Falta configurar la cuenta de servicio de Google en el servidor (GOOGLE_SERVICE_ACCOUNT_JSON).",
    "The Google service account isn't set up on the server yet (GOOGLE_SERVICE_ACCOUNT_JSON).",
  );

const cache = new Map<string, { token: string; exp: number }>();

/** Para las pruebas. */
export const clearTokenCache = () => cache.clear();

/** Permiso de acceso de la cuenta de servicio (se guarda hasta un minuto antes de vencer). */
export async function getAccessToken(scope = DRIVE_SCOPE): Promise<string> {
  const sa = readServiceAccount();
  if (!sa) throw notConfigured();
  const key = `${sa.client_email} ${scope}`;
  const hit = cache.get(key);
  if (hit && hit.exp - 60_000 > Date.now()) return hit.token;
  const res = await fetch(sa.token_uri ?? TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildJwt(sa, scope),
    }).toString(),
  });
  const body = await res.text();
  if (!res.ok) {
    if (body.includes("invalid_grant") || body.includes("invalid_client") || res.status === 401) {
      throw bi(
        "Google rechazó la llave de la cuenta de servicio. Puede que la hayan borrado en Google Cloud: crea una llave JSON nueva y pégala en GOOGLE_SERVICE_ACCOUNT_JSON.",
        "Google rejected the service account key. It may have been deleted in Google Cloud: create a new JSON key and paste it into GOOGLE_SERVICE_ACCOUNT_JSON.",
      );
    }
    throw bi(
      `Google no dio acceso a la cuenta de servicio (${res.status}). Intenta de nuevo más tarde.`,
      `Google didn't grant the service account access (${res.status}). Try again later.`,
    );
  }
  const data = JSON.parse(body) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) throw bi("Google no devolvió el permiso de acceso.", "Google didn't return an access token.");
  cache.set(key, {
    token: data.access_token,
    exp: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}
