// CSV de «Lo que hizo la IA» con los mismos filtros de la pantalla (/b/<id>/registro/csv?desde=&hasta=&campana=&tipo=&quien=&lang=).
import { addDays, localParts } from "@/lib/campaign-shape";
import { db } from "@/lib/db";
import { asLang } from "@/lib/i18n";
import { logCsv, logWhere, readFilters } from "@/lib/proposals-log";
import { tzOf } from "@/lib/proposals-shape";
import { businessDay, localToUtc } from "@/lib/time";

export const dynamic = "force-dynamic";

const MAX_ROWS = 20_000;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await db.business.findUnique({ where: { id }, select: { id: true, name: true, timezone: true } });
  if (!b) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const q = Object.fromEntries(url.searchParams.entries());
  const lang = asLang(url.searchParams.get("lang"));
  const tz = tzOf(b);
  const f = readFilters(q, businessDay(new Date(), tz), addDays);
  const where = logWhere(id, f, { gte: localToUtc(f.from, 0, "00:00", tz), lt: localToUtc(f.to, 1, "00:00", tz) });
  const rows = await db.aiAction.findMany({ where, orderBy: { createdAt: "asc" }, take: MAX_ROWS, include: { campaign: { select: { name: true } } } });
  const csv = logCsv(
    rows.map((r) => ({ createdAt: r.createdAt, kind: r.kind, actor: r.actor, costCents: r.costCents, summary: r.summary, campaignName: r.campaign?.name ?? "" })),
    lang,
    (d) => {
      const p = localParts(d, tz);
      return { day: p.day, time: `${String(Math.floor(p.minutes / 60)).padStart(2, "0")}:${String(p.minutes % 60).padStart(2, "0")}` };
    },
  );
  const name = `${lang === "en" ? "ai-log" : "registro-ia"}-${f.from}-${f.to}.csv`;
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
