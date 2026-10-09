// Historial de los reportes por email (los diarios y los pedidos a mano), con su estado.
import Link from "next/link";
import type { DailyHistoryItem } from "@/lib/daily-report";
import { fmtDateTime } from "@/lib/time";
import s from "./reports.module.css";

type Lang = "es" | "en";

const dayText = (from: string, to: string, lang: Lang) => {
  const loc = lang === "en" ? "en-US" : "es";
  const noon = (d: string) => new Date(`${d}T12:00:00Z`);
  if (!from) return "—";
  if (from === to || !to) return new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(noon(from));
  return new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).formatRange(noon(from), noon(to));
};

export function DailyHistory({ items, base, lang, tz }: { items: DailyHistoryItem[]; base: string; lang: Lang; tz: string }) {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  if (!items.length)
    return <p className="small muted">{t("Todavía no se ha mandado ningún reporte. El primero sale después de la próxima medianoche.", "No report has been sent yet. The first one goes out after the next midnight.")}</p>;
  const pill = (i: DailyHistoryItem) =>
    i.shown === "sent"
      ? { cls: "good", text: t("Enviado", "Sent") }
      : i.shown === "skipped"
        ? { cls: "neutral", text: t("Sin email (día tranquilo)", "No email (quiet day)") }
        : i.shown === "sending"
          ? { cls: "info", text: t("Enviando…", "Sending…") }
          : i.shown === "stuck"
            ? { cls: "warn", text: t("Se cortó", "Interrupted") }
            : { cls: "bad", text: t("No se pudo enviar", "Couldn't send") };
  const kind = (i: DailyHistoryItem) => (i.trigger === "range" ? t("A pedido", "On demand") : i.trigger === "manual" ? t("Prueba", "Test") : t("Diario", "Daily"));
  return (
    <ul className={s.history}>
      {items.map((i) => {
        const p = pill(i);
        const n = i.counts;
        const facts = n
          ? [
              n.sent ? t(`${n.sent} publicadas`, `${n.sent} posted`) : "",
              n.failed ? t(`${n.failed} con error`, `${n.failed} failed`) : "",
              n.ai ? t(`${n.ai} de la IA`, `${n.ai} by the AI`) : "",
              n.reviews ? t(`${n.reviews} reseñas`, `${n.reviews} reviews`) : "",
            ].filter(Boolean)
          : [];
        return (
          <li key={i.id} className={s.historyItem}>
            <div className={s.historyTop}>
              <Link className={s.historyDay} href={`${base}?desde=${i.fromDay}&hasta=${i.toDay}`} scroll={false}>
                {dayText(i.fromDay, i.toDay, lang)}
              </Link>
              <span className={`pill ${p.cls}`}>{p.text}</span>
              <span className="pill plain neutral">{kind(i)}</span>
            </div>
            <span className={s.historyMeta}>
              {[
                i.sentAt ? t(`Salió ${fmtDateTime(i.sentAt, "es", tz)}`, `Sent ${fmtDateTime(i.sentAt, "en", tz)}`) : fmtDateTime(i.createdAt, lang, tz),
                i.to.length ? t(`a ${i.to.join(", ")}`, `to ${i.to.join(", ")}`) : "",
                facts.join(" · "),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {(i.shown === "error" || i.shown === "stuck") && (
              <span className={s.historyError}>
                {i.shown === "stuck"
                  ? t("Se cortó mientras se enviaba: puede que haya llegado. No se vuelve a mandar solo para no repetirlo.", "It was interrupted while sending: it may have arrived. It isn't resent automatically so it doesn't repeat.")
                  : i.error}
                {i.shown === "error" && i.retry && i.attempts < 3 ? t(" Se vuelve a intentar solo en unos minutos.", " It will retry on its own in a few minutes.") : ""}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
