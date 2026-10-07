// Diseñador gráfico: dibuja los posts con la identidad de cada negocio (logo, colores, letras) usando
// plantillas. La IA no escribe bien letras dentro de las imágenes; aquí el texto se dibuja con fuentes
// reales, así que sale sin errores. Cada plantilla se adapta a la forma de cada red (cuadrada, vertical,
// historia 9:16, ancha 16:9…), con márgenes seguros y el titular siempre legible.
import { readFile } from "fs/promises";
import path from "path";
import { ImageResponse } from "next/og";
import { readMedia } from "@/lib/media";
import sharp from "sharp";
import {
  BODY_FONTS,
  bodyFontId,
  contrast,
  DESIGN_SHAPES,
  FONTS,
  fontId,
  hexOr,
  inkOn,
  mix,
  needsPhoto,
  rgba,
  PHOTO_BOXES,
  textBox,
  type Box,
  type CustomSpec,
  type DesignShape,
  type StoredTemplate,
} from "@/lib/design-shapes";

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
  /** Nombre libre de la letra del texto (por ejemplo "IBM Plex Sans"). */
  fontBody?: string;
};

export type DesignInput = {
  brand: Brand;
  headline: string;
  /** Foto (las plantillas de color y de lista no la necesitan). */
  photoUrl?: string;
  /** Para las plantillas de lista. */
  steps?: string[];
  template: StoredTemplate;
  shape?: DesignShape;
};

type FontFile = { name: string; data: Buffer; weight: 400 | 500 | 600 | 700 | 800; style: "normal" };
const fontCache = new Map<string, FontFile[]>();
async function fontFiles(file: string, name: string, weights: readonly (400 | 500 | 600 | 700 | 800)[]): Promise<FontFile[]> {
  const hit = fontCache.get(file);
  if (hit) return hit;
  const dir = path.join(process.cwd(), "src/assets/fonts");
  const list = await Promise.all(weights.map(async (weight) => ({ name, data: await readFile(path.join(dir, `${file}-${weight}.woff`)), weight, style: "normal" as const })));
  fontCache.set(file, list);
  return list;
}

/** Letras de titulares y de texto. Si la del texto no está disponible, se usa la de los titulares. */
async function loadFonts(brand: Brand) {
  const head = fontId(brand.fontHeading ?? "");
  const hf = FONTS[head];
  const fonts = await fontFiles(head, hf.name, [hf.semi, hf.bold]);
  const bodyId = bodyFontId(brand.fontBody ?? "");
  if (!bodyId) return { fonts, head: hf.name, body: hf.name, bodyRegular: hf.semi, bodySemi: hf.semi, bold: hf.bold, semi: hf.semi, widthFactor: WIDTH[head] };
  const bf = BODY_FONTS[bodyId];
  const body = await fontFiles(bodyId, bf.name, [bf.regular, bf.semi]).catch(() => null);
  if (!body) return { fonts, head: hf.name, body: hf.name, bodyRegular: hf.semi, bodySemi: hf.semi, bold: hf.bold, semi: hf.semi, widthFactor: WIDTH[head] };
  return { fonts: [...fonts, ...body], head: hf.name, body: bf.name, bodyRegular: bf.regular, bodySemi: bf.semi, bold: hf.bold, semi: hf.semi, widthFactor: WIDTH[head] };
}
/** Ancho medio de una letra en negrita, en "em", para calcular cuántas líneas ocupa el titular. */
const WIDTH: Record<keyof typeof FONTS, number> = { montserrat: 0.62, poppins: 0.6, inter: 0.56, oswald: 0.44, "playfair-display": 0.54 };

type Img = { uri: string; w: number; h: number };
/** Descarga una imagen y la deja como data URI (Satori la dibuja sin volver a pedirla). */
async function loadImage(url: string, maxSide = 2000): Promise<Img> {
  // data: (vistas previas), https (tu almacenamiento) o /media/… (archivos en el disco del servidor).
  const input = url.startsWith("data:image/") ? Buffer.from(url.slice(url.indexOf(",") + 1), "base64") : await readMedia(url);
  const img = sharp(input).rotate().resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true });
  const meta = await sharp(input).metadata();
  const png = Boolean(meta.hasAlpha);
  const { data, info } = png ? await img.png().toBuffer({ resolveWithObject: true }) : await img.jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
  return { uri: `data:image/${png ? "png" : "jpeg"};base64,${data.toString("base64")}`, w: info.width, h: info.height };
}

const hostOf = (url = "") => url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

/** Calcula el tamaño del titular para que quepa en `boxW` en como mucho `maxLines` líneas. */
function fitHeadline(text: string, boxW: number, maxLines: number, cap: number, min: number, em: number, upper: boolean, maxH = Infinity): number {
  const words = text.split(" ");
  const lines = (size: number) => {
    const cw = size * em * (upper ? 1.12 : 1);
    const space = size * 0.28;
    let n = 1;
    let cur = 0;
    for (const w of words) {
      const ww = w.length * cw;
      if (cur && cur + space + ww > boxW) {
        n++;
        cur = ww;
      } else cur += (cur ? space : 0) + ww;
      if (ww > boxW) n += Math.floor(ww / boxW);
    }
    return n;
  };
  for (let s = Math.round(cap); s > min; s -= 2) if (lines(s) <= maxLines && lines(s) * s * 1.1 <= maxH) return s;
  return Math.round(min);
}

const GLOBE_PATH = "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z";
const PHONE_PATH = "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z";

/** Dibuja el diseño con la plantilla y lo devuelve en JPEG (Instagram solo acepta JPEG). */
export async function renderDesign(d: DesignInput): Promise<Buffer> {
  if (d.template.custom) return renderCustom(d, d.template.custom);
  const t = d.template;
  const { w, h } = DESIGN_SHAPES[d.shape ?? "square"];
  const b = d.brand;
  const F = await loadFonts(b);
  const c1 = hexOr(b.color, "#126BBC");
  const c2 = hexOr(b.color2, c1);
  const c3 = hexOr(b.color3, c2);
  /** Azul/rojo/… casi negro con el tono de la marca: para sombras y textos sobre blanco. */
  const deep = mix(c1, "#050a14", 0.78);
  const ink = mix("#111827", c1, 0.14);
  let headline = d.headline.trim().replace(/\s+/g, " ").slice(0, 90);
  if (t.uppercase) headline = headline.toUpperCase();
  const steps = (d.steps ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const usePhoto = needsPhoto(t) || (t.layout === "lista" && !!d.photoUrl);
  if (needsPhoto(t) && !d.photoUrl) throw new Error(`La plantilla "${t.name}" necesita una foto.`);

  const [photo, logo, logoLight] = await Promise.all([
    usePhoto && d.photoUrl ? loadImage(d.photoUrl).then((i) => i.uri) : Promise.resolve(""),
    b.logoUrl ? loadImage(b.logoUrl, 800).catch(() => null) : Promise.resolve(null),
    b.logoLightUrl ? loadImage(b.logoLightUrl, 800).catch(() => null) : Promise.resolve(null),
  ]);

  // Medidas: `u` es la unidad (1 en una imagen de 1080 de lado corto). Las historias 9:16 dejan libre
  // arriba y abajo lo que tapan los botones de Instagram/TikTok.
  const u = Math.min(w, h) / 1080;
  const wide = w / h > 1.25;
  const tall = h / w > 1.1;
  const story = h / w > 1.6;
  const pad = Math.round((wide ? 64 : 76) * u);
  const top = story ? Math.round(h * 0.1) : pad;
  const bottom = story ? Math.round(h * 0.15) : pad;
  const center = t.align === "centro";
  const em = F.widthFactor;
  const scale = t.headlineScale;

  // Color de los bloques y el texto que va encima.
  const panelBase = { color1: c1, color2: c2, color3: c3, degradado: c1, blanco: "#ffffff" }[t.background];
  const gradEnd = c2 !== c1 ? c2 : mix(c1, "#000000", 0.32);
  const panelBg = t.background === "degradado" ? `linear-gradient(135deg, ${c1} 0%, ${gradEnd} 100%)` : panelBase;
  const onWhite = t.background === "blanco";
  const panelInk = onWhite ? ink : inkOn(panelBase);
  const panelDark = panelInk === "#ffffff";
  /** Color del detalle (barra, comillas): el de acento si se distingue del fondo. */
  const accentOn = (bg: string, dark: boolean) => (contrast(c3, bg) >= 1.7 ? c3 : contrast(c2, bg) >= 1.7 ? c2 : dark ? "#ffffff" : c1);

  // ---------- Piezas ----------
  const logoH = Math.round((story ? 74 : wide ? 60 : 66) * u);
  const Logo = ({ onDark, maxW = w * 0.4 }: { onDark: boolean; maxW?: number }) => {
    const pic = onDark ? logoLight ?? logo : logo;
    if (!pic) {
      return <div style={{ display: "flex", maxWidth: maxW, fontFamily: F.head, fontSize: Math.round((b.name.length > 22 ? 36 : 44) * u), fontWeight: F.bold, color: onDark ? "#ffffff" : c1, letterSpacing: -0.5, lineHeight: 1.1 }}>{b.name}</div>;
    }
    const lw = Math.min(maxW, Math.round((logoH * pic.w) / pic.h));
    const lh = Math.round((lw * pic.h) / pic.w);
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    const img = <img src={pic.uri} width={lw} height={lh} style={{ width: lw, height: lh }} />;
    // Logo normal sobre algo oscuro: va en una pastilla blanca para que se lea.
    if (onDark && !logoLight) {
      return <div style={{ display: "flex", background: "#ffffff", borderRadius: Math.round(14 * u), padding: `${Math.round(12 * u)}px ${Math.round(18 * u)}px`, boxShadow: "0 6px 24px rgba(0,0,0,0.18)" }}>{img}</div>;
    }
    return img;
  };

  const phone = b.phone?.trim() ?? "";
  const site = hostOf(b.website);
  const contactSize = Math.round((wide ? 31 : 33) * u);
  const Icon = ({ kind, color, size }: { kind: "phone" | "web"; color: string; size: number }) => {
    const shape = kind === "phone" ? `<path d="${PHONE_PATH}"/>` : `<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="${GLOBE_PATH}"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${shape}</svg>`;
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img src={`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`} width={size} height={size} style={{ width: size, height: size }} />;
  };
  /** Teléfono y web en una línea, con íconos. `strong`: el color de la línea; el teléfono va un poco más marcado. */
  /** Ancho aproximado de la línea de contacto (para ponerla en dos líneas si no cabe). */
  const contactW = (size: number) => (phone.length + site.length) * size * 0.56 + (phone && site ? 3 : 1.2) * size + 26 * u;
  const ContactLine = ({ color, iconColor = color, size = contactSize, maxW = w }: { color: string; iconColor?: string; size?: number; maxW?: number }) =>
    phone || site ? (
      <div style={{ display: "flex", flexDirection: contactW(size) > maxW ? "column" : "row", alignItems: contactW(size) > maxW ? "flex-start" : "center", gap: Math.round((contactW(size) > maxW ? 10 : 26) * u), color, fontFamily: F.body, fontSize: size, fontWeight: F.bodySemi, whiteSpace: "nowrap" }}>
        {phone && (
          <div style={{ display: "flex", alignItems: "center", gap: Math.round(10 * u) }}>
            <Icon kind="phone" color={iconColor} size={Math.round(size * 0.92)} />
            <span>{phone}</span>
          </div>
        )}
        {site && (
          <div style={{ display: "flex", alignItems: "center", gap: Math.round(10 * u), fontWeight: F.bodyRegular, opacity: phone ? 0.92 : 1 }}>
            <Icon kind="web" color={iconColor} size={Math.round(size * 0.92)} />
            <span>{site}</span>
          </div>
        )}
      </div>
    ) : null;
  /** Contacto según la plantilla: pastilla de color o línea de texto (la franja va aparte, abajo de todo). */
  const Contact = ({ dark, bg, maxW = w }: { dark: boolean; bg: string; maxW?: number }) => {
    if (t.contactStyle === "franja") return null;
    if (t.contactStyle === "pastilla" && (phone || site)) {
      const pill = dark ? (contrast(c3, bg) >= 1.7 ? c3 : "#ffffff") : c1;
      const fg = inkOn(pill, ink);
      return (
        <div style={{ display: "flex", alignSelf: center ? "center" : "flex-start", background: pill, borderRadius: 999, padding: `${Math.round(14 * u)}px ${Math.round(28 * u)}px` }}>
          <ContactLine color={fg} maxW={maxW - 56 * u} />
        </div>
      );
    }
    return <ContactLine color={dark ? "#ffffff" : ink} iconColor={dark ? accentOn(bg, true) : c1} maxW={maxW} />;
  };
  const barH = t.contactStyle === "franja" && (phone || site) ? Math.round((wide ? 76 : 96) * u) : 0;
  const ContactBar = () =>
    barH ? (
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: barH + (story ? bottom - pad : 0), paddingBottom: story ? bottom - pad : 0, display: "flex", alignItems: "center", justifyContent: "center", background: c1 }}>
        <ContactLine color={inkOn(c1)} iconColor={inkOn(c1) === "#ffffff" && contrast(c3, c1) >= 1.7 ? c3 : inkOn(c1)} />
      </div>
    ) : null;

  const Bar = ({ color }: { color: string }) => <div style={{ display: "flex", alignSelf: center ? "center" : "flex-start", width: Math.round(84 * u), height: Math.round(9 * u), borderRadius: 99, background: color }} />;
  const Quote = ({ color }: { color: string }) => <div style={{ display: "flex", alignSelf: center ? "center" : "flex-start", fontFamily: F.head, fontSize: Math.round(200 * u), fontWeight: F.bold, color, lineHeight: 0.62, height: Math.round(110 * u) }}>“</div>;
  const Accent = ({ bg, dark }: { bg: string; dark: boolean }) =>
    t.accent === "barra" ? <Bar color={accentOn(bg, dark)} /> : t.accent === "comillas" ? <Quote color={accentOn(bg, dark)} /> : null;

  const Headline = ({ color, width, maxLines, cap, shadow, maxH }: { color: string; width: number; maxLines: number; cap: number; shadow?: boolean; maxH?: number }) => {
    const size = fitHeadline(headline, width, maxLines, cap * scale * u, 36 * u, em, t.uppercase, maxH);
    return (
      <div style={{ display: "flex", width, fontFamily: F.head, fontSize: size, fontWeight: F.bold, lineHeight: 1.08, color, letterSpacing: t.uppercase ? Math.round(size * 0.01) : -Math.round(size * 0.02), justifyContent: center ? "center" : "flex-start", textAlign: center ? "center" : "left", textShadow: shadow ? "0 2px 18px rgba(0,0,0,0.35)" : "none" }}>{headline}</div>
    );
  };
  /** Bloque de texto: detalle, titular y contacto. */
  const TextBlock = ({ color, dark, bg, width, height = Infinity, maxLines = 4, cap = 96, shadow, gap = 30 }: { color: string; dark: boolean; bg: string; width: number; height?: number; maxLines?: number; cap?: number; shadow?: boolean; gap?: number }) => {
    const hasContact = t.contactStyle !== "franja" && Boolean(phone || site);
    const contactH = !hasContact ? 0 : (contactW(contactSize) > width ? 2.6 : 1.4) * contactSize + (t.contactStyle === "pastilla" ? 28 * u : 0) + gap * u + 6 * u;
    const accentH = t.accent === "barra" ? (9 + gap) * u : t.accent === "comillas" ? (110 + gap) * u : 0;
    return (
      <div style={{ display: "flex", flexDirection: "column", width, alignItems: center ? "center" : "flex-start", gap: Math.round(gap * u) }}>
        <Accent bg={bg} dark={dark} />
        <Headline color={color} width={width} maxLines={maxLines} cap={cap} shadow={shadow} maxH={height - contactH - accentH} />
        {hasContact && <div style={{ display: "flex", marginTop: Math.round(6 * u) }}><Contact dark={dark} bg={bg} maxW={width} /></div>}
      </div>
    );
  };
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  const Photo = (p: { left?: number; top?: number; width: number; height: number; radius?: number }) => <img src={photo} width={p.width} height={p.height} style={{ position: "absolute", top: p.top ?? 0, left: p.left ?? 0, width: p.width, height: p.height, objectFit: "cover", borderRadius: p.radius ?? 0 }} />;
  const Abs = ({ children, ...s }: { children?: React.ReactNode } & React.CSSProperties) => <div style={{ position: "absolute", display: "flex", ...s }}>{children}</div>;

  /** Dónde va el logo y si queda sobre algo oscuro. Lo decide cada diseño. */
  let logoOnDark = true;
  let logoSpot: React.CSSProperties = t.logoPosition === "arriba-derecha" ? { top, right: pad } : t.logoPosition === "abajo-derecha" ? { bottom: bottom + barH, right: pad } : { top, left: pad };
  let body: React.ReactNode;

  if (t.layout === "foto-completa") {
    // Foto entera con un degradado oscuro (con el tono de la marca) donde va el texto.
    const shade = t.overlay === "fuerte" ? 0.9 : t.overlay === "suave" ? 0.78 : 0.62;
    const pos = t.textPosition;
    const scrim =
      pos === "centro"
        ? `linear-gradient(to bottom, ${rgba(deep, shade * 0.35)} 0%, ${rgba(deep, shade * 0.7)} 50%, ${rgba(deep, shade * 0.35)} 100%)`
        : pos === "arriba"
          ? `linear-gradient(to bottom, ${rgba(deep, shade)} 0%, ${rgba(deep, shade * 0.75)} 35%, ${rgba(deep, 0)} 70%)`
          : `linear-gradient(to bottom, ${rgba(deep, 0)} 28%, ${rgba(deep, shade * 0.7)} 58%, ${rgba(deep, shade)} 100%)`;
    const textW = Math.round(wide ? w * 0.62 : w - pad * 2);
    const textTop = pos === "arriba" ? top + logoH + Math.round(40 * u) : top;
    body = (
      <>
        <Photo width={w} height={h} />
        <Abs top={0} left={0} width={w} height={h} backgroundImage={scrim} />
        {pos !== "arriba" && <Abs top={0} left={0} width={w} height={Math.round(h * 0.28)} backgroundImage={`linear-gradient(to bottom, rgba(0,0,0,0.38), rgba(0,0,0,0))`} />}
        <Abs left={pad} top={textTop} width={textW} height={h - textTop - bottom - barH} flexDirection="column" justifyContent={{ arriba: "flex-start", centro: "center", abajo: "flex-end" }[pos]}>
          <TextBlock color="#ffffff" dark bg={deep} width={textW} height={(h - top - bottom - barH) * (pos === "centro" ? 0.7 : 0.6)} maxLines={wide ? 3 : 4} cap={wide ? 84 : 96} shadow />
        </Abs>
      </>
    );
  } else if (t.layout === "franja-abajo" && onWhite) {
    // Tarjeta blanca flotando sobre la foto.
    const cardW = Math.round(wide ? w * 0.5 : w - pad * 2);
    const inner = Math.round(52 * u);
    body = (
      <>
        <Photo width={w} height={h} />
        <Abs top={0} left={0} width={w} height={Math.round(h * 0.3)} backgroundImage="linear-gradient(to bottom, rgba(0,0,0,0.35), rgba(0,0,0,0))" />
        <Abs left={pad} bottom={bottom + barH} width={cardW} background="#ffffff" borderRadius={Math.round(28 * u)} padding={inner} boxShadow="0 18px 60px rgba(0,0,0,0.28)" flexDirection="column">
          <TextBlock color={ink} dark={false} bg="#ffffff" width={cardW - inner * 2} height={(h - top - bottom - barH) * (wide ? 0.8 : 0.5)} maxLines={3} cap={wide ? 64 : 78} gap={24} />
        </Abs>
      </>
    );
  } else if (t.layout === "franja-arriba" || t.layout === "franja-abajo") {
    // Bloque de color arriba (o abajo) con el titular y la foto en el resto. En formatos anchos, a un lado.
    const first = t.layout === "franja-arriba";
    if (wide) {
      const half = Math.round(w * 0.48);
      const left = first;
      body = (
        <>
          <Abs top={0} left={left ? 0 : w - half} width={half} height={h} background={panelBg} />
          <Photo left={left ? half : 0} width={w - half} height={h - barH} />
          <Abs left={(left ? 0 : w - half) + pad} top={top + logoH + Math.round(30 * u)} width={half - pad * 2} height={h - top - logoH - Math.round(30 * u) - bottom - barH} flexDirection="column" justifyContent="center">
            <TextBlock color={panelInk} dark={panelDark} bg={panelBase} width={half - pad * 2} height={h - top - logoH - Math.round(30 * u) - bottom - barH} maxLines={4} cap={72} />
          </Abs>
        </>
      );
      logoOnDark = panelDark;
      logoSpot = { top, left: (left ? 0 : w - half) + pad };
    } else {
      const band = Math.round(h * (story ? 0.46 : 0.47));
      const textW = w - pad * 2;
      const bandTop = first ? 0 : h - band - barH;
      const boxTop = first ? top + logoH + Math.round(36 * u) : bandTop + Math.round(52 * u);
      const boxH = first ? band - boxTop - Math.round(48 * u) : band - Math.round(52 * u) - (story ? bottom - pad : 0) - Math.round(48 * u);
      const line = accentOn(panelBase, panelDark);
      body = (
        <>
          <Abs top={bandTop} left={0} width={w} height={band + (first ? 0 : barH)} background={panelBg} />
          <Photo top={first ? band : 0} width={w} height={h - band - barH} />
          {line !== panelInk && <Abs top={first ? band - Math.round(5 * u) : bandTop - Math.round(5 * u)} left={0} width={w} height={Math.round(10 * u)} background={line} />}
          <Abs left={pad} top={boxTop} width={textW} height={boxH} flexDirection="column" justifyContent="center">
            <TextBlock color={panelInk} dark={panelDark} bg={panelBase} width={textW} height={boxH} maxLines={3} cap={88} />
          </Abs>
        </>
      );
      logoOnDark = first ? panelDark : true;
    }
  } else if (t.layout === "mitad-izquierda") {
    // Color a un lado y foto al otro. En vertical: foto arriba y color abajo.
    if (tall) {
      const photoH = Math.round(h * (story ? 0.52 : 0.5));
      const textW = w - pad * 2;
      body = (
        <>
          <Abs top={0} left={0} width={w} height={h} background={panelBg} />
          <Photo width={w} height={photoH} />
          <Abs left={pad} top={photoH + Math.round(60 * u)} width={textW} height={h - photoH - Math.round(60 * u) - bottom - barH} flexDirection="column" justifyContent="center">
            <TextBlock color={panelInk} dark={panelDark} bg={panelBase} width={textW} height={h - photoH - Math.round(60 * u) - bottom - barH} maxLines={4} cap={88} />
          </Abs>
        </>
      );
    } else {
      const half = Math.round(w * 0.5);
      const textW = half - pad * 2 + Math.round(10 * u);
      body = (
        <>
          <Abs top={0} left={0} width={half} height={h} background={panelBg} />
          <Photo left={half} width={w - half} height={h - barH} />
          <Abs left={pad} top={top + logoH + Math.round(30 * u)} width={textW} height={h - top - logoH - Math.round(30 * u) - bottom - barH} flexDirection="column" justifyContent="center">
            <TextBlock color={panelInk} dark={panelDark} bg={panelBase} width={textW} height={h - top - logoH - Math.round(30 * u) - bottom - barH} maxLines={5} cap={wide ? 66 : 64} />
          </Abs>
        </>
      );
      logoOnDark = panelDark;
      if (t.logoPosition !== "arriba-izquierda") logoSpot = { top, left: pad };
    }
  } else if (t.layout === "color-solido") {
    // Una frase grande sobre el color de la marca, con un círculo suave de fondo.
    const textW = Math.round(wide ? w * 0.7 : w - pad * 2);
    const ring = Math.round(Math.max(w, h) * 0.62);
    body = (
      <>
        <Abs top={0} left={0} width={w} height={h} background={panelBg} />
        {!onWhite && (
          <>
            <Abs right={-Math.round(ring * 0.32)} top={-Math.round(ring * 0.3)} width={ring} height={ring} borderRadius={ring} border={`${Math.round(56 * u)}px solid ${rgba("#ffffff", 0.07)}`} />
            {t.accent === "circulos" && <Abs left={-Math.round(ring * 0.25)} bottom={-Math.round(ring * 0.35)} width={Math.round(ring * 0.7)} height={Math.round(ring * 0.7)} borderRadius={ring} background={rgba(c3, 0.35)} />}
          </>
        )}
        <Abs left={pad} top={top + logoH + Math.round(40 * u)} width={textW} height={h - top - logoH - Math.round(40 * u) - bottom - barH} flexDirection="column" justifyContent={{ arriba: "flex-start", centro: "center", abajo: "flex-end" }[t.textPosition]}>
          <TextBlock color={panelInk} dark={panelDark} bg={panelBase} width={textW} height={h - top - logoH - Math.round(40 * u) - bottom - barH} maxLines={5} cap={wide ? 80 : 104} />
        </Abs>
      </>
    );
    logoOnDark = panelDark;
  } else {
    // Lista de pasos: fondo claro, titular oscuro y tarjetas numeradas.
    const soft = mix("#ffffff", c1, 0.05);
    const textW = Math.round(wide && photo ? w * 0.56 - pad : w - pad * 2);
    const photoH = photo && !wide ? Math.round(h * (story ? 0.3 : tall ? 0.3 : 0.27)) : 0;
    const startY = photoH ? photoH + Math.round(48 * u) : top + logoH + Math.round(44 * u);
    const stepSize = Math.round((wide ? 28 : tall ? 40 : 34) * u);
    const num = Math.round((wide ? 50 : tall ? 70 : 60) * u);
    body = (
      <>
        <Abs top={0} left={0} width={w} height={h} background={soft} />
        {photo && !wide && (
          <>
            <Photo width={w} height={photoH} />
            <Abs top={0} left={0} width={w} height={photoH} backgroundImage={`linear-gradient(to bottom, rgba(0,0,0,0.32), rgba(0,0,0,0) 45%, ${rgba(deep, t.overlay === "ninguna" ? 0 : 0.25)})`} />
          </>
        )}
        {photo && wide && <Photo left={Math.round(w * 0.56)} top={0} width={w - Math.round(w * 0.56)} height={h - barH} />}
        <Abs left={pad} top={startY} width={textW} height={h - startY - bottom - barH} flexDirection="column" justifyContent="center" gap={Math.round((tall ? 40 : 30) * u)}>
          <Headline color={ink} width={textW} maxLines={3} cap={wide ? 58 : tall ? 90 : 76} maxH={h - startY - bottom - barH - steps.length * (num + 52 * u) - 30 * u - (t.contactStyle !== "franja" && (phone || site) ? 80 * u : 0)} />
          <div style={{ display: "flex", flexDirection: "column", width: textW, gap: Math.round(16 * u) }}>
            {steps.map((s, i) => (
              <div key={i} style={{ display: "flex", width: textW, alignItems: "center", gap: Math.round(22 * u), background: "#ffffff", borderRadius: Math.round(18 * u), padding: `${Math.round(18 * u)}px ${Math.round(22 * u)}px`, boxShadow: `0 4px 18px ${rgba(c1, 0.1)}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: num, height: num, borderRadius: num, background: [c1, contrast(c3, "#ffffff") >= 1.7 ? c3 : c2, c2][i] ?? c1, color: "#ffffff", fontFamily: F.head, fontSize: Math.round(num * 0.48), fontWeight: F.bold, flexShrink: 0 }}>{i + 1}</div>
                <div style={{ display: "flex", flex: 1, fontFamily: F.body, fontSize: stepSize, fontWeight: F.bodySemi, color: ink, lineHeight: 1.25 }}>{s}</div>
              </div>
            ))}
          </div>
          {t.contactStyle !== "franja" && (phone || site) && <Contact dark={false} bg={soft} />}
        </Abs>
      </>
    );
    logoOnDark = Boolean(photo) && !wide;
  }

  const img = new ImageResponse(
    (
      <div style={{ width: w, height: h, display: "flex", position: "relative", fontFamily: F.head, background: c1 }}>
        {body}
        <ContactBar />
        <div style={{ position: "absolute", display: "flex", ...logoSpot }}><Logo onDark={logoOnDark} /></div>
      </div>
    ),
    { width: w, height: h, fonts: F.fonts },
  );
  const png = Buffer.from(await img.arrayBuffer());
  return sharp(png).jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
}

// ---------- Plantillas propias (subidas por el dueño) ----------

/**
 * Dibuja una plantilla propia: la imagen del dueño, la foto y el titular. Se dibuja con la forma de la
 * imagen subida; si la red pide otra forma, se centra sobre un fondo desenfocado (sin cortar el diseño).
 */
async function renderCustom(d: DesignInput, c: CustomSpec): Promise<Buffer> {
  const target = DESIGN_SHAPES[d.shape ?? "square"];
  const F = await loadFonts(d.brand);
  const c1 = hexOr(d.brand.color, "#126BBC");
  const ratio = c.w / c.h;
  const W = ratio >= 1 ? 1200 : Math.round(1200 * ratio);
  const H = ratio >= 1 ? Math.round(1200 / ratio) : 1200;
  const u = Math.min(W, H) / 1080;
  const [art, photo] = await Promise.all([loadImage(c.imageUrl, 1600), c.photo !== "ninguna" && d.photoUrl ? loadImage(d.photoUrl) : Promise.resolve(null)]);
  if (c.photo !== "ninguna" && !photo) throw new Error(`La plantilla "${d.template.name}" necesita una foto.`);
  const headline = d.headline.trim().replace(/\s+/g, " ").slice(0, 90);
  const color = c.ink === "claro" ? "#ffffff" : c.ink === "oscuro" ? "#111827" : c1;
  const tb = textBox(c);
  const box = c.mode === "fondo" && c.photo !== "completa" && c.photo !== "ninguna" ? PHOTO_BOXES[c.photo] : null;
  const px = (b: Box) => ({ left: Math.round(b.x * W), top: Math.round(b.y * H), width: Math.round(b.w * W), height: Math.round(b.h * H) });
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  const Pic = ({ src, b, radius = 0, fit = "cover" }: { src: string; b: { left: number; top: number; width: number; height: number }; radius?: number; fit?: "cover" | "fill" }) => <img src={src} width={b.width} height={b.height} style={{ position: "absolute", ...b, objectFit: fit, borderRadius: radius }} />;
  const full = { left: 0, top: 0, width: W, height: H };
  const size = tb ? fitHeadline(headline, tb.w * W, 3, 92 * u, 34 * u, F.widthFactor, false) : 0;
  const img = new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", position: "relative", background: "#ffffff", fontFamily: F.head }}>
        {c.mode === "fondo" && <Pic src={art.uri} b={full} fit="fill" />}
        {photo && (box ? <Pic src={photo.uri} b={px(box)} radius={Math.round(24 * u)} /> : <Pic src={photo.uri} b={full} />)}
        {/* Letras claras sobre la foto: un degradado suave detrás para que se lean. */}
        {photo && tb && headline && c.ink === "claro" && (!box || c.mode === "marco") && (
          <div style={{ position: "absolute", display: "flex", left: 0, width: W, top: tb.y < 0.3 ? 0 : tb.y > 0.5 ? Math.round(H * 0.45) : Math.round(H * 0.25), height: Math.round(H * (tb.y < 0.3 || tb.y > 0.5 ? 0.55 : 0.5)), backgroundImage: tb.y < 0.3 ? "linear-gradient(to bottom, rgba(0,0,0,0.6), rgba(0,0,0,0))" : tb.y > 0.5 ? "linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.6))" : "linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.45), rgba(0,0,0,0))" }} />
        )}
        {c.mode === "marco" && <Pic src={art.uri} b={full} fit="fill" />}
        {tb && headline && (
          <div style={{ position: "absolute", display: "flex", ...px(tb), alignItems: tb.y < 0.2 ? "flex-start" : tb.y > 0.5 ? "flex-end" : "center" }}>
            <div style={{ display: "flex", width: Math.round(tb.w * W), fontSize: size, fontWeight: F.bold, lineHeight: 1.08, color, letterSpacing: -Math.round(size * 0.02), textShadow: c.ink === "claro" ? "0 2px 16px rgba(0,0,0,0.45)" : "none" }}>{headline}</div>
          </div>
        )}
      </div>
    ),
    { width: W, height: H, fonts: F.fonts },
  );
  const png = Buffer.from(await img.arrayBuffer());
  return fitToShape(png, target.w, target.h);
}

/**
 * Lleva una imagen terminada (con texto) a otra forma SIN cortar nada: si la forma es casi igual, la
 * ajusta; si no, la centra sobre una copia desenfocada y oscurecida de sí misma.
 */
export async function fitToShape(input: Buffer, w: number, h: number): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const ratio = (meta.width ?? w) / (meta.height ?? h);
  const want = w / h;
  if (Math.abs(ratio - want) / want < 0.04) return sharp(input).resize(w, h, { fit: "cover" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  const back = await sharp(input).resize(w, h, { fit: "cover" }).blur(38).modulate({ brightness: 0.72 }).toBuffer();
  const front = await sharp(input).resize(w, h, { fit: "inside" }).toBuffer();
  return sharp(back).composite([{ input: front, gravity: "center" }]).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/** Foto de ejemplo para las vistas previas cuando el negocio todavía no tiene fotos. */
export async function samplePhoto(color: string): Promise<string> {
  const c = hexOr(color, "#126BBC");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe0f3"/><stop offset="1" stop-color="${c}"/></linearGradient></defs><rect width="1080" height="1080" fill="url(#g)"/><circle cx="780" cy="300" r="160" fill="#ffffff" opacity="0.35"/><path d="M0 820 L300 560 L520 760 L760 520 L1080 840 L1080 1080 L0 1080 Z" fill="#ffffff" opacity="0.25"/></svg>`;
  const jpg = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString("base64")}`;
}
