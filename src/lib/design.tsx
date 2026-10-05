// Diseñador gráfico: dibuja los posts con la identidad de cada negocio (logo, colores, letra) usando
// plantillas. La IA no escribe bien letras dentro de las imágenes; aquí el texto se dibuja con fuentes
// reales, así que sale sin errores.
import { readFile } from "fs/promises";
import path from "path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { DESIGN_SHAPES, FONTS, fontId, headlineSize, hexOr, needsPhoto, type DesignShape, type FontId, type TemplateSpec } from "@/lib/design-shapes";

export { DESIGN_SHAPES, type DesignShape };

export type Brand = {
  name: string;
  color: string;
  color2?: string;
  color3?: string;
  logoUrl?: string;
  logoLightUrl?: string;
  phone?: string;
  website?: string;
  fontHeading?: string;
};

export type DesignInput = {
  brand: Brand;
  headline: string;
  /** Foto (las plantillas de color y de lista no la necesitan). */
  photoUrl?: string;
  /** Para las plantillas de lista. */
  steps?: string[];
  template: TemplateSpec;
  shape?: DesignShape;
};

const fontCache = new Map<FontId, { name: string; data: Buffer; weight: 500 | 600 | 700 | 800; style: "normal" }[]>();
async function loadFont(id: FontId) {
  const hit = fontCache.get(id);
  if (hit) return hit;
  const f = FONTS[id];
  const dir = path.join(process.cwd(), "src/assets/fonts");
  const [semi, bold] = await Promise.all([readFile(path.join(dir, `${id}-${f.semi}.woff`)), readFile(path.join(dir, `${id}-${f.bold}.woff`))]);
  const list = [
    { name: f.name, data: semi, weight: f.semi, style: "normal" as const },
    { name: f.name, data: bold, weight: f.bold, style: "normal" as const },
  ];
  fontCache.set(id, list);
  return list;
}

/** Descarga una imagen y la deja como data URI (Satori la dibuja sin volver a pedirla). */
async function dataUri(url: string): Promise<string> {
  if (url.startsWith("data:image/")) return url;
  if (!/^https:\/\//i.test(url)) throw new Error("La imagen debe tener una dirección https.");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status}).`);
  const input = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(input).metadata();
  const png = meta.hasAlpha;
  const out = png ? await sharp(input).png().toBuffer() : await sharp(input).jpeg({ quality: 92 }).toBuffer();
  return `data:image/${png ? "png" : "jpeg"};base64,${out.toString("base64")}`;
}

const hostOf = (url = "") => url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

/** Dibuja el diseño con la plantilla y lo devuelve en JPEG (Instagram solo acepta JPEG). */
export async function renderDesign(d: DesignInput): Promise<Buffer> {
  const t = d.template;
  const { w, h } = DESIGN_SHAPES[d.shape ?? "square"];
  const b = d.brand;
  const c1 = hexOr(b.color, "#126BBC");
  const c2 = hexOr(b.color2, c1);
  const c3 = hexOr(b.color3, c2);
  const font = fontId(b.fontHeading ?? "");
  const { name: fontName, bold, semi } = FONTS[font];
  let headline = d.headline.trim().replace(/\s+/g, " ").slice(0, 90);
  if (t.uppercase) headline = headline.toUpperCase();
  const steps = (d.steps ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const usePhoto = needsPhoto(t) || (t.layout === "lista" && !!d.photoUrl);
  if (needsPhoto(t) && !d.photoUrl) throw new Error(`La plantilla "${t.name}" necesita una foto.`);

  const [photo, logo, logoLight] = await Promise.all([
    usePhoto && d.photoUrl ? dataUri(d.photoUrl) : Promise.resolve(""),
    b.logoUrl ? dataUri(b.logoUrl).catch(() => "") : Promise.resolve(""),
    b.logoLightUrl ? dataUri(b.logoLightUrl).catch(() => "") : Promise.resolve(""),
  ]);
  const contact = [b.phone?.trim(), hostOf(b.website)].filter(Boolean).join("   ·   ");
  const pad = Math.round(w * 0.06);
  const logoH = Math.round(w * 0.075);
  const bg = t.background === "degradado" ? `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)` : t.background === "blanco" ? "#ffffff" : { color1: c1, color2: c2, color3: c3 }[t.background];
  const onWhite = t.background === "blanco";
  const ink = onWhite ? c1 : "#ffffff";
  const size = Math.round(headlineSize(headline, w) * t.headlineScale * (t.uppercase ? 0.92 : 1));
  const center = t.align === "centro";
  const justify = { arriba: "flex-start", centro: "center", abajo: "flex-end" }[t.textPosition];

  const Logo = ({ onDark }: { onDark: boolean }) =>
    onDark && logoLight ? (
      // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
      <img src={logoLight} height={logoH} style={{ height: logoH, maxWidth: Math.round(w * 0.45), objectFit: "contain" }} />
    ) : (
      <div style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.96)", borderRadius: 18, padding: logo ? "14px 22px" : "16px 26px", boxShadow: "0 6px 24px rgba(0,0,0,0.18)" }}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          <img src={logo} height={logoH} style={{ height: logoH, maxWidth: Math.round(w * 0.42), objectFit: "contain" }} />
        ) : (
          <div style={{ display: "flex", fontSize: Math.round(w * 0.03), fontWeight: bold, color: c1 }}>{b.name}</div>
        )}
      </div>
    );
  const logoPos = { "arriba-izquierda": { top: pad, left: pad }, "arriba-derecha": { top: pad, right: pad }, "abajo-derecha": { bottom: pad, right: pad } }[t.logoPosition];

  const Contact = ({ dark }: { dark: boolean }) => {
    if (!contact) return null;
    const fs = Math.round(w * 0.03);
    if (t.contactStyle === "texto") return <div style={{ display: "flex", fontSize: fs, fontWeight: semi, color: dark ? "#ffffff" : c1, opacity: 0.95, whiteSpace: "nowrap" }}>{contact}</div>;
    const pill = dark ? (t.background === "blanco" ? c1 : c3 === c1 ? "rgba(255,255,255,0.95)" : c3) : c1;
    const fg = pill.startsWith("rgba") ? c1 : "#ffffff";
    return <div style={{ display: "flex", alignSelf: center ? "center" : "flex-start", background: pill, color: fg, borderRadius: 999, padding: `${Math.round(w * 0.016)}px ${Math.round(w * 0.032)}px`, fontSize: fs, fontWeight: semi, whiteSpace: "nowrap" }}>{contact}</div>;
  };
  const ContactBar = () =>
    contact ? (
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: Math.round(h * 0.085), display: "flex", alignItems: "center", justifyContent: "center", background: c1, color: "#fff", fontSize: Math.round(w * 0.03), fontWeight: semi }}>{contact}</div>
    ) : null;
  const barSpace = t.contactStyle === "franja" && contact ? Math.round(h * 0.085) : 0;

  const Accent = ({ dark }: { dark: boolean }) =>
    t.accent === "barra" ? <div style={{ display: "flex", alignSelf: center ? "center" : "flex-start", width: Math.round(w * 0.12), height: 10, borderRadius: 5, background: c3 === c1 && dark ? "#ffffff" : c3 }} />
    : t.accent === "comillas" ? <div style={{ display: "flex", alignSelf: center ? "center" : "flex-start", fontSize: Math.round(w * 0.16), fontWeight: bold, color: dark ? "#ffffff" : c3, opacity: 0.4, lineHeight: 0.8 }}>“</div>
    : null;
  const Circles = () =>
    t.accent === "circulos" ? (
      <>
        <div style={{ position: "absolute", right: -w * 0.18, top: -w * 0.18, width: w * 0.7, height: w * 0.7, borderRadius: w, display: "flex", background: c3, opacity: 0.35 }} />
        <div style={{ position: "absolute", left: -w * 0.12, bottom: -w * 0.2, width: w * 0.5, height: w * 0.5, borderRadius: w, display: "flex", background: "#ffffff", opacity: 0.08 }} />
      </>
    ) : null;
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  const Photo = (p: { left?: number; top?: number; width: number; height: number }) => <img src={photo} width={p.width} height={p.height} style={{ position: "absolute", top: p.top ?? 0, left: p.left ?? 0, width: p.width, height: p.height, objectFit: "cover" }} />;
  const shade = t.overlay === "fuerte" ? 0.82 : t.overlay === "suave" ? 0.5 : 0;
  const TextBlock = ({ color, dark, width, fontSize = size }: { color: string; dark: boolean; width: number; fontSize?: number }) => (
    <div style={{ display: "flex", flexDirection: "column", width, alignItems: center ? "center" : "flex-start", gap: Math.round(w * 0.028), textAlign: center ? "center" : "left" }}>
      <Accent dark={dark} />
      <div style={{ display: "flex", width, fontSize, fontWeight: bold, lineHeight: 1.08, color, letterSpacing: t.uppercase ? 0 : -1, justifyContent: center ? "center" : "flex-start" }}>{headline}</div>
      {t.contactStyle !== "franja" && <Contact dark={dark} />}
    </div>
  );

  let body: React.ReactNode;
  if (t.layout === "foto-completa") {
    const grad = t.textPosition === "arriba" ? "to top" : "to bottom";
    body = (
      <>
        <Photo width={w} height={h} />
        {shade > 0 && (
          <div style={{ position: "absolute", top: 0, left: 0, width: w, height: h, display: "flex", backgroundImage: t.textPosition === "centro" ? `linear-gradient(rgba(0,0,0,${shade * 0.6}), rgba(0,0,0,${shade * 0.6}))` : `linear-gradient(${grad}, rgba(0,0,0,0) 30%, rgba(0,0,0,${shade}) 100%)` }} />
        )}
        <div style={{ position: "absolute", left: pad, width: w - pad * 2, top: pad * 2.6, height: h - pad * 3.6 - barSpace, display: "flex", flexDirection: "column", justifyContent: justify }}>
          <TextBlock color="#ffffff" dark width={w - pad * 2} />
        </div>
      </>
    );
  } else if (t.layout === "franja-arriba" || t.layout === "franja-abajo") {
    const band = Math.round(h * 0.44);
    const top = t.layout === "franja-arriba";
    body = (
      <>
        <div style={{ position: "absolute", left: 0, width: w, top: top ? 0 : h - band, height: band, display: "flex", background: bg }} />
        <Photo width={w} height={h - band - (top ? barSpace : 0)} top={top ? band : 0} />
        <div style={{ position: "absolute", left: pad, width: w - pad * 2, top: top ? pad * 2.6 : h - band + pad, height: top ? band - pad * 3.2 : band - pad * 2 - barSpace, display: "flex", flexDirection: "column", justifyContent: top ? "flex-end" : "center" }}>
          <TextBlock color={ink} dark={!onWhite} width={w - pad * 2} fontSize={Math.round(size * 0.88)} />
        </div>
      </>
    );
  } else if (t.layout === "mitad-izquierda") {
    const half = Math.round(w * 0.5);
    body = (
      <>
        <div style={{ position: "absolute", top: 0, left: 0, width: half, height: h, display: "flex", background: bg }} />
        <Photo left={half} width={w - half} height={h - barSpace} />
        <div style={{ position: "absolute", left: pad * 0.8, width: half - pad * 1.6, top: pad * 2.6, height: h - pad * 3.6 - barSpace, display: "flex", flexDirection: "column", justifyContent: justify }}>
          <TextBlock color={ink} dark={!onWhite} width={half - pad * 1.6} fontSize={Math.round(size * 0.72)} />
        </div>
      </>
    );
  } else if (t.layout === "color-solido") {
    body = (
      <>
        <div style={{ position: "absolute", top: 0, left: 0, width: w, height: h, display: "flex", background: bg }} />
        <Circles />
        <div style={{ position: "absolute", left: pad, width: w - pad * 2, top: pad * 2.6, height: h - pad * 3.6 - barSpace, display: "flex", flexDirection: "column", justifyContent: justify }}>
          <TextBlock color={ink} dark={!onWhite} width={w - pad * 2} />
        </div>
      </>
    );
  } else {
    const topH = Math.round(h * 0.34);
    body = (
      <>
        <div style={{ position: "absolute", top: 0, left: 0, width: w, height: h, display: "flex", background: "#ffffff" }} />
        {photo ? <Photo width={w} height={topH} /> : <div style={{ position: "absolute", top: 0, left: 0, width: w, height: topH, display: "flex", background: bg }} />}
        {photo && shade > 0 && <div style={{ position: "absolute", top: 0, left: 0, width: w, height: topH, display: "flex", backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.05), rgba(0,0,0,${shade * 0.6}))` }} />}
        <div style={{ position: "absolute", left: pad, width: w - pad * 2, top: topH + pad * 0.8, height: h - topH - pad * 1.8 - barSpace, display: "flex", flexDirection: "column", gap: Math.round(w * 0.03) }}>
          <div style={{ display: "flex", width: w - pad * 2, fontSize: Math.round(size * 0.85), fontWeight: bold, lineHeight: 1.1, color: c1 }}>{headline}</div>
          <div style={{ display: "flex", flexDirection: "column", width: w - pad * 2, gap: Math.round(w * 0.022) }}>
            {steps.map((s, i) => (
              <div key={i} style={{ display: "flex", width: w - pad * 2, alignItems: "center", gap: Math.round(w * 0.025) }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: Math.round(w * 0.075), height: Math.round(w * 0.075), borderRadius: w, background: i % 2 ? c3 : c2, color: "#fff", fontSize: Math.round(w * 0.038), fontWeight: bold, flexShrink: 0 }}>{i + 1}</div>
                <div style={{ display: "flex", width: w - pad * 2 - Math.round(w * 0.1), fontSize: Math.round(w * 0.036), fontWeight: semi, color: "#1e2a38", lineHeight: 1.25 }}>{s}</div>
              </div>
            ))}
          </div>
          {t.contactStyle !== "franja" && <div style={{ display: "flex", marginTop: "auto" }}><Contact dark={false} /></div>}
        </div>
      </>
    );
  }
  const logoOnDark = !(t.layout === "lista" && t.logoPosition !== "arriba-izquierda" && t.logoPosition !== "arriba-derecha") && !onWhite;

  const img = new ImageResponse(
    (
      <div style={{ width: w, height: h, display: "flex", position: "relative", fontFamily: fontName, background: c1 }}>
        {body}
        {t.contactStyle === "franja" && <ContactBar />}
        <div style={{ position: "absolute", display: "flex", ...logoPos, ...(t.logoPosition === "abajo-derecha" ? { bottom: pad + barSpace } : {}) }}><Logo onDark={logoOnDark} /></div>
      </div>
    ),
    { width: w, height: h, fonts: await loadFont(font) },
  );
  const png = Buffer.from(await img.arrayBuffer());
  return sharp(png).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}

/** Foto de ejemplo para las vistas previas cuando el negocio todavía no tiene fotos. */
export async function samplePhoto(color: string): Promise<string> {
  const c = hexOr(color, "#126BBC");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe0f3"/><stop offset="1" stop-color="${c}"/></linearGradient></defs><rect width="1080" height="1080" fill="url(#g)"/><circle cx="780" cy="300" r="160" fill="#ffffff" opacity="0.35"/><path d="M0 820 L300 560 L520 760 L760 520 L1080 840 L1080 1080 L0 1080 Z" fill="#ffffff" opacity="0.25"/></svg>`;
  const jpg = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString("base64")}`;
}
