// Lo que cuesta un artículo para la web y cómo se le cuenta al dueño. Módulo puro: sin base de datos ni red.
// El escritor de artículos no usa el modelo del agente: paga la consulta de Google (DataForSEO) y la IA de texto del negocio, y esa
// IA no devuelve cuántos tokens usó. El código sí fija lo que le pide al proveedor: como mucho `SEO_ARTICLE_MAX_TOKENS` de salida
// (el razonamiento incluido) y los precios de lista de cada IA (`TEXT_PRICES`). Con eso se calcula un «hasta US$X» que el dueño
// aprueba antes de que se llame al escritor, y lo que se reserva es exactamente lo que se le dijo.
import { TEXT_PRICES, usd, WRITE_AI } from "@/lib/rankfix-shape";
import { SITE_TEXT_CENTS } from "@/lib/seo/site-article";
import { WRITER_SERP_COST } from "@/lib/seo/writer";
import { SEO_ARTICLE_MAX_TOKENS } from "@/lib/seo/writer-limits";
import type { Piece } from "./plan";

/** The search an article is written for: the piece's keyword, or its topic when it has none. */
export const articleKeyword = (piece: Piece): string => piece.keyword.trim() || piece.topic;

/** Lo que cuesta la consulta de Google del escritor (centavos, con decimales: unos US$0.002). */
const SERP_CENTS = WRITER_SERP_COST * 100;

/**
 * Lo más que puede costar que la IA escriba el artículo (centavos, hacia arriba): toda su salida permitida (`SEO_ARTICLE_MAX_TOKENS`)
 * al precio de lista de la IA del negocio, más lo que lee (cuatro veces lo usual: perfil, estudio y metas de Google), que el código
 * no limita. Una IA que no se conoce se cuenta como la más cara. La salida sí tiene tope en el proveedor; la entrada y el precio de
 * lista son lo que el código sabe, no una garantía del proveedor.
 */
export function articleAiCents(provider: string | null | undefined): number {
  const price = TEXT_PRICES[provider ?? ""] ?? TEXT_PRICES.claude;
  const inputTokens = (WRITE_AI.promptChars / 4) * 4;
  const usdCost = (inputTokens * price.inputPerM + SEO_ARTICLE_MAX_TOKENS * price.outputPerM) / 1_000_000;
  return Math.max(1, Math.ceil(usdCost * 100 - 1e-9));
}

/** Lo que se reserva para escribir el artículo: la consulta de Google y la IA, hasta el centavo siguiente. */
export const articleReserve = (provider: string | null | undefined): number =>
  Math.ceil(SERP_CENTS + articleAiCents(provider));

/** Lo que puede costar el artículo entero hasta quedar en la web, sin foto con IA: escribirlo y traducirlo. */
export const articleUpTo = (provider: string | null | undefined): number =>
  articleReserve(provider) + SITE_TEXT_CENTS;

/**
 * Lo que se cobra al presupuesto cuando el artículo ya está escrito: lo que Google cobró de verdad (`googleUsd`, el costo del
 * reporte) y la IA al tope con que se le pidió permiso al dueño, porque la IA no informa su consumo. Nunca más de lo reservado
 * (`reserved`): un paso que cobra de más bloquea el trabajo y apaga a MATYA.
 */
export const articleCharge = (googleUsd: number, provider: string | null | undefined, reserved: number): number =>
  Math.max(0, Math.min(reserved, Math.ceil((Number.isFinite(googleUsd) ? googleUsd : 0) * 100) + articleAiCents(provider)));

/** Lo que lee el dueño cuando el artículo espera su aprobación para escribirse (la primera vez o una vuelta de corrección). */
export function articleApprovalText(
  keyword: string,
  provider: string | null | undefined,
  language: "es" | "en",
  rework: boolean,
  changed = false,
): string {
  const search = usd(SERP_CENTS);
  const write = usd(articleAiCents(provider));
  const translate = usd(SITE_TEXT_CENTS);
  const upTo = usd(articleUpTo(provider));
  const again = changed
    ? language === "en"
      ? "The estimated cost changed since you saw it, so I am asking again. "
      : "El costo estimado cambió desde que lo viste, así que te lo vuelvo a preguntar. "
    : "";
  return again + (language === "en"
    ? `${rework ? `You asked to redo the article "${keyword}": writing another draft is a new paid call.` : `I am going to write the article "${keyword}" for your website.`} It will cost up to ${upTo}: the Google search (${search}), the AI writing (up to ${write}) and the translation for the web (${translate}). If no photo in your library fits the topic, an AI photo will be asked for separately. Approve it to start.`
    : `${rework ? `Pediste rehacer el artículo «${keyword}»: escribir otro borrador es una nueva llamada de pago.` : `Voy a escribir el artículo «${keyword}» para tu web.`} Costará hasta ${upTo}: la búsqueda en Google (${search}), la redacción con IA (hasta ${write}) y la traducción para la web (${translate}). Si ninguna foto de tu biblioteca va con el tema, la foto con IA se te pedirá aparte. Apruébalo para empezar.`);
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
