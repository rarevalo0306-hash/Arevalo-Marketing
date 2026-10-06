"use client";

import { useActionState, useEffect, useState } from "react";
import type { RankResult } from "@/app/actions-seo-rank";
import { useT } from "@/components/I18n";

type Props = {
  action: (prev: RankResult, f: FormData) => Promise<RankResult>;
  /** Cuántas palabras clave se van a revisar. */
  keywords: number;
  /** En cuántas zonas (cada palabra se revisa en cada zona). */
  zones?: number;
  /** Costo por palabra clave (USD). */
  perKeyword: number;
  /** Ya hay una revisión guardada. */
  has: boolean;
};

function Working({ pending, keywords, zones }: { pending: boolean; keywords: number; zones: number }) {
  const { t } = useT();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!pending) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  if (!pending) return null;
  // Unas 8 consultas a la vez: el tiempo crece con palabras × zonas.
  const lookups = keywords * zones;
  const steps: [number, string][] = [
    [
      0,
      zones > 1
        ? t(`Buscando tus ${keywords} palabras clave en Google en tus ${zones} zonas…`, `Searching your ${keywords} keywords on Google in your ${zones} areas…`)
        : t(`Buscando tus ${keywords} palabras clave en Google…`, `Searching your ${keywords} keywords on Google…`),
    ],
    [Math.max(10, lookups), t("Buscando tu página y tu negocio en el mapa…", "Looking for your website and your business on the map…")],
    [Math.max(25, Math.round(lookups * 1.5)), t("Comparando con la revisión anterior…", "Comparing with the last check…")],
  ];
  const now = steps.findLastIndex(([at]) => seconds >= at);
  return (
    <div className="stack" style={{ gap: 12 }} aria-live="polite">
      <ul className="magic-steps">
        {steps.map(([, label], i) => <li key={label} className={i < now ? "done" : i === now ? "now" : ""}>{label}</li>)}
      </ul>
      <p className="small muted">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} ·{" "}
        {lookups > 30
          ? t("Puede tardar unos minutos. No cierres esta página.", "It can take a few minutes. Don't close this page.")
          : t("Suele tardar menos de un minuto. No cierres esta página.", "It usually takes less than a minute. Don't close this page.")}
      </p>
    </div>
  );
}

export function RankButton({ action, keywords, zones = 1, perKeyword, has }: Props) {
  const { t, lang } = useT();
  const [result, run, pending] = useActionState(action, null);
  const money = (n: number) => new Intl.NumberFormat(lang === "en" ? "en-US" : "es", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(n);
  const total = money(Math.round(keywords * zones * perKeyword * 10000) / 10000);
  return (
    <form action={run} className="stack" style={{ gap: 12 }}>
      {!pending && (
        <div className="row">
          <button type="submit" className="btn ai">
            {has ? t("Volver a revisar", "Check again") : t("Revisar mis posiciones", "Check my rankings")}
          </button>
          <span className="small muted">
            {zones > 1
              ? t(
                  `Cuesta ≈ ${total} (${keywords} ${keywords === 1 ? "palabra" : "palabras"} × ${zones} zonas × ${money(perKeyword)}) de tu saldo de DataForSEO.`,
                  `Costs ≈ ${total} (${keywords} ${keywords === 1 ? "keyword" : "keywords"} × ${zones} areas × ${money(perKeyword)}) from your DataForSEO balance.`,
                )
              : t(
                  `Cuesta ≈ ${total} (${keywords} ${keywords === 1 ? "palabra" : "palabras"} × ${money(perKeyword)}) de tu saldo de DataForSEO.`,
                  `Costs ≈ ${total} (${keywords} ${keywords === 1 ? "keyword" : "keywords"} × ${money(perKeyword)}) from your DataForSEO balance.`,
                )}
          </span>
        </div>
      )}
      <Working pending={pending} keywords={keywords} zones={zones} />
      {result && !pending && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
    </form>
  );
}
