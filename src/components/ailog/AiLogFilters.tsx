import Link from "next/link";
import type { T, UiLang } from "@/lib/i18n";
import { filterQuery, LOG_TYPES, TYPE_LABEL, type LogFilters } from "@/lib/proposals-log";
import s from "./ailog.module.css";

/** Filtros del registro (formulario GET: funciona sin JavaScript) y el botón para bajar el CSV. */
export function AiLogFilters({ businessId, f, campaigns, lang, t }: { businessId: string; f: LogFilters; campaigns: { id: string; name: string }[]; lang: UiLang; t: T }) {
  const base = `/b/${businessId}/registro`;
  return (
    <form method="get" action={base} className={`card ${s.filters}`} aria-label={t("Filtrar el registro", "Filter the log")}>
      <div className={s.grid}>
        <label className={s.field}>
          <span>{t("Desde", "From")}</span>
          <input type="date" name="desde" defaultValue={f.from} className="field" />
        </label>
        <label className={s.field}>
          <span>{t("Hasta", "To")}</span>
          <input type="date" name="hasta" defaultValue={f.to} className="field" />
        </label>
        <label className={s.field}>
          <span>{t("Campaña", "Campaign")}</span>
          <select name="campana" defaultValue={f.campaign} className="field">
            <option value="">{t("Todas", "All")}</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className={s.field}>
          <span>{t("Tipo", "Type")}</span>
          <select name="tipo" defaultValue={f.type} className="field">
            <option value="">{t("Todo", "Everything")}</option>
            {LOG_TYPES.map((k) => (
              <option key={k} value={k}>
                {TYPE_LABEL[k][lang]}
              </option>
            ))}
          </select>
        </label>
        <label className={s.field}>
          <span>{t("Quién", "Who")}</span>
          <select name="quien" defaultValue={f.who} className="field">
            <option value="todo">{t("Todo", "Everything")}</option>
            <option value="sola">{t("Solo lo que hizo la IA sola", "Only what the AI did on its own")}</option>
            <option value="aprobadas">{t("Solo lo que tú aprobaste", "Only what you approved")}</option>
            <option value="tu">{t("Lo que hiciste tú", "What you did")}</option>
          </select>
        </label>
      </div>
      <div className={s.filterActions}>
        <button type="submit" className="btn solid">
          {t("Ver", "Show")}
        </button>
        <Link href={base} className="btn link">
          {t("Últimos 30 días", "Last 30 days")}
        </Link>
        <a href={`${base}/csv?${filterQuery(f, { lang })}`} className={`btn outline ${s.csv}`} download>
          {t("Descargar CSV", "Download CSV")}
        </a>
      </div>
    </form>
  );
}
