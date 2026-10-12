import { db } from "@/lib/db";
import { businessTz } from "@/lib/business-tz";
import { industryFor, toolCatalog } from "./industry";
import { Knowledge, type Context } from "./schema";

export async function loadContext(businessId: string): Promise<Context> {
  const [b, settings, posts, campaigns, messages] = await Promise.all([
    db.business.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        website: true,
        aiProfile: true,
        brandVoice: true,
        brandIdentity: true,
        seoKeywords: true,
        study: true,
        studyAt: true,
        timezone: true,
        color: true,
        logoUrl: true,
        connections: { select: { channel: true } },
      },
    }),
    db.agentWorkspace.findUnique({ where: { businessId } }),
    db.post.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        text: true,
        status: true,
        createdAt: true,
        targets: { select: { channel: true, status: true, externalUrl: true } },
      },
    }),
    db.campaign.findMany({
      where: { businessId },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: { id: true, name: true, status: true, mode: true },
    }),
    db.agentMessage.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { role: true, text: true },
    }),
  ]);
  const { connections, ...business } = b;
  const industry = industryFor(settings?.industry ?? "general");
  return {
    business: {
      ...business,
      timezone: businessTz(b),
      studyAt: b.studyAt?.toISOString() ?? null,
    },
    industry,
    revision: settings?.revision ?? 0,
    capturedAt: new Date().toISOString(),
    objective: settings?.objective ?? "",
    memory: settings?.memory ?? "",
    knowledge: (Knowledge.array().safeParse(settings?.knowledge).data ?? [])
      .filter((fact) => fact.geography === industry.geography),
    connections: connections.map((c) => c.channel),
    campaigns,
    posts: posts.map((p) => ({
      ...p,
      text: p.text.slice(0, 300),
      createdAt: p.createdAt.toISOString(),
    })),
    tools: toolCatalog(businessId),
    messages: messages
      .reverse()
      .map((m) => ({ ...m, text: m.text.slice(0, 1000) })),
  };
}
export function briefing(c: Context, en = false) {
  const failed = c.posts.filter((p) =>
    ["partial", "failed", "publishing"].includes(p.status),
  );
  const scheduled = c.posts.filter((p) => p.status === "scheduled");
  const active = c.campaigns.filter((x) => x.status === "active");
  const old = c.knowledge.filter(
    (k) => new Date(k.expiresAt).getTime() < Date.now(),
  ).length;
  return en
    ? `${c.business.name}: ${active.length} active campaigns in the latest 12. Of the latest ${c.posts.length} posts, ${scheduled.length} are scheduled and ${failed.length} need attention.\nIndustry: ${c.industry.name}. Area: ${c.industry.geography}.\n${old ? `${old} knowledge sources need review.` : "Check source dates before using industry facts."}\n${!c.business.studyAt ? "The business study is still missing." : `Business study: ${c.business.studyAt.slice(0, 10)}.`}`
    : `${c.business.name}: ${active.length} campañas activas entre las últimas 12. De las últimas ${c.posts.length} publicaciones, ${scheduled.length} están programadas y ${failed.length} necesitan atención.\nIndustria: ${c.industry.name}. Zona: ${c.industry.geography}.\n${old ? `${old} fuentes de conocimiento necesitan revisión.` : "Comprueba la vigencia de las fuentes antes de usar hechos de la industria."}\n${!c.business.studyAt ? "Falta el estudio del negocio." : `Estudio del negocio: ${c.business.studyAt.slice(0, 10)}.`}`;
}
