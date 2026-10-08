// Propuestas de anuncios de la IA (1 a 3): qué publicación promocionar o qué anuncio nuevo hacer, a quién (radio,
// edades solo si se permite, intereses), cuánto gastar con el alcance esperado y el texto con las palabras clave.
// Las propuestas se guardan en Campaign.ads.proposals y se crean APAGADAS con «Crear (pausado)».
// En campañas automáticas con «la IA puede crear anuncios» encendido, autoCreateAds crea una sola, APAGADA.
import { z } from "zod";
import { createAd, getAdsSettings, pageCreds, readAdsConn, updateCampaignAds, type NewAdInput } from "@/lib/ads";
import { goalFitsSource, listBoostablePosts, type BoostablePost } from "@/lib/ads-meta";
import {
  AD_GOALS,
  campaignRoomCents,
  daysBetween,
  MAX_DAYS,
  MIN_DAILY_CENTS,
  RADIUS_MAX_KM,
  RADIUS_MIN_KM,
  readCampaignAds,
  SPECIAL_RADIUS_MIN_KM,
  type AdProposal,
  type AdSource,
  type SpecialCategory,
} from "@/lib/ads-shape";
import { logAiAction } from "@/lib/ai-actions";
import { askGemini } from "@/lib/ai";
import { identityPrompt } from "@/lib/brand-identity";
import { db } from "@/lib/db";
import { bi } from "@/lib/i18n";
import { pickLibraryPhoto } from "@/lib/library";
import { readTrackedKeywords } from "@/lib/seo/dataforseo";
import { readStudy, topKeywords } from "@/lib/study-shape";

export const AdIdeasSchema = z.object({
  proposals: z
    .array(
      z.object({
        title: z.string().describe("Short name for the owner, e.g. 'Promote the roll-up door repair post'"),
        why: z.string().describe("1-2 plain sentences: why this ad, for the owner (no jargon)"),
        goal: z.enum(AD_GOALS),
        postRef: z.string().describe("Exact id of one of the candidate posts to promote, or empty string for a new ad"),
        text: z.string().describe("Ad text (for a new ad) or a short improved caption idea; uses the business keywords naturally"),
        headline: z.string().describe("Headline up to 40 characters (new ads)"),
        radiusKm: z.number(),
        ageMin: z.number().nullable(),
        ageMax: z.number().nullable(),
        interests: z.array(z.string()).describe("Up to 4 Meta interest names in English, empty when not allowed"),
        dailyUsd: z.number(),
        days: z.number(),
        reachLow: z.number().describe("Expected people reached in total, low end"),
        reachHigh: z.number().describe("Expected people reached in total, high end"),
        keywords: z.array(z.string()).describe("Business keywords used in the text"),
      }),
    )
    .max(3),
});
export type AdIdeas = z.infer<typeof AdIdeasSchema>;

export type ProposalContext = {
  business: { name: string; website: string; phone: string; aiProfile: string; brandIdentity?: unknown };
  campaign: { name: string; goal: string; keywords: string[]; budgetCents: number; roomCents: number; daysLeft: number | null };
  keywords: string[];
  plan: string[];
  posts: BoostablePost[];
  special: SpecialCategory;
  place: string;
  lang: "es" | "en";
};

/** El pedido a la IA (sin llamar a nada, para las pruebas). */
export function adsPrompt(c: ProposalContext): { system: string; user: string } {
  const special = c.special !== "NONE";
  const system = `You are a careful paid-social planner for a small local business. You propose 1 to 3 Facebook/Instagram ads.
Rules:
- Money is real. Never propose more than the remaining budget: daily USD × days must be ≤ ${(c.campaign.roomCents / 100).toFixed(2)} USD in total per ad, and all proposals together should fit it too. Minimum ${MIN_DAILY_CENTS / 100} USD per day.
- Days: 1 to ${Math.min(MAX_DAYS, c.campaign.daysLeft ?? MAX_DAYS)}.
- Goals: awareness (people near the business see it), traffic (visits to the website), engagement (reactions on an existing post), messages (Messenger chats, NEW ad only), calls (phone calls, NEW ad only${c.business.phone ? "" : "; the business has no phone saved, so avoid this goal"}).
- To promote an existing post, set postRef to its exact id from the candidate list and prefer posts with more engagement that match the campaign goal. engagement requires an existing post.
- Radius around the business: ${special ? SPECIAL_RADIUS_MIN_KM : RADIUS_MIN_KM} to ${RADIUS_MAX_KM} km (local services usually 8-25 km).
${special ? `- This business is in Meta's special ad category ${c.special}: ages MUST be null, interests MUST be empty, radius at least ${SPECIAL_RADIUS_MIN_KM} km.` : "- Ages only if the product clearly targets an age group (otherwise null). Interests: up to 4 broad Meta interest names in English."}
- Write the ad text in ${c.lang === "en" ? "English" : "Spanish"} and use the business keywords naturally (never stuffed). No fake promises, no prices that are not in the profile, never mention competitors.
- Reach ranges must be realistic for a small local audience (roughly 300-1500 people reached per USD in Latin America, 100-400 in the US).
${identityPrompt(c.business)}`;
  const posts = c.posts
    .slice(0, 12)
    .map((p) => `- id=${p.id} (${p.kind === "fb_post" ? "Facebook" : "Instagram"}, ${p.engagement} interactions, ${p.createdAt.slice(0, 10)}): ${p.text.replace(/\s+/g, " ").slice(0, 200)}`)
    .join("\n");
  const user = `Business: ${c.business.name}${c.business.website ? ` (${c.business.website})` : ""}
Location: ${c.place || "unknown"}
Profile:
${c.business.aiProfile.slice(0, 2500)}

Campaign: ${c.campaign.name}
Campaign goal (owner's words): ${c.campaign.goal || "not set"}
Campaign keywords: ${c.campaign.keywords.join(", ") || "none"}
Business keywords (SEO): ${c.keywords.join(", ") || "none"}
Remaining ad budget for this campaign: ${(c.campaign.roomCents / 100).toFixed(2)} USD

Top items of the action plan:
${c.plan.map((p) => `- ${p}`).join("\n") || "- none"}

Candidate posts to promote:
${posts || "- none (propose new ads)"}`;
  return { system, user };
}

/** Limpia lo que propuso la IA: límites de dinero, días, radio, edades e intereses permitidos. */
export function toProposals(raw: AdIdeas, c: ProposalContext, stamp = Date.now().toString(36)): AdProposal[] {
  const special = c.special !== "NONE";
  const maxDays = Math.max(1, Math.min(MAX_DAYS, c.campaign.daysLeft ?? MAX_DAYS));
  let room = c.campaign.roomCents;
  const out: AdProposal[] = [];
  for (const [i, p] of raw.proposals.slice(0, 3).entries()) {
    const post = c.posts.find((x) => x.id === p.postRef.trim());
    let goal = p.goal;
    const kind = post ? post.kind : "new";
    if (!goalFitsSource(goal, kind)) goal = "awareness";
    if (goal === "calls" && !c.business.phone) goal = kind === "new" ? "messages" : "awareness";
    const days = Math.max(1, Math.min(maxDays, Math.round(p.days) || 7));
    let daily = Math.max(MIN_DAILY_CENTS, Math.round((p.dailyUsd || 0) * 100));
    if (daily * days > room) daily = Math.floor(room / days);
    if (daily < MIN_DAILY_CENTS) continue;
    room -= daily * days;
    const radius = Math.max(special ? SPECIAL_RADIUS_MIN_KM : RADIUS_MIN_KM, Math.min(RADIUS_MAX_KM, Math.round(p.radiusKm) || 15));
    const age = (v: number | null) => (special || v === null || !Number.isFinite(v) ? null : Math.max(18, Math.min(65, Math.round(v))));
    const scale = daily / Math.max(1, Math.round((p.dailyUsd || 0) * 100));
    out.push({
      id: `p_${stamp}_${i}`,
      title: p.title.slice(0, 120),
      why: p.why.slice(0, 600),
      goal,
      postRef: post?.id ?? "",
      postKind: kind,
      text: (post && !p.text.trim() ? post.text : p.text).slice(0, 1500),
      headline: p.headline.slice(0, 40),
      radiusKm: radius,
      ageMin: age(p.ageMin),
      ageMax: age(p.ageMax),
      interests: special ? [] : p.interests.map((x) => x.trim().slice(0, 60)).filter(Boolean).slice(0, 4),
      dailyCents: daily,
      days,
      reachLow: Math.max(0, Math.round(p.reachLow * Math.min(1, scale))),
      reachHigh: Math.max(0, Math.round(p.reachHigh * Math.min(1, scale))),
      keywords: p.keywords.map((k) => k.slice(0, 80)).filter(Boolean).slice(0, 8),
    });
  }
  return out;
}

/** Publicaciones para promocionar: las de Meta (si se pueden leer) o, si no, las publicadas desde la app. */
export async function candidatePosts(businessId: string): Promise<BoostablePost[]> {
  const page = await pageCreds(businessId);
  if (page) {
    try {
      const live = await listBoostablePosts(page);
      if (live.length) return live.sort((a, b) => b.engagement - a.engagement);
    } catch {
      // se usan las de la app
    }
  }
  const targets = await db.postTarget.findMany({
    where: { channel: "facebook", status: "sent", post: { businessId } },
    select: { externalUrl: true, sentAt: true, post: { select: { text: true, mediaUrl: true } } },
    orderBy: { sentAt: "desc" },
    take: 15,
  });
  return targets
    .map((t) => ({ t, id: /facebook\.com\/(\d+_\d+)/.exec(t.externalUrl)?.[1] ?? "" }))
    .filter((x) => x.id)
    .map(({ t, id }) => ({ kind: "fb_post" as const, id, text: t.post.text.slice(0, 500), image: t.post.mediaUrl, permalink: t.externalUrl, createdAt: t.sentAt?.toISOString() ?? "", engagement: 0 }));
}

async function proposalContext(businessId: string, campaignId: string, lang: "es" | "en"): Promise<ProposalContext> {
  const [b, campaign, settings, posts, tasks] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: businessId } }),
    db.campaign.findFirst({ where: { id: campaignId, businessId } }),
    getAdsSettings(businessId),
    candidatePosts(businessId),
    db.actionTask.findMany({ where: { businessId, status: "todo" }, orderBy: [{ impact: "desc" }, { effort: "asc" }], take: 6, select: { title: true } }),
  ]);
  if (!campaign) throw bi("Campaña no encontrada.", "Campaign not found.");
  const study = readStudy(b.study);
  const ads = readCampaignAds(campaign.ads);
  return {
    business: { name: b.name, website: b.website, phone: b.phone, aiProfile: b.aiProfile, brandIdentity: b.brandIdentity },
    campaign: {
      name: campaign.name,
      goal: campaign.goal,
      keywords: campaign.keywords,
      budgetCents: campaign.budgetCents,
      roomCents: campaignRoomCents(campaign.budgetCents, ads.items),
      daysLeft: campaign.endsAt ? daysBetween(new Date(), campaign.endsAt) : null,
    },
    keywords: [...new Set([...campaign.keywords, ...readTrackedKeywords(b.seoKeywords), ...(study ? topKeywords(study, 8) : [])])].slice(0, 15),
    plan: tasks.map((t) => {
      const title = t.title as { es?: string; en?: string } | null;
      return (lang === "en" ? title?.en || title?.es : title?.es || title?.en) ?? "";
    }).filter(Boolean),
    posts,
    special: settings.specialCategory,
    place: b.seoLocationName,
    lang,
  };
}

/** Pide 1-3 propuestas a la IA y las guarda en la campaña. */
export async function proposeAds(businessId: string, campaignId: string, lang: "es" | "en"): Promise<AdProposal[]> {
  const ctx = await proposalContext(businessId, campaignId, lang);
  if (ctx.campaign.roomCents < MIN_DAILY_CENTS)
    throw bi("A esta campaña no le queda presupuesto para anuncios. Súbelo en Campañas.", "This campaign has no ad budget left. Raise it in Campaigns.");
  const { system, user } = adsPrompt(ctx);
  const raw = await askGemini(AdIdeasSchema, system, user, 6000);
  const proposals = toProposals(raw, ctx);
  await updateCampaignAds(campaignId, (a) => ({ ...a, proposals, proposalsAt: new Date().toISOString() }));
  return proposals;
}

/** Convierte una propuesta en lo que necesita createAd (con una foto real del negocio para anuncios nuevos). */
export async function proposalInput(businessId: string, p: AdProposal): Promise<NewAdInput> {
  const posts = p.postKind === "new" ? [] : await candidatePosts(businessId);
  const post = posts.find((x) => x.id === p.postRef);
  let source: AdSource;
  if (post?.kind === "fb_post") source = { kind: "fb_post", postId: post.id, text: post.text, image: post.image, permalink: post.permalink };
  else if (post?.kind === "ig_post") source = { kind: "ig_post", mediaId: post.id, text: post.text, image: post.image, permalink: post.permalink };
  else {
    const b = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { logoUrl: true, website: true } });
    const photo = await pickLibraryPhoto(businessId, { text: `${p.headline} ${p.text}`, keywords: p.keywords, shape: "square" });
    source = { kind: "new", text: p.text, headline: p.headline, image: photo?.url ?? b.logoUrl, link: b.website };
  }
  return {
    goal: goalFitsSource(p.goal, source.kind) ? p.goal : "awareness",
    source,
    name: p.title,
    dailyCents: p.dailyCents,
    days: p.days,
    radiusKm: p.radiusKm,
    ageMin: p.ageMin,
    ageMax: p.ageMax,
    interests: p.interests,
    city: "",
  };
}

const AUTO_EVERY_MS = 24 * 60 * 60_000;

/**
 * Campañas automáticas con «la IA puede crear anuncios»: si no tienen ningún anuncio vivo o pausado, la IA propone y
 * crea UNO, APAGADO, dentro del presupuesto. Encenderlo siempre lo decide el dueño. Como mucho uno por vuelta.
 */
export async function autoCreateAds(now = new Date()): Promise<boolean> {
  const rows = await db.campaign.findMany({
    where: { mode: "auto", status: "active", budgetCents: { gt: 0 } },
    select: { id: true, businessId: true, ads: true, budgetCents: true },
  });
  for (const c of rows) {
    const ads = readCampaignAds(c.ads);
    if (!ads.aiCanCreate) continue;
    if (ads.items.some((a) => a.status !== "ended" && a.status !== "error")) continue;
    if (ads.autoTriedAt && now.getTime() - Date.parse(ads.autoTriedAt) < AUTO_EVERY_MS) continue;
    if (campaignRoomCents(c.budgetCents, ads.items) < MIN_DAILY_CENTS) continue;
    const [conn, settings] = await Promise.all([readAdsConn(c.businessId), getAdsSettings(c.businessId)]);
    if (!conn?.adAccountId || settings.monthlyCapCents <= 0) continue;
    await updateCampaignAds(c.id, (a) => ({ ...a, autoTriedAt: now.toISOString() }));
    try {
      const [first] = await proposeAds(c.businessId, c.id, "es");
      if (!first) return false;
      await createAd(c.businessId, c.id, await proposalInput(c.businessId, first), "auto", now);
      return true;
    } catch (e) {
      await logAiAction({
        businessId: c.businessId,
        campaignId: c.id,
        kind: "ad.error",
        actor: "auto",
        summary: {
          es: `La IA no pudo crear un anuncio: ${e instanceof Error ? e.message : String(e)}`.slice(0, 480),
          en: `The AI couldn't create an ad: ${e instanceof Error ? ((e as { en?: string }).en ?? e.message) : String(e)}`.slice(0, 480),
        },
      });
      return false;
    }
  }
  return false;
}
