import Link from "next/link";
import { MagicPrompt } from "@/components/MagicPrompt";
import { aiEnabled } from "@/lib/ai";
import { CHANNELS, channelDef } from "@/lib/channels";
import { db } from "@/lib/db";
import { ideasFor } from "@/lib/ideas";
import { studyIdeas } from "@/lib/study-shape";
import { BUSINESS_TZ } from "@/lib/time";

const STATUS: Record<string, string> = {
  draft: "Borrador",
  scheduled: "Programado",
  publishing: "Publicando",
  done: "Publicado",
  partial: "En parte",
  failed: "No salió",
};
const fmt = new Intl.DateTimeFormat("es", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: BUSINESS_TZ });

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: BUSINESS_TZ }).format(new Date()));
  return h >= 5 && h < 12 ? "Buenos días" : h >= 12 && h < 19 ? "Buenas tardes" : "Buenas noches";
}

export default async function InicioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await db.business.findUniqueOrThrow({ where: { id }, include: { connections: { select: { channel: true } } } });
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [recent, lastWeek, drafts, next] = await Promise.all([
    db.post.findMany({ where: { businessId: id }, include: { targets: { select: { channel: true } } }, orderBy: { createdAt: "desc" }, take: 4 }),
    db.post.count({ where: { businessId: id, createdAt: { gte: weekAgo }, status: { in: ["done", "partial"] } } }),
    db.post.count({ where: { businessId: id, status: "draft" } }),
    db.post.findFirst({ where: { businessId: id, status: "scheduled" }, orderBy: { scheduledAt: "asc" } }),
  ]);
  const connected = b.connections.length;
  const ai = aiEnabled();

  return (
    <>
      <section className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-top">
          <span className="hero-badge"><i style={{ background: b.color }} />{b.name}</span>
          <span className="hero-badge ai-badge">✦ IA lista</span>
        </div>
        <h1>{greeting()}. ¿Qué quieres publicar hoy?</h1>
        <p className="hero-sub">Escribe una idea. La IA escribe para cada red, crea la foto con tu marca y tú solo apruebas.</p>
        <MagicPrompt businessId={id} ideas={[...studyIdeas(b.study, 3), ...ideasFor(b.aiProfile, b.name)].slice(0, 5)} enabled={ai} />
      </section>

      <div className="stats">
        <Link href={`/b/${id}/conexiones`} className="stat">
          <span className="stat-label">Canales conectados</span>
          <span className="stat-value">{connected}<small> / {CHANNELS.length}</small></span>
          <span className="meter"><span style={{ width: `${(connected / CHANNELS.length) * 100}%` }} /></span>
        </Link>
        <Link href={`/b/${id}/historial`} className="stat">
          <span className="stat-label">Publicado esta semana</span>
          <span className="stat-value">{lastWeek}</span>
          <span className="stat-note">en los últimos 7 días</span>
        </Link>
        <Link href={`/b/${id}/plan`} className="stat">
          <span className="stat-label">Borradores por aprobar</span>
          <span className="stat-value">{drafts}</span>
          <span className="stat-note">{drafts ? "La IA te espera" : "Todo al día"}</span>
        </Link>
        <Link href={`/b/${id}/historial`} className="stat">
          <span className="stat-label">Próxima publicación</span>
          <span className="stat-value stat-date">{next ? fmt.format(next.scheduledAt) : "—"}</span>
          <span className="stat-note">{next ? "programada" : "Nada programado"}</span>
        </Link>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="row between">
            <h2>Atajos</h2>
          </div>
          <div className="actions">
            <Link href={`/b/${id}/estudio`} className="action">
              <span className="action-icon">⌕</span>
              <span>
                <strong>{b.studyAt ? "Estudio del negocio" : "Haz el estudio de tu negocio"}</strong>
                <span className="small muted">{b.studyAt ? "Tu público, palabras clave e ideas de campaña" : "La IA investiga tu mercado y aprende qué anunciar"}</span>
              </span>
            </Link>
            <Link href={`/b/${id}/plan`} className="action">
              <span className="action-icon">✦</span>
              <span><strong>Plan de la semana</strong><span className="small muted">La IA prepara varias publicaciones con foto</span></span>
            </Link>
            <Link href={`/b/${id}/publicar`} className="action">
              <span className="action-icon blue">✎</span>
              <span><strong>Publicar a mano</strong><span className="small muted">Escribe tú y elige dónde sale</span></span>
            </Link>
            <Link href={`/b/${id}/negocio`} className="action">
              <span className="action-icon teal">◐</span>
              <span><strong>Tu marca</strong><span className="small muted">{b.logoUrl ? "Logo y teléfono listos" : "Sube tu logo para las fotos"}</span></span>
            </Link>
            {connected < 4 && (
              <Link href={`/b/${id}/conexiones`} className="action">
                <span className="action-icon amber">⌁</span>
                <span><strong>Conectar canales</strong><span className="small muted">Más redes, más alcance</span></span>
              </Link>
            )}
          </div>
        </section>

        <section className="card">
          <div className="row between">
            <h2>Lo más reciente</h2>
            <Link href={`/b/${id}/historial`} className="small">Ver todo</Link>
          </div>
          {recent.length === 0 ? (
            <div className="empty">Todavía no hay publicaciones. Empieza con una idea arriba ✦</div>
          ) : (
            <div className="recent">
              {recent.map((p) => (
                <Link key={p.id} href={`/b/${id}/historial`} className="recent-item">
                  {p.mediaType === "photo" && p.mediaUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.mediaUrl} alt="" className="thumb" />
                  ) : (
                    <span className="thumb thumb-empty">{p.mediaType === "video" ? "▶" : "Aa"}</span>
                  )}
                  <span className="recent-text">
                    <span className="recent-title">{p.text.slice(0, 90)}{p.text.length > 90 ? "…" : ""}</span>
                    <span className="small muted">{p.targets.map((t) => channelDef(t.channel)?.name ?? t.channel).join(" · ")}</span>
                  </span>
                  <span className={`pill ${p.status}`}>{STATUS[p.status] ?? p.status}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
