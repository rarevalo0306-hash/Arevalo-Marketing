// Datos de prueba compartidos de los reportes por periodo: un día (8 de octubre de 2026 en Managua) con todas las
// secciones llenas (richInputs) y el mismo día sin nada (quietInputs). Los usan report-period.test.ts y client-org-report.test.ts.
import { dayPeriod, type InputCampaign, type InputTarget, type ReportInputs } from "@/lib/report-period";

export const MGA = "America/Managua";
export const H = 3600_000;

export const DAY = dayPeriod("2026-10-08", MGA);
export const at = (h: number) => new Date(DAY.from.getTime() + h * H);

export const target = (o: Partial<InputTarget>): InputTarget => ({
  id: "t1",
  postId: "p1",
  channel: "facebook",
  status: "sent",
  externalUrl: "https://facebook.com/123_456",
  detail: "",
  at: at(10),
  title: "Portones enrollables en Managua",
  campaignId: "c1",
  kind: "post",
  ...o,
});

export const adItem = (o: Record<string, unknown> = {}) => ({
  id: "ad_1",
  platform: "meta",
  name: "Llamadas Managua",
  goal: "calls",
  source: { kind: "new", text: "x", headline: "y", image: "", link: "" },
  ext: {},
  status: "active",
  dailyCents: 500,
  totalCents: 5000,
  startsAt: "2026-10-01T00:00:00.000Z",
  endsAt: "2026-10-20T00:00:00.000Z",
  targeting: { lat: 12.1, lng: -86.2, radiusKm: 10, ageMin: null, ageMax: null, interests: [], place: "Managua", cityKey: "" },
  specialCategory: "NONE",
  insights: { spentCents: 1800, todayCents: 300, monthCents: 1800, impressions: 9000, reach: 4000, clicks: 120, results: 9, fetchedAt: "2026-10-09T06:03:00.000Z" },
  createdAt: "2026-10-01T15:00:00.000Z",
  createdBy: "owner",
  errors: [{ at: at(14).toISOString(), es: "Meta rechazó la foto.", en: "Meta rejected the photo." }],
  ...o,
});

export const campaign = (o: Partial<InputCampaign> = {}): InputCampaign => ({
  id: "c1",
  name: "Portones octubre",
  status: "active",
  mode: "auto",
  startsAt: new Date("2026-10-01T00:00:00Z"),
  endsAt: null,
  ads: { aiCanCreate: false, dailyCapCents: 0, items: [adItem()], proposals: [] },
  ...o,
});

export const rankRow = (keyword: string, position: number | null, top: { position: number; domain: string }[] = []) => ({
  keyword,
  position,
  url: null,
  localPack: null,
  top: top.map((t) => ({ ...t, title: t.domain, url: `https://${t.domain}` })),
  features: [],
});

export function richInputs(): ReportInputs {
  return {
    business: { id: "biz1", name: "Fameseg <Portones>", color: "#bb1111", color2: "", color3: "", website: "https://fameseg.com", logoUrl: "", fontHeading: "montserrat", aiText: "" },
    period: DAY,
    now: new Date("2026-10-09T06:10:00.000Z"),
    zones: [{ code: 2558, name: "Nicaragua" }],
    targets: [
      target({}),
      target({ id: "t2", channel: "instagram", externalUrl: "https://instagram.com/p/abc", at: at(10.1) }),
      target({ id: "t3", channel: "linkedin", status: "failed", externalUrl: "", detail: "LinkedIn pidió volver a conectar la cuenta.", at: at(10.2) }),
      target({ id: "t4", channel: "tiktok", status: "skipped", externalUrl: "", detail: "TikTok solo recibe videos", at: at(10.3) }),
    ],
    prevSent: 1,
    recentTargets: [target({}), target({ id: "t2", channel: "instagram", externalUrl: "https://instagram.com/p/abc" })],
    actions: [
      { id: "a1", kind: "post.scheduled", actor: "auto", summary: { es: "La IA programó una publicación para el viernes.", en: "The AI scheduled a post for Friday." }, costCents: 4, createdAt: at(9), campaignId: "c1" },
      { id: "a2", kind: "campaign.paused", actor: "auto", summary: { es: "La campaña se pausó por llegar al límite del día.", en: "The campaign paused after hitting the daily limit." }, costCents: 0, createdAt: at(16), campaignId: "c1" },
      { id: "a3", kind: "post.approved", actor: "approved", summary: { es: "Aprobaste una publicación.", en: "You approved a post." }, costCents: 0, createdAt: at(11), campaignId: "c1" },
    ],
    prevActions: { auto: 3, costCents: 7 },
    campaigns: [campaign()],
    adSnapshots: [{ at: new Date("2026-10-08T06:04:00.000Z"), items: [{ id: "ad_1", campaignId: "c1", spentCents: 1300, impressions: 6000, reach: 3000, clicks: 80, results: 6 }] }],
    metrics: [
      { postTargetId: "t1", channel: "facebook", fetchedAt: at(20), impressions: 900, reach: 700, likes: 30, comments: 4, shares: 2, saves: 1, clicks: 12, videoViews: 0 },
      { postTargetId: "t1", channel: "facebook", fetchedAt: at(12), impressions: 100, reach: 80, likes: 3, comments: 0, shares: 0, saves: 0, clicks: 1, videoViews: 0 },
      { postTargetId: "t2", channel: "instagram", fetchedAt: at(20), impressions: 400, reach: 350, likes: 20, comments: 1, shares: 0, saves: 3, clicks: 0, videoViews: 0 },
    ],
    reviews: {
      createdAt: at(22),
      data: {
        total: 41,
        rating: 4.8,
        createdAt: at(22).toISOString(),
        reviews: [
          { id: "r1", name: "Ana López", rating: 5, text: "Excelente servicio, muy rápidos.", timestamp: at(13).toISOString(), url: "https://maps.google.com/r1" },
          { id: "r2", name: "Pedro", rating: 2, text: "Tardaron en llegar.", timestamp: at(15).toISOString(), ownerAnswer: "Gracias, Pedro." },
          { id: "r3", name: "Old", rating: 5, text: "Viejo", timestamp: "2026-09-01T12:00:00.000Z" },
        ],
      },
    },
    gbp: null,
    ga4: {
      createdAt: new Date("2026-10-09T05:00:00.000Z"),
      data: {
        propertyId: "1",
        fetchedAt: "2026-10-09T05:00:00.000Z",
        range: { start: "2026-09-11", end: "2026-10-08" },
        previousRange: { start: "2026-08-14", end: "2026-09-10" },
        totals: { users: 300, newUsers: 200, sessions: 420, engagedSessions: 200, engagementRate: 0.5, avgEngagementSec: 40, keyEvents: 12, pageViews: 900 },
        previous: { users: 250, newUsers: 180, sessions: 380, engagedSessions: 150, engagementRate: 0.4, avgEngagementSec: 30, keyEvents: 8, pageViews: 800 },
        channels: [{ key: "Organic Search", sessions: 200, prevSessions: 150, engagedSessions: 100, keyEvents: 5 }],
        organicTrend: [
          { date: "2026-10-06", sessions: 6 },
          { date: "2026-10-07", sessions: 9 },
          { date: "2026-10-08", sessions: 14 },
        ],
      },
    },
    rank: [
      {
        createdAt: at(8),
        data: { location: "Nicaragua", locationCode: 2558, rows: [rankRow("portones enrollables", 2), rankRow("cortinas metálicas", 15, [{ position: 1, domain: "rival.com.ni" }])] },
      },
      {
        createdAt: new Date(DAY.from.getTime() - 6 * 24 * H),
        data: { location: "Nicaragua", locationCode: 2558, rows: [rankRow("portones enrollables", 6), rankRow("cortinas metálicas", 8, [{ position: 1, domain: "fameseg.com" }])] },
      },
    ],
    tasksDone: [{ title: { es: "Agregar el horario en Google", en: "Add hours on Google" }, area: "maps", href: "/b/biz1/seo", impact: 3, effort: 1, doneAt: at(12) }],
    tasksOpen: [{ title: { es: "Pedir 5 reseñas a clientes", en: "Ask 5 customers for reviews" }, area: "maps", href: "/b/biz1/directorios", impact: 3, effort: 1, doneAt: null }],
    proposals: [{ id: "pr1", kind: "timing", title: { es: "Publicar a las 7 p. m.", en: "Post at 7 p.m." }, impact: 3, status: "proposed", createdAt: at(5) }],
    upcoming: { count: 2, next: new Date("2026-10-09T15:00:00.000Z") },
  };
}

export function quietInputs(): ReportInputs {
  const r = richInputs();
  return { ...r, targets: [], recentTargets: [], actions: [], prevActions: { auto: 0, costCents: 0 }, campaigns: [], adSnapshots: [], metrics: [], reviews: null, ga4: null, rank: [], tasksDone: [], proposals: [] };
}
