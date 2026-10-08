"use client";

import { useActionState, useTransition } from "react";
import type { AdsResult } from "@/app/actions-ads";
import { useT } from "@/components/I18n";
import { money, SPECIAL_CATEGORIES, type SpecialCategory } from "@/lib/ads-shape";
import s from "./ads.module.css";

export type AdsAction = (prev: AdsResult, f: FormData) => Promise<AdsResult>;

/** Formulario con su estado: mientras trabaja se oculta y muestra `busy`; después, el resultado. */
export function ActionForm({
  action,
  busy,
  children,
  className,
  confirmText,
}: {
  action: AdsAction;
  busy: string;
  children: React.ReactNode;
  className?: string;
  /** Pregunta antes de enviar (window.confirm). */
  confirmText?: string;
}) {
  const [result, run, pending] = useActionState(action, null);
  return (
    <>
      <form
        action={run}
        className={className ?? "stack"}
        style={pending ? { display: "none" } : undefined}
        onSubmit={(e) => {
          if (confirmText && !window.confirm(confirmText)) e.preventDefault();
        }}
      >
        {children}
      </form>
      {pending && <p className="note info" role="status">{busy}</p>}
      {!pending && result?.message && (
        <p className={`note ${result.ok ? "ok" : "error"}`} role={result.ok ? "status" : "alert"}>
          {result.message}
        </p>
      )}
    </>
  );
}

const SPECIAL_TEXT: Record<SpecialCategory, [string, string]> = {
  NONE: ["Ninguna (negocio normal)", "None (regular business)"],
  FINANCIAL_PRODUCTS_SERVICES: ["Seguros, préstamos, crédito o inversiones", "Insurance, loans, credit or investments"],
  HOUSING: ["Vivienda (venta o alquiler de casas)", "Housing (home sales or rentals)"],
  EMPLOYMENT: ["Empleo (ofertas de trabajo)", "Employment (job offers)"],
};

/** Máximo por mes del negocio y categoría especial de Meta. */
export function SettingsForm({ action, monthlyCapCents, special, suggested }: { action: AdsAction; monthlyCapCents: number; special: SpecialCategory; suggested: SpecialCategory }) {
  const { t } = useT();
  return (
    <ActionForm action={action} busy={t("Guardando…", "Saving…")}>
      <div className={s.formGrid}>
        <label>
          <span className="lbl">{t("Máximo por mes para todos los anuncios (US$)", "Monthly maximum for all ads (US$)")}</span>
          <input className="field" name="monthlyCap" inputMode="decimal" defaultValue={monthlyCapCents ? (monthlyCapCents / 100).toString() : ""} placeholder="100" required />
          <span className="small muted">{t("Nunca se gasta más que esto en un mes, sumando todas las campañas.", "Never more than this in a month, adding up all campaigns.")}</span>
        </label>
        <label>
          <span className="lbl">{t("¿Tu negocio vende algo de esto?", "Does your business sell any of this?")}</span>
          <select className="field" name="specialCategory" defaultValue={special}>
            {SPECIAL_CATEGORIES.map((c) => (
              <option key={c} value={c}>{t(...SPECIAL_TEXT[c])}</option>
            ))}
          </select>
          <span className="small muted">
            {t(
              "Meta obliga a marcarlo. Con estas categorías no se pueden elegir edades ni intereses, y el radio mínimo es de 25 km.",
              "Meta requires it. With these categories you can't choose ages or interests, and the minimum radius is 25 km.",
            )}
          </span>
        </label>
      </div>
      {suggested !== "NONE" && special === "NONE" && (
        <p className="note">
          {t(
            "Por lo que dice el perfil de tu negocio (seguros, préstamos o crédito), Meta probablemente te pida «Seguros, préstamos, crédito o inversiones». Si no lo marcas, Meta puede rechazar o frenar tus anuncios.",
            "From your business profile (insurance, loans or credit), Meta will probably require \"Insurance, loans, credit or investments\". If you don't mark it, Meta may reject or stop your ads.",
          )}
        </p>
      )}
      <div><button className="btn on" type="submit">{t("Guardar límites", "Save limits")}</button></div>
    </ActionForm>
  );
}

/** El botón grande de emergencia. */
export function PauseAllButton({ action, live }: { action: AdsAction; live: number }) {
  const { t } = useT();
  return (
    <ActionForm
      action={action}
      busy={t("Pausando todos los anuncios…", "Pausing all ads…")}
      confirmText={t("¿Pausar TODOS los anuncios de este negocio? Dejan de gastar en unos minutos.", "Pause ALL ads for this business? They stop spending within minutes.")}
    >
      <button className={s.stopBtn} type="submit">
        {t("Pausar todos los anuncios", "Pause all ads")}
        {live > 0 ? ` (${live})` : ""}
      </button>
    </ActionForm>
  );
}

export function AccountPicker({ action, accounts, current }: { action: AdsAction; accounts: { id: string; name: string; currency: string; status: number }[]; current: string }) {
  const { t } = useT();
  return (
    <ActionForm action={action} busy={t("Guardando…", "Saving…")}>
      <label className="stack">
        <span className="lbl">{t("¿Con qué cuenta de anuncios se paga?", "Which ad account pays?")}</span>
        <select className="field" name="account" required defaultValue={current}>
          <option value="" disabled>{t("Elige una cuenta", "Pick an account")}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id} disabled={a.status !== 1}>
              {a.name} · {a.currency}
              {a.status !== 1 ? ` (${t("desactivada", "disabled")})` : ""}
            </option>
          ))}
        </select>
      </label>
      <div><button className="btn on" type="submit">{t("Usar esta cuenta", "Use this account")}</button></div>
    </ActionForm>
  );
}

export function DisconnectAds({ disconnect }: { disconnect: () => Promise<void> }) {
  const { t } = useT();
  const [pending, start] = useTransition();
  return (
    <button
      className="btn danger"
      type="button"
      disabled={pending}
      onClick={() => {
        if (window.confirm(t("¿Desconectar la cuenta de anuncios? Los anuncios que estén encendidos SIGUEN en Meta: páusalos antes.", "Disconnect the ad account? Ads that are on KEEP running on Meta: pause them first.")))
          start(() => disconnect());
      }}
    >
      {pending ? t("Desconectando…", "Disconnecting…") : t("Desconectar", "Disconnect")}
    </button>
  );
}

/** «La IA puede crear anuncios» (solo modo automático) y el tope diario de la campaña. */
export function CampaignOptions({ action, auto, aiCanCreate, dailyCapCents }: { action: AdsAction; auto: boolean; aiCanCreate: boolean; dailyCapCents: number }) {
  const { t } = useT();
  return (
    <ActionForm action={action} busy={t("Guardando…", "Saving…")}>
      <div className={s.formGrid}>
        <label>
          <span className="lbl">{t("Tope por día de esta campaña (US$)", "Daily cap for this campaign (US$)")}</span>
          <input className="field" name="dailyCap" inputMode="decimal" defaultValue={dailyCapCents ? (dailyCapCents / 100).toString() : ""} placeholder={t("Sin tope extra", "No extra cap")} />
          <span className="small muted">{t("Si los anuncios de la campaña gastan esto en un día, se pausan hasta mañana.", "If the campaign's ads spend this in a day, they pause until tomorrow.")}</span>
        </label>
      </div>
      {auto ? (
        <label className="check">
          <input type="checkbox" name="aiCanCreate" defaultChecked={aiCanCreate} />
          <span className="stack" style={{ gap: 2 }}>
            <b>{t("La IA puede crear anuncios", "The AI can create ads")}</b>
            <span className="small muted">
              {t(
                "Solo dentro del presupuesto de esta campaña. Los crea APAGADOS: encenderlos siempre lo decides tú.",
                "Only within this campaign's budget. It creates them PAUSED: turning them on is always your call.",
              )}
            </span>
          </span>
        </label>
      ) : (
        <p className="small muted">{t("En campañas automáticas puedes dejar que la IA cree anuncios (apagados).", "In automatic campaigns you can let the AI create ads (paused).")}</p>
      )}
      <div><button className="btn outline" type="submit">{t("Guardar", "Save")}</button></div>
    </ActionForm>
  );
}

/** Barra de gasto: lo gastado contra el máximo. */
export function SpendBar({ spent, max, label }: { spent: number; max: number; label: React.ReactNode }) {
  const pct = max > 0 ? Math.min(100, Math.round((spent / max) * 100)) : 0;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className={s.barText}>
        <span>{label}</span>
        <span>
          <strong>{money(spent)}</strong> / {money(max)}
        </span>
      </div>
      <div className={`${s.bar} ${pct >= 100 ? s.full : pct >= 80 ? s.warn : ""}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={spent}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
