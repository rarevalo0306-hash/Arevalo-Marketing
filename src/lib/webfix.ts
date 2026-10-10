// «Arréglalo por mí» en el servidor: lee la conexión «Sitio web» (canal "seo": el repositorio de GitHub, la rama y la
// llave, la misma que usa el publicador de artículos), guarda cada arreglo como un SeoReport kind "webfix" y corre el
// trabajo después de responder (after). La llave solo se descifra aquí y nunca sale hacia el navegador ni a los
// registros. Un solo arreglo abierto por negocio. Nada se publica sin el clic del dueño en «Publicar en mi web».
import type { Prisma } from "@prisma/client";
import { after } from "next/server";
import { askGemini } from "@/lib/ai";
import { logAiAction } from "@/lib/ai-actions";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { type GitHubClient, httpGitHub, normalizeBranch, normalizeRepo, scrubSecrets } from "@/lib/github";
import { bi } from "@/lib/i18n";
import { saveReport } from "@/lib/seo/reports";
import { BUSINESS_TZ } from "@/lib/time";
import { type AccessCheck, checkAccess, discardFix, prepareFix, publishFix, refreshFix } from "@/lib/webfix-pipeline";
import { PICK_DEFAULTS } from "@/lib/webfix-routes";
import { EditsSchema, estimateForInstructions, SITE_CHANNEL, type FixJob, type FixSource, type FixView, isOpen, MAX_INSTRUCTIONS, newJob, readJob } from "@/lib/webfix-shape";

type SiteConnection = { repo: string; branch: string; token: string; siteUrl: string };

/** Lee y descifra la conexión «Sitio web». null si no hay repositorio o llave. */
async function siteConnection(businessId: string): Promise<SiteConnection | null> {
  const row = await db.connection.findUnique({ where: { businessId_channel: { businessId, channel: SITE_CHANNEL } }, select: { secret: true } });
  if (!row) return null;
  try {
    const c = decryptJson<Record<string, unknown>>(row.secret);
    const repo = normalizeRepo(typeof c.repo === "string" ? c.repo : "");
    const token = typeof c.githubToken === "string" ? c.githubToken.trim() : "";
    if (!repo || !token) return null;
    return { repo, token, branch: normalizeBranch(typeof c.branch === "string" ? c.branch : "") || "main", siteUrl: typeof c.siteUrl === "string" ? c.siteUrl.trim() : "" };
  } catch {
    return null;
  }
}

function client(c: SiteConnection): GitHubClient {
  return httpGitHub({ token: c.token, repo: c.repo });
}

const json = (v: unknown) => v as Prisma.InputJsonValue;
const view = (id: string, job: FixJob): FixView => ({ ...job, id });

async function latestJob(businessId: string): Promise<{ id: string; job: FixJob } | null> {
  const row = await db.seoReport.findFirst({ where: { businessId, kind: "webfix" }, orderBy: { createdAt: "desc" }, select: { id: true, data: true } });
  const job = row ? readJob(row.data) : null;
  return row && job ? { id: row.id, job } : null;
}

async function jobById(businessId: string, id: string): Promise<FixJob | null> {
  const row = await db.seoReport.findFirst({ where: { id, businessId, kind: "webfix" }, select: { data: true } });
  return row ? readJob(row.data) : null;
}

/** Guarda cambios sobre lo último guardado (el trabajo y el panel pueden escribir casi a la vez). */
async function patchJob(businessId: string, id: string, patch: Partial<FixJob>): Promise<FixJob | null> {
  const current = await jobById(businessId, id);
  if (!current) return null;
  const next: FixJob = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await db.seoReport.update({ where: { id }, data: { data: json(next) } });
  return next;
}

export type WebFixState = {
  /** Hay repositorio y llave en Conexiones → Sitio web. */
  connected: boolean;
  repo: string;
  branch: string;
  job: FixView | null;
  /** Hay un arreglo abierto (preparándose o esperando la revisión). */
  open: boolean;
  /** Para estimar el costo en el navegador: el tope de letras de archivos que se leen. */
  fileBudget: number;
  aiReady: boolean;
};

/** Lo que necesitan los botones y el panel. Un arreglo «preparando» que se cortó se marca como fallido. */
export async function loadWebFixState(businessId: string): Promise<WebFixState> {
  const [conn, last] = await Promise.all([siteConnection(businessId).catch(() => null), latestJob(businessId).catch(() => null)]);
  let job = last ? view(last.id, last.job) : null;
  if (last && job && last.job.status === "preparing" && !isOpen(last.job, new Date())) {
    const failed = await patchJob(businessId, last.id, { status: "failed", error: { es: "La preparación se cortó a la mitad. Vuelve a intentarlo.", en: "The preparation was cut off halfway. Try again." } });
    if (failed) job = view(last.id, failed);
  }
  return {
    connected: Boolean(conn),
    repo: conn?.repo ?? "",
    branch: conn?.branch ?? "",
    job,
    open: job ? isOpen(job, new Date()) : false,
    fileBudget: PICK_DEFAULTS.budget,
    aiReady: Boolean(process.env.GEMINI_API_KEY),
  };
}

export type StartInput = { source: FixSource; instructions: string };

/** «Arréglalo por mí»: guarda el arreglo como «preparando» y lo trabaja después de responder. */
export async function startWebFix(businessId: string, input: StartInput): Promise<FixView> {
  const b = await db.business.findUnique({ where: { id: businessId }, select: { website: true } });
  if (!b) throw bi("Negocio no encontrado.", "Business not found.");
  const conn = await siteConnection(businessId);
  if (!conn) throw bi("Primero conecta tu página web en Conexiones → Sitio web (repositorio de GitHub y llave).", "First connect your website in Connections → Website (GitHub repository and key).");
  if (!process.env.GEMINI_API_KEY) throw bi("Falta la clave de Gemini (GEMINI_API_KEY) en el servidor.", "The Gemini key (GEMINI_API_KEY) is missing on the server.");
  const instructions = input.instructions.trim().slice(0, MAX_INSTRUCTIONS);
  if (!instructions) throw bi("No hay nada que arreglar con este botón.", "There's nothing to fix with this button.");
  const last = await latestJob(businessId);
  if (last && isOpen(last.job, new Date())) throw bi("Ya hay arreglos esperando tu revisión. Publícalos o descártalos primero.", "There are already fixes waiting for your review. Publish or discard them first.");
  const source: FixSource = {
    kind: input.source.kind === "audit" ? "audit" : "prompt",
    title: input.source.title.slice(0, 120),
    issueIds: input.source.issueIds.slice(0, 50).map((x) => String(x).slice(0, 80)),
    urls: input.source.urls.slice(0, 60).map((x) => String(x).slice(0, 500)),
  };
  const job = newJob(source, conn.repo, conn.branch, estimateForInstructions(instructions.length, PICK_DEFAULTS.budget), new Date());
  const row = await saveReport(businessId, "webfix", json(job));
  after(() => runWebFix(businessId, row.id, instructions, b.website || conn.siteUrl));
  return view(row.id, job);
}

/** El trabajo (después de responder): leer, IA, revisar, rama y PR. Siempre deja el arreglo en un estado final o «open». */
export async function runWebFix(businessId: string, id: string, instructions: string, website: string): Promise<void> {
  const conn = await siteConnection(businessId);
  const job = await jobById(businessId, id);
  if (!conn || !job) return;
  const gh = client(conn);
  try {
    const result = await prepareFix(
      gh,
      (system, user) => askGemini(EditsSchema, system, user, 32_000),
      { source: job.source, instructions, base: conn.branch, website: website || conn.siteUrl, now: new Date(), timeZone: BUSINESS_TZ },
      async (patch) => {
        await patchJob(businessId, id, patch);
      },
    );
    const saved = await patchJob(businessId, id, result);
    if (result.costCents || result.status === "open") {
      const n = result.changes?.length ?? 0;
      await logAiAction({
        businessId,
        kind: "web.fix.proposed",
        actor: "approved",
        costCents: result.costCents ?? 0,
        summary:
          result.status === "open"
            ? { es: `Matya preparó ${n} ${n === 1 ? "arreglo" : "arreglos"} para tu web (esperan tu revisión).`, en: `Matya prepared ${n} ${n === 1 ? "fix" : "fixes"} for your website (waiting for your review).` }
            : { es: "Matya revisó tu web pero no encontró cambios seguros para hacer.", en: "Matya checked your website but found no safe changes to make." },
        detail: json({ reportId: id, repo: conn.repo, pr: saved?.prNumber ?? 0, files: (result.changes ?? []).map((c) => c.path), status: result.status }),
      });
    }
  } catch (e) {
    console.error("webfix", scrubSecrets(e instanceof Error ? e.message : String(e), conn.token));
    await patchJob(businessId, id, { status: "failed", error: { es: "Algo falló al preparar los arreglos. Intenta de nuevo.", en: "Something went wrong preparing the fixes. Try again." } });
  }
}

/** Lo último guardado (para el panel mientras se prepara). */
export async function getWebFix(businessId: string): Promise<FixView | null> {
  const last = await latestJob(businessId);
  return last ? view(last.id, last.job) : null;
}

/** Mira el PR en GitHub (vista previa, conflictos, publicado o cerrado fuera de Matya) y lo guarda. */
export async function refreshWebFix(businessId: string, id: string): Promise<FixView | null> {
  const job = await jobById(businessId, id);
  if (!job) return null;
  if (job.status !== "open") return view(id, job);
  // Como mucho una consulta a GitHub cada 8 segundos.
  if (job.checkedAt && Date.now() - new Date(job.checkedAt).getTime() < 8_000) return view(id, job);
  const conn = await siteConnection(businessId);
  if (!conn) return view(id, { ...job, error: { es: "La conexión «Sitio web» ya no está. Vuelve a conectarla en Conexiones.", en: "The “Website” connection is gone. Connect it again in Connections." } });
  const patch = await refreshFix(client(conn), job, new Date());
  const next = await patchJob(businessId, id, patch);
  if (next && patch.status === "published")
    await logAiAction({
      businessId,
      kind: "web.fix.published",
      actor: "owner",
      summary: { es: "Los arreglos de tu web se publicaron desde GitHub.", en: "Your website fixes were published from GitHub." },
      detail: json({ reportId: id, repo: job.repo, pr: job.prNumber, outside: true }),
    });
  return next ? view(id, next) : null;
}

export type ActionOutcome = { ok: boolean; message: { es: string; en: string }; job: FixView | null };

/** «Publicar en mi web»: squash merge con el sha que revisó el dueño (solo si la vista previa salió bien). */
export async function publishWebFix(businessId: string, id: string): Promise<ActionOutcome> {
  const job = await jobById(businessId, id);
  if (!job || job.status !== "open") return { ok: false, message: { es: "Este arreglo ya no está abierto.", en: "This fix is no longer open." }, job: job ? view(id, job) : null };
  const conn = await siteConnection(businessId);
  if (!conn) return { ok: false, message: { es: "La conexión «Sitio web» ya no está. Vuelve a conectarla en Conexiones.", en: "The “Website” connection is gone. Connect it again in Connections." }, job: view(id, job) };
  const r = await publishFix(client(conn), job);
  if (!r.ok) {
    const next = r.outcome ? await patchJob(businessId, id, { status: r.outcome, outside: true }) : await patchJob(businessId, id, { missing: r.missing ?? job.missing });
    return { ok: false, message: r.error, job: next ? view(id, next) : view(id, job) };
  }
  const next = await patchJob(businessId, id, { status: "published", publishedAt: new Date().toISOString(), error: null });
  const n = job.changes.length;
  await logAiAction({
    businessId,
    kind: "web.fix.published",
    actor: "approved",
    summary: { es: `Publicaste ${n} ${n === 1 ? "arreglo" : "arreglos"} de Matya en tu web.`, en: `You published ${n} Matya ${n === 1 ? "fix" : "fixes"} on your website.` },
    detail: json({ reportId: id, repo: job.repo, pr: job.prNumber, sha: r.sha }),
  });
  return { ok: true, message: { es: "¡Listo! Tu web se actualiza en unos minutos.", en: "Done! Your website updates in a few minutes." }, job: next ? view(id, next) : null };
}

/** «Descartar»: cierra el PR y borra la rama. Tu web no cambia. */
export async function discardWebFix(businessId: string, id: string): Promise<ActionOutcome> {
  const job = await jobById(businessId, id);
  if (!job) return { ok: false, message: { es: "No encontramos ese arreglo.", en: "We couldn't find that fix." }, job: null };
  if (job.status !== "open" && job.status !== "failed" && job.status !== "nothing") return { ok: false, message: { es: "Este arreglo ya no está abierto.", en: "This fix is no longer open." }, job: view(id, job) };
  const conn = await siteConnection(businessId);
  if (job.status === "open") {
    if (!conn) return { ok: false, message: { es: "La conexión «Sitio web» ya no está. Vuelve a conectarla en Conexiones.", en: "The “Website” connection is gone. Connect it again in Connections." }, job: view(id, job) };
    const r = await discardFix(client(conn), job);
    if (!r.ok) return { ok: false, message: r.error, job: view(id, job) };
    if (r.outcome === "published") {
      const next = await patchJob(businessId, id, { status: "published", outside: true });
      return { ok: false, message: { es: "Estos arreglos ya se publicaron desde GitHub.", en: "These fixes were already published from GitHub." }, job: next ? view(id, next) : null };
    }
  }
  const next = await patchJob(businessId, id, { status: "discarded" });
  if (job.status === "open")
    await logAiAction({
      businessId,
      kind: "web.fix.discarded",
      actor: "owner",
      summary: { es: "Descartaste los arreglos de Matya: tu web no cambió.", en: "You discarded Matya's fixes: your website didn't change." },
      detail: json({ reportId: id, repo: job.repo, pr: job.prNumber }),
    });
  return { ok: true, message: { es: "Descartado. Tu web no cambió.", en: "Discarded. Your website didn't change." }, job: next ? view(id, next) : null };
}

/** «Revisar la llave» (solo lectura): qué puede hacer la llave de Conexiones → Sitio web. */
export async function checkWebFixAccess(businessId: string): Promise<AccessCheck | null> {
  const conn = await siteConnection(businessId);
  if (!conn) return null;
  return checkAccess(client(conn), conn.branch);
}
