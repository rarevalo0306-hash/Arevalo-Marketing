// Lo que cuesta un artículo para la web y lo que se le dice al dueño: la cuenta es la misma de «Que la IA mejore mis posiciones».
import { describe, expect, it } from "vitest";
import {
  articleApprovalText,
  articleCharge,
  articleKeyword,
  articleReserve,
  articleUpTo,
  articleWrittenText,
} from "@/lib/agent/article-cost";
import type { Piece } from "@/lib/agent/plan";
import { writeAiCents } from "@/lib/rankfix-shape";
import { SITE_TEXT_CENTS } from "@/lib/seo/site-article";
import { WRITER_SERP_COST } from "@/lib/seo/writer";

const piece = (extra: Partial<Piece> = {}): Piece => ({
  id: "p1",
  topic: "Reparación de techos en Miami",
  objective: "",
  channels: ["seo"],
  format: "articulo",
  keyword: "",
  ...extra,
});

describe("la búsqueda del artículo", () => {
  it("es la palabra clave de la pieza, o su tema cuando no tiene", () => {
    expect(articleKeyword(piece({ keyword: "reparación de techos" }))).toBe("reparación de techos");
    expect(articleKeyword(piece({ keyword: "   " }))).toBe("Reparación de techos en Miami");
    expect(articleKeyword(piece())).toBe("Reparación de techos en Miami");
  });
});

describe("lo que se reserva y lo que se cobra", () => {
  it("se reserva Google más la IA, hasta el centavo siguiente; con la traducción es el «hasta» que ve el dueño", () => {
    for (const provider of ["gemini", "openai", "claude"]) {
      expect(articleReserve(provider)).toBe(Math.ceil(WRITER_SERP_COST * 100 + writeAiCents(provider)));
      expect(articleUpTo(provider)).toBe(articleReserve(provider) + SITE_TEXT_CENTS);
    }
    // An AI nobody knows is counted as the dearest one.
    expect(articleReserve("otra")).toBe(articleReserve("claude"));
    expect(articleReserve(null)).toBe(articleReserve("claude"));
    expect(articleReserve("claude")).toBeGreaterThan(articleReserve("gemini"));
  });

  it("se cobra lo que cobró Google de verdad más la IA al precio anunciado, nunca más de lo reservado", () => {
    const reserved = articleReserve("gemini");
    expect(articleCharge(0.002, "gemini", reserved)).toBe(Math.min(reserved, 1 + writeAiCents("gemini")));
    expect(articleCharge(0.002, "gemini", reserved)).toBe(reserved);
    // Google cost nothing: only the AI.
    expect(articleCharge(0, "gemini", reserved)).toBe(writeAiCents("gemini"));
    // Google cost far more than announced: still no more than what was reserved (finishStep would block the work).
    expect(articleCharge(5, "gemini", reserved)).toBe(reserved);
    // A smaller reservation caps it, and nothing is ever negative or not a number.
    expect(articleCharge(0.002, "gemini", 2)).toBe(2);
    expect(articleCharge(0.002, "gemini", 0)).toBe(0);
    expect(articleCharge(Number.NaN, "gemini", reserved)).toBe(writeAiCents("gemini"));
    expect(articleCharge(-1, "gemini", reserved)).toBeLessThanOrEqual(reserved);
    expect(Number.isSafeInteger(articleCharge(0.0021, "claude", 99))).toBe(true);
  });
});

describe("lo que lee el dueño", () => {
  it("el estimado dice la búsqueda, el «hasta» y que la foto con IA se pide aparte", () => {
    const es = articleApprovalText("reparación de techos", "gemini", "es", false);
    expect(es).toContain("«reparación de techos»");
    expect(es).toMatch(/Costará hasta US\$0\.\d\d: la búsqueda en Google \(US\$0\.002\)/);
    expect(es).toContain("la foto con IA se te pedirá aparte");
    expect(es.endsWith("Apruébalo para empezar.")).toBe(true);
    const en = articleApprovalText("roof repair", "gemini", "en", false);
    expect(en).toContain('"roof repair"');
    expect(en).toMatch(/It will cost up to US\$0\.\d\d: the Google search \(US\$0\.002\)/);
    expect(en.endsWith("Approve it to start.")).toBe(true);
  });

  it("una vuelta de corrección avisa que es otro borrador de pago", () => {
    expect(articleApprovalText("x y", "claude", "es", true)).toContain("La revisión devolvió el artículo «x y»");
    expect(articleApprovalText("x y", "claude", "en", true)).toContain('The review sent the article "x y" back');
    expect(articleApprovalText("x y", "claude", "es", false)).not.toContain("devolvió");
  });

  it("el aviso de que quedó escrito lleva el puntaje y lo que costó Google", () => {
    expect(articleWrittenText("techos", 82, 0.002, "es")).toBe("Escribí el artículo «techos»: sacó 82/100. Costo de Google: US$0.002. Ahora pasa a la revisión editorial.");
    expect(articleWrittenText("roofs", 82, 0.002, "en")).toContain("it scored 82/100");
  });
});
