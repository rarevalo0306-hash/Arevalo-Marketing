// Plan de acción único (tabla ActionTask): la forma de cada tarea y las reglas comunes. Sin servidor ni base de datos.

export type Bi = { es: string; en: string };

export const TASK_SOURCES = ["audit", "onpage", "keywords", "content", "links", "local", "reviews", "ai", "schema", "gsc", "ga4", "setup"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export const TASK_AREAS = ["web", "google", "maps", "ia", "contenido", "enlaces", "marca"] as const;
export type TaskArea = (typeof TASK_AREAS)[number];

export const AREA_LABEL: Record<TaskArea, Bi> = {
  web: { es: "Tu página web", en: "Your website" },
  google: { es: "Posiciones en Google", en: "Google rankings" },
  maps: { es: "Google Maps y reseñas", en: "Google Maps & reviews" },
  ia: { es: "Visibilidad en IAs", en: "AI visibility" },
  contenido: { es: "Contenido", en: "Content" },
  enlaces: { es: "Enlaces", en: "Backlinks" },
  marca: { es: "Marca", en: "Brand" },
};

export const TASK_STATUSES = ["todo", "done", "dismissed", "gone"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Una tarea propuesta por el plan (antes de guardarla). `key` debe ser estable entre corridas para el mismo hallazgo. */
export type TaskDraft = {
  key: string;
  source: TaskSource;
  area: TaskArea;
  title: Bi;
  detail?: Bi;
  /** 3 alto · 2 medio · 1 bajo */
  impact: 1 | 2 | 3;
  /** 1 fácil · 2 medio · 3 difícil */
  effort: 1 | 2 | 3;
  href: string;
};

/** Orden del plan: primero lo que más ayuda con menos trabajo. */
export const taskScore = (t: { impact: number; effort: number }) => t.impact * 10 - t.effort * 3;

export function readBi(raw: unknown): Bi | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const es = typeof o.es === "string" ? o.es : "";
  const en = typeof o.en === "string" ? o.en : es;
  return es || en ? { es: es || en, en: en || es } : null;
}
