import Link from "next/link";
import { deletePost, publishNow, retry } from "@/app/actions";
import { PageHead } from "@/components/PageHead";
import { channelDef } from "@/lib/channels";
import { db } from "@/lib/db";

const POST_STATUS: Record<string, string> = {
  draft: "Borrador (por aprobar)",
  scheduled: "Programado",
  publishing: "Publicando…",
  done: "Publicado en todo",
  partial: "Publicado en parte",
  failed: "No se publicó",
};
const TARGET_STATUS: Record<string, string> = {
  pending: "Pendiente",
  sent: "Enviado",
  failed: "Falló",
  skipped: "Saltado",
};

// Reintentar o "Publicar ya" publica en el momento.
export const maxDuration = 300;

const fmt = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" });

export default async function HistorialPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nuevo?: string }> }) {
  const { id } = await params;
  const { nuevo } = await searchParams;
  const b = await db.business.findUniqueOrThrow({ where: { id } });
  const posts = await db.post.findMany({
    where: { businessId: id },
    include: { targets: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return (
    <>
      <PageHead business={b} prefix="Historial de" title="Historial" subtitle="Todo lo que has publicado o programado, y cómo le fue en cada canal." aside={<Link className="btn outline" href={`/b/${id}/publicar`}>Nueva publicación</Link>} />
      {posts.length === 0 ? (
        <div className="card empty">Todavía no has publicado nada. <Link href={`/b/${id}/publicar`}>Haz tu primera publicación</Link></div>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {posts.map((p) => {
            const hasRetry = p.targets.some((t) => t.status === "failed" || t.status === "skipped");
            return (
              <article key={p.id} className="card" style={p.id === nuevo ? { borderColor: "var(--teal)", boxShadow: "0 0 0 1px var(--teal)" } : undefined}>
                <div className="row between">
                  <div className="row">
                    <span className={`pill ${p.status}`}>{POST_STATUS[p.status] ?? p.status}</span>
                    <span className="small muted">
                      {p.status === "scheduled" ? `Para el ${fmt.format(p.scheduledAt)}` : fmt.format(p.createdAt)}
                    </span>
                  </div>
                  <div className="row">
                    {p.status === "scheduled" && (
                      <form action={publishNow.bind(null, id, p.id)}><button className="btn" type="submit">Publicar ya</button></form>
                    )}
                    {hasRetry && p.status !== "scheduled" && p.status !== "publishing" && (
                      <form action={retry.bind(null, id, p.id)}><button className="btn outline" type="submit">Reintentar los que fallaron</button></form>
                    )}
                    {p.status !== "publishing" && (
                      <form action={deletePost.bind(null, id, p.id)}><button className="btn danger" type="submit">Borrar del historial</button></form>
                    )}
                  </div>
                </div>
                {(p.subject || p.seoTitle) && <h3>{p.subject || p.seoTitle}</h3>}
                <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.text.length > 400 ? p.text.slice(0, 400) + "…" : p.text}</p>
                {p.mediaUrl && <p className="small"><a href={p.mediaUrl} target="_blank" rel="noreferrer">Ver {p.mediaType === "video" ? "video" : "foto"}</a></p>}
                <div>
                  {p.targets.map((t) => (
                    <div key={t.id} className="target">
                      <span style={{ fontWeight: 600 }}>{channelDef(t.channel)?.name ?? t.channel}</span>
                      <span className="row">
                        {t.externalUrl && <a href={t.externalUrl} target="_blank" rel="noreferrer" className="small">Ver publicación</a>}
                        <span className={`pill ${t.status}`}>{TARGET_STATUS[t.status] ?? t.status}</span>
                      </span>
                      {t.detail && <span className="detail">{t.detail}</span>}
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
