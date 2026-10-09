"use client";

import { useT } from "@/components/I18n";
import { GOAL_LABEL, maxSpendCents, money, type AdProposal } from "@/lib/ads-shape";
import { ActionForm, type AdsAction } from "./AdsForms";
import s from "./ads.module.css";

/** Propuestas de la IA, cada una con «Crear (pausado)». */
export function Proposals({
  proposals,
  propose,
  create,
  canCreate,
  aiReady,
}: {
  proposals: AdProposal[];
  propose: AdsAction;
  create: Record<string, AdsAction>;
  /** Motivo por el que todavía no se puede crear ("" = sí se puede). */
  canCreate: string;
  aiReady: boolean;
}) {
  const { t, lang } = useT();
  const nf = new Intl.NumberFormat(lang === "en" ? "en-US" : "es", { useGrouping: "always" });
  return (
    <div className="stack" style={{ gap: 12 }}>
      <ActionForm action={propose} busy={t("La IA está pensando en anuncios… (unos 20 segundos)", "The AI is thinking of ads… (about 20 seconds)")}>
        <div className="row">
          <button className="btn ai" type="submit" disabled={!aiReady}>
            ✨ {proposals.length ? t("Pedir otras ideas", "Ask for other ideas") : t("Proponer anuncios con IA", "Propose ads with AI")}
          </button>
          <span className="small muted">
            {aiReady
              ? t("Usa la meta de la campaña, tu plan de acción, tus palabras clave y tus mejores publicaciones. No gasta nada.", "Uses the campaign goal, your action plan, your keywords and your best posts. Spends nothing.")
              : t("Falta configurar la IA (GEMINI_API_KEY).", "The AI isn't set up (GEMINI_API_KEY).")}
          </span>
        </div>
      </ActionForm>
      {proposals.length > 0 && (
        <div className={s.proposals}>
          {proposals.map((p) => (
            <article key={p.id} className={s.proposal} aria-label={p.title}>
              <div className="row between" style={{ gap: 8 }}>
                <h3>{p.title}</h3>
                <span className="pill info">{t(GOAL_LABEL[p.goal].es, GOAL_LABEL[p.goal].en)}</span>
              </div>
              <p className="small muted">{p.why}</p>
              <p className="small">
                <b>{p.postKind === "new" ? t("Anuncio nuevo", "New ad") : p.postKind === "fb_post" ? t("Promocionar publicación de Facebook", "Promote a Facebook post") : t("Promocionar publicación de Instagram", "Promote an Instagram post")}</b>
              </p>
              {p.headline && <p><b>{p.headline}</b></p>}
              {p.text && <div className={s.quote}>{p.text}</div>}
              <div className={s.meta}>
                <span>
                  <b>{t("Quién", "Who")}:</b> {t(`${p.radiusKm} km alrededor del negocio`, `${p.radiusKm} km around the business`)}
                  {p.ageMin !== null || p.ageMax !== null ? ` · ${p.ageMin ?? 18}–${p.ageMax ?? 65}` : ""}
                  {p.interests.length ? ` · ${p.interests.join(", ")}` : ""}
                </span>
                <span>
                  <b>{t("Gasto", "Spend")}:</b> {t(`${money(p.dailyCents)} por día × ${p.days} días = máximo ${money(maxSpendCents(p.dailyCents, p.days))}`, `${money(p.dailyCents)} a day × ${p.days} days = max ${money(maxSpendCents(p.dailyCents, p.days))}`)}
                </span>
                {p.reachHigh > 0 && (
                  <span>
                    <b>{t("Alcance esperado", "Expected reach")}:</b> {nf.format(p.reachLow)}–{nf.format(p.reachHigh)} {t("personas (estimado de la IA)", "people (AI estimate)")}
                  </span>
                )}
              </div>
              {p.keywords.length > 0 && (
                <div className="tags">
                  {p.keywords.map((k) => (
                    <span key={k} className="tag">{k}</span>
                  ))}
                </div>
              )}
              {create[p.id] && (
                <ActionForm action={create[p.id]} busy={t("Creando en Meta (apagado)…", "Creating on Meta (paused)…")}>
                  <div className="row">
                    <button className="btn on" type="submit" disabled={Boolean(canCreate)}>{t("Crear (pausado)", "Create (paused)")}</button>
                    {canCreate && <span className="small muted">{canCreate}</span>}
                  </div>
                </ActionForm>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
