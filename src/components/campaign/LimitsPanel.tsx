import { centsText, modeLabel, SAFETY_TOPICS, type CampaignRules } from "@/lib/campaign-shape";
import type { UiLang } from "@/lib/i18n";
import { translator } from "@/lib/i18n";
import { fmtDate } from "@/lib/time";
import s from "./Campaign.module.css";

const DAYS: [string, string][] = [
  ["Dom", "Sun"],
  ["Lun", "Mon"],
  ["Mar", "Tue"],
  ["Mié", "Wed"],
  ["Jue", "Thu"],
  ["Vie", "Fri"],
  ["Sáb", "Sat"],
];

/** Los límites de la campaña en palabras sencillas. */
export function LimitsPanel({
  c,
  rules,
  spentCents,
  lang,
}: {
  c: { mode: string; startsAt: Date; endsAt: Date | null; perWeek: number };
  rules: CampaignRules;
  spentCents: number;
  lang: UiLang;
}) {
  const t = translator(lang);
  const safety = SAFETY_TOPICS.filter((x) => rules.safety[x.id]).map((x) => t(x.es, x.en).toLowerCase());
  const banned = [...safety, ...rules.bannedTopics];
  const order = [1, 2, 3, 4, 5, 6, 0];
  const days = order.filter((d) => rules.weekdays.includes(d)).map((d) => t(...DAYS[d]));
  const needs: Record<string, [string, string]> = { prices: ["precios", "prices"], newChannel: ["canal nuevo", "new channel"], aiImage: ["foto de IA", "AI photo"] };
  const alerts = [
    rules.alerts.onEveryPost && t("cada publicación", "every post"),
    rules.alerts.onLimit && t("límites", "limits"),
    rules.alerts.onError && t("errores", "errors"),
    rules.alerts.onStop && t("paradas", "stops"),
  ].filter(Boolean);
  const rows: [string, string][] = [
    [t("Modo", "Mode"), modeLabel(c.mode, lang)],
    [t("Fechas", "Dates"), `${fmtDate(c.startsAt, lang)} – ${c.endsAt ? fmtDate(c.endsAt, lang) : t("sin fin", "no end")}`],
    [t("Frecuencia", "Frequency"), t(`${c.perWeek} por semana · máx. ${rules.maxPerDay} al día`, `${c.perWeek} a week · max ${rules.maxPerDay} a day`)],
    [t("Días", "Days"), days.join(", ")],
    [t("Horas sin publicar", "No-posting hours"), rules.quietHours ? `${rules.quietHours.from} – ${rules.quietHours.to}` : t("ninguna", "none")],
    [t("Nunca habla de", "Never talks about"), banned.length ? banned.join(", ") : "—"],
    ...(c.mode === "auto" ? ([[t("Te pide permiso si", "Asks you first if"), rules.needsApprovalFor.map((n) => t(...needs[n])).join(", ") || "—"]] as [string, string][]) : []),
    [t("Gasto en fotos y videos con IA", "AI photo & video spend"), `${centsText(spentCents)} ${t("de", "of")} ${centsText(rules.maxAiCostCents)}`],
    [t("Avisos", "Alerts"), alerts.length && rules.alerts.email ? `${rules.alerts.email} (${alerts.join(", ")})` : t("apagados", "off")],
    [t("Se pausa tras", "Pauses after"), t(`${rules.stopOnErrors} errores seguidos`, `${rules.stopOnErrors} errors in a row`)],
  ];
  return (
    <ul className={s.limits}>
      {rows.map(([k, v]) => (
        <li key={k}>
          <span>{k}</span>
          <span>{v}</span>
        </li>
      ))}
    </ul>
  );
}
