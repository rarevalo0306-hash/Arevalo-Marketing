"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { deniedText, hasBusiness } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensure } from "@/lib/ensure";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { alertRecipients } from "@/lib/seo/alerts";
import { normalizeDomain, readCompetitorsReport, withoutDirectories } from "@/lib/seo/competitors";
import { dataForSeoEnabled } from "@/lib/seo/dataforseo";
import { costText } from "@/lib/seo/keywords";
import { latestReports, saveReport } from "@/lib/seo/reports";
import { WATCH_CONFIG_KIND, type WatchConfig, watchBusiness, watchCostEstimate, watchDomains } from "@/lib/seo/watch";

export type WatchResult = { ok: boolean; message: string } | null;

/**
 * «Qué hizo tu competencia»: con `intent` "save" guarda los competidores y si se revisan solos cada semana; con "run"
 * los guarda y los revisa ahora mismo (DataForSEO, unos centavos por competidor).
 */
export async function watchAction(businessId: string, _prev: WatchResult, f: FormData): Promise<WatchResult> {
  ensure.text(businessId);
  void _prev;
  const { lang, t } = await getT();
  if (!(await hasBusiness(businessId, "publish"))) return { ok: false, message: await deniedText(businessId, "publish") };
  if (!dataForSeoEnabled())
    return { ok: false, message: t("Falta conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).", "DataForSEO isn't connected yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).") };
  const run = f.get("intent") === "run";
  const typed = f
    .getAll("domain")
    .map((v) => (typeof v === "string" ? normalizeDomain(v.trim().slice(0, 200)) : null))
    .filter((d): d is string => !!d);
  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true, seoAlertEmail: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  const [compRow] = await latestReports(businessId, "competitors", 1);
  const comp = compRow ? readCompetitorsReport(compRow.data) : null;
  const enabled = f.get("enabled") === "on";
  const config: WatchConfig = { enabled, domains: watchDomains({ enabled, domains: typed, updatedAt: "" }, [], b.website), updatedAt: new Date().toISOString() };
  const domains = watchDomains(config, comp ? withoutDirectories(comp).report.competitors.map((c) => c.domain) : [], b.website);
  if ((enabled || run) && !domains.length)
    return { ok: false, message: t("Escribe al menos la página de un competidor, o busca primero tu competencia (arriba).", "Type at least one competitor's website, or first look up your competitors (above).") };
  const saved = await saveReport(businessId, WATCH_CONFIG_KIND, config as unknown as Prisma.InputJsonValue);
  await db.seoReport.deleteMany({ where: { businessId, kind: WATCH_CONFIG_KIND, id: { not: saved.id } } });
  if (!run) {
    revalidatePath(`/b/${businessId}/seo`);
    const price = costText(watchCostEstimate(domains.length));
    if (!enabled) return { ok: true, message: t("Listo: ya no se revisa sola. Puedes revisarla a mano cuando quieras.", "Done: it no longer checks by itself. You can check by hand anytime.") };
    const mail = alertRecipients(b.seoAlertEmail).length
      ? t("Te avisamos por email cuando haya algo nuevo.", "We'll email you when there's something new.")
      : t("Para recibir el aviso por email, agrega tu email en Reportes → Alertas.", "To get the email, add your email in Reports → Alerts.");
    return {
      ok: true,
      message: t(
        `Listo: revisaremos a ${domains.join(", ")} cada semana (≈ ${price} por semana). Cada revisión te muestra lo que cambió desde la anterior (la primera de un competidor solo deja la base). ${mail}`,
        `Done: we'll check ${domains.join(", ")} every week (≈ ${price} a week). Each check shows what changed since the last one (a competitor's first check only sets the baseline). ${mail}`,
      ),
    };
  }
  try {
    const { report } = await watchBusiness(businessId, config, false);
    revalidatePath(`/b/${businessId}/seo`);
    const changes = report.competitors.reduce((s, c) => s + c.changes.length, 0);
    const first = report.competitors.every((c) => c.first);
    return {
      ok: true,
      message: first
        ? t(
            `Listo: revisamos ${report.competitors.length} competidores y quedó la base. La próxima revisión te muestra lo que cambió. Costó ${costText(report.cost)}.`,
            `Done: we checked ${report.competitors.length} competitors and saved the baseline. The next check shows what changed. It cost ${costText(report.cost)}.`,
          )
        : changes
          ? t(`Listo: ${changes} ${changes === 1 ? "cambio" : "cambios"} desde la revisión anterior (abajo). Costó ${costText(report.cost)}.`, `Done: ${changes} ${changes === 1 ? "change" : "changes"} since the last check (below). It cost ${costText(report.cost)}.`)
          : t(`Listo: nada importante cambió desde la revisión anterior. Costó ${costText(report.cost)}.`, `Done: nothing important changed since the last check. It cost ${costText(report.cost)}.`),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
