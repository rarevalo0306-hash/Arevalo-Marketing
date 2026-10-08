import { headers } from "next/headers";

/** La dirección de la app tal como la está viendo el dueño (ej. https://mi-app.vercel.app), para armar links. */
export async function appOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
    if (host) {
      const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() || (/^(localhost|127\.)/.test(host) ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // Fuera de una visita.
  }
  return (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
}
