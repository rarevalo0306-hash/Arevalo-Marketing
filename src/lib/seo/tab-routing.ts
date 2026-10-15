import type { SeoTabId } from "@/components/nav/model";

// Fragments are never sent to the server. Keep legacy email/dashboard links working
// by resolving them to a real server navigation before rendering their panel.
const HASH_TAB: Record<string, SeoTabId> = {
  posiciones: "google", palabras: "google", preguntas: "google", sensor: "google", temas: "google", ideas: "google",
  mapa: "local", perfil: "local", "codigo-google": "local", "resenas-web": "local",
  auditoria: "web", paginas: "web", decay: "web", canibalizacion: "web",
  ga4: "web", "search-console": "web", registro: "web",
  competencia: "competencia", mercado: "competencia", gap: "competencia",
  trafico: "competencia", enlaces: "competencia", comparar: "competencia", "anuncios-competencia": "competencia", menciones: "competencia", vigilancia: "competencia",
  ia: "ia", reporte: "reportes", alertas: "reportes", dataforseo: "ajustes",
};
export function seoTabForHash(hash: string): SeoTabId | null {
  try { return HASH_TAB[decodeURIComponent(hash.replace(/^#/, ""))] ?? null; }
  catch { return null; }
}
