// Biblioteca de fotos y videos reales del negocio (tabla LibraryItem): lo que la IA ve en cada archivo de la carpeta
// de Google Drive y las reglas para saber si se puede usar en una publicación. Sin servidor ni base de datos.

/** Avisos de privacidad: con alguno, la foto no se usa sola hasta que el dueño la apruebe. */
export const PRIVACY_FLAGS = ["faces", "address", "plate", "document", "child"] as const;
export type PrivacyFlag = (typeof PRIVACY_FLAGS)[number];

export const PRIVACY_LABEL: Record<PrivacyFlag, { es: string; en: string }> = {
  faces: { es: "Se ven caras de personas", en: "People's faces are visible" },
  address: { es: "Se ve una dirección o número de casa", en: "An address or house number is visible" },
  plate: { es: "Se ve una placa de carro", en: "A license plate is visible" },
  document: { es: "Se ve un documento o datos personales", en: "A document or personal data is visible" },
  child: { es: "Aparece un niño", en: "A child appears" },
};

/** Lo que la IA anota de cada foto o video (columna `description`). */
export type LibraryDescription = {
  /** Qué muestra, en una o dos frases. */
  es: string;
  en: string;
  /** Tipo de escena: trabajo terminado, antes, después, en proceso, equipo, local, producto, daño, otro. */
  scene: "done" | "before" | "after" | "progress" | "team" | "place" | "product" | "damage" | "other";
  /** Temas o servicios del negocio con los que va (en el idioma del negocio, en minúsculas). */
  topics: string[];
  /** Por qué no sirve, si no sirve (borrosa, oscura, captura de pantalla, nada que ver con el negocio…). */
  reason?: { es: string; en: string };
};

export type LibraryChoice = "" | "use" | "skip";

/** Lo mínimo para decidir si un archivo se puede usar en una publicación. */
export type UsableInput = { status: string; usable: boolean; quality: number; privacy: string[]; choice: string; kind: string; url: string };

/**
 * ¿La IA lo puede usar sola en una publicación? Listo y con copia guardada, que sirva, calidad 3 o más, sin avisos de
 * privacidad (o aprobado por el dueño), y que el dueño no lo haya marcado «No usar». Lo aprobado con «Usar» siempre vale.
 */
export function canUse(x: UsableInput): boolean {
  if (x.choice === "skip" || x.status !== "ready" || !x.url) return false;
  if (x.choice === "use") return true;
  return x.usable && x.quality >= 3 && x.privacy.length === 0;
}

/** Necesita que el dueño la mire: buena, pero con avisos de privacidad y sin decidir. */
export const needsReview = (x: UsableInput) => x.status === "ready" && x.choice === "" && x.usable && x.privacy.length > 0;

export function readDescription(raw: unknown): LibraryDescription | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const es = typeof o.es === "string" ? o.es : "";
  const en = typeof o.en === "string" ? o.en : es;
  if (!es && !en) return null;
  const scenes = ["done", "before", "after", "progress", "team", "place", "product", "damage", "other"] as const;
  const scene = scenes.includes(o.scene as (typeof scenes)[number]) ? (o.scene as LibraryDescription["scene"]) : "other";
  const topics = Array.isArray(o.topics) ? o.topics.filter((t): t is string => typeof t === "string").slice(0, 12) : [];
  const r = o.reason && typeof o.reason === "object" ? (o.reason as Record<string, unknown>) : null;
  const reason = r && (typeof r.es === "string" || typeof r.en === "string") ? { es: String(r.es ?? r.en ?? ""), en: String(r.en ?? r.es ?? "") } : undefined;
  return { es: es || en, en: en || es, scene, topics, reason };
}

/** Saca el id de la carpeta de un link de Google Drive (o acepta el id solo). */
export function driveFolderId(input: string): string | null {
  const s = input.trim();
  const m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(s) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : null;
}
