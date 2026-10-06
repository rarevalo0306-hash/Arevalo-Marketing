import Link from "next/link";
import { approveDraft, deletePost, generatePlan, stormCampaign } from "@/app/actions";
import { PageHead } from "@/components/PageHead";
import { PlanForm } from "@/components/PlanForm";
import { StormForm } from "@/components/StormForm";
import { aiEnabled } from "@/lib/ai";
import { CHANNEL_IDS, channelName, CHANNELS } from "@/lib/channels";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { BUSINESS_TZ } from "@/lib/time";

// La IA puede tardar en escribir una semana completa.
export const maxDuration = 300;

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lang, t } = await getT();
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "full", timeStyle: "short", timeZone: BUSINESS_TZ });
  const b = await db.business.findUniqueOrThrow({ where: { id }, include: { connections: { where: { channel: { in: CHANNEL_IDS } }, select: { channel: true } } } });
  const drafts = await db.post.findMany({ where: { businessId: id, status: "draft" }, include: { targets: true }, orderBy: { scheduledAt: "asc" } });
  const connected = new Set(b.connections.map((c) => c.channel));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });
  const nowLocal = `${today}T${new Date().toLocaleTimeString("en-GB", { timeZone: BUSINESS_TZ, hour: "2-digit", minute: "2-digit" })}`;
  const channelList = CHANNELS.map((c) => ({ id: c.id, name: channelName(c.id, lang), connected: connected.has(c.id) }));

  return (
    <>
      <PageHead
        business={b}
        prefix={t("Plan con IA para", "AI plan for")}
        title={t("Plan con IA", "AI plan")}
        subtitle={t("La IA prepara tus publicaciones de la semana. Tú revisas, cambias lo que quieras y apruebas.", "The AI prepares your posts for the week. You review them, change whatever you want, and approve.")}
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
            const variants = (p.variants ?? {}) as Record<string, string>;
            return (
              <article key={p.id} className="card">
                <form action={approveDraft.bind(null, id, p.id)} className="stack" style={{ gap: 12 }}>
                  <div className="row between">
                    <div className="row">
                      <span className="pill draft">{t("Borrador", "Draft")}</span>
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
                  {p.targets.map((x) => (
                    <div key={x.id} className="stack" style={{ gap: 4 }}>
                      <label className="small" style={{ fontWeight: 600 }} htmlFor={`${p.id}-${x.channel}`}>{channelName(x.channel, lang)}</label>
                      <textarea
                        id={`${p.id}-${x.channel}`}
                        name={`v_${x.channel}`}
                        className="field"
                        style={{ minHeight: x.channel === "sms" ? 70 : 140 }}
                        defaultValue={variants[x.channel] ?? p.text}
                      />
                    </div>
                  ))}
                  <div className="row">
                    <button className="btn on" type="submit">{t("Aprobar y programar", "Approve and schedule")}</button>
                    <button className="btn danger" type="submit" formAction={deletePost.bind(null, id, p.id)}>{t("Borrar", "Delete")}</button>
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
