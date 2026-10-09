import Link from "next/link";
import { stopAllAction } from "@/app/actions-campaign";
import { PageHead } from "@/components/PageHead";
import { CampaignCard } from "@/components/campaign/CampaignCard";
import s from "@/components/campaign/Campaign.module.css";
import { StopButton } from "@/components/campaign/StopButton";
import { loadCampaigns } from "@/lib/campaign";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";

export default async function CampaignsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lang, t } = await getT();
  const [b, list] = await Promise.all([db.business.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, color: true } }), loadCampaigns(id)]);
  const running = list.filter((c) => c.status === "active" || c.status === "paused" || c.status === "draft");
  const active = list.filter((c) => c.status === "active");

  return (
    <>
      <PageHead
        business={b}
        prefix={t("Campañas de", "Campaigns for")}
        section={t("Campañas", "Campaigns")}
        title={t("Campañas", "Campaigns")}
        subtitle={t(
          "Un objetivo, unas fechas y unos canales. Tú eliges: lo haces tú, la IA prepara y tú apruebas, o la IA publica sola dentro de tus límites.",
          "A goal, some dates and some channels. You choose: you do it, the AI prepares and you approve, or the AI posts on its own within your limits.",
        )}
        actions={
          <Link href={`/b/${id}/campanas/nueva`} className="btn on">
            + {t("Nueva campaña", "New campaign")}
          </Link>
        }
      />
      <div className="stack" style={{ gap: 16 }}>
        {running.length > 0 && (
          <div className="card" style={{ gap: 10 }}>
            <div className="row between">
              <div className="stack" style={{ gap: 2 }}>
                <strong>
                  {t(`${active.length} campaña(s) activa(s)`, `${active.length} active campaign(s)`)}
                  {running.length > active.length ? t(` · ${running.length - active.length} en pausa o sin empezar`, ` · ${running.length - active.length} paused or not started`) : ""}
                </strong>
                <span className="small muted">{t("Si algo no te gusta, para todo con un clic.", "If something looks wrong, stop everything with one click.")}</span>
              </div>
              <StopButton
                big
                action={stopAllAction.bind(null, id)}
                label={t("Parar todo", "Stop everything")}
                question={t(
                  `¿Parar TODAS las campañas (${running.length})? La IA deja de publicar y se cancela todo lo programado de estas campañas. Los textos quedan guardados como borrador.`,
                  `Stop ALL campaigns (${running.length})? The AI stops posting and everything scheduled for these campaigns is cancelled. The texts stay saved as drafts.`,
                )}
              />
            </div>
          </div>
        )}
        {list.length === 0 ? (
          <div className={`card ${s.empty}`}>
            <h2>{t("Todavía no tienes campañas", "You don't have any campaigns yet")}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {t(
                "Crea una en 6 pasos: el objetivo, cómo quieres trabajar con la IA, los canales, las fechas y los límites que nunca puede pasar.",
                "Create one in 6 steps: the goal, how you want to work with the AI, the channels, the dates and the limits it can never cross.",
              )}
            </p>
            <div>
              <Link href={`/b/${id}/campanas/nueva`} className="btn on">
                + {t("Nueva campaña", "New campaign")}
              </Link>
            </div>
          </div>
        ) : (
          <div className={s.grid}>
            {list.map((c) => (
              <CampaignCard key={c.id} c={c} businessId={id} lang={lang} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
