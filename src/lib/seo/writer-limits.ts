// Lo que el código le fija a la IA de los artículos para la web. Módulo ligero (sin dependencias) para que quien calcula el costo
// de un artículo (el equipo de agentes) y quien lo pide a la IA (`writeSeoArticle` en `ai.ts`, la traducción en
// `publishers/website.ts` y la elección de la foto en `seo/site-article-run.ts`) lean la misma cifra.

/** Lo más que escribe la IA en un artículo (tokens de salida, razonamiento incluido): el tope que se le pide al proveedor. */
export const SEO_ARTICLE_MAX_TOKENS = 24000;

/** Lo más que escribe la IA al traducir un artículo para la web bilingüe (`translateForSite`): el tope que se le pide al proveedor. */
export const SITE_TRANSLATION_MAX_TOKENS = 16000;

/** Lo más que escribe la IA al elegir la foto del artículo entre las de la biblioteca (`aiPickPhoto`), cuando la mejor no es clara. */
export const SITE_PHOTO_PICK_MAX_TOKENS = 800;
