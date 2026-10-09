import Link from "next/link";
import type { T, UiLang } from "@/lib/i18n";
import { ACTOR_LABEL, summaryText, TYPE_LABEL, typeOfKind, type LogType } from "@/lib/proposals-log";
import { businessDay, fmtTime } from "@/lib/time";
import s from "./ailog.module.css";

export type LogItem = {
  id: string;
  createdAt: Date;
  kind: string;
  actor: string;
  costCents: number;
  summary: unknown;
  detail: unknown;
  postId: string | null;
  campaignId: string | null;
  campaignName: string;
};

const TYPE_CLASS: Record<LogType, string> = { publicaciones: "info", anuncios: "warn", disenos: "draft", fotos: "draft", propuestas: "good", alertas: "bad" };
const ACTOR_CLASS: Record<string, string> = { auto: s.actorAuto, approved: s.actorApproved, owner: s.actorOwner };

export const money = (cents: number) => `US$${(Math.max(0, cents) / 100).toFixed(2)}`;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Enlaces a lo relacionado: la publicación, la campaña, el anuncio o la propuesta. */
function links(it: LogItem, businessId: string, t: T): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  const d = obj(it.detail);
  if (it.postId) out.push({ href: it.campaignId ? `/b/${businessId}/campanas/${it.campaignId}` : `/b/${businessId}/historial`, label: t("Ver la publicación", "See the post") });
  if (it.kind.startsWith("ad.") || typeof d.adId === "string") out.push({ href: `/b/${businessId}/anuncios`, label: t("Ver el anuncio", "See the ad") });
  if (typeof d.proposalId === "string") out.push({ href: `/b/${businessId}/propuestas?ver=aplicadas#p-${d.proposalId}`, label: t("Ver la propuesta", "See the proposal") });
  if (it.kind === "proposal.run") out.push({ href: `/b/${businessId}/propuestas`, label: t("Ver las propuestas", "See the proposals") });
  if (it.campaignId && it.campaignName && !it.postId) out.push({ href: `/b/${businessId}/campanas/${it.campaignId}`, label: t(`Campaña «${it.campaignName}»`, `Campaign “${it.campaignName}”`) });
  return out;
}

/** El registro agrupado por día (en la zona del negocio), lo más nuevo arriba. */
export function AiLogTimeline({ items, businessId, lang, t, tz }: { items: LogItem[]; businessId: string; lang: UiLang; t: T; tz: string }) {
  const days = new Map<string, LogItem[]>();
  for (const it of items) {
    const d = businessDay(it.createdAt, tz);
    days.set(d, [...(days.get(d) ?? []), it]);
  }
  const dayTitle = (d: string) =>
    new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-US", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  return (
    <ol className={s.days}>
      {[...days].map(([d, list]) => {
        const cost = list.reduce((sum, x) => sum + x.costCents, 0);
        return (
          <li key={d} className={s.day}>
            <h2 className={s.dayHead}>
              <span className={s.dayName}>{dayTitle(d)}</span>
              <span className={s.dayMeta}>
                {list.length} {list.length === 1 ? t("acción", "action") : t("acciones", "actions")}
                {cost > 0 && ` · ${money(cost)}`}
              </span>
            </h2>
            <ul className={s.items}>
              {list.map((it) => {
                const type = typeOfKind(it.kind);
                const actor = ACTOR_LABEL[it.actor] ?? ACTOR_LABEL.auto;
                return (
                  <li key={it.id} className={s.item}>
                    <time className={s.time} dateTime={it.createdAt.toISOString()}>
                      {fmtTime(it.createdAt, lang, tz)}
                    </time>
                    <div className={s.body}>
                      <div className={s.tags}>
                        {type && <span className={`pill ${TYPE_CLASS[type]}`}>{TYPE_LABEL[type][lang]}</span>}
                        <span className={`${s.actor} ${ACTOR_CLASS[it.actor] ?? s.actorAuto}`}>{actor[lang]}</span>
                        {it.costCents > 0 && <span className={s.cost}>{money(it.costCents)}</span>}
                      </div>
                      <p className={s.summary}>{summaryText(it.summary, lang)}</p>
                      {links(it, businessId, t).length > 0 && (
                        <p className={s.links}>
                          {links(it, businessId, t).map((l) => (
                            <Link key={l.href + l.label} href={l.href}>
                              {l.label} →
                            </Link>
                          ))}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
