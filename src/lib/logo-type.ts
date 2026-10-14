// Qué tipo es el logo principal (logotipo, imagotipo o isologo): lo dice la IA mirando la imagen, para no
// preguntárselo al dueño. Solo con Gemini, que mira imágenes. Nunca falla: si no puede, devuelve null y el dueño elige.
import sharp from "sharp";
import { z } from "zod";
import { askGemini } from "@/lib/ai";
import { LOGO_TYPES, type LogoType } from "@/lib/brand-assets";
import { readMedia } from "@/lib/media";

export const logoTypeEnabled = () => Boolean(process.env.GEMINI_API_KEY);

const LogoTypeSchema = z.object({
  type: z.enum(LOGO_TYPES).describe("logotipo, imagotipo or isologo"),
  why: z.string().describe("One short sentence in Spanish explaining what you saw"),
});

export const LOGO_TYPE_PROMPT = `You classify a company logo image into one of three kinds:
- logotipo: only the name in lettering. Stylized letters are fine, but there is no separate drawing or symbol.
- imagotipo: a drawing or symbol AND the name, as separate elements (the symbol beside, above or below the name) that could be used apart.
- isologo: the drawing and the name are fused into one piece that can't be separated: the name sits inside the symbol, or the symbol forms or replaces a letter of the name.
Look only at the image. Ignore any background color.`;

/** El tipo de logo de la imagen guardada en `url`, o null si no hay IA o no se pudo ver. */
export async function detectLogoType(url: string): Promise<LogoType | null> {
  if (!url || !logoTypeEnabled()) return null;
  try {
    const png = await logoOnBackground(await readMedia(url));
    const r = await askGemini(LogoTypeSchema, LOGO_TYPE_PROMPT, "What kind of logo is this?", 1200, [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }]);
    return LOGO_TYPES.find((x) => x === r.type) ?? null;
  } catch (e) {
    console.error("[logo-type]", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * El logo sobre un fondo donde se vea: los PNG con fondo transparente se le muestran a la IA sobre blanco, o sobre
 * oscuro si el logo es casi todo claro (una versión blanca sobre blanco no se vería).
 */
export async function logoOnBackground(file: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(file).resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let light = 0;
  let seen = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    seen++;
    if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] > 215) light++;
  }
  const background = seen && light / seen > 0.85 ? "#1f2937" : "#ffffff";
  return sharp(data, { raw: info }).flatten({ background }).png().toBuffer();
}
