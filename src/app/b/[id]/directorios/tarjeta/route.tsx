// Tarjeta para imprimir con el código QR de reseñas de Google (A6 o tamaño tarjeta de presentación), con los colores
// y el logo de la marca. También da el QR solo (SVG). Protegida por el middleware (sesión del dueño).
import { readFile } from "fs/promises";
import { ImageResponse } from "next/og";
import path from "path";
import sharp from "sharp";
import { googleReviewLink, placeIdOf } from "@/lib/directories";
import { db } from "@/lib/db";
import { asLang, translator } from "@/lib/i18n";
import { uiLang } from "@/lib/i18n-server";
import { readMedia } from "@/lib/media";
import { qrSvg } from "@/lib/qr";
import { latestReports } from "@/lib/seo/reports";
import { readGbpReport } from "@/lib/seo/gbp";
import { readMapPlace } from "@/lib/seo/maprank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A6 (105 × 148 mm) y tarjeta de presentación (3.5 × 2 in), a 300 puntos por pulgada. */
const SIZES = { a6: { w: 1240, h: 1748 }, card: { w: 1050, h: 600 } } as const;

const hex = (v: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : fallback);
/** Texto blanco o casi negro según qué se lee mejor sobre el color. */
function inkOn(color: string): string {
  const n = parseInt(color.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? "#111c2e" : "#ffffff";
}
const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const STAR = (fill: string) =>
  svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${fill}" d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"/></svg>`);

const fontCache = new Map<string, Promise<Buffer>>();
function font(file: string): Promise<Buffer> {
  let hit = fontCache.get(file);
  if (!hit) {
    hit = readFile(path.join(process.cwd(), "src/assets/fonts", `${file}.woff`));
    hit.catch(() => fontCache.delete(file));
    fontCache.set(file, hit);
  }
  return hit;
}

async function logoData(url: string): Promise<string> {
  if (!url) return "";
  try {
    const buf = await readMedia(url);
    const png = await sharp(buf).resize(600, 600, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return "";
  }
}

const attachment = (name: string) => `attachment; filename="${name}"`;
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "negocio";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = new URL(req.url).searchParams;
  const lang = u.has("lang") ? asLang(u.get("lang")) : await uiLang();
  const t = translator(lang);
  const b = await db.business.findUnique({ where: { id }, select: { name: true, color: true, logoUrl: true, website: true, phone: true, seoMapPlace: true } });
  if (!b) return new Response(t("No encontrado", "Not found"), { status: 404 });
  const [gbpRow] = await latestReports(id, "gbp");
  const profile = gbpRow ? (readGbpReport(gbpRow.data)?.profile ?? null) : null;
  const link = googleReviewLink(placeIdOf(profile?.placeId, readMapPlace(b.seoMapPlace)?.placeId));
  if (!link) return new Response(t("Todavía no hay link de reseñas para este negocio.", "There's no review link for this business yet."), { status: 404 });
  const brand = hex(b.color, "#126BBC");
  const download = u.get("download") === "1";

  if (u.get("kind") === "qr") {
    const svg = qrSvg(link, { ecc: "M", margin: 4, dark: "#000000", light: "#ffffff", size: 1024 });
    return new Response(svg, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, no-store", ...(download ? { "Content-Disposition": attachment(`qr-resenas-${slug(b.name)}.svg`) } : {}) },
    });
  }

  const size = u.get("size") === "card" ? "card" : "a6";
  const { w, h } = SIZES[size];
  const ink = inkOn(brand);
  const qr = svgUri(qrSvg(link, { ecc: "M", margin: 2, dark: "#000000", light: "#ffffff" }));
  const logo = await logoData(b.logoUrl);
  const [semi, bold] = await Promise.all([font("montserrat-600"), font("montserrat-800")]);
  const fonts = [
    { name: "Montserrat", data: semi, weight: 600 as const, style: "normal" as const },
    { name: "Montserrat", data: bold, weight: 800 as const, style: "normal" as const },
  ];
  const site = b.website.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const contact = [b.phone || profile?.phone || "", site].filter(Boolean).join("  ·  ");
  const title = t("¡Déjanos tu reseña!", "Leave us a review!");
  const sub = t("Escanea el código con la cámara de tu celular", "Scan the code with your phone camera");
  const thanks = t("Tu opinión ayuda a otras personas. ¡Gracias!", "Your opinion helps others. Thank you!");
  const stars = (n: number) => (
    <div style={{ display: "flex", gap: Math.round(n * 0.15) }}>
      {[0, 1, 2, 3, 4].map((i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={STAR("#F5B301")} width={n} height={n} alt="" />
      ))}
    </div>
  );
  const head = (fs: number, logoH: number) =>
    logo ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logo} height={logoH} style={{ objectFit: "contain", maxWidth: w * 0.6 }} alt="" />
    ) : (
      <div style={{ fontSize: fs, fontWeight: 800, color: ink, textAlign: "center" }}>{b.name}</div>
    );

  const node =
    size === "a6" ? (
      <div style={{ width: w, height: h, display: "flex", flexDirection: "column", alignItems: "center", background: "#ffffff", fontFamily: "Montserrat" }}>
        <div style={{ width: w, height: 300, background: logo ? "#ffffff" : brand, display: "flex", alignItems: "center", justifyContent: "center", borderBottom: `16px solid ${brand}` }}>
          {head(84, 190)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 70, gap: 30 }}>
          <div style={{ fontSize: 96, fontWeight: 800, color: "#111c2e", textAlign: "center" }}>{title}</div>
          {stars(84)}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} width={700} height={700} style={{ marginTop: 60, border: `10px solid ${brand}`, borderRadius: 36, padding: 10, background: "#ffffff" }} alt="" />
        <div style={{ marginTop: 40, fontSize: 44, fontWeight: 600, color: "#344054", textAlign: "center", maxWidth: w - 160 }}>{sub}</div>
        <div style={{ marginTop: 14, fontSize: 38, fontWeight: 600, color: "#5b6779", textAlign: "center", maxWidth: w - 160 }}>{thanks}</div>
        <div style={{ marginTop: "auto", width: w, minHeight: 150, background: brand, color: ink, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "20px 60px" }}>
          <div style={{ fontSize: 46, fontWeight: 800 }}>{b.name}</div>
          {contact && <div style={{ fontSize: 34, fontWeight: 600, marginTop: 6 }}>{contact}</div>}
        </div>
      </div>
    ) : (
      <div style={{ width: w, height: h, display: "flex", background: "#ffffff", fontFamily: "Montserrat" }}>
        <div style={{ width: 600, height: h, display: "flex", flexDirection: "column", justifyContent: "center", padding: "40px 46px", gap: 22, borderLeft: `26px solid ${brand}` }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} height={90} style={{ objectFit: "contain", maxWidth: 420, alignSelf: "flex-start" }} alt="" />
          ) : (
            <div style={{ fontSize: 40, fontWeight: 800, color: brand }}>{b.name}</div>
          )}
          <div style={{ fontSize: 56, fontWeight: 800, color: "#111c2e", lineHeight: 1.1 }}>{title}</div>
          {stars(46)}
          <div style={{ fontSize: 26, fontWeight: 600, color: "#344054" }}>{sub}</div>
          {contact && <div style={{ fontSize: 22, fontWeight: 600, color: "#5b6779" }}>{contact}</div>}
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: brand }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} width={380} height={380} style={{ borderRadius: 18, background: "#ffffff", padding: 12 }} alt="" />
        </div>
      </div>
    );

  try {
    const img = new ImageResponse(node, { width: w, height: h, fonts });
    const png = Buffer.from(await img.arrayBuffer());
    const out = await sharp(png).flatten({ background: "#ffffff" }).withMetadata({ density: 300 }).png({ compressionLevel: 9 }).toBuffer();
    return new Response(new Uint8Array(out), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        ...(download ? { "Content-Disposition": attachment(`tarjeta-resenas-${size}-${slug(b.name)}.png`) } : {}),
      },
    });
  } catch (e) {
    console.error("[directorios] tarjeta", e);
    return new Response(t("No se pudo dibujar la tarjeta.", "Couldn't draw the card."), { status: 500 });
  }
}
