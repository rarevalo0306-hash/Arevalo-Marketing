// Lee de la base lo que espera la aprobación del dueño (ver approvals-shape.ts). Solo consultas pequeñas: nada de
// servicios externos, y de los reportes grandes (artículos, arreglos de la web) solo los campos que hacen falta.
import { Prisma } from "@prisma/client";
import { cache } from "react";
import { buildApprovals, type ApprovalFacts, type ApprovalItem, type Bi } from "@/lib/approvals-shape";
import { db } from "@/lib/db";
import { EXPIRE_DAYS } from "@/lib/proposals-shape";
import { readRankFixJob } from "@/lib/rankfix-shape";

const DAY_MS = 86_400_000;

const bi = (v: unknown): Bi | null => {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  return o && typeof o.es === "string" && typeof o.en === "string" && o.es.trim() ? { es: o.es, en: o.en || o.es } : null;
};

async function rankfix(businessId: string): Promise<ApprovalFacts["rankfix"]> {
  const row = await db.seoReport.findFirst({ where: { businessId, kind: "rankfix" }, orderBy: { createdAt: "desc" }, select: { id: true, data: true } });
  const job = row ? readRankFixJob(row.data) : null;
  return row && job ? { id: row.id, job } : null;
}

async function webfix(businessId: string): Promise<ApprovalFacts["webfix"]> {
  // Los arreglos guardan los cambios completos (diffs): solo se trae el estado y cuántos cambios hay.
  const rows = await db.$queryRaw<{ id: string; status: string | null; changes: number | null }[]>(
    Prisma.sql`select id, data->>'status' as status,
      case when jsonb_typeof(data->'changes') = 'array' then jsonb_array_length(data->'changes') else 0 end as changes
      from "SeoReport" where "businessId" = ${businessId} and kind = 'webfix' order by "createdAt" desc limit 1`,
  );
  const r = rows[0];
  return r ? { id: r.id, status: r.status ?? "", changes: Number(r.changes ?? 0) } : null;
}

async function proposals(businessId: string, now: Date): Promise<ApprovalFacts["proposals"]> {
  const where = { businessId, status: "proposed", createdAt: { gte: new Date(now.getTime() - EXPIRE_DAYS * DAY_MS) } };
  const [count, top] = await Promise.all([
    db.aiProposal.count({ where }),
    db.aiProposal.findFirst({ where, orderBy: [{ impact: "desc" }, { createdAt: "desc" }], select: { title: true } }),
  ]);
  return { count, title: top ? bi(top.title) : null };
}

async function articles(businessId: string): Promise<ApprovalFacts["articles"]> {
  // Solo el título: los artículos traen el texto completo y la investigación.
  const rows = await db.$queryRaw<{ id: string; title: string | null }[]>(
    Prisma.sql`select id, coalesce(nullif(data->'draft'->>'title', ''), data->>'keyword') as title
      from "SeoReport" where "businessId" = ${businessId} and kind = 'article'
        and jsonb_typeof(data->'site'->'prepared') = 'object' and coalesce(data->'site'->'prepared'->>'at', '') <> ''
        and coalesce(data->'site'->'published'->>'url', '') = ''
      order by "createdAt" desc limit 30`,
  );
  return rows.map((r) => ({ id: r.id, title: (r.title ?? "").slice(0, 140) }));
}

async function campaign(businessId: string): Promise<ApprovalFacts["campaign"]> {
  const posts = await db.post.findMany({
    where: {
      businessId,
      status: "draft",
      campaignId: { not: null },
      campaign: { is: { status: { notIn: ["stopped", "ended"] } } },
      // Un video que todavía se está creando no se puede aprobar.
      NOT: { kind: "video", mediaUrl: "" },
    },
    select: { campaignId: true, campaign: { select: { name: true } } },
    orderBy: { scheduledAt: "asc" },
    take: 200,
  });
  const ids = [...new Set(posts.map((p) => p.campaignId).filter((x): x is string => Boolean(x)))];
  return { count: posts.length, campaignIds: ids, name: posts[0]?.campaign?.name ?? "" };
}

/**
 * Las tarjetas de «Listo para tu aprobación». Si una consulta falla, esa parte simplemente no se muestra.
 * Con cache(): el Inicio y el menú (numerito de «Inicio») comparten la misma lectura en cada visita.
 */
export const loadApprovals = cache(async (businessId: string): Promise<ApprovalItem[]> => {
  const now = new Date();
  const [r, w, p, a, c] = await Promise.all([
    rankfix(businessId).catch(() => null),
    webfix(businessId).catch(() => null),
    proposals(businessId, now).catch(() => ({ count: 0, title: null })),
    articles(businessId).catch(() => []),
    campaign(businessId).catch(() => ({ count: 0, campaignIds: [], name: "" })),
  ]);
  return buildApprovals(businessId, { rankfix: r, webfix: w, proposals: p, articles: a, campaign: c });
});
