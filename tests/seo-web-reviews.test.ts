import { describe, expect, it } from "vitest";
import { reviewReplyPrompt } from "@/lib/ai";
import {
  carryWebDrafts,
  fetchWebReviews,
  mergeWebReviews,
  parseDirect,
  parseExtended,
  readWebReviewsReport,
  readWebTasks,
  sourceOf,
  tripadvisorPath,
  type WebApi,
  WebReviewsPendingError,
  webSources,
} from "@/lib/seo/web-reviews";
import { reviewStats } from "@/lib/seo/gbp";

const EXTENDED = [
  {
    rating: { value: 4.7 },
    items: [
      { type: "google_extended_reviews_search", review_id: "g1", profile_name: "Ana", rating: { value: 5 }, review_text: "Excelente", timestamp: "2026-10-01 10:00:00 +00:00", source: { title: "Google", domain: "www.google.com" } },
      { type: "google_extended_reviews_search", review_id: "y1", profile_name: "Bob K.", rating: { value: 2 }, review_text: "Slow response", timestamp: "2026-09-20 10:00:00 +00:00", review_url: "https://www.yelp.com/biz/x?hrid=1", owner_answer: null, source: { title: "Yelp", domain: "www.yelp.com" } },
      { type: "google_extended_reviews_search", profile_name: "Carla", rating: { value: 5 }, review_text: "Muy bien", timestamp: "2026-09-25 10:00:00 +00:00", owner_answer: "¡Gracias Carla!", source: { title: "Facebook", domain: "www.facebook.com" } },
      { type: "google_extended_reviews_search", review_id: "t9", profile_name: "Dan", rating: { value: 4 }, review_text: "Good work", timestamp: "2026-09-10 10:00:00 +00:00", source: { title: "Trustpilot", domain: "www.trustpilot.com" } },
    ],
  },
];
const TRUSTPILOT = [
  {
    title: "Joe's Roofing",
    rating: { value: 4.2 },
    reviews_count: 37,
    items: [
      { review_id: "tp1", user_profile: { name: "Dan" }, rating: { value: 4 }, title: "Good work", review_text: "Good work, on time.", timestamp: "2026-09-10 10:00:00 +00:00", url: "https://www.trustpilot.com/reviews/tp1", responses: null },
      { review_id: "tp2", user_profile: { name: "Eve" }, rating: { value: 1 }, title: "Never again", review_text: "They didn't show up.", timestamp: "2026-10-05 10:00:00 +00:00", url: "https://www.trustpilot.com/reviews/tp2", responses: [{ text: "Sorry Eve, please call us.", timestamp: "2026-10-06 10:00:00 +00:00" }] },
    ],
  },
];

describe("Reseñas en otros sitios", () => {
  it("reconoce el sitio de cada reseña", () => {
    expect(sourceOf("www.yelp.com")).toEqual({ id: "yelp", name: "Yelp" });
    expect(sourceOf("", "Facebook")).toEqual({ id: "facebook", name: "Facebook" });
    expect(sourceOf("m.tripadvisor.com.mx")).toEqual({ id: "tripadvisor", name: "Tripadvisor" });
    expect(sourceOf("www.angi.com")).toEqual({ id: "angi", name: "Angi" });
    expect(sourceOf("reviews.example.com", "Example Reviews")).toEqual({ id: "reviews.example.com", name: "Example Reviews" });
  });

  it("saca el url_path de una ficha de Tripadvisor", () => {
    expect(tripadvisorPath("https://www.tripadvisor.com/Restaurant_Review-g34438-d1234567-Reviews-Joes_Grill-Miami_Florida.html?foo=1")).toBe("Restaurant_Review-g34438-d1234567-Reviews-Joes_Grill-Miami_Florida.html");
    expect(tripadvisorPath("https://www.tripadvisor.com.mx/Hotel_Review-g1-d2-Reviews-Hotel.html")).toBe("Hotel_Review-g1-d2-Reviews-Hotel.html");
    expect(tripadvisorPath("https://www.yelp.com/biz/x")).toBe("");
  });

  it("de Google solo toma las reseñas de otros sitios, y junta sin repetir", () => {
    const ext = parseExtended(EXTENDED);
    expect(ext.map((r) => [r.source, r.name, r.rating, r.ownerAnswer])).toEqual([
      ["yelp", "Bob K.", 2, ""],
      ["facebook", "Carla", 5, "¡Gracias Carla!"],
      ["trustpilot", "Dan", 4, ""],
    ]);
    const tp = parseDirect(TRUSTPILOT, { id: "trustpilot", name: "Trustpilot" });
    expect(tp.total).toBe(37);
    expect(tp.rating).toBe(4.2);
    expect(tp.reviews[0].text).toBe("Good work, on time.");
    expect(tp.reviews[1]).toMatchObject({ text: "Never again. They didn't show up.", ownerAnswer: "Sorry Eve, please call us." });
    const all = mergeWebReviews(ext, tp.reviews);
    // La de Dan en Trustpilot viene por Google y directo: queda una sola. De la más nueva a la más vieja.
    expect(all.map((r) => `${r.source}:${r.name}`)).toEqual(["trustpilot:Eve", "facebook:Carla", "yelp:Bob K.", "trustpilot:Dan"]);
    const sources = webSources(all, { trustpilot: { rating: 4.2, total: 37, url: "https://www.trustpilot.com/review/joes.com" } });
    expect(sources.map((s) => [s.id, s.rating, s.total, s.count])).toEqual([
      ["trustpilot", 4.2, 37, 2],
      ["facebook", 5, null, 1],
      ["yelp", 2, null, 1],
    ]);
  });

  it("guarda las respuestas escritas y lee el reporte sin confiar en él", () => {
    const ext = parseExtended(EXTENDED);
    const prev = ext.map((r) => (r.source === "yelp" ? { ...r, draft: "Hola Bob", draftAt: "2026-10-01T00:00:00.000Z", copiedAt: "2026-10-02T00:00:00.000Z" } : r));
    const next = carryWebDrafts(ext, prev);
    expect(next[0]).toMatchObject({ draft: "Hola Bob", copiedAt: "2026-10-02T00:00:00.000Z" });
    const report = { version: 1, sources: [{ id: "yelp", name: "Yelp", rating: 2, total: null, count: 1, url: "javascript:x" }], reviews: next, stats: reviewStats(next), tripadvisorPath: "", trustpilotDomain: "joes.com", notes: [], cost: 0.02, createdAt: "2026-10-14T00:00:00.000Z" };
    const back = readWebReviewsReport(JSON.parse(JSON.stringify(report)));
    expect(back?.reviews[0].draft).toBe("Hola Bob");
    expect(back?.sources[0].url).toBe("");
    expect(back?.stats.unanswered).toBe(2);
    expect(readWebReviewsReport({ version: 2 })).toBeNull();
  });

  it("la respuesta de la IA sabe en qué sitio va", () => {
    const p = reviewReplyPrompt({ name: "Joe's", website: "", aiProfile: "" }, { name: "Bob", rating: 2, text: "Slow", originalText: "", language: "en", timeAgo: "" }, "en", "Yelp");
    expect(p.system).toContain("customer review on Yelp");
  });
});

describe("Tareas de DataForSEO", () => {
  const api = (answers: Record<string, { statusCode: number; result?: unknown[] }>, post = true): WebApi & { posted: string[] } => {
    const posted: string[] = [];
    let now = 0;
    return {
      posted,
      now: () => now,
      sleep: async (ms) => void (now += ms),
      task: (async (method: string, path: string) => {
        if (method === "POST") {
          posted.push(path);
          return { id: `id-${posted.length}-abcdefghij`, statusCode: post ? 20100 : 40200, statusMessage: "ok", cost: 0.01, result: [] };
        }
        const k = Object.keys(answers).find((p) => path.includes(p)) ?? "";
        const a = answers[k] ?? { statusCode: 40602 };
        return { id: "", statusCode: a.statusCode, statusMessage: "x", cost: 0, result: a.result ?? [] };
      }) as WebApi["task"],
    };
  };
  const place = { title: "Joe's", cid: "123", placeId: "", lat: 25.7, lng: -80.2 };

  it("pide a cada fuente y junta lo que llega", async () => {
    const a = api({ extended_reviews: { statusCode: 20000, result: EXTENDED }, trustpilot: { statusCode: 20000, result: TRUSTPILOT } });
    const r = await fetchWebReviews({ place, zone: { code: 1015116, name: "Miami" }, lang: "es", website: "https://joes.com", tripadvisorPath: "" }, a);
    expect(a.posted).toEqual(["/business_data/google/extended_reviews/task_post", "/business_data/trustpilot/reviews/task_post"]);
    expect(r.reviews.length).toBe(4);
    expect(r.cost).toBe(0.02);
    expect(r.direct.trustpilot.total).toBe(37);
  });

  it("si tardan, guarda las tareas para seguir esperando sin pagar otra vez", async () => {
    const a = api({});
    await expect(fetchWebReviews({ place, zone: null, lang: "es", website: "", tripadvisorPath: "" }, a)).rejects.toBeInstanceOf(WebReviewsPendingError);
    expect(readWebTasks({ tasks: { extended: "id-1-abcdefghij", bad: "x" }, cost: 0.01, createdAt: new Date().toISOString() })).toEqual({ tasks: { extended: "id-1-abcdefghij" }, cost: 0.01 });
    expect(readWebTasks({ tasks: { extended: "id-1-abcdefghij" }, createdAt: "2020-01-01T00:00:00.000Z" })).toBeNull();
  });

  it("sin negocio en el mapa ni página web no hay de dónde pedir", async () => {
    await expect(fetchWebReviews({ place: null, zone: null, lang: "es", website: "", tripadvisorPath: "" }, api({}))).rejects.toThrow(/No hay de dónde/);
  });
});
