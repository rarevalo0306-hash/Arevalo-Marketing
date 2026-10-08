import Link from "next/link";
import { notFound } from "next/navigation";
import { pauseCampaignAction, resumeCampaignAction, startCampaign, stopCampaignAction, updateCampaign } from "@/app/actions-campaign";
import { PageHead } from "@/components/PageHead";
import { AiLog } from "@/components/campaign/AiLog";
import s from "@/components/campaign/Campaign.module.css";
import { ModeBadge, StatusPill } from "@/components/campaign/CampaignCard";
import { CampaignTimeline } from "@/components/campaign/CampaignTimeline";
import { CampaignWizard } from "@/components/campaign/CampaignWizard";
import { LimitsPanel } from "@/components/campaign/LimitsPanel";
import { StopButton } from "@/components/campaign/StopButton";
import { recentAiActions } from "@/lib/ai-actions";
import { aiSpentCents, rulesOf, wizardContext } from "@/lib/campaign";
import { asMode, campaignSlots, centsText, readEngine, slotCounts, slotKey } from "@/lib/campaign-shape";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { businessDay, businessTzLabel } from "@/lib/time";

// Aprobar publica a su hora; «Guardar y aprobar» puede tardar un poco.
export const maxDuration = 60;

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string; campaignId: string }>; searchParams: Promise<{ nueva?: string }> }) {
  const { id, campaignId } = await params;
  const { nueva } = await searchParams;
  const { lang, t } = await getT();
  const [b, c] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id }, include: { connections: { select: { channel: true } } } }),
    db.campaign.findFirst({ where: { id: campaignId, businessId: id } }),
  ]);
  if (!c) notFound();
  const [posts, log, spent] = await Promise.all([
    db.post.findMany({
      where: { campaignId },
      orderBy: { scheduledAt: "asc" },
      take: 200,
      select: { id: true, text: true, subject: true, variants: true, status: true, source: true, kind: true, mediaUrl: true, mediaType: true, altText: true, scheduledAt: true, targets: { select: { id: true, channel: true, status: true } } },
    }),
    recentAiActions(id, { campaignId, limit: 60 }),
    aiSpentCents(campaignId),
  ]);
  const rules = rulesOf(c, b);
  const engine = readEngine(c.rules);
  const now = new Date();
  const taken = new Set([...engine.handled, ...posts.map((p) => slotKey(p.scheduledAt))]);
  const upcoming = c.status === "active" && c.mode !== "manual" ? campaignSlots(c, rules).filter((d) => d > now && !taken.has(slotKey(d)) && slotCounts(posts, d, c.startsAt, rules.timezone).day < rules.maxPerDay).slice(0, 4) : [];
  const count = (st: string[]) => posts.filter((p) => st.includes(p.status)).length;
  const closed = c.status === "stopped" || c.status === "ended";
  const drafts = count(["draft"]);
  const ctx = wizardContext(b, lang);

  const stats: [number | string, string][] = [
    [count(["done", "partial"]), t("Publicadas", "Published")],
    [count(["scheduled", "publishing"]), t("Programadas", "Scheduled")],
    [drafts, closed ? t("Canceladas (borrador)", "Cancelled (drafts)") : t("Por aprobar", "To approve")],
    [count(["failed"]), t("No se publicaron", "Not posted")],
  ];

  return (
    <>
      <PageHead
        business={b}
        prefix={t("Campañas de", "Campaigns for")}
        section={t("Campañas", "Campaigns")}
        title={c.name}
        subtitle={c.goal || undefined}
        actions={
          <Link href={`/b/${id}/campanas`} className="btn">
            ← {t("Campañas", "Campaigns")}
          </Link>
        }
      />
      <div className="stack" style={{ gap: 16 }}>
        {nueva && (
          <p className="note ok" style={{ margin: 0 }}>
            {c.mode === "manual"
              ? t("Listo: campaña manual creada. Tú creas y publicas desde «Posts»; la IA no hace nada sola.", "Done: manual campaign created. You create and post from “Posts”; the AI does nothing on its own.")
              : c.status === "active"
                ? t(
                    "Listo: la campaña empezó. La IA prepara cada publicación unos 3 días antes y todo queda anotado abajo, en «Lo que hizo la IA».",
                    "Done: the campaign started. The AI prepares each post about 3 days ahead and everything is logged below, in “What the AI did”.",
                  )
                : t("Listo: campaña guardada sin empezar. Empiézala cuando quieras.", "Done: campaign saved without starting. Start it whenever you want.")}
          </p>
        )}

        <div className="card" style={{ gap: 12 }}>
          <div className="row between">
            <div className={s.badges}>
              <ModeBadge mode={c.mode} lang={lang} />
              <StatusPill status={c.status} lang={lang} />
            </div>
            <div className="row">
              {c.status === "active" && (
                <form action={pauseCampaignAction.bind(null, id, c.id)}>
                  <button className="btn" type="submit">{t("Pausar", "Pause")}</button>
                </form>
              )}
              {c.status === "paused" && (
                <form action={resumeCampaignAction.bind(null, id, c.id)}>
                  <button className="btn on" type="submit">{t("Reanudar", "Resume")}</button>
                </form>
              )}
              {c.status === "draft" && (
                <form action={startCampaign.bind(null, id, c.id)}>
                  <button className="btn on" type="submit">{t("Empezar", "Start")}</button>
                </form>
              )}
            </div>
          </div>
          {c.status === "paused" && (
            <p className="note" style={{ margin: 0 }}>
              {t("En pausa: la IA no prepara nada y lo programado quedó en espera. Al reanudar, vuelve a programarse.", "Paused: the AI doesn't prepare anything and the scheduled posts are on hold. When you resume, they're scheduled again.")}
            </p>
          )}
          {closed && (
            <p className="note info" style={{ margin: 0 }}>
              {c.status === "stopped"
                ? t("Campaña parada: la IA ya no hace nada y lo que no salió quedó como borrador (puedes aprobarlo a mano si quieres).", "Campaign stopped: the AI no longer does anything and what didn't go out stayed as a draft (you can approve it by hand if you want).")
                : t("Campaña terminada.", "Campaign finished.")}
            </p>
          )}
          <div className={s.stats}>
            {stats.map(([n, label]) => (
              <div key={label} className={s.stat}>
                <b>{n}</b>
                <span>{label}</span>
              </div>
            ))}
          </div>
          {!closed && (
            <StopButton
              action={stopCampaignAction.bind(null, id, c.id)}
              label={t("Parar campaña", "Stop campaign")}
              question={t(
                "¿Parar esta campaña? La IA deja de publicar y todo lo programado se cancela ahora mismo (los textos quedan como borrador). No se puede reanudar.",
                "Stop this campaign? The AI stops posting and everything scheduled is cancelled right now (the texts stay as drafts). It can't be resumed.",
              )}
            />
          )}
        </div>

        <div className={s.layout}>
          <div className="card">
            <div className="row between">
              <h2>{t("Calendario", "Calendar")}</h2>
              <span className="small muted">{businessTzLabel(lang)}</span>
            </div>
            {drafts > 0 && !closed && (
              <p className="note info" style={{ margin: 0 }}>
                {t(`${drafts} borrador(es) esperan tu aprobación. Nada sale sin que lo apruebes.`, `${drafts} draft(s) are waiting for your approval. Nothing goes out until you approve it.`)}
              </p>
            )}
            <CampaignTimeline posts={posts} upcoming={upcoming} businessId={id} campaignId={c.id} cancelled={closed} lang={lang} />
          </div>
          <div className="stack" style={{ gap: 16 }}>
            <div className="card" style={{ gap: 8 }}>
              <h2>{t("Anuncios pagados", "Paid ads")}</h2>
              <p className="small muted" style={{ margin: 0 }}>
                {c.budgetCents > 0
                  ? t(`Presupuesto: ${centsText(c.budgetCents)} · gastado: ${centsText(c.spentCents)}.`, `Budget: ${centsText(c.budgetCents)} · spent: ${centsText(c.spentCents)}.`)
                  : t("Esta campaña solo publica gratis. Si quieres, agrégale anuncios pagados.", "This campaign only posts for free. If you want, add paid ads to it.")}{" "}
                {t("Al pausar o PARAR la campaña, sus anuncios también se pausan.", "When you pause or STOP the campaign, its ads are paused too.")}
              </p>
              <div>
                <Link className="btn" href={`/b/${id}/anuncios?campana=${c.id}`}>
                  {t("Ver anuncios de la campaña", "See the campaign's ads")}
                </Link>
              </div>
            </div>
            <div className="card">
              <h2>{t("Límites", "Limits")}</h2>
              <LimitsPanel c={c} rules={rules} spentCents={spent} lang={lang} />
              {!closed && (
                <details className={s.edit}>
                  <summary>{t("Editar límites", "Edit limits")}</summary>
                  <div style={{ marginTop: 12 }}>
                    <CampaignWizard
                      editing
                      wasAuto={c.mode === "auto"}
                      action={updateCampaign.bind(null, id, c.id)}
                      channels={ctx.channels.map((x) => ({ ...x, connected: x.connected || c.channels.includes(x.id) }))}
                      connectHref={`/b/${id}/conexiones`}
                      suggestions={[]}
                      services={ctx.services}
                      businessKeywords={ctx.businessKeywords}
                      imageCents={ctx.imageCents}
                      today={businessDay(now)}
                      tzLabel={businessTzLabel(lang)}
                      initial={{
                        name: c.name,
                        goal: c.goal,
                        mode: asMode(c.mode),
                        channels: c.channels,
                        startDate: businessDay(c.startsAt),
                        endDate: c.endsAt ? businessDay(c.endsAt) : businessDay(new Date(c.startsAt.getTime() + 28 * 86400000)),
                        perWeek: c.perWeek,
                        keywords: c.keywords.join(", "),
                        rules,
                      }}
                    />
                  </div>
                </details>
              )}
            </div>
            <div className="card">
              <h2>{t("Lo que hizo la IA", "What the AI did")}</h2>
              <AiLog rows={log} lang={lang} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
