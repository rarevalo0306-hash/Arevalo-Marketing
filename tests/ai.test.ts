import { afterEach, describe, expect, it, vi } from "vitest";
import { toPostFields, writeSeoArticle } from "@/lib/ai";
import { localToUtc } from "@/lib/time";

describe("localToUtc", () => {
  it("convierte hora de Miami en verano (UTC-4)", () => {
    expect(localToUtc("2026-07-01", 0, "09:30", "America/New_York").toISOString()).toBe("2026-07-01T13:30:00.000Z");
  });
  it("convierte hora de Miami en invierno (UTC-5) y suma días", () => {
    expect(localToUtc("2026-12-30", 3, "18:00", "America/New_York").toISOString()).toBe("2027-01-02T23:00:00.000Z");
  });
  it("usa 10:00 si la hora no es válida", () => {
    expect(localToUtc("2026-07-01", 0, "mañana", "America/New_York").toISOString()).toBe("2026-07-01T14:00:00.000Z");
  });
});

describe("toPostFields", () => {
  it("reparte la respuesta de la IA por canal", () => {
    const f = toPostFields({
      facebook: "fb", instagram: "ig", tiktok: "tt", google: "g", sms: "s",
      emailSubject: "asunto", email: "cuerpo", seoTitle: "titulo", imageHeadline: "Titular", imageSteps: [], imageIdea: "a house",
    });
    expect(f.text).toBe("fb");
    expect(f.subject).toBe("asunto");
    expect(f.seoTitle).toBe("titulo");
    expect(f.variants).toMatchObject({ instagram: "ig", sms: "s", email: "cuerpo", seo: "fb" });
  });
});

describe("writeSeoArticle: las notas del dueño", () => {
  const brief = { zone: "Miami,Florida,United States", wordCount: 900, headings: [], questions: [], terms: [], relatedSearches: [], competitors: [], serpTitles: [], localPack: false, aiOverview: false };
  const reply = { title: "t", metaDescription: "m", slug: "s", h1: "h", outline: [], markdown: "texto", socialPost: "p" };
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  /** What the AI is sent as the user's message for a draft with (or without) the owner's notes. */
  async function sent(notes?: string[]) {
    vi.stubEnv("GEMINI_API_KEY", "synthetic-no-provider-access");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const business = { name: "Techos Miami", website: "https://mio.com", aiProfile: "Reparamos techos.", aiText: "gemini" };
    await writeSeoArticle({ business, keyword: "reparación de techos", language: "es", brief, ...(notes ? { notes } : {}) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { contents: { parts: { text: string }[] }[] };
    return body.contents[0].parts[0].text;
  }

  it("sin notas el mensaje es el de siempre", async () => {
    const user = await sent();
    expect(user).not.toContain("owner_notes");
    expect(user.endsWith("\n\nWrite the article.")).toBe(true);
    expect(await sent([])).toBe(user);
  });

  it("con notas, van en un bloque propio antes de pedir el artículo, como comentarios y no como hechos", async () => {
    const user = await sent(["Menciona el seguro de inundación", "Habla de las tormentas"]);
    expect(user).toContain("<owner_notes>\n- Menciona el seguro de inundación\n- Habla de las tormentas\n</owner_notes>");
    expect(user).toContain("they add no facts about the business");
    expect(user.indexOf("<owner_notes>")).toBeLessThan(user.indexOf("Write the article."));
    expect(user.endsWith("\n\nWrite the article.")).toBe(true);
  });
});
