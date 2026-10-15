"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { deniedText, hasBusiness } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensure } from "@/lib/ensure";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { BACKLINKS_KIND, readBacklinksReport } from "@/lib/seo/backlinks";
import { dataForSeoEnabled } from "@/lib/seo/dataforseo";
import { costText } from "@/lib/seo/keywords";
import { MENTIONS_KIND, mentionsSummary, runMentions } from "@/lib/seo/mentions";
import { latestReports, saveReport } from "@/lib/seo/reports";

export type MentionsResult = { ok: boolean; message: string } | null;

/** «Buscar quién habla de ti»: páginas que nombran al negocio y cuáles no lo enlazan (DataForSEO, unos centavos). */
export async function findMentions(businessId: string, _prev: MentionsResult, _f: FormData): Promise<MentionsResult> {
  ensure.text(businessId);
  void _prev;
  void _f;
  const { lang, t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  if (!dataForSeoEnabled())
    return { ok: false, message: t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).") };
  const b = await db.business.findUnique({ where: { id: businessId }, select: { name: true, website: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const [linksRow] = await latestReports(businessId, BACKLINKS_KIND, 1);
  const links = linksRow ? readBacklinksReport(linksRow.data) : null;
  try {
    const report = await runMentions({ name: b.name, website: b.website, referring: links ? links.referring.map((r) => r.domain) : null });
    await saveReport(businessId, MENTIONS_KIND, report as unknown as Prisma.InputJsonValue);
    revalidatePath(`/b/${businessId}/seo`);
    const s = mentionsSummary(report.mentions);
    return {
      ok: true,
      message: s.total
        ? t(
            `Listo: ${s.total} páginas hablan de ti${s.unlinked ? `; ${s.unlinked} no te enlazan (pídeles el enlace)` : ""}${s.negative ? `; ${s.negative} hablan mal` : ""}. Costó ${costText(report.cost)}.`,
            `Done: ${s.total} pages talk about you${s.unlinked ? `; ${s.unlinked} don't link to you (ask them for the link)` : ""}${s.negative ? `; ${s.negative} are negative` : ""}. It cost ${costText(report.cost)}.`,
          )
        : t(`No encontramos páginas que nombren a ${report.query}. Costó ${costText(report.cost)}.`, `We didn't find pages that name ${report.query}. It cost ${costText(report.cost)}.`),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
