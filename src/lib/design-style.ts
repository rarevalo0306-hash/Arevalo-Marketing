// El estilo de los diseños: cada negocio tiene su actitud. Un ajustador de seguros se ve ordenado y serio; un salón,
// elegante; una clínica, fresca y amable; un techador, fuerte y directo. El estilo no cambia la marca (logo, colores
// y letras son los del negocio): cambia cómo se usan (peso del titular, esquinas, botón, detalles).
// La app lo elige sola por el tipo de negocio; el dueño lo puede cambiar en Marca.

export const DESIGN_STYLES = ["profesional", "elegante", "fresco", "audaz"] as const;
export type DesignStyle = (typeof DESIGN_STYLES)[number];

type Bi = { es: string; en: string };
export const STYLE_INFO: Record<DesignStyle, { name: Bi; what: Bi; fits: Bi }> = {
  profesional: {
    name: { es: "Profesional", en: "Professional" },
    what: { es: "Ordenado y serio: líneas finas, mucho aire y botones rectos.", en: "Orderly and serious: thin lines, lots of space and square buttons." },
    fits: { es: "Seguros, abogados, contadores, ajustadores, consultores, bienes raíces.", en: "Insurance, lawyers, accountants, adjusters, consultants, real estate." },
  },
  elegante: {
    name: { es: "Elegante", en: "Elegant" },
    what: { es: "Sereno y refinado: titular fino y centrado, un marco delgado, sin adornos.", en: "Calm and refined: a light, centered headline, a thin frame, no frills." },
    fits: { es: "Salones, spas, boutiques, joyerías, bodas, restaurantes finos.", en: "Salons, spas, boutiques, jewelers, weddings, fine dining." },
  },
  fresco: {
    name: { es: "Fresco y cercano", en: "Fresh and friendly" },
    what: { es: "Amable y limpio: esquinas redondeadas y colores suaves.", en: "Kind and clean: rounded corners and soft colors." },
    fits: { es: "Clínicas, dentistas, limpieza, escuelas, cafés, mascotas.", en: "Clinics, dentists, cleaning, schools, cafés, pets." },
  },
  audaz: {
    name: { es: "Fuerte y directo", en: "Bold and direct" },
    what: { es: "Con fuerza: titular en mayúsculas, bloques de color y esquinas rectas.", en: "Strong: uppercase headline, color blocks and square corners." },
    fits: { es: "Construcción, techos, talleres, gimnasios, mudanzas, comida rápida.", en: "Construction, roofing, auto shops, gyms, movers, fast food." },
  },
};

/** Cómo se dibuja cada estilo (medidas en unidades de una imagen de 1080). */
export type StyleTokens = {
  /** Peso del titular: "semi" se ve más fino y elegante; "bold", más firme. */
  headWeight: "semi" | "bold";
  /** Titular en mayúsculas aunque la plantilla no lo pida. */
  upper: boolean;
  /** Esquinas de tarjetas, fotos en recuadro y botones (0 = rectas). */
  radius: number;
  /** El botón de la llamada a la acción: rectángulo, pastilla o texto subrayado. */
  cta: "boton" | "pastilla" | "texto";
  /** La línea de acento sobre el titular (ancho y grueso). */
  rule: { w: number; h: number };
  /** Titulares centrados en las plantillas de foto completa y de color. */
  center: boolean;
  /** Marco delgado dentro del borde en las fotos completas. */
  frame: boolean;
  /** Línea fina que separa el pie (contacto) del resto. */
  hairline: boolean;
};

export const STYLE_TOKENS: Record<DesignStyle, StyleTokens> = {
  profesional: { headWeight: "bold", upper: false, radius: 6, cta: "boton", rule: { w: 64, h: 5 }, center: false, frame: false, hairline: true },
  elegante: { headWeight: "semi", upper: false, radius: 0, cta: "texto", rule: { w: 48, h: 2 }, center: true, frame: true, hairline: true },
  fresco: { headWeight: "bold", upper: false, radius: 28, cta: "pastilla", rule: { w: 56, h: 8 }, center: false, frame: false, hairline: false },
  audaz: { headWeight: "bold", upper: true, radius: 0, cta: "boton", rule: { w: 96, h: 12 }, center: false, frame: false, hairline: false },
};

export const styleTokens = (s?: DesignStyle | "") => STYLE_TOKENS[s && s in STYLE_TOKENS ? s : "profesional"];

/** Palabras del tipo de negocio que dicen su estilo (en español y en inglés, sin acentos). */
const KEYWORDS: [DesignStyle, RegExp][] = [
  ["elegante", /\b(?:salon|spas?\b|belleza|beauty|boutique|joyer|jewel|moda\b|fashion|boda|wedding|nails?\b|unas\b|estetica|esthetic|lujo|luxury|maquillaje|makeup|barber|perfum|floris|flores\b|vinos?\b|wine|fine dining|alta cocina)/],
  ["fresco", /\b(?:dental|dentist|odontolog|clinica|clinic\b|salud\b|health|medic|doctor|terapi|therap|limpieza|cleaning|escuela|school|educa|tutor|ninos\b|kids\b|guarder|daycare|veterin|pets?\b|mascota|yoga|wellness|bienestar|nutri|cafe|panader|bakery|heladeria|ice cream|farmacia|pharmac|optica|psicolog)/],
  ["audaz", /\b(?:techos?\b|roof|construc|contractor|contratista|remodel|gym|gimnasio|fitness|crossfit|auto ?(?:shop|repair|body)|automotri|taller|mecanic|plomer|plumb|electricista|electrician|hvac|aire acondicionado|mudanza|movers?\b|cortinas? metalica|soldad|weld|pintura|painting|concreto|concrete|landscap|jardiner|pizza|burger|hamburg|tacos\b|food truck|tattoo|tatuaje|deporte|sports?\b)/],
  ["profesional", /\b(?:seguros\b|aseguradora|poliza|insurance|ajustador|adjuster|reclamacion|reclamo|claims?\b|abogad|lawyer|attorney|law firm|legal\b|contab|contador|accountant|accounting|cpa\b|financ|consultor|consulting|inmobiliari|real estate|bienes raices|realtor|notari|taxes|impuestos|banco\b|bank\b|credito|loans?\b|prestamo|arquitect)/],
];

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * El estilo que va con el negocio, sin preguntar: primero por lo que hace (su descripción y su nombre), luego por
 * sus letras (Playfair se ve elegante; Oswald, fuerte) y luego por el tono que eligió el dueño. Si nada lo dice,
 * profesional (limpio y serio, va con todo).
 */
export function inferDesignStyle(o: { text?: string; fontHeading?: string; tones?: readonly string[] }): DesignStyle {
  const text = plain(o.text ?? "");
  // Lo que más se repite gana (un salón que menciona "consultas" sigue siendo un salón).
  let best: DesignStyle | null = null;
  let most = 0;
  for (const [style, re] of KEYWORDS) {
    const n = text.match(new RegExp(re.source, "g"))?.length ?? 0;
    // A igual cantidad gana el primero de la lista.
    if (n > most) {
      best = style;
      most = n;
    }
  }
  if (best) return best;
  if (o.fontHeading === "playfair-display") return "elegante";
  if (o.fontHeading === "oswald") return "audaz";
  const tones = o.tones ?? [];
  if (tones.includes("directo")) return "audaz";
  if (tones.includes("alegre") || tones.includes("cercano")) return "fresco";
  return "profesional";
}

export const isDesignStyle = (v: unknown): v is DesignStyle => (DESIGN_STYLES as readonly unknown[]).includes(v);

/**
 * El estilo de los diseños de un negocio: el que eligió el dueño (guardado en brandIdentity.designStyle) o el que
 * va con su tipo de negocio. `by` dice quién lo decidió.
 */
export function designStyleOf(b: { name?: string; aiProfile?: string; fontHeading?: string; brandIdentity?: unknown }): { style: DesignStyle; by: "owner" | "app" } {
  const id = b.brandIdentity && typeof b.brandIdentity === "object" ? (b.brandIdentity as Record<string, unknown>) : {};
  if (isDesignStyle(id.designStyle)) return { style: id.designStyle, by: "owner" };
  const tones = Array.isArray(id.tones) ? id.tones.filter((x): x is string => typeof x === "string") : [];
  const about = [b.name, b.aiProfile, typeof id.audience === "string" ? id.audience : ""].filter(Boolean).join(" \n ");
  return { style: inferDesignStyle({ text: about, fontHeading: b.fontHeading, tones }), by: "app" };
}
