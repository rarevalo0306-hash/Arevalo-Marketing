"use client";

import { useActionState } from "react";
import type { AdsResult } from "@/app/actions-seo-ads";
import { useT } from "@/components/I18n";

/** Los competidores a revisar (se pueden cambiar) y el botón. */
export function AdsForm({ action, defaults, price, has }: { action: (prev: AdsResult, f: FormData) => Promise<AdsResult>; defaults: string[]; price: string; has: boolean }) {
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
      <div className="row">
        <button type="submit" className="btn ai" disabled={pending}>
          {pending ? t("Buscando sus anuncios…", "Looking up their ads…") : has ? t("Volver a revisar sus anuncios", "Check their ads again") : t("Ver los anuncios de tu competencia", "See your competitors' ads")}
        </button>
        <span className="small muted">{pending ? t("Suele tardar unos segundos.", "It usually takes a few seconds.") : t(`Cuesta ≈ ${price} de tu saldo de DataForSEO.`, `Costs ≈ ${price} from your DataForSEO balance.`)}</span>
      </div>
      {result && !pending && (
        <p className={result.ok ? "note ok" : "note error"} role="status">
          {result.message}
        </p>
      )}
    </form>
  );
}
