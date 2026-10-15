// Leer los números que escribe el dueño en la configuración del Centro MATYA (límites en dólares, publicaciones al día,
// horas). Vacío o con letras devuelve null: nunca se convierte en cero sin que el dueño lo escriba.
import { parseMoney } from "@/lib/ads-shape";

/** "5", "1.50", "2,5" (coma decimal), "$12.50" o "1,000" → centavos; null si no es una cantidad válida. */
export function readUsd(text: string): number | null {
  const s = text.trim();
  if (!s) return null;
  // Una coma seguida de 1 o 2 cifras al final es la coma decimal ("2,5" = 2.50); con 3 cifras es de miles ("1,000").
  return parseMoney(/^\$?\d+,\d{1,2}$/.test(s) ? s.replace(",", ".") : s);
}

/** "4" → 4; null si está vacío, tiene decimales o letras. */
export function readCount(text: string): number | null {
  const s = text.trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** Centavos → "5.00" (lo que se muestra en el campo). */
export const formatUsd = (cents: number) => (Math.max(0, Math.round(cents)) / 100).toFixed(2);
