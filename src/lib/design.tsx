// Diseñador gráfico: pone el logo, el color de la marca, un titular y el teléfono encima de una foto,
// en el tamaño de cada red. La IA no escribe bien letras dentro de las imágenes; aquí el texto se
// dibuja con fuentes reales, así que sale sin errores.
import { readFile } from "fs/promises";
import path from "path";
import { ImageResponse } from "next/og";
import sharp from "sharp";

import { DESIGN_SHAPES, headlineSize, type DesignShape } from "@/lib/design-shapes";

export { DESIGN_SHAPES, type DesignShape };

export type DesignInput = {
  photoUrl: string;
  headline: string;
  businessName: string;
  color: string;
  logoUrl?: string;
  phone?: string;
  website?: string;
  shape?: DesignShape;
};

let fonts: { name: string; data: Buffer; weight: 600 | 800; style: "normal" }[] | null = null;
async function loadFonts() {
  if (fonts) return fonts;
  const dir = path.join(process.cwd(), "src/assets/fonts");
  const [semi, bold] = await Promise.all([readFile(path.join(dir, "montserrat-600.woff")), readFile(path.join(dir, "montserrat-800.woff"))]);
  fonts = [
    { name: "Montserrat", data: semi, weight: 600, style: "normal" },
    { name: "Montserrat", data: bold, weight: 800, style: "normal" },
  ];
  return fonts;
}

/** Descarga una imagen y la deja como data URI (Satori la dibuja sin volver a pedirla). */
async function dataUri(url: string): Promise<string> {
  if (!/^https:\/\//i.test(url)) throw new Error("La imagen debe tener una dirección https.");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status}).`);
  // Se normaliza a JPEG/PNG para que Satori la entienda (por ejemplo si viene en WEBP).
  const input = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(input).metadata();
  const png = meta.hasAlpha;
  const out = png ? await sharp(input).png().toBuffer() : await sharp(input).jpeg({ quality: 92 }).toBuffer();
  return `data:image/${png ? "png" : "jpeg"};base64,${out.toString("base64")}`;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const hostOf = (url = "") => url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

/** Dibuja el diseño y lo devuelve en JPEG (Instagram solo acepta JPEG). */
export async function renderDesign(d: DesignInput): Promise<Buffer> {
  const { w, h } = DESIGN_SHAPES[d.shape ?? "square"];
  const color = HEX.test(d.color) ? d.color : "#126BBC";
  const headline = d.headline.trim().replace(/\s+/g, " ").slice(0, 80);
  const [photo, logo] = await Promise.all([dataUri(d.photoUrl), d.logoUrl ? dataUri(d.logoUrl).catch(() => "") : Promise.resolve("")]);
  const contact = [d.phone?.trim(), hostOf(d.website)].filter(Boolean).join("   ·   ");
  const pad = Math.round(w * 0.06);

  const img = new ImageResponse(
    (
      <div style={{ width: w, height: h, display: "flex", position: "relative", fontFamily: "Montserrat", background: color }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={photo} width={w} height={h} style={{ position: "absolute", top: 0, left: 0, width: w, height: h, objectFit: "cover" }} />
        {/* Sombra suave abajo para que el texto siempre se lea */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: Math.round(h * 0.62), display: "flex", backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.78) 100%)" }} />
        {/* Logo arriba a la izquierda */}
        <div style={{ position: "absolute", top: pad, left: pad, display: "flex", alignItems: "center", background: "rgba(255,255,255,0.95)", borderRadius: 18, padding: logo ? "14px 22px" : "16px 26px", boxShadow: "0 6px 24px rgba(0,0,0,0.18)" }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img src={logo} height={Math.round(w * 0.075)} style={{ height: Math.round(w * 0.075), maxWidth: Math.round(w * 0.42), objectFit: "contain" }} />
          ) : (
            <div style={{ display: "flex", fontSize: Math.round(w * 0.03), fontWeight: 800, color }}>{d.businessName}</div>
          )}
        </div>
        {/* Titular y franja de contacto */}
        <div style={{ position: "absolute", left: pad, right: pad, bottom: pad, display: "flex", flexDirection: "column", gap: Math.round(w * 0.028) }}>
          <div style={{ display: "flex", width: Math.round(w * 0.12), height: 10, borderRadius: 5, background: color }} />
          <div style={{ display: "flex", fontSize: headlineSize(headline, w), fontWeight: 800, lineHeight: 1.08, color: "#ffffff", letterSpacing: -1 }}>{headline}</div>
          {contact && (
            <div style={{ display: "flex", alignSelf: "flex-start", background: color, color: "#ffffff", borderRadius: 999, padding: `${Math.round(w * 0.016)}px ${Math.round(w * 0.032)}px`, fontSize: Math.round(w * 0.03), fontWeight: 600 }}>
              {contact}
            </div>
          )}
        </div>
      </div>
    ),
    { width: w, height: h, fonts: await loadFonts() },
  );
  const png = Buffer.from(await img.arrayBuffer());
  return sharp(png).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}
