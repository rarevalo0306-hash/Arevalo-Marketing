import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({ db: { campaign: { findFirst: (...a: unknown[]) => findFirst(...a) }, connection: { findUnique: vi.fn(async () => null) } } }));

import { adParams, adSetParams, campaignParams, createMetaAd, creativeParams, fetchMetaInsights, goalFitsSource, MetaStepError, pauseMetaAd, resultsFrom, targetingSpec } from "@/lib/ads-meta";
import {
  applyDecision,
  campaignRoomCents,
  checkActivate,
  checkNewAd,
  committedCents,
  costPerResultCents,
  decideAds,
  guessSpecialCategory,
  maxSpendCents,
  money,
  monthCommittedCents,
  parseMoney,
  readCampaignAds,
  type AdEntry,
  type NewAdCheck,
} from "@/lib/ads-shape";
import { buildGooglePlan, fitList, fitText, googlePlanCsv, mergeGoogleTexts, themeOf, DESCRIPTION_MAX, HEADLINE_MAX } from "@/lib/ads-google";
import { toProposals, type ProposalContext } from "@/lib/ads-ai";

beforeAll(() => {
  process.env.APP_SECRET = "y".repeat(40);
  process.env.META_APP_ID = "123";
  process.env.META_APP_SECRET = "s";
  process.env.PUBLIC_BASE_URL = "https://app.example.com";
});

afterEach(() => {
  vi.unstubAllGlobals();
  findFirst.mockReset();
});

const NOW = new Date("2026-10-08T15:00:00Z");

function ad(over: Partial<AdEntry> = {}): AdEntry {
  return {
    id: "a1",
    platform: "meta",
    name: "Portones",
    goal: "awareness",
    source: { kind: "fb_post", postId: "111_222", text: "hola", image: "", permalink: "" },
    ext: { campaignId: "c1", adSetId: "s1", creativeId: "cr1", adId: "ad1" },
    status: "active",
    dailyCents: 500,
    totalCents: 3500,
    startsAt: "2026-10-05T00:00:00Z",
    endsAt: "2026-10-12T00:00:00Z",
    targeting: { lat: 12.1, lng: -86.2, radiusKm: 15, ageMin: null, ageMax: null, interests: [], place: "Managua", cityKey: "" },
    specialCategory: "NONE",
    createdAt: "2026-10-05T00:00:00Z",
    createdBy: "owner",
    errors: [],
    ...over,
  };
}

const insights = (spent: number, today = 0, month = spent) => ({ spentCents: spent, todayCents: today, monthCents: month, impressions: 0, reach: 0, clicks: 0, results: 0, fetchedAt: NOW.toISOString() });

describe("dinero y topes", () => {
  it("lee y escribe dólares", () => {
    expect(parseMoney("12.5")).toBe(1250);
    expect(parseMoney("$1,000")).toBe(100000);
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("1.234")).toBeNull();
    expect(money(1250)).toBe("$12.50");
    expect(money(500)).toBe("$5");
    expect(maxSpendCents(500, 7)).toBe(3500);
  });

  it("un anuncio vivo o pausado ocupa su total; uno terminado, lo que gastó", () => {
    expect(committedCents(ad({ status: "paused" }))).toBe(3500);
    expect(committedCents(ad({ status: "ended", insights: insights(1200) }))).toBe(1200);
    expect(campaignRoomCents(10000, [ad(), ad({ id: "a2", status: "ended", insights: insights(1000) })])).toBe(10000 - 3500 - 1000);
    expect(campaignRoomCents(1000, [ad()])).toBe(0);
  });

  it("lo comprometido del mes cuenta lo que aún pueden gastar", () => {
    const month = "2026-10";
    expect(monthCommittedCents([ad({ insights: insights(1000, 0, 1000) })], month)).toBe(3500);
    // Ya gastó 1000 el mes pasado: este mes puede gastar como mucho 2500.
    expect(monthCommittedCents([ad({ insights: insights(1000, 0, 0) })], month)).toBe(2500);
    expect(monthCommittedCents([ad({ status: "ended", insights: insights(700, 0, 700) })], month)).toBe(700);
  });

  const base: NewAdCheck = {
    dailyCents: 500,
    days: 7,
    startsAt: NOW,
    campaign: { status: "active", budgetCents: 10000, endsAt: new Date("2026-10-31T00:00:00Z") },
    items: [],
    monthCommittedCents: 0,
    monthlyCapCents: 20000,
    dailyCapCents: 0,
    radiusKm: 15,
    specialCategory: "NONE",
    ageMin: null,
    ageMax: null,
  };

  it("un anuncio dentro de todos los límites pasa", () => {
    expect(checkNewAd(base)).toEqual([]);
  });

  it("no deja pasar el total de la campaña, el mes, el día ni la fecha de fin", () => {
    expect(checkNewAd({ ...base, items: [ad({ totalCents: 8000 })] }).map((p) => p.en).join()).toMatch(/only has \$20 left/);
    expect(checkNewAd({ ...base, monthlyCapCents: 0 }).length).toBeGreaterThan(0);
    expect(checkNewAd({ ...base, monthCommittedCents: 18000 }).map((p) => p.en).join()).toMatch(/monthly maximum/);
    expect(checkNewAd({ ...base, dailyCapCents: 800, items: [ad({ totalCents: 0, dailyCents: 400 })] }).map((p) => p.en).join()).toMatch(/daily cap/);
    expect(checkNewAd({ ...base, days: 40 }).map((p) => p.en).join()).toMatch(/after the campaign/);
    expect(checkNewAd({ ...base, dailyCents: 50 }).length).toBeGreaterThan(0);
    expect(checkNewAd({ ...base, campaign: { ...base.campaign, budgetCents: 0 } }).length).toBeGreaterThan(0);
    expect(checkNewAd({ ...base, campaign: { ...base.campaign, status: "stopped" } }).length).toBeGreaterThan(0);
  });

  it("categoría especial (seguros): sin edades y radio mínimo de 25 km", () => {
    const special = { ...base, specialCategory: "FINANCIAL_PRODUCTS_SERVICES" as const };
    expect(checkNewAd({ ...special, radiusKm: 10 }).map((p) => p.en).join()).toMatch(/25 to 80/);
    expect(checkNewAd({ ...special, radiusKm: 30, ageMin: 30 }).map((p) => p.en).join()).toMatch(/ages/);
    expect(checkNewAd({ ...special, radiusKm: 30 })).toEqual([]);
    expect(guessSpecialCategory("Ajustador público de reclamos de seguro en Florida")).toBe("FINANCIAL_PRODUCTS_SERVICES");
    expect(guessSpecialCategory("Cortinas metálicas y portones en Managua")).toBe("NONE");
  });

  it("encender pide campaña activa y que quede dinero", () => {
    const ctx = { campaignStatus: "active", campaignBudgetCents: 10000, campaignSpentCents: 0, campaignEndsAt: null, monthlyCapCents: 20000, monthSpentCents: 0, now: NOW };
    expect(checkActivate(ad({ status: "paused" }), ctx)).toEqual([]);
    expect(checkActivate(ad({ status: "paused" }), { ...ctx, campaignStatus: "paused" }).length).toBe(1);
    expect(checkActivate(ad({ status: "paused" }), { ...ctx, monthSpentCents: 20000 }).length).toBe(1);
    expect(checkActivate(ad({ status: "paused" }), { ...ctx, campaignSpentCents: 10000 }).length).toBe(1);
    expect(checkActivate(ad({ status: "paused", ext: {} }), ctx).length).toBe(1);
  });

  it("Campaign.ads guardado con basura se lee seguro (la IA no crea anuncios por defecto)", () => {
    const r = readCampaignAds({ items: [{ id: "x", status: "rocket", totalCents: "900" }, { nope: 1 }], aiCanCreate: "yes" });
    expect(r.aiCanCreate).toBe(false);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].status).toBe("paused");
    expect(r.items[0].totalCents).toBe(900);
    expect(readCampaignAds(null)).toEqual({ aiCanCreate: false, dailyCapCents: 0, items: [], proposals: [] });
  });
});

describe("decisiones del motor", () => {
  const campaign = { status: "active", budgetCents: 10000, spentCents: 0, endsAt: null, dailyCapCents: 0 };
  const run = (over: Partial<Parameters<typeof decideAds>[0]> = {}) =>
    decideAds({ campaign, items: [ad({ insights: insights(1000, 100) })], monthlyCapCents: 20000, monthSpentCents: 1000, now: NOW, today: "2026-10-08", ...over });

  it("todo en orden: no hace nada", () => {
    expect(run()).toEqual([]);
  });

  it("parada de emergencia: campaña parada, pausada, terminada o en borrador pausa todo", () => {
    for (const status of ["stopped", "paused", "ended", "draft"])
      expect(run({ campaign: { ...campaign, status } })).toEqual([{ adId: "a1", action: "pause", reason: "campaign" }]);
    expect(run({ campaign: { ...campaign, endsAt: new Date("2026-10-01T00:00:00Z") } })[0]).toMatchObject({ action: "pause", reason: "ended" });
  });

  it("pausa al llegar al presupuesto de la campaña o al máximo del mes", () => {
    expect(run({ campaign: { ...campaign, spentCents: 10000 } })[0]).toMatchObject({ action: "pause", reason: "budget" });
    expect(run({ monthSpentCents: 20000 })[0]).toMatchObject({ action: "pause", reason: "monthly" });
    expect(run({ monthlyCapCents: 0 })[0]).toMatchObject({ action: "pause", reason: "monthly" });
  });

  it("termina el anuncio que gastó su total o llegó a su fecha", () => {
    expect(run({ items: [ad({ insights: insights(3500) })] })[0]).toMatchObject({ action: "end", reason: "budget" });
    expect(run({ items: [ad({ endsAt: "2026-10-08T00:00:00Z" })] })[0]).toMatchObject({ action: "end", reason: "ended" });
  });

  it("tope del día: pausa hoy y vuelve a encender mañana", () => {
    const capped = run({ items: [ad({ insights: insights(1000, 500) })] });
    expect(capped).toEqual([{ adId: "a1", action: "pause", reason: "daily" }]);
    const after = applyDecision(ad(), capped[0], "2026-10-08");
    expect(after).toMatchObject({ status: "capped_today", cappedDay: "2026-10-08" });
    expect(run({ items: [after], today: "2026-10-08" })).toEqual([]);
    expect(run({ items: [after], today: "2026-10-09" })).toEqual([{ adId: "a1", action: "resume", reason: "daily" }]);
    expect(applyDecision(after, { adId: "a1", action: "resume", reason: "daily" }, "2026-10-09")).toMatchObject({ status: "active" });
    // Tope diario de la campaña (suma de todos los anuncios).
    expect(run({ campaign: { ...campaign, dailyCapCents: 100 } })[0]).toMatchObject({ reason: "daily" });
  });

  it("al día siguiente NO enciende si la campaña se paró mientras tanto", () => {
    const after = ad({ status: "capped_today", cappedDay: "2026-10-07", pausedReason: "daily" });
    expect(run({ items: [after], campaign: { ...campaign, status: "stopped" } })).toEqual([{ adId: "a1", action: "pause", reason: "campaign" }]);
  });

  it("nunca enciende lo que pausó el dueño", () => {
    expect(run({ items: [ad({ status: "paused", pausedReason: "owner" })] })).toEqual([]);
  });
});

describe("pedidos a Meta (armados sin llamar)", () => {
  it("la campaña se crea APAGADA con su categoría especial", () => {
    const p = campaignParams(ad(), "US");
    expect(p.status).toBe("PAUSED");
    expect(p.objective).toBe("OUTCOME_AWARENESS");
    expect(JSON.parse(p.special_ad_categories)).toEqual([]);
    expect(p.special_ad_category_country).toBeUndefined();
    const s = campaignParams(ad({ specialCategory: "FINANCIAL_PRODUCTS_SERVICES" }), "US");
    expect(JSON.parse(s.special_ad_categories)).toEqual(["FINANCIAL_PRODUCTS_SERVICES"]);
    expect(JSON.parse(s.special_ad_category_country!)).toEqual(["US"]);
  });

  it("el conjunto lleva presupuesto TOTAL, fechas, radio en km y está APAGADO", () => {
    const p = adSetParams(ad({ targeting: { ...ad().targeting, ageMin: 25, ageMax: 54, interests: [{ id: "6003", name: "Home" }] } }), "c1", "page1");
    expect(p.lifetime_budget).toBe("3500");
    expect(p.daily_budget).toBeUndefined();
    expect(p.end_time).toBe("2026-10-12T00:00:00Z");
    expect(p.status).toBe("PAUSED");
    expect(p.optimization_goal).toBe("REACH");
    expect(JSON.parse(p.promoted_object)).toEqual({ page_id: "page1" });
    const tg = JSON.parse(p.targeting);
    expect(tg.geo_locations.custom_locations[0]).toEqual({ latitude: 12.1, longitude: -86.2, radius: 15, distance_unit: "kilometer" });
    expect(tg.targeting_automation).toEqual({ advantage_audience: 0 });
    expect(tg.age_min).toBe(25);
    expect(tg.flexible_spec[0].interests[0].id).toBe("6003");
  });

  it("categoría especial: sin edades ni intereses; ciudad cuando no hay punto en el mapa", () => {
    const tg = targetingSpec(ad({ specialCategory: "HOUSING", targeting: { ...ad().targeting, ageMin: 30, interests: [{ id: "1", name: "x" }], cityKey: "2673660", radiusKm: 10 } }));
    expect(tg.age_min).toBeUndefined();
    expect(tg.flexible_spec).toBeUndefined();
    expect(tg.geo_locations).toEqual({ cities: [{ key: "2673660", radius: 17, distance_unit: "kilometer" }] });
  });

  it("llamadas y mensajes: anuncio nuevo con su botón", () => {
    expect(goalFitsSource("calls", "fb_post")).toBe(false);
    expect(goalFitsSource("engagement", "new")).toBe(false);
    expect(goalFitsSource("traffic", "ig_post")).toBe(true);
    const calls = ad({ goal: "calls", source: { kind: "new", text: "Llámanos", headline: "Portones", image: "https://x/img.jpg", link: "" } });
    const spec = JSON.parse(creativeParams(calls, { pageId: "p1", phone: "+505 8888-7777", website: "https://fameseg.com" }).object_story_spec);
    expect(spec.link_data.call_to_action).toEqual({ type: "CALL_NOW", value: { link: "tel:+50588887777" } });
    expect(() => creativeParams(calls, { pageId: "p1", phone: "" })).toThrow();
    const set = adSetParams(calls, "c1", "p1");
    expect(set.destination_type).toBe("PHONE_CALL");
    expect(set.optimization_goal).toBe("QUALITY_CALL");
    expect(creativeParams(ad(), { pageId: "111" }).object_story_id).toBe("111_222");
    expect(creativeParams(ad({ source: { kind: "ig_post", mediaId: "m9", text: "", image: "", permalink: "" } }), { pageId: "p1", igUserId: "ig1" })).toMatchObject({ source_instagram_media_id: "m9", instagram_user_id: "ig1" });
    expect(adParams(ad(), "s1", "cr1")).toMatchObject({ status: "PAUSED", adset_id: "s1" });
  });

  it("crea los 4 pasos APAGADOS y nunca enciende nada (fetch simulado)", async () => {
    const calls: { url: string; body: URLSearchParams }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: new URLSearchParams(String(init.body)) });
      return new Response(JSON.stringify({ id: `id${calls.length}` }), { status: 200 });
    }));
    const ext = await createMetaAd(ad({ ext: {} }), { token: "tok", adAccountId: "999", pageId: "111", country: "NI" });
    expect(ext).toEqual({ campaignId: "id1", adSetId: "id2", creativeId: "id3", adId: "id4" });
    expect(calls.map((c) => c.url)).toEqual([
      "https://graph.facebook.com/v26.0/act_999/campaigns",
      "https://graph.facebook.com/v26.0/act_999/adsets",
      "https://graph.facebook.com/v26.0/act_999/adcreatives",
      "https://graph.facebook.com/v26.0/act_999/ads",
    ]);
    for (const c of calls) expect(c.body.get("status") ?? "PAUSED").toBe("PAUSED");
    expect(calls.some((c) => c.body.get("status") === "ACTIVE")).toBe(false);
    expect(calls[0].body.get("access_token")).toBe("tok");
  });

  it("si un paso falla, devuelve los ids que sí se crearon", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++n === 2 ? new Response(JSON.stringify({ error: { message: "Invalid budget" } }), { status: 400 }) : new Response(JSON.stringify({ id: `id${n}` })))));
    const err = await createMetaAd(ad({ ext: {} }), { token: "t", adAccountId: "act_9", pageId: "1", country: "" }).catch((e) => e);
    expect(err).toBeInstanceOf(MetaStepError);
    expect(err.step).toBe("adset");
    expect(err.ext).toEqual({ campaignId: "id1" });
    expect(err.message).toMatch(/Invalid budget/);
  });

  it("pausar apaga primero la campaña; basta con que una de las dos responda", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return url.endsWith("/ad1") ? new Response("{}", { status: 500 }) : new Response("{}");
    }));
    await pauseMetaAd(ad().ext, "t");
    expect(urls).toEqual(["https://graph.facebook.com/v26.0/c1", "https://graph.facebook.com/v26.0/ad1"]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "down" } }), { status: 500 })));
    await expect(pauseMetaAd(ad().ext, "t")).rejects.toThrow(/down/);
  });

  it("lee lo gastado en centavos y los resultados según el objetivo", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const preset = new URL(url).searchParams.get("date_preset");
      const row = preset === "maximum" ? { spend: "12.34", impressions: "5000", reach: "3200", clicks: "80", actions: [{ action_type: "click_to_call_call_confirm", value: "6" }] } : preset === "today" ? { spend: "1.5" } : { spend: "10" };
      return new Response(JSON.stringify({ data: [row] }));
    }));
    const i = await fetchMetaInsights("ad1", "calls", "t", NOW);
    expect(i).toMatchObject({ spentCents: 1234, todayCents: 150, monthCents: 1000, reach: 3200, clicks: 80, results: 6 });
    expect(resultsFrom("awareness", { reach: "99" })).toBe(99);
    expect(costPerResultCents(ad({ goal: "awareness", insights: { ...insights(900), reach: 6000 } }))).toBe(150);
    expect(costPerResultCents(ad({ goal: "calls", insights: { ...insights(1500), results: 6 } }))).toBe(250);
    expect(costPerResultCents(ad({ goal: "calls", insights: insights(1500) }))).toBeNull();
    expect(resultsFrom("traffic", { inline_link_clicks: "7" })).toBe(7);
  });
});

describe("encender pide la confirmación exacta", () => {
  it("si el máximo confirmado no coincide, no llama a Meta", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    findFirst.mockResolvedValue({ id: "c1", status: "active", budgetCents: 10000, spentCents: 0, endsAt: null, ads: { items: [ad({ status: "paused" })] } });
    const { activateAd } = await import("@/lib/ads");
    await expect(activateAd("b1", "c1", "a1", 999, NOW)).rejects.toThrow(/confirmación/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("propuestas de la IA", () => {
  const ctx: ProposalContext = {
    business: { name: "Fameseg", website: "https://fameseg.com", phone: "", aiProfile: "" },
    campaign: { name: "Octubre", goal: "llamadas", keywords: [], budgetCents: 3000, roomCents: 3000, daysLeft: 10 },
    keywords: ["cortinas metálicas managua"],
    plan: [],
    posts: [{ kind: "fb_post", id: "1_2", text: "Cortinas", image: "", permalink: "", createdAt: "", engagement: 9 }],
    special: "NONE",
    place: "Managua",
    lang: "es",
  };
  const raw = (over: object = {}) => ({
    title: "Promocionar",
    why: "porque",
    goal: "awareness" as const,
    postRef: "1_2",
    text: "",
    headline: "",
    radiusKm: 200,
    ageMin: 10,
    ageMax: 70,
    interests: ["Home"],
    dailyUsd: 10,
    days: 30,
    reachLow: 1000,
    reachHigh: 3000,
    keywords: ["cortinas"],
    ...over,
  });

  it("recorta días, radio, edades y gasto al presupuesto que queda", () => {
    const [p, q] = toProposals({ proposals: [raw(), raw({ postRef: "", goal: "calls" })] }, ctx, "t");
    expect(p.days).toBe(10);
    expect(p.radiusKm).toBe(80);
    expect(p.ageMin).toBe(18);
    expect(p.ageMax).toBe(65);
    expect(p.dailyCents * p.days).toBeLessThanOrEqual(3000);
    expect(p.postKind).toBe("fb_post");
    expect(p.text).toBe("Cortinas");
    // Sin teléfono no propone llamadas; y ya no queda presupuesto para la segunda.
    expect(q).toBeUndefined();
    const [only] = toProposals({ proposals: [raw({ postRef: "", goal: "calls", dailyUsd: 1, days: 3 })] }, ctx, "t");
    expect(only.goal).toBe("messages");
  });

  it("con categoría especial quita edades e intereses y sube el radio", () => {
    const [p] = toProposals({ proposals: [raw({ radiusKm: 5 })] }, { ...ctx, special: "FINANCIAL_PRODUCTS_SERVICES" }, "t");
    expect(p).toMatchObject({ ageMin: null, ageMax: null, interests: [], radiusKm: 25 });
  });
});

describe("plan de Google Ads", () => {
  const plan = () =>
    buildGooglePlan({
      business: { name: "Fameseg Cortinas Metálicas", website: "https://fameseg.com", phone: "+505 2222 3333" },
      tracked: ["cortinas metálicas managua", "portones automáticos nicaragua", "mantenimiento de cortinas metálicas", "cortinas tubulares managua"],
      rows: [{ keyword: "cortinas metálicas managua", volume: 210, cpc: 0.8, competition: "low", competitionIndex: 10, trend: [] }],
      ideas: [
        { keyword: "cortinas metalicas precio", volume: 90, cpc: 0.5, competition: "low", competitionIndex: 5, trend: [] },
        { keyword: "cortinas metalicas usadas", volume: 50, cpc: 0.2, competition: "low", competitionIndex: 5, trend: [] },
      ],
      related: ["portones automáticos precio"],
      places: ["Managua,Managua,Nicaragua", "Nicaragua"],
      language: "es",
      now: NOW,
    });

  it("agrupa por tema sin la ciudad", () => {
    expect(themeOf("cortinas metálicas managua", ["Managua, Nicaragua"])).toBe("cortinas");
    expect(themeOf("mantenimiento de cortinas", [])).toBe("mantenimiento");
    const p = plan();
    expect(p.groups.map((g) => g.name)).toEqual(expect.arrayContaining(["Cortinas", "Portones", "Mantenimiento"]));
    const cortinas = p.groups.find((g) => g.name === "Cortinas")!;
    expect(cortinas.keywords.find((k) => k.text === "cortinas metalicas precio")?.match).toBe("exact");
    expect(p.groups.find((g) => g.name === "Portones")!.keywords.map((k) => k.text)).toContain("portones automáticos precio");
    expect(p.negatives).toContain("empleo");
    // Una idea que choca con una negativa ("usado" → "usadas") no entra.
    expect(cortinas.keywords.map((k) => k.text)).not.toContain("cortinas metalicas usadas");
  });

  it("títulos ≤30 letras (15) y descripciones ≤90 (4), sin repetir", () => {
    for (const g of plan().groups) {
      expect(g.headlines.length).toBe(15);
      expect(g.descriptions.length).toBe(4);
      expect(g.headlines.every((h) => h.length <= HEADLINE_MAX)).toBe(true);
      expect(g.descriptions.every((d) => d.length <= DESCRIPTION_MAX)).toBe(true);
      expect(new Set(g.headlines.map((h) => h.toLowerCase())).size).toBe(g.headlines.length);
    }
    expect(fitText("Cortinas metálicas en Managua para tu negocio", 30)).toBe("Cortinas metálicas en Managua");
    expect(fitText("Supercalifragilisticoespialidoso-extra-largo", 30)).toBe("");
    expect(fitList(["Hola", "hola", "Adiós"], 30, 5)).toEqual(["Hola", "Adiós"]);
  });

  it("los textos de la IA que no caben se descartan", () => {
    const p = plan();
    const merged = mergeGoogleTexts(p, { groups: [{ name: "Cortinas", headlines: ["Cortinas metálicas Managua", "x".repeat(31)], descriptions: ["y".repeat(91), "Reparamos cortinas en Managua."] }], negatives: ["Gratis", "diy"] });
    const g = merged.groups.find((x) => x.name === "Cortinas")!;
    expect(g.headlines[0]).toBe("Cortinas metálicas Managua");
    expect(g.headlines.some((h) => h.length > 30)).toBe(false);
    expect(g.descriptions[0]).toBe("Reparamos cortinas en Managua.");
    expect(merged.source).toBe("ai");
    expect(merged.negatives.filter((n) => n === "gratis")).toHaveLength(1);
  });

  it("presupuesto sugerido con el costo por clic", () => {
    const p = plan();
    expect(p.avgCpc).toBe(0.65);
    expect(p.dailyBudgetCents).toBe(500);
  });

  it("CSV para Google Ads Editor: todo en pausa, comillas escapadas", () => {
    const p = plan();
    p.groups[0].headlines[0] = 'Dijo "hola", ok';
    const csv = googlePlanCsv(p);
    const lines = csv.trim().split("\r\n");
    expect(lines[0].startsWith("Campaign,Campaign Type,Networks,Budget")).toBe(true);
    expect(lines[0]).toContain("Headline 15");
    expect(lines[0]).toContain("Description 4");
    expect(lines[1]).toContain("Search");
    expect(lines[1]).toContain("Paused");
    expect(csv).toContain('"Dijo ""hola"", ok"');
    expect(csv).toContain("Campaign Negative Phrase");
    expect(csv).toContain("Responsive search ad");
    const cols = lines[0].split(",").length;
    expect(lines.filter((l) => !l.includes('"')).every((l) => l.split(",").length === cols)).toBe(true);
  });
});

describe("Conectar anuncios (permiso aparte de Meta)", () => {
  it("pide los permisos de anuncios con su propio propósito, sin tocar el de la página", async () => {
    const { authUrl, metaStatePurpose, readState } = await import("@/lib/meta-oauth");
    const u = new URL(authUrl("biz1", "ads"));
    expect(u.searchParams.get("scope")).toContain("ads_management");
    expect(u.searchParams.get("scope")).toContain("ads_read");
    expect(u.searchParams.get("scope")).toContain("business_management");
    expect(metaStatePurpose(readState(u.searchParams.get("state")!)!)).toEqual({ purpose: "ads", businessId: "biz1" });
    const page = new URL(authUrl("biz1"));
    expect(page.searchParams.get("scope")).not.toContain("ads_management");
    expect(metaStatePurpose(readState(page.searchParams.get("state")!)!)).toEqual({ purpose: "page", businessId: "biz1" });
  });
});
