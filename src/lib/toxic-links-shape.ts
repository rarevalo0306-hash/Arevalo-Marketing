// «Enlaces dañinos»: lo que también usa el navegador (sin dependencias): tipos, las dos preguntas de
// «¿Necesito desautorizar?», textos de los resultados y la lectura de archivos subidos. El resto está en toxic-links.ts.

export type Bi = { es: string; en: string };
export type RiskLevel = "alto" | "medio" | "bajo" | "seguro";
export const RISK_LEVELS: RiskLevel[] = ["alto", "medio", "bajo", "seguro"];
export type Answer = "yes" | "no" | "unsure";
export type Outcome = "nothing" | "watch" | "prepare";
export type SpikeLevel = "calm" | "watch" | "attack";

/** Herramienta de Google para subir el archivo (con la propiedad de dominio o de prefijo de URL). */
export const DISAVOW_TOOL_URL = "https://search.google.com/search-console/disavow-links";
/** Página de «Acciones manuales» de Search Console (la API de Search Console no la deja leer). */
export const MANUAL_ACTIONS_URL = "https://search.google.com/search-console/manual-actions";
/** Ayuda oficial de Google sobre desautorizar enlaces. */
export const DISAVOW_HELP_URL = "https://support.google.com/webmasters/answer/2648487";

const bi = (es: string, en: string): Bi => ({ es, en });

// ---------- «¿Necesito desautorizar?» ----------

export type Wizard = { outcome: Outcome; why: Bi[] };

/**
 * El resultado de las dos preguntas con los datos. Por defecto «No hagas nada». Solo «Prepara el archivo» con una
 * acción manual en Search Console, o con una caída fuerte en Google + un ataque claro de enlaces nuevos dañinos.
 */
export function wizardOutcome(input: { manual: Answer | null; drop: Answer | null; spike: SpikeLevel; high: number }): Wizard {
  const why: Bi[] = [];
  if (input.manual === "yes") {
    why.push(bi("Google te puso una acción manual por enlaces no naturales: aquí sí hay que limpiar y pedir que lo revisen.", "Google gave you a manual action for unnatural links: here you do need to clean up and ask for a review."));
    return { outcome: "prepare", why };
  }
  if (input.manual !== "no")
    why.push(bi("Primero confirma en Search Console si tienes una «Acción manual» (el enlace está arriba). Sin eso, casi nunca hace falta.", "First confirm in Search Console whether you have a “Manual action” (link above). Without one it's almost never needed."));
  if (input.drop === "yes" && input.spike === "attack") {
    why.push(bi("Bajaste fuerte en Google y al mismo tiempo llegaron muchos enlaces nuevos de sitios dañinos: parece un ataque.", "You dropped hard on Google and, at the same time, lots of new links from harmful sites arrived: it looks like an attack."));
    return { outcome: "prepare", why };
  }
  if (input.spike !== "calm") {
    why.push(
      input.spike === "attack"
        ? input.drop === "no"
          ? bi("Llegaron muchos enlaces nuevos de sitios dañinos, pero no bajaste en Google: Google los está ignorando. Te avisamos si siguen llegando.", "Lots of new links from harmful sites arrived, but you haven't dropped on Google: Google is ignoring them. We'll warn you if more keep coming.")
          : bi("Llegaron muchos enlaces nuevos de sitios dañinos. Si no bajaste en Google, Google los está ignorando: solo vigila. Si bajaste fuerte, responde «Sí» en la pregunta 2.", "Lots of new links from harmful sites arrived. If you haven't dropped on Google, Google is ignoring them: just keep an eye on it. If you dropped hard, answer “Yes” to question 2.")
        : bi("Llegaron algunos enlaces nuevos raros. No hace falta hacer nada; te avisamos si aparecen más.", "Some odd new links arrived. Nothing to do; we'll warn you if more show up."),
    );
    return { outcome: "watch", why };
  }
  if (input.drop === "yes") {
    why.push(bi("Bajaste en Google, pero no vemos un ataque de enlaces: la causa probablemente es otra (cambios en tu página, la competencia o una actualización de Google). Revisa tu plan de acción.", "You dropped on Google, but we don't see a link attack: the cause is probably something else (website changes, competitors or a Google update). Check your action plan."));
    return { outcome: input.high >= 20 ? "watch" : "nothing", why };
  }
  why.push(bi("Google ya ignora solo casi todos los enlaces de spam. Desautorizar enlaces buenos por error te puede hacer daño.", "Google already ignores almost all spam links on its own. Disavowing good links by mistake can hurt you."));
  return { outcome: "nothing", why };
}

export const OUTCOME_TEXT: Record<Outcome, Bi> = {
  nothing: bi("No hagas nada (recomendado)", "Do nothing (recommended)"),
  watch: bi("Vigila (te avisamos si aparecen más)", "Keep an eye on it (we'll warn you if more show up)"),
  prepare: bi("Prepara el archivo de desautorización", "Prepare the disavow file"),
};

/** Lee un archivo subido: quita la marca BOM y entiende UTF-16 (Ahrefs exporta así). */
export function decodeExport(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  // UTF-16 sin BOM: muchos ceros en las posiciones impares.
  const sample = bytes.subarray(0, Math.min(400, bytes.length));
  let zeros = 0;
  for (let i = 1; i < sample.length; i += 2) if (sample[i] === 0) zeros++;
  if (sample.length > 8 && zeros > sample.length / 4) return new TextDecoder("utf-16le").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

