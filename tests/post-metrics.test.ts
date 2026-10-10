import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// La base de datos y el descifrado se reemplazan: estas pruebas nunca tocan la base ni las redes.
const fake = vi.hoisted(() => ({
  targets: [] as unknown[],
  conns: [] as unknown[],
  created: [] as { data: Record<string, unknown> }[],
  updated: [] as unknown[],
}));
vi.mock("@/lib/db", () => ({
  db: {
    postTarget: {
      findMany: vi.fn(async () => fake.targets),
      update: vi.fn(async (a: unknown) => {
        fake.updated.push(a);
        return a;
      }),
    },
    connection: { findMany: vi.fn(async () => fake.conns) },
    postMetric: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => {
        fake.created.push(a);
        return a.data;
      }),
    },
  },
}));
vi.mock("@/lib/crypto", () => ({ decryptJson: (s: string) => JSON.parse(s) }));

import { fetchFacebook, fetchInstagram, fetchX, fetchYoutube, syncPostMetrics } from "@/lib/post-metrics";
import {
  CHECKPOINTS_MS,
  dueCheckpoint,
  externalIdFromUrl,
  fbPostInsightsUrl,
  igInsightsUrl,
  igMetricsFor,
  isRateLimit,
  metricChannels,
  parseFacebookPost,
  parseInsights,
  parseInstagram,
  parseXMetrics,
  parseYoutubeStats,
  plainMetricError,
  xMetricsUrl,
  ytStatsUrl,
} from "@/lib/post-metrics-shape";

type Call = { url: string; init: RequestInit };
function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
  return calls;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const H = 3_600_000;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Respuestas con la forma real de la Graph API.
const FB_FIELDS = { shares: { count: 4 }, comments: { data: [], summary: { order: "ranked", total_count: 7, can_comment: true } }, reactions: { data: [], summary: { total_count: 31, viewer_reaction: "NONE" } }, id: "111_222" };
const FB_INSIGHTS = {
  data: [
    { name: "post_media_view", period: "lifetime", values: [{ value: 1540 }], title: "Lifetime Post Media Views", id: "111_222/insights/post_media_view/lifetime" },
    { name: "post_total_media_view_unique", period: "lifetime", values: [{ value: 980 }], id: "111_222/insights/post_total_media_view_unique/lifetime" },
    { name: "post_clicks", period: "lifetime", values: [{ value: 45 }], id: "111_222/insights/post_clicks/lifetime" },
  ],
};
const IG_FIELDS = { like_count: 52, comments_count: 6, media_type: "VIDEO", media_product_type: "REELS", id: "1789" };
const IG_INSIGHTS = {
  data: ["reach:2100", "views:3400", "likes:55", "comments:6", "shares:12", "saved:9", "total_interactions:82"].map((x) => {
    const [name, v] = x.split(":");
    return { name, period: "lifetime", values: [{ value: Number(v) }], id: `1789/insights/${name}/lifetime` };
  }),
};

describe("cuándo se leen los resultados", () => {
  const sent = new Date("2026-10-01T15:00:00Z");
  const at = (ms: number) => new Date(sent.getTime() + ms);
  it("nada antes de la primera hora", () => {
    expect(dueCheckpoint(sent, null, at(59 * 60_000))).toBeNull();
  });
  it("1 h, 24 h, 72 h, 7 días y 30 días", () => {
    expect(CHECKPOINTS_MS.map((c) => c / H)).toEqual([1, 24, 72, 168, 720]);
    expect(dueCheckpoint(sent, null, at(1 * H))).toBe(0);
    expect(dueCheckpoint(sent, null, at(30 * H))).toBe(1);
    expect(dueCheckpoint(sent, null, at(80 * H))).toBe(2);
    expect(dueCheckpoint(sent, null, at(8 * 24 * H))).toBe(3);
    expect(dueCheckpoint(sent, null, at(30 * 24 * H + H))).toBe(4);
  });
  it("no repite un punto ya leído (aunque la lectura haya fallado) y sí lee el siguiente", () => {
    expect(dueCheckpoint(sent, at(2 * H), at(5 * H))).toBeNull();
    expect(dueCheckpoint(sent, at(2 * H), at(25 * H))).toBe(1);
    expect(dueCheckpoint(sent, at(25 * H), at(71 * H))).toBeNull();
  });
  it("si el cron no corrió, una sola lectura cubre el punto más reciente", () => {
    expect(dueCheckpoint(sent, null, at(10 * 24 * H))).toBe(3);
  });
  it("después de 32 días ya no se lee", () => {
    expect(dueCheckpoint(sent, at(8 * 24 * H), at(33 * 24 * H))).toBeNull();
  });
});

describe("id de la red a partir del enlace (publicaciones de antes)", () => {
  it("Facebook (enlace de la app), YouTube, X y LinkedIn", () => {
    expect(externalIdFromUrl("facebook", "https://www.facebook.com/1234_5678")).toBe("1234_5678");
    expect(externalIdFromUrl("facebook", "https://www.facebook.com/permalink.php?story_fbid=1&id=2")).toBe("");
    expect(externalIdFromUrl("youtube", "https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(externalIdFromUrl("youtube", "https://www.youtube.com/shorts/abcDEF12345")).toBe("abcDEF12345");
    expect(externalIdFromUrl("x", "https://x.com/i/web/status/1830000000000000001")).toBe("1830000000000000001");
    expect(externalIdFromUrl("linkedin", "https://www.linkedin.com/feed/update/urn:li:share:7100000000000000000/")).toBe("urn:li:share:7100000000000000000");
  });
  it("Instagram, Google y TikTok no se pueden sacar del enlace", () => {
    expect(externalIdFromUrl("instagram", "https://www.instagram.com/p/C9xYz12AbCd/")).toBe("");
    expect(externalIdFromUrl("google", "https://local.google.com/place?id=1&use=posts&lpsid=2")).toBe("");
    expect(externalIdFromUrl("tiktok", "https://www.tiktok.com/@fameseg")).toBe("");
  });
});

describe("pedidos y respuestas de cada red", () => {
  it("Facebook pide las métricas que siguen vivas (no post_impressions)", () => {
    const u = new URL(fbPostInsightsUrl("111_222", "tok"));
    expect(u.pathname).toBe("/v24.0/111_222/insights");
    expect(u.searchParams.get("metric")).toBe("post_media_view,post_total_media_view_unique,post_clicks");
    expect(u.searchParams.get("metric")).not.toContain("post_impressions");
  });
  it("Facebook: lee totales y estadísticas", () => {
    const v = parseFacebookPost(FB_FIELDS, parseInsights(FB_INSIGHTS));
    expect(v).toMatchObject({ likes: 31, comments: 7, shares: 4, impressions: 1540, reach: 980, clicks: 45 });
    expect(parseFacebookPost(FB_FIELDS, null)).toMatchObject({ likes: 31, reach: 0 });
  });
  it("insights con total_value y con valores por tipo", () => {
    expect(parseInsights({ data: [{ name: "reach", total_value: { value: 77 } }, { name: "post_reactions_by_type_total", values: [{ value: { like: 3, love: 2 } }] }] })).toEqual({ reach: 77, post_reactions_by_type_total: 5 });
    expect(parseInsights({ error: { message: "x" } })).toEqual({});
  });
  it("Instagram: las historias piden otras métricas; «views» reemplaza a impressions", () => {
    expect(igMetricsFor("STORY")).toEqual(["reach", "views", "shares", "replies"]);
    expect(new URL(igInsightsUrl("1789", "t", "REELS")).searchParams.get("metric")).toBe("reach,views,likes,comments,shares,saved,total_interactions");
    expect(igMetricsFor("FEED")).not.toContain("impressions");
    const v = parseInstagram(IG_FIELDS, parseInsights(IG_INSIGHTS));
    expect(v).toMatchObject({ reach: 2100, impressions: 3400, likes: 55, comments: 6, shares: 12, saves: 9, videoViews: 3400 });
    expect(parseInstagram({ like_count: 5, comments_count: 1, media_product_type: "STORY" }, { reach: 40, views: 60, replies: 2, shares: 1 })).toMatchObject({ comments: 2, likes: 5, videoViews: 0 });
  });
  it("YouTube: varios videos en un pedido", () => {
    const u = new URL(ytStatsUrl(["a1", "b2"]));
    expect(u.pathname).toBe("/youtube/v3/videos");
    expect(u.searchParams.get("part")).toBe("statistics");
    expect(u.searchParams.get("id")).toBe("a1,b2");
    expect(parseYoutubeStats({ kind: "youtube#videoListResponse", items: [{ kind: "youtube#video", id: "a1", statistics: { viewCount: "1200", likeCount: "40", favoriteCount: "0", commentCount: "5" } }] })).toEqual({
      a1: { impressions: 0, reach: 0, likes: 40, comments: 5, shares: 0, saves: 0, clicks: 0, videoViews: 1200 },
    });
  });
  it("X: public_metrics", () => {
    expect(new URL(xMetricsUrl(["1", "2"])).searchParams.get("tweet.fields")).toBe("public_metrics");
    expect(parseXMetrics({ data: [{ id: "1", text: "hola", public_metrics: { retweet_count: 2, reply_count: 1, like_count: 9, quote_count: 1, bookmark_count: 3, impression_count: 410 } }] })["1"]).toMatchObject({
      impressions: 410,
      likes: 9,
      comments: 1,
      shares: 3,
      saves: 3,
    });
  });
  it("X solo se lee si el dueño lo enciende (cobra por lectura)", () => {
    expect(metricChannels({})).toEqual(["facebook", "instagram", "youtube"]);
    expect(metricChannels({ X_METRICS: "on" })).toContain("x");
  });
  it("errores en palabras claras", () => {
    expect(isRateLimit("400: (#4) Application request limit reached")).toBe(true);
    expect(isRateLimit("429: Too Many Requests")).toBe(true);
    expect(plainMetricError("facebook", "190: Error validating access token")).toMatch(/Vuelve a conectarla/);
    expect(plainMetricError("instagram", "404: Unsupported get request")).toMatch(/ya no encuentra/);
  });
});

describe("leer cada red (con fetch simulado)", () => {
  it("Facebook: dos pedidos con el token de la página", async () => {
    const calls = mockFetch((url) => json(url.includes("/insights") ? FB_INSIGHTS : FB_FIELDS));
    const r = await fetchFacebook("111_222", { pageId: "111", accessToken: "PAGE_TOK" });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/v24.0/111_222?");
    expect(new URL(calls[0].url).searchParams.get("access_token")).toBe("PAGE_TOK");
    expect(r.ok && r.values.reach).toBe(980);
  });
  it("Facebook sin permiso de estadísticas: guarda lo básico y explica qué falta", async () => {
    mockFetch((url) => (url.includes("/insights") ? json({ error: { message: "(#200) Requires read_insights permission", type: "OAuthException", code: 200 } }, 403) : json(FB_FIELDS)));
    const r = await fetchFacebook("111_222", { accessToken: "t" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values.likes).toBe(31);
      expect(r.values.reach).toBe(0);
      expect(String(r.raw.insightsError)).toMatch(/read_insights/);
    }
  });
  it("Facebook video (id sin «_»): video_insights", async () => {
    const calls = mockFetch((url) => json(url.includes("video_insights") ? { data: [{ name: "total_video_views", period: "lifetime", values: [{ value: 300 }] }, { name: "total_video_impressions_unique", period: "lifetime", values: [{ value: 250 }] }] } : { likes: { summary: { total_count: 8 } }, comments: { summary: { total_count: 2 } } }));
    const r = await fetchFacebook("987654", { accessToken: "t" });
    expect(calls[1].url).toContain("/987654/video_insights?");
    expect(r.ok && r.values).toMatchObject({ videoViews: 300, reach: 250, likes: 8, comments: 2 });
  });
  it("Instagram: campos y luego las métricas según el tipo", async () => {
    const calls = mockFetch((url) => json(url.includes("/insights") ? IG_INSIGHTS : IG_FIELDS));
    const r = await fetchInstagram("1789", { igUserId: "17", accessToken: "t" });
    expect(new URL(calls[1].url).searchParams.get("metric")).toContain("saved");
    expect(r.ok && r.values.saves).toBe(9);
  });
  it("Instagram con la publicación borrada: error claro", async () => {
    mockFetch(() => json({ error: { message: "Unsupported get request. Object with ID '1789' does not exist" } }, 400));
    const r = await fetchInstagram("1789", { accessToken: "t" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ya no encuentra/);
  });
  it("YouTube: renueva el token y pide todos los videos juntos", async () => {
    const calls = mockFetch((url) => (url.includes("oauth2") ? json({ access_token: "AT" }) : json({ items: [{ id: "v1", statistics: { viewCount: "10", likeCount: "1", commentCount: "0" } }] })));
    const r = await fetchYoutube(["v1", "v2"], { clientId: "c", clientSecret: "s", refreshToken: "r" });
    expect(calls[1].url).toContain("id=v1%2Cv2");
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe("Bearer AT");
    expect(r.v1.ok && r.v1.values.videoViews).toBe(10);
    expect(r.v2.ok).toBe(false);
  });
  it("YouTube sin permiso de lectura: pide volver a conectar", async () => {
    mockFetch((url) => (url.includes("oauth2") ? json({ access_token: "AT" }) : json({ error: { message: "Request had insufficient authentication scopes." } }, 403)));
    const r = await fetchYoutube(["v1"], { clientId: "c", clientSecret: "s", refreshToken: "r" });
    expect(r.v1.ok).toBe(false);
    if (!r.v1.ok) expect(r.v1.error).toMatch(/youtube\.readonly/);
  });
  it("X: firma OAuth 1.0a", async () => {
    const calls = mockFetch(() => json({ data: [{ id: "55", public_metrics: { like_count: 1, impression_count: 20 } }] }));
    const r = await fetchX(["55"], { apiKey: "k", apiSecret: "s", accessToken: "t", accessSecret: "x" });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toMatch(/^OAuth .*oauth_signature=/);
    expect(r["55"].ok && r["55"].values.impressions).toBe(20);
  });
});

describe("syncPostMetrics (base de datos simulada)", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  const target = (id: string, channel: string, hoursAgo: number, extra: Record<string, unknown> = {}) => ({
    id,
    channel,
    externalId: `${id}_ext`,
    externalUrl: "",
    sentAt: new Date(now.getTime() - hoursAgo * H),
    post: { businessId: "biz" },
    metrics: [],
    ...extra,
  });
  beforeEach(() => {
    fake.targets = [];
    fake.conns = [];
    fake.created = [];
    fake.updated = [];
  });

  it("guarda una fila por publicación, con los errores en raw.error y sin lanzar", async () => {
    fake.targets = [target("t1", "facebook", 2), target("t2", "instagram", 30), target("t3", "youtube", 80), target("t4", "facebook", 0.5)];
    fake.conns = [
      { businessId: "biz", channel: "facebook", secret: JSON.stringify({ accessToken: "a" }) },
      { businessId: "biz", channel: "youtube", secret: JSON.stringify({ refreshToken: "r" }) },
    ];
    const sum = await syncPostMetrics(now, {
      fetchFacebook: async () => ({ ok: true, values: { impressions: 1, reach: 2, likes: 3, comments: 0, shares: 0, saves: 0, clicks: 0, videoViews: 0 }, raw: {} }),
      fetchInstagram: async () => {
        throw new Error("no debería llamarse: Instagram no está conectado");
      },
      fetchYoutube: async () => {
        throw new Error("500: backend error");
      },
      fetchX: async () => ({}),
    });
    expect(sum.due).toBe(3);
    expect(fake.created).toHaveLength(3);
    const byTarget = Object.fromEntries(fake.created.map((c) => [c.data.postTargetId, c.data]));
    expect(byTarget.t1).toMatchObject({ reach: 2, likes: 3, channel: "facebook", businessId: "biz" });
    expect((byTarget.t1.raw as Record<string, unknown>).checkpoint).toBe(0);
    expect(String((byTarget.t2.raw as Record<string, unknown>).error)).toMatch(/Instagram/);
    expect(String((byTarget.t3.raw as Record<string, unknown>).error)).toMatch(/YouTube/);
    expect(sum.saved).toBe(1);
    expect(sum.errors).toBe(2);
  });

  it("para una red cuando pide esperar (límite de pedidos)", async () => {
    fake.targets = [target("a", "facebook", 2), target("b", "facebook", 3), target("c", "facebook", 4)];
    fake.conns = [{ businessId: "biz", channel: "facebook", secret: JSON.stringify({ accessToken: "a" }) }];
    let n = 0;
    const sum = await syncPostMetrics(now, {
      fetchFacebook: async () => {
        n++;
        return { ok: false, error: "límite", rateLimited: true };
      },
      fetchInstagram: async () => ({ ok: false, error: "x" }),
      fetchYoutube: async () => ({}),
      fetchX: async () => ({}),
    });
    expect(n).toBe(1);
    expect(sum.stoppedChannels).toEqual(["facebook"]);
  });

  it("publicaciones de antes: saca el id del enlace y lo guarda", async () => {
    fake.targets = [target("old", "youtube", 30, { externalId: "", externalUrl: "https://youtu.be/abcdef12345" }), target("ig", "instagram", 30, { externalId: "", externalUrl: "https://www.instagram.com/p/XYZ/" })];
    fake.conns = [{ businessId: "biz", channel: "youtube", secret: JSON.stringify({ refreshToken: "r" }) }];
    const seen: string[][] = [];
    await syncPostMetrics(now, {
      fetchFacebook: async () => ({ ok: false, error: "x" }),
      fetchInstagram: async () => ({ ok: false, error: "x" }),
      fetchYoutube: async (ids) => {
        seen.push(ids);
        return {};
      },
      fetchX: async () => ({}),
    });
    expect(seen).toEqual([["abcdef12345"]]);
    expect(fake.updated).toEqual([{ where: { id: "old" }, data: { externalId: "abcdef12345" } }]);
    // Instagram sin id: no se puede leer, no se guarda nada.
    expect(fake.created.map((c) => c.data.postTargetId)).toEqual(["old"]);
  });
});

describe("los publicadores devuelven el id de la red (para PostTarget.externalId)", () => {
  const base = { text: "Hola", subject: "", seoTitle: "", mediaType: "none" as const, mediaUrl: "", businessName: "Fameseg", contacts: [] };
  it("Facebook: el post_id del post", async () => {
    const { facebook } = await import("@/lib/publishers/meta");
    mockFetch(() => json({ id: "111_999" }));
    expect((await facebook.publish(base, { pageId: "111", accessToken: "t" })).id).toBe("111_999");
    mockFetch(() => json({ id: "photo1", post_id: "111_555" }));
    expect((await facebook.publish({ ...base, mediaType: "photo", mediaUrl: "https://cdn.test/a.jpg" }, { pageId: "111", accessToken: "t" })).id).toBe("111_555");
  });
  it("Instagram: el id de la publicación (no el del contenedor)", async () => {
    const { instagram } = await import("@/lib/publishers/meta");
    mockFetch((url) => (url.includes("media_publish") ? json({ id: "MEDIA9" }) : url.includes("/media") ? json({ id: "CONT1" }) : json({ status_code: "FINISHED", permalink: "https://www.instagram.com/p/x/" })));
    expect((await instagram.publish({ ...base, mediaType: "photo", mediaUrl: "https://cdn.test/a.jpg" }, { igUserId: "17", accessToken: "t" })).id).toBe("MEDIA9");
  });
  it("Perfil de Google: el nombre de la novedad", async () => {
    const { google } = await import("@/lib/publishers/google");
    mockFetch((url) => (url.includes("oauth2") ? json({ access_token: "a" }) : json({ name: "accounts/1/locations/2/localPosts/3", searchUrl: "https://local.google.com/x" })));
    expect((await google.publish(base, { clientId: "a", clientSecret: "b", refreshToken: "c", accountId: "1", locationId: "2" })).id).toBe("accounts/1/locations/2/localPosts/3");
  });
  it("X: el id de la publicación", async () => {
    const { x } = await import("@/lib/publish-x");
    mockFetch(() => json({ data: { id: "1830", text: "Hola" } }));
    expect((await x.publish(base, { apiKey: "k", apiSecret: "s", accessToken: "t", accessSecret: "x" })).id).toBe("1830");
  });
});
