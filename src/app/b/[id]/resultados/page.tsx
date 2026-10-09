import Link from "next/link";
import { PageHead } from "@/components/PageHead";
import { AdsPanel, ChannelPanel, GooglePanel, GroupPanel, KpiGrid, PostsPanel, TimingPanel, TrendPanel } from "@/components/results/Panels";
import { channelLabel } from "@/components/results/fmt";
import s from "@/components/results/Results.module.css";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { resultsSummary } from "@/lib/results";
import { lastDays, PERIODS, readPeriod } from "@/lib/results-shape";

export const dynamic = "force-dynamic";

/** Resumen de resultados: cómo le fue al negocio en los últimos 7, 30 o 90 días, comparado con el periodo anterior. */
export default async function ResultadosPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dias?: string }> }) {
  const { id } = await params;
  const days = readPeriod((await searchParams).dias);
  const { lang, t } = await getT();
  const b = await db.business.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, color: true } });
  const { from, to } = lastDays(days, new Date());
  const data = await resultsSummary(id, from, to);

  const social = ["facebook", "instagram", "youtube", "x", "linkedin", "tiktok", "google"];
  const hasSocial = data.channels.connected.some((c) => social.includes(c));
  const nothingYet = !hasSocial && data.kpis.posts.now === 0 && data.kpis.posts.prev === 0;

  return (
    <>
      <PageHead
        business={b}
        prefix={t("Resultados de", "Results for")}
        title={t("Resumen de resultados", "Results summary")}
        subtitle={t(`Cómo te fue en los últimos ${days} días, comparado con los ${days} días anteriores.`, `How you did in the last ${days} days, compared with the ${days} days before.`)}
        aside={
          <>
            <nav className={s.period} aria-label={t("Periodo", "Period")}>
              {PERIODS.map((d) => (
                <Link key={d} href={`/b/${id}/resultados?dias=${d}`} aria-current={d === days ? "page" : undefined} scroll={false}>
                  {t(`${d} días`, `${d} days`)}
                </Link>
              ))}
            </nav>
            <Link className="btn outline" href={`/b/${id}/reportes`}>
              {t("Reporte por fechas", "Report by dates")}
            </Link>
          </>
        }
      />

      <div className={s.root}>
        {nothingYet ? (
          <section className={`card ${s.empty}`}>
            <h2 className={s.sectionTitle}>{t("Conecta Facebook para ver tus resultados", "Connect Facebook to see your results")}</h2>
            <p className="muted">
              {t(
                "Cuando conectes tus redes y publiques desde aquí, en esta pantalla vas a ver cuánta gente vio tus publicaciones, quién interactuó, qué funcionó mejor y a qué hora conviene publicar.",
                "Once you connect your channels and post from here, this screen shows how many people saw your posts, who interacted, what worked best and when it's best to post.",
              )}
            </p>
            <div className="row">
              <Link className="btn solid" href={`/b/${id}/conexiones`}>
                {t("Conectar mis redes", "Connect my channels")}
              </Link>
              <Link className="btn outline" href={`/b/${id}/publicar`}>
                {t("Hacer una publicación", "Make a post")}
              </Link>
            </div>
          </section>
        ) : (
          <Notes data={data} lang={lang} t={t} />
        )}

        <KpiGrid data={data} lang={lang} days={days} bizId={id} />
        <TrendPanel data={data} lang={lang} />
        <div className={s.grid2}>
          <ChannelPanel data={data} lang={lang} />
          <GroupPanel data={data} lang={lang} kind="format" />
        </div>
        <PostsPanel data={data} lang={lang} />
        <TimingPanel data={data} lang={lang} />
        <div className={s.grid2}>
          <GroupPanel data={data} lang={lang} kind="campaign" />
          <AdsPanel data={data} lang={lang} bizId={id} />
        </div>
        <GooglePanel data={data} lang={lang} bizId={id} />
      </div>
    </>
  );
}

function Notes({ data, lang, t }: { data: Awaited<ReturnType<typeof resultsSummary>>; lang: "es" | "en"; t: (es: string, en: string) => string }) {
  const n = data.notes;
  const names = (list: string[]) => list.map((c) => channelLabel(c, lang)).join(", ");
  const noneMeasured = data.channels.measured.length === 0;
  if (!noneMeasured && !n.insightsMissing.length && !n.errors.length && !n.unmeasured && !data.channels.skipped.length) return null;
  return (
    <div className={s.notes}>
      {noneMeasured && (
        <p className="note info">
          {t("Conecta Facebook, Instagram o YouTube para ver cuánta gente ve tus publicaciones. ", "Connect Facebook, Instagram or YouTube to see how many people see your posts. ")}
          <Link href={`/b/${data.businessId}/conexiones`}>{t("Ir a Conexiones", "Go to Connections")}</Link>
        </p>
      )}
      {n.insightsMissing.length > 0 && (
        <p className="note">
          {t(
            `${names(n.insightsMissing)}: por ahora solo vemos me gusta, comentarios y compartidos. Para ver cuántas personas lo vieron hace falta el permiso de estadísticas de Meta.`,
            `${names(n.insightsMissing)}: for now we only see likes, comments and shares. Seeing how many people saw it needs Meta's insights permission.`,
          )}
        </p>
      )}
      {n.errors.length > 0 && (
        <p className="note error">
          {t(
            `No se pudieron leer algunos resultados de ${names(n.errors.map((e) => e.channel))}. Si sigue pasando, vuelve a conectar esa red en Conexiones.`,
            `Some results from ${names(n.errors.map((e) => e.channel))} couldn't be read. If it keeps happening, reconnect that channel in Connections.`,
          )}
        </p>
      )}
      {n.unmeasured > 0 && (
        <p className="small muted">
          {t(
            `${n.unmeasured} ${n.unmeasured === 1 ? "publicación todavía no tiene" : "publicaciones todavía no tienen"} resultados: se leen 1 hora, 1 día, 3 días, 1 semana y 1 mes después de publicar.`,
            `${n.unmeasured} ${n.unmeasured === 1 ? "post has" : "posts have"} no results yet: they're read 1 hour, 1 day, 3 days, 1 week and 1 month after posting.`,
          )}
        </p>
      )}
      {data.channels.skipped.length > 0 && (
        <details className={s.howTo}>
          <summary>{t("¿Por qué no veo resultados de todas mis redes?", "Why don't I see results from all my channels?")}</summary>
          <ul>
            {data.channels.skipped.map((x) => (
              <li key={x.channel}>
                <b>{channelLabel(x.channel, lang)}:</b> {lang === "en" ? x.en : x.es}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
