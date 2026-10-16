// El agente de diseño: con el texto de la pieza hace los tres formatos con la misma función que usa el flujo de campañas
// (foto de la biblioteca del negocio primero, plantillas de marca si no hay; nunca una imagen nueva con IA). No usa modelo ni cobra.
import { AgentError } from "../access";
import { designAssets, designSummary } from "../content-steps";
import type { StepResult } from "../queue";
import { Copy } from "../schema";
import type { AgentInput } from "./types";

/** The library ids a stored design output used (`mediaSelection.libraryItems`); anything unreadable is skipped. */
export function libraryIdsOf(output: unknown): string[] {
  try {
    const items = (output as { mediaSelection?: { libraryItems?: unknown } } | null)
      ?.mediaSelection?.libraryItems;
    if (!Array.isArray(items)) return [];
    return items.flatMap((i) =>
      typeof i?.id === "string" && i.id ? [i.id] : [],
    );
  } catch {
    return [];
  }
}

/** The `design` step of a piece, and each of its rework rounds (`design-r<n>`). */
export async function runDesign(input: AgentInput): Promise<StepResult> {
  if (!/^design(-r\d+)?$/.test(input.step.id))
    throw new AgentError("Agente no disponible.");
  const readStep = input.tools.use("readStepOutput");
  // The latest copy (a rework may have rewritten it).
  const copy = Copy.safeParse(await readStep("copy"));
  if (!copy.success) throw new AgentError("Falta completar el paso anterior.");
  // What this piece's earlier design used: a rework may use that photo again even though it counts as used today.
  const reuse = libraryIdsOf(await readStep("design"));
  const { assets, mediaSelection } = await designAssets({
    run: input.run,
    copy: copy.data,
    language: input.language,
    reuse,
  });
  return {
    data: {
      assets,
      mediaSelection,
      summary: designSummary(mediaSelection.libraryItems.length > 0, input.language),
    },
  };
}
