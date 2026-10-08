"use server";

// Link de subida para los técnicos: crearlo, cambiarlo (el viejo deja de servir), quitarlo y revisar lo subido ahora.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { errorText, type T } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { analyzeUploads, type UploadReviewResult } from "@/lib/library-sync";
import { r2Enabled } from "@/lib/r2";
import { newUploadToken } from "@/lib/upload";

export type UploadLinkResult = { ok: boolean; message: string };

function refresh(businessId: string) {
  revalidatePath(`/b/${businessId}/fotos`);
  revalidatePath(`/b/${businessId}/conexiones`);
}

async function exists(businessId: string) {
  return Boolean(await db.business.findUnique({ where: { id: businessId }, select: { id: true } }));
}

const notReady = (t: T): UploadLinkResult => ({
  ok: false,
  message: t(
    "Falta configurar el almacenamiento de fotos (Cloudflare R2) en el servidor. Mira «¿Cómo lo preparo?».",
    'The photo storage (Cloudflare R2) isn\'t set up on the server yet. See "How do I set it up?".',
  ),
});

/** Crea el link (si ya hay uno, lo deja igual). */
export async function createUploadLink(businessId: string): Promise<UploadLinkResult> {
  const { t } = await getT();
  if (!r2Enabled()) return notReady(t);
  const b = await db.business.findUnique({ where: { id: businessId }, select: { uploadToken: true } });
  if (!b) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  if (!b.uploadToken) await db.business.update({ where: { id: businessId }, data: { uploadToken: newUploadToken() } });
  refresh(businessId);
  return { ok: true, message: t("Listo: ya tienes tu link. Cópialo o mándalo por WhatsApp.", "Done: you have your link. Copy it or send it by WhatsApp.") };
}

/** Link nuevo: el viejo deja de servir al instante. */
export async function rotateUploadLink(businessId: string): Promise<UploadLinkResult> {
  const { t } = await getT();
  if (!r2Enabled()) return notReady(t);
  if (!(await exists(businessId))) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  await db.business.update({ where: { id: businessId }, data: { uploadToken: newUploadToken() } });
  refresh(businessId);
  return {
    ok: true,
    message: t("Listo: link nuevo. El anterior ya no sirve; mándales este a tus técnicos.", "Done: new link. The old one no longer works; send this one to your technicians."),
  };
}

/** Quita el link (las fotos ya subidas se quedan). */
export async function removeUploadLink(businessId: string): Promise<UploadLinkResult> {
  const { t } = await getT();
  if (!(await exists(businessId))) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
  await db.business.update({ where: { id: businessId }, data: { uploadToken: "" } });
  refresh(businessId);
  return {
    ok: true,
    message: t("Link quitado. Las fotos que ya subieron se quedan en tu biblioteca.", "Link removed. Photos already uploaded stay in your library."),
  };
}

/** El resultado de la revisión en una frase simple. */
function uploadReviewMessage(r: UploadReviewResult, t: T): string {
  const parts: string[] = [];
  parts.push(r.analyzed ? t(`La IA revisó ${r.analyzed}`, `The AI reviewed ${r.analyzed}`) : t("Nada nuevo revisado", "Nothing new reviewed"));
  if (r.errors) parts.push(t(`${r.errors} con problema`, `${r.errors} with a problem`));
  let msg = `${parts.join(", ")}.`;
  if (r.stopped === "noai")
    msg += t(" Falta la clave de Gemini (GEMINI_API_KEY) para que la IA las mire.", " The Gemini key (GEMINI_API_KEY) is missing, so the AI can't look at them.");
  else if (r.stopped === "rate") msg += t(" Gemini llegó a su límite por ahora; el resto se revisa más tarde.", " Gemini hit its limit for now; the rest is reviewed later.");
  else if (r.pending) msg += t(` Faltan ${r.pending}: se revisan solas en un rato.`, ` ${r.pending} left: they're reviewed on their own soon.`);
  return msg;
}

/** «Revisar ahora» de lo subido con el link. */
export async function reviewUploadsNow(businessId: string, _prev: UploadLinkResult | null, _f: FormData): Promise<UploadLinkResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  try {
    if (!(await exists(businessId))) return { ok: false, message: t("Negocio no encontrado.", "Business not found.") };
    const r = await analyzeUploads(businessId, { lang, limit: 24, budgetMs: 55_000 });
    refresh(businessId);
    return { ok: !r.stopped || r.stopped === "time", message: uploadReviewMessage(r, t) };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
