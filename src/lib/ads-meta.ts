// Anuncios en Facebook e Instagram con la API de Marketing de Meta (v26.0, la más nueva en oct. 2026).
// Flujo mínimo (todo se crea APAGADO; nada gasta hasta que el dueño confirma y se enciende):
//   1. Cuenta de anuncios: GET /me/adaccounts (con el permiso ads_management).
//   2. Campaña: POST /act_<id>/campaigns  objective OUTCOME_*, special_ad_categories, status PAUSED.
//   3. Conjunto de anuncios: POST /act_<id>/adsets  lifetime_budget (centavos) + start_time/end_time (con presupuesto
//      total Meta nunca gasta más que eso), radio alrededor del negocio, optimization_goal, billing_event IMPRESSIONS,
//      bid_strategy LOWEST_COST_WITHOUT_CAP, status PAUSED.
//   4. Creativo: POST /act_<id>/adcreatives  object_story_id (publicación de Facebook "pagina_post"),
//      source_instagram_media_id + instagram_user_id (publicación de Instagram) u object_story_spec (anuncio nuevo).
//   5. Anuncio: POST /act_<id>/ads  status PAUSED.
//   6. Encender (solo tras confirmar): POST /<id> status=ACTIVE en anuncio, conjunto y campaña (la campaña al final).
//   Pausar: POST /<campaña> status=PAUSED (pausa todo lo de adentro) y el anuncio.
//   Resultados: GET /<anuncio>/insights  spend (texto en la moneda de la cuenta), impressions, reach, clicks, actions.
// Docs: developers.facebook.com/docs/marketing-api (reference/ad-campaign-group, ad-campaign, ad-creative, insights,
// audiences/special-ad-category, adset/destination_type, call-ads).
import type { AdEntry, AdGoal, AdInsights, SpecialCategory } from "@/lib/ads-shape";
import { bi } from "@/lib/i18n";
import { fetchJson, form } from "@/lib/publishers/http";

export const ADS_GRAPH = "https://graph.facebook.com/v26.0";

/** Lo que se guarda en la fila Connection "meta_ads" (cifrado). */
export type MetaAdsConn = {
  userToken: string;
  adAccountId: string;
  adAccountName: string;
  currency: string;
  accounts: MetaAdAccount[];
  connectedAt: string;
};

export type MetaAdAccount = { id: string; name: string; currency: string; status: number; country: string };

type GoalSpec = {
  objective: "OUTCOME_AWARENESS" | "OUTCOME_TRAFFIC" | "OUTCOME_ENGAGEMENT";
  optimization: "REACH" | "LINK_CLICKS" | "POST_ENGAGEMENT" | "CONVERSATIONS" | "QUALITY_CALL";
  destination?: "ON_POST" | "MESSENGER" | "PHONE_CALL";
  /** Necesita un anuncio nuevo (con botón de llamar / mandar mensaje) o una publicación existente. */
  source: "any" | "new" | "post";
  pagePromoted: boolean;
};

export const GOAL_SPEC: Record<AdGoal, GoalSpec> = {
  awareness: { objective: "OUTCOME_AWARENESS", optimization: "REACH", source: "any", pagePromoted: true },
  traffic: { objective: "OUTCOME_TRAFFIC", optimization: "LINK_CLICKS", source: "any", pagePromoted: false },
  engagement: { objective: "OUTCOME_ENGAGEMENT", optimization: "POST_ENGAGEMENT", destination: "ON_POST", source: "post", pagePromoted: false },
  messages: { objective: "OUTCOME_ENGAGEMENT", optimization: "CONVERSATIONS", destination: "MESSENGER", source: "new", pagePromoted: true },
  calls: { objective: "OUTCOME_TRAFFIC", optimization: "QUALITY_CALL", destination: "PHONE_CALL", source: "new", pagePromoted: false },
};

/** ¿Este objetivo se puede hacer con esta fuente? (Mensajes y llamadas necesitan un anuncio nuevo con su botón.) */
export function goalFitsSource(goal: AdGoal, kind: AdEntry["source"]["kind"]): boolean {
  const need = GOAL_SPEC[goal].source;
  return need === "any" || (need === "new" ? kind === "new" : kind !== "new");
}

const act = (id: string) => (id.startsWith("act_") ? id : `act_${id}`);
const json = (v: unknown) => JSON.stringify(v);

// ---------- Armar cada pedido (sin llamar a nada: se prueba aparte) ----------

export function campaignParams(a: AdEntry, country: string): Record<string, string> {
  const p: Record<string, string> = {
    name: a.name.slice(0, 200),
    objective: GOAL_SPEC[a.goal].objective,
    status: "PAUSED",
    buying_type: "AUCTION",
    special_ad_categories: json(a.specialCategory === "NONE" ? [] : [a.specialCategory]),
    // Sin presupuesto de campaña: cada conjunto lleva su propio total y no se comparte dinero entre conjuntos.
    is_adset_budget_sharing_enabled: "false",
  };
  if (a.specialCategory !== "NONE" && /^[A-Z]{2}$/.test(country)) p.special_ad_category_country = json([country]);
  return p;
}

export function targetingSpec(a: AdEntry): Record<string, unknown> {
  const t = a.targeting;
  const special = a.specialCategory !== "NONE";
  const spec: Record<string, unknown> = {
    geo_locations: t.cityKey
      ? // Ciudades: Meta acepta un radio de 17 a 80 km.
        { cities: [{ key: t.cityKey, radius: Math.max(17, t.radiusKm), distance_unit: "kilometer" }] }
      : { custom_locations: [{ latitude: t.lat, longitude: t.lng, radius: t.radiusKm, distance_unit: "kilometer" }] },
    // Respetar el radio y las edades que eligió el dueño (sin que Meta amplíe el público por su cuenta).
    targeting_automation: { advantage_audience: 0 },
  };
  if (!special) {
    if (t.ageMin !== null) spec.age_min = Math.max(18, t.ageMin);
    if (t.ageMax !== null) spec.age_max = Math.min(65, t.ageMax);
    if (t.interests.length) spec.flexible_spec = [{ interests: t.interests.map((i) => ({ id: i.id, name: i.name })) }];
  }
  return spec;
}

export function adSetParams(a: AdEntry, campaignId: string, pageId: string): Record<string, string> {
  const g = GOAL_SPEC[a.goal];
  const p: Record<string, string> = {
    name: `${a.name} · ${a.targeting.radiusKm} km`.slice(0, 200),
    campaign_id: campaignId,
    // Presupuesto TOTAL (en centavos de la moneda de la cuenta): Meta no gasta más que esto en todo el anuncio.
    lifetime_budget: String(a.totalCents),
    start_time: a.startsAt,
    end_time: a.endsAt,
    billing_event: "IMPRESSIONS",
    optimization_goal: g.optimization,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: json(targetingSpec(a)),
    status: "PAUSED",
  };
  if (g.destination) p.destination_type = g.destination;
  if (g.pagePromoted) p.promoted_object = json({ page_id: pageId });
  return p;
}

export function creativeParams(a: AdEntry, ctx: { pageId: string; igUserId?: string; phone?: string; website?: string }): Record<string, string> {
  const s = a.source;
  const name = `${a.name} · creativo`.slice(0, 100);
  if (s.kind === "fb_post") {
    const id = s.postId.includes("_") ? s.postId : `${ctx.pageId}_${s.postId}`;
    return { name, object_story_id: id };
  }
  if (s.kind === "ig_post") {
    if (!ctx.igUserId) throw bi("Falta la cuenta de Instagram conectada para promocionar esa publicación.", "The connected Instagram account is missing to promote that post.");
    return { name, source_instagram_media_id: s.mediaId, instagram_user_id: ctx.igUserId, object_id: ctx.pageId };
  }
  const link = s.link || ctx.website || `https://www.facebook.com/${ctx.pageId}`;
  let cta: Record<string, unknown>;
  if (a.goal === "calls") {
    const tel = (ctx.phone ?? "").replace(/[^\d+]/g, "");
    if (tel.replace(/\D/g, "").length < 7) throw bi("Para un anuncio de llamadas falta el teléfono del negocio (en Negocio).", "A call ad needs the business phone (in Business).");
    cta = { type: "CALL_NOW", value: { link: `tel:${tel.startsWith("+") ? tel : `+${tel}`}` } };
  } else if (a.goal === "messages") cta = { type: "MESSAGE_PAGE", value: { app_destination: "MESSENGER" } };
  else cta = { type: "LEARN_MORE", value: { link } };
  const spec: Record<string, unknown> = {
    page_id: ctx.pageId,
    link_data: { message: s.text.slice(0, 2000), link, ...(s.image ? { picture: s.image } : {}), ...(s.headline ? { name: s.headline.slice(0, 80) } : {}), call_to_action: cta },
  };
  if (ctx.igUserId) spec.instagram_user_id = ctx.igUserId;
  return { name, object_story_spec: json(spec) };
}

export function adParams(a: AdEntry, adSetId: string, creativeId: string): Record<string, string> {
  return { name: a.name.slice(0, 200), adset_id: adSetId, creative: json({ creative_id: creativeId }), status: "PAUSED" };
}

// ---------- Llamadas ----------

async function post<T = { id: string }>(path: string, params: Record<string, string>, token: string): Promise<T> {
  return fetchJson<T>(`${ADS_GRAPH}/${path}`, { method: "POST", body: form({ ...params, access_token: token }) });
}
async function get<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  return fetchJson<T>(`${ADS_GRAPH}/${path}?${new URLSearchParams({ ...params, access_token: token })}`);
}

/** Cuentas de anuncios de la persona (solo leer). account_status 1 = activa. */
export async function listAdAccounts(userToken: string): Promise<MetaAdAccount[]> {
  const r = await get<{ data?: { id: string; name?: string; currency?: string; account_status?: number; business_country_code?: string }[] }>(
    "me/adaccounts",
    { fields: "id,name,currency,account_status,business_country_code", limit: "50" },
    userToken,
  );
  return (r.data ?? []).map((x) => ({ id: x.id, name: x.name ?? x.id, currency: x.currency ?? "", status: x.account_status ?? 0, country: x.business_country_code ?? "" }));
}

/** Error al crear: lleva los ids que sí se alcanzaron a crear (todo queda APAGADO, no gasta). */
export class MetaStepError extends Error {
  constructor(
    message: string,
    readonly step: "campaign" | "adset" | "creative" | "ad",
    readonly ext: AdEntry["ext"],
  ) {
    super(message);
  }
}

export type CreateCtx = { token: string; adAccountId: string; pageId: string; igUserId?: string; phone?: string; website?: string; country: string };

/** Crea campaña → conjunto → creativo → anuncio, todo APAGADO. Devuelve los ids de Meta. */
export async function createMetaAd(a: AdEntry, c: CreateCtx): Promise<Required<AdEntry["ext"]>> {
  const ext: AdEntry["ext"] = {};
  const step = async <T>(name: MetaStepError["step"], run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (e) {
      throw new MetaStepError(e instanceof Error ? e.message : String(e), name, { ...ext });
    }
  };
  const account = act(c.adAccountId);
  // El creativo se arma antes de crear nada: si falta el teléfono o Instagram, no se crea nada en Meta.
  const creative = creativeParams(a, c);
  ext.campaignId = (await step("campaign", () => post(`${account}/campaigns`, campaignParams(a, c.country), c.token))).id;
  ext.adSetId = (await step("adset", () => post(`${account}/adsets`, adSetParams(a, ext.campaignId!, c.pageId), c.token))).id;
  ext.creativeId = (await step("creative", () => post(`${account}/adcreatives`, creative, c.token))).id;
  ext.adId = (await step("ad", () => post(`${account}/ads`, adParams(a, ext.adSetId!, ext.creativeId!), c.token))).id;
  return ext as Required<AdEntry["ext"]>;
}

/** Enciende: anuncio, conjunto y al final la campaña (así nada sale a medias). */
export async function activateMetaAd(ext: AdEntry["ext"], token: string): Promise<void> {
  for (const id of [ext.adId, ext.adSetId, ext.campaignId]) if (id) await post(id, { status: "ACTIVE" }, token);
}

/** Pausa: primero la campaña (apaga todo lo de adentro de una vez) y luego el anuncio. */
export async function pauseMetaAd(ext: AdEntry["ext"], token: string): Promise<void> {
  const ids = [ext.campaignId, ext.adId].filter((x): x is string => Boolean(x));
  let ok = 0;
  let firstError: unknown = null;
  for (const id of ids) {
    try {
      await post(id, { status: "PAUSED" }, token);
      ok++;
    } catch (e) {
      firstError ??= e;
    }
  }
  // Cada campaña de Meta tiene un solo anuncio: con que se apague una de las dos, ya no gasta.
  if (ids.length && !ok) throw firstError;
}

type InsightRow = { spend?: string; impressions?: string; reach?: string; clicks?: string; inline_link_clicks?: string; actions?: { action_type: string; value: string }[] };

const cents = (v: string | undefined) => (v ? Math.round(Number(v) * 100) || 0 : 0);
const n = (v: string | undefined) => (v ? Math.round(Number(v)) || 0 : 0);

/** Qué cuenta como "resultado" según el objetivo (tipos de acción de Meta). */
const RESULT_ACTIONS: Record<AdGoal, string[]> = {
  awareness: [],
  traffic: ["link_click"],
  engagement: ["post_engagement"],
  messages: ["onsite_conversion.messaging_conversation_started_7d"],
  calls: ["click_to_call_call_confirm", "click_to_call_native_call_placed", "click_to_call_native_20s_call_connect"],
};

export function resultsFrom(goal: AdGoal, row: InsightRow): number {
  if (goal === "awareness") return n(row.reach);
  if (goal === "traffic" && row.inline_link_clicks) return n(row.inline_link_clicks);
  for (const type of RESULT_ACTIONS[goal]) {
    const hit = row.actions?.find((x) => x.action_type === type);
    if (hit) return n(hit.value);
  }
  return 0;
}

/** Lo gastado y los resultados (desde el inicio, hoy y este mes). Solo lee: no cambia nada en Meta. */
export async function fetchMetaInsights(adId: string, goal: AdGoal, token: string, now = new Date()): Promise<AdInsights> {
  const fields = "spend,impressions,reach,clicks,inline_link_clicks,actions";
  const one = async (preset: string, f = fields) => (await get<{ data?: InsightRow[] }>(`${adId}/insights`, { date_preset: preset, fields: f }, token)).data?.[0] ?? {};
  const [life, today, month] = await Promise.all([one("maximum"), one("today", "spend"), one("this_month", "spend")]);
  return {
    spentCents: cents(life.spend),
    todayCents: cents(today.spend),
    monthCents: cents(month.spend),
    impressions: n(life.impressions),
    reach: n(life.reach),
    clicks: n(life.clicks),
    results: resultsFrom(goal, life),
    fetchedAt: now.toISOString(),
  };
}

export type BoostablePost = { kind: "fb_post" | "ig_post"; id: string; text: string; image: string; permalink: string; createdAt: string; engagement: number };

/** Publicaciones recientes de la página y de Instagram para promocionar (solo leer). */
export async function listBoostablePosts(c: { pageId: string; pageToken: string; igUserId?: string; igToken?: string }): Promise<BoostablePost[]> {
  const out: BoostablePost[] = [];
  const fb = await get<{ data?: { id: string; message?: string; full_picture?: string; permalink_url?: string; created_time?: string; shares?: { count: number }; reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } }[] }>(
    `${c.pageId}/published_posts`,
    { fields: "id,message,full_picture,permalink_url,created_time,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)", limit: "15" },
    c.pageToken,
  ).catch(() => ({ data: [] }));
  for (const p of fb.data ?? [])
    out.push({
      kind: "fb_post",
      id: p.id,
      text: (p.message ?? "").slice(0, 500),
      image: p.full_picture ?? "",
      permalink: p.permalink_url ?? "",
      createdAt: p.created_time ?? "",
      engagement: (p.reactions?.summary?.total_count ?? 0) + (p.comments?.summary?.total_count ?? 0) + (p.shares?.count ?? 0),
    });
  if (c.igUserId && c.igToken) {
    const ig = await get<{ data?: { id: string; caption?: string; media_url?: string; thumbnail_url?: string; permalink?: string; timestamp?: string; like_count?: number; comments_count?: number }[] }>(
      `${c.igUserId}/media`,
      { fields: "id,caption,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count", limit: "15" },
      c.igToken,
    ).catch(() => ({ data: [] }));
    for (const m of ig.data ?? [])
      out.push({
        kind: "ig_post",
        id: m.id,
        text: (m.caption ?? "").slice(0, 500),
        image: m.thumbnail_url ?? m.media_url ?? "",
        permalink: m.permalink ?? "",
        createdAt: m.timestamp ?? "",
        engagement: (m.like_count ?? 0) + (m.comments_count ?? 0),
      });
  }
  return out;
}

/** Busca un interés de Meta por nombre (solo leer) → { id, name } o null. */
export async function findInterest(q: string, token: string): Promise<{ id: string; name: string } | null> {
  const r = await get<{ data?: { id: string; name: string }[] }>("search", { type: "adinterest", q: q.slice(0, 60), limit: "1" }, token).catch(() => ({ data: [] }));
  return r.data?.[0] ? { id: r.data[0].id, name: r.data[0].name } : null;
}

/** Busca una ciudad para el público (solo leer) → { key, name } o null. */
export async function findCity(q: string, token: string): Promise<{ key: string; name: string } | null> {
  const r = await get<{ data?: { key: string; name: string; region?: string; country_name?: string }[] }>(
    "search",
    { type: "adgeolocation", location_types: JSON.stringify(["city"]), q: q.slice(0, 80), limit: "1" },
    token,
  ).catch(() => ({ data: [] }));
  const c = r.data?.[0];
  return c ? { key: c.key, name: [c.name, c.region, c.country_name].filter(Boolean).join(", ") } : null;
}

/** Categoría especial → texto para el dueño. */
export const SPECIAL_LABEL: Record<SpecialCategory, { es: string; en: string }> = {
  NONE: { es: "Ninguna (negocio normal)", en: "None (regular business)" },
  FINANCIAL_PRODUCTS_SERVICES: { es: "Productos y servicios financieros (seguros, préstamos, crédito…)", en: "Financial products and services (insurance, loans, credit…)" },
  HOUSING: { es: "Vivienda (venta o alquiler de casas)", en: "Housing (home sales or rentals)" },
  EMPLOYMENT: { es: "Empleo (ofertas de trabajo)", en: "Employment (job offers)" },
};
