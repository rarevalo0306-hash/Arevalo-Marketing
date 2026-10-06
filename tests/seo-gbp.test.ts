import { describe, expect, it } from "vitest";
import { reviewReplyPrompt } from "@/lib/ai";
import { BiError } from "@/lib/i18n";
import type { DfsTask } from "@/lib/seo/dataforseo";
import {
  carryDrafts,
  CHECK_WEIGHTS,
  competitorTargets,
  detectLanguage,
  fetchCompetitorProfiles,
  fetchProfile,
  fetchReviews,
  finishReply,
  firstName,
  type GbpApi,
  type GbpCompetitor,
  type GbpProfile,
  type GbpReview,
  googleReplyError,
  mapsUrl,
  matchGoogleReview,
  median,
  missingCategories,
  parseDfsTime,
  parseProfile,
  parseReviews,
  postGoogleReply,
  profileChecklist,
  profileCostEstimate,
  readGbpReport,
  readPendingTask,
  readReviewsReport,
  replyLanguage,
  replySignature,
  ReviewsPendingError,
  reviewsCostEstimate,
  reviewStats,
  type V4Review,
} from "@/lib/seo/gbp";

// ---------- Fixtures con la forma de la documentación de DataForSEO ----------

const INFO_RESULT = {
  keyword: "cid:194604053573767737",
  se_domain: "google.com",
  location_code: 2840,
  language_code: "es",
  items_count: 1,
  items: [
    {
      type: "google_business_info",
      rank_group: 1,
      title: "Fameseg Seguros",
      original_title: null,
      description: "Corredores de seguros en Managua.",
      category: "Agencia de seguros",
      category_ids: ["insurance_agency"],
      additional_categories: ["Corredor de seguros"],
      cid: "194604053573767737",
      feature_id: "0x0:0x2b3591f8f2c2a39",
      address: "Managua, Nicaragua",
      place_id: "ChIJabc",
      phone: "+505 2222 3333",
      url: "https://fameseg.com/",
      domain: "fameseg.com",
      logo: "https://lh3.googleusercontent.com/logo",
      main_image: "https://lh3.googleusercontent.com/main",
      total_photos: 7,
      latitude: 12.1364,
      longitude: -86.2514,
      is_claimed: true,
      attributes: {
        available_attributes: { from_the_business: ["is_small_business"], service_options: ["offers_online_appointments"], accessibility: null },
        unavailable_attributes: null,
      },
      place_topics: { seguros: 4, atención: 3 },
      rating: { rating_type: "Max5", value: 4.6, votes_count: 41, rating_max: null },
      rating_distribution: { "1": 2, "2": 0, "3": 2, "4": 4, "5": 33 },
      people_also_search: [{ cid: "1", title: "Otro", rating: { value: null, votes_count: null } }],
      work_time: {
        work_hours: {
          timetable: {
            sunday: null,
            monday: [{ open: { hour: 8, minute: 0 }, close: { hour: 17, minute: 0 } }],
            tuesday: [{ open: { hour: 8, minute: 0 }, close: { hour: 17, minute: 0 } }],
            wednesday: [],
          },
          current_status: "opened",
        },
      },
      popular_times: null,
    },
  ],
};

const REVIEWS_RESULT = {
  keyword: "cid:194604053573767737",
  type: "google_reviews",
  title: "Fameseg Seguros",
  rating: { rating_type: "Max5", value: 4.6, votes_count: 41, rating_max: null },
  reviews_count: 41,
  items_count: 4,
  items: [
    {
      type: "google_reviews_search",
      rank_group: 1,
      review_text: "Excelente atención, María me ayudó con el seguro del carro.",
      original_review_text: null,
      original_language: "es",
      time_ago: "hace 2 días",
      timestamp: "2026-10-03 15:20:00 +00:00",
      rating: { rating_type: "Max5", value: 5, votes_count: null, rating_max: 5 },
      reviews_count: 3,
      photos_count: 0,
      local_guide: true,
      profile_name: "Juan Pérez",
      profile_url: "https://www.google.com/maps/contrib/1",
      review_url: "https://www.google.com/maps/reviews/data=abc",
      profile_image_url: "https://lh3/x",
      owner_answer: null,
      original_owner_answer: null,
      owner_time_ago: null,
      owner_timestamp: null,
      review_id: "ChdDSUhNMG9nS0VJQ0FnSUQx",
      images: [{ type: "images_element", alt: "x", url: "https://img/1", image_url: "https://img/1.jpg" }],
      review_highlights: null,
    },
    {
      type: "google_reviews_search",
      review_text: "(Traducido por Google) Muy lento con mi reclamo",
      original_review_text: "Very slow with my claim",
      original_language: "en",
      time_ago: "hace un mes",
      timestamp: "2026-09-01 10:00:00 +00:00",
      rating: { value: 2 },
      profile_name: "Mike Smith",
      owner_answer: "Lamentamos la demora.",
      owner_timestamp: "2026-09-03 10:00:00 +00:00",
      review_id: "r2",
    },
    { type: "google_reviews_search", review_id: "r2", profile_name: "Duplicado", rating: { value: 5 } },
    { type: "something_else", review_id: "x" },
    {
      type: "google_reviews_search",
      review_text: "",
      time_ago: "hace 5 meses",
      timestamp: "2026-05-10 09:00:00 +00:00",
      rating: { value: 4 },
      profile_name: "ANA",
      owner_answer: "¡Gracias Ana!",
      owner_timestamp: "2026-05-14 09:00:00 +00:00",
      review_id: "r3",
    },
  ],
};

const task = <T,>(over: Partial<DfsTask<T>> = {}): DfsTask<T> => ({ id: "", statusCode: 20000, statusMessage: "Ok.", cost: 0, result: [], ...over });

const PLACE = { title: "Fameseg Seguros", cid: "194604053573767737", placeId: "ChIJabc", lat: 12.1364, lng: -86.2514 };
const ZONE = { code: 2558, name: "Managua,Nicaragua" };

const review = (over: Partial<GbpReview> = {}): GbpReview => ({
  id: "id",
  name: "Juan Pérez",
  profileUrl: "",
  localGuide: false,
  rating: 5,
  text: "Muy buena atención",
  originalText: "",
  language: "",
  timestamp: "2026-10-01T12:00:00.000Z",
  timeAgo: "",
  ownerAnswer: "",
  ownerTimestamp: "",
  url: "",
  images: [],
  ...over,
});

// ---------- Lectura de DataForSEO ----------

describe("parseDfsTime", () => {
  it("reads DataForSEO's format and ISO", () => {
    expect(parseDfsTime("2019-11-15 12:57:46 +00:00")).toBe("2019-11-15T12:57:46.000Z");
    expect(parseDfsTime("2019-11-15 12:57:46 -0600")).toBe("2019-11-15T18:57:46.000Z");
    expect(parseDfsTime("2019-11-15T12:57:46Z")).toBe("2019-11-15T12:57:46.000Z");
    expect(parseDfsTime("2019-11-15 12:57")).toBe("2019-11-15T12:57:00.000Z");
    expect(parseDfsTime("nope")).toBe("");
    expect(parseDfsTime(null)).toBe("");
  });
});

describe("parseProfile", () => {
  it("normalizes my_business_info", () => {
    const p = parseProfile(INFO_RESULT)!;
    expect(p).toMatchObject({
      title: "Fameseg Seguros",
      cid: "194604053573767737",
      placeId: "ChIJabc",
      category: "Agencia de seguros",
      additionalCategories: ["Corredor de seguros"],
      phone: "+505 2222 3333",
      domain: "fameseg.com",
      rating: 4.6,
      reviews: 41,
      distribution: [2, 0, 2, 4, 33],
      hasHours: true,
      hoursDays: 2,
      status: "opened",
      totalPhotos: 7,
      isClaimed: true,
      attributes: ["is_small_business", "offers_online_appointments"],
    });
    expect(p.topics[0]).toEqual({ term: "seguros", count: 4 });
  });

  it("is tolerant with missing pieces", () => {
    expect(parseProfile(null)).toBeNull();
    expect(parseProfile({ items: null })).toBeNull();
    expect(parseProfile({ items: [{ type: "google_business_info", title: "" }] })).toBeNull();
    const p = parseProfile({ items: [{ title: "X", rating: null, work_time: null, attributes: null, is_claimed: null, rating_distribution: { "5": 0 } }] })!;
    expect(p).toMatchObject({ title: "X", rating: null, reviews: null, hasHours: false, isClaimed: null, attributes: [], distribution: null, totalPhotos: null });
  });
});

describe("parseReviews", () => {
  it("normalizes reviews, keeps the original text and skips duplicates and other items", () => {
    const r = parseReviews(REVIEWS_RESULT);
    expect(r.total).toBe(41);
    expect(r.rating).toBe(4.6);
    expect(r.reviews.map((x) => x.id)).toEqual(["ChdDSUhNMG9nS0VJQ0FnSUQx", "r2", "r3"]);
    expect(r.reviews[0]).toMatchObject({
      name: "Juan Pérez",
      rating: 5,
      localGuide: true,
      timestamp: "2026-10-03T15:20:00.000Z",
      ownerAnswer: "",
      url: "https://www.google.com/maps/reviews/data=abc",
      images: ["https://img/1.jpg"],
      language: "es",
      originalText: "",
    });
    expect(r.reviews[1]).toMatchObject({ originalText: "Very slow with my claim", language: "en", ownerAnswer: "Lamentamos la demora.", ownerTimestamp: "2026-09-03T10:00:00.000Z" });
  });

  it("returns nothing for broken data", () => {
    expect(parseReviews(undefined)).toEqual({ total: null, rating: null, reviews: [] });
    expect(parseReviews({ items: [null as never, { type: "google_reviews_search" }] }).reviews).toEqual([]);
  });
});

// ---------- Números ----------

describe("reviewStats", () => {
  const now = new Date("2026-10-05T12:00:00.000Z");
  const { reviews } = parseReviews(REVIEWS_RESULT);

  it("computes average, distribution, answered % and unanswered", () => {
    const s = reviewStats(reviews, now);
    expect(s.count).toBe(3);
    expect(s.average).toBe(3.67);
    expect(s.distribution).toEqual([0, 1, 0, 1, 1]);
    expect(s.answered).toBe(2);
    expect(s.answeredPct).toBe(67);
    expect(s.unanswered).toBe(1);
    expect(s.unansweredLow).toBe(0);
  });

  it("counts reviews per month for the last 12 months and the recent windows", () => {
    const s = reviewStats(reviews, now);
    expect(s.months).toHaveLength(12);
    expect(s.months[0].month).toBe("2025-11");
    expect(s.months[11]).toEqual({ month: "2026-10", count: 1 });
    expect(s.months.find((m) => m.month === "2026-09")?.count).toBe(1);
    expect(s.months.find((m) => m.month === "2026-05")?.count).toBe(1);
    expect(s.thisMonth).toBe(1);
    expect(s.last7).toBe(1);
    expect(s.last30).toBe(1);
    expect(s.last90).toBe(2);
  });

  it("averages the owner's reply time in days", () => {
    // 2 días y 4 días → 3.
    expect(reviewStats(reviews, now).avgReplyDays).toBe(3);
    expect(reviewStats([review()], now).avgReplyDays).toBeNull();
  });

  it("finds repeated topics, merging plurals and ignoring stopwords", () => {
    const s = reviewStats(
      [
        review({ id: "1", text: "El techo quedó perfecto, buen precio" }),
        review({ id: "2", text: "Arreglaron los techos rápido. Precio justo." }),
        review({ id: "3", text: "Muy buena atención y el precio" }),
      ],
      now,
    );
    expect(s.topics[0]).toEqual({ term: "precio", count: 3 });
    expect(s.topics.find((x) => x.term.startsWith("tech"))?.count).toBe(2);
    expect(s.topics.some((x) => ["muy", "buena", "el"].includes(x.term))).toBe(false);
  });

  it("handles no reviews", () => {
    const s = reviewStats([], now);
    expect(s).toMatchObject({ count: 0, average: null, answeredPct: null, unanswered: 0, avgReplyDays: null, topics: [] });
  });
});

// ---------- Checklist ----------

const profile = (over: Partial<GbpProfile> = {}): GbpProfile => ({ ...parseProfile(INFO_RESULT)!, ...over });
const comp = (over: Partial<GbpCompetitor> = {}): GbpCompetitor => ({
  title: "Rival",
  cid: "9",
  category: "Agencia de seguros",
  additionalCategories: [],
  rating: 4.8,
  reviews: 120,
  totalPhotos: 40,
  isClaimed: true,
  hasDescription: true,
  hasHours: true,
  ...over,
});

describe("profileChecklist", () => {
  it("weights add up to 100", () => {
    expect(Object.values(CHECK_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("gives 100 to a complete profile", () => {
    const stats = reviewStats([review({ ownerAnswer: "Gracias", ownerTimestamp: "2026-10-02T12:00:00.000Z" })], new Date("2026-10-05T12:00:00Z"));
    const { score, checklist } = profileChecklist(
      profile({ description: "x".repeat(300), totalPhotos: 50, rating: 4.9, reviews: 200, attributes: ["a", "b", "c"] }),
      [],
      stats,
    );
    expect(checklist.every((c) => c.ok)).toBe(true);
    expect(score).toBe(100);
    expect(checklist.map((c) => c.id)).toContain("answered");
  });

  it("flags what's missing and compares with competitors", () => {
    const comps = [
      comp({ additionalCategories: ["Corredor de seguros", "Seguro de autos"] }),
      comp({ cid: "8", category: "Seguro de autos", totalPhotos: 30, rating: 4.7, reviews: 90 }),
      comp({ cid: "7", error: { es: "x", en: "x" }, totalPhotos: 9999 }),
    ];
    const { checklist, score } = profileChecklist(profile({ isClaimed: false, description: "", phone: "", url: "", rating: 4.3 }), comps);
    const byId = Object.fromEntries(checklist.map((c) => [c.id, c]));
    expect(byId.claimed.ok).toBe(false);
    expect(byId.claimed.priority).toBe("high");
    expect(byId.description.ok).toBe(false);
    expect(byId.phone.ok).toBe(false);
    expect(byId.website.ok).toBe(false);
    // Fotos: 7 contra la mediana 35 de los que sí se revisaron (el que falló no cuenta).
    expect(byId.photos.ok).toBe(false);
    expect(byId.photos.es).toContain("35");
    // Calificación 4.3: menos de 4.5 y menos que la mediana (4.75) → mal; reseñas 41 < 105.
    expect(byId.rating.ok).toBe(false);
    expect(byId.reviewCount.ok).toBe(false);
    // Categoría que usan los dos competidores y tú no.
    expect(byId.additional.ok).toBe(false);
    expect(byId.additional.es).toContain("Seguro de autos");
    // Sin reseñas traídas no se revisan las respuestas.
    expect(byId.answered).toBeUndefined();
    expect(byId.recent).toBeUndefined();
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(60);
  });

  it("skips 'claimed' when Google doesn't say, and normalizes the score", () => {
    const a = profileChecklist(profile({ isClaimed: null }));
    expect(a.checklist.some((c) => c.id === "claimed")).toBe(false);
    const total = a.checklist.reduce((s, c) => s + c.weight, 0);
    const earned = a.checklist.filter((c) => c.ok).reduce((s, c) => s + c.weight, 0);
    expect(a.score).toBe(Math.round((earned / total) * 100));
  });

  it("reports stale reviews and low answer rate", () => {
    const now = new Date("2026-10-05T12:00:00Z");
    const stats = reviewStats([review({ timestamp: "2026-08-01T00:00:00Z" }), review({ id: "2", rating: 2, timestamp: "2026-08-02T00:00:00Z" })], now);
    const { checklist } = profileChecklist(profile(), [], stats);
    const byId = Object.fromEntries(checklist.map((c) => [c.id, c]));
    expect(byId.recent.ok).toBe(false);
    expect(byId.recent.es).toContain("2 en los últimos 3 meses");
    expect(byId.answered.ok).toBe(false);
    expect(byId.answered.es).toContain("0 %");
    expect(byId.answered.es).toContain("1 de 3 estrellas o menos");
  });

  it("missingCategories and median", () => {
    expect(missingCategories({ category: "A", additionalCategories: ["b"] }, [comp({ category: "a", additionalCategories: ["B", "C"] }), comp({ category: "C" })])).toEqual([
      { category: "C", count: 2 },
    ]);
    expect(median([3, null, 1, 2])).toBe(2);
    expect(median([1, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("competitorTargets", () => {
  it("takes up to 3 competitors with cid from the heatmap, without you", () => {
    const report = {
      competitors: [
        { title: "Yo", cid: "1", points: 9, avgRank: 1 },
        { title: "Sin cid", points: 8, avgRank: 2 },
        { title: "A", cid: "2", points: 7, avgRank: 2 },
        { title: "A otra vez", cid: "2", points: 6, avgRank: 2 },
        { title: "B", cid: "3", points: 5, avgRank: 3 },
        { title: "C", cid: "4", points: 4, avgRank: 3 },
        { title: "D", cid: "5", points: 3, avgRank: 3 },
      ],
    };
    expect(competitorTargets(report, "1")).toEqual([
      { title: "A", cid: "2" },
      { title: "B", cid: "3" },
      { title: "C", cid: "4" },
    ]);
    expect(competitorTargets(null, "1")).toEqual([]);
  });
});

// ---------- Llamadas (sin red) ----------

function fakeApi(responses: ((method: string, path: string, body?: Record<string, unknown>) => DfsTask<unknown>)[], step = 4_000) {
  let t = 0;
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  const api: GbpApi = {
    task: (async (method: "GET" | "POST", path: string, body?: Record<string, unknown>) => {
      calls.push({ method, path, body });
      const next = responses.shift();
      if (!next) throw new Error("no more responses");
      return next(method, path, body);
    }) as GbpApi["task"],
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t + (step - 4_000),
  };
  return { api, calls };
}

describe("fetchProfile / fetchCompetitorProfiles", () => {
  it("asks for the profile by cid in the main zone", async () => {
    const { api, calls } = fakeApi([() => task({ cost: 0.0054, result: [INFO_RESULT] })]);
    const r = await fetchProfile(PLACE, "es", ZONE, api);
    expect(r.cost).toBe(0.0054);
    expect(r.profile.title).toBe("Fameseg Seguros");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/business_data/google/my_business_info/live", body: { keyword: "cid:194604053573767737", language_code: "es", location_code: 2558 } });
  });

  it("falls back to place_id and coordinates; explains 'no results'", async () => {
    const { api, calls } = fakeApi([() => task({ statusCode: 40102, statusMessage: "No Search Results." })]);
    await expect(fetchProfile({ ...PLACE, cid: "" }, "en", null, api)).rejects.toThrow(/Google no devolvió tu perfil/);
    expect(calls[0].body).toMatchObject({ keyword: "place_id:ChIJabc", location_coordinate: "12.1364,-86.2514,5000" });
  });

  it("keeps going when a competitor fails", async () => {
    const { api } = fakeApi([() => task({ cost: 0.0054, result: [INFO_RESULT] }), () => task({ statusCode: 40501, statusMessage: "Invalid Field" })]);
    const r = await fetchCompetitorProfiles(
      [
        { title: "A", cid: "2" },
        { title: "B", cid: "3" },
      ],
      "es",
      ZONE,
      PLACE,
      api,
    );
    expect(r.cost).toBe(0.0054);
    expect(r.competitors[0].error).toBeUndefined();
    expect(r.competitors[1]).toMatchObject({ title: "B", cid: "3" });
    expect(r.competitors[1].error?.es).toContain("Invalid Field");
  });
});

describe("fetchReviews", () => {
  it("posts a priority task with cid and polls until ready", async () => {
    const { api, calls } = fakeApi([
      () => task({ id: "task-1", statusCode: 20100, statusMessage: "Task Created.", cost: 0.0075 }),
      () => task({ statusCode: 40602, statusMessage: "Task In Queue." }),
      () => task({ statusCode: 40601, statusMessage: "Task Handed." }),
      () => task({ result: [REVIEWS_RESULT] }),
    ]);
    const r = await fetchReviews(PLACE, "es", ZONE, {}, api);
    expect(r.reviews).toHaveLength(3);
    expect(r.cost).toBe(0.0075);
    expect(r.taskId).toBe("task-1");
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/business_data/google/reviews/task_post",
      body: { cid: "194604053573767737", location_code: 2558, language_code: "es", depth: 50, sort_by: "newest", priority: 2 },
    });
    expect(calls[3].path).toBe("/business_data/google/reviews/task_get/task-1");
  });

  it("throws ReviewsPendingError with the task id after the wait, and resumes without paying again", async () => {
    const pendingForever = () => task({ statusCode: 40602, statusMessage: "Task In Queue." });
    const { api } = fakeApi([() => task({ id: "t-2", statusCode: 20100, cost: 0.0075 }), ...Array.from({ length: 40 }, () => pendingForever)]);
    const err = await fetchReviews(PLACE, "es", ZONE, { waitMs: 20_000 }, api).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewsPendingError);
    expect((err as ReviewsPendingError).taskId).toBe("t-2");
    expect((err as ReviewsPendingError).cost).toBe(0.0075);
    expect((err as ReviewsPendingError).en).toContain("won't be charged again");

    const { api: api2, calls } = fakeApi([() => task({ result: [REVIEWS_RESULT] })]);
    const r = await fetchReviews(PLACE, "es", ZONE, { resumeTaskId: "t-2" }, api2);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(r.cost).toBe(0);
    expect(r.reviews).toHaveLength(3);
  });

  it("returns no reviews on 'No Search Results' and fails clearly on other errors", async () => {
    const a = fakeApi([() => task({ id: "t", statusCode: 20100 }), () => task({ statusCode: 40102, statusMessage: "No Search Results." })]);
    expect((await fetchReviews(PLACE, "es", ZONE, {}, a.api)).reviews).toEqual([]);
    const b = fakeApi([() => task({ id: "t", statusCode: 20100 }), () => task({ statusCode: 40200, statusMessage: "Payment Required." })]);
    await expect(fetchReviews(PLACE, "es", ZONE, {}, b.api)).rejects.toThrow(/saldo/);
    const c = fakeApi([() => task({ statusCode: 20100 })]);
    await expect(fetchReviews(PLACE, "es", ZONE, {}, c.api)).rejects.toThrow(/número de la tarea/);
  });
});

// ---------- Respuestas ----------

describe("reply language and signature", () => {
  it("detects Spanish and English", () => {
    expect(detectLanguage("Excelente servicio, me atendieron muy bien y rápido")).toBe("es");
    expect(detectLanguage("Great service, they were very helpful with my claim")).toBe("en");
    expect(detectLanguage("👍")).toBeNull();
    expect(detectLanguage("")).toBeNull();
  });

  it("uses Google's language, then the text, then the business language", () => {
    expect(replyLanguage({ language: "en-US", text: "Muy bueno todo el servicio", originalText: "" }, "es")).toBe("en");
    expect(replyLanguage({ language: "", text: "(Traducido) Muy rápido", originalText: "They were very fast and the service was great" }, "es")).toBe("en");
    expect(replyLanguage({ language: "", text: "", originalText: "" }, "es")).toBe("es");
    expect(replyLanguage({ language: "", text: "", originalText: "" }, "en")).toBe("en");
  });

  it("firstName", () => {
    expect(firstName("María José Pérez")).toBe("María");
    expect(firstName("JUAN CARLOS")).toBe("Juan");
    expect(firstName("J. P.")).toBe("");
    expect(firstName("A Google User")).toBe("");
    expect(firstName("12345")).toBe("");
    expect(firstName("")).toBe("");
  });

  it("finishReply removes AI signatures and adds the business one", () => {
    const sig = replySignature("Fameseg", "es");
    expect(sig).toBe("— Equipo Fameseg");
    expect(replySignature("Fameseg", "en")).toBe("— Fameseg Team");
    expect(finishReply('"¡Gracias, Juan! Nos alegra.\n\n— El equipo de Fameseg"', sig)).toBe("¡Gracias, Juan! Nos alegra.\n— Equipo Fameseg");
    expect(finishReply("**Gracias** Ana.", sig)).toBe("Gracias Ana.\n— Equipo Fameseg");
    expect(finishReply("x ".repeat(2000), sig).length).toBeLessThanOrEqual(1500);
  });

  it("reviewReplyPrompt protects low-star replies and uses the phone and first name", () => {
    const business = { name: "Ajustadores Miami", website: "https://a.com", phone: "(305) 555-0100", aiProfile: "Public adjuster en Miami.", brandVoice: "" };
    const low = reviewReplyPrompt(business, { name: "Mike Smith", rating: 2, text: "Slow with my claim", originalText: "", language: "en", timeAgo: "" }, "en");
    expect(low.system).toContain("Write in natural US English");
    expect(low.system).toContain("first name: Mike");
    expect(low.system).toContain("without admitting fault");
    expect(low.system).toContain("amounts, payments, insurance coverage");
    expect(low.system).toContain("(305) 555-0100");
    expect(low.user).toContain("Slow with my claim");
    const high = reviewReplyPrompt({ ...business, phone: "" }, { name: "J.", rating: 5, text: "", originalText: "", language: "", timeAgo: "" }, "es");
    expect(high.system).toContain("Write in Spanish");
    expect(high.system).toContain("without using a name");
    expect(high.system).not.toContain("without admitting fault");
    expect(high.system).toContain("without inventing a phone");
    expect(high.user).toContain("(no text, only stars)");
  });
});

// ---------- Contestar en Google ----------

const v4 = (over: Partial<V4Review> = {}): V4Review => ({
  name: "accounts/1/locations/2/reviews/AbC",
  reviewId: "AbC",
  reviewer: { displayName: "Juan Pérez" },
  starRating: "FIVE",
  comment: "Excelente atención, María me ayudó con el seguro del carro.",
  createTime: "2026-10-03T15:21:10Z",
  ...over,
});

describe("matchGoogleReview", () => {
  const r = review({ id: "ChdDSUhN", name: "Juan Pérez", rating: 5, timestamp: "2026-10-03T15:20:00.000Z", text: "Excelente atención, María me ayudó con el seguro del carro." });

  it("matches by id when Google uses the same one", () => {
    const g = v4({ reviewId: "ChdDSUhN", name: "accounts/1/locations/2/reviews/ChdDSUhN", reviewer: { displayName: "Otro" } });
    expect(matchGoogleReview(r, [v4(), g])).toBe(g);
  });

  it("matches by name + stars + date when ids differ", () => {
    const g = v4();
    expect(matchGoogleReview(r, [v4({ reviewer: { displayName: "Ana" } }), g])).toBe(g);
    // Mismo nombre pero otra calificación o fecha lejana: no.
    expect(matchGoogleReview(r, [v4({ starRating: "FOUR" })])).toBeNull();
    expect(matchGoogleReview(r, [v4({ createTime: "2026-09-01T00:00:00Z" })])).toBeNull();
  });

  it("breaks ties by text or by the closest date, and refuses when unsure", () => {
    const a = v4({ reviewId: "a", comment: "Otra cosa distinta", createTime: "2026-10-02T15:00:00Z" });
    const b = v4({ reviewId: "b" });
    expect(matchGoogleReview(r, [a, b])).toBe(b);
    const c = v4({ reviewId: "c", comment: "", createTime: "2026-10-03T16:00:00Z" });
    const d = v4({ reviewId: "d", comment: "", createTime: "2026-10-05T16:00:00Z" });
    expect(matchGoogleReview(r, [c, d])).toBe(c);
    const e = v4({ reviewId: "e", comment: "" });
    const f = v4({ reviewId: "f", comment: "" });
    expect(matchGoogleReview(r, [e, f])).toBeNull();
    expect(matchGoogleReview(review({ name: "" }), [v4()])).toBeNull();
  });
});

describe("googleReplyError", () => {
  it("explains that Google hasn't approved the API", () => {
    const e = googleReplyError(new Error("403: The caller does not have permission (PERMISSION_DENIED)"));
    expect(e.message).toContain("Google todavía no aprobó el acceso de la app a tu Perfil de Negocio; copia la respuesta y pégala en Google");
    expect(e.en).toContain("hasn't approved");
    expect(googleReplyError(new Error("429: Quota exceeded for quota metric 'Requests' ... limit 0")).message).toContain("no aprobó");
  });

  it("other errors", () => {
    expect(googleReplyError(new Error("400: invalid_grant — Token has been expired or revoked.")).message).toContain("Vuelve a conectarlo");
    expect(googleReplyError(new Error("404: Requested entity was not found.")).message).toContain("no encontró esa reseña");
    expect(googleReplyError(new Error("500: boom")).message).toContain("Copia la respuesta");
    const bi = new BiError("hola", "hi");
    expect(googleReplyError(bi)).toBe(bi);
  });
});

describe("postGoogleReply", () => {
  const creds = { accountId: "accounts/1", locationId: "locations/2", refreshToken: "rt", clientId: "c", clientSecret: "s" };
  const r = review({ id: "ChdDSUhN", name: "Juan Pérez", rating: 5, timestamp: "2026-10-03T15:20:00.000Z" });

  it("lists v4 reviews, matches and PUTs the reply", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("/reviews?")) return { reviews: [v4({ reviewer: { displayName: "Ana" } }), v4()] };
      return { comment: "ok" };
    }) as never;
    await postGoogleReply(creds, r, "¡Gracias Juan!", { token: async () => "tok", fetch });
    expect(calls[0].url).toContain("https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews?pageSize=50");
    expect(calls[1].url).toBe("https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews/AbC/reply");
    expect(calls[1].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ comment: "¡Gracias Juan!" });
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("follows pages and fails clearly when it can't match", async () => {
    let page = 0;
    const fetch = (async () => {
      page++;
      return page < 3 ? { reviews: [v4({ reviewer: { displayName: "Nadie" } })], nextPageToken: `p${page}` } : { reviews: [] };
    }) as never;
    await expect(postGoogleReply(creds, r, "x", { token: async () => "tok", fetch })).rejects.toThrow(/No pudimos encontrar esta reseña/);
    expect(page).toBe(3);
  });

  it("maps API errors to the 'not approved' message", async () => {
    const fetch = (async () => {
      throw new Error("403: Google My Business API has not been used in project 123 before or it is disabled.");
    }) as never;
    await expect(postGoogleReply(creds, r, "x", { token: async () => "tok", fetch })).rejects.toThrow(/todavía no aprobó/);
    await expect(postGoogleReply({ ...creds, locationId: "" }, r, "x", { token: async () => "tok", fetch })).rejects.toThrow(/incompleta/);
  });
});

// ---------- Lectura de lo guardado ----------

describe("readers", () => {
  it("readGbpReport recomputes the checklist and tolerates broken data", () => {
    const p = parseProfile(INFO_RESULT)!;
    const r = readGbpReport({ profile: p, competitors: [comp(), null, { title: "" }, { title: "Err", error: { es: "x" } }], score: 3, cost: 0.02, createdAt: "2026-10-01T00:00:00Z" })!;
    expect(r.competitors).toHaveLength(2);
    expect(r.competitors[1].error).toEqual({ es: "x", en: "x" });
    expect(r.score).not.toBe(3);
    expect(r.cost).toBe(0.02);
    expect(readGbpReport(null)).toBeNull();
    expect(readGbpReport({ profile: { title: "" } })).toBeNull();
    expect(readGbpReport({ profile: { title: "X", distribution: [1, 2] } })?.profile).toMatchObject({ title: "X", distribution: null, rating: null, isClaimed: null });
    expect(readGbpReport({ profile: p })?.createdAt).toBe(new Date(0).toISOString());
  });

  it("readReviewsReport keeps drafts, drops junk and recomputes stats", () => {
    const r = readReviewsReport({
      total: 41,
      rating: 4.6,
      cost: "x",
      createdAt: "2026-10-05T12:00:00Z",
      reviews: [
        { id: "a", name: "Ana", rating: 9, text: "hola", timestamp: "2026-10-01T00:00:00Z", draft: "Gracias Ana", draftAt: "bad" },
        { id: "a", name: "Repetida" },
        { id: "" },
        "nope",
        { id: "b", rating: 2, ownerAnswer: "Lo sentimos", images: ["u", 3] },
      ],
    })!;
    expect(r.reviews.map((x) => x.id)).toEqual(["a", "b"]);
    expect(r.reviews[0]).toMatchObject({ rating: null, draft: "Gracias Ana" });
    expect(r.reviews[0].draftAt).toBeUndefined();
    expect(r.reviews[1].images).toEqual(["u"]);
    expect(r.cost).toBe(0);
    expect(r.stats).toMatchObject({ count: 2, answered: 1, unanswered: 1 });
    expect(readReviewsReport({ reviews: null })).toBeNull();
    expect(readReviewsReport(undefined)).toBeNull();
  });

  it("readPendingTask expires after 30 minutes", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(readPendingTask({ taskId: "t", cost: 0.0075, createdAt: "2026-10-05T11:45:00Z" }, now)).toEqual({ taskId: "t", cost: 0.0075 });
    expect(readPendingTask({ taskId: "t", createdAt: "2026-10-05T11:00:00Z" }, now)).toBeNull();
    expect(readPendingTask({ createdAt: "2026-10-05T11:59:00Z" }, now)).toBeNull();
    expect(readPendingTask(null, now)).toBeNull();
  });

  it("carryDrafts keeps drafts for still-unanswered reviews and posted replies until Google shows them", () => {
    const prev = [review({ id: "a", draft: "borrador" }), review({ id: "b", draft: "viejo" }), review({ id: "c", ownerAnswer: "publicada", postedAt: "2026-10-04T00:00:00Z" })];
    const next = [review({ id: "a" }), review({ id: "b", ownerAnswer: "ya contestó en Google" }), review({ id: "c" }), review({ id: "d" })];
    const out = carryDrafts(next, prev);
    expect(out[0].draft).toBe("borrador");
    expect(out[1].draft).toBeUndefined();
    expect(out[2]).toMatchObject({ ownerAnswer: "publicada", postedAt: "2026-10-04T00:00:00Z" });
    expect(out[3].draft).toBeUndefined();
  });
});

describe("costs and links", () => {
  it("estimates", () => {
    expect(profileCostEstimate(0)).toBe(0.0054);
    expect(profileCostEstimate(3)).toBe(0.0216);
    expect(profileCostEstimate(9)).toBe(0.0216);
    expect(reviewsCostEstimate()).toBe(0.0075);
    expect(reviewsCostEstimate(15)).toBe(0.003);
    expect(mapsUrl("123")).toBe("https://www.google.com/maps?cid=123");
    expect(mapsUrl("")).toBe("");
  });
});
