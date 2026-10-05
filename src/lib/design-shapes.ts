// Tamaños de los diseños y reglas de texto (sin JSX, para poder probarlos solos).

export const DESIGN_SHAPES = {
  square: { w: 1080, h: 1080, label: "Cuadrado (1:1) · Facebook e Instagram" },
  portrait: { w: 1080, h: 1350, label: "Vertical (4:5) · Instagram" },
  story: { w: 1080, h: 1920, label: "Historia / Reel (9:16)" },
} as const;
export type DesignShape = keyof typeof DESIGN_SHAPES;

/** Titulares más largos usan letra más chica para que siempre quepan. */
export function headlineSize(text: string, width: number): number {
  const n = text.length;
  const base = n <= 28 ? 84 : n <= 45 ? 70 : n <= 65 ? 58 : 50;
  return Math.round((base * width) / 1080);
}

