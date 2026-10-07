"use server";

import { revalidatePath } from "next/cache";
import { runRankCheck } from "@/app/actions-seo-rank";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled } from "@/lib/seo/dataforseo";
import { keywordReport } from "@/lib/seo/keywords";
import { applySettingsForm, buildProposal, rememberChoices, rememberVolumes, setupState } from "@/lib/seo/setup";
import { normKeyword, type SetupProposal } from "@/lib/seo/setup-shared";

export type ProposalResult = { ok: true; proposal: SetupProposal; rejected: string[] } | { ok: false; error: string };

/** Prepara (o lee la guardada) la propuesta de zonas, idioma y palabras clave del negocio. Usa la IA, no DataForSEO. */
export async function proposeSeoSetup(businessId: string, force = false): Promise<ProposalResult> {
  const { lang } = await getT();
  try {
    const proposal = await buildProposal(businessId, { force });
    const { rejected } = await setupState(businessId);
    return { ok: true, proposal, rejected };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

export type MeasureResult = { ok: true; volumes: Record<string, number | null>; cost: number } | { ok: false; error: string };

/** Pregunta a Google Ads cuántas personas buscan cada palabra al mes en una zona (1 llamada, unos US$0.075). */
export async function measureSeoKeywords(businessId: string, keywords: string[], zone: { code: number; name: string }, language: "es" | "en"): Promise<MeasureResult> {
  const { lang, t } = await getT();
  if (!dataForSeoEnabled()) return { ok: false, error: t("Falta conectar DataForSEO.", "DataForSEO isn't connected yet.") };
  const list = [...new Set(keywords.map(normKeyword).filter(Boolean))].slice(0, 40);
  if (!list.length || !Number.isInteger(zone.code) || zone.code <= 0) return { ok: false, error: t("Elige al menos una zona y una palabra.", "Pick at least one area and one keyword.") };
  const exists = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!exists) return { ok: false, error: t("Negocio no encontrado", "Business not found") };
  try {
    const report = await keywordReport({ keywords: list, seeds: [], locationCode: zone.code, locationName: zone.name, language: language === "en" ? "en" : "es", ideas: false });
    const volumes = new Map(report.keywords.map((r) => [normKeyword(r.keyword), r.volume]));
    await rememberVolumes(businessId, volumes, zone.name);
    return { ok: true, volumes: Object.fromEntries(volumes), cost: report.cost };
  } catch (e) {
    return { ok: false, error: errorText(e, lang) };
  }
}

/** Recuerda las palabras que el dueño quitó, para no volver a sugerirlas. */
export async function rejectSeoKeywords(businessId: string, keywords: string[]): Promise<void> {
  const exists = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (exists) await rememberChoices(businessId, keywords.slice(0, 50), []);
}

export type AcceptResult = { ok: boolean; message: string; checked?: boolean } | null;

/**
 * "Aceptar todo y empezar": guarda las zonas, el idioma, las palabras y la frecuencia elegidas, y hace la primera
 * revisión de posiciones (si se pidió). Si la revisión falla, lo elegido igual queda guardado.
 */
export async function acceptSeoSetup(businessId: string, _prev: AcceptResult, f: FormData): Promise<AcceptResult> {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true, website: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado", "Business not found") };
  try {
    const { zones, keywords } = await applySettingsForm(businessId, f);
    revalidatePath(`/b/${businessId}/seo`);
    const saved = t(
      `Guardamos ${zones.length} ${zones.length === 1 ? "zona" : "zonas"} y ${keywords.length} palabras clave.`,
      `We saved ${zones.length} ${zones.length === 1 ? "area" : "areas"} and ${keywords.length} keywords.`,
    );
    if (f.get("check") !== "on" || !zones.length || !keywords.length) return { ok: true, message: saved, checked: false };
    if (!b.website)
      return { ok: true, message: `${saved} ${t("Para revisar tus posiciones falta la dirección de tu página web (Ajustes del negocio).", "To check your rankings, add your website address (Business settings).")}`, checked: false };
    const r = await runRankCheck(businessId, null, new FormData());
    return { ok: Boolean(r?.ok), message: `${saved} ${r?.message ?? ""}`.trim(), checked: Boolean(r?.ok) };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
