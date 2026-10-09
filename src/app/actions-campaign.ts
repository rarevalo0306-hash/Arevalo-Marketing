"use server";

// Acciones de Campañas: crear (asistente), editar límites, empezar, pausar, reanudar, PARAR, «Parar todo»,
// y aprobar / descartar los borradores que preparó la IA.

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { approveDraft } from "@/app/actions";
import { logAiAction } from "@/lib/ai-actions";
import { competitorNames, pauseCampaign, resumeCampaign, rulesOf, saveRules, stopAllCampaigns, stopCampaign } from "@/lib/campaign";
import {
  asMode,
  CAMPAIGN_MODES,
  defaultRules,
  LIMITS,
  modeLabel,
  rulesFromForm,
  rulesJson,
  readEngine,
  validateCampaign,
  type CampaignMode,
  type RuleProblem,
} from "@/lib/campaign-shape";
import { CHANNEL_IDS } from "@/lib/channels";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { businessDay, localToUtc } from "@/lib/time";

export type CampaignFormResult = { ok: boolean; message: string; problems?: { field: string; text: string }[] } | null;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function businessOf(id: string) {
  const b = await db.business.findUnique({ where: { id }, include: { connections: { select: { channel: true } } } });
  if (!b) {
    const { t } = await getT();
    throw new Error(t("Negocio no encontrado", "Business not found"));
  }
  return b;
}

const paths = (businessId: string, campaignId?: string) => {
  revalidatePath(`/b/${businessId}/campanas`);
  if (campaignId) revalidatePath(`/b/${businessId}/campanas/${campaignId}`);
  revalidatePath(`/b/${businessId}/plan`);
  revalidatePath(`/b/${businessId}/historial`);
};

function problemsOut(list: RuleProblem[], lang: "es" | "en") {
  return list.map((p) => ({ field: p.field, text: lang === "en" ? p.en : p.es }));
}

/** Fechas del formulario (día del negocio) → inicio y fin. Si empieza hoy, empieza ahora. */
function datesFrom(f: FormData, now: Date): { startsAt: Date; endsAt: Date | null } {
  const today = businessDay(now);
  const start = DAY.test(str(f, "startDate")) ? str(f, "startDate") : today;
  const startsAt = start <= today ? now : localToUtc(start, 0, "00:00");
  const end = str(f, "endDate");
  return { startsAt, endsAt: DAY.test(end) ? localToUtc(end, 0, "23:59") : null };
}

/** Crea la campaña con el asistente. «Empezar» la deja activa; «Guardar sin empezar» la deja sin empezar. */
export async function createCampaign(businessId: string, _prev: CampaignFormResult, f: FormData): Promise<CampaignFormResult> {
  const b = await businessOf(businessId);
  const { lang, t } = await getT();
  const now = new Date();
  const mode: CampaignMode = CAMPAIGN_MODES.includes(str(f, "mode") as CampaignMode) ? (str(f, "mode") as CampaignMode) : "approval";
  const connected = new Set(b.connections.map((c) => c.channel));
  // Solo canales conectados (los demás no se pueden elegir).
  const channels = [...new Set(f.getAll("channels").map(String))].filter((c) => CHANNEL_IDS.includes(c as never) && connected.has(c));
  const { startsAt, endsAt } = datesFrom(f, now);
  const perWeek = Math.round(Number(str(f, "perWeek")) || 3);
  const base = defaultRules({ email: b.ownerEmail, lang: b.seoLanguage, competitors: competitorNames(b) });
  const rules = rulesFromForm(f, base);
  const basics = { name: str(f, "name").slice(0, 120), mode, startsAt, endsAt, channels, perWeek };
  const problems = validateCampaign(basics, rules, { autoAccepted: f.get("autoAccepted") === "on", now });
  if (problems.length) return { ok: false, message: t("Revisa esto antes de empezar:", "Check this before starting:"), problems: problemsOut(problems, lang) };
  const start = str(f, "intent") !== "save";
  const keywords = str(f, "keywords").split(/[,\n]/).map((k) => k.trim().slice(0, 80)).filter(Boolean).slice(0, 20);
  const engine = { ...readEngine(null), resetAt: now.toISOString() };
  const c = await db.campaign.create({
    data: {
      businessId,
      name: basics.name,
      goal: str(f, "goal").slice(0, 1000),
      mode,
      status: start ? "active" : "draft",
      startsAt,
      endsAt,
      channels,
      perWeek,
      keywords,
      rules: rulesJson(rules, engine) as Prisma.InputJsonValue,
    },
  });
  await logAiAction({
    businessId,
    campaignId: c.id,
    kind: start ? "campaign.started" : "campaign.created",
    actor: "owner",
    summary: start
      ? { es: `Creaste y empezaste la campaña «${c.name}» (${modeLabel(mode, "es")}).`, en: `You created and started the campaign “${c.name}” (${modeLabel(mode, "en")}).` }
      : { es: `Creaste la campaña «${c.name}» (${modeLabel(mode, "es")}) sin empezarla.`, en: `You created the campaign “${c.name}” (${modeLabel(mode, "en")}) without starting it.` },
    detail: { mode, channels, perWeek, endsAt: endsAt?.toISOString() ?? null },
  });
  paths(businessId);
  redirect(`/b/${businessId}/campanas/${c.id}?nueva=1`);
}

/** «Editar límites»: reglas, frecuencia, fecha de fin, canales y modo de una campaña que ya existe. */
export async function updateCampaign(businessId: string, campaignId: string, _prev: CampaignFormResult, f: FormData): Promise<CampaignFormResult> {
  const b = await businessOf(businessId);
  const { lang, t } = await getT();
  const c = await db.campaign.findFirst({ where: { id: campaignId, businessId } });
  if (!c) return { ok: false, message: t("No se encontró la campaña.", "Campaign not found.") };
  if (c.status === "stopped" || c.status === "ended")
    return { ok: false, message: t("Esta campaña ya está parada o terminada: no se puede cambiar.", "This campaign is already stopped or finished: it can't be changed.") };
  const now = new Date();
  const rules = rulesFromForm(f, rulesOf(c, b));
  const connected = new Set(b.connections.map((x) => x.channel));
  const channels = f.has("channels_present") ? [...new Set(f.getAll("channels").map(String))].filter((x) => connected.has(x) || c.channels.includes(x)) : c.channels;
  const mode = f.has("mode") ? asMode(str(f, "mode")) : asMode(c.mode);
  const perWeek = f.has("perWeek") ? Math.round(Number(str(f, "perWeek")) || c.perWeek) : c.perWeek;
  const endsAt = DAY.test(str(f, "endDate")) ? localToUtc(str(f, "endDate"), 0, "23:59") : c.endsAt;
  const problems = validateCampaign(
    { name: c.name, mode, startsAt: c.startsAt, endsAt, channels, perWeek },
    rules,
    // Si ya era 100% IA, no se vuelve a pedir la casilla.
    { autoAccepted: c.mode === "auto" || f.get("autoAccepted") === "on", now },
  );
  if (problems.length) return { ok: false, message: t("Revisa esto:", "Check this:"), problems: problemsOut(problems, lang) };
  await db.campaign.update({ where: { id: campaignId }, data: { channels, mode, perWeek: Math.min(LIMITS.perWeek[1], Math.max(LIMITS.perWeek[0], perWeek)), endsAt } });
  await saveRules(campaignId, rules);
  await logAiAction({
    businessId,
    campaignId,
    kind: "campaign.updated",
    actor: "owner",
    summary: { es: `Cambiaste los límites de la campaña «${c.name}».`, en: `You changed the limits of the campaign “${c.name}”.` },
    detail: { mode, perWeek, channels },
  });
  paths(businessId, campaignId);
  return { ok: true, message: t("Listo: límites guardados. La IA los usa desde ya.", "Done: limits saved. The AI uses them from now on.") };
}

export async function startCampaign(businessId: string, campaignId: string) {
  await resumeCampaign(businessId, campaignId);
  paths(businessId, campaignId);
}

export async function pauseCampaignAction(businessId: string, campaignId: string) {
  await pauseCampaign(businessId, campaignId, { actor: "owner" });
  paths(businessId, campaignId);
}

export async function resumeCampaignAction(businessId: string, campaignId: string) {
  await resumeCampaign(businessId, campaignId);
  paths(businessId, campaignId);
}

export type StopActionResult = { ok: boolean; message: string } | null;

/** PARAR una campaña (emergencia). */
export async function stopCampaignAction(businessId: string, campaignId: string, _prev?: StopActionResult): Promise<StopActionResult> {
  const { t } = await getT();
  const r = await stopCampaign(businessId, campaignId, { actor: "owner" });
  paths(businessId, campaignId);
  if (!r.ok) return { ok: false, message: t("No se encontró la campaña.", "Campaign not found.") };
  return {
    ok: true,
    message: r.already
      ? t("La campaña ya estaba parada.", "The campaign was already stopped.")
      : t(`Campaña parada. ${r.cancelled} publicación(es) programada(s) cancelada(s): quedan como borrador.`, `Campaign stopped. ${r.cancelled} scheduled post(s) cancelled: they stay as drafts.`),
  };
}

/** «Parar todo»: todas las campañas del negocio. */
export async function stopAllAction(businessId: string, _prev?: StopActionResult): Promise<StopActionResult> {
  await businessOf(businessId);
  const { t } = await getT();
  const r = await stopAllCampaigns(businessId);
  paths(businessId);
  return {
    ok: true,
    message: r.stopped
      ? t(`Listo: ${r.stopped} campaña(s) parada(s) y ${r.cancelled} publicación(es) programada(s) cancelada(s).`, `Done: ${r.stopped} campaign(s) stopped and ${r.cancelled} scheduled post(s) cancelled.`)
      : t("No había campañas en marcha.", "There were no running campaigns."),
  };
}

/** Aprueba un borrador de la campaña (con los cambios del formulario) usando el mismo flujo que «Ideas y plan con IA». */
export async function approveCampaignDraft(businessId: string, campaignId: string, postId: string, f: FormData) {
  const post = await db.post.findFirst({ where: { id: postId, businessId, campaignId, status: "draft" }, select: { id: true, scheduledAt: true, kind: true, mediaUrl: true } });
  // Un video que todavía se está creando no se puede aprobar (saldría sin video).
  if (!post || (post.kind === "video" && !post.mediaUrl)) return;
  const c = await db.campaign.findFirst({ where: { id: campaignId, businessId }, select: { name: true, status: true } });
  // Si su hora ya pasó, sale en la próxima hora.
  if (post.scheduledAt.getTime() < Date.now()) await db.post.update({ where: { id: postId }, data: { scheduledAt: new Date(Date.now() + 60 * 60000) } });
  await approveDraft(businessId, postId, f);
  await logAiAction({
    businessId,
    campaignId,
    postId,
    kind: "post.approved",
    actor: "owner",
    summary: { es: `Aprobaste un borrador de la campaña «${c?.name ?? ""}»: quedó programado.`, en: `You approved a draft of the campaign “${c?.name ?? ""}”: it's now scheduled.` },
  });
  paths(businessId, campaignId);
}

/** Descarta un borrador que preparó la IA (el motor no lo vuelve a crear: su horario ya quedó atendido). */
export async function discardCampaignDraft(businessId: string, campaignId: string, postId: string) {
  const post = await db.post.findFirst({ where: { id: postId, businessId, campaignId, status: "draft" }, select: { id: true, source: true } });
  if (!post) return;
  // Solo se borra lo que escribió la IA; un texto del dueño se queda como borrador.
  if (post.source !== "ai") return;
  const del = await db.post.deleteMany({ where: { id: postId, status: "draft" } });
  if (del.count)
    await logAiAction({
      businessId,
      campaignId,
      kind: "post.discarded",
      actor: "owner",
      summary: { es: "Descartaste un borrador que preparó la IA.", en: "You discarded a draft the AI prepared." },
    });
  paths(businessId, campaignId);
}

