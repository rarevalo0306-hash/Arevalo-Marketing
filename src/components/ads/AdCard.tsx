"use client";

import { useState } from "react";
import { useT } from "@/components/I18n";
import { costPerResultCents, GOAL_LABEL, money, RESULT_LABEL, type AdEntry } from "@/lib/ads-shape";
import { ActionForm, SpendBar, type AdsAction } from "./AdsForms";
import s from "./ads.module.css";

export type AdView = AdEntry & {
  /** "8 oct – 15 oct" (lo arma el servidor en la hora del negocio). */
  dates: string;
  fetchedText: string;
  /** El último error es de las últimas 24 horas (o el anuncio quedó con error). */
  showError: boolean;
};

const nf = (lang: string) => new Intl.NumberFormat(lang === "en" ? "en-US" : "es", { useGrouping: "always" });

/** Público en palabras: "15 km alrededor de Managua · 25–54 años · intereses: …". */
export function audienceText(a: AdEntry, t: (es: string, en: string) => string): string {
  const g = a.targeting;
  const parts = [t(`${g.radiusKm} km alrededor de ${g.place || "tu negocio"}`, `${g.radiusKm} km around ${g.place || "your business"}`)];
  if (g.ageMin !== null || g.ageMax !== null) parts.push(t(`${g.ageMin ?? 18}–${g.ageMax ?? 65} años`, `ages ${g.ageMin ?? 18}–${g.ageMax ?? 65}`));
  else parts.push(t("18 años o más", "18 and older"));
  if (g.interests.length) parts.push(t(`intereses: ${g.interests.map((i) => i.name).join(", ")}`, `interests: ${g.interests.map((i) => i.name).join(", ")}`));
  return parts.join(" · ");
}

export function AdCard({ ad, pause, activate, canActivate }: { ad: AdView; pause: AdsAction; activate: AdsAction; canActivate: string | null }) {
  const { t, lang } = useT();
  const [asking, setAsking] = useState(false);
  const live = ad.status === "active" || ad.status === "capped_today";
  const i = ad.insights;
  const cpr = costPerResultCents(ad);
  const n = nf(lang);
  const status: Record<AdEntry["status"], [string, string]> = {
    active: ["pill good", t("Encendido", "On")],
    capped_today: ["pill warn", t("Pausado hasta mañana", "Paused until tomorrow")],
    paused: ["pill neutral", t("Apagado", "Off")],
    ended: ["pill plain", t("Terminado", "Ended")],
    error: ["pill bad", t("Con error", "Error")],
  };
  const reason: Record<string, string> = {
    owner: t("Lo pausaste tú.", "You paused it."),
    budget: t("Se gastó su presupuesto.", "Its budget was spent."),
    daily: t("Llegó al gasto del día; sigue mañana.", "It reached its daily spend; continues tomorrow."),
    monthly: t("Se llegó al máximo del mes.", "The monthly maximum was reached."),
    campaign: t("La campaña se pausó, se paró o terminó.", "The campaign was paused, stopped or ended."),
    ended: t("Llegó su fecha de fin.", "Its end date arrived."),
    error: t("No se terminó de crear en Meta.", "It wasn't fully created on Meta."),
  };
  const lastError = ad.errors.at(-1);
  const neverOn = !ad.activatedAt;
  const source = ad.source.kind === "fb_post" ? t("Publicación de Facebook", "Facebook post") : ad.source.kind === "ig_post" ? t("Publicación de Instagram", "Instagram post") : t("Anuncio nuevo", "New ad");

  return (
    <article className={s.ad} aria-label={ad.name}>
      <div className={s.adHead}>
        {ad.source.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={s.adThumb} src={ad.source.image} alt="" />
        ) : (
          <span className={s.adThumb} aria-hidden />
        )}
        <div className={s.adTitle}>
          <div className="row" style={{ gap: 8 }}>
            <h3>{ad.name}</h3>
            <span className={status[ad.status][0]}>{status[ad.status][1]}</span>
            {ad.createdBy === "auto" && <span className="pill info">{t("Lo creó la IA", "Created by AI")}</span>}
          </div>
          <span className="small muted">
            Facebook · Instagram — {t(GOAL_LABEL[ad.goal].es, GOAL_LABEL[ad.goal].en)} · {source}
          </span>
          {ad.source.text && <p className={s.adText}>{ad.source.text}</p>}
        </div>
      </div>

      <SpendBar spent={i?.spentCents ?? 0} max={ad.totalCents} label={t("Gastado de su máximo", "Spent of its maximum")} />

      {i ? (
        <div className={s.facts}>
          <div className={s.fact}>
            <b>{n.format(i.reach)}</b>
            <span>{t("personas lo vieron", "people saw it")}</span>
          </div>
          <div className={s.fact}>
            <b>{n.format(i.clicks)}</b>
            <span>{t("clics", "clicks")}</span>
          </div>
          {ad.goal !== "awareness" && (
            <div className={s.fact}>
              <b>{n.format(i.results)}</b>
              <span>{t(RESULT_LABEL[ad.goal].es, RESULT_LABEL[ad.goal].en)}</span>
            </div>
          )}
          <div className={s.fact}>
            <b>{cpr === null ? "—" : money(cpr)}</b>
            <span>
              {ad.goal === "calls"
                ? t("por llamada", "per call")
                : ad.goal === "messages"
                  ? t("por conversación", "per conversation")
                  : ad.goal === "awareness"
                    ? t("por cada 1.000 personas", "per 1,000 people")
                    : t("por resultado", "per result")}
            </span>
          </div>
          <div className={s.fact}>
            <b>{money(i.todayCents)}</b>
            <span>{t(`hoy (máx. ${money(ad.dailyCents)})`, `today (max ${money(ad.dailyCents)})`)}</span>
          </div>
        </div>
      ) : (
        <p className="small muted">
          {live ? t("Todavía sin resultados: se actualizan cada 20 minutos.", "No results yet: they update every 20 minutes.") : t("Sin resultados todavía: apagado no gasta nada.", "No results yet: while off it spends nothing.")}
        </p>
      )}

      <div className={s.meta}>
        <span><b>{t("Público", "Audience")}:</b> {audienceText(ad, t)}</span>
        <span><b>{t("Fechas", "Dates")}:</b> {ad.dates}</span>
        <span><b>{t("Por día", "Per day")}:</b> {money(ad.dailyCents)}</span>
        {i && <span className="small">{ad.fetchedText}</span>}
      </div>

      {ad.pausedReason && !live && ad.status !== "ended" && <p className="small muted">{reason[ad.pausedReason]}</p>}
      {lastError && ad.showError && (
        <p className="note error">{t(lastError.es, lastError.en)}</p>
      )}

      {live && (
        <ActionForm action={pause} busy={t("Pausando…", "Pausing…")}>
          <div><button className="btn danger" type="submit">{t("Pausar", "Pause")}</button></div>
        </ActionForm>
      )}

      {ad.status === "paused" && ad.ext.adId && !asking && (
        <div className="row">
          <button className="btn on" type="button" onClick={() => setAsking(true)} disabled={Boolean(canActivate)}>
            ▶ {neverOn ? t("Encender", "Turn on") : t("Reanudar", "Resume")}
          </button>
          {canActivate && <span className="small muted">{canActivate}</span>}
        </div>
      )}

      {asking && (
        <div className={s.confirm} role="group" aria-label={t("Confirmar gasto", "Confirm spending")}>
          <h3>{t("Antes de encender, revisa:", "Before turning it on, check:")}</h3>
          <dl>
            <dt>{t("Dónde", "Where")}</dt>
            <dd>Facebook · Instagram (Meta)</dd>
            <dt>{t("Para qué", "Goal")}</dt>
            <dd>{t(GOAL_LABEL[ad.goal].es, GOAL_LABEL[ad.goal].en)}</dd>
            <dt>{t("Quién lo ve", "Who sees it")}</dt>
            <dd>{audienceText(ad, t)}</dd>
            <dt>{t("Fechas", "Dates")}</dt>
            <dd>{ad.dates}</dd>
            <dt>{t("Por día", "Per day")}</dt>
            <dd>{t(`hasta ${money(ad.dailyCents)} (si llega, se pausa hasta mañana)`, `up to ${money(ad.dailyCents)} (if reached, it pauses until tomorrow)`)}</dd>
            <dt>{t("Total", "Total")}</dt>
            <dd>{money(ad.totalCents)}</dd>
          </dl>
          <p className="small">{t("Lo máximo que puede gastar:", "The most it can spend:")}</p>
          <p className={s.maxSpend}>{money(Math.max(0, ad.totalCents - (i?.spentCents ?? 0)))}</p>
          <p className="small muted">
            {t(
              "Meta nunca cobra más que el total del anuncio. La app además lo pausa al llegar al gasto del día, al presupuesto de la campaña o al máximo del mes.",
              "Meta never charges more than the ad total. The app also pauses it when it reaches the daily spend, the campaign budget or the monthly maximum.",
            )}
          </p>
          <ActionForm action={activate} busy={t("Encendiendo en Meta…", "Turning on in Meta…")}>
            <input type="hidden" name="maxCents" value={ad.totalCents} />
            <label className="check">
              <input type="checkbox" name="confirm" value="yes" required />
              <span>{t(`Entiendo que este anuncio puede gastar hasta ${money(ad.totalCents)} de mi tarjeta.`, `I understand this ad can spend up to ${money(ad.totalCents)} from my card.`)}</span>
            </label>
            <div className="row">
              <button className="btn on" type="submit">{t("Sí, encender anuncio", "Yes, turn on the ad")}</button>
              <button className="btn" type="button" onClick={() => setAsking(false)}>{t("Cancelar", "Cancel")}</button>
            </div>
          </ActionForm>
        </div>
      )}
    </article>
  );
}
