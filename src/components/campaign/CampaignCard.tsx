import Link from "next/link";
import { pauseCampaignAction, resumeCampaignAction, startCampaign, stopCampaignAction } from "@/app/actions-campaign";
import type { CampaignCard as Card } from "@/lib/campaign";
import { modeLabel, statusLabel } from "@/lib/campaign-shape";
import { channelName } from "@/lib/channels";
import type { UiLang } from "@/lib/i18n";
import { translator } from "@/lib/i18n";
import { fmtDate, fmtWhen } from "@/lib/time";
import s from "./Campaign.module.css";
import { StopButton } from "./StopButton";

const STATUS_PILL: Record<string, string> = { active: "good", paused: "warn", draft: "neutral", stopped: "bad", ended: "neutral" };

export function ModeBadge({ mode, lang }: { mode: string; lang: UiLang }) {
  const cls = mode === "auto" ? s.auto : mode === "approval" ? s.approval : "";
  return <span className={`${s.mode} ${cls}`}>{mode === "auto" ? "✦ " : ""}{modeLabel(mode, lang)}</span>;
}

export function StatusPill({ status, lang }: { status: string; lang: UiLang }) {
  return <span className={`pill ${STATUS_PILL[status] ?? "neutral"}`}>{statusLabel(status, lang)}</span>;
}

/** Tarjeta de una campaña en la lista: modo, estado, fechas, canales, avance, la próxima publicación y «Parar». */
export function CampaignCard({ c, businessId, lang }: { c: Card; businessId: string; lang: UiLang }) {
  const t = translator(lang);
  const href = `/b/${businessId}/campanas/${c.id}`;
  const running = c.status === "active" || c.status === "paused" || c.status === "draft";
  const pct = c.planned ? Math.min(100, Math.round((c.published / c.planned) * 100)) : 0;
  return (
    <article className="card">
      <div className={s.cardTop}>
        <div className={s.badges}>
          <ModeBadge mode={c.mode} lang={lang} />
          <StatusPill status={c.status} lang={lang} />
        </div>
      </div>
      <h2 className={s.cardTitle}>
        <Link href={href}>{c.name}</Link>
      </h2>
      {c.goal && <p className={s.goal}>{c.goal}</p>}
      <dl className={s.facts}>
        <div>
          <dt>{t("Fechas", "Dates")}</dt>
          <dd>
            {fmtDate(c.startsAt, lang)} – {c.endsAt ? fmtDate(c.endsAt, lang) : t("sin fin", "no end")}
          </dd>
        </div>
        <div>
          <dt>{t("Canales", "Channels")}</dt>
          <dd>{c.channels.length ? c.channels.map((ch) => channelName(ch, lang)).join(", ") : "—"}</dd>
        </div>
        <div>
          <dt>{t("Publicadas", "Published")}</dt>
          <dd>
            {c.published} {t("de", "of")} {c.planned}
            {c.drafts ? ` · ${c.drafts} ${running ? t("por aprobar", "to approve") : t("cancelada(s)", "cancelled")}` : ""}
          </dd>
        </div>
        <div>
          <dt>{t("Próxima", "Next")}</dt>
          <dd>{c.nextAt ? fmtWhen(c.nextAt, lang) : "—"}</dd>
        </div>
      </dl>
      <div className={s.bar} role="img" aria-label={t(`${pct}% publicado`, `${pct}% published`)}>
        <i style={{ width: `${pct}%` }} />
      </div>
      {c.failed > 0 && <p className="note error small" style={{ margin: 0 }}>{t(`${c.failed} no se publicaron.`, `${c.failed} weren't posted.`)}</p>}
      <div className={s.cardActions}>
        <Link className="btn" href={href}>
          {c.drafts && running ? t("Ver y aprobar", "View and approve") : t("Ver campaña", "View campaign")}
        </Link>
        {c.status === "active" && (
          <form action={pauseCampaignAction.bind(null, businessId, c.id)}>
            <button className="btn" type="submit">{t("Pausar", "Pause")}</button>
          </form>
        )}
        {c.status === "paused" && (
          <form action={resumeCampaignAction.bind(null, businessId, c.id)}>
            <button className="btn on" type="submit">{t("Reanudar", "Resume")}</button>
          </form>
        )}
        {c.status === "draft" && (
          <form action={startCampaign.bind(null, businessId, c.id)}>
            <button className="btn on" type="submit">{t("Empezar", "Start")}</button>
          </form>
        )}
      </div>
      {running && (
        <StopButton
          action={stopCampaignAction.bind(null, businessId, c.id)}
          label={t("Parar", "Stop")}
          question={t(
            `¿Parar «${c.name}»? La IA deja de publicar y todo lo programado de esta campaña se cancela ahora mismo (los textos quedan guardados como borrador).`,
            `Stop “${c.name}”? The AI stops posting and everything scheduled for this campaign is cancelled right now (the texts stay saved as drafts).`,
          )}
        />
      )}
    </article>
  );
}
