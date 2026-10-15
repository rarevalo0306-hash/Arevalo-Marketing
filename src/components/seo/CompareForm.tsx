"use client";

import { useActionState } from "react";
import type { CompareResult } from "@/app/actions-seo-compare";
import { useT } from "@/components/I18n";

type Props = {
  action: (prev: CompareResult, f: FormData) => Promise<CompareResult>;
  /** Tu página (va siempre primero; no se puede quitar). */
  own: string | null;
  /** Las otras páginas para empezar (hasta 4). */
  defaults: string[];
  /** Lo que cuesta, ya formateado. */
  price: string;
  has: boolean;
};

/** Las páginas a comparar: la tuya y hasta 4 más. */
export function CompareForm({ action, own, defaults, price, has }: Props) {
  const { t } = useT();
  const [result, run, pending] = useActionState(action, null);
  const slots = own ? 4 : 5;
  const values = Array.from({ length: slots }, (_, i) => defaults[i] ?? "");
  return (
    <form action={run} className="stack" style={{ gap: 10 }}>
      <div className="compare-inputs">
        {own && (
          <span className="compare-own" title={t("Tu página va siempre primero", "Your website always goes first")}>
            {t("Tú:", "You:")} <strong>{own}</strong>
          </span>
        )}
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
            aria-label={t(`Página ${i + 1} para comparar`, `Website ${i + 1} to compare`)}
          />
        ))}
      </div>
      <div className="row">
        <button type="submit" className="btn ai" disabled={pending}>
          {pending ? t("Comparando…", "Comparing…") : has ? t("Comparar otra vez", "Compare again") : t("Comparar", "Compare")}
        </button>
        <span className="small muted">{pending ? t("Suele tardar unos segundos. No cierres esta página.", "It usually takes a few seconds. Don't close this page.") : t(`Cuesta ≈ ${price} de tu saldo de DataForSEO.`, `Costs ≈ ${price} from your DataForSEO balance.`)}</span>
      </div>
      {result && !pending && (
        <p className={result.ok ? "note ok" : "note error"} role="status">
          {result.message}
        </p>
      )}
    </form>
  );
}
