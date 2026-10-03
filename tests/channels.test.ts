import { describe, expect, it } from "vitest";
import { isBlocked, notesFor, seoDescription, smsBody, smsSegments } from "@/lib/channels";

const draft = { text: "Hola", subject: "", seoTitle: "", mediaType: "none" as const };

describe("reglas por canal", () => {
  it("TikTok exige video", () => {
    expect(isBlocked("tiktok", draft)).toBe(true);
    expect(isBlocked("tiktok", { ...draft, mediaType: "video" })).toBe(false);
  });
  it("Instagram exige foto o video", () => {
    expect(isBlocked("instagram", draft)).toBe(true);
    expect(isBlocked("instagram", { ...draft, mediaType: "photo" })).toBe(false);
  });
  it("Email exige asunto y SEO exige título", () => {
    expect(isBlocked("email", draft)).toBe(true);
    expect(isBlocked("email", { ...draft, subject: "Oferta" })).toBe(false);
    expect(isBlocked("seo", { ...draft, seoTitle: "Título" })).toBe(false);
  });
  it("Facebook bloquea texto vacío", () => {
    expect(isBlocked("facebook", { ...draft, text: "  " })).toBe(true);
    expect(isBlocked("facebook", draft)).toBe(false);
  });
  it("Google bloquea textos de más de 1500", () => {
    expect(isBlocked("google", { ...draft, text: "a".repeat(1501) })).toBe(true);
  });
  it("SMS largo avisa pero no bloquea", () => {
    const d = { ...draft, text: "a".repeat(200) };
    expect(isBlocked("sms", d)).toBe(false);
    expect(notesFor("sms", d).some((n) => n.text.includes("mensajes de texto"))).toBe(true);
  });
});

describe("SMS", () => {
  it("cuenta segmentos GSM y Unicode", () => {
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("😀".repeat(10))).toBe(1);
    expect(smsSegments("😀" + "a".repeat(80))).toBe(2);
  });
  it("agrega la instrucción para darse de baja", () => {
    expect(smsBody("Hola ")).toBe("Hola\nResponde STOP para no recibir más.");
  });
});

describe("SEO", () => {
  it("recorta la descripción a 155", () => {
    expect(seoDescription("a".repeat(300)).length).toBe(155);
    expect(seoDescription("corto")).toBe("corto");
  });
});
