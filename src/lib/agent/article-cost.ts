// Lo que cuesta un artículo para la web y cómo se le cuenta al dueño. Módulo puro: sin base de datos ni red.
// El escritor de artículos no usa el modelo del agente: paga la consulta de Google (DataForSEO) y la IA de texto del negocio, y esa
// IA no devuelve cuántos tokens usó. Por eso no hay un tope que el código pueda garantizar, y el dueño autoriza el costo antes
// de que se llame al escritor: «hasta US$X» con los mismos precios y la misma cuenta que ya usa «Que la IA mejore mis posiciones»
// (`writeAiCents`, `WRITER_SERP_COST`, `SITE_TEXT_CENTS`). Lo que se reserva es exactamente lo que se le dijo.
import { usd, writeAiCents } from "@/lib/rankfix-shape";
import { SITE_TEXT_CENTS } from "@/lib/seo/site-article";
import { WRITER_SERP_COST } from "@/lib/seo/writer";
import type { Piece } from "./plan";

/** The search an article is written for: the piece's keyword, or its topic when it has none. */
export const articleKeyword = (piece: Piece): string => piece.keyword.trim() || piece.topic;

/** Lo que cuesta la consulta de Google del escritor (centavos, con decimales: unos US$0.002). */
const SERP_CENTS = WRITER_SERP_COST * 100;

/** Lo que se reserva para escribir el artículo: la consulta de Google y la IA, hasta el centavo siguiente. */
export const articleReserve = (provider: string | null | undefined): number =>
  Math.ceil(SERP_CENTS + writeAiCents(provider));

/** Lo que puede costar el artículo entero hasta quedar en la web, sin foto con IA: escribirlo y traducirlo. */
export const articleUpTo = (provider: string | null | undefined): number =>
  Math.ceil(SERP_CENTS + writeAiCents(provider) + SITE_TEXT_CENTS);

/**
 * Lo que se cobra al presupuesto cuando el artículo ya está escrito: lo que Google cobró de verdad (`googleUsd`, el costo del
 * reporte) y la IA al precio con que se le pidió permiso al dueño, porque la IA no informa su consumo. Nunca más de lo
 * reservado (`reserved`): un paso que cobra de más bloquea el trabajo y apaga a MATYA.
 */
export const articleCharge = (googleUsd: number, provider: string | null | undefined, reserved: number): number =>
  Math.max(0, Math.min(reserved, Math.ceil((Number.isFinite(googleUsd) ? googleUsd : 0) * 100) + writeAiCents(provider)));

/** Lo que lee el dueño cuando el artículo espera su aprobación para escribirse (la primera vez o una vuelta de corrección). */
export function articleApprovalText(
  keyword: string,
  provider: string | null | undefined,
  language: "es" | "en",
  rework: boolean,
): string {
  const search = usd(SERP_CENTS);
  const write = usd(writeAiCents(provider));
  const translate = usd(SITE_TEXT_CENTS);
  const upTo = usd(articleUpTo(provider));
  return language === "en"
    ? `${rework ? `The review sent the article "${keyword}" back. Writing another draft is a new paid call.` : `I am going to write the article "${keyword}" for your website.`} It will cost up to ${upTo}: the Google search (${search}), the AI writing (up to ${write}) and the translation for the web (${translate}). If no photo in your library fits the topic, an AI photo will be asked for separately. Approve it to start.`
    : `${rework ? `La revisión devolvió el artículo «${keyword}». Escribir otro borrador es una nueva llamada de pago.` : `Voy a escribir el artículo «${keyword}» para tu web.`} Costará hasta ${upTo}: la búsqueda en Google (${search}), la redacción con IA (hasta ${write}) y la traducción para la web (${translate}). Si ninguna foto de tu biblioteca va con el tema, la foto con IA se te pedirá aparte. Apruébalo para empezar.`;
}

/** Lo que lee el dueño cuando el artículo quedó escrito. */
export const articleWrittenText = (
  keyword: string,
  score: number,
  googleUsd: number,
  language: "es" | "en",
): string =>
  language === "en"
    ? `I wrote the article "${keyword}": it scored ${score}/100. Google cost: US$${googleUsd.toFixed(3)}. It goes to the editorial review next.`
    : `Escribí el artículo «${keyword}»: sacó ${score}/100. Costo de Google: US$${googleUsd.toFixed(3)}. Ahora pasa a la revisión editorial.`;
