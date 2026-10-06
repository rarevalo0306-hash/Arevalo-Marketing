// Cliente de DataForSEO (pago por uso): volúmenes reales de búsqueda, posiciones en Google y competidores.
// Credenciales en DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD (app.dataforseo.com → API Access).
import { bi } from "@/lib/i18n";

const BASE = "https://api.dataforseo.com/v3";

export const dataForSeoEnabled = () => Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);

const auth = () => `Basic ${Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString("base64")}`;

type Envelope<T> = {
  status_code: number;
  status_message: string;
  cost?: number;
  tasks?: { status_code: number; status_message: string; cost?: number; result?: T[] | null }[];
};

/** Lo que devuelve una llamada: los resultados de la primera tarea y lo que costó (USD). */
export type DfsResult<T> = { result: T[]; cost: number };

function explain(code: number, message: string): Error {
  if (code === 40100 || code === 401)
    return bi("DataForSEO rechazó el usuario o la contraseña (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).", "DataForSEO rejected the login or password (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).");
  if (code === 40200 || code === 402)
    return bi("Tu cuenta de DataForSEO no tiene saldo. Recárgala en app.dataforseo.com.", "Your DataForSEO account is out of funds. Top it up at app.dataforseo.com.");
  if (code === 40202 || code === 429)
    return bi("DataForSEO pide esperar un momento (demasiadas consultas). Intenta de nuevo en un minuto.", "DataForSEO asks to wait a moment (too many requests). Try again in a minute.");
  return bi(`DataForSEO respondió: ${message} (${code})`, `DataForSEO responded: ${message} (${code})`);
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 60_000): Promise<DfsResult<T>> {
  if (!dataForSeoEnabled()) throw bi("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).");
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: auth(), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw bi("No se pudo hablar con DataForSEO (tardó demasiado o no hay conexión). Intenta de nuevo.", "Couldn't reach DataForSEO (it took too long or there's no connection). Try again.");
  }
  let data: Envelope<T>;
  try {
    data = (await res.json()) as Envelope<T>;
  } catch {
    throw explain(res.status, res.statusText || "respuesta inválida");
  }
  if (!res.ok || data.status_code !== 20000) throw explain(data.status_code || res.status, data.status_message || res.statusText);
  const task = data.tasks?.[0];
  if (task && task.status_code !== 20000) throw explain(task.status_code, task.status_message);
  return { result: task?.result ?? [], cost: data.cost ?? task?.cost ?? 0 };
}

/** POST con una sola tarea (las llamadas "live" de DataForSEO aceptan una tarea por llamada). */
export const dfsPost = <T>(path: string, task: Record<string, unknown>, timeoutMs?: number) => call<T>("POST", path, [task], timeoutMs);
export const dfsGet = <T>(path: string, timeoutMs?: number) => call<T>("GET", path, undefined, timeoutMs);

/** Saldo de la cuenta (gratis). */
export async function dataForSeoBalance(): Promise<number | null> {
  try {
    const r = await dfsGet<{ money?: { balance?: number } }>("/appendix/user_data", 15_000);
    return r.result[0]?.money?.balance ?? null;
  } catch {
    return null;
  }
}

export type DfsLocation = { code: number; name: string; type: string; country: string };

// La lista de zonas de un país es grande y casi no cambia: se guarda en memoria del servidor.
const locationCache = new Map<string, { at: number; list: DfsLocation[] }>();

/** Busca zonas de Google (ciudad, condado, estado, país) por nombre. Gratis. */
export async function searchLocations(country: string, query: string, limit = 20): Promise<DfsLocation[]> {
  const iso = country.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(iso)) return [];
  let cached = locationCache.get(iso);
  if (!cached || Date.now() - cached.at > 24 * 3600_000) {
    const r = await dfsGet<{ location_code: number; location_name: string; location_type: string; country_iso_code: string }>(`/keywords_data/google_ads/locations/${iso}`);
    cached = { at: Date.now(), list: r.result.map((l) => ({ code: l.location_code, name: l.location_name, type: l.location_type, country: l.country_iso_code })) };
    locationCache.set(iso, cached);
  }
  return rankLocations(cached.list, query, limit);
}

const normName = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const TYPE_ORDER: Record<string, number> = { Country: 0, State: 1, Department: 1, Province: 1, "DMA Region": 2, Region: 3, County: 4, City: 5, Municipality: 6 };

/**
 * Ordena las zonas que coinciden con la búsqueda: primero las que se llaman exactamente así
 * (ej. "Nicaragua" el país), luego las que empiezan así, y dentro de eso de la más grande a la más chica.
 */
export function rankLocations(list: DfsLocation[], query: string, limit = 20): DfsLocation[] {
  const q = normName(query);
  const words = q.split(/[\s,]+/).filter(Boolean);
  if (!words.length) return [];
  const score = (l: DfsLocation) => {
    const first = normName(l.name.split(",")[0]);
    return first === q ? 0 : first.startsWith(q) ? 1 : 2;
  };
  return list
    .filter((l) => words.every((w) => normName(l.name).includes(w)))
    .sort((a, b) => score(a) - score(b) || (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || a.name.length - b.name.length)
    .slice(0, limit);
}

/** Zonas de Google elegidas (hasta 5). La primera es la principal. */
export type Zone = { code: number; name: string; type?: string };
export const MAX_ZONES = 5;

/** Lee las zonas guardadas; si no hay lista (negocios de antes), usa la zona única. */
export function readZones(json: unknown, fallbackCode?: number | null, fallbackName?: string): Zone[] {
  const list = Array.isArray(json)
    ? json
        .filter((z): z is Zone => Number.isInteger((z as Zone)?.code) && (z as Zone).code > 0)
        .map((z) => ({ code: z.code, name: String(z.name ?? "").slice(0, 200), ...(z.type ? { type: String(z.type) } : {}) }))
    : [];
  const unique = list.filter((z, i) => list.findIndex((x) => x.code === z.code) === i).slice(0, MAX_ZONES);
  if (unique.length) return unique;
  return fallbackCode ? [{ code: fallbackCode, name: fallbackName ?? "" }] : [];
}

/** Nombre corto de una zona para columnas y pestañas: "Managua, Nicaragua" en vez de "Managua,Managua,Managua,Nicaragua". */
export function zoneLabel(name: string): string {
  const parts = name.split(",").map((p) => p.trim()).filter(Boolean);
  const out = parts.filter((p, i) => i === 0 || p !== parts[i - 1]);
  return out.length > 2 ? `${out[0]}, ${out[out.length - 1]}` : out.join(", ");
}

/** Palabras clave que el negocio sigue (guardadas en Business.seoKeywords). */
export function readTrackedKeywords(json: unknown): string[] {
  return Array.isArray(json) ? json.filter((k): k is string => typeof k === "string" && k.trim().length > 0).map((k) => k.trim().slice(0, 80)).slice(0, 50) : [];
}
