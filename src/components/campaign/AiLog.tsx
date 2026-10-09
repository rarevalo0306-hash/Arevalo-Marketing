import { centsText } from "@/lib/campaign-shape";
import type { UiLang } from "@/lib/i18n";
import { translator } from "@/lib/i18n";
import { fmtWhen } from "@/lib/time";
import s from "./Campaign.module.css";

export type LogRow = { id: string; kind: string; summary: unknown; actor: string; costCents: number; createdAt: Date };

function tone(kind: string): string {
  if (/^(campaign\.stopped|post\.error|alert\.failed)/.test(kind)) return s.bad;
  if (/^(limit\.|campaign\.paused|media\.unused)/.test(kind)) return s.warn;
  if (/^(post\.scheduled|post\.approved|post\.published|campaign\.(started|resumed))/.test(kind)) return s.good;
  return s.info;
}

const ACTOR: Record<string, [string, string]> = { auto: ["IA", "AI"], approved: ["Aprobado", "Approved"], owner: ["Tú", "You"] };

/** Registro de lo que hizo la IA (y el dueño) en la campaña, en frases sencillas. */
export function AiLog({ rows, lang }: { rows: LogRow[]; lang: UiLang }) {
  const t = translator(lang);
  if (!rows.length) return <p className="muted" style={{ margin: 0 }}>{t("Todavía no hay nada en el registro.", "Nothing in the log yet.")}</p>;
  return (
    <ul className={s.log}>
      {rows.map((r) => {
        const sum = (r.summary && typeof r.summary === "object" ? r.summary : {}) as { es?: string; en?: string };
        return (
          <li key={r.id}>
            <i className={`${s.dot} ${tone(r.kind)}`} aria-hidden="true" />
            <div className="stack" style={{ gap: 2, minWidth: 0 }}>
              <p className={s.logText}>{(lang === "en" ? sum.en : sum.es) || sum.es || r.kind}</p>
              <span className={s.logWhen}>
                {fmtWhen(r.createdAt, lang)} · {t(...(ACTOR[r.actor] ?? ACTOR.auto))}
                {r.costCents ? ` · ${centsText(r.costCents)}` : ""}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
