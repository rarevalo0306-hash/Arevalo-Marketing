import { cookies } from "next/headers";
import { zipSync, strToU8 } from "fflate";
import { attachment, kitItems, sessionOk } from "@/app/api/brand-kit/access";
import { hostOf, kitGroup, pool, signatureHtml, zipEntries } from "@/lib/brand-kit-formats";
import { db } from "@/lib/db";
import { asLang, translator } from "@/lib/i18n";
import { uiLang } from "@/lib/i18n-server";
import { publicMediaUrl, readMedia } from "@/lib/media";
import { SESSION_COOKIE, sessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Todo el kit en un ZIP, en carpetas por grupo (Logos, Redes sociales, Sitio web, Email, Impresos). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = new URL(req.url).searchParams;
  const lang = u.has("lang") ? asLang(u.get("lang")) : await uiLang();
  const t = translator(lang);
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionOk(cookie, await sessionToken(), process.env.APP_PASSWORD)) return new Response(t("No autorizado", "Unauthorized"), { status: 401 });
  const b = await db.business.findUnique({ where: { id }, select: { name: true, color: true, phone: true, website: true, brandAssets: true } });
  if (!b) return new Response(t("No encontrado", "Not found"), { status: 404 });
  const items = kitItems(b.brandAssets);
  if (!items.length) return new Response(t("Todavía no has creado el kit.", "You haven't created the kit yet."), { status: 404 });
  try {
    const entries = zipEntries(items, lang);
    const files: Record<string, Uint8Array> = {};
    // PNG ya va comprimido: se guarda sin volver a comprimir (más rápido).
    await pool(entries, 6, async (e) => {
      files[e.path] = new Uint8Array(await readMedia(e.asset.url));
    });
    const logo = items.find((a) => a.format === "email-logo");
    const html = signatureHtml({ name: b.name, phone: b.phone, website: b.website, color: b.color, logoUrl: logo ? publicMediaUrl(logo.url) : undefined, logoW: logo?.w, logoH: logo?.h });
    files[`${kitGroup("email")!.folder[lang]}/${t("firma-email", "email-signature")}.html`] = strToU8(`<!doctype html><meta charset="utf-8"><title>${t("Firma", "Signature")}</title>${html}`);
    const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: 0 }]])));
    const base = hostOf(b.website).split(".")[0] || b.name.normalize("NFD").replace(/[^\w]+/g, "-").toLowerCase();
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": attachment(`${base}-${t("kit-de-marca", "brand-kit")}.zip`),
        "Content-Length": String(zip.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error(`[kit zip] ${id}:`, e);
    return new Response(t("No se pudo armar el ZIP.", "Couldn't build the ZIP."), { status: 500 });
  }
}
