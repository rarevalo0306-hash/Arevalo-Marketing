import Link from "next/link";
import { deletePost, publishNow, retry } from "@/app/actions";
import { PageHead } from "@/components/PageHead";
import { channelDef } from "@/lib/channels";
import { db } from "@/lib/db";
import { intlLocale, type UiLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";

const POST_STATUS: Record<UiLang, Record<string, string>> = {
  es: {
    draft: "Borrador (por aprobar)",
    scheduled: "Programado",
    publishing: "Publicando…",
    done: "Publicado en todo",
    partial: "Publicado en parte",
    failed: "No se publicó",
  },
  en: {
    draft: "Draft (needs approval)",
    scheduled: "Scheduled",
    publishing: "Publishing…",
    done: "Published everywhere",
    partial: "Partly published",
    failed: "Not published",
  },
};
const TARGET_STATUS: Record<UiLang, Record<string, string>> = {
  es: {
    pending: "Pendiente",
    sent: "Enviado",
    failed: "Falló",
    skipped: "Saltado",
  },
  en: {
    pending: "Pending",
    sent: "Sent",
    failed: "Failed",
    skipped: "Skipped",
  },
};

// Reintentar o "Publicar ya" publica en el momento.
export const maxDuration = 300;

export default async function HistorialPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nuevo?: string }> }) {
  const { id } = await params;
  const { nuevo } = await searchParams;
  const { lang, t } = await getT();
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" });
  const b = await db.business.findUniqueOrThrow({ where: { id } });
  const posts = await db.post.findMany({
    where: { businessId: id },
    include: { targets: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return (
    <>
      <PageHead business={b} prefix={t("Historial de", "History for")} title={t("Historial", "History")} subtitle={t("Todo lo que has publicado o programado, y cómo le fue en cada canal.", "Everything you've posted or scheduled, and how it did on each channel.")} aside={<Link className="btn outline" href={`/b/${id}/publicar`}>{t("Nueva publicación", "New post")}</Link>} />
      {posts.length === 0 ? (
        <div className="card empty">{t("Todavía no has publicado nada.", "You haven't posted anything yet.")} <Link href={`/b/${id}/publicar`}>{t("Haz tu primera publicación", "Make your first post")}</Link></div>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {posts.map((p) => {
            const hasRetry = p.targets.some((x) => x.status === "failed" || x.status === "skipped");
            return (
              <article key={p.id} className="card" style={p.id === nuevo ? { borderColor: "var(--teal)", boxShadow: "0 0 0 1px var(--teal)" } : undefined}>
                <div className="row between">
                  <div className="row">
                    <span className={`pill ${p.status}`}>{POST_STATUS[lang][p.status] ?? p.status}</span>
                    <span className="small muted">
                      {p.status === "scheduled" ? `${t("Para el", "For")} ${fmt.format(p.scheduledAt)}` : fmt.format(p.createdAt)}
                    </span>
                  </div>
                  <div className="row">
                    {p.status === "scheduled" && (
                      <form action={publishNow.bind(null, id, p.id)}><button className="btn" type="submit">{t("Publicar ya", "Post now")}</button></form>
                    )}
                    {hasRetry && p.status !== "scheduled" && p.status !== "publishing" && (
                      <form action={retry.bind(null, id, p.id)}><button className="btn outline" type="submit">{t("Reintentar los que fallaron", "Retry the ones that failed")}</button></form>
                    )}
                    {p.status !== "publishing" && (
                      <form action={deletePost.bind(null, id, p.id)}><button className="btn danger" type="submit">{t("Borrar del historial", "Delete from history")}</button></form>
                    )}
                  </div>
                </div>
                {(p.subject || p.seoTitle) && <h3>{p.subject || p.seoTitle}</h3>}
                <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.text.length > 400 ? p.text.slice(0, 400) + "…" : p.text}</p>
                {p.mediaUrl && <p className="small"><a href={p.mediaUrl} target="_blank" rel="noreferrer">{p.mediaType === "video" ? t("Ver video", "View video") : t("Ver foto", "View photo")}</a></p>}
                <div>
                  {p.targets.map((x) => (
                    <div key={x.id} className="target">
                      <span style={{ fontWeight: 600 }}>{channelDef(x.channel)?.name ?? x.channel}</span>
                      <span className="row">
                        {x.externalUrl && <a href={x.externalUrl} target="_blank" rel="noreferrer" className="small">{t("Ver publicación", "View post")}</a>}
                        <span className={`pill ${x.status}`}>{TARGET_STATUS[lang][x.status] ?? x.status}</span>
                      </span>
                      {x.detail && <span className="detail">{x.detail}</span>}
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
