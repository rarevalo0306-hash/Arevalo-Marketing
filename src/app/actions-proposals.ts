"use server";

// Acciones de «Propuestas de la IA»: aceptar (aplica el cambio), rechazar, deshacer (24 horas), «Buscar mejoras ahora»
// y el permiso «La IA puede aplicar sola las propuestas de bajo riesgo» de cada campaña 100% IA.

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAiAction } from "@/lib/ai-actions";
import { readEngine, readRules, rulesJson } from "@/lib/campaign-shape";
import { db } from "@/lib/db";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { acceptProposal, proposeNow, rejectProposal, undoProposal } from "@/lib/proposals";
import { isClosed } from "@/lib/proposals-shape";

export type ProposalActionState = { ok: boolean; message: string } | null;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function refresh(businessId: string, campaignId?: string) {
  revalidatePath(`/b/${businessId}/propuestas`);
  revalidatePath(`/b/${businessId}/registro`);
  revalidatePath(`/b/${businessId}/inicio`);
  revalidatePath(`/b/${businessId}/campanas`);
  if (campaignId) revalidatePath(`/b/${businessId}/campanas/${campaignId}`);
}

type Done = "aceptada" | "rechazada" | "deshecha";
const AFTER: Record<Done, string> = { aceptada: "aplicadas", rechazada: "nuevas", deshecha: "rechazadas" };

/** Hace la acción; si sale bien, vuelve a la lista donde quedó la propuesta (con un aviso), si no, devuelve el motivo. */
async function run(f: FormData, done: Done, fn: (businessId: string, id: string) => Promise<{ ok: boolean; message: { es: string; en: string } }>): Promise<ProposalActionState> {
  const { lang } = await getT();
  const businessId = str(f, "businessId");
  const id = str(f, "proposalId");
  let ok = false;
  try {
    const r = await fn(businessId, id);
    refresh(businessId, str(f, "campaignId") || undefined);
    if (!r.ok) return { ok: false, message: lang === "en" ? r.message.en : r.message.es };
    ok = true;
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
  if (ok) redirect(`/b/${businessId}/propuestas?ver=${AFTER[done]}&hecho=${encodeURIComponent(id)}&que=${done}`);
  return null;
}

export async function acceptProposalAction(_prev: ProposalActionState, f: FormData): Promise<ProposalActionState> {
  return run(f, "aceptada", (businessId, id) => acceptProposal(id, { businessId, actor: "approved" }));
}

export async function rejectProposalAction(_prev: ProposalActionState, f: FormData): Promise<ProposalActionState> {
  return run(f, "rechazada", (businessId, id) => rejectProposal(id, str(f, "reason"), { businessId }));
}

export async function undoProposalAction(_prev: ProposalActionState, f: FormData): Promise<ProposalActionState> {
  return run(f, "deshecha", (businessId, id) => undoProposal(id, { businessId }));
}

/** «Buscar mejoras ahora». */
export async function proposeNowAction(_prev: ProposalActionState, f: FormData): Promise<ProposalActionState> {
  const { lang, t } = await getT();
  const businessId = str(f, "businessId");
  try {
    const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true } });
    if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
    const r = await proposeNow(businessId);
    refresh(businessId);
    if (r.tooSoon) return { ok: true, message: t("Ya se buscaron mejoras hace un momento. Prueba otra vez en unos minutos.", "Improvements were just checked. Try again in a few minutes.") };
    const cost = r.costCents ? t(` La IA costó US$${(r.costCents / 100).toFixed(2)}.`, ` The AI cost US$${(r.costCents / 100).toFixed(2)}.`) : "";
    const ai = r.aiError
      ? t(" La IA no respondió, así que se usaron solo las reglas fijas (sin costo).", " The AI didn't answer, so only the fixed rules were used (no cost).")
      : "";
    const auto = r.autoApplied ? t(` ${r.autoApplied} se aplicaron solas (bajo riesgo).`, ` ${r.autoApplied} were applied on their own (low risk).`) : "";
    const head = r.created
      ? t(`Listo: ${r.created} ${r.created === 1 ? "propuesta nueva" : "propuestas nuevas"}.`, `Done: ${r.created} new ${r.created === 1 ? "proposal" : "proposals"}.`)
      : t("Listo: por ahora no hay mejoras nuevas. Hacen falta más resultados para encontrar algo seguro.", "Done: no new improvements for now. More results are needed to find something reliable.");
    return { ok: true, message: `${head}${auto}${cost}${ai}` };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** Enciende o apaga «La IA puede aplicar sola las propuestas de bajo riesgo» en una campaña 100% IA. */
export async function setAutoApplyAction(_prev: ProposalActionState, f: FormData): Promise<ProposalActionState> {
  const { t } = await getT();
  const businessId = str(f, "businessId");
  const campaignId = str(f, "campaignId");
  const on = str(f, "on") === "1";
  const res = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${campaignId} FOR UPDATE`;
    const c = await tx.campaign.findFirst({ where: { id: campaignId, businessId }, select: { id: true, name: true, mode: true, status: true, rules: true } });
    if (!c) return { ok: false, message: t("Campaña no encontrada.", "Campaign not found.") };
    if (c.mode !== "auto") return { ok: false, message: t("Solo las campañas 100% IA pueden aplicar propuestas solas.", "Only 100% AI campaigns can apply proposals on their own.") };
    if (on && isClosed(c.status)) return { ok: false, message: t("La campaña está parada o terminó.", "The campaign is stopped or finished.") };
    const { autoApplyProposals: _old, ...rules } = readRules(c.rules);
    void _old;
    await tx.campaign.update({ where: { id: c.id }, data: { rules: rulesJson(on ? { ...rules, autoApplyProposals: true } : rules, readEngine(c.rules)) as Prisma.InputJsonValue } });
    return { ok: true, message: on ? t("Listo: la IA aplicará sola los cambios de horarios y formatos.", "Done: the AI will apply time and format changes on its own.") : t("Listo: la IA te pedirá permiso para todo.", "Done: the AI will ask your permission for everything."), name: c.name };
  });
  if (res.ok && "name" in res) {
    await logAiAction({
      businessId,
      campaignId,
      kind: "campaign.updated",
      actor: "owner",
      summary: on
        ? { es: `En «${res.name}» la IA ahora puede aplicar sola las propuestas de bajo riesgo (horarios y formatos).`, en: `In “${res.name}” the AI can now apply low-risk proposals on its own (times and formats).` }
        : { es: `En «${res.name}» la IA ya no aplica propuestas sola.`, en: `In “${res.name}” the AI no longer applies proposals on its own.` },
      detail: { autoApplyProposals: on },
    });
    refresh(businessId, campaignId);
  }
  return { ok: res.ok, message: res.message };
}
