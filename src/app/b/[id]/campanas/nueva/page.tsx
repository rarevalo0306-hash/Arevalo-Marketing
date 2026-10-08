import Link from "next/link";
import { createCampaign } from "@/app/actions-campaign";
import { PageHead } from "@/components/PageHead";
import { CampaignWizard } from "@/components/campaign/CampaignWizard";
import { wizardContext } from "@/lib/campaign";
import { addDays, defaultRules } from "@/lib/campaign-shape";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { businessDay, businessTzLabel } from "@/lib/time";

export default async function NewCampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ goal?: string }> }) {
  const { id } = await params;
  const { goal } = await searchParams;
  const { lang, t } = await getT();
  const b = await db.business.findUniqueOrThrow({ where: { id }, include: { connections: { select: { channel: true } } } });
  const ctx = wizardContext(b, lang);
  const today = businessDay(new Date());
  const connected = ctx.channels.filter((c) => c.connected).map((c) => c.id);

  return (
    <>
      <PageHead
        business={b}
        prefix={t("Campañas de", "Campaigns for")}
        section={t("Campañas", "Campaigns")}
        title={t("Nueva campaña", "New campaign")}
        subtitle={t("6 pasos cortos. Al final ves exactamente lo que la IA puede hacer y lo que nunca hará.", "6 short steps. At the end you see exactly what the AI may do and what it will never do.")}
        actions={
          <Link href={`/b/${id}/campanas`} className="btn">
            ← {t("Campañas", "Campaigns")}
          </Link>
        }
      />
      <CampaignWizard
        action={createCampaign.bind(null, id)}
        channels={ctx.channels}
        connectHref={`/b/${id}/conexiones`}
        suggestions={ctx.suggestions}
        services={ctx.services}
        businessKeywords={ctx.businessKeywords}
        imageCents={ctx.imageCents}
        today={today}
        tzLabel={businessTzLabel(lang)}
        initial={{
          name: "",
          goal: (goal ?? "").slice(0, 1000),
          mode: "approval",
          channels: connected,
          startDate: today,
          endDate: addDays(today, 28),
          perWeek: 3,
          keywords: "",
          rules: defaultRules({ email: b.ownerEmail, lang: b.seoLanguage, competitors: ctx.competitors }),
        }}
      />
    </>
  );
}
