// El reporte en pantalla: «Lo más importante» y las mismas secciones que el email y el PDF (reportSections).
import Link from "next/link";
import type { ViewSection, ViewTone } from "@/lib/report-period-view";
import s from "./reports.module.css";

type Props = {
  title: string;
  highlights: string[];
  /** "ai" = escritas por la IA para el email de ese día; "rules" = armadas sin IA. */
  source: "ai" | "rules";
  sections: ViewSection[];
  lang: "es" | "en";
};

const dot = (t: ViewTone | undefined) => (t === "good" ? s.dotGood : t === "bad" ? s.dotBad : "");
const toneClass = (t: ViewTone | undefined) => (t === "good" ? s.good : t === "bad" ? s.bad : "");
const external = (href: string) => /^https?:\/\//i.test(href);

function A({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return external(href) ? (
    <a href={href} className={className} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export function ReportView({ title, highlights, source, sections, lang }: Props) {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  return (
    <div className={s.report}>
      <section className={s.top} aria-labelledby="rep-top">
        <h2 id="rep-top">{title}</h2>
        <ol className={s.topList}>
          {highlights.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ol>
        <span className={s.source}>
          {source === "ai"
            ? t("Escrito por la IA con los datos de este reporte (el mismo texto del email).", "Written by the AI from this report's data (the same text as the email).")
            : t("Armado con los datos de este reporte.", "Put together from this report's data.")}
        </span>
      </section>

      {sections.length === 0 && <div className={`card ${s.empty}`}>{t("Todavía no hay nada que mostrar en estas fechas.", "There's nothing to show for these dates yet.")}</div>}

      {sections.map((sec) => (
        <section key={sec.id} className={`card ${s.section}`} aria-labelledby={`rep-${sec.id}`}>
          <div className={s.sectionHead}>
            <h2 id={`rep-${sec.id}`}>{sec.title}</h2>
            {sec.href && (
              <A href={sec.href} className={s.sectionLink}>
                {sec.hrefText ?? t("Ver en la app", "See in the app")}
              </A>
            )}
          </div>
          {sec.stats && sec.stats.length > 0 && (
            <div className={s.stats}>
              {sec.stats.map((st, i) => (
                <div key={i} className={s.stat}>
                  <div className={s.statLabel}>{st.label}</div>
                  <div className={`${s.statValue} ${toneClass(st.tone)}`}>{st.value}</div>
                  {st.sub && <div className={s.statSub}>{st.sub}</div>}
                </div>
              ))}
            </div>
          )}
          {sec.items && sec.items.length > 0 && (
            <ul className={s.items}>
              {sec.items.map((it, i) => (
                <li key={i} className={s.item}>
                  <span className={`${s.dot} ${dot(it.tone)}`} aria-hidden="true" />
                  <span className={s.itemBody}>
                    <span className={s.itemText}>
                      {it.text}
                      {it.href && (
                        <A href={it.href} className={s.itemLink}>
                          {it.linkText ?? t("Ver", "View")}
                        </A>
                      )}
                    </span>
                    {it.meta && <span className={s.itemMeta}>{it.meta}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {sec.table && sec.table.rows.length > 0 && (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    {sec.table.head.map((h, i) => (
                      <th key={i} scope="col">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sec.table.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} data-label={ci ? sec.table?.head[ci] : undefined}>
                          {ci === 0 && sec.table?.links?.[ri] ? (
                            <a href={sec.table.links[ri]!} target="_blank" rel="noreferrer">
                              {cell}
                            </a>
                          ) : (
                            cell
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sec.more && <p className={s.note}>{sec.more}</p>}
          {sec.note && <p className={s.note}>{sec.note}</p>}
        </section>
      ))}
    </div>
  );
}
