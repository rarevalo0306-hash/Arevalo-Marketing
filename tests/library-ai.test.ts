import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { aiLibraryData, filterWhere, LIBRARY_FILTERS } from "@/lib/library";
import { rankLibrary, usedToday, type MatchItem } from "@/lib/library-match";
import { variantPrompt } from "@/lib/imagegen";

const now = new Date("2026-10-13T15:00:00Z");

function photo(id: string, lastUsedAt: Date | null): MatchItem {
  return {
    id,
    kind: "photo",
    url: `/media/${id}.jpg`,
    status: "ready",
    usable: true,
    quality: 4,
    privacy: [],
    choice: "",
    tags: ["techo", "tormenta"],
    folderPath: "",
    description: { es: "Techo después de la tormenta", en: "Roof after the storm", scene: "after", topics: ["techo", "tormenta"] },
    width: 1080,
    height: 1080,
    usedCount: lastUsedAt ? 1 : 0,
    lastUsedAt,
  };
}

describe("lo que crea la IA queda en la biblioteca", () => {
  it("con lo necesario para encontrarlo y volver a usarlo", () => {
    const d = aiLibraryData("biz1", "https://x.supabase.co/media/biz1/techo-miami-abc.png", { kind: "photo", title: "Revisa tu techo", prompt: "A roof after a storm", keywords: ["Techo", "techo", "Miami"] }, now);
    expect(d).toMatchObject({
      businessId: "biz1",
      source: "ai",
      externalId: "ai:https://x.supabase.co/media/biz1/techo-miami-abc.png",
      name: "Revisa tu techo",
      folderPath: "IA",
      mimeType: "image/png",
      kind: "photo",
      status: "ready",
      quality: 4,
      usable: true,
      privacy: [],
      tags: ["techo", "miami"],
      usedCount: 1,
      lastUsedAt: now,
      description: { es: "Revisa tu techo", en: "A roof after a storm", scene: "other", topics: ["techo", "miami"] },
    });
  });

  it("si todavía no va en una publicación, no cuenta como usada; las versiones dicen de dónde salieron", () => {
    const d = aiLibraryData("biz1", "https://x/v.jpg", { kind: "photo", used: false, parentId: "p1" }, now);
    expect(d).toMatchObject({ usedCount: 0, lastUsedAt: null, folderPath: "IA / variantes", name: "Foto con IA", mimeType: "image/jpeg" });
    expect(aiLibraryData("biz1", "https://x/v.mp4", { kind: "video", thumbUrl: "https://x/t.jpg" }, now)).toMatchObject({ kind: "video", mimeType: "video/mp4", thumbUrl: "https://x/t.jpg", name: "Video con IA" });
  });

  it("tienen su propio filtro en la página", () => {
    expect(LIBRARY_FILTERS).toContain("ia");
    expect(filterWhere("biz1", "ia")).toEqual({ businessId: "biz1", status: { not: "gone" }, source: "ai" });
  });
});

describe("no se repite la misma foto el mismo día", () => {
  it("una foto usada en las últimas 24 horas no se elige", () => {
    const hoy = photo("hoy", new Date(now.getTime() - 3 * 3600000));
    const ayer = photo("ayer", new Date(now.getTime() - 30 * 3600000));
    expect(usedToday(hoy, now)).toBe(true);
    expect(usedToday(ayer, now)).toBe(false);
    expect(usedToday(photo("nunca", null), now)).toBe(false);
    const q = { text: "Revisa tu techo después de la tormenta", keywords: ["techo"] };
    expect(rankLibrary([hoy, ayer], q, now)?.id).toBe("ayer");
    // Si la única que va con el tema ya se usó hoy, mejor ninguna (la IA crea otra).
    expect(rankLibrary([hoy], q, now)).toBeNull();
  });
});

describe("otra versión de una foto", () => {
  it("pide otro ángulo y momento, sin letras ni logos", () => {
    expect(variantPrompt()).toMatch(/different camera angle/);
    expect(variantPrompt()).toMatch(/no text, letters/i);
  });
});
