import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { deletePost, publishNow } from "@/app/actions";
import { PageHead } from "@/components/PageHead";
import { channelDef, channelName, CHANNEL_IDS } from "@/lib/channels";
import { connectionsNeedingReconnect, decideReconnect } from "@/lib/connection-health";
import { db } from "@/lib/db";
import type { UiLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { explainFailure, explainSent, viewLabel } from "@/lib/publish-errors";
import { businessTzLabel, fmtWhen } from "@/lib/time";
import s from "./historial.module.css";
import { RetryButton } from "./RetryButton";

const POST_STATUS: Record<UiLang, Record<string, string>> = {
  es: { draft: "Borrador", scheduled: "Programado", publishing: "Publicando…", done: "Publicado", partial: "Publicado en parte", failed: "No se publicó" },
  en: { draft: "Draft", scheduled: "Scheduled", publishing: "Posting…", done: "Posted", partial: "Partly posted", failed: "Not posted" },
};

type Filter = "todas" | "publicadas" | "error" | "programadas";
const FILTERS: Filter[] = ["todas", "publicadas", "error", "programadas"];

function filterWhere(f: Filter, businessId: string): Prisma.PostWhereInput {
  if (f === "publicadas") return { businessId, targets: { some: { status: "sent" } } };
  if (f === "error") return { businessId, status: { in: ["failed", "partial", "done"] }, targets: { some: { status: "failed" } } };
  if (f === "programadas") return { businessId, status: { in: ["scheduled", "publishing", "draft"] } };
  return { businessId };
}

// Reintentar o "Publicar ya" publica en el momento.
export const maxDuration = 300;

export default async function HistorialPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nuevo?: string; ver?: string }>;
}) {
  const { id } = await params;
  const { nuevo, ver } = await searchParams;
  const filter: Filter = FILTERS.includes(ver as Filter) ? (ver as Filter) : "todas";
  const { lang, t } = await getT();
  const when = (d: Date) => fmtWhen(d, lang);
  const b = await db.business.findUniqueOrThrow({ where: { id }, include: { connections: { select: { channel: true, updatedAt: true } } } });
  const [posts, counts, reconnect] = await Promise.all([
    db.post.findMany({ where: filterWhere(filter, id), include: { targets: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    Promise.all(FILTERS.map((f) => db.post.count({ where: filterWhere(f, id) }))),
    connectionsNeedingReconnect(id),
  ]);
  const names = Object.fromEntries(CHANNEL_IDS.map((c) => [c, channelName(c, lang)]));
  const filterLabel: Record<Filter, string> = {
    todas: t("Todas", "All"),
    publicadas: t("Publicadas", "Posted"),
    error: t("Con error", "With errors"),
    programadas: t("Programadas", "Scheduled"),
  };
  const brokenMeta = ["facebook", "instagram"].filter((c) => reconnect[c]);
  const brokenOther = Object.keys(reconnect).filter((c) => !brokenMeta.includes(c));

  return (
    <>
      <PageHead
        business={b}
        prefix={t("Historial de", "History for")}
        title={t("Historial", "History")}
        subtitle={t(
          `Todo lo que has publicado o programado, y cómo le fue en cada canal. Las horas están en ${businessTzLabel("es")}.`,
          `Everything you've posted or scheduled, and how it did on each channel. Times are in ${businessTzLabel("en")}.`,
        )}
        aside={
          <Link className="btn outline" href={`/b/${id}/publicar`}>
            {t("Nueva publicación", "New post")}
          </Link>
        }
      />

      {brokenMeta.length > 0 && (
        <div className={`note error ${s.alert}`} role="alert">
          <p>
            <strong>
              {brokenMeta.length === 2
                ? t("Facebook e Instagram necesitan volver a conectarse.", "Facebook and Instagram need to be reconnected.")
                : t(`${names[brokenMeta[0]]} necesita volver a conectarse.`, `${names[brokenMeta[0]]} needs to be reconnected.`)}
            </strong>{" "}
            {t(
              "Facebook quitó el permiso para publicar en tu página, así que tus publicaciones no están saliendo ahí. Vuelve a conectar Facebook (toma 1 minuto) y luego reintenta.",
              "Facebook removed the permission to post on your Page, so your posts aren't going out there. Reconnect Facebook (takes 1 minute) and then retry.",
            )}
          </p>
          <Link className="btn" href={`/b/${id}/conexiones#c-facebook`}>
            {t("Volver a conectar Facebook", "Reconnect Facebook")}
          </Link>
        </div>
      )}
      {brokenOther.map((c) => (
        <div key={c} className={`note error ${s.alert}`} role="alert">
          <p>
            <strong>{t(`${names[c]} necesita volver a conectarse.`, `${names[c]} needs to be reconnected.`)}</strong>{" "}
            {t("La conexión dejó de funcionar, así que no se está publicando ahí.", "The connection stopped working, so nothing is being posted there.")}
          </p>
          <Link className="btn" href={`/b/${id}/conexiones#c-${c}`}>
            {t(`Volver a conectar ${names[c]}`, `Reconnect ${names[c]}`)}
          </Link>
        </div>
      ))}

      <nav className={`tabs ${s.filters}`} aria-label={t("Filtrar publicaciones", "Filter posts")}>
        {FILTERS.map((f, i) => (
          <Link
            key={f}
            href={f === "todas" ? `/b/${id}/historial` : `/b/${id}/historial?ver=${f}`}
            className={`tab ${s.filter} ${filter === f ? "on" : ""}`}
            aria-current={filter === f ? "page" : undefined}
            scroll={false}
          >
            {filterLabel[f]} <span className={`${s.count} ${f === "error" && counts[i] > 0 ? s.countBad : ""}`}>{counts[i]}</span>
          </Link>
        ))}
      </nav>

      {posts.length === 0 ? (
        <div className="card empty">
          {filter === "todas" ? (
            <>
              {t("Todavía no has publicado nada.", "You haven't posted anything yet.")}{" "}
              <Link href={`/b/${id}/publicar`}>{t("Haz tu primera publicación", "Make your first post")}</Link>
            </>
          ) : filter === "error" ? (
            t("¡Bien! No hay publicaciones con errores.", "Nice! No posts with errors.")
          ) : (
            t("No hay publicaciones aquí.", "No posts here.")
          )}
        </div>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {posts.map((p) => {
            const sentTimes = p.targets.filter((x) => x.status === "sent" && x.sentAt).map((x) => x.sentAt!.getTime());
            const finished = ["done", "partial", "failed"].includes(p.status);
            const retryable = finished ? p.targets.filter((x) => x.status === "failed" || x.status === "skipped" || x.status === "pending") : [];
            const dateLine =
              p.status === "scheduled"
                ? t(`Sale ${when(p.scheduledAt)}`, `Goes out ${when(p.scheduledAt)}`)
                : p.status === "draft"
                  ? t(`Saldría ${when(p.scheduledAt)} (falta aprobarlo en Plan)`, `Would go out ${when(p.scheduledAt)} (needs approval in Plan)`)
                  : p.status === "publishing"
                    ? t("Publicando ahora…", "Posting now…")
                    : sentTimes.length
                      ? t(`Publicado ${when(new Date(Math.min(...sentTimes)))}`, `Posted ${when(new Date(Math.min(...sentTimes)))}`)
                      : t(`Último intento ${when(p.scheduledAt)}`, `Last try ${when(p.scheduledAt)}`);
            const title = p.subject || p.seoTitle;
            const preview = p.text.length > 280 ? p.text.slice(0, 280).trimEnd() + "…" : p.text;
            return (
              <article key={p.id} className={`card ${s.post} ${p.id === nuevo ? s.isNew : ""}`}>
                <div className={s.top}>
                  <div className={s.thumb}>
                    {p.mediaUrl && p.mediaType === "photo" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.mediaUrl} alt="" loading="lazy" />
                    ) : p.mediaUrl && p.mediaType === "video" ? (
                      <video src={`${p.mediaUrl}#t=0.5`} preload="metadata" muted playsInline />
                    ) : (
                      <span className={s.noMedia} aria-hidden="true">
                        Aa
                      </span>
                    )}
                    {p.mediaType === "video" && p.mediaUrl && (
                      <span className={s.play} aria-label={t("Video", "Video")}>
                        ▶
                      </span>
                    )}
                  </div>
                  <div className={s.main}>
                    <div className={s.meta}>
                      <span className={`pill ${p.status}`}>{POST_STATUS[lang][p.status] ?? p.status}</span>
                      <span className={s.when}>{dateLine}</span>
                    </div>
                    {title && <h3 className={s.title}>{title}</h3>}
                    <p className={s.text}>{preview}</p>
                    {p.mediaUrl && (
                      <a className={s.mediaLink} href={p.mediaUrl} target="_blank" rel="noreferrer">
                        {p.mediaType === "video" ? t("Ver video", "View video") : t("Ver foto", "View photo")}
                      </a>
                    )}
                  </div>
                </div>

                <ul className={s.channels}>
                  {p.targets.map((x) => {
                    const def = channelDef(x.channel);
                    const name = names[x.channel] ?? x.channel;
                    const chip =
                      x.status === "sent"
                        ? x.channel === "email" || x.channel === "sms"
                          ? t("Enviado", "Sent")
                          : t("Publicado", "Posted")
                        : x.status === "failed"
                          ? t("No se publicó", "Not posted")
                          : x.status === "skipped"
                            ? t("Se saltó", "Skipped")
                            : p.status === "scheduled" || p.status === "draft"
                              ? t("Programado", "Scheduled")
                              : p.status === "publishing"
                                ? t("Publicando…", "Posting…")
                                : t("Se interrumpió", "Interrupted");
                    const chipCls = x.status === "pending" ? (finished ? "failed" : "scheduled") : x.status;
                    const problem = finished && (x.status === "failed" || x.status === "skipped" || x.status === "pending");
                    const ex = problem
                      ? x.status === "pending"
                        ? { message: t("Se cortó mientras se publicaba. Vuelve a intentarlo.", "It got cut off while posting. Try again."), ownerMustAct: false, action: undefined, technical: undefined }
                        : explainFailure(x.channel, x.detail, lang, id)
                      : null;
                    const held =
                      x.status === "failed" &&
                      Boolean(decideReconnect({ channel: x.channel, status: x.status, detail: x.detail, at: p.scheduledAt }, b.connections.find((c) => c.channel === x.channel)?.updatedAt));
                    return (
                      <li key={x.id} className={`${s.ch} ${problem ? (x.status === "skipped" ? s.chSkip : s.chBad) : ""}`}>
                        <div className={s.chHead}>
                          <span className={`mono ${s.mono}`}>{def?.mono ?? x.channel.slice(0, 2).toUpperCase()}</span>
                          <strong className={s.chName}>{name}</strong>
                          <span className={`pill ${chipCls}`}>{chip}</span>
                          {x.status === "sent" && x.externalUrl && (
                            <a className={s.view} href={x.externalUrl} target="_blank" rel="noreferrer">
                              {viewLabel(x.channel, lang)} ↗
                            </a>
                          )}
                        </div>
                        {x.status === "sent" && <p className={s.ok}>{explainSent(x.channel, x.detail, lang)}</p>}
                        {ex && (
                          <RetryButton
                            businessId={id}
                            postId={p.id}
                            targetId={x.id}
                            label={ex.ownerMustAct || held ? t("Ya lo arreglé, intentar otra vez", "I fixed it, try again") : t("Reintentar", "Retry")}
                            look={ex.ownerMustAct || held ? "soft" : "main"}
                            channelNames={names}
                          >
                            <p className={s.why}>{ex.message}</p>
                            {ex.action && (
                              <Link className={`btn ${held || ex.ownerMustAct ? "outline" : ""} ${s.fix}`} href={ex.action.href}>
                                {ex.action.label}
                              </Link>
                            )}
                            {ex.technical && (
                              <details className={s.tech}>
                                <summary>{t("Detalle técnico", "Technical detail")}</summary>
                                <p>{ex.technical}</p>
                              </details>
                            )}
                          </RetryButton>
                        )}
                      </li>
                    );
                  })}
                </ul>

                <div className={s.footer}>
                  {p.status === "scheduled" && (
                    <form action={publishNow.bind(null, id, p.id)}>
                      <button className="btn" type="submit">
                        {t("Publicar ya", "Post now")}
                      </button>
                    </form>
                  )}
                  {p.status === "draft" && (
                    <Link className="btn" href={`/b/${id}/plan`}>
                      {t("Revisar en Plan", "Review in Plan")}
                    </Link>
                  )}
                  {retryable.length > 1 && (
                    <div className={s.retryAll}>
                      <RetryButton businessId={id} postId={p.id} label={t("Reintentar todos los que fallaron", "Retry all that failed")} channelNames={names} />
                    </div>
                  )}
                  {p.status !== "publishing" && (
                    <details className={s.del}>
                      <summary className="btn link">{t("Borrar del historial", "Delete from history")}</summary>
                      <div className={s.delBox}>
                        <p className="small muted">
                          {t(
                            "Se borra solo de esta lista (y deja de estar programada). Lo que ya salió en Facebook u otras redes se queda allá.",
                            "It's only removed from this list (and unscheduled). Whatever already went out on Facebook or other networks stays there.",
                          )}
                        </p>
                        <form action={deletePost.bind(null, id, p.id)}>
                          <button className="btn danger" type="submit">
                            {t("Sí, borrar", "Yes, delete")}
                          </button>
                        </form>
                      </div>
                    </details>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
