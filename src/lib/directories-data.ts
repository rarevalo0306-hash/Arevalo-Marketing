// Lee de la base de datos lo que necesita «Directorios y reseñas» (y las reglas del plan de acción): el negocio, su
// Perfil de Google, sus reseñas, los directorios marcados, los envíos de pedidos de reseñas y las descripciones.
// No gasta nada: solo lee lo guardado.
import { recentAiActions } from "@/lib/ai-actions";
import { db } from "@/lib/db";
import {
  detectKind,
  detectPlace,
  directoriesFor,
  effectiveStatus,
  googleReviewLink,
  listingProgress,
  napIssues,
  officialNap,
  placeIdOf,
  readDescriptions,
  templateDescriptions,
  type BizKind,
  type BizPlace,
  type Directory,
  type ListingStatus,
  type NapDescriptions,
  type NapIssue,
  type NapSource,
} from "@/lib/directories";
import { businessPlace } from "@/lib/media-formats";
import { NAP_DESCRIPTION_KIND, readRequestLog, REVIEW_COOLDOWN_DAYS, REVIEW_LINK_KIND, REVIEW_REQUEST_KIND, sentInLogs } from "@/lib/reviews-request";
import { readAuditReport } from "@/lib/seo/audit";
import { readTrackedKeywords, readZones } from "@/lib/seo/dataforseo";
import { readGbpReport, readReviewsReport, type GbpProfile, type ReviewStats } from "@/lib/seo/gbp";
import { readMapPlace, type MapPlace } from "@/lib/seo/maprank";
import { listingDomains } from "@/lib/seo/prompts";
import { readRankReport, type RankReport } from "@/lib/seo/rank";
import { latestReports } from "@/lib/seo/reports";
import { DAYS, DAY_NAMES, readDfsTimetable, readSchemaExtras, readWeekHours, SCHEMA_KIND, schemaStatus, type SchemaStatus, type WeekHours } from "@/lib/seo/schema";
import { readStudy, topKeywords } from "@/lib/study-shape";

const DAY_MS = 86_400_000;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export type ListingRow = { directory: string; status: string; url: string; notes: string; napOk: boolean | null; checkedAt: Date | null };

/** Lo que las reglas del plan de acción necesitan (y la base de la página). */
export type DirectoryBasics = {
  business: { id: string; name: string; color: string; website: string; phone: string; logoUrl: string; brandIdentity: unknown; brandVoice: string; aiProfile: string; ownerName: string };
  place: BizPlace;
  kind: BizKind;
  dirs: (Directory & { searchUrl: string })[];
  listings: ListingRow[];
  /** Tu perfil de Google (último reporte "gbp") y cuándo se guardó. */
  profile: GbpProfile | null;
  profileAt: Date | null;
  mapPlace: MapPlace | null;
  nap: NapSource[];
  issues: NapIssue[];
  /** Cuándo se revisaron los datos (el reporte más nuevo usado). */
  napAt: Date | null;
  reviewLink: string;
  /** Google ya está: hay perfil guardado o lugar elegido en el mapa. */
  googleKnown: boolean;
  /** La última vez que se compartió el link de reseñas (envío o copia), o null. */
  lastShared: Date | null;
};

const BUSINESS_SELECT = {
  id: true,
  name: true,
  color: true,
  website: true,
  phone: true,
  logoUrl: true,
  aiProfile: true,
  brandVoice: true,
  brandIdentity: true,
  ownerName: true,
  seoKeywords: true,
  seoMapPlace: true,
  seoLocations: true,
  seoLocationCode: true,
  seoLocationName: true,
  study: true,
  studyInput: true,
} as const;

/** La última vez que se compartió el link de reseñas (de los registros de la IA), o null. */
async function lastShare(businessId: string): Promise<Date | null> {
  const logs = await recentAiActions(businessId, { since: new Date(Date.now() - 365 * DAY_MS), limit: 300 });
  return logs.find((l) => l.kind === REVIEW_REQUEST_KIND || l.kind === REVIEW_LINK_KIND)?.createdAt ?? null;
}

export async function loadDirectoryBasics(businessId: string): Promise<DirectoryBasics | null> {
  const b = await db.business.findUnique({ where: { id: businessId }, select: BUSINESS_SELECT });
  if (!b) return null;
  const [[gbpRow], listings, shared] = await Promise.all([
    latestReports(businessId, "gbp"),
    db.directoryListing.findMany({ where: { businessId }, select: { directory: true, status: true, url: true, notes: true, napOk: true, checkedAt: true } }),
    lastShare(businessId),
  ]);
  const gbp = gbpRow ? readGbpReport(gbpRow.data) : null;
  const profile = gbp?.profile ?? null;
  const mapPlace = readMapPlace(b.seoMapPlace);
  const study = readStudy(b.study);
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const bp = businessPlace(b);
  const text = [b.name, b.aiProfile, study?.summary ?? "", ...(study?.services ?? []).map((s) => s.name), ...readTrackedKeywords(b.seoKeywords)].join(" \n ");
  const place = detectPlace({
    countryCode: bp.countryCode,
    country: bp.country,
    state: bp.state,
    city: bp.city,
    zones: zones.map((z) => z.name),
    phone: b.phone || profile?.phone || "",
    website: b.website,
    text: `${b.aiProfile} ${study?.market.area ?? ""}`,
  });
  const kind = detectKind(text);
  const dirs = directoriesFor({ region: place.region, kind, florida: place.florida, name: b.name, city: place.city });
  const nap: NapSource[] = [
    { id: "app", values: { name: b.name, phone: b.phone, website: b.website } },
    ...(profile ? [{ id: "gbp" as const, values: { name: profile.title, phone: profile.phone, address: profile.address, website: profile.url } }] : []),
    ...(mapPlace ? [{ id: "maps" as const, values: { name: mapPlace.title, address: mapPlace.address } }] : []),
  ];
  return {
    business: { id: b.id, name: b.name, color: b.color, website: b.website, phone: b.phone, logoUrl: b.logoUrl, brandIdentity: b.brandIdentity, brandVoice: b.brandVoice, aiProfile: b.aiProfile, ownerName: b.ownerName },
    place,
    kind,
    dirs,
    listings,
    profile,
    profileAt: gbpRow?.createdAt ?? null,
    mapPlace,
    nap,
    issues: napIssues(nap),
    napAt: gbpRow?.createdAt ?? null,
    reviewLink: googleReviewLink(placeIdOf(profile?.placeId, mapPlace?.placeId)),
    googleKnown: !!(profile || mapPlace),
    lastShared: shared,
  };
}

// ---------- Todo lo de la página ----------

export type DirectoryContact = { id: string; name: string; email: string; phone: string; emailOptIn: boolean; smsOptIn: boolean; lists: string[] };

export type DirectoryPageData = DirectoryBasics & {
  official: { name: string; phone: string; address: string; website: string };
  hours: { day: string; es: string; en: string; text: string }[];
  categories: string[];
  keywords: string[];
  services: string[];
  descriptions: NapDescriptions;
  descriptionsFromAi: boolean;
  descriptionsAt: Date | null;
  schema: SchemaStatus;
  statuses: Record<string, ListingStatus>;
  progress: { done: number; total: number };
  /** Directorios que Google ya muestra en tus búsquedas (de «tus posiciones»). */
  seenInSearch: string[];
  reviews: { rating: number | null; total: number | null; unanswered: number; unansweredLow: number; last30: number; at: Date | null } | null;
  contacts: DirectoryContact[];
  /** Contactos a los que ya se les pidió reseña en los últimos REVIEW_COOLDOWN_DAYS días. */
  recentlyAsked: string[];
  sentToday: number;
  requests: { at: Date; channel: "email" | "sms"; sent: number; failed: number }[];
};

function hoursLines(h: WeekHours | null): DirectoryPageData["hours"] {
  if (!h) return [];
  return DAYS.map((d) => {
    const ranges = h[d] ?? [];
    return { day: d, es: DAY_NAMES[d].es, en: DAY_NAMES[d].en, text: ranges.map((r) => `${r.opens}–${r.closes}`).join(", ") };
  });
}

export async function loadDirectoryPage(businessId: string): Promise<DirectoryPageData | null> {
  const base = await loadDirectoryBasics(businessId);
  if (!base) return null;
  const now = Date.now();
  const [b, [gbpRow], [reviewsRow], [auditRow], [extrasRow], rankRows, contacts, logs] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: { study: true, seoKeywords: true } }),
    latestReports(businessId, "gbp"),
    latestReports(businessId, "reviews"),
    latestReports(businessId, "audit"),
    db.seoReport.findMany({ where: { businessId, kind: SCHEMA_KIND }, orderBy: { createdAt: "desc" }, take: 1 }),
    latestReports(businessId, "rank", 3),
    db.contact.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, email: true, phone: true, emailOptIn: true, smsOptIn: true, lists: true } }),
    recentAiActions(businessId, { since: new Date(now - 400 * DAY_MS), limit: 500 }),
  ]);
  const study = readStudy(b?.study);
  const tracked = readTrackedKeywords(b?.seoKeywords);
  const seenKw = new Set<string>();
  const keywords = [...tracked, ...(study ? topKeywords(study, 8) : [])].filter((k) => {
    const key = k.trim().toLowerCase();
    if (!key || seenKw.has(key)) return false;
    seenKw.add(key);
    return true;
  }).slice(0, 10);
  const services = (study?.services ?? []).map((s) => s.name).filter(Boolean).slice(0, 8);

  const rawProfile = obj(obj(gbpRow?.data).profile);
  const extras = extrasRow ? readSchemaExtras(extrasRow.data) : null;
  const hours = extras?.hours ?? readWeekHours(rawProfile.hours) ?? readDfsTimetable(rawProfile.timetable ?? rawProfile.hours);
  const official = officialNap(base.nap);
  const categories = base.profile ? [base.profile.category, ...base.profile.additionalCategories].filter(Boolean) : [];

  const descLog = logs.find((l) => l.kind === NAP_DESCRIPTION_KIND);
  const saved = descLog ? readDescriptions(descLog.detail) : null;
  const descriptions = saved ?? templateDescriptions({ name: base.business.name, services, city: base.place.city, keywords, phone: official.phone });

  const audit = auditRow ? readAuditReport(auditRow.data) : null;
  const statuses: Record<string, ListingStatus> = {};
  for (const d of base.dirs) statuses[d.id] = effectiveStatus(d.id, base.listings, { googleKnown: base.googleKnown });

  const ranks = rankRows.map((r) => readRankReport(r.data)).filter((r): r is RankReport => !!r);
  const domains = listingDomains(ranks, [], 30);
  const label = (d: string) => d.toLowerCase().split(".")[0];
  const seenInSearch = base.dirs.filter((d) => domains.some((x) => x.split(".").includes(label(d.domain)))).map((d) => d.id);

  const rev = reviewsRow ? readReviewsReport(reviewsRow.data) : null;
  const reviews =
    rev || base.profile
      ? {
          rating: rev?.rating ?? base.profile?.rating ?? null,
          total: rev?.total ?? base.profile?.reviews ?? null,
          unanswered: rev?.stats.unanswered ?? 0,
          unansweredLow: rev?.stats.unansweredLow ?? 0,
          last30: rev?.stats.last30 ?? 0,
          at: reviewsRow?.createdAt ?? base.profileAt,
        }
      : null;

  const cooldown = now - REVIEW_COOLDOWN_DAYS * DAY_MS;
  const reqLogs = logs.filter((l) => l.kind === REVIEW_REQUEST_KIND);
  const recentlyAsked = new Set<string>();
  for (const l of reqLogs) if (l.createdAt.getTime() >= cooldown) for (const id of readRequestLog(l.detail)?.contactIds ?? []) recentlyAsked.add(id);
  const sentToday = sentInLogs(reqLogs.filter((l) => l.createdAt.getTime() >= now - DAY_MS));
  const requests = reqLogs.slice(0, 8).map((l) => {
    const d = readRequestLog(l.detail);
    return { at: l.createdAt, channel: d?.channel ?? "email", sent: d?.sent ?? 0, failed: d?.failed ?? 0 };
  });

  return {
    ...base,
    official,
    hours: hoursLines(hours),
    categories,
    keywords,
    services,
    descriptions,
    descriptionsFromAi: !!saved,
    descriptionsAt: saved ? (descLog?.createdAt ?? null) : null,
    schema: schemaStatus(audit).status,
    statuses,
    progress: listingProgress(base.dirs, base.listings, { googleKnown: base.googleKnown }),
    seenInSearch,
    reviews,
    contacts,
    recentlyAsked: [...recentlyAsked],
    sentToday,
    requests,
  };
}

/** Lo que el plan de acción necesita de esta pantalla (null si el negocio no existe). */
export async function directoryPlanInput(businessId: string) {
  const b = await loadDirectoryBasics(businessId);
  if (!b) return null;
  return {
    dirs: b.dirs.map((d) => ({ id: d.id, name: d.name, priority: d.priority, kind: d.kind, why: d.why })),
    listings: b.listings.map((l) => ({ directory: l.directory, status: l.status, napOk: l.napOk })),
    googleKnown: b.googleKnown,
    issues: b.issues,
    napAt: b.napAt,
    reviewLink: !!b.reviewLink,
    lastShared: b.lastShared,
  };
}
