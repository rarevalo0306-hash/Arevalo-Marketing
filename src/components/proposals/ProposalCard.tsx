"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { acceptProposalAction, rejectProposalAction, undoProposalAction, type ProposalActionState } from "@/app/actions-proposals";
import { useT } from "@/components/I18n";
import s from "./proposals.module.css";

/** Lo que muestra una tarjeta (ya traducido en el servidor). */
export type ProposalCardView = {
  id: string;
  businessId: string;
  campaignId: string;
  kindLabel: string;
  impact: 1 | 2 | 3;
  impactLabel: string;
  title: string;
  detail: string;
  facts: { label: string; value: string }[];
  period: string;
  source: string;
  change: { label: string; before: string; after: string }[];
  /** proposed | applied | accepted | rejected | expired */
  status: string;
  statusLine: string;
  /** Solo un consejo (no cambia nada en la app). */
  advice: boolean;
  /** Hay que hacerlo en otra pantalla (p. ej. encender un anuncio en Anuncios). */
  link: { href: string; label: string } | null;
  canUndo: boolean;
  undoLine: string;
  highlight: string;
  rejectReason: string;
};

const REASONS: [string, string][] = [
  ["No me convence", "I'm not convinced"],
  ["Ya lo hago de otra forma", "I already do it another way"],
  ["No aplica a mi negocio", "It doesn't fit my business"],
  ["Ahora no", "Not now"],
];

function Hidden({ v }: { v: ProposalCardView }) {
  return (
    <>
      <input type="hidden" name="businessId" value={v.businessId} />
      <input type="hidden" name="proposalId" value={v.id} />
      <input type="hidden" name="campaignId" value={v.campaignId} />
    </>
  );
}

export function ProposalCard({ v }: { v: ProposalCardView }) {
  const { t } = useT();
  const [acc, accept, accepting] = useActionState<ProposalActionState, FormData>(acceptProposalAction, null);
  const [rej, reject, rejecting] = useActionState<ProposalActionState, FormData>(rejectProposalAction, null);
  const [und, undo, undoing] = useActionState<ProposalActionState, FormData>(undoProposalAction, null);
  const [asking, setAsking] = useState(false);
  const pending = accepting || rejecting || undoing;
  const error = [acc, rej, und].find((x) => x && !x.ok);
  const impactCls = v.impact === 3 ? "good" : v.impact === 2 ? "info" : "neutral";

  return (
    <article className={`card ${s.card} ${v.highlight ? s.highlight : ""}`} id={`p-${v.id}`} aria-labelledby={`pt-${v.id}`}>
      <div className={s.top}>
        <span className={`pill ${impactCls}`}>{v.impactLabel}</span>
        <span className={s.kind}>{v.kindLabel}</span>
        {v.advice && <span className={`pill plain neutral ${s.tip}`}>{t("Solo un consejo", "Just a tip")}</span>}
      </div>
      <h3 id={`pt-${v.id}`} className={s.title}>
        {v.title}
      </h3>
      {v.detail && <p className={s.detail}>{v.detail}</p>}
      {v.highlight && (
        <p className={`note ok ${s.flash}`} role="status">
          {v.highlight}
        </p>
      )}

      {(v.facts.length > 0 || v.source) && (
        <section className={s.why} aria-label={t("Por qué", "Why")}>
          <h4>{t("Por qué", "Why")}</h4>
          {v.facts.length > 0 && (
            <dl className={s.facts}>
              {v.facts.map((f, i) => (
                <div key={i} className={s.fact}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className={s.source}>
            {v.period && <span>{v.period}</span>}
            {v.period && v.source && " · "}
            {v.source}
          </p>
        </section>
      )}

      {v.change.length > 0 && (
        <section className={s.change} aria-label={t("Qué cambia", "What changes")}>
          <h4>{v.status === "proposed" ? t("Qué cambia si aceptas", "What changes if you accept") : t("Qué cambió", "What changed")}</h4>
          <ul>
            {v.change.map((c, i) => (
              <li key={i}>
                <span className={s.changeLabel}>{c.label}</span>
                <span className={s.changeRow}>
                  <span className={s.before}>{c.before || "—"}</span>
                  <span className={s.arrow} aria-label={t("pasa a", "becomes")}>
                    →
                  </span>
                  <strong className={s.after}>{c.after || "—"}</strong>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {v.link && (
        <p className={s.linkLine}>
          <Link href={v.link.href}>{v.link.label} →</Link>
        </p>
      )}

      {error && (
        <p className="note error" role="alert">
          {error.message}
        </p>
      )}

      {pending && (
        <p className={s.pending} role="status" aria-live="polite">
          <span className={s.spinner} aria-hidden="true" />
          {accepting ? t("Aplicando…", "Applying…") : undoing ? t("Deshaciendo…", "Undoing…") : t("Guardando…", "Saving…")}
        </p>
      )}

      {v.status === "proposed" && !asking && (
        <div className={s.actions} style={pending ? { display: "none" } : undefined}>
          <form action={accept}>
            <Hidden v={v} />
            <button type="submit" className="btn solid">
              {v.advice ? t("Entendido", "Got it") : t("Aceptar y aplicar", "Accept and apply")}
            </button>
          </form>
          <button type="button" className="btn" onClick={() => setAsking(true)}>
            {v.advice ? t("No me interesa", "Not interested") : t("Rechazar", "Reject")}
          </button>
        </div>
      )}

      {v.status === "proposed" && asking && (
        <form action={reject} className={s.rejectBox} style={pending ? { display: "none" } : undefined}>
          <Hidden v={v} />
          <label className={s.rejectLabel} htmlFor={`r-${v.id}`}>
            {t("¿Por qué? (opcional, ayuda a la IA a proponer mejor)", "Why? (optional, helps the AI propose better)")}
          </label>
          <select id={`r-${v.id}`} name="reason" className="field" defaultValue="">
            <option value="">{t("Prefiero no decir", "I'd rather not say")}</option>
            {REASONS.map(([es, en]) => (
              <option key={es} value={es}>
                {t(es, en)}
              </option>
            ))}
          </select>
          <div className={s.actions}>
            <button type="submit" className="btn danger">
              {t("Rechazar", "Reject")}
            </button>
            <button type="button" className="btn link" onClick={() => setAsking(false)}>
              {t("Cancelar", "Cancel")}
            </button>
          </div>
        </form>
      )}

      <div className={s.foot}>
        <span className={s.status}>{v.statusLine}</span>
        {v.rejectReason && <span className={s.status}>· {v.rejectReason}</span>}
        {v.canUndo && (
          <form action={undo} className={s.undo} style={pending ? { display: "none" } : undefined}>
            <Hidden v={v} />
            <button type="submit" className="btn outline">
              {t("Deshacer", "Undo")}
            </button>
            <span className={s.status}>{v.undoLine}</span>
          </form>
        )}
      </div>
    </article>
  );
}
