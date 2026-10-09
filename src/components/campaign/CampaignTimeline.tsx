import { approveCampaignDraft, discardCampaignDraft } from "@/app/actions-campaign";
import { kindLabel } from "@/lib/campaign-shape";
import { channelName } from "@/lib/channels";
import type { UiLang } from "@/lib/i18n";
import { translator } from "@/lib/i18n";
import { businessDay, fmtDate, fmtTime } from "@/lib/time";
import s from "./Campaign.module.css";

export type TimelinePost = {
  id: string;
  text: string;
  subject: string;
  variants: unknown;
  status: string;
  source: string;
  kind: string;
  mediaUrl: string;
  mediaType: string;
  altText: string;
  scheduledAt: Date;
  targets: { id: string; channel: string; status: string }[];
};

const PILL: Record<string, string> = { draft: "draft", scheduled: "scheduled", publishing: "publishing", done: "done", partial: "partial", failed: "failed" };

function statusText(status: string, cancelled: boolean, lang: UiLang): string {
  const t = translator(lang);
  if (status === "draft") return cancelled ? t("Cancelada (borrador)", "Cancelled (draft)") : t("Por aprobar", "To approve");
  const m: Record<string, [string, string]> = {
    scheduled: ["Programada", "Scheduled"],
    publishing: ["Publicando…", "Posting…"],
    done: ["Publicada", "Posted"],
    partial: ["Publicada en parte", "Partly posted"],
    failed: ["No se publicó", "Not posted"],
  };
  return t(...(m[status] ?? [status, status]));
}

/**
 * Calendario de la campaña por día: lo publicado, lo programado, los borradores para aprobar (Aprobar / Editar /
 * Descartar) y los próximos horarios que la IA todavía va a preparar.
 */
export function CampaignTimeline({
  posts,
  upcoming,
  businessId,
  campaignId,
  cancelled,
  lang,
}: {
  posts: TimelinePost[];
  upcoming: Date[];
  businessId: string;
  campaignId: string;
  /** La campaña está parada o terminada: los borradores quedaron cancelados. */
  cancelled: boolean;
  lang: UiLang;
}) {
  const t = translator(lang);
  type Entry = { at: Date; post?: TimelinePost };
  const entries: Entry[] = [...posts.map((p) => ({ at: p.scheduledAt, post: p })), ...upcoming.map((at) => ({ at }))].sort((a, b) => a.at.getTime() - b.at.getTime());
  const days = new Map<string, Entry[]>();
  for (const e of entries) {
    const d = businessDay(e.at);
    days.set(d, [...(days.get(d) ?? []), e]);
  }
  if (!entries.length)
    return <p className="muted" style={{ margin: 0 }}>{t("Todavía no hay publicaciones en esta campaña.", "There are no posts in this campaign yet.")}</p>;

  return (
    <div className="stack" style={{ gap: 14 }}>
      {[...days.entries()].map(([day, list]) => (
        <section key={day} className={s.day}>
          <div className={s.dayHead}>{new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))} · {fmtDate(list[0].at, lang)}</div>
          {list.map((e, i) =>
            e.post ? (
              <PostItem key={e.post.id} p={e.post} businessId={businessId} campaignId={campaignId} cancelled={cancelled} lang={lang} />
            ) : (
              <div key={`u${i}`} className={`${s.item} ${s.ghost}`}>
                <div className={s.itemMeta}>
                  <span className="pill plain neutral">{fmtTime(e.at, lang)}</span>
                  <span>{t("Planeada: la IA la prepara unos días antes.", "Planned: the AI prepares it a few days ahead.")}</span>
                </div>
              </div>
            ),
          )}
        </section>
      ))}
    </div>
  );
}

function PostItem({ p, businessId, campaignId, cancelled, lang }: { p: TimelinePost; businessId: string; campaignId: string; cancelled: boolean; lang: UiLang }) {
  const t = translator(lang);
  const variants = (p.variants && typeof p.variants === "object" ? p.variants : {}) as Record<string, string>;
  const main = (variants.facebook || p.text || "").trim();
  return (
    <article className={s.item}>
      {p.mediaUrl && p.mediaType === "photo" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={s.thumb} src={p.mediaUrl} alt={p.altText || t("Foto de la publicación", "Post photo")} loading="lazy" />
      ) : (
        <div className={s.thumbEmpty}>{p.kind === "video" ? (p.mediaUrl ? "▶" : t("Video…", "Video…")) : t("Solo texto", "Text only")}</div>
      )}
      <div className={s.itemBody}>
        <div className={s.itemMeta}>
          <span className={`pill ${PILL[p.status] ?? "neutral"}`}>{statusText(p.status, cancelled, lang)}</span>
          <span>{fmtTime(p.scheduledAt, lang)}</span>
          <span>· {kindLabel(p.kind, lang)}</span>
          <span>· {p.targets.map((x) => channelName(x.channel, lang)).join(", ")}</span>
        </div>
        <p className={s.itemText}>{main}</p>
        {p.status === "draft" && p.kind === "video" && !p.mediaUrl && (
          <p className="small muted" style={{ margin: 0 }}>{t("El video se está creando. Podrás aprobarlo cuando esté listo.", "The video is being made. You can approve it when it's ready.")}</p>
        )}
        {p.status === "draft" && !(p.kind === "video" && !p.mediaUrl) && (
          <>
            <div className="row">
              <form action={approveCampaignDraft.bind(null, businessId, campaignId, p.id)}>
                <button className="btn on" type="submit">{t("Aprobar", "Approve")}</button>
              </form>
              {p.source === "ai" && (
                <form action={discardCampaignDraft.bind(null, businessId, campaignId, p.id)}>
                  <button className="btn danger" type="submit">{t("Descartar", "Discard")}</button>
                </form>
              )}
            </div>
            <details className={s.edit}>
              <summary>{t("Editar antes de aprobar", "Edit before approving")}</summary>
              <form action={approveCampaignDraft.bind(null, businessId, campaignId, p.id)} className="stack" style={{ gap: 10, marginTop: 10 }}>
                {p.targets.some((x) => x.channel === "email") && (
                  <div className="stack" style={{ gap: 4 }}>
                    <label className="small" style={{ fontWeight: 700 }} htmlFor={`${p.id}-subject`}>{t("Asunto del email", "Email subject")}</label>
                    <input id={`${p.id}-subject`} name="subject" className="field" defaultValue={p.subject} />
                  </div>
                )}
                {p.targets.map((x) => (
                  <div key={x.id} className="stack" style={{ gap: 4 }}>
                    <label className="small" style={{ fontWeight: 700 }} htmlFor={`${p.id}-${x.channel}`}>{channelName(x.channel, lang)}</label>
                    <textarea id={`${p.id}-${x.channel}`} name={`v_${x.channel}`} className="field" style={{ minHeight: x.channel === "sms" || x.channel === "x" ? 70 : 130 }} defaultValue={variants[x.channel] ?? p.text} />
                  </div>
                ))}
                <div>
                  <button className="btn on" type="submit">{t("Guardar y aprobar", "Save and approve")}</button>
                </div>
              </form>
            </details>
          </>
        )}
      </div>
    </article>
  );
}
