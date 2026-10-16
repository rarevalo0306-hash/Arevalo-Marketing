import { MIN_RELEVANCE } from "@/lib/library-match";
import { ensureStoredCopy } from "@/lib/library-files";
import { suggestMedia, loadVideoMedia } from "@/lib/video-jobs";

/**
 * The business's own photos and clips that fit an idea, library first. Shared by the
 * campaign steps and the team's `listLibrary` tool. `reuse`: what this same piece already uses.
 */
export async function libraryMedia(
  businessId: string,
  idea: string,
  language: "es" | "en",
  kind?: "photo",
  reuse: string[] = [],
) {
  const ids = await suggestMedia(businessId, idea, "vertical", [], kind ? 1 : 6, {
    kind,
    minRelevance: MIN_RELEVANCE,
    reuse,
  });
  // Recheck the current library choices, privacy flags and company before use.
  const media = await loadVideoMedia(businessId, ids, language);
  // Saved storyboards require URLs; materialize only the selected Drive clips.
  for (const item of media)
    if (item.kind === "video" && !item.url)
      item.url = await ensureStoredCopy(item.id);
  return media;
}
