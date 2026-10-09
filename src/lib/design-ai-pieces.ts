// Piezas del manual de marca: cuáles son de redes sociales (las únicas que se convierten en plantillas, regla del
// dueño). Sin servidor: se usa en el servidor y en pantalla.

/**
 * Qué pieza es un ejemplo de aplicación ("template"). Solo las de redes sociales se pueden convertir en plantillas
 * de la app (regla del dueño); las demás (tarjeta, papelería, letreros…) quedan solo como referencia de estilo.
 */
export const SOCIAL_PIECES = ["social-post", "story", "ad", "cover"] as const;
export const PIECES = [...SOCIAL_PIECES, "business-card", "stationery", "signage", "other"] as const;
export type Piece = (typeof PIECES)[number];
export const isSocialPiece = (p: string | undefined): boolean => (SOCIAL_PIECES as readonly string[]).includes(p ?? "");

/**
 * ¿Una imagen guardada del manual es una pieza de redes? La pieza se guarda en `format` (para no cambiar la forma de
 * brandAssets). Las leídas antes de existir ese dato: por su forma (cuadrada, 4:5 o 9:16).
 */
export function isSocialAsset(a: { kind: string; format?: string; w: number; h: number }): boolean {
  if (a.kind !== "template") return false;
  if (a.format) return isSocialPiece(a.format);
  const r = a.w / Math.max(1, a.h);
  return (r >= 0.9 && r <= 1.12) || (r >= 0.78 && r <= 0.83) || (r >= 0.53 && r <= 0.6);
}

/** La pieza de redes según su forma (para las que encuentra la cuadrícula sin la IA). */
export function pieceOfRatio(w: number, h: number): Piece {
  const r = w / Math.max(1, h);
  return r < 0.68 ? "story" : r > 1.5 ? "cover" : "social-post";
}

