import { z } from "zod";
import { CHANNEL_IDS } from "@/lib/channels";

export const RunKind = z.enum([
  "briefing",
  "conversation",
  "campaign",
  "radar",
  "optimize",
  "pause",
  "video",
  "verify_news",
]);
export type RunKind = z.infer<typeof RunKind>;
export const Source = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.url().max(500),
  primary: z.boolean(),
  geography: z.string().max(100),
});
export const Knowledge = z
  .object({
    fact: z.string().trim().min(1).max(1000),
    url: z.url().max(500),
    checkedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    geography: z.string().max(100),
  })
  .refine(
    (k) =>
      Date.parse(k.checkedAt) <= Date.now() + 60000 &&
      Date.parse(k.expiresAt) > Date.parse(k.checkedAt),
    "Revisa las fechas de vigencia del hecho.",
  );
export const Settings = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(["auto", "approval"]),
    allowPublish: z.boolean(),
    industry: z.enum([
      "general",
      "public-adjusting-fl",
      "commercial-security-ni",
    ]),
    objective: z.string().trim().max(1500),
    memory: z.string().trim().max(6000),
    channels: z
      .array(z.enum(CHANNEL_IDS as [string, ...string[]]))
      .max(10)
      .transform((v) => [...new Set(v)]),
    sources: z.array(Source).max(8),
    knowledge: z.array(Knowledge).max(30),
    dailyBudgetCents: z.number().int().min(0).max(100000),
    runBudgetCents: z.number().int().min(0).max(10000),
    maxPostsPerDay: z.number().int().min(1).max(12),
    radarEnabled: z.boolean(),
    radarHours: z.number().int().min(6).max(168),
  })
  .refine(
    (s) => s.runBudgetCents <= s.dailyBudgetCents,
    "El límite por trabajo supera el diario.",
  );
export type Settings = z.infer<typeof Settings>;
export const MessageInput = z.object({
  text: z.string().trim().min(1).max(4000),
  requestKey: z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/),
  kind: RunKind.optional(),
  newsId: z.string().max(100).optional(),
  campaignId: z.string().max(100).optional(),
});
export const Research = z.object({
  summary: z.string().max(2000),
  audience: z.string().max(500),
  angle: z.string().max(500),
  keywords: z.array(z.string().max(80)).max(12),
  facts: z
    .array(z.object({ text: z.string().max(700), source: z.string().max(500) }))
    .max(12),
  uncertainties: z.array(z.string().max(300)).max(10),
});
export const Copy = z.object({
  title: z.string().min(1).max(100),
  headline: z.string().min(1).max(65),
  summary: z.string().max(2000),
  variants: z.object({
    facebook: z.string().max(6000),
    instagram: z.string().max(2100),
    google: z.string().max(1400),
    linkedin: z.string().max(2900),
    x: z.string().max(270),
    seo: z.string().max(9000),
  }),
  script: z.string().max(5000),
  alt: z.string().max(250),
});
export const Reply = z.object({ text: z.string().min(1).max(5000) });
export type Context = {
  business: {
    id: string;
    name: string;
    website: string;
    aiProfile: string;
    brandVoice: string;
    study: unknown;
    studyAt: string | null;
    timezone: string;
    color: string;
    logoUrl: string;
    brandIdentity: unknown;
    seoKeywords: unknown;
  };
  industry: {
    key: string;
    name: string;
    geography: string;
    audience: string;
    focus: string[];
  };
  revision: number;
  capturedAt: string;
  objective: string;
  memory: string;
  knowledge: z.infer<typeof Knowledge>[];
  connections: string[];
  campaigns: { id: string; name: string; status: string; mode: string }[];
  posts: {
    id: string;
    status: string;
    text: string;
    createdAt: string;
    targets: { channel: string; status: string; externalUrl: string }[];
  }[];
  tools: { name: string; href: string; execution: string }[];
  messages: { role: string; text: string }[];
  news?: {
    id: string;
    title: string;
    summary: string;
    source: string;
    evidence: unknown;
    revision: number;
  };
  campaignId?: string;
};
export const stepsFor = (kind: RunKind): string[] =>
  ({
    briefing: ["briefing"],
    conversation: ["conversation"],
    campaign: ["research", "copy", "design", "prepare", "schedule", "verify"],
    video: [
      "research",
      "copy",
      "design",
      "video",
      "video_wait",
      "prepare",
      "schedule",
      "verify",
    ],
    verify_news: ["verify_news"],
    radar: ["radar"],
    optimize: ["optimize"],
    pause: ["pause"],
  })[kind];
export const roleFor = (step: string) =>
  ["research", "radar", "verify_news"].includes(step)
    ? "investigacion"
    : step === "copy"
      ? "redaccion"
      : step === "design" || step.startsWith("video")
        ? "diseno"
        : "matya";
export function inferKind(text: string): RunKind {
  const s = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (
    /^(ponme al dia|resumen|que hiciste|bring me up to date|briefing)/.test(s)
  )
    return "briefing";
  if (/^(prepara|crea|prepare|create).*(video|reel|short)/.test(s))
    return "video";
  if (
    /^(prepara|crea|prepare|create).*(campana|campaign|contenido|content)/.test(
      s,
    )
  )
    return "campaign";
  if (/^(busca|revisa|search|check).*(noticias|news)/.test(s)) return "radar";
  if (
    /^(analiza|optimiza|analyze|optimize).*(campana|campaign|resultado|result)/.test(
      s,
    )
  )
    return "optimize";
  return "conversation";
}
