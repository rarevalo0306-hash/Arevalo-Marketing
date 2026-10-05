// Brevo con una sola clave para toda la app (BREVO_API_KEY): cada negocio solo elige su remitente.
import { fetchJson } from "@/lib/publishers/http";

export const brevoEnvKey = () => process.env.BREVO_API_KEY?.trim() || "";

/** Dominios autenticados en Brevo: desde ellos se puede enviar con cualquier dirección. */
export async function brevoDomains(apiKey = brevoEnvKey()): Promise<string[]> {
  if (!apiKey) return [];
  try {
    const d = await fetchJson<{ domains?: { domain_name: string; authenticated: boolean }[] }>(
      "https://api.brevo.com/v3/senders/domains",
      { headers: { "api-key": apiKey, Accept: "application/json" } },
    );
    return (d.domains ?? []).filter((x) => x.authenticated).map((x) => x.domain_name.toLowerCase());
  } catch {
    return [];
  }
}
