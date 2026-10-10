import Link from "next/link";
import type { AiProposal, Prisma } from "@prisma/client";
import { PageHead } from "@/components/PageHead";
import { AutoApplyToggle } from "@/components/proposals/AutoApplyToggle";
import { ProposalCard, type ProposalCardView } from "@/components/proposals/ProposalCard";
import s from "@/components/proposals/proposals.module.css";
import { SearchNow } from "@/components/proposals/SearchNow";
import { readRules } from "@/lib/campaign-shape";
import { db } from "@/lib/db";
import type { T, UiLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { expireProposals } from "@/lib/proposals";
import {
  asKind,
  canUndo,
  daysLeft,
  IMPACT_LABEL,
  impactOf,
  isClosed,
  KIND_LABEL,
  PROPOSALS_AI_CENTS,
  readAction,
  readDetail,
  readEvidence,
  readTitle,
  sideText,
  tzOf,
  UNDO_HOURS,
} from "@/lib/proposals-shape";
import { fmtDate, fmtWhen } from "@/lib/time";

type Filter = "nuevas" | "aplicadas" | "rechazadas";
const FILTERS: Filter[] = ["nuevas", "aplicadas", "rechazadas"];
const STATUSES: Record<Filter, string[]> = { nuevas: ["proposed"], aplicadas: ["applied", "accepted"], rechazadas: ["rejected", "expired"] };

const where = (businessId: string, f: Filter): Prisma.AiProposalWhereInput => ({ businessId, status: { in: STATUSES[f] } });

const dayText = (d: string, lang: UiLang, tz: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? fmtDate(new Date(`${d}T12:00:00Z`), lang, tz) : "");

function cardView(p: AiProposal, ctx: { lang: UiLang; t: T; tz: string; now: Date; businessId: string; campaigns: Map<string, string>; highlight: string }): ProposalCardView {
  const { lang, t, tz, now } = ctx;
  const title = readTitle(p.title);
  const detail = readDetail(p.detail);
  const ev = readEvidence(p.evidence);
  const action = readAction(p.action);
  const applied = action?.applied;
  const kind = asKind(p.kind);
  const impact = impactOf(p.impact);
  const L = (b: { es: string; en: string }) => (lang === "en" ? b.en : b.es);
  // Lo que cambió de verdad (si ya se aplicó un cambio de campaña) o lo que se propone.
  const change = ev.change.map((c) => ({ label: L(c.label), before: sideText(c.before, lang), after: sideText(c.after, lang) }));
  const campaignName = p.campaignId ? ctx.campaigns.get(p.campaignId) : undefined;
  const when = (d: Date) => fmtWhen(d, lang, now, tz);
  let statusLine = "";
  if (p.status === "proposed") {
    const left = daysLeft(p.createdAt, now);
    statusLine = t(`Propuesta ${when(p.createdAt)} · vence en ${left} ${left === 1 ? "día" : "días"}`, `Proposed ${when(p.createdAt)} · expires in ${left} ${left === 1 ? "day" : "days"}`);
  } else if (p.status === "applied")
    statusLine =
      applied?.actor === "auto"
        ? t(`La IA la aplicó sola ${when(p.appliedAt ?? p.createdAt)} (bajo riesgo)`, `The AI applied it on its own ${when(p.appliedAt ?? p.createdAt)} (low risk)`)
        : t(`Aplicada ${when(p.appliedAt ?? p.createdAt)} con tu aprobación`, `Applied ${when(p.appliedAt ?? p.createdAt)} with your approval`);
  else if (p.status === "accepted") statusLine = t(`Aceptaste el consejo ${when(p.decidedAt ?? p.createdAt)}`, `You accepted the tip ${when(p.decidedAt ?? p.createdAt)}`);
  else if (p.status === "expired") statusLine = t(`Venció sin decidir ${when(p.decidedAt ?? p.createdAt)}`, `Expired without a decision ${when(p.decidedAt ?? p.createdAt)}`);
  else statusLine = applied?.undoneAt ? t(`La deshiciste ${when(new Date(applied.undoneAt))}`, `You undid it ${when(new Date(applied.undoneAt))}`) : t(`La rechazaste ${when(p.decidedAt ?? p.createdAt)}`, `You rejected it ${when(p.decidedAt ?? p.createdAt)}`);
  const undoable = canUndo({ status: p.status, action }, now);
  const undoUntil = applied ? new Date(Date.parse(applied.at) + UNDO_HOURS * 3_600_000) : null;
  const link =
    kind === "ads-budget" && !action
      ? { href: `/b/${ctx.businessId}/anuncios`, label: t("Ir a Anuncios", "Go to Ads") }
      : kind === "ads-pause" && p.status === "applied"
        ? { href: `/b/${ctx.businessId}/anuncios`, label: t("Ver en Anuncios (ahí lo enciendes si quieres)", "See it in Ads (turn it on there if you want)") }
        : action?.type === "post.draft" && p.status === "applied" && p.campaignId
          ? { href: `/b/${ctx.businessId}/campanas/${p.campaignId}`, label: t("Ver el borrador en la campaña", "See the draft in the campaign") }
          : action?.type === "keyword.track" && p.status === "applied"
            ? { href: `/b/${ctx.businessId}/seo`, label: t("Ver en SEO", "See it in SEO") }
            : p.campaignId && campaignName
              ? { href: `/b/${ctx.businessId}/campanas/${p.campaignId}`, label: t(`Campaña «${campaignName}»`, `Campaign “${campaignName}”`) }
              : null;
  const reason = detail.rejectReason && detail.rejectReason !== "undone" ? t(`Motivo: ${detail.rejectReason}`, `Reason: ${detail.rejectReason}`) : "";
  const from = dayText(ev.period.from, lang, tz);
  const to = dayText(ev.period.to, lang, tz);
  return {
    id: p.id,
    businessId: ctx.businessId,
    campaignId: p.campaignId ?? "",
    kindLabel: L(KIND_LABEL[kind]),
    impact,
    impactLabel: L(IMPACT_LABEL[impact]),
    title: L(title),
    detail: L(detail),
    facts: ev.facts.map((f) => ({ label: L(f.label), value: sideText(f.value, lang) })),
    period: from && to ? t(`Datos del ${from} al ${to}`, `Data from ${from} to ${to}`) : "",
    source: L(ev.source),
    change,
    status: p.status,
    statusLine,
    advice: !action,
    link,
    canUndo: undoable,
    undoLine: undoable && undoUntil ? t(`Puedes deshacer hasta ${fmtWhen(undoUntil, "es", now, tz)}`, `You can undo until ${fmtWhen(undoUntil, "en", now, tz)}`) : "",
    highlight: ctx.highlight,
    rejectReason: reason,
  };
}

export default async function PropuestasPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ver?: string; hecho?: string; que?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const filter: Filter = FILTERS.includes(q.ver as Filter) ? (q.ver as Filter) : "nuevas";
  const { lang, t } = await getT();
  const now = new Date();
  await expireProposals(now, id).catch(() => 0);
  const b = await db.business.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, color: true, timezone: true } });
  const tz = tzOf(b);
  const [rows, counts, campaigns, lastRun] = await Promise.all([
    db.aiProposal.findMany({ where: where(id, filter), orderBy: filter === "nuevas" ? [{ impact: "desc" }, { createdAt: "desc" }] : [{ decidedAt: "desc" }, { createdAt: "desc" }], take: 60 }),
    Promise.all(FILTERS.map((f) => db.aiProposal.count({ where: where(id, f) }))),
    db.campaign.findMany({ where: { businessId: id }, select: { id: true, name: true, mode: true, status: true, rules: true }, orderBy: { createdAt: "desc" } }),
    db.seoReport.findFirst({ where: { businessId: id, kind: "proposals" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const names = new Map(campaigns.map((c) => [c.id, c.name]));
  const hecho = typeof q.hecho === "string" ? q.hecho : "";
  const doneText: Record<string, string> = {
    aceptada: t("Listo: se aplicó. Si cambias de idea, puedes deshacerlo durante 24 horas.", "Done: it's applied. If you change your mind, you can undo it for 24 hours."),
    rechazada: t("Rechazada. La IA no volverá a proponer esto en un mes.", "Rejected. The AI won't propose this again for a month."),
    deshecha: t("Listo: quedó como estaba antes.", "Done: it's back to how it was."),
  };
  const flash = hecho && q.que ? (doneText[q.que] ?? "") : "";
  const views = rows.map((p) => cardView(p, { lang, t, tz, now, businessId: id, campaigns: names, highlight: p.id === hecho ? flash : "" }));
  const autoCampaigns = campaigns.filter((c) => c.mode === "auto" && !isClosed(c.status));
  const label: Record<Filter, string> = { nuevas: t("Nuevas", "New"), aplicadas: t("Aplicadas", "Applied"), rechazadas: t("Rechazadas", "Rejected") };
  const cost = `US$${(PROPOSALS_AI_CENTS / 100).toFixed(2)}`;
  const flashOutside = flash && !views.some((v) => v.highlight);

  return (
    <>
      <PageHead
        business={b}
        prefix={t("Propuestas de", "Proposals for")}
        section={t("Propuestas", "Proposals")}
        title={t("Propuestas de la IA", "AI proposals")}
        subtitle={t(
          "La IA revisa tus resultados cada semana y te propone mejoras: horarios, formatos, canales, anuncios y palabras clave. Nada cambia hasta que tú lo aceptas.",
          "The AI reviews your results every week and proposes improvements: times, formats, channels, ads and keywords. Nothing changes until you accept it.",
        )}
        aside={<SearchNow businessId={id} costText={t(`Usa la IA: cuesta unos ${cost} cada vez.`, `Uses the AI: about ${cost} each time.`)} />}
      />

      {flashOutside && (
        <p className={`note ok ${s.topNote}`} role="status">
          {flash}
        </p>
      )}

      <nav className={`tabs ${s.filters}`} aria-label={t("Filtrar propuestas", "Filter proposals")}>
        {FILTERS.map((f, i) => (
          <Link key={f} href={f === "nuevas" ? `/b/${id}/propuestas` : `/b/${id}/propuestas?ver=${f}`} className={`tab ${s.filter} ${filter === f ? "on" : ""}`} aria-current={filter === f ? "page" : undefined} scroll={false}>
            {label[f]} <span className={s.count}>{counts[i]}</span>
          </Link>
        ))}
      </nav>

      {lastRun && (
        <p className={s.lastRun}>
          {t(`Última revisión: ${fmtWhen(lastRun.createdAt, "es", now, tz)}`, `Last review: ${fmtWhen(lastRun.createdAt, "en", now, tz)}`)} ·{" "}
          <Link href={`/b/${id}/registro?tipo=propuestas`}>{t("Ver lo que hizo la IA", "See what the AI did")}</Link>
        </p>
      )}

      {views.length === 0 ? (
        <div className={`card empty ${s.empty}`}>
          {filter === "nuevas" ? (
            <>
              <strong>{t("No hay propuestas nuevas por ahora.", "No new proposals for now.")}</strong>
              <span>
                {t(
                  "La IA necesita resultados de varias publicaciones (o de tus anuncios y de Google) para proponer algo seguro. Revisa otra vez la próxima semana o presiona «Buscar mejoras ahora».",
                  "The AI needs results from several posts (or from your ads and Google) to propose something reliable. Check again next week or press “Look for improvements now”.",
                )}
              </span>
            </>
          ) : filter === "aplicadas" ? (
            t("Todavía no has aplicado ninguna propuesta.", "You haven't applied any proposal yet.")
          ) : (
            t("No hay propuestas rechazadas.", "No rejected proposals.")
          )}
        </div>
      ) : (
        <div className={s.list}>
          {views.map((v) => (
            <ProposalCard key={v.id} v={v} />
          ))}
        </div>
      )}

      {autoCampaigns.length > 0 && (
        <section className={`card ${s.auto}`} aria-labelledby="auto-h">
          <h2 id="auto-h">{t("Que la IA aplique sola lo de bajo riesgo", "Let the AI apply low-risk changes on its own")}</h2>
          <p className="muted small" style={{ margin: 0 }}>
            {t(
              "Solo en campañas 100% IA. La IA podrá cambiar sola los horarios y el reparto de formatos cuando los números lo indiquen; todo lo demás (anuncios, canales, palabras clave) siempre te lo pregunta. Puedes deshacer cada cambio durante 24 horas.",
              "Only in 100% AI campaigns. The AI will be able to change posting times and the format mix on its own when the numbers say so; everything else (ads, channels, keywords) it always asks you. You can undo each change for 24 hours.",
            )}
          </p>
          <div>
            {autoCampaigns.map((c) => (
              <AutoApplyToggle key={c.id} businessId={id} campaignId={c.id} name={c.name} on={readRules(c.rules).autoApplyProposals === true} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
