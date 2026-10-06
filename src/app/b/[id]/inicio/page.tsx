import Link from "next/link";
import { MagicPrompt } from "@/components/MagicPrompt";
import { aiEnabled } from "@/lib/ai";
import { CHANNEL_IDS, channelName, CHANNELS } from "@/lib/channels";
import { db } from "@/lib/db";
import { ideasFor } from "@/lib/ideas";
import { intlLocale, type T, type UiLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { studyIdeas } from "@/lib/study-shape";
import { BUSINESS_TZ } from "@/lib/time";

const STATUS: Record<UiLang, Record<string, string>> = {
  es: {
    draft: "Borrador",
    scheduled: "Programado",
    publishing: "Publicando",
    done: "Publicado",
    partial: "En parte",
    failed: "No salió",
  },
  en: {
    draft: "Draft",
    scheduled: "Scheduled",
    publishing: "Publishing",
    done: "Published",
    partial: "Partly published",
    failed: "Didn't go out",
  },
};

function greeting(t: T): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: BUSINESS_TZ }).format(new Date()));
  return h >= 5 && h < 12 ? t("Buenos días", "Good morning") : h >= 12 && h < 19 ? t("Buenas tardes", "Good afternoon") : t("Buenas noches", "Good evening");
}

export default async function InicioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lang, t } = await getT();
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: BUSINESS_TZ });
  const b = await db.business.findUniqueOrThrow({ where: { id }, include: { connections: { where: { channel: { in: CHANNEL_IDS } }, select: { channel: true } } } });
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
          <span className="hero-badge ai-badge">{t("✦ IA lista", "✦ AI ready")}</span>
        </div>
        <h1>{greeting(t)}. {t("¿Qué quieres publicar hoy?", "What do you want to post today?")}</h1>
        <p className="hero-sub">{t("Escribe una idea. La IA escribe para cada red, crea la foto con tu marca y tú solo apruebas.", "Type an idea. The AI writes for each network, makes the photo with your brand, and you just approve.")}</p>
        <MagicPrompt businessId={id} ideas={[...studyIdeas(b.study, 3), ...ideasFor(b.aiProfile, b.name, undefined, lang)].slice(0, 5)} enabled={ai} />
      </section>

      <div className="stats">
        <Link href={`/b/${id}/conexiones`} className="stat">
          <span className="stat-label">{t("Canales conectados", "Connected channels")}</span>
          <span className="stat-value">{connected}<small> / {CHANNELS.length}</small></span>
          <span className="meter"><span style={{ width: `${(connected / CHANNELS.length) * 100}%` }} /></span>
        </Link>
        <Link href={`/b/${id}/historial`} className="stat">
          <span className="stat-label">{t("Publicado esta semana", "Posted this week")}</span>
          <span className="stat-value">{lastWeek}</span>
          <span className="stat-note">{t("en los últimos 7 días", "in the last 7 days")}</span>
        </Link>
        <Link href={`/b/${id}/plan`} className="stat">
          <span className="stat-label">{t("Borradores por aprobar", "Drafts to approve")}</span>
          <span className="stat-value">{drafts}</span>
          <span className="stat-note">{drafts ? t("La IA te espera", "The AI is waiting on you") : t("Todo al día", "All caught up")}</span>
        </Link>
        <Link href={`/b/${id}/historial`} className="stat">
          <span className="stat-label">{t("Próxima publicación", "Next post")}</span>
          <span className="stat-value stat-date">{next ? fmt.format(next.scheduledAt) : "—"}</span>
          <span className="stat-note">{next ? t("programada", "scheduled") : t("Nada programado", "Nothing scheduled")}</span>
        </Link>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="row between">
            <h2>{t("Atajos", "Shortcuts")}</h2>
          </div>
          <div className="actions">
            <Link href={`/b/${id}/estudio`} className="action">
              <span className="action-icon">⌕</span>
              <span>
                <strong>{b.studyAt ? t("Estudio del negocio", "Business study") : t("Haz el estudio de tu negocio", "Run your business study")}</strong>
                <span className="small muted">{b.studyAt ? t("Tu público, palabras clave e ideas de campaña", "Your audience, keywords, and campaign ideas") : t("La IA investiga tu mercado y aprende qué anunciar", "The AI researches your market and learns what to promote")}</span>
              </span>
            </Link>
            <Link href={`/b/${id}/seo`} className="action">
              <span className="action-icon teal">↗</span>
              <span>
                <strong>{t("SEO y visibilidad", "SEO and visibility")}</strong>
                <span className="small muted">{t("Revisa tu página y si las IAs te recomiendan", "Check your website and whether AIs recommend you")}</span>
              </span>
            </Link>
            <Link href={`/b/${id}/plan`} className="action">
              <span className="action-icon">✦</span>
              <span><strong>{t("Plan de la semana", "Weekly plan")}</strong><span className="small muted">{t("La IA prepara varias publicaciones con foto", "The AI prepares several posts with photos")}</span></span>
            </Link>
            <Link href={`/b/${id}/publicar`} className="action">
              <span className="action-icon blue">✎</span>
              <span><strong>{t("Publicar a mano", "Post manually")}</strong><span className="small muted">{t("Escribe tú y elige dónde sale", "Write it yourself and pick where it goes")}</span></span>
            </Link>
            <Link href={`/b/${id}/negocio`} className="action">
              <span className="action-icon teal">◐</span>
              <span><strong>{t("Tu marca", "Your brand")}</strong><span className="small muted">{b.logoUrl ? t("Logo y teléfono listos", "Logo and phone ready") : t("Sube tu logo para las fotos", "Upload your logo for the photos")}</span></span>
            </Link>
            {connected < 4 && (
              <Link href={`/b/${id}/conexiones`} className="action">
                <span className="action-icon amber">⌁</span>
                <span><strong>{t("Conectar canales", "Connect channels")}</strong><span className="small muted">{t("Más redes, más alcance", "More networks, more reach")}</span></span>
              </Link>
            )}
          </div>
        </section>

        <section className="card">
          <div className="row between">
            <h2>{t("Lo más reciente", "Latest")}</h2>
            <Link href={`/b/${id}/historial`} className="small">{t("Ver todo", "See all")}</Link>
          </div>
          {recent.length === 0 ? (
            <div className="empty">{t("Todavía no hay publicaciones. Empieza con una idea arriba ✦", "No posts yet. Start with an idea above ✦")}</div>
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
                    <span className="small muted">{p.targets.map((x) => channelName(x.channel, lang)).join(" · ")}</span>
                  </span>
                  <span className={`pill ${p.status}`}>{STATUS[lang][p.status] ?? p.status}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
