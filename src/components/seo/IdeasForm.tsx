"use client";

import { useActionState } from "react";
import type { IdeasResult } from "@/app/actions-seo-ideas";
import { useT } from "@/components/I18n";

/** Escribir una palabra y buscar sus ideas. */
export function IdeasForm({ action, seed, price }: { action: (prev: IdeasResult, f: FormData) => Promise<IdeasResult>; seed: string; price: string }) {
  const { t } = useT();
  const [result, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="stack" style={{ gap: 4, flex: "1 1 240px" }}>
          <span className="lbl">{t("Palabra para buscar ideas", "Word to find ideas for")}</span>
          <input name="seed" className="field" defaultValue={seed} maxLength={60} required placeholder={t("ej.: reparación de techos", "e.g. roof repair")} disabled={pending} />
        </label>
        <button type="submit" className="btn ai" disabled={pending}>
          {pending ? t("Buscando ideas…", "Finding ideas…") : t("Buscar ideas", "Find ideas")}
        </button>
      </div>
      <span className="small muted">{t(`Cuesta ≈ ${price} de tu saldo de DataForSEO (hasta 300 ideas).`, `Costs ≈ ${price} from your DataForSEO balance (up to 300 ideas).`)}</span>
      {result && !pending && (
        <p className={result.ok ? "note ok" : "note error"} role="status">
          {result.message}
        </p>
      )}
    </form>
  );
}
