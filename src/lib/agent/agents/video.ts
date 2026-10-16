// El agente de video: con el texto de la pieza (su guion) y las fotos y clips de la biblioteca del negocio arma el guion del video
// con la plantilla de siempre, lo cotiza y lo deja esperando la aprobación del dueño. No usa modelo y no gasta nada: el render
// (paso `render`, código de MATYA) reserva exactamente esta cotización y empieza solo después de que el dueño la apruebe.
// Nunca se generan escenas con IA: la biblioteca primero y, si no hay material, los diseños de marca de la pieza.
import { AgentError } from "../access";
import { mediaSelection } from "../content-steps";
import { Refusal } from "../guard";
import type { StepResult } from "../queue";
import { Copy } from "../schema";
import type { VideoMedia } from "@/lib/video-plan";
import { libraryIdsOf } from "./design";
import type { AgentInput } from "./types";

/** Who makes the video, as the owner reads it in the quote. */
export const RENDER_PROVIDER = "fal.ai";

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The images the design step made (square, story, wide), as video media for a piece that has no library material. */
function designMedia(design: unknown, headline: string): VideoMedia[] {
  const assets = isObject(design) && Array.isArray(design.assets) ? design.assets : [];
  return assets.flatMap((a, i): VideoMedia[] => {
    if (!isObject(a) || typeof a.url !== "string" || !a.url) return [];
    return [
      {
        id: `design-${i}`,
        kind: "photo",
        url: a.url,
        thumb: a.url,
        focus: null,
        width: a.shape === "wide" ? 1600 : 1080,
        height: a.shape === "story" ? 1920 : a.shape === "wide" ? 900 : 1080,
        durationSec: 0,
        about: headline,
      },
    ];
  });
}

const dollars = (cents: number) => `US$${(cents / 100).toFixed(2)}`;

/** What the owner reads when the quote is ready. */
const quoteText = (cents: number, language: "es" | "en") =>
  language === "en"
    ? `Video ready to generate with ${RENDER_PROVIDER}: ${dollars(cents)}. Approve it to start.`
    : `Video listo para generar con ${RENDER_PROVIDER}: ${dollars(cents)}. Apruébalo para empezar.`;

/**
 * The `video` step of a video piece. It builds the storyboard from the piece's copy (its script) and the business's own library
 * (the photos this piece's design used may come out again), prices it with `videoQuote`, and waits for the owner. A quote over
 * the maximum per video is refused here, before anyone is asked to approve it.
 */
export async function runVideo(input: AgentInput): Promise<StepResult> {
  if (input.step.id !== "video") throw new AgentError("Agente no disponible.");
  const { run, language } = input;
  const readStep = input.tools.use("readStepOutput");
  const [written, design] = await Promise.all([readStep("copy"), readStep("design")]);
  const copy = Copy.safeParse(written);
  if (!copy.success) throw new AgentError("Falta completar el paso anterior.");

  // The same query as the design step, so the video finds the photo that design chose.
  const ownMedia = await input.tools.use("listLibrary")(
    `${run.prompt}\n${copy.data.title}\n${copy.data.headline}\n${copy.data.summary}`,
    { language, reuse: libraryIdsOf(design) },
  );
  const media = ownMedia.length ? ownMedia : designMedia(design, copy.data.headline);
  // Known before anything was quoted, written or spent: a refusal, so the piece ends blocked (not uncertain).
  if (!media.length)
    throw new Refusal("No hay fotos ni diseños para armar el video. Los textos están guardados.");

  const idea = copy.data.script.trim() || copy.data.summary.trim() || copy.data.headline;
  const quote = await input.tools.use("videoQuote")(idea, media, language);
  if (quote.cents > quote.maxCents)
    throw new Refusal(
      `El video supera el máximo autorizado (${dollars(quote.cents)} de ${dollars(quote.maxCents)}). El guion y los diseños están guardados.`,
    );
  return {
    data: {
      storyboard: quote.storyboard,
      provider: RENDER_PROVIDER,
      cents: quote.cents,
      mediaSelection: mediaSelection(ownMedia),
    },
    state: "waiting_approval",
    text: quoteText(quote.cents, language),
  };
}
