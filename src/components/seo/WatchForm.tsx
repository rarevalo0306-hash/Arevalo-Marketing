"use client";

import { useActionState } from "react";
import type { WatchResult } from "@/app/actions-seo-watch";
import { useT } from "@/components/I18n";

/** Los competidores a vigilar, el interruptor «Revisar cada semana» y los botones Guardar / Revisar ahora. */
export function WatchForm({ action, defaults, enabled, price }: { action: (prev: WatchResult, f: FormData) => Promise<WatchResult>; defaults: string[]; enabled: boolean; price: string }) {
  const { t } = useT();
  const [result, run, pending] = useActionState(action, null);
  const values = Array.from({ length: 3 }, (_, i) => defaults[i] ?? "");
  return (
    <form action={run} className="stack" style={{ gap: 10 }}>
      <div className="compare-inputs">
        {values.map((v, i) => (
          <input
            key={i}
            name="domain"
            className="field"
            type="text"
            inputMode="url"
            autoComplete="off"
            defaultValue={v}
            maxLength={200}
            placeholder={t(`competencia${i + 1}.com`, `competitor${i + 1}.com`)}
            aria-label={t(`Competidor ${i + 1}`, `Competitor ${i + 1}`)}
          />
        ))}
      </div>
      <label className="row watch-toggle">
        <input type="checkbox" name="enabled" defaultChecked={enabled} />
        <span>
          <strong>{t("Revisar cada semana", "Check every week")}</strong>
          <span className="small muted">{t(` y avisarme por email lo nuevo (≈ ${price} por semana de tu saldo de DataForSEO).`, ` and email me what's new (≈ ${price} a week from your DataForSEO balance).`)}</span>
        </span>
      </label>
      <div className="row">
        <button type="submit" name="intent" value="save" className="btn" disabled={pending}>
          {t("Guardar", "Save")}
        </button>
        <button type="submit" name="intent" value="run" className="btn ai" disabled={pending}>
          {pending ? t("Revisando a tu competencia…", "Checking your competitors…") : t("Revisar ahora", "Check now")}
        </button>
        <span className="small muted">{pending ? t("Suele tardar unos segundos. No cierres esta página.", "It usually takes a few seconds. Don't close this page.") : t(`Revisar ahora cuesta ≈ ${price}.`, `Checking now costs ≈ ${price}.`)}</span>
      </div>
      {result && !pending && (
        <p className={result.ok ? "note ok" : "note error"} role="status">
          {result.message}
        </p>
      )}
    </form>
  );
}
