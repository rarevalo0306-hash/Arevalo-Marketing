import Link from "next/link";
import { AiLogFilters } from "@/components/ailog/AiLogFilters";
import { AiLogTimeline, money } from "@/components/ailog/AiLogTimeline";
import s from "@/components/ailog/ailog.module.css";
import { PageHead } from "@/components/PageHead";
import { addDays } from "@/lib/campaign-shape";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { logWhere, readFilters } from "@/lib/proposals-log";
import { tzOf } from "@/lib/proposals-shape";
import { businessDay, fmtDate, localToUtc } from "@/lib/time";

/** Cuántas acciones se muestran como mucho en la pantalla (el CSV lleva todas las del período). */
const SHOW = 300;

export default async function RegistroPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const q = await searchParams;
  const { lang, t } = await getT();
  const b = await db.business.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, color: true, timezone: true } });
  const tz = tzOf(b);
  const f = readFilters(q, businessDay(new Date(), tz), addDays);
  const range = { gte: localToUtc(f.from, 0, "00:00", tz), lt: localToUtc(f.to, 1, "00:00", tz) };
  const where = logWhere(id, f, range);
  const [rows, total, byActor, campaigns] = await Promise.all([
    db.aiAction.findMany({ where, orderBy: { createdAt: "desc" }, take: SHOW, include: { campaign: { select: { name: true } } } }),
    db.aiAction.aggregate({ where, _sum: { costCents: true }, _count: { _all: true } }),
    db.aiAction.groupBy({ by: ["actor"], where, _count: { _all: true } }),
    db.campaign.findMany({ where: { businessId: id }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const count = (actor: string) => byActor.find((r) => r.actor === actor)?._count._all ?? 0;
  const items = rows.map((r) => ({ id: r.id, createdAt: r.createdAt, kind: r.kind, actor: r.actor, costCents: r.costCents, summary: r.summary, detail: r.detail, postId: r.postId, campaignId: r.campaignId, campaignName: r.campaign?.name ?? "" }));
  const period = `${fmtDate(new Date(`${f.from}T12:00:00Z`), lang, "UTC")} – ${fmtDate(new Date(`${f.to}T12:00:00Z`), lang, "UTC")}`;

  return (
    <>
      <PageHead
        business={b}
        prefix={t("Registro de", "Log for")}
        section={t("Lo que hizo la IA", "What the AI did")}
        title={t("Lo que hizo la IA", "What the AI did")}
        subtitle={t(
          "Todo lo que la IA hizo por tu negocio: sola o con tu aprobación, con lo que costó cada cosa. Las horas están en la zona de tu negocio.",
          "Everything the AI did for your business: on its own or with your approval, with what each thing cost. Times are in your business's time zone.",
        )}
        aside={
          <Link className="btn outline" href={`/b/${id}/propuestas`}>
            {t("Propuestas de la IA", "AI proposals")}
          </Link>
        }
      />

      <AiLogFilters businessId={id} f={f} campaigns={campaigns} lang={lang} t={t} />

      <div className={s.stats} aria-label={t("Resumen del período", "Period summary")}>
        <div className={s.stat}>
          <span className={s.statLabel}>{t("Acciones", "Actions")}</span>
          <span className={s.statValue}>{total._count._all}</span>
          <span className={s.statHint}>{period}</span>
        </div>
        <div className={s.stat}>
          <span className={s.statLabel}>{t("La IA sola", "AI on its own")}</span>
          <span className={s.statValue}>{count("auto")}</span>
          <span className={s.statHint}>{t("dentro de tus límites", "within your limits")}</span>
        </div>
        <div className={s.stat}>
          <span className={s.statLabel}>{t("Aprobadas por ti", "Approved by you")}</span>
          <span className={s.statValue}>{count("approved")}</span>
          <span className={s.statHint}>{count("owner") ? t(`y ${count("owner")} que hiciste tú`, `and ${count("owner")} you did`) : t("propuestas y borradores", "proposals and drafts")}</span>
        </div>
        <div className={s.stat}>
          <span className={s.statLabel}>{t("Costo total", "Total cost")}</span>
          <span className={s.statValue}>{money(total._sum.costCents ?? 0)}</span>
          <span className={s.statHint}>{t("IA, fotos, videos y anuncios", "AI, photos, videos and ads")}</span>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="card empty">{t("No hay nada en este período con estos filtros.", "Nothing in this period with these filters.")}</div>
      ) : (
        <>
          <AiLogTimeline items={items} businessId={id} lang={lang} t={t} tz={tz} />
          {total._count._all > SHOW && (
            <p className={s.more}>
              {t(`Se muestran las ${SHOW} más recientes de ${total._count._all}. El CSV lleva todas.`, `Showing the ${SHOW} most recent of ${total._count._all}. The CSV has all of them.`)}
            </p>
          )}
        </>
      )}
    </>
  );
}
