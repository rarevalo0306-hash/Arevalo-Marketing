"use server";

// Acciones de «Anuncios pagados» (/b/<id>/anuncios). Nada gasta sin la confirmación del dueño: crear deja el anuncio
// APAGADO; encender pide el máximo que el dueño vio en la confirmación.
import { revalidatePath } from "next/cache";
import { activateAd, chooseAdAccount, createAd, disconnectAds, pauseAd, pauseAllAds, saveAdsSettings, setCampaignAdsOptions, type NewAdInput } from "@/lib/ads";
import { candidatePosts, proposalInput, proposeAds } from "@/lib/ads-ai";
import { improveGooglePlan } from "@/lib/ads-google-load";
import { AD_GOALS, MAX_DAYS, parseMoney, readCampaignAds, SPECIAL_CATEGORIES, type AdGoal, type AdSource, type SpecialCategory } from "@/lib/ads-shape";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";

export type AdsResult = { ok: boolean; message: string; at: number } | null;

async function ensureBusiness(id: string) {
  const b = await db.business.findUnique({ where: { id }, select: { id: true } });
  if (!b) {
    const { t } = await getT();
    throw new Error(t("Negocio no encontrado", "Business not found"));
  }
}

const refresh = (id: string) => revalidatePath(`/b/${id}/anuncios`);

async function run(businessId: string, work: () => Promise<{ es: string; en: string }>): Promise<AdsResult> {
  const { lang, t } = await getT();
  try {
    await ensureBusiness(businessId);
    const msg = await work();
    refresh(businessId);
    return { ok: true, message: t(msg.es, msg.en), at: Date.now() };
  } catch (e) {
    refresh(businessId);
    return { ok: false, message: errorText(e, lang), at: Date.now() };
  }
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const intOrNull = (v: string) => (v && /^\d+$/.test(v) ? Number(v) : null);

/** Máximo por mes del negocio y categoría especial. */
export async function saveAdsSettingsAction(businessId: string, _prev: AdsResult, f: FormData): Promise<AdsResult> {
  void _prev;
  return run(businessId, async () => {
    const cap = parseMoney(str(f, "monthlyCap"));
    if (cap === null) throw new Error((await getT()).t("Escribe el máximo por mes en dólares (por ejemplo 100).", "Type the monthly maximum in dollars (for example 100)."));
    const cat = str(f, "specialCategory") as SpecialCategory;
    await saveAdsSettings(businessId, { monthlyCapCents: cap, ...(SPECIAL_CATEGORIES.includes(cat) ? { specialCategory: cat } : {}) });
    return { es: "Guardado.", en: "Saved." };
  });
}

export async function chooseAdAccountAction(businessId: string, _prev: AdsResult, f: FormData): Promise<AdsResult> {
  void _prev;
  return run(businessId, async () => {
    await chooseAdAccount(businessId, str(f, "account"));
    return { es: "Cuenta de anuncios elegida.", en: "Ad account selected." };
  });
}

export async function disconnectAdsAction(businessId: string): Promise<void> {
  await ensureBusiness(businessId);
  await disconnectAds(businessId);
  refresh(businessId);
}

/** «La IA puede crear anuncios» y el tope diario de la campaña. */
export async function campaignAdsOptionsAction(businessId: string, campaignId: string, _prev: AdsResult, f: FormData): Promise<AdsResult> {
  void _prev;
  return run(businessId, async () => {
    const daily = str(f, "dailyCap");
    const dailyCents = daily ? parseMoney(daily) : 0;
    if (dailyCents === null) throw new Error((await getT()).t("El tope por día debe ser un número en dólares.", "The daily cap must be a number in dollars."));
    await setCampaignAdsOptions(businessId, campaignId, { aiCanCreate: f.get("aiCanCreate") === "on", dailyCapCents: dailyCents });
    return { es: "Guardado.", en: "Saved." };
  });
}

/** Crear un anuncio APAGADO desde el formulario. */
export async function createAdAction(businessId: string, campaignId: string, _prev: AdsResult, f: FormData): Promise<AdsResult> {
  void _prev;
  return run(businessId, async () => {
    const { t } = await getT();
    const goal = str(f, "goal") as AdGoal;
    if (!AD_GOALS.includes(goal)) throw new Error(t("Elige qué quieres lograr.", "Pick what you want to achieve."));
    const daily = parseMoney(str(f, "daily"));
    if (daily === null) throw new Error(t("Escribe el gasto por día en dólares.", "Type the daily spend in dollars."));
    const days = intOrNull(str(f, "days"));
    if (!days || days > MAX_DAYS) throw new Error(t(`Elige de 1 a ${MAX_DAYS} días.`, `Pick 1 to ${MAX_DAYS} days.`));
    const pick = str(f, "post");
    let source: AdSource;
    if (pick && pick !== "new") {
      const post = (await candidatePosts(businessId)).find((p) => `${p.kind}:${p.id}` === pick);
      if (!post) throw new Error(t("No encontré esa publicación. Vuelve a cargar la página.", "I couldn't find that post. Reload the page."));
      source = post.kind === "fb_post"
        ? { kind: "fb_post", postId: post.id, text: post.text, image: post.image, permalink: post.permalink }
        : { kind: "ig_post", mediaId: post.id, text: post.text, image: post.image, permalink: post.permalink };
    } else {
      const text = str(f, "text");
      if (text.length < 10) throw new Error(t("Escribe el texto del anuncio.", "Write the ad text."));
      source = { kind: "new", text, headline: str(f, "headline").slice(0, 40), image: str(f, "image"), link: str(f, "link") };
    }
    const input: NewAdInput = {
      goal,
      source,
      name: str(f, "name"),
      dailyCents: daily,
      days,
      radiusKm: intOrNull(str(f, "radius")) ?? 15,
      ageMin: intOrNull(str(f, "ageMin")),
      ageMax: intOrNull(str(f, "ageMax")),
      interests: str(f, "interests").split(",").map((x) => x.trim()).filter(Boolean),
      city: str(f, "city"),
    };
    const ad = await createAd(businessId, campaignId, input, "owner");
    return { es: `Listo: «${ad.name}» quedó creado y APAGADO. No gasta nada hasta que lo enciendas.`, en: `Done: "${ad.name}" was created and is PAUSED. It spends nothing until you turn it on.` };
  });
}

export async function proposeAdsAction(businessId: string, campaignId: string, _prev: AdsResult, _f: FormData): Promise<AdsResult> {
  void _prev;
  void _f;
  const { lang } = await getT();
  return run(businessId, async () => {
    const list = await proposeAds(businessId, campaignId, lang);
    return list.length
      ? { es: `La IA propuso ${list.length} anuncio(s).`, en: `The AI proposed ${list.length} ad(s).` }
      : { es: "La IA no encontró anuncios que quepan en el presupuesto.", en: "The AI found no ads that fit the budget." };
  });
}

export async function createFromProposalAction(businessId: string, campaignId: string, proposalId: string, _prev: AdsResult, _f: FormData): Promise<AdsResult> {
  void _prev;
  void _f;
  return run(businessId, async () => {
    const c = await db.campaign.findFirst({ where: { id: campaignId, businessId }, select: { ads: true } });
    const p = c ? readCampaignAds(c.ads).proposals.find((x) => x.id === proposalId) : undefined;
    if (!p) throw new Error((await getT()).t("Esa propuesta ya no está.", "That proposal is gone."));
    const ad = await createAd(businessId, campaignId, await proposalInput(businessId, p), "approved");
    return { es: `Listo: «${ad.name}» quedó creado y APAGADO.`, en: `Done: "${ad.name}" was created and is PAUSED.` };
  });
}

/** Encender (o reanudar) con el máximo confirmado. */
export async function activateAdAction(businessId: string, campaignId: string, adId: string, _prev: AdsResult, f: FormData): Promise<AdsResult> {
  void _prev;
  return run(businessId, async () => {
    if (f.get("confirm") !== "yes") throw new Error((await getT()).t("Marca la casilla para confirmar el gasto.", "Tick the box to confirm the spend."));
    await activateAd(businessId, campaignId, adId, Number(str(f, "maxCents")));
    return { es: "El anuncio está encendido.", en: "The ad is on." };
  });
}

export async function pauseAdAction(businessId: string, campaignId: string, adId: string, _prev: AdsResult, _f: FormData): Promise<AdsResult> {
  void _prev;
  void _f;
  return run(businessId, async () => {
    await pauseAd(businessId, campaignId, adId);
    return { es: "Anuncio pausado.", en: "Ad paused." };
  });
}

export async function pauseAllAdsAction(businessId: string, _prev: AdsResult, _f: FormData): Promise<AdsResult> {
  void _prev;
  void _f;
  return run(businessId, async () => {
    const r = await pauseAllAds(businessId);
    if (r.failed)
      return {
        es: `Se pausaron ${r.paused}. ${r.failed} no respondieron: se reintenta solo cada minuto; si te urge, páusalos en Ads Manager.`,
        en: `${r.paused} paused. ${r.failed} didn't respond: it retries every minute; if urgent, pause them in Ads Manager.`,
      };
    return r.paused ? { es: `Listo: se pausaron ${r.paused} anuncio(s).`, en: `Done: ${r.paused} ad(s) paused.` } : { es: "No había anuncios encendidos.", en: "There were no ads running." };
  });
}

export async function improveGooglePlanAction(businessId: string, _prev: AdsResult, _f: FormData): Promise<AdsResult> {
  void _prev;
  void _f;
  return run(businessId, async () => {
    await improveGooglePlan(businessId);
    return { es: "La IA mejoró los textos (todos caben en los límites de Google).", en: "The AI improved the texts (all fit Google's limits)." };
  });
}
