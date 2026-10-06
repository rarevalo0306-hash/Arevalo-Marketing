import { describe, expect, it } from "vitest";
import {
  cleanQuestions,
  computeScores,
  domainOf,
  mentionMatcher,
  nameVariants,
  normalizeText,
  positionOf,
  rankCompetitors,
  rankDomains,
  readVisibilityReport,
  sourceDomain,
  errorKind,
  explainError,
  isRetryableError,
  mapLimit,
  PROVIDER_CONCURRENCY,
  providerErrors,
  RETRY_WAITS_MS,
  withRetry,
  applyMentionClasses,
  quoteAround,
  quoteInText,
  sentimentText,
  summarizeSentiment,
  type VisibilityResult,
} from "@/lib/seo/visibility";
import fameseg from "./fixtures/fameseg.json";

const biz = { name: "Arévalo Public Adjusters, LLC", website: "https://www.arevalopa.com/" };
const m = mentionMatcher(biz);

describe("mention detection", () => {
  it("normalizes accents, case and punctuation", () => {
    expect(normalizeText("ARÉVALO & Co., L.L.C.")).toBe("arevalo and co l l c");
    expect(nameVariants("The Roof Doctors Inc.")).toEqual(["the roof doctors inc", "roof doctors"]);
  });

  it("finds the name without accents or in other case", () => {
    expect(m.inText("Te recomiendo AREVALO PUBLIC ADJUSTERS en Hialeah.")).toBe(true);
    expect(m.inText("Try arévalo public adjusters.")).toBe(true);
  });

  it("finds the name without the LLC suffix or with it", () => {
    expect(m.inText("1. Arevalo Public Adjusters — bilingual team")).toBe(true);
    expect(m.inText("Arevalo Public Adjusters LLC is in Miami")).toBe(true);
  });

  it("ignores a leading 'The'", () => {
    const roof = mentionMatcher({ name: "The Roof Doctors Inc", website: "" });
    expect(roof.inText("Call Roof Doctors in Doral.")).toBe(true);
  });

  it("finds the website domain in the text and in the sources", () => {
    expect(domainOf("www.arevalopa.com/contact")).toBe("arevalopa.com");
    expect(m.inText("See arevalopa.com for details.")).toBe(true);
    expect(m.inSources([{ url: "https://blog.arevalopa.com/post", title: "" }])).toBe(true);
    // Gemini: enlace de redirección de Google con el dominio en el título.
    const gemini = { url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "arevalopa.com" };
    expect(sourceDomain(gemini)).toBe("arevalopa.com");
    expect(m.inSources([gemini])).toBe(true);
    // El nombre en la dirección de una página de directorio.
    expect(m.inSources([{ url: "https://www.yelp.com/biz/arevalo-public-adjusters-miami", title: "Yelp" }])).toBe(true);
  });

  it("does not match a partial word or a look-alike domain", () => {
    const short = mentionMatcher({ name: "Ajuste Pro", website: "ajustepro.com" });
    expect(short.inText("Ajuste Profesional de Reclamos es una opción")).toBe(false);
    expect(short.inText("Visit notajustepro.com")).toBe(false);
    expect(short.inSources([{ url: "https://ajustepro.com.evil.net/", title: "" }])).toBe(false);
    expect(m.inText("Other Arevalo Public Adjustersmiami firm")).toBe(false);
    expect(m.inText("Los ajustadores públicos de Miami")).toBe(false);
  });

  it("finds the position in the list of named businesses", () => {
    expect(positionOf(["Storm Claims Co", "Arevalo Public Adjusters", "Other PA"], m)).toBe(2);
    expect(positionOf(["Storm Claims Co"], m)).toBeNull();
  });
});

describe("scores", () => {
  it("computes the overall and per-AI score without counting errors", () => {
    const r = computeScores([
      { provider: "gemini", mentioned: true },
      { provider: "gemini", mentioned: false },
      { provider: "claude", mentioned: true },
      { provider: "claude", mentioned: false, error: "timeout" },
      { provider: "openai", mentioned: false },
    ]);
    expect(r.score).toBe(50);
    expect(r.byProvider.gemini).toEqual({ score: 50, mentioned: 1, total: 2, errors: 0 });
    expect(r.byProvider.claude).toEqual({ score: 100, mentioned: 1, total: 1, errors: 1 });
    expect(r.byProvider.openai?.score).toBe(0);
  });

  it("returns null when every answer failed", () => {
    expect(computeScores([{ provider: "gemini", mentioned: false, error: "x" }]).score).toBeNull();
  });

  it("ranks competitors and cited websites by number of answers", () => {
    const top = rankCompetitors([{ competitors: ["Storm Claims Co", "Other PA"] }, { competitors: ["Storm Claims Co LLC", "storm claims co"] }]);
    expect(top[0]).toEqual({ name: "Storm Claims Co", count: 2 });
    const domains = rankDomains(
      [{ sources: [{ url: "https://www.yelp.com/a", title: "" }, { url: "https://arevalopa.com", title: "" }] }, { sources: [{ url: "https://yelp.com/b", title: "" }] }],
      biz.website,
    );
    expect(domains).toEqual([{ domain: "yelp.com", count: 2 }]);
  });
});

describe("questions and saved reports", () => {
  it("cleans the owner's questions", () => {
    expect(cleanQuestions([" a ", "", "A", "b", "c", "d", "e", "f", "x".repeat(300)])).toEqual(["a", "b", "c", "d", "e"]);
    expect(cleanQuestions(["x".repeat(300)])[0]).toHaveLength(200);
  });

  it("reads old or broken reports without failing", () => {
    expect(readVisibilityReport(null)).toBeNull();
    expect(readVisibilityReport({ score: 3 })).toBeNull();
    const r = readVisibilityReport({ results: [{ question: "q", provider: "gemini", mentioned: true }, { provider: "nope" }], recommendations: ["Pide reseñas"] });
    expect(r?.results).toHaveLength(1);
    expect(r?.score).toBe(100);
    expect(r?.questions).toEqual(["q"]);
    expect(r?.recommendations).toEqual([{ title: "Pide reseñas", detail: "" }]);
  });
});

describe("errores de las IAs en palabras simples (Fameseg: Gemini llegó a su límite en las 5 preguntas)", () => {
  const GEMINI_LIMIT = "Gemini llegó a su límite por ahora. Espera un minuto o activa la facturación en Google AI Studio.";

  it("reconoce el tipo de error en español o inglés", () => {
    expect(errorKind(GEMINI_LIMIT)).toBe("limit");
    expect(errorKind("Gemini has hit its limit for now. Wait a minute or turn on billing in Google AI Studio.")).toBe("limit");
    expect(errorKind("ChatGPT llegó a su límite o tu cuenta de OpenAI no tiene saldo (platform.openai.com/settings/organization/billing).")).toBe("limit");
    expect(errorKind("Gemini está muy ocupado en este momento. Intenta de nuevo en un minuto.")).toBe("busy");
    expect(errorKind("Claude (Anthropic) tardó demasiado en contestar (más de 60 s).")).toBe("timeout");
    expect(errorKind("OpenAI rechazó la clave (OPENAI_API_KEY).")).toBe("key");
    expect(errorKind("algo raro")).toBe("other");
    expect(isRetryableError(GEMINI_LIMIT)).toBe(true);
    expect(isRetryableError("OpenAI rechazó la clave (OPENAI_API_KEY).")).toBe(false);
  });

  it("explica el límite de Gemini con qué hacer", () => {
    expect(explainError("gemini", GEMINI_LIMIT).es).toBe(
      "Gemini llegó a su límite gratis de preguntas por minuto. Vuelve a intentar en un rato o activa la facturación en Google AI Studio.",
    );
    expect(explainError("claude", "nada que ver")).toEqual({ es: "nada que ver", en: "nada que ver" });
  });

  it("resume los errores por IA con el reporte de Fameseg", () => {
    const report = readVisibilityReport(fameseg.reports.ai.data)!;
    const errors = providerErrors(report.results);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ provider: "gemini", failed: 5, total: 5, kind: "limit" });
    expect(errors[0].reason.en).toContain("free per-minute limit");
    // Gemini sin respuestas no cuenta como 0 %: el puntaje es solo de ChatGPT.
    expect(report.byProvider.gemini?.score).toBeNull();
    expect(report.byProvider.openai).toEqual({ score: 80, mentioned: 4, total: 5, errors: 0 });
    expect(report.score).toBe(80);
  });

  it("a Gemini se le pregunta de a una", () => {
    expect(PROVIDER_CONCURRENCY.gemini).toBe(1);
    expect(RETRY_WAITS_MS).toEqual([8000, 20000]);
  });
});

describe("withRetry", () => {
  const clock = () => {
    let t = 0;
    const waits: number[] = [];
    return { now: () => t, sleep: async (ms: number) => void (waits.push(ms), (t += ms)), waits };
  };
  const limit = new Error("Gemini llegó a su límite por ahora.");

  it("reintenta 2 veces con 8 s y 20 s si la IA llegó a su límite", async () => {
    const c = clock();
    let calls = 0;
    const r = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw limit;
        return "ok";
      },
      { deadline: 300_000, now: c.now, sleep: c.sleep },
    );
    expect(r).toBe("ok");
    expect(c.waits).toEqual([8000, 20000]);
  });

  it("después de 2 reintentos se rinde con el error", async () => {
    const c = clock();
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw limit;
        },
        { deadline: 300_000, now: c.now, sleep: c.sleep },
      ),
    ).rejects.toBe(limit);
    expect(calls).toBe(3);
  });

  it("no reintenta otros errores", async () => {
    const c = clock();
    const key = new Error("OpenAI rechazó la clave (OPENAI_API_KEY).");
    await expect(withRetry(async () => Promise.reject(key), { deadline: 300_000, now: c.now, sleep: c.sleep })).rejects.toBe(key);
    expect(c.waits).toEqual([]);
  });

  it("no reintenta si quedan menos de 40 s después de esperar", async () => {
    const c = clock();
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw limit;
        },
        // 8 s de espera + 40 s de reserva caben en 50 s; 20 s más ya no.
        { deadline: 50_000, now: c.now, sleep: c.sleep },
      ),
    ).rejects.toBe(limit);
    expect(c.waits).toEqual([8000]);
    expect(calls).toBe(2);
  });
});

describe("mapLimit", () => {
  it("respeta el máximo a la vez y el orden", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([30, 10, 20, 5], 1, async (ms, i) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(1);
    expect(await mapLimit([], 2, async (x) => x)).toEqual([]);
  });
});

describe("tono de las menciones (sentiment)", () => {
  const fam = { name: "Fameseg", website: "https://fameseg.com" };
  const report = readVisibilityReport(fameseg.reports.ai.data)!;
  // Las respuestas guardadas en el fixture están recortadas; la revisión pasa la respuesta completa.
  const FULL = `${report.results[1].answer}ón. 1. **Fameseg** — fabrican cortinas metálicas a la medida en su taller de Managua, con garantía de 24 meses. 2. Metalníca S.A.`;
  const texts = report.results.map((r, i) => (i === 1 ? FULL : r.answer));
  const text = (i: number) => texts[i];

  it("los reportes viejos (sin tono) se leen igual", () => {
    expect(report.sentiment).toBeUndefined();
    expect(report.results.every((r) => r.sentiment === undefined)).toBe(true);
    expect(report.score).toBe(80);
  });

  it("'S.A.' cuenta como sufijo legal", () => {
    expect(nameVariants("Metalníca S.A.")).toEqual(["metalnica sa", "metalnica"]);
  });

  it("busca la frase donde sale el negocio y revisa que la cita esté en la respuesta", () => {
    const q = quoteAround(text(1), fam);
    expect(q).toBe("Fameseg — fabrican cortinas metálicas a la medida en su taller de Managua, con garantía de 24 meses.");
    expect(q.length).toBeGreaterThan(0);
    expect(q.length).toBeLessThanOrEqual(200);
    expect(mentionMatcher(fam).inText(q)).toBe(true);
    expect(quoteInText(q, text(1))).toBe(true);
    expect(quoteInText("Fameseg es la peor empresa de Nicaragua", text(1))).toBe(false);
    expect(quoteAround("No nombra a nadie.", fam)).toBe("");
  });

  it("une el tono con las respuestas que te mencionan y cambia la cita si la IA la inventó", () => {
    const results = applyMentionClasses(
      report.results,
      [
        { id: 1, sentiment: "positiva", reason: "Te recomienda primero.", quote: "Fameseg: cortinas a la medida con garantía (texto inventado)", attributes: ["garantía", "precio"] },
        { id: 3, sentiment: "neutral", reason: "Solo te lista.", quote: "", attributes: ["Garantia", "rapidez"] },
        { id: 5, sentiment: "negativa", reason: "No te menciona", quote: "x", attributes: [] },
        { id: 7, sentiment: "negativa", reason: "Habla de quejas.", quote: "", attributes: ["precio"] },
      ],
      fam,
      texts,
    );
    // id 5 no te menciona: se ignora.
    expect(results[5].sentiment).toBeUndefined();
    expect(results[1].sentiment?.sentiment).toBe("positiva");
    expect(results[1].sentiment?.quote).toBe("Fameseg — fabrican cortinas metálicas a la medida en su taller de Managua, con garantía de 24 meses.");
    expect(results[1].sentiment?.quote).toBe(quoteAround(text(1), fam));
    // Una cita que sí está en la respuesta (sin importar los asteriscos) se respeta.
    expect(applyMentionClasses(report.results, [{ id: 1, sentiment: "positiva", reason: "", quote: "Fameseg — fabrican cortinas", attributes: [] }], fam, texts)[1].sentiment?.quote).toBe("Fameseg — fabrican cortinas");
    // Sin la respuesta completa y sin el nombre en lo guardado: no hay cita (no se inventa).
    expect(results[3].sentiment?.quote).toBe("");
    const s = summarizeSentiment(results);
    expect(s).toMatchObject({ status: "ok", positiva: 1, neutral: 1, negativa: 1, total: 3 });
    // "garantía" y "Garantia" son la misma.
    expect(s.attributes).toEqual([
      { name: "garantía", count: 2 },
      { name: "precio", count: 2 },
      { name: "rapidez", count: 1 },
    ]);
    expect(sentimentText(s)).toEqual({ es: "3 menciones: 1 positiva, 1 neutral, 1 negativa", en: "3 mentions: 1 positive, 1 neutral, 1 negative" });
    expect(sentimentText({ positiva: 3, neutral: 1, negativa: 0, total: 4 }).es).toBe("4 menciones: 3 positivas, 1 neutral");

    // Se guarda y se vuelve a leer igual; un tono roto se ignora.
    const saved = JSON.parse(JSON.stringify({ ...report, results, sentiment: s }));
    saved.results[3].sentiment.sentiment = "buenísima";
    const back = readVisibilityReport(saved)!;
    expect(back.results[1].sentiment).toEqual(results[1].sentiment);
    expect(back.results[3].sentiment).toBeUndefined();
    expect(back.sentiment).toMatchObject({ status: "ok", positiva: 1, negativa: 1, total: 2 });
  });

  it("si la llamada del tono falló, el reporte lo dice sin romperse", () => {
    const back = readVisibilityReport({ ...fameseg.reports.ai.data, sentiment: { status: "failed", positiva: 0, neutral: 0, negativa: 0, total: 0, attributes: [] } })!;
    expect(back.sentiment).toEqual({ status: "failed", positiva: 0, neutral: 0, negativa: 0, total: 0, attributes: [] });
    expect(readVisibilityReport({ ...fameseg.reports.ai.data, sentiment: { status: "rarísimo" } })!.sentiment).toBeUndefined();
    const r: Pick<VisibilityResult, "sentiment">[] = [{}];
    expect(summarizeSentiment(r, "skipped")).toEqual({ status: "skipped", positiva: 0, neutral: 0, negativa: 0, total: 0, attributes: [] });
  });
});
