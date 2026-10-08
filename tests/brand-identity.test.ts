import { describe, expect, it } from "vitest";
import { brandSlogan, fromAiIdentity, fromAiProposals, identityPrompt, IdentitySchema, ProposalsSchema } from "@/lib/brand-identity";
import {
  applyProposal,
  emptyIdentity,
  fillEmpty,
  hasIdentity,
  identityFromForm,
  mergeFromBook,
  readBrandIdentity,
  seedNever,
  withSeeds,
} from "@/lib/brand-identity-shape";
import { reviewReplyPrompt } from "@/lib/ai";

const proposal = {
  id: "x-1",
  name: "Confianza industrial",
  palette: ["#BB1111", "#1f2937", "#f59e0b"],
  paletteWhy: "Rojo de la marca con gris acero.",
  fontHeading: "oswald",
  fontBody: "roboto",
  slogan: { es: "Seguridad que abre puertas", en: "Security that opens doors" },
  voice: "Directa y experta. Trata de usted.",
  music: "enérgica, moderna",
  headline: "Tu negocio, protegido",
};

describe("readBrandIdentity", () => {
  it("returns an empty identity for anything that isn't an object", () => {
    for (const raw of [null, undefined, "x", 3, [], true]) expect(readBrandIdentity(raw)).toEqual(emptyIdentity());
  });

  it("tolerates broken fields and keeps the good ones", () => {
    const r = readBrandIdentity({
      slogan: "Solo español",
      tagline: { es: 5, en: "  What   we do  " },
      messages: [{ text: { es: "Garantía de 24 meses" }, why: "Da confianza" }, null, { text: {} }, "x", { es: "Directo", en: "Direct" }],
      voice: { summary: 3, personality: "cercana, experta, cercana", do: ["Hablar claro", "", 4], dont: null, useWords: "taller propio\nManagua", avoidWords: [] },
      music: { moods: ["alegre"], bpmMin: "130", bpmMax: 90, energy: "loud", searchTerms: "upbeat corporate" },
      proposals: [proposal, { ...proposal }, { name: "Sin colores", palette: ["red"] }, { ...proposal, id: "x-2", fontHeading: "comic-sans", fontBody: "IBM Plex Sans", palette: ["#000000"] }],
      chosenProposal: "nope",
      source: "robot",
      updatedAt: 7,
    });
    expect(r.slogan).toEqual({ es: "Solo español", en: "" });
    expect(r.tagline).toEqual({ es: "", en: "What we do" });
    expect(r.messages).toEqual([
      { text: { es: "Garantía de 24 meses", en: "" }, why: "Da confianza" },
      { text: { es: "Directo", en: "Direct" }, why: "" },
    ]);
    expect(r.voice.personality).toEqual(["cercana", "experta"]);
    expect(r.voice.do).toEqual(["Hablar claro"]);
    expect(r.voice.dont).toEqual([]);
    expect(r.voice.useWords).toEqual(["taller propio", "Managua"]);
    expect(r.music.bpmMin).toBe(90);
    expect(r.music.bpmMax).toBe(130);
    expect(r.music.energy).toBe("");
    expect(r.music.searchTerms).toEqual(["upbeat corporate"]);
    // Repetidas y sin colores fuera; letras desconocidas pasan a una conocida; colores que faltan copian al anterior.
    expect(r.proposals.map((p) => p.id)).toEqual(["x-1", "x-2"]);
    expect(r.proposals[0].palette).toEqual(["#bb1111", "#1f2937", "#f59e0b"]);
    expect(r.proposals[1].fontHeading).toBe("montserrat");
    expect(r.proposals[1].fontBody).toBe("ibm-plex-sans");
    expect(r.proposals[1].palette).toEqual(["#000000", "#000000", "#000000"]);
    expect(r.chosenProposal).toBe("");
    expect(r.source).toBe("");
    expect(r.updatedAt).toBe("");
  });

  it("caps messages at 6 and proposals at 3", () => {
    const r = readBrandIdentity({
      messages: Array.from({ length: 9 }, (_, i) => ({ text: { es: `m${i}` } })),
      proposals: Array.from({ length: 5 }, (_, i) => ({ ...proposal, id: `p${i}` })),
    });
    expect(r.messages).toHaveLength(6);
    expect(r.proposals).toHaveLength(3);
  });
});

describe("applyProposal", () => {
  it("moves colors and fonts to the brand and slogan, voice and music to the identity", () => {
    const cur = readBrandIdentity({
      slogan: { es: "Viejo", en: "Old" },
      messages: [{ text: { es: "Mensaje propio" } }],
      voice: { summary: "Antes", dont: ["Prometer precios"] },
      music: { moods: ["tranquila"], genres: ["acústica"] },
      proposals: [proposal],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const { identity, kit } = applyProposal(cur, cur.proposals[0], "2026-10-08T00:00:00.000Z");
    expect(kit).toEqual({ color: "#bb1111", color2: "#1f2937", color3: "#f59e0b", fontHeading: "oswald", fontBody: "Roboto" });
    expect(identity.slogan).toEqual(proposal.slogan);
    expect(identity.voice.summary).toBe(proposal.voice);
    expect(identity.voice.dont).toEqual(["Prometer precios"]);
    expect(identity.music.moods).toEqual(["enérgica", "moderna"]);
    expect(identity.music.genres).toEqual(["acústica"]);
    expect(identity.messages).toEqual(cur.messages);
    expect(identity.chosenProposal).toBe("x-1");
    expect(identity.source).toBe("ai");
    expect(identity.appliedAt).toBe("2026-10-08T00:00:00.000Z");
    // Lo guardado se vuelve a leer igual.
    expect(readBrandIdentity(JSON.parse(JSON.stringify(identity)))).toEqual(identity);
  });

  it("keeps the book as the source", () => {
    const cur = readBrandIdentity({ source: "book", proposals: [proposal] });
    expect(applyProposal(cur, cur.proposals[0]).identity.source).toBe("book");
  });
});

describe("fillEmpty and mergeFromBook", () => {
  const mine = readBrandIdentity({
    slogan: { es: "Mi eslogan" },
    voice: { do: ["Hablar de usted"] },
    music: { bpmMin: 100 },
    proposals: [proposal],
    chosenProposal: "x-1",
    source: "manual",
  });
  const ai = fromAiIdentity(
    {
      slogan: { es: "Otro", en: "Other" },
      tagline: { es: "Cortinas metálicas", en: "Roll-up doors" },
      messages: [{ text: { es: "Garantía", en: "Warranty" }, why: "Confianza" }],
      voiceSummary: "Cercana",
      voiceDo: ["Usar tú"],
      voiceDont: ["Prometer precios"],
      bpmMin: 80,
      bpmMax: 110,
      energy: "high",
      musicSearch: ["upbeat corporate"],
      photoStyle: "Trabajos reales",
    },
    "ai",
  );

  it("fills only what is empty", () => {
    const r = fillEmpty(mine, ai);
    expect(r.slogan).toEqual({ es: "Mi eslogan", en: "Other" });
    expect(r.tagline).toEqual(ai.tagline);
    expect(r.messages).toEqual(ai.messages);
    expect(r.voice.do).toEqual(["Hablar de usted"]);
    expect(r.voice.dont).toEqual(["Prometer precios"]);
    expect(r.voice.summary).toBe("Cercana");
    // Un ritmo a medias del dueño no se mezcla con el de la IA.
    expect(r.music.bpmMin).toBe(100);
    expect(r.music.bpmMax).toBeNull();
    expect(r.music.energy).toBe("high");
    expect(r.photoStyle).toBe("Trabajos reales");
    expect(r.proposals).toEqual(mine.proposals);
    expect(r.chosenProposal).toBe("x-1");
    expect(r.source).toBe("manual");
  });

  it("lets the book replace what it brings and keeps the rest", () => {
    const book = fromAiIdentity({ slogan: { es: "Del manual", en: "" }, voiceDo: [], photoStyle: "Fotos del manual" }, "book");
    const r = mergeFromBook(mine, book);
    expect(r.slogan).toEqual({ es: "Del manual", en: "" });
    expect(r.voice.do).toEqual(["Hablar de usted"]);
    expect(r.photoStyle).toBe("Fotos del manual");
    expect(r.music.bpmMin).toBe(100);
    expect(r.proposals).toEqual(mine.proposals);
    expect(r.source).toBe("book");
  });

  it("ignores impossible tempos from the AI", () => {
    expect(fromAiIdentity({ bpmMin: 0, bpmMax: 999 }, "ai").music).toMatchObject({ bpmMin: null, bpmMax: null });
  });
});

describe("identityPrompt", () => {
  it("is empty without an identity", () => {
    expect(identityPrompt({})).toBe("");
    expect(identityPrompt({ brandIdentity: { proposals: [proposal] } })).toBe("");
  });

  it("lists slogan, messages, voice and words", () => {
    const text = identityPrompt({
      brandIdentity: {
        slogan: { es: "Seguridad que abre puertas", en: "Security that opens doors" },
        messages: [{ text: { es: "Garantía de 24 meses por escrito" } }, { text: { es: "Taller propio en Managua" } }],
        voice: { summary: "Directa y experta", personality: ["confiable"], do: ["Tratar de usted"], dont: ["Prometer precios"], useWords: ["a la medida"], avoidWords: ["barato"] },
        music: { moods: ["enérgica"] },
      },
    });
    expect(text).toContain("<brand_identity>");
    expect(text).toContain("Seguridad que abre puertas / Security that opens doors");
    expect(text).toContain("- Garantía de 24 meses por escrito");
    expect(text).toContain("Voice: Directa y experta");
    expect(text).toContain("Do: Tratar de usted");
    expect(text).toContain("Don't: Prometer precios");
    expect(text).toContain("Words to use: a la medida");
    expect(text).toContain("Never use these words: barato");
    // La música es para videos, no para los textos.
    expect(text).not.toContain("enérgica");
  });

  it("reaches the text prompts next to the brand voice", () => {
    const business = { name: "Fameseg", website: "", aiProfile: "Cortinas metálicas", brandVoice: "Cercana", brandIdentity: { slogan: { es: "Abre puertas" } } };
    const { system } = reviewReplyPrompt(business, { name: "Ana", rating: 5, text: "Muy bien", originalText: "", language: "es", timeAgo: "" }, "es");
    expect(system).toContain("<brand_voice>");
    expect(system).toContain("Slogan (use it only where it fits naturally, never in every post): Abre puertas");
    const without = reviewReplyPrompt({ ...business, brandIdentity: undefined }, { name: "Ana", rating: 5, text: "Muy bien", originalText: "", language: "es", timeAgo: "" }, "es");
    expect(without.system).not.toContain("brand_identity");
  });

  it("gives the slogan for designs in the asked language", () => {
    const b = { brandIdentity: { slogan: { es: "Abre puertas", en: "" } } };
    expect(brandSlogan(b, "es")).toBe("Abre puertas");
    expect(brandSlogan(b, "en")).toBe("Abre puertas");
    expect(brandSlogan({}, "es")).toBe("");
  });
});

describe("seeds and the form", () => {
  it("takes the forbidden things from the business profile", () => {
    const profile = "Fabricamos cortinas metálicas.\n- Nunca prometer precios por teléfono.\n- No usar la palabra \"barato\" ni 'económico'.\nAtendemos en Managua.";
    expect(seedNever(profile)).toEqual(["Nunca prometer precios por teléfono.", "barato", "económico"]);
    expect(seedNever("Fabricamos cortinas.")).toEqual([]);
  });

  it("seeds only an identity that was never saved", () => {
    const fresh = withSeeds(emptyIdentity(), { aiProfile: "Nunca decir \"gratis\".", avoid: ["Dar precios exactos"] });
    expect(fresh.voice.avoidWords).toEqual(["gratis"]);
    expect(fresh.voice.dont).toEqual(["Dar precios exactos"]);
    const saved = withSeeds({ ...emptyIdentity(), updatedAt: "2026-10-01T00:00:00.000Z" }, { aiProfile: "Nunca decir \"gratis\"." });
    expect(saved.voice.avoidWords).toEqual([]);
  });

  it("reads the form and keeps the proposals", () => {
    const cur = readBrandIdentity({ proposals: [proposal], chosenProposal: "x-1", appliedAt: "a" });
    const form: Record<string, string> = {
      slogan_es: "Abre puertas",
      msg_es_0: "Garantía",
      msg_why_0: "Confianza",
      msg_es_2: "Taller propio",
      voice_do: "Hablar claro, sin rodeos\nTratar de usted",
      avoid_words: "barato, gratis",
      bpm_min: "95",
      bpm_max: "",
      energy: "medium",
    };
    const r = identityFromForm((k) => form[k] ?? "", cur, "2026-10-08T00:00:00.000Z");
    expect(r.slogan).toEqual({ es: "Abre puertas", en: "" });
    expect(r.messages.map((m) => m.text.es)).toEqual(["Garantía", "Taller propio"]);
    expect(r.voice.do).toEqual(["Hablar claro, sin rodeos", "Tratar de usted"]);
    expect(r.voice.avoidWords).toEqual(["barato", "gratis"]);
    expect(r.music).toMatchObject({ bpmMin: 95, bpmMax: null, energy: "medium" });
    expect(r.proposals).toEqual(cur.proposals);
    expect(r.chosenProposal).toBe("x-1");
    expect(r.source).toBe("manual");
    expect(r.updatedAt).toBe("2026-10-08T00:00:00.000Z");
    expect(hasIdentity(identityFromForm(() => "", emptyIdentity()))).toBe(false);
  });
});

describe("AI schemas", () => {
  it("turn AI proposals into clean, numbered proposals", () => {
    const a = ProposalsSchema.parse({ proposals: [proposal, { ...proposal, palette: ["nope"] }, { ...proposal, name: "Cálida" }], summary: "" });
    const list = fromAiProposals(a, "s");
    expect(list.map((p) => p.id)).toEqual(["s-1", "s-3"]);
    expect(list[1].name).toBe("Cálida");
  });

  it("export JSON schemas the AI can follow", () => {
    expect(() => IdentitySchema.toJSONSchema()).not.toThrow();
    expect(() => ProposalsSchema.toJSONSchema()).not.toThrow();
  });
});
