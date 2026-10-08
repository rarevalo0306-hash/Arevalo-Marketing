// Motor de anuncios pagados: conexión con la cuenta de anuncios de Meta, crear (siempre APAGADO), encender solo con la
// confirmación del dueño, pausar, leer resultados y la revisión automática (syncAds, la llama el cron).
// Cada acción queda en el registro de la IA (logAiAction): ad.created, ad.activated, ad.paused, ad.budget_reached,
// ad.error. costCents: lo gastado por el anuncio cuando termina para siempre (ad.budget_reached o ad.paused por fin).
//
// Dónde se guarda cada cosa:
// - Campaign.ads (JSON, forma en src/lib/ads-shape.ts): los anuncios de la campaña, el tope diario, «la IA puede crear
//   anuncios» (apagado por defecto) y las propuestas de la IA.
// - Connection "meta_ads" (cifrada): el permiso de anuncios de Meta y la cuenta de anuncios elegida.
// - Connection "ads_settings" (cifrada): el máximo por mes del negocio, la categoría especial y el plan de Google Ads.
import { Prisma } from "@prisma/client";
import { logAiAction, type AiActor } from "@/lib/ai-actions";
import {
  activateMetaAd,
  createMetaAd,
  fetchMetaInsights,
  findCity,
  findInterest,
  goalFitsSource,
  listAdAccounts,
  MetaStepError,
  pauseMetaAd,
  type MetaAdsConn,
} from "@/lib/ads-meta";
import {
  adsSpentCents,
  applyDecision,
  checkActivate,
  checkNewAd,
  daysBetween,
  decideAds,
  GOAL_LABEL,
  maxSpendCents,
  money,
  monthCommittedCents,
  monthSpentCents,
  newAdId,
  RADIUS_MAX_KM,
  readAdsSettings,
  readCampaignAds,
  SPECIAL_RADIUS_MIN_KM,
  withError,
  type AdDecision,
  type AdEntry,
  type AdGoal,
  type AdSource,
  type AdsSettings,
  type BiText,
  type CampaignAds,
} from "@/lib/ads-shape";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { bi, BiError } from "@/lib/i18n";
import { readMapPlace } from "@/lib/seo/maprank";
import { businessDay } from "@/lib/time";

export const ADS_CONN = "meta_ads";
export const ADS_SETTINGS = "ads_settings";

// ---------- Conexión y ajustes ----------

async function readSecret<T>(businessId: string, channel: string): Promise<T | null> {
  const row = await db.connection.findUnique({ where: { businessId_channel: { businessId, channel } }, select: { secret: true } });
  if (!row) return null;
  try {
    return decryptJson<T>(row.secret);
  } catch {
    return null;
  }
}

async function writeSecret(businessId: string, channel: string, value: unknown, label: string) {
  const secret = encryptJson(value);
  await db.connection.upsert({
    where: { businessId_channel: { businessId, channel } },
    create: { businessId, channel, secret, label },
    update: { secret, label },
  });
}

export async function readAdsConn(businessId: string): Promise<MetaAdsConn | null> {
  const c = await readSecret<MetaAdsConn>(businessId, ADS_CONN);
  return c?.userToken ? { ...c, accounts: Array.isArray(c.accounts) ? c.accounts : [] } : null;
}

export async function getAdsSettings(businessId: string): Promise<AdsSettings> {
  return readAdsSettings(await readSecret(businessId, ADS_SETTINGS));
}

export async function saveAdsSettings(businessId: string, patch: Partial<AdsSettings>): Promise<AdsSettings> {
  const next = readAdsSettings({ ...(await getAdsSettings(businessId)), ...patch });
  await writeSecret(businessId, ADS_SETTINGS, next, "Anuncios");
  return next;
}

/** Guarda el permiso de anuncios (después de «Conectar anuncios») y elige la cuenta si hay una sola activa. */
export async function saveAdsConnection(businessId: string, userToken: string): Promise<{ chosen: boolean }> {
  const accounts = await listAdAccounts(userToken);
  if (!accounts.length)
    throw bi(
      "Tu Facebook no tiene ninguna cuenta de anuncios (o no diste permiso). Crea una en business.facebook.com › Cuentas de anuncios.",
      "Your Facebook has no ad account (or you didn't give access). Create one in business.facebook.com › Ad accounts.",
    );
  const before = await readAdsConn(businessId);
  const active = accounts.filter((a) => a.status === 1);
  const keep = before?.adAccountId ? accounts.find((a) => a.id === before.adAccountId) : undefined;
  const pick = keep ?? (active.length === 1 ? active[0] : undefined);
  const conn: MetaAdsConn = {
    userToken,
    adAccountId: pick?.id ?? "",
    adAccountName: pick?.name ?? "",
    currency: pick?.currency ?? "",
    accounts,
    connectedAt: new Date().toISOString(),
  };
  await writeSecret(businessId, ADS_CONN, conn, pick?.name ?? "Meta Ads");
  if (pick?.country) {
    const s = await getAdsSettings(businessId);
    if (!s.country) await saveAdsSettings(businessId, { country: pick.country });
  }
  return { chosen: Boolean(pick) };
}

export async function chooseAdAccount(businessId: string, accountId: string): Promise<void> {
  const conn = await readAdsConn(businessId);
  const acc = conn?.accounts.find((a) => a.id === accountId);
  if (!conn || !acc) throw bi("Esa cuenta de anuncios ya no está. Vuelve a conectar.", "That ad account is no longer there. Connect again.");
  await writeSecret(businessId, ADS_CONN, { ...conn, adAccountId: acc.id, adAccountName: acc.name, currency: acc.currency }, acc.name);
  if (acc.country && !(await getAdsSettings(businessId)).country) await saveAdsSettings(businessId, { country: acc.country });
}

export async function disconnectAds(businessId: string): Promise<void> {
  await db.connection.deleteMany({ where: { businessId, channel: ADS_CONN } });
}

type PageCreds = { pageId: string; pageToken: string; igUserId?: string; igToken?: string };

export async function pageCreds(businessId: string): Promise<PageCreds | null> {
  const [fb, ig] = await Promise.all([
    readSecret<{ pageId?: string; accessToken?: string }>(businessId, "facebook"),
    readSecret<{ igUserId?: string; accessToken?: string }>(businessId, "instagram"),
  ]);
  if (!fb?.pageId || !fb.accessToken) return null;
  return { pageId: fb.pageId, pageToken: fb.accessToken, ...(ig?.igUserId ? { igUserId: ig.igUserId, igToken: ig.accessToken } : {}) };
}

// ---------- Guardar Campaign.ads sin pisar cambios de otra vuelta ----------

const asJson = (v: CampaignAds) => v as unknown as Prisma.InputJsonValue;

/** Lee, cambia y guarda Campaign.ads con la fila bloqueada (el cron y el dueño pueden tocarla a la vez). */
export async function updateCampaignAds(
  campaignId: string,
  change: (ads: CampaignAds, c: { businessId: string; spentCents: number }) => CampaignAds,
  opts: { syncSpent?: boolean } = {},
): Promise<CampaignAds> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${campaignId} FOR UPDATE`;
    const c = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { ads: true, businessId: true, spentCents: true } });
    const next = change(readCampaignAds(c.ads), c);
    const spent = adsSpentCents(next.items);
    await tx.campaign.update({
      where: { id: campaignId },
      data: { ads: asJson(next), ...(opts.syncSpent && spent > c.spentCents ? { spentCents: spent } : {}) },
    });
    return next;
  });
}

const replaceItem = (ads: CampaignAds, a: AdEntry): CampaignAds => ({ ...ads, items: ads.items.map((x) => (x.id === a.id ? a : x)) });

/** Mes actual (AAAA-MM) y día (AAAA-MM-DD) del negocio. */
function calendar(now: Date) {
  const today = businessDay(now);
  return { today, month: today.slice(0, 7) };
}

/** Todos los anuncios del negocio (todas las campañas), para los topes del mes. */
async function businessItems(businessId: string): Promise<AdEntry[]> {
  const rows = await db.campaign.findMany({ where: { businessId, ads: { not: Prisma.DbNull } }, select: { ads: true } });
  return rows.flatMap((r) => readCampaignAds(r.ads).items);
}

const errText = (e: unknown): BiText =>
  e instanceof BiError ? { es: e.message, en: e.en } : { es: e instanceof Error ? e.message : String(e), en: e instanceof Error ? e.message : String(e) };

function needConn(conn: MetaAdsConn | null): asserts conn is MetaAdsConn {
  if (!conn) throw bi("Primero conecta tu cuenta de anuncios de Facebook.", "First connect your Facebook ad account.");
  if (!conn.adAccountId) throw bi("Elige la cuenta de anuncios que vas a usar.", "Pick the ad account you'll use.");
  if (conn.currency && conn.currency !== "USD")
    throw bi(
      `Tu cuenta de anuncios usa ${conn.currency}. Por ahora la app solo maneja cuentas en dólares (USD), para que los límites sean exactos.`,
      `Your ad account uses ${conn.currency}. For now the app only handles accounts in US dollars (USD), so the limits are exact.`,
    );
}

// ---------- Crear (APAGADO) ----------

export type NewAdInput = {
  goal: AdGoal;
  source: AdSource;
  name: string;
  dailyCents: number;
  days: number;
  radiusKm: number;
  ageMin: number | null;
  ageMax: number | null;
  /** Nombres de intereses (se buscan en Meta). */
  interests: string[];
  /** Ciudad o zona si el negocio no tiene punto en el mapa. */
  city: string;
};

/**
 * Crea el anuncio en Meta COMPLETAMENTE APAGADO (no gasta nada). Revisa antes todos los límites. Para que gaste, el
 * dueño tiene que confirmarlo con activateAd.
 */
export async function createAd(businessId: string, campaignId: string, input: NewAdInput, actor: AiActor, now = new Date()): Promise<AdEntry> {
  const [b, campaign, conn, settings, page] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, phone: true, website: true, seoMapPlace: true, seoLocationName: true } }),
    db.campaign.findFirst({ where: { id: campaignId, businessId } }),
    readAdsConn(businessId),
    getAdsSettings(businessId),
    pageCreds(businessId),
  ]);
  if (!campaign) throw bi("Campaña no encontrada.", "Campaign not found.");
  needConn(conn);
  if (!page) throw bi("Conecta primero la página de Facebook del negocio (en Conexiones).", "First connect the business Facebook Page (in Connections).");
  if (!goalFitsSource(input.goal, input.source.kind))
    throw bi(
      input.source.kind === "new" ? "Ese objetivo necesita una publicación que ya exista." : "Para llamadas o mensajes se crea un anuncio nuevo con su botón (no una publicación existente).",
      input.source.kind === "new" ? "That goal needs a post that already exists." : "Calls or messages need a new ad with its button (not an existing post).",
    );
  const ads = readCampaignAds(campaign.ads);
  const special = settings.specialCategory;
  const radiusKm = special === "NONE" ? input.radiusKm : Math.max(SPECIAL_RADIUS_MIN_KM, input.radiusKm);
  const ageMin = special === "NONE" ? input.ageMin : null;
  const ageMax = special === "NONE" ? input.ageMax : null;
  const { month } = calendar(now);
  // Empieza en 10 minutos (Meta no acepta fechas en el pasado) o cuando empieza la campaña.
  const startsAt = new Date(Math.max(now.getTime() + 10 * 60_000, campaign.startsAt.getTime()));
  const problems = checkNewAd({
    dailyCents: input.dailyCents,
    days: input.days,
    startsAt,
    campaign: { status: campaign.status, budgetCents: campaign.budgetCents, endsAt: campaign.endsAt },
    items: ads.items,
    monthCommittedCents: monthCommittedCents(await businessItems(businessId), month),
    monthlyCapCents: settings.monthlyCapCents,
    dailyCapCents: ads.dailyCapCents,
    radiusKm,
    specialCategory: special,
    ageMin,
    ageMax,
  });
  if (problems.length) throw bi(problems.map((p) => p.es).join(" "), problems.map((p) => p.en).join(" "));

  // Dónde: el punto del negocio en el mapa (SEO › Mapa) o una ciudad buscada en Meta.
  const place = readMapPlace(b.seoMapPlace);
  let lat = 0;
  let lng = 0;
  let cityKey = "";
  let placeName = "";
  if (place) {
    lat = place.lat;
    lng = place.lng;
    placeName = place.address || place.title;
  } else {
    const q = input.city.trim() || b.seoLocationName.split(",")[0]?.trim() || "";
    const city = q ? await findCity(q, conn.userToken) : null;
    if (!city)
      throw bi(
        "No sé dónde está el negocio: escribe la ciudad o elige tu negocio en el mapa (SEO › Mapa).",
        "I don't know where the business is: type the city or pick your business on the map (SEO › Map).",
      );
    cityKey = city.key;
    placeName = city.name;
  }
  const interests =
    special === "NONE"
      ? (await Promise.all(input.interests.slice(0, 5).map((q) => findInterest(q, conn.userToken)))).filter((x): x is { id: string; name: string } => x !== null)
      : [];

  const totalCents = maxSpendCents(input.dailyCents, input.days);
  const entry: AdEntry = {
    id: newAdId(now.getTime()),
    platform: "meta",
    name: (input.name.trim() || `${b.name} · ${GOAL_LABEL[input.goal].es}`).slice(0, 150),
    goal: input.goal,
    source: input.source,
    ext: {},
    status: "paused",
    pausedReason: "owner",
    dailyCents: input.dailyCents,
    totalCents,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + input.days * 86_400_000).toISOString(),
    targeting: { lat, lng, radiusKm: Math.min(RADIUS_MAX_KM, radiusKm), ageMin, ageMax, interests, place: placeName, cityKey },
    specialCategory: special,
    createdAt: now.toISOString(),
    createdBy: actor === "auto" ? "auto" : "owner",
    errors: [],
  };
  // Se guarda ANTES de llamar a Meta: si algo se corta, el anuncio queda anotado (y apagado).
  await updateCampaignAds(campaignId, (a) => ({ ...a, items: [...a.items, entry] }));

  try {
    const ext = await createMetaAd(entry, {
      token: conn.userToken,
      adAccountId: conn.adAccountId,
      pageId: page.pageId,
      igUserId: page.igUserId,
      phone: b.phone,
      website: b.website,
      country: settings.country,
    });
    const done: AdEntry = { ...entry, ext };
    await updateCampaignAds(campaignId, (a) => replaceItem(a, done));
    await logAiAction({
      businessId,
      campaignId,
      kind: "ad.created",
      actor,
      summary: {
        es: `Anuncio creado APAGADO en Facebook/Instagram: «${done.name}» (${money(done.dailyCents)} por día, máximo ${money(totalCents)}). Falta que el dueño lo encienda.`,
        en: `Ad created PAUSED on Facebook/Instagram: "${done.name}" (${money(done.dailyCents)} a day, max ${money(totalCents)}). The owner still has to turn it on.`,
      },
      detail: { adId: done.id, ext, goal: done.goal, totalCents, dailyCents: done.dailyCents, radiusKm: done.targeting.radiusKm },
    });
    return done;
  } catch (e) {
    const ext = e instanceof MetaStepError ? e.ext : {};
    const msg = errText(e);
    const failed = withError({ ...entry, ext, status: "error", pausedReason: "error" }, msg, now);
    await updateCampaignAds(campaignId, (a) => replaceItem(a, failed));
    await logAiAction({
      businessId,
      campaignId,
      kind: "ad.error",
      actor,
      summary: { es: `No se pudo crear el anuncio «${entry.name}»: ${msg.es}`.slice(0, 480), en: `Couldn't create the ad "${entry.name}": ${msg.en}`.slice(0, 480) },
      detail: { adId: entry.id, ext, step: e instanceof MetaStepError ? e.step : null },
    });
    throw bi(`Meta no dejó crear el anuncio: ${msg.es}`, `Meta didn't let the ad be created: ${msg.en}`);
  }
}

// ---------- Encender, pausar, reanudar ----------

async function adContext(businessId: string, campaignId: string, adId: string) {
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, businessId } });
  if (!campaign) throw bi("Campaña no encontrada.", "Campaign not found.");
  const ad = readCampaignAds(campaign.ads).items.find((a) => a.id === adId);
  if (!ad) throw bi("Anuncio no encontrado.", "Ad not found.");
  return { campaign, ad };
}

/**
 * Enciende (o vuelve a encender) un anuncio. `confirmedMaxCents` es lo máximo que el dueño vio en la confirmación:
 * si no coincide con el total del anuncio, no se enciende.
 */
export async function activateAd(businessId: string, campaignId: string, adId: string, confirmedMaxCents: number, now = new Date()): Promise<AdEntry> {
  const { campaign, ad } = await adContext(businessId, campaignId, adId);
  if (confirmedMaxCents !== ad.totalCents)
    throw bi("La confirmación no coincide con el máximo del anuncio. Vuelve a abrir la confirmación.", "The confirmation doesn't match the ad maximum. Open the confirmation again.");
  const conn = await readAdsConn(businessId);
  needConn(conn);
  const [settings, items] = await Promise.all([getAdsSettings(businessId), businessItems(businessId)]);
  const problems = checkActivate(ad, {
    campaignStatus: campaign.status,
    campaignBudgetCents: campaign.budgetCents,
    campaignSpentCents: campaign.spentCents,
    campaignEndsAt: campaign.endsAt,
    monthlyCapCents: settings.monthlyCapCents,
    monthSpentCents: monthSpentCents(items, calendar(now).month),
    now,
  });
  if (problems.length) throw bi(problems.map((p) => p.es).join(" "), problems.map((p) => p.en).join(" "));
  try {
    await activateMetaAd(ad.ext, conn.userToken);
  } catch (e) {
    // Si algo quedó encendido a medias, se apaga todo otra vez.
    await pauseMetaAd(ad.ext, conn.userToken).catch(() => undefined);
    const msg = errText(e);
    await updateCampaignAds(campaignId, (a) => replaceItem(a, withError(ad, msg, now)));
    await logAiAction({ businessId, campaignId, kind: "ad.error", actor: "owner", summary: { es: `No se pudo encender «${ad.name}»: ${msg.es}`.slice(0, 480), en: `Couldn't turn on "${ad.name}": ${msg.en}`.slice(0, 480) }, detail: { adId } });
    throw bi(`Meta no dejó encender el anuncio: ${msg.es}`, `Meta didn't let the ad turn on: ${msg.en}`);
  }
  const { pausedReason: _p, cappedDay: _c, ...rest } = ad;
  void _p;
  void _c;
  const on: AdEntry = { ...rest, status: "active", activatedAt: now.toISOString() };
  await updateCampaignAds(campaignId, (a) => replaceItem(a, on));
  await logAiAction({
    businessId,
    campaignId,
    kind: "ad.activated",
    actor: "owner",
    summary: {
      es: `El dueño encendió «${ad.name}»: hasta ${money(ad.dailyCents)} por día y nunca más de ${money(ad.totalCents)} en total.`,
      en: `The owner turned on "${ad.name}": up to ${money(ad.dailyCents)} a day and never more than ${money(ad.totalCents)} in total.`,
    },
    detail: { adId, maxCents: ad.totalCents, dailyCents: ad.dailyCents, endsAt: ad.endsAt },
  });
  return on;
}

const REASON_TEXT: Record<string, BiText> = {
  owner: { es: "lo pausó el dueño", en: "the owner paused it" },
  budget: { es: "se gastó el presupuesto", en: "the budget was spent" },
  daily: { es: "llegó al gasto del día (sigue mañana)", en: "it reached the daily spend (continues tomorrow)" },
  monthly: { es: "se llegó al máximo del mes", en: "the monthly maximum was reached" },
  campaign: { es: "la campaña se pausó, se paró o terminó", en: "the campaign was paused, stopped or ended" },
  ended: { es: "llegó su fecha de fin", en: "its end date arrived" },
  error: { es: "hubo un error", en: "there was an error" },
};

/** Pausa en Meta y guarda; registra. Si Meta falla, lo anota (y el cron lo vuelve a intentar). */
async function applyAndLog(businessId: string, campaignId: string, ad: AdEntry, d: AdDecision, token: string, actor: AiActor, now: Date): Promise<boolean> {
  const { today } = calendar(now);
  try {
    if (d.action === "resume") await activateMetaAd(ad.ext, token);
    else await pauseMetaAd(ad.ext, token);
  } catch (e) {
    const msg = errText(e);
    await updateCampaignAds(campaignId, (a) => replaceItem(a, withError(a.items.find((x) => x.id === ad.id) ?? ad, msg, now)));
    // El cron reintenta cada minuto: el mismo error se anota en el registro como mucho cada 30 minutos.
    const last = ad.errors.at(-1);
    if (actor === "auto" && last && last.es === msg.es.slice(0, 500) && now.getTime() - Date.parse(last.at) < 30 * 60_000) return false;
    await logAiAction({
      businessId,
      campaignId,
      kind: "ad.error",
      actor,
      summary: {
        es: `No se pudo ${d.action === "resume" ? "volver a encender" : "pausar"} «${ad.name}» en Meta: ${msg.es}`.slice(0, 480),
        en: `Couldn't ${d.action === "resume" ? "turn back on" : "pause"} "${ad.name}" on Meta: ${msg.en}`.slice(0, 480),
      },
      detail: { adId: ad.id, decision: d },
    });
    return false;
  }
  await updateCampaignAds(campaignId, (a) => {
    const cur = a.items.find((x) => x.id === ad.id) ?? ad;
    return replaceItem(a, applyDecision(cur, d, today));
  });
  const spent = ad.insights?.spentCents ?? 0;
  const final = d.action === "end" || d.reason === "budget";
  const why = REASON_TEXT[d.reason] ?? REASON_TEXT.owner;
  await logAiAction({
    businessId,
    campaignId,
    kind: d.action === "resume" ? "ad.activated" : d.reason === "budget" ? "ad.budget_reached" : "ad.paused",
    actor,
    costCents: final ? spent : 0,
    summary:
      d.action === "resume"
        ? { es: `«${ad.name}» siguió hoy: ayer llegó a su gasto del día.`, en: `"${ad.name}" continued today: yesterday it reached its daily spend.` }
        : { es: `«${ad.name}» se pausó: ${why.es}. Gastado: ${money(spent)}.`, en: `"${ad.name}" was paused: ${why.en}. Spent: ${money(spent)}.` },
    detail: { adId: ad.id, decision: d, spentCents: spent },
  });
  return true;
}

export async function pauseAd(businessId: string, campaignId: string, adId: string, now = new Date()): Promise<void> {
  const { ad } = await adContext(businessId, campaignId, adId);
  const conn = await readAdsConn(businessId);
  if (!conn) throw bi("La cuenta de anuncios no está conectada.", "The ad account isn't connected.");
  const ok = await applyAndLog(businessId, campaignId, ad, { adId, action: "pause", reason: "owner" }, conn.userToken, "owner", now);
  if (!ok) throw bi("Meta no respondió al pausar. Se volverá a intentar sola en un minuto; si sigue, páusalo en Ads Manager.", "Meta didn't respond to the pause. It will retry by itself in a minute; if it continues, pause it in Ads Manager.");
}

/** «Pausar todos los anuncios»: apaga todo lo que puede gastar, en todas las campañas del negocio. */
export async function pauseAllAds(businessId: string, now = new Date()): Promise<{ paused: number; failed: number }> {
  const conn = await readAdsConn(businessId);
  const campaigns = await db.campaign.findMany({ where: { businessId, ads: { not: Prisma.DbNull } }, select: { id: true, ads: true } });
  let paused = 0;
  let failed = 0;
  for (const c of campaigns)
    for (const ad of readCampaignAds(c.ads).items.filter((a) => a.status === "active" || a.status === "capped_today")) {
      if (!conn) {
        failed++;
        continue;
      }
      if (await applyAndLog(businessId, c.id, ad, { adId: ad.id, action: "pause", reason: "owner" }, conn.userToken, "owner", now)) paused++;
      else failed++;
    }
  return { paused, failed };
}

export async function setCampaignAdsOptions(businessId: string, campaignId: string, patch: { aiCanCreate?: boolean; dailyCapCents?: number }): Promise<void> {
  const c = await db.campaign.findFirst({ where: { id: campaignId, businessId }, select: { id: true } });
  if (!c) throw bi("Campaña no encontrada.", "Campaign not found.");
  await updateCampaignAds(campaignId, (a) => ({
    ...a,
    ...(patch.aiCanCreate !== undefined ? { aiCanCreate: patch.aiCanCreate } : {}),
    ...(patch.dailyCapCents !== undefined ? { dailyCapCents: Math.max(0, Math.round(patch.dailyCapCents)) } : {}),
  }));
}

// ---------- Revisión automática (cron) ----------

/** Cada cuánto se leen los resultados de un anuncio encendido. */
const INSIGHTS_EVERY_MS = 20 * 60_000;
/** Los pausados se leen menos (para tener el gasto final). */
const PAUSED_INSIGHTS_EVERY_MS = 6 * 60 * 60_000;
const MAX_INSIGHT_READS = 40;

const stale = (a: AdEntry, now: Date) => {
  if (!a.ext.adId || a.status === "error") return false;
  const last = a.insights ? Date.parse(a.insights.fetchedAt) : 0;
  const every = a.status === "active" || a.status === "capped_today" ? INSIGHTS_EVERY_MS : PAUSED_INSIGHTS_EVERY_MS;
  if (a.status === "ended" && a.insights && last > Date.parse(a.endsAt) + 86_400_000) return false;
  return now.getTime() - last >= every;
};

export type SyncResult = { campaigns: number; read: number; paused: number; resumed: number; ended: number; errors: number; created: number };

/**
 * La llama el cron cada minuto. Por cada campaña con anuncios:
 * 1. Si la campaña está pausada, parada, terminada o en borrador → pausa en Meta todos sus anuncios (al momento).
 * 2. Lee lo gastado (cada 20 min los encendidos) → Campaign.spentCents.
 * 3. Pausa al llegar al total de la campaña, del anuncio, del mes o del día; al día siguiente vuelve a encender
 *    los que solo se pausaron por el gasto del día.
 * Nunca crea ni enciende nada que el dueño no haya confirmado.
 */
export async function syncAds(now = new Date()): Promise<SyncResult> {
  const out: SyncResult = { campaigns: 0, read: 0, paused: 0, resumed: 0, ended: 0, errors: 0, created: 0 };
  const rows = await db.campaign.findMany({
    where: { ads: { not: Prisma.DbNull } },
    select: { id: true, businessId: true, status: true, budgetCents: true, spentCents: true, endsAt: true, ads: true },
  });
  const byBusiness = new Map<string, typeof rows>();
  for (const r of rows) byBusiness.set(r.businessId, [...(byBusiness.get(r.businessId) ?? []), r]);
  const { today, month } = calendar(now);
  let reads = 0;

  for (const [businessId, campaigns] of byBusiness) {
    const withAds = campaigns.filter((c) => readCampaignAds(c.ads).items.some((a) => a.ext.adId));
    if (!withAds.length) continue;
    const [conn, settings] = await Promise.all([readAdsConn(businessId), getAdsSettings(businessId)]);
    if (!conn) continue;

    for (const c of withAds) {
      out.campaigns++;
      let ads = readCampaignAds(c.ads);
      const halted = ["stopped", "paused", "ended", "draft"].includes(c.status);
      // 2. Resultados (no se leen si la campaña se paró: primero se apaga todo).
      if (!halted) {
        const fresh: AdEntry[] = [];
        for (const a of ads.items) {
          if (reads >= MAX_INSIGHT_READS || !stale(a, now)) continue;
          reads++;
          try {
            fresh.push({ ...a, insights: await fetchMetaInsights(a.ext.adId!, a.goal, conn.userToken, now) });
            out.read++;
          } catch (e) {
            fresh.push(withError(a, errText(e), now));
            out.errors++;
          }
        }
        if (fresh.length)
          ads = await updateCampaignAds(
            c.id,
            (cur) => ({ ...cur, items: cur.items.map((x) => {
              const f = fresh.find((y) => y.id === x.id);
              return f ? { ...x, insights: f.insights ?? x.insights, errors: f.errors } : x;
            }) }),
            { syncSpent: true },
          );
      }
      const all = [...campaigns.filter((x) => x.id !== c.id).flatMap((x) => readCampaignAds(x.ads).items), ...ads.items];
      const spentNow = Math.max(c.spentCents, adsSpentCents(ads.items));
      const decisions = decideAds({
        campaign: { status: c.status, budgetCents: c.budgetCents, spentCents: spentNow, endsAt: c.endsAt, dailyCapCents: ads.dailyCapCents },
        items: ads.items,
        monthlyCapCents: settings.monthlyCapCents,
        monthSpentCents: monthSpentCents(all, month),
        now,
        today,
      });
      for (const d of decisions) {
        const ad = ads.items.find((a) => a.id === d.adId)!;
        // Un anuncio que terminó solo en Meta no necesita llamada si nunca se creó del todo.
        if (!ad.ext.adId && !ad.ext.campaignId) {
          await updateCampaignAds(c.id, (cur) => replaceItem(cur, applyDecision(ad, d, today)));
          continue;
        }
        const ok = await applyAndLog(businessId, c.id, ad, d, conn.userToken, "auto", now);
        if (!ok) out.errors++;
        else if (d.action === "resume") out.resumed++;
        else if (d.action === "end") out.ended++;
        else out.paused++;
      }
    }
  }
  // Campañas automáticas con «la IA puede crear anuncios»: como mucho UNA propuesta por vuelta, creada APAGADA.
  try {
    const { autoCreateAds } = await import("@/lib/ads-ai");
    if (await autoCreateAds(now)) out.created++;
  } catch (e) {
    console.error("[anuncios] creación automática:", e instanceof Error ? e.message : e);
  }
  return out;
}

// ---------- Para la pantalla ----------

export type AdsOverview = {
  monthSpentCents: number;
  monthCommittedCents: number;
  month: string;
};

export async function adsOverview(businessId: string, now = new Date()): Promise<AdsOverview> {
  const items = await businessItems(businessId);
  const { month } = calendar(now);
  return { monthSpentCents: monthSpentCents(items, month), monthCommittedCents: monthCommittedCents(items, month), month };
}

/** Días que dura una campaña desde hoy (para sugerir la duración de un anuncio). */
export function daysLeft(endsAt: Date | null, now = new Date()): number | null {
  return endsAt ? daysBetween(now, endsAt) : null;
}
