// Publicaciones en dos idiomas (Facebook e Instagram): el texto principal, una raya y la otra versión.
// Puro: lo usan el servidor (para saber si el negocio habla dos idiomas) y el compositor (para unir los textos).

const BOTH =
  /(espa[ñn]ol\s*(?:e|y|and|&|\/|,)\s*ingl[eé]s|ingl[eé]s\s*(?:e|y|and|&|\/|,)\s*espa[ñn]ol|biling[uü]e|bilingual|spanish\s*(?:and|&|\/|,)\s*english|english\s*(?:and|&|\/|,)\s*spanish)/i;

/** ¿El negocio dice que atiende en español e inglés? (perfil para la IA o tono de la marca). */
export function isBilingual(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => !!t && BOTH.test(t));
}

/** La línea que separa los dos idiomas (dice el idioma que viene después). */
export const separatorFor = (secondLang: "es" | "en") => (secondLang === "en" ? "— English —" : "— Español —");

/** Une la versión principal y la otra: "texto en español\n\n— English —\n\ntexto en inglés". */
export function joinBilingual(main: string, other: string, mainLang: "es" | "en" = "es"): string {
  const a = main.trim();
  const b = other.trim();
  if (!b) return a;
  if (!a) return b;
  return `${a}\n\n${separatorFor(mainLang === "en" ? "es" : "en")}\n\n${b}`;
}
