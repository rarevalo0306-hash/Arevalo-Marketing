// Lo que el código le fija al escritor de artículos. Módulo ligero (sin dependencias) para que quien calcula el costo de un
// artículo (el equipo de agentes) y quien lo pide a la IA (`writeSeoArticle` en `ai.ts`) lean la misma cifra.

/** Lo más que escribe la IA en un artículo (tokens de salida, razonamiento incluido): el tope que se le pide al proveedor. */
export const SEO_ARTICLE_MAX_TOKENS = 24000;
