import Link from "next/link";
import { approvePlanDraft, deletePost, generatePlan, stormCampaign } from "@/app/actions";
import { PageHead } from "@/components/PageHead";
import { PlanForm } from "@/components/PlanForm";
import { YoutubeOptionsFields } from "@/components/posts/YoutubeOptionsFields";
import { StormForm } from "@/components/StormForm";
import { aiEnabled } from "@/lib/ai";
import { pageBusiness } from "@/lib/auth";
import { CHANNEL_IDS, channelName, CHANNELS } from "@/lib/channels";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { BUSINESS_TZ } from "@/lib/time";
import { readYoutubeApproval, youtubeKeywords, youtubeTags, youtubeTitleFor } from "@/lib/youtube-options";

// La IA puede tardar en escribir una semana completa.
export const maxDuration = 300;

export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ draft?: string; msg?: string }> }) {
  // Por qué no se aprobó un borrador (vuelve de approvePlanDraft).
  const notice = await searchParams;
  const { id } = await params;
  await pageBusiness(id);
  const { lang, t } = await getT();
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "full", timeStyle: "short", timeZone: BUSINESS_TZ });
  const b = await db.business.findUniqueOrThrow({ where: { id }, include: { connections: { where: { channel: { in: CHANNEL_IDS } }, select: { channel: true } } } });
  // Los borradores de campañas paradas o terminadas quedan cancelados: se ven en la campaña, no aquí.
  const drafts = await db.post.findMany({
    where: { businessId: id, status: "draft", OR: [{ campaignId: null }, { campaign: { is: { status: { notIn: ["stopped", "ended"] } } } }] },
    include: { targets: true, campaign: { select: { id: true, name: true } } },
    orderBy: { scheduledAt: "asc" },
  });
  const connected = new Set(b.connections.map((c) => c.channel));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });
  const nowLocal = `${today}T${new Date().toLocaleTimeString("en-GB", { timeZone: BUSINESS_TZ, hour: "2-digit", minute: "2-digit" })}`;
  const channelList = CHANNELS.map((c) => ({ id: c.id, name: channelName(c.id, lang), connected: connected.has(c.id) }));
  const keywords = youtubeKeywords(b.study);

  return (
    <>
      <PageHead
        business={b}
        prefix={t("Plan con IA para", "AI plan for")}
        title={t("Plan con IA", "AI plan")}
        subtitle={t("La IA prepara tus publicaciones de la semana. Tú revisas, cambias lo que quieras y apruebas.", "The AI prepares your posts for the week. You review them, change whatever you want, and approve.")}
        actions={
          <Link href={`/b/${id}/campanas/nueva`} className="btn outline">
            {t("Convertir en campaña", "Turn into a campaign")}
          </Link>
        }
      />
      {!aiEnabled() ? (
        <div className="card empty">{t("Falta la clave de la IA (GEMINI_API_KEY) en Vercel.", "The AI key (GEMINI_API_KEY) is missing in Vercel.")}</div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {!b.aiProfile.trim() && !b.studyAt && (
            <p className="note">
              {t("Antes de empezar, haz el", "Before you start, run the")} <Link href={`/b/${id}/estudio`}>{t("Estudio del negocio", "Business study")}</Link>{" "}
              {t("para que la IA sepa qué anunciar y a quién. Así no escribe cosas genéricas.", "so the AI knows what to promote and to whom. That way it doesn't write generic stuff.")}
            </p>
          )}
          <PlanForm
            action={generatePlan.bind(null, id)}
            channels={channelList}
            today={today}
            autopublish={b.aiAutopublish}
          />
          <StormForm action={stormCampaign.bind(null, id)} channels={channelList} now={nowLocal} />
          <h2 style={{ marginTop: 8 }}>{t("Borradores por aprobar", "Drafts to approve")} ({drafts.length})</h2>
          {drafts.length === 0 && <div className="card empty">{t("No hay borradores. Crea un plan arriba.", "No drafts. Create a plan above.")}</div>}
          {drafts.map((p) => {
            const variants = (p.variants ?? {}) as Record<string, unknown>;
            const textOr = (ch: string) => (typeof variants[ch] === "string" ? (variants[ch] as string) : p.text);
            const video = p.kind === "video" || p.mediaType === "video";
            // Un video para YouTube se aprueba revisando lo que se sube (título, etiquetas, quién lo ve, para niños).
            const ytDraft = video && !!p.mediaUrl && p.targets.some((x) => x.channel === "youtube");
            const before = ytDraft ? readYoutubeApproval(p.variants, p.mediaUrl) : null;
            const ytText = (typeof variants.youtube === "string" && variants.youtube.trim()) || p.text;
            // Los del agente se aprueban en MATYA; un video que se está creando, cuando esté listo.
            const agent = p.id.startsWith("agent-");
            const rendering = video && !p.mediaUrl;
            return (
              <article key={p.id} className="card" id={`draft-${p.id}`}>
                {notice?.draft === p.id && notice.msg && (
                  <p className="note error" role="alert">
                    {notice.msg.slice(0, 300)}
                  </p>
                )}
                <form action={approvePlanDraft.bind(null, id, p.id)} className="stack" style={{ gap: 12 }}>
                  <div className="row between">
                    <div className="row">
                      <span className="pill draft">{t("Borrador", "Draft")}</span>
                      {p.campaign && (
                        <Link href={`/b/${id}/campanas/${p.campaign.id}`} className="small">
                          {t("Campaña", "Campaign")}: {p.campaign.name}
                        </Link>
                      )}
                      <span className="small muted">{t("Saldría el", "Would go out on")} {fmt.format(p.scheduledAt)}</span>
                    </div>
                  </div>
                  {p.mediaUrl && p.mediaType === "photo" && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.mediaUrl} alt={t("Foto creada por la IA para esta publicación", "Photo made by the AI for this post")} style={{ width: 220, borderRadius: 10 }} />
                  )}
                  {p.targets.some((x) => x.channel === "email") && (
                    <div className="stack" style={{ gap: 4 }}>
                      <label className="small" style={{ fontWeight: 600 }} htmlFor={`${p.id}-subject`}>{t("Asunto del email", "Email subject")}</label>
                      <input id={`${p.id}-subject`} name="subject" className="field" defaultValue={p.subject} />
                    </div>
                  )}
                  {p.targets
                    .filter((x) => !(ytDraft && x.channel === "youtube"))
                    .map((x) => (
                      <div key={x.id} className="stack" style={{ gap: 4 }}>
                        <label className="small" style={{ fontWeight: 600 }} htmlFor={`${p.id}-${x.channel}`}>{channelName(x.channel, lang)}</label>
                        <textarea
                          id={`${p.id}-${x.channel}`}
                          name={`v_${x.channel}`}
                          className="field"
                          style={{ minHeight: x.channel === "sms" ? 70 : 140 }}
                          defaultValue={textOr(x.channel)}
                        />
                      </div>
                    ))}
                  {ytDraft && !agent && (
                    <YoutubeOptionsFields
                      lang={lang}
                      idPrefix={p.id}
                      mediaUrl={p.mediaUrl}
                      title={before?.title ?? youtubeTitleFor({ seoTitle: p.seoTitle, text: ytText, businessName: b.name })}
                      description={before?.description ?? ytText}
                      tags={before?.tags ?? youtubeTags(ytText, keywords)}
                      verb="approve"
                    />
                  )}
                  {agent && (
                    <p className="small muted" style={{ margin: 0 }}>
                      {t("Este borrador es de MATYA: apruébalo en ", "This draft belongs to MATYA: approve it in ")}
                      <Link href={`/b/${id}/matya`}>MATYA</Link>.
                    </p>
                  )}
                  {rendering && !agent && (
                    <p className="small muted" style={{ margin: 0 }}>{t("El video se está creando. Podrás aprobarlo cuando esté listo.", "The video is being made. You can approve it when it's ready.")}</p>
                  )}
                  <div className="row">
                    {!agent && !rendering && (
                      <button className="btn on" type="submit">{ytDraft ? t("Aprobar y programar, con YouTube", "Approve and schedule, including YouTube") : t("Aprobar y programar", "Approve and schedule")}</button>
                    )}
                    <button className="btn danger" type="submit" formAction={deletePost.bind(null, id, p.id)} formNoValidate>{t("Borrar", "Delete")}</button>
                  </div>
                </form>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
