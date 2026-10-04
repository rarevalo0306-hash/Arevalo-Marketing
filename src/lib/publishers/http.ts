export class PublishError extends Error {}

/** fetch que devuelve JSON y convierte errores de las APIs en mensajes legibles. */
export async function fetchJson<T = Record<string, unknown>>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const raw = await res.text();
  let body: unknown = raw;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    // respuesta que no es JSON
  }
  if (!res.ok) throw new PublishError(`${res.status}: ${describeError(body)}`);
  return body as T;
}

function describeError(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 300) || "sin detalle";
  const b = body as Record<string, unknown>;
  const err = b.error as Record<string, unknown> | string | undefined;
  if (typeof err === "string") return [err, b.error_description].filter(Boolean).join(" — ");
  if (err && typeof err === "object") {
    const msg = err.message ?? err.error_user_msg ?? err.code;
    if (msg) return String(msg);
  }
  if (b.message) return String(b.message);
  return JSON.stringify(body).slice(0, 300);
}

export function form(data: Record<string, string>): URLSearchParams {
  return new URLSearchParams(data);
}

export function required(creds: Record<string, string>, keys: string[]): void {
  const missing = keys.filter((k) => !creds[k]?.trim());
  if (missing.length) throw new PublishError(`Faltan datos de la conexión: ${missing.join(", ")}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
