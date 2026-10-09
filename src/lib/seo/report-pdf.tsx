// El reporte de SEO y marketing en PDF (@react-pdf/renderer, JS puro: funciona en las funciones de Vercel).
// Letras: los títulos con la letra de la marca (los WOFF de src/assets/fonts, sin descargar nada) y el texto con
// Helvetica (incluida en todo PDF). Los íconos (▲ ▼ ★) se dibujan con Svg porque esas letras no los traen.
import { existsSync } from "fs";
import path from "path";
import { Document, Font, Image, Page, Polygon, Rect, renderToBuffer, Svg, Text, View, Line } from "@react-pdf/renderer";
import sharp from "sharp";
import { FONTS, fontId } from "@/lib/design-shapes";
import { intlLocale, translator, type UiLang } from "@/lib/i18n";
import { BUSINESS_TZ } from "@/lib/time";
import { isPrivateHost } from "@/lib/seo/audit";
import { hintText, HINT_EASY } from "@/lib/seo/backlinks";
import { severityLabel } from "@/lib/seo/cannibal";
import { rankBand, type RankBand } from "@/lib/seo/maprank-shared";
import { aiVerdict, mapVerdict, organicVerdict } from "@/lib/seo/sov";
import { visitsText } from "@/lib/seo/traffic";
import {
  channelLabel,
  isEmptyReport,
  kpiValue,
  periodLabel,
  reportKpis,
  setupHints,
  whatChanged,
  type Delta,
  type Kpi,
  type ReportData,
  type ReportSummary,
  type Tone,
} from "@/lib/seo/report";

// ---------- Letras ----------

const BODY = "Helvetica";
const BODY_BOLD = "Helvetica-Bold";
const registered = new Set<string>();
let hyphenationOff = false;

/** Registra la letra de títulos de la marca (una vez por proceso). Si falta el archivo, Helvetica negrita. */
export function headingFont(fontHeading: string): { family: string; semi: number; bold: number } {
  if (!hyphenationOff) {
    // Sin guiones al cortar palabras: los patrones son del inglés y cortan mal el español.
    Font.registerHyphenationCallback((word) => [word]);
    hyphenationOff = true;
  }
  const id = fontId(fontHeading);
  const f = FONTS[id];
  const family = `Report-${id}`;
  if (registered.has(family)) return { family, semi: f.semi, bold: f.bold };
  const dir = path.join(process.cwd(), "src/assets/fonts");
  const semi = path.join(dir, `${id}-${f.semi}.woff`);
  const bold = path.join(dir, `${id}-${f.bold}.woff`);
  if (!existsSync(semi) || !existsSync(bold)) return { family: BODY_BOLD, semi: 400, bold: 400 };
  Font.register({ family, fonts: [{ src: semi, fontWeight: f.semi }, { src: bold, fontWeight: f.bold }] });
  registered.add(family);
  return { family, semi: f.semi, bold: f.bold };
}

// ---------- Colores ----------

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
function normHex(c: string | null | undefined): string | null {
  const m = (c ?? "").trim().match(HEX);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((x) => x + x).join("") : m[1];
  return `#${h.toLowerCase()}`;
}
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
/** Mezcla dos colores (t = 0 → a, 1 → b). */
export const mix = (a: string, b: string, t: number) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const luminance = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export type Palette = { primary: string; secondary: string; accent: string; onPrimary: string; strong: string; soft: string; chart: string[] };

/** Los colores del reporte a partir de la marca (con respaldos si faltan o no son válidos). */
export function palette(color: string, color2: string, color3: string): Palette {
  const primary = normHex(color) ?? "#126bbc";
  const secondary = normHex(color2) ?? mix(primary, "#000000", 0.35);
  const accent = normHex(color3) ?? mix(primary, "#ffffff", 0.55);
  const light = luminance(primary) > 0.6;
  return {
    primary,
    secondary,
    accent,
    onPrimary: light ? "#111827" : "#ffffff",
    // Para títulos y números sobre blanco: si la marca es muy clara, una versión más oscura.
    strong: luminance(primary) > 0.5 ? mix(primary, "#000000", 0.55) : primary,
    soft: mix(primary, "#ffffff", 0.92),
    // Colores para barras: los muy claros (casi blancos) no se ven sobre el papel.
    chart: [primary, secondary, accent, mix(primary, "#ffffff", 0.45), mix(secondary, "#000000", 0.25)].filter((x) => luminance(x) < 0.82),
  };
}

const INK = "#1f2933";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const ZEBRA = "#f8fafc";
const GOOD = "#067647";
const BAD = "#b42318";
const BAND: Record<RankBand, string> = { top3: "#16a34a", good: "#84cc16", mid: "#f59e0b", low: "#ef4444", none: "#9ca3af", error: "#e5e7eb" };
const SEVERITY: Record<string, string> = { error: "#dc2626", warning: "#f59e0b", notice: "#9ca3af" };
const toneColor = (t: Tone) => (t === "good" ? GOOD : t === "bad" ? BAD : MUTED);

// ---------- Logo ----------

export type LogoSource = { data: Buffer; format: "png" | "jpg" };
const MAX_LOGO_BYTES = 5_000_000;
const isPng = (b: Buffer) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/**
 * Trae el logo (URL pública) con poco tiempo de espera y lo deja como PNG chico (sharp también convierte WebP, SVG o GIF).
 * null si falla, tarda, es muy grande, es una dirección interna o no es una imagen: el reporte sale sin logo.
 */
export async function loadLogo(url: string, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<LogoSource | null> {
  try {
    const u = new URL(url.trim());
    if (!/^https?:$/.test(u.protocol) || isPrivateHost(u.hostname)) return null;
    const res = await (opts.fetchImpl ?? fetch)(u.toString(), { signal: AbortSignal.timeout(opts.timeoutMs ?? 4000), redirect: "follow" });
    if (!res.ok || Number(res.headers.get("content-length") ?? 0) > MAX_LOGO_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_LOGO_BYTES) return null;
    return await normalizeLogo(buf);
  } catch {
    return null;
  }
}

/** PNG de máximo 480 px (mantiene la transparencia). Si sharp no puede, el original si ya es PNG o JPG. */
export async function normalizeLogo(buf: Buffer): Promise<LogoSource | null> {
  try {
    const png = await sharp(buf, { limitInputPixels: 40_000_000 }).resize(480, 480, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    return { data: png, format: "png" };
  } catch {
    if (isPng(buf)) return { data: buf, format: "png" };
    if (isJpg(buf)) return { data: buf, format: "jpg" };
    return null;
  }
}

// ---------- Ayudantes de texto ----------

/** Corta los textos muy largos con "…". */
export const trunc = (s: string, n: number) => {
  const x = (s ?? "").replace(/\s+/g, " ").trim();
  return x.length > n ? `${x.slice(0, n - 1).trimEnd()}…` : x;
};

type Ctx = {
  lang: UiLang;
  t: (es: string, en: string) => string;
  nf: Intl.NumberFormat;
  int: Intl.NumberFormat;
  pal: Palette;
  head: { family: string; semi: number; bold: number };
  day: (iso: string) => string;
  pct: (n: number) => string;
};

// ---------- Piezas ----------

function Triangle({ up, color, size = 6 }: { up: boolean; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 10 10">
      <Polygon points={up ? "0,9 5,1 10,9" : "0,1 10,1 5,9"} fill={color} />
    </Svg>
  );
}

/** Flecha → dibujada (Helvetica no la trae). */
function ArrowRight({ color, size = 7 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 10 10">
      <Line x1={0.5} y1={5} x2={8} y2={5} stroke={color} strokeWidth={1.4} />
      <Polygon points="5.5,2 9.5,5 5.5,8" fill={color} />
    </Svg>
  );
}

const STAR = "5,0.4 6.2,3.8 9.8,3.9 6.9,6.1 8,9.6 5,7.5 2,9.6 3.1,6.1 0.2,3.9 3.8,3.8";
function Star({ size = 10, color = "#f59e0b" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 10 10">
      <Polygon points={STAR} fill={color} />
    </Svg>
  );
}

/** "▲ 2,3" en verde o "▼ 1" en rojo. `lowerIsBetter`: para posiciones se muestra cuánto subió (positivo = mejor). */
function DeltaTag({ d, c, lowerIsBetter, unit = "", size = 7.5, empty }: { d: Delta; c: Ctx; lowerIsBetter?: boolean; unit?: string; size?: number; empty?: string }) {
  if (d.diff === null || d.before === null) return empty ? <Text style={{ fontSize: size, color: MUTED }}>{empty}</Text> : null;
  if (d.diff === 0 || d.tone === "neutral") return <Text style={{ fontSize: size, color: MUTED }}>{c.t("= igual", "= same")}</Text>;
  const shown = lowerIsBetter ? -d.diff : d.diff;
  const color = toneColor(d.tone);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      <Triangle up={shown > 0} color={color} size={size - 1} />
      <Text style={{ fontSize: size, color, fontFamily: BODY_BOLD }}>
        {c.nf.format(Math.abs(shown))}
        {unit}
      </Text>
    </View>
  );
}

function SectionTitle({ title, c, subtitle }: { title: string; c: Ctx; subtitle?: string }) {
  return (
    <View style={{ marginTop: 18, marginBottom: 8 }} minPresenceAhead={90}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 4, height: 16, backgroundColor: c.pal.primary, borderRadius: 2 }} />
        <Text style={{ fontFamily: c.head.family, fontWeight: c.head.bold, fontSize: 15, color: c.pal.strong }}>{title}</Text>
      </View>
      {subtitle ? <Text style={{ fontSize: 8.5, color: MUTED, marginTop: 3, marginLeft: 12 }}>{subtitle}</Text> : null}
    </View>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 4, lineHeight: 1.35 }}>{children}</Text>;
}

function Card({ children, style }: { children: React.ReactNode; style?: Record<string, unknown> }) {
  return (
    <View style={{ borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 10, backgroundColor: "#ffffff", ...style }} wrap={false}>
      {children}
    </View>
  );
}

function Stat({ label, value, c, delta, extra, width }: { label: string; value: string; c: Ctx; delta?: React.ReactNode; extra?: React.ReactNode; width: number | string }) {
  return (
    <View style={{ width, borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 8, backgroundColor: "#ffffff" }}>
      <Text style={{ fontSize: 7, color: MUTED, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }}>
        <Text style={{ fontFamily: c.head.family, fontWeight: c.head.bold, fontSize: 15, color: INK }}>{value}</Text>
        {extra}
      </View>
      {delta ? <View style={{ marginTop: 2 }}>{delta}</View> : null}
    </View>
  );
}

// ---------- Portada e indicadores ----------

function Cover({ d, c, logo, summaryDate }: { d: ReportData; c: Ctx; logo: LogoSource | null; summaryDate: string }) {
  const p = c.pal;
  return (
    <View style={{ marginTop: -40, marginHorizontal: -40, marginBottom: 14 }}>
      <View style={{ backgroundColor: p.primary, paddingHorizontal: 40, paddingTop: 30, paddingBottom: 24, flexDirection: "row", alignItems: "center", gap: 16 }}>
        {logo ? (
          <View style={{ width: 70, height: 70, backgroundColor: "#ffffff", borderRadius: 10, padding: 6, alignItems: "center", justifyContent: "center" }}>
            <Image src={logo} style={{ width: 58, height: 58, objectFit: "contain" }} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 10, color: p.onPrimary, opacity: 0.85, fontFamily: BODY_BOLD, letterSpacing: 0.5 }}>{trunc(d.business.name, 70).toUpperCase()}</Text>
          <Text style={{ fontFamily: c.head.family, fontWeight: c.head.bold, fontSize: 23, color: p.onPrimary, marginTop: 3 }}>{c.t("Reporte de SEO y marketing", "SEO & marketing report")}</Text>
          <Text style={{ fontSize: 12, color: p.onPrimary, marginTop: 4, fontFamily: BODY_BOLD }}>{periodLabel(d.period, c.lang)}</Text>
          <Text style={{ fontSize: 8.5, color: p.onPrimary, opacity: 0.85, marginTop: 3 }}>
            {c.t(`Preparado el ${summaryDate}`, `Prepared on ${summaryDate}`)}
            {d.business.website ? `  ·  ${trunc(d.business.website.replace(/^https?:\/\//, "").replace(/\/$/, ""), 50)}` : ""}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: "row" }}>
        <View style={{ flex: 3, height: 4, backgroundColor: p.chart[1] ?? p.secondary }} />
        <View style={{ flex: 1, height: 4, backgroundColor: p.chart[2] ?? p.strong }} />
      </View>
    </View>
  );
}

function KpiTile({ k, c }: { k: Kpi; c: Ctx }) {
  const value = kpiValue(k, c.lang);
  return (
    <View style={{ width: "32%", borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 10, backgroundColor: c.pal.soft }}>
      <Text style={{ fontSize: 7.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.4 }}>{k.label[c.lang]}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
        <Text style={{ fontFamily: c.head.family, fontWeight: c.head.bold, fontSize: 20, color: c.pal.strong }}>{k.format === "rating" ? value.replace(" ★", "") : value}</Text>
        {k.format === "rating" ? <Star size={13} /> : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3, minHeight: 10 }}>
        <DeltaTag d={k.delta} c={c} lowerIsBetter={k.format === "pos"} unit={k.format === "pct" ? " pts" : ""} empty={k.format === "rating" ? "" : c.t("sin dato anterior", "no earlier data")} />
        {k.delta.diff !== null && k.delta.before !== null ? <Text style={{ fontSize: 7, color: MUTED }}>{c.t("vs. periodo anterior", "vs. previous period")}</Text> : null}
      </View>
      {k.note ? <Text style={{ fontSize: 7, color: MUTED, marginTop: 2 }}>{trunc(k.note[c.lang], 48)}</Text> : null}
    </View>
  );
}

function Kpis({ d, c }: { d: ReportData; c: Ctx }) {
  const kpis = reportKpis(d);
  if (!kpis.length) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, rowGap: 8, justifyContent: "flex-start" }} wrap={false}>
      {kpis.map((k) => (
        <KpiTile key={k.id} k={k} c={c} />
      ))}
    </View>
  );
}

// ---------- Resumen ----------

function Summary({ d, c, summary }: { d: ReportData; c: Ctx; summary: ReportSummary }) {
  const changes = whatChanged(d, c.lang).slice(0, 6);
  return (
    <View>
      <SectionTitle title={c.t("Resumen", "Summary")} c={c} />
      <Text style={{ fontSize: 10, lineHeight: 1.5, color: INK }}>{trunc(summary.summary, 1500)}</Text>
      {summary.source === "ai" ? <Note>{c.t("Escrito por la IA solo con los datos de este reporte.", "Written by AI using only the data in this report.")}</Note> : null}
      <View style={{ flexDirection: "row", gap: 12, marginTop: 10 }} wrap={false}>
        <View style={{ flex: 1, backgroundColor: c.pal.soft, borderRadius: 8, padding: 10 }}>
          <Text style={{ fontFamily: c.head.family, fontWeight: c.head.semi, fontSize: 11, color: c.pal.strong, marginBottom: 6 }}>{c.t("Próximos pasos", "Next steps")}</Text>
          {summary.steps.map((s, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 6, marginBottom: 5 }}>
              <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c.pal.primary, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 8, color: c.pal.onPrimary, fontFamily: BODY_BOLD }}>{i + 1}</Text>
              </View>
              <Text style={{ flex: 1, fontSize: 9, lineHeight: 1.4, color: INK }}>{trunc(s, 260)}</Text>
            </View>
          ))}
        </View>
        {changes.length ? (
          <View style={{ flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 10 }}>
            <Text style={{ fontFamily: c.head.family, fontWeight: c.head.semi, fontSize: 11, color: c.pal.strong, marginBottom: 6 }}>{c.t("Lo que cambió", "What changed")}</Text>
            {changes.map((x, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 5, marginBottom: 4, alignItems: "flex-start" }}>
                <View style={{ marginTop: 2 }}>
                  {x.tone === "neutral" ? <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: MUTED }} /> : <Triangle up={x.tone === "good"} color={toneColor(x.tone)} />}
                </View>
                <Text style={{ flex: 1, fontSize: 8.5, lineHeight: 1.35, color: INK }}>{trunc(x.text, 200)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ---------- Gráficas (Svg) ----------

/** Barras verticales con su número arriba y el nombre abajo. */
function BarChart({ bars, width, height, c }: { bars: { label: string; value: number; color: string }[]; width: number; height: number; c: Ctx }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const top = 14;
  const bottom = 16;
  const chartH = height - top - bottom;
  const slot = width / Math.max(1, bars.length);
  const bw = Math.min(46, slot * 0.6);
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Line x1={0} y1={top + chartH} x2={width} y2={top + chartH} stroke={LINE} strokeWidth={1} />
      {bars.map((b, i) => {
        const h = Math.max(b.value ? 2 : 0, (b.value / max) * chartH);
        const x = i * slot + (slot - bw) / 2;
        return (
          <Rect key={`r${i}`} x={x} y={top + chartH - h} width={bw} height={h} fill={b.color} rx={2} ry={2} />
        );
      })}
      {bars.map((b, i) => {
        const h = (b.value / max) * chartH;
        const cx = i * slot + slot / 2;
        return (
          <Text key={`v${i}`} x={cx} y={top + chartH - h - 3} style={{ fontSize: 8, fontFamily: BODY_BOLD }} fill={INK} textAnchor="middle">
            {c.int.format(b.value)}
          </Text>
        );
      })}
      {bars.map((b, i) => (
        <Text key={`l${i}`} x={i * slot + slot / 2} y={height - 4} style={{ fontSize: 7 }} fill={MUTED} textAnchor="middle">
          {trunc(b.label, 16)}
        </Text>
      ))}
    </Svg>
  );
}

/** Barras horizontales (0-100) con una marca fina donde estaba antes. */
function MeterRow({ label, now, before, c, color }: { label: string; now: number; before: number | null; c: Ctx; color: string }) {
  const W = 220;
  const H = 10;
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <Text style={{ width: 70, fontSize: 9, color: INK }}>{label}</Text>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Rect x={0} y={0} width={W} height={H} fill="#eef1f5" rx={5} ry={5} />
        <Rect x={0} y={0} width={(clamp(now) / 100) * W} height={H} fill={color} rx={5} ry={5} />
        {before !== null ? <Rect x={Math.max(0, (clamp(before) / 100) * W - 1)} y={-1} width={2} height={H + 2} fill={INK} /> : null}
      </Svg>
      <Text style={{ fontSize: 9, fontFamily: BODY_BOLD, color: INK, width: 34 }}>{c.pct(now)}</Text>
      {before !== null ? <Text style={{ fontSize: 7.5, color: MUTED }}>{c.t(`antes ${c.pct(before)}`, `before ${c.pct(before)}`)}</Text> : null}
    </View>
  );
}

// ---------- Posiciones en Google ----------

function Th({ children, flex, align = "left" }: { children: React.ReactNode; flex: number; align?: "left" | "right" | "center" }) {
  return <Text style={{ flex, fontSize: 7.5, color: MUTED, textAlign: align, textTransform: "uppercase", letterSpacing: 0.3 }}>{children}</Text>;
}

function CellValue({ value, delta, c, lowerIsBetter, flex, unit }: { value: string; delta: Delta; c: Ctx; lowerIsBetter?: boolean; flex: number; unit?: string }) {
  return (
    <View style={{ flex, alignItems: "flex-end" }}>
      <Text style={{ fontSize: 9.5, fontFamily: BODY_BOLD, color: INK }}>{value}</Text>
      <DeltaTag d={delta} c={c} lowerIsBetter={lowerIsBetter} unit={unit} size={7} />
    </View>
  );
}

function RankSectionView({ d, c }: { d: ReportData; c: Ctx }) {
  const r = d.rank;
  if (!r) return null;
  const z0 = r.zones[0];
  const zoneCols = r.zones.slice(0, 4);
  const pos = (p: number | null) => (p === null ? ">20" : String(p));
  const comparedAt = r.zones.find((z) => z.baseDate)?.baseDate;
  const total = r.distribution.top3 + r.distribution.top10 + r.distribution.top20 + r.distribution.out;
  return (
    <View break>
      <SectionTitle
        title={c.t("Posiciones en Google", "Google rankings")}
        subtitle={c.t("Dónde sales en Google (celular) con las búsquedas que sigues. Posición: más bajo es mejor.", "Where you show up on Google (mobile) for the searches you track. Position: lower is better.")}
        c={c}
      />
      <Card style={{ padding: 0 }}>
        <View style={{ flexDirection: "row", paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1, borderColor: LINE }}>
          <Th flex={2.4}>{c.t("Zona", "Area")}</Th>
          <Th flex={1.2} align="right">{c.t("Posición prom.", "Avg. position")}</Th>
          <Th flex={0.8} align="right">Top 3</Th>
          <Th flex={0.8} align="right">Top 10</Th>
          <Th flex={1.1} align="right">{c.t("Visibilidad", "Visibility")}</Th>
        </View>
        {r.zones.map((z, i) => (
          <View key={z.code} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, backgroundColor: i % 2 ? ZEBRA : "#ffffff" }}>
            <View style={{ flex: 2.4 }}>
              <Text style={{ fontSize: 9.5, fontFamily: BODY_BOLD, color: INK }}>{trunc(z.label, 40)}</Text>
              <Text style={{ fontSize: 7, color: MUTED }}>
                {c.t(`${z.keywords} palabras · revisión del ${c.day(z.date)}`, `${z.keywords} keywords · checked ${c.day(z.date)}`)}
                {z.stale ? c.t(" (antes del periodo)", " (before the period)") : ""}
              </Text>
            </View>
            <CellValue flex={1.2} value={z.avgPosition.now === null ? "—" : c.nf.format(z.avgPosition.now)} delta={z.avgPosition} c={c} lowerIsBetter />
            <CellValue flex={0.8} value={String(z.inTop3.now ?? 0)} delta={z.inTop3} c={c} />
            <CellValue flex={0.8} value={String(z.inTop10.now ?? 0)} delta={z.inTop10} c={c} />
            <CellValue flex={1.1} value={`${c.nf.format(z.visibility.now ?? 0)}/100`} delta={z.visibility} c={c} />
          </View>
        ))}
      </Card>
      <Note>
        {comparedAt
          ? c.t(`Las flechas comparan con la revisión del ${c.day(comparedAt)} (cómo estabas al empezar el periodo). Visibilidad: 100 = primero en todo.`, `Arrows compare with the check on ${c.day(comparedAt)} (where you stood when the period started). Visibility: 100 = first for everything.`)
          : c.t("Todavía no hay una revisión anterior para comparar. Visibilidad: 100 = primero en todo.", "There's no earlier check to compare with yet. Visibility: 100 = first for everything.")}
      </Note>

      <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }} wrap={false}>
        {total ? (
          <Card style={{ width: 230 }}>
            <Text style={{ fontSize: 9, fontFamily: BODY_BOLD, color: INK, marginBottom: 4 }}>
              {c.t("Tus palabras por posición", "Your keywords by position")}
              {r.zones.length > 1 ? ` · ${trunc(z0.label, 22)}` : ""}
            </Text>
            <BarChart
              width={208}
              height={120}
              c={c}
              bars={[
                { label: "1-3", value: r.distribution.top3, color: BAND.top3 },
                { label: "4-10", value: r.distribution.top10, color: BAND.good },
                { label: "11-20", value: r.distribution.top20, color: BAND.mid },
                { label: c.t("No sale", "Not in 20"), value: r.distribution.out, color: BAND.none },
              ]}
            />
          </Card>
        ) : null}
        <View style={{ flex: 1, gap: 8 }}>
          {r.climbs.length ? <MoverList title={c.t("Lo que más subió", "Biggest climbs")} items={r.climbs} up c={c} /> : null}
          {r.drops.length ? <MoverList title={c.t("Lo que más bajó", "Biggest drops")} items={r.drops} up={false} c={c} /> : null}
          {!r.climbs.length && !r.drops.length ? (
            <Card>
              <Text style={{ fontSize: 9, color: MUTED }}>{c.t("No hubo cambios de posición para comparar en este periodo.", "There were no position changes to compare in this period.")}</Text>
            </Card>
          ) : null}
        </View>
      </View>

      {r.keywords.length ? (
        <View style={{ marginTop: 12 }}>
          <View style={{ flexDirection: "row", paddingHorizontal: 8, paddingVertical: 5, backgroundColor: c.pal.soft, borderTopLeftRadius: 6, borderTopRightRadius: 6 }} wrap={false} minPresenceAhead={40}>
            <Th flex={3}>{c.t("Palabra clave", "Keyword")}</Th>
            <Th flex={1.1} align="right">{c.t("Búsquedas/mes", "Searches/mo")}</Th>
            {zoneCols.map((z) => (
              <Th key={z.code} flex={1.1} align="right">
                {zoneCols.length > 1 ? trunc(z.label.split(",")[0], 14) : c.t("Posición", "Position")}
              </Th>
            ))}
          </View>
          {r.keywords.map((k, i) => (
            <View key={k.keyword} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 4, backgroundColor: i % 2 ? ZEBRA : "#ffffff", borderBottomWidth: 0.5, borderColor: LINE }} wrap={false}>
              <Text style={{ flex: 3, fontSize: 8.5, color: INK }}>{trunc(k.keyword, 48)}</Text>
              <Text style={{ flex: 1.1, fontSize: 8.5, color: INK, textAlign: "right" }}>{k.volume === null ? "—" : c.int.format(k.volume)}</Text>
              {zoneCols.map((z, zi) => {
                const cell = k.cells[zi];
                if (!cell || cell.missing) return <Text key={z.code} style={{ flex: 1.1, fontSize: 8.5, color: MUTED, textAlign: "right" }}>—</Text>;
                if (cell.error) return <Text key={z.code} style={{ flex: 1.1, fontSize: 8, color: MUTED, textAlign: "right" }}>{c.t("error", "error")}</Text>;
                const before = cell.before;
                const diff = before === undefined ? null : (before ?? 21) - (cell.now ?? 21);
                return (
                  <View key={z.code} style={{ flex: 1.1, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 3 }}>
                    <Text style={{ fontSize: 8.5, fontFamily: BODY_BOLD, color: cell.now !== null && cell.now <= 3 ? GOOD : INK }}>{pos(cell.now)}</Text>
                    {diff ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
                        <Triangle up={diff > 0} color={diff > 0 ? GOOD : BAD} size={5} />
                        <Text style={{ fontSize: 6.5, color: diff > 0 ? GOOD : BAD }}>{Math.abs(diff)}</Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))}
          <Note>
            {c.t(
              "«>20» = no sale en las 2 primeras páginas. Las flechas muestran cuántos lugares subió o bajó desde el inicio del periodo.",
              "\">20\" = not on the first 2 pages. Arrows show how many places it moved since the start of the period.",
            )}
            {r.zones.length > zoneCols.length ? c.t(` Se muestran ${zoneCols.length} de ${r.zones.length} zonas.`, ` Showing ${zoneCols.length} of ${r.zones.length} areas.`) : ""}
          </Note>
        </View>
      ) : null}
    </View>
  );
}

function MoverList({ title, items, up, c }: { title: string; items: { keyword: string; zone: string; from: number | null; to: number | null }[]; up: boolean; c: Ctx }) {
  const pos = (p: number | null) => (p === null ? ">20" : String(p));
  const color = up ? GOOD : BAD;
  return (
    <Card>
      <Text style={{ fontSize: 9, fontFamily: BODY_BOLD, color: INK, marginBottom: 4 }}>{title}</Text>
      {items.map((m, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 3 }}>
          <Triangle up={up} color={color} />
          <Text style={{ flex: 1, fontSize: 8.5, color: INK }}>
            {trunc(m.keyword, 40)}
            {m.zone ? <Text style={{ color: MUTED }}>{` · ${trunc(m.zone.split(",")[0], 16)}`}</Text> : null}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Text style={{ fontSize: 8.5, color: MUTED }}>{pos(m.from)}</Text>
            <ArrowRight color={color} />
            <Text style={{ fontSize: 8.5, fontFamily: BODY_BOLD, color }}>{pos(m.to)}</Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

// ---------- Mapa de calor ----------

function MapsSectionView({ d, c }: { d: ReportData; c: Ctx }) {
  const m = d.maps;
  if (!m) return null;
  const n = Math.max(1, ...m.grid.map((r) => r.length));
  const cell = Math.min(30, Math.floor(196 / n));
  const legend: { band: RankBand; label: string }[] = [
    { band: "top3", label: "1-3" },
    { band: "good", label: "4-7" },
    { band: "mid", label: "8-10" },
    { band: "low", label: "11-20" },
    { band: "none", label: c.t("No sale", "Not found") },
  ];
  return (
    <View wrap={false}>
      <SectionTitle
        title={c.t("Mapa de calor en Google Maps", "Google Maps heatmap")}
        subtitle={c.t(`Tu lugar en Google Maps buscando «${trunc(m.keyword, 50)}» desde distintos puntos de tu zona.`, `Your Google Maps rank searching "${trunc(m.keyword, 50)}" from different points in your area.`)}
        c={c}
      />
      <View style={{ flexDirection: "row", gap: 14 }}>
        <View>
          <View style={{ padding: 6, borderWidth: 1, borderColor: LINE, borderRadius: 8, backgroundColor: "#f3f4f6" }}>
            {m.grid.map((row, ri) => (
              <View key={ri} style={{ flexDirection: "row", gap: 2, marginBottom: ri < m.grid.length - 1 ? 2 : 0 }}>
                {row.map((p, ci) => {
                  const band = rankBand(p.rank, p.error);
                  const light = band === "error" || band === "good";
                  return (
                    <View key={ci} style={{ width: cell, height: cell, borderRadius: 4, backgroundColor: BAND[band], alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: cell >= 26 ? 9 : 7.5, fontFamily: BODY_BOLD, color: light ? INK : "#ffffff" }}>{p.error ? "!" : p.rank === null ? "20+" : String(p.rank)}</Text>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, width: Math.max(160, n * (cell + 2) + 12) }}>
            {legend.map((l) => (
              <View key={l.band} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: BAND[l.band] }} />
                <Text style={{ fontSize: 7, color: MUTED }}>{l.label}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={{ flex: 1, gap: 8 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Stat width="48%" c={c} label={c.t("En el top 3", "In the top 3")} value={c.pct(m.top3Share)} delta={m.prev ? <DeltaTag d={{ now: m.top3Share, before: m.prev.top3Share, diff: m.top3Share - m.prev.top3Share, tone: m.top3Share > m.prev.top3Share ? "good" : m.top3Share < m.prev.top3Share ? "bad" : "neutral" }} c={c} unit=" pts" /> : undefined} />
            <Stat
              width="48%"
              c={c}
              label={c.t("Lugar promedio", "Average rank")}
              value={m.avgRank === null ? "—" : c.nf.format(m.avgRank)}
              delta={
                m.prev && m.avgRank !== null && m.prev.avgRank !== null ? (
                  <DeltaTag
                    d={{ now: m.avgRank, before: m.prev.avgRank, diff: Math.round((m.avgRank - m.prev.avgRank) * 10) / 10, tone: m.avgRank < m.prev.avgRank ? "good" : m.avgRank > m.prev.avgRank ? "bad" : "neutral" }}
                    c={c}
                    lowerIsBetter
                  />
                ) : undefined
              }
            />
          </View>
          <Text style={{ fontSize: 9, color: INK, lineHeight: 1.4 }}>
            {c.t(`Sales en ${m.found} de ${m.points} puntos (en los 20 primeros).`, `You show up at ${m.found} of ${m.points} points (in the top 20).`)}
          </Text>
          {m.competitors.length ? (
            <View>
              <Text style={{ fontSize: 8.5, fontFamily: BODY_BOLD, color: INK, marginBottom: 3 }}>{c.t("Quién más sale en el top 3", "Who else shows in the top 3")}</Text>
              {m.competitors.map((x, i) => (
                <Text key={i} style={{ fontSize: 8.5, color: INK, marginBottom: 2 }}>
                  {`${i + 1}. ${trunc(x.title, 44)}`}
                  <Text style={{ color: MUTED }}>{c.t(` · ${x.points} puntos`, ` · ${x.points} points`)}</Text>
                </Text>
              ))}
            </View>
          ) : null}
          <Note>
            {c.t(`Cuadrícula de ${m.size}×${m.size}, ${c.nf.format(m.spacingKm)} km entre puntos. Mapa del ${c.day(m.date)}`, `${m.size}×${m.size} grid, ${c.nf.format(m.spacingKm)} km between points. Map from ${c.day(m.date)}`)}
            {m.inPeriod ? "" : c.t(" (el último, de antes del periodo)", " (the latest one, from before the period)")}
            {m.prev ? c.t(`; comparado con el del ${c.day(m.prev.date)}.`, `; compared with the one from ${c.day(m.prev.date)}.`) : "."}
          </Note>
        </View>
      </View>
    </View>
  );
}

// ---------- Perfil de Google ----------

function GbpSectionView({ d, c }: { d: ReportData; c: Ctx }) {
  const g = d.gbp;
  if (!g) return null;
  const count = [g.rating, g.totalReviews, g.newReviews, g.answeredPct, g.profileScore].filter((x) => x !== null).length;
  const w = (515 - 8 * (count - 1)) / Math.max(1, count);
  const tiles: React.ReactNode[] = [];
  if (g.rating !== null) tiles.push(<Stat key="r" width={w} c={c} label={c.t("Calificación", "Rating")} value={c.nf.format(g.rating)} extra={<Star size={12} />} />);
  if (g.totalReviews !== null) tiles.push(<Stat key="t" width={w} c={c} label={c.t("Reseñas en total", "Total reviews")} value={c.int.format(g.totalReviews)} />);
  if (g.newReviews !== null)
    tiles.push(
      <Stat
        key="n"
        width={w}
        c={c}
        label={c.t("Reseñas nuevas", "New reviews")}
        value={String(g.newReviews)}
        delta={g.prevNewReviews !== null ? <DeltaTag d={{ now: g.newReviews, before: g.prevNewReviews, diff: g.newReviews - g.prevNewReviews, tone: g.newReviews > g.prevNewReviews ? "good" : g.newReviews < g.prevNewReviews ? "bad" : "neutral" }} c={c} /> : undefined}
      />,
    );
  if (g.answeredPct !== null) tiles.push(<Stat key="a" width={w} c={c} label={c.t("Contestadas", "Answered")} value={c.pct(g.answeredPct)} />);
  if (g.profileScore !== null) tiles.push(<Stat key="p" width={w} c={c} label={c.t("Perfil completo", "Profile complete")} value={c.pct(g.profileScore)} />);
  return (
    <View wrap={false}>
      <SectionTitle title={c.t("Tu perfil de Google", "Your Google Business Profile")} subtitle={c.t("Lo que ve la gente en Google Maps: estrellas, reseñas y qué tan completo está tu perfil.", "What people see on Google Maps: stars, reviews and how complete your profile is.")} c={c} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{tiles}</View>
      <Note>
        {g.unanswered === 1
          ? c.t("Tienes 1 reseña sin contestar: en la app la IA te escribe la respuesta. ", "You have 1 unanswered review: in the app the AI writes the reply for you. ")
          : g.unanswered
            ? c.t(`Tienes ${g.unanswered} reseñas sin contestar: en la app la IA te escribe las respuestas. `, `You have ${g.unanswered} unanswered reviews: in the app the AI writes the replies for you. `)
            : ""}
        {g.reviewsDate ? c.t(`Según las reseñas traídas el ${c.day(g.reviewsDate)}.`, `Based on the reviews fetched on ${c.day(g.reviewsDate)}.`) : c.t(`Según el perfil traído el ${c.day(g.date)}.`, `Based on the profile fetched on ${c.day(g.date)}.`)}
        {g.newReviews === null ? c.t(" Las reseñas nuevas del periodo se ven después de volver a traer las reseñas.", " New reviews for the period show after you fetch the reviews again.") : ""}
      </Note>
    </View>
  );
}

// ---------- IAs ----------

function AiSectionView({ d, c }: { d: ReportData; c: Ctx }) {
  const a = d.ai;
  if (!a || a.score.now === null) return null;
  return (
    <View wrap={false}>
      <SectionTitle title={c.t("Visibilidad en las IAs", "AI visibility")} subtitle={c.t("% de respuestas de ChatGPT, Gemini y Claude que te mencionan cuando alguien pregunta por tu servicio.", "% of ChatGPT, Gemini and Claude answers that mention you when someone asks about your service.")} c={c} />
      <Card>
        {a.providers.map((p) => (
          <MeterRow key={p.id} label={p.name} now={p.score.now ?? 0} before={p.score.before} c={c} color={c.pal.primary} />
        ))}
        <MeterRow label={c.t("Total", "Overall")} now={a.score.now} before={a.score.before} c={c} color={c.pal.secondary} />
      </Card>
      <Note>
        {a.questions === 1
          ? c.t(`Revisión del ${c.day(a.date)} con 1 pregunta`, `Check from ${c.day(a.date)} with 1 question`)
          : c.t(`Revisión del ${c.day(a.date)} con ${a.questions} preguntas`, `Check from ${c.day(a.date)} with ${a.questions} questions`)}
        {a.prevDate ? c.t(`; la marca negra es la revisión del ${c.day(a.prevDate)}.`, `; the black mark is the check from ${c.day(a.prevDate)}.`) : "."}
        {a.stale ? c.t(" (Es la última revisión, de antes del periodo.)", " (It's the latest check, from before the period.)") : ""}
      </Note>
    </View>
  );
}

// ---------- Tu parte del mercado ----------

/** Una barra de 0 a 100 %: tu parte (color de la marca), una marca gris donde está el líder y una negra donde estabas. */
function ShareBar({ you, leader, before, c }: { you: number; leader: number | null; before: number | null; c: Ctx }) {
  const W = 200;
  const H = 10;
  const x = (n: number) => (Math.max(0, Math.min(100, n)) / 100) * W;
  return (
    <Svg width={W} height={H + 2} viewBox={`0 -1 ${W} ${H + 2}`}>
      <Rect x={0} y={0} width={W} height={H} fill="#eef1f5" rx={5} ry={5} />
      <Rect x={0} y={0} width={x(you)} height={H} fill={c.pal.primary} rx={5} ry={5} />
      {leader !== null ? <Rect x={Math.max(0, x(leader) - 1.5)} y={-1} width={3} height={H + 2} fill="#9ca3af" /> : null}
      {before !== null ? <Rect x={Math.max(0, x(before) - 1)} y={-1} width={2} height={H + 2} fill={INK} /> : null}
    </Svg>
  );
}

function MarketSectionView({ d, c }: { d: ReportData; c: Ctx }) {
  const m = d.market;
  if (!m) return null;
  const rows: { key: string; label: string; you: Delta; leader: { label: string; share: number } | null; verdict: { es: string; en: string } }[] = [];
  if (m.organic) rows.push({ key: "g", label: "Google", you: m.organic.you, leader: m.organic.share.leader, verdict: organicVerdict(m.organic.share) });
  if (m.map) rows.push({ key: "m", label: c.t("Mapa de Google", "Google Maps"), you: m.map.you, leader: m.map.share.leader, verdict: mapVerdict(m.map.share) });
  if (m.ai) rows.push({ key: "a", label: c.t("IAs", "AI assistants"), you: m.ai.you, leader: m.ai.share.leader, verdict: aiVerdict(m.ai.share) });
  return (
    <View wrap={false}>
      <SectionTitle
        title={c.t("Tu parte del mercado", "Your share of the market")}
        subtitle={c.t("De todo lo que se reparten tus búsquedas en Google, el mapa y las IAs, cuánto te llevas tú (estimado con tus revisiones guardadas).", "Of everything your Google searches, the map and the AIs hand out, how much goes to you (estimated from your saved checks).")}
        c={c}
      />
      <Card>
        {rows.map((r, i) => (
          <View key={r.key} style={{ marginBottom: i < rows.length - 1 ? 7 : 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ width: 80, fontSize: 9, fontFamily: BODY_BOLD, color: INK }}>{r.label}</Text>
              <ShareBar you={r.you.now ?? 0} leader={r.leader ? r.leader.share * 100 : null} before={r.you.before} c={c} />
              <Text style={{ width: 34, fontSize: 9.5, fontFamily: BODY_BOLD, color: INK }}>{c.pct(r.you.now ?? 0)}</Text>
              <DeltaTag d={r.you} c={c} unit=" pts" size={7} />
            </View>
            <Text style={{ fontSize: 8, color: MUTED, marginTop: 2, marginLeft: 88, lineHeight: 1.3 }}>{trunc(r.verdict[c.lang], 170)}</Text>
          </View>
        ))}
      </Card>
      <Note>
        {c.t(
          "Google: parte de los clics posibles según dónde sales. Mapa: parte de los puntos donde sales entre los 3 primeros. IAs: parte de las veces que nombran un negocio. La marca gris es el competidor que más se lleva; la negra, cómo estabas al empezar el periodo.",
          "Google: share of the possible clicks based on where you rank. Map: share of the points where you're in the top 3. AIs: share of the times they name a business. The gray mark is the competitor that gets the most; the black one, where you stood when the period started.",
        )}
      </Note>
    </View>
  );
}

// ---------- Cómo hablan de ti las IAs ----------

function SentimentSectionView({ d, c }: { d: ReportData; c: Ctx }) {
  const s = d.sentiment;
  if (!s) return null;
  const tile = (label: string, n: number, before: number | undefined, color: string, lowerIsBetter = false) => {
    const diff = before === undefined ? null : n - before;
    const better = diff === null ? 0 : lowerIsBetter ? -diff : diff;
    return (
      <View style={{ flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 8, borderLeftWidth: 4, borderLeftColor: color }}>
        <Text style={{ fontSize: 7, color: MUTED, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }}>
          <Text style={{ fontFamily: c.head.family, fontWeight: c.head.bold, fontSize: 15, color: INK }}>{n}</Text>
          <DeltaTag d={{ now: n, before: before ?? null, diff, tone: !diff ? "neutral" : better > 0 ? "good" : "bad" }} c={c} lowerIsBetter={lowerIsBetter} size={7} />
        </View>
      </View>
    );
  };
  return (
    <View wrap={false}>
      <SectionTitle title={c.t("Cómo hablan de ti las IAs", "How the AIs talk about you")} subtitle={c.t("El tono de cada respuesta que te menciona: bien, neutral o mal.", "The tone of each answer that mentions you: good, neutral or bad.")} c={c} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {tile(c.t("Positivas", "Positive"), s.positiva, s.before?.positiva, BAND.top3)}
        {tile(c.t("Neutrales", "Neutral"), s.neutral, s.before?.neutral, BAND.none)}
        {tile(c.t("Negativas", "Negative"), s.negativa, s.before?.negativa, BAND.low, true)}
      </View>
      {s.attributes.length ? (
        <Text style={{ fontSize: 8.5, color: INK, marginTop: 6 }}>
          <Text style={{ fontFamily: BODY_BOLD }}>{c.t("Te asocian con: ", "They link you with: ")}</Text>
          {trunc(s.attributes.join(", "), 160)}
        </Text>
      ) : null}
      {s.negatives.map((n, i) => (
        <View key={i} style={{ marginTop: 5, padding: 6, borderRadius: 6, backgroundColor: "#fef3f2" }}>
          <Text style={{ fontSize: 8.5, color: BAD, fontFamily: BODY_BOLD }}>
            {n.provider}
            {n.reason ? <Text style={{ fontFamily: BODY, color: INK }}>{`: ${trunc(n.reason, 170)}`}</Text> : null}
          </Text>
          {n.quote ? <Text style={{ fontSize: 8, color: MUTED, marginTop: 2 }}>{c.t(`«${trunc(n.quote, 180)}»`, `“${trunc(n.quote, 180)}”`)}</Text> : null}
        </View>
      ))}
      <Note>
        {c.t(`${s.total} ${s.total === 1 ? "mención revisada" : "menciones revisadas"} el ${c.day(s.date)}`, `${s.total} ${s.total === 1 ? "mention" : "mentions"} checked on ${c.day(s.date)}`)}
        {s.before ? c.t("; las flechas comparan con la revisión del inicio del periodo.", "; arrows compare with the check from the start of the period.") : "."}
      </Note>
    </View>
  );
}

// ---------- Tu sitio ----------

function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? BAND.top3 : score >= 60 ? BAND.mid : BAND.low;
  return (
    <Svg width={120} height={8} viewBox="0 0 120 8">
      <Rect x={0} y={0} width={120} height={8} rx={4} ry={4} fill="#eef1f5" />
      <Rect x={0} y={0} width={(Math.max(0, Math.min(100, score)) / 100) * 120} height={8} rx={4} ry={4} fill={color} />
    </Svg>
  );
}

function SiteSectionView({ d, c }: { d: ReportData; c: Ctx }) {
  const { audit, onpage, gsc } = d;
  if (!audit && !onpage && !gsc) return null;
  return (
    <View>
      {/* El título va pegado a las tarjetas para que no quede solo al final de una página. */}
      <View wrap={false}>
      <SectionTitle title={c.t("Tu sitio web", "Your website")} subtitle={c.t("La salud técnica del sitio, la revisión de tus páginas y tus búsquedas reales en Google.", "Your site's technical health, the review of your pages and your real Google searches.")} c={c} />
      <View style={{ flexDirection: "row", gap: 10 }} wrap={false}>
        {audit ? (
          <Card style={{ flex: 1 }}>
            <Text style={{ fontSize: 9, fontFamily: BODY_BOLD, color: INK }}>{c.t("Salud del sitio (auditoría)", "Site health (audit)")}</Text>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, marginTop: 4 }}>
              <Text style={{ fontFamily: c.head.family, fontWeight: c.head.bold, fontSize: 22, color: c.pal.strong }}>{audit.score.now ?? "—"}</Text>
              <Text style={{ fontSize: 9, color: MUTED, marginBottom: 4 }}>/100</Text>
              <View style={{ marginBottom: 5 }}>
                <DeltaTag d={audit.score} c={c} />
              </View>
            </View>
            <ScoreBar score={audit.score.now ?? 0} />
            <View style={{ marginTop: 8 }}>
              {audit.issues.map((i) => (
                <View key={i.id} style={{ flexDirection: "row", gap: 5, alignItems: "flex-start", marginBottom: 4 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: SEVERITY[i.severity], marginTop: 2.5 }} />
                  <Text style={{ flex: 1, fontSize: 8.5, color: INK, lineHeight: 1.3 }}>
                    {i.title[c.lang]}
                    <Text style={{ color: MUTED }}>{c.t(` · ${i.count} ${i.count === 1 ? "página" : "páginas"}`, ` · ${i.count} ${i.count === 1 ? "page" : "pages"}`)}</Text>
                  </Text>
                </View>
              ))}
              {!audit.issues.length ? <Text style={{ fontSize: 8.5, color: GOOD }}>{c.t("No encontramos problemas.", "No issues found.")}</Text> : null}
            </View>
            <Note>{audit.pages === 1 ? c.t(`1 página revisada el ${c.day(audit.date)}.`, `1 page checked on ${c.day(audit.date)}.`) : c.t(`${audit.pages} páginas revisadas el ${c.day(audit.date)}.`, `${audit.pages} pages checked on ${c.day(audit.date)}.`)}</Note>
          </Card>
        ) : null}
        {onpage ? (
          <Card style={{ flex: 1 }}>
            <Text style={{ fontSize: 9, fontFamily: BODY_BOLD, color: INK }}>{c.t("Revisión de tus páginas", "Review of your pages")}</Text>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, marginTop: 4 }}>
              <Text style={{ fontFamily: c.head.family, fontWeight: c.head.bold, fontSize: 22, color: c.pal.strong }}>{onpage.avgScore ?? "—"}</Text>
              <Text style={{ fontSize: 9, color: MUTED, marginBottom: 4 }}>{c.t("/100 promedio", "/100 average")}</Text>
            </View>
            <ScoreBar score={onpage.avgScore ?? 0} />
            <View style={{ marginTop: 8 }}>
              {onpage.ideas.map((x, i) => (
                <View key={i} style={{ marginBottom: 5 }}>
                  <Text style={{ fontSize: 7.5, color: MUTED }}>{trunc(x.page, 60)}</Text>
                  <Text style={{ fontSize: 8.5, color: INK, lineHeight: 1.3 }}>{trunc(x.text[c.lang], 190)}</Text>
                </View>
              ))}
            </View>
            <Note>{onpage.pages === 1 ? c.t(`1 página revisada el ${c.day(onpage.date)}.`, `1 page reviewed on ${c.day(onpage.date)}.`) : c.t(`${onpage.pages} páginas revisadas el ${c.day(onpage.date)}.`, `${onpage.pages} pages reviewed on ${c.day(onpage.date)}.`)}</Note>
          </Card>
        ) : null}
      </View>
      </View>
      {gsc ? <GscView d={d} c={c} /> : null}
    </View>
  );
}

function GscView({ d, c }: { d: ReportData; c: Ctx }) {
  const g = d.gsc;
  if (!g) return null;
  const change = (now: number, before: number, lowerIsBetter = false): Delta => {
    const diff = Math.round((now - before) * 10) / 10;
    const better = lowerIsBetter ? -diff : diff;
    return { now, before, diff, tone: Math.abs(diff) < 0.05 ? "neutral" : better > 0 ? "good" : "bad" };
  };
  const pctTag = (now: number, before: number) => {
    if (before <= 0) return undefined;
    const p = Math.round(((now - before) / before) * 100);
    return <DeltaTag d={{ now, before, diff: p, tone: p > 0 ? "good" : p < 0 ? "bad" : "neutral" }} c={c} unit="%" />;
  };
  const range = (a: string, b: string) => (a && b ? `${c.day(`${a}T12:00:00Z`)} – ${c.day(`${b}T12:00:00Z`)}` : "");
  return (
    <View wrap={false} style={{ marginTop: 12 }}>
      <Text style={{ fontSize: 10, fontFamily: BODY_BOLD, color: INK, marginBottom: 6 }}>Google Search Console</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Stat width="23.5%" c={c} label={c.t("Clics", "Clicks")} value={c.int.format(g.clicks)} delta={pctTag(g.clicks, g.prev.clicks)} />
        <Stat width="23.5%" c={c} label={c.t("Veces en Google", "Impressions")} value={c.int.format(g.impressions)} delta={pctTag(g.impressions, g.prev.impressions)} />
        <Stat width="23.5%" c={c} label="CTR" value={`${c.nf.format(g.ctr * 100)}${c.lang === "en" ? "%" : " %"}`} delta={<DeltaTag d={change(Math.round(g.ctr * 1000) / 10, Math.round(g.prev.ctr * 1000) / 10)} c={c} unit=" pts" />} />
        <Stat width="23.5%" c={c} label={c.t("Posición prom.", "Avg. position")} value={c.nf.format(g.position)} delta={<DeltaTag d={change(g.position, g.prev.position, true)} c={c} lowerIsBetter />} />
      </View>
      {g.queries.length ? (
        <View style={{ marginTop: 8 }}>
          <View style={{ flexDirection: "row", paddingHorizontal: 8, paddingVertical: 4, backgroundColor: c.pal.soft, borderRadius: 4 }}>
            <Th flex={3}>{c.t("Búsquedas con más clics", "Top searches by clicks")}</Th>
            <Th flex={1} align="right">{c.t("Clics", "Clicks")}</Th>
            <Th flex={1.2} align="right">{c.t("Veces en Google", "Impressions")}</Th>
            <Th flex={1} align="right">{c.t("Posición", "Position")}</Th>
          </View>
          {g.queries.map((q, i) => (
            <View key={i} style={{ flexDirection: "row", paddingHorizontal: 8, paddingVertical: 3, borderBottomWidth: 0.5, borderColor: LINE }}>
              <Text style={{ flex: 3, fontSize: 8.5, color: INK }}>{trunc(q.query, 55)}</Text>
              <Text style={{ flex: 1, fontSize: 8.5, color: INK, textAlign: "right" }}>{c.int.format(q.clicks)}</Text>
              <Text style={{ flex: 1.2, fontSize: 8.5, color: INK, textAlign: "right" }}>{c.int.format(q.impressions)}</Text>
              <Text style={{ flex: 1, fontSize: 8.5, color: INK, textAlign: "right" }}>{c.nf.format(q.position)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Note>
        {c.t(`Del ${range(g.start, g.end)}, comparado con ${range(g.prevStart, g.prevEnd)} (datos de Google, que llegan con 2-3 días de retraso).`, `From ${range(g.start, g.end)}, compared with ${range(g.prevStart, g.prevEnd)} (Google data, which arrives 2-3 days late).`)}
      </Note>
    </View>
  );
}

// ---------- Páginas que compiten entre sí ----------

function CannibalSectionView({ d, c }: { d: ReportData; c: Ctx }) {
  const k = d.cannibal;
  if (!k) return null;
  const color = (sev: string) => (sev === "alta" ? BAD : sev === "media" ? BAND.mid : MUTED);
  return (
    <View wrap={false}>
      <SectionTitle
        title={c.t("Páginas que compiten entre sí", "Pages competing with each other")}
        subtitle={c.t("Cuando dos páginas tuyas salen para la misma búsqueda, se reparten los clics y ninguna sube.", "When two of your pages show up for the same search, they split the clicks and neither climbs.")}
        c={c}
      />
      {k.issues.map((i, n) => (
        <View key={n} style={{ borderWidth: 1, borderColor: LINE, borderLeftWidth: 4, borderLeftColor: color(i.severity), borderRadius: 6, padding: 7, marginBottom: 5 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontSize: 7, color: "#ffffff", backgroundColor: color(i.severity), paddingHorizontal: 4, paddingVertical: 1.5, borderRadius: 3, fontFamily: BODY_BOLD }}>{severityLabel(i.severity, c.t).toUpperCase()}</Text>
            <Text style={{ fontSize: 9.5, fontFamily: BODY_BOLD, color: INK, flex: 1 }}>{c.t(`«${trunc(i.query, 70)}»`, `“${trunc(i.query, 70)}”`)}</Text>
          </View>
          <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 2 }}>{trunc(i.pages.join("  ·  "), 150)}</Text>
          <Text style={{ fontSize: 8.5, color: INK, marginTop: 3, lineHeight: 1.35 }}>{trunc(i.fix[c.lang], 260)}</Text>
        </View>
      ))}
      <Note>
        {k.total > k.issues.length ? c.t(`Se muestran ${k.issues.length} de ${k.total} búsquedas. `, `Showing ${k.issues.length} of ${k.total} searches. `) : ""}
        {k.source === "gsc"
          ? c.t("Según Search Console (búsquedas reales).", "Based on Search Console (real searches).")
          : k.source === "rank"
            ? c.t("Según tus revisiones de posiciones de los últimos 30 días.", "Based on your ranking checks from the last 30 days.")
            : c.t("Según la revisión de tu página (títulos repetidos).", "Based on your website check (repeated titles).")}
      </Note>
    </View>
  );
}

// ---------- Enlaces ----------

function LinksSectionView({ d, c }: { d: ReportData; c: Ctx }) {
  const l = d.links;
  if (!l) return null;
  const hints = hintText(c.t);
  const n = (v: number | null) => (v === null ? "—" : c.int.format(v));
  return (
    <View wrap={false}>
      <SectionTitle title={c.t("Enlaces hacia tu página", "Links to your website")} subtitle={c.t("Cada sitio que te enlaza es como una recomendación para Google: mientras más y mejores, más arriba sales.", "Every site that links to you is like a recommendation for Google: the more (and better), the higher you rank.")} c={c} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Stat width="23.5%" c={c} label={c.t("Sitios que te enlazan", "Sites linking to you")} value={n(l.referringDomains.now)} delta={<DeltaTag d={l.referringDomains} c={c} />} />
        <Stat width="23.5%" c={c} label={c.t("Fuerza (0-1000)", "Strength (0-1000)")} value={n(l.rank.now)} delta={<DeltaTag d={l.rank} c={c} />} />
        <Stat width="23.5%" c={c} label={c.t("Nuevos (último mes)", "New (last month)")} value={n(l.newDomains)} />
        <Stat width="23.5%" c={c} label={c.t("Perdidos (último mes)", "Lost (last month)")} value={n(l.lostDomains)} />
      </View>
      {l.competitors.length ? (
        <Text style={{ fontSize: 8.5, color: INK, marginTop: 6 }}>
          <Text style={{ fontFamily: BODY_BOLD }}>{c.t("Tu competencia: ", "Your competitors: ")}</Text>
          {l.competitors.map((x) => c.t(`${x.domain} ${n(x.referringDomains)} sitios`, `${x.domain} ${n(x.referringDomains)} sites`)).join("  ·  ")}
        </Text>
      ) : null}
      {l.gap.length ? (
        <View style={{ marginTop: 8 }}>
          <View style={{ flexDirection: "row", paddingHorizontal: 8, paddingVertical: 4, backgroundColor: c.pal.soft, borderRadius: 4 }}>
            <Th flex={2}>{c.t("Dónde conseguir enlaces", "Where to get links")}</Th>
            <Th flex={1.4}>{c.t("Tipo", "Type")}</Th>
            <Th flex={4}>{c.t("Cómo", "How")}</Th>
          </View>
          {l.gap.map((g, i) => (
            <View key={i} style={{ flexDirection: "row", paddingHorizontal: 8, paddingVertical: 3.5, borderBottomWidth: 0.5, borderColor: LINE, backgroundColor: i % 2 ? ZEBRA : "#ffffff" }}>
              <Text style={{ flex: 2, fontSize: 8.5, color: INK, fontFamily: BODY_BOLD }}>{trunc(g.domain, 32)}</Text>
              <Text style={{ flex: 1.4, fontSize: 8, color: HINT_EASY[g.hint] ? GOOD : MUTED }}>{hints[g.hint].label}</Text>
              <Text style={{ flex: 4, fontSize: 8, color: INK, lineHeight: 1.3 }}>{trunc(hints[g.hint].how, 130)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Note>
        {c.t(`Revisión del ${c.day(l.date)}`, `Check from ${c.day(l.date)}`)}
        {l.stale ? c.t(" (la última, de antes del periodo)", " (the latest one, from before the period)") : ""}
        {l.gapTotal > l.gap.length ? c.t(`. Hay ${l.gapTotal} sitios que enlazan a tu competencia y a ti no; se muestran los ${l.gap.length} primeros.`, `. ${l.gapTotal} sites link to your competitors but not to you; showing the first ${l.gap.length}.`) : "."}
      </Note>
    </View>
  );
}

// ---------- Visitas de tu competencia ----------

function TrafficSectionView({ d, c }: { d: ReportData; c: Ctx }) {
  const tr = d.traffic;
  if (!tr) return null;
  const n = (v: number | null) => (v === null ? "—" : c.int.format(Math.round(v)));
  const v = (x: number) => visitsText(x, c.lang);
  return (
    <View wrap={false}>
      <SectionTitle
        title={c.t("Visitas de tu competencia", "Your competitors' visits")}
        subtitle={c.t(`Visitas al mes que cada sitio recibe desde Google${tr.country ? ` en ${tr.country}` : ""} (estimadas por DataForSEO).`, `Monthly visits each site gets from Google${tr.country ? ` in ${tr.country}` : ""} (estimated by DataForSEO).`)}
        c={c}
      />
      <Card style={{ padding: 0 }}>
        <View style={{ flexDirection: "row", paddingHorizontal: 10, paddingVertical: 5, borderBottomWidth: 1, borderColor: LINE }}>
          <Th flex={2.6}>{c.t("Sitio", "Site")}</Th>
          <Th flex={1.1} align="right">{c.t("Visitas/mes", "Visits/mo")}</Th>
          <Th flex={1.1} align="right">{c.t("Búsquedas", "Keywords")}</Th>
          <Th flex={0.9} align="right">Top 10</Th>
          <Th flex={1.8} align="right">{c.t("Hace 12 meses / hoy", "12 months ago / now")}</Th>
        </View>
        {tr.rows.map((r, i) => (
          <View key={r.domain} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 4.5, backgroundColor: r.isYou ? c.pal.soft : i % 2 ? ZEBRA : "#ffffff" }}>
            <Text style={{ flex: 2.6, fontSize: 9, fontFamily: r.isYou ? BODY_BOLD : BODY, color: INK }}>
              {trunc(r.domain, 34)}
              {r.isYou ? c.t(" (tú)", " (you)") : ""}
            </Text>
            {r.noData ? (
              <Text style={{ flex: 4.9, fontSize: 8, color: MUTED, textAlign: "right" }}>{c.t("Sin datos (sitio muy nuevo o muy chico)", "No data (site too new or too small)")}</Text>
            ) : (
              <>
                <Text style={{ flex: 1.1, fontSize: 9, fontFamily: BODY_BOLD, color: INK, textAlign: "right" }}>{n(r.etv)}</Text>
                <Text style={{ flex: 1.1, fontSize: 9, color: INK, textAlign: "right" }}>{n(r.keywords)}</Text>
                <Text style={{ flex: 0.9, fontSize: 9, color: INK, textAlign: "right" }}>{n(r.top10)}</Text>
                <View style={{ flex: 1.8, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 3 }}>
                  {r.year ? (
                    <>
                      <Text style={{ fontSize: 8.5, color: MUTED }}>{v(r.year.from)}</Text>
                      <ArrowRight color={r.year.to > r.year.from ? GOOD : r.year.to < r.year.from ? BAD : MUTED} />
                      <Text style={{ fontSize: 8.5, fontFamily: BODY_BOLD, color: r.year.to > r.year.from ? GOOD : r.year.to < r.year.from ? BAD : INK }}>{v(r.year.to)}</Text>
                    </>
                  ) : (
                    <Text style={{ fontSize: 8.5, color: MUTED }}>—</Text>
                  )}
                </View>
              </>
            )}
          </View>
        ))}
      </Card>
      {tr.lines.map((x, i) => (
        <Text key={i} style={{ fontSize: 8.5, color: INK, marginTop: i ? 2 : 6, lineHeight: 1.35 }}>
          {trunc(x[c.lang], 240)}
        </Text>
      ))}
      <Note>{c.t(`Datos del ${c.day(tr.date)}${tr.month ? ` (último mes: ${tr.month})` : ""}. Son estimaciones: sirven para comparar, no son visitas exactas.`, `Data from ${c.day(tr.date)}${tr.month ? ` (latest month: ${tr.month})` : ""}. These are estimates: good for comparing, not exact visits.`)}</Note>
    </View>
  );
}

// ---------- Oportunidades ----------

function OpportunitiesView({ d, c }: { d: ReportData; c: Ctx }) {
  if (!d.gap && !d.articles.length) return null;
  return (
    <View wrap={false}>
      <SectionTitle title={c.t("Oportunidades", "Opportunities")} subtitle={c.t("Búsquedas donde tu competencia sale en Google y tú no (o sales más abajo), y lo que ya escribimos.", "Searches where your competitors show up on Google and you don't (or rank lower), and what we've already written.")} c={c} />
      {d.gap ? (
        <View wrap={false}>
          <View style={{ flexDirection: "row", paddingHorizontal: 8, paddingVertical: 5, backgroundColor: c.pal.soft, borderTopLeftRadius: 6, borderTopRightRadius: 6 }}>
            <Th flex={3}>{c.t("Búsqueda", "Search")}</Th>
            <Th flex={1.1} align="right">{c.t("Búsquedas/mes", "Searches/mo")}</Th>
            <Th flex={0.9} align="right">{c.t("Dificultad", "Difficulty")}</Th>
            <Th flex={0.6} align="right">{c.t("Tú", "You")}</Th>
            <Th flex={2.2} align="right">{c.t("Competidor", "Competitor")}</Th>
          </View>
          {d.gap.rows.map((r, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 4, backgroundColor: i % 2 ? ZEBRA : "#ffffff", borderBottomWidth: 0.5, borderColor: LINE }}>
              <Text style={{ flex: 3, fontSize: 8.5, color: INK }}>{trunc(r.keyword, 46)}</Text>
              <Text style={{ flex: 1.1, fontSize: 8.5, color: INK, textAlign: "right" }}>{r.volume === null ? "—" : c.int.format(r.volume)}</Text>
              <Text style={{ flex: 0.9, fontSize: 8.5, color: INK, textAlign: "right" }}>{r.difficulty === null ? "—" : `${Math.round(r.difficulty)}/100`}</Text>
              <Text style={{ flex: 0.6, fontSize: 8.5, color: r.yourPosition ? INK : BAD, textAlign: "right" }}>{r.yourPosition ? String(r.yourPosition) : c.t("no", "no")}</Text>
              <Text style={{ flex: 2.2, fontSize: 8, color: MUTED, textAlign: "right" }}>
                {trunc(r.competitor, 30)}
                {r.competitorPosition ? ` (${r.competitorPosition})` : ""}
              </Text>
            </View>
          ))}
          <Note>{c.t(`Comparación del ${c.day(d.gap.date)}. Dificultad: qué tan difícil es salir en la primera página (0-100).`, `Comparison from ${c.day(d.gap.date)}. Difficulty: how hard it is to reach page one (0-100).`)}</Note>
        </View>
      ) : null}
      {d.articles.length ? (
        <View wrap={false} style={{ marginTop: 10 }}>
          <Text style={{ fontSize: 10, fontFamily: BODY_BOLD, color: INK, marginBottom: 5 }}>{c.t("Artículos escritos en el periodo", "Articles written in the period")}</Text>
          {d.articles.map((a, i) => {
            const color = a.score >= 80 ? BAND.top3 : a.score >= 60 ? BAND.mid : BAND.low;
            return (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <View style={{ width: 30, paddingVertical: 2, borderRadius: 4, backgroundColor: color, alignItems: "center" }}>
                  <Text style={{ fontSize: 8, fontFamily: BODY_BOLD, color: "#ffffff" }}>{a.score}</Text>
                </View>
                <Text style={{ flex: 1, fontSize: 9, color: INK }}>{trunc(a.keyword, 70)}</Text>
                <Text style={{ fontSize: 8, color: MUTED }}>{c.day(a.date)}</Text>
              </View>
            );
          })}
          <Note>{c.t("El número es el puntaje SEO del artículo (de 100).", "The number is the article's SEO score (out of 100).")}</Note>
        </View>
      ) : null}
    </View>
  );
}

// ---------- Publicaciones ----------

function PostsView({ d, c }: { d: ReportData; c: Ctx }) {
  const p = d.posts;
  if (!p.total && !p.prevTotal) return null;
  const delta: Delta = { now: p.total, before: p.prevTotal, diff: p.total - p.prevTotal, tone: p.total > p.prevTotal ? "good" : p.total < p.prevTotal ? "bad" : "neutral" };
  const colors = c.pal.chart.length ? c.pal.chart : [c.pal.primary];
  return (
    <View wrap={false}>
      <SectionTitle title={c.t("Lo que publicamos", "What we published")} subtitle={c.t("Publicaciones enviadas con éxito en cada canal durante el periodo.", "Posts successfully sent on each channel during the period.")} c={c} />
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <Stat width={130} c={c} label={c.t("Publicaciones", "Posts")} value={c.int.format(p.total)} delta={<DeltaTag d={delta} c={c} empty={c.t("sin dato anterior", "no earlier data")} />} />
        {p.byChannel.length ? (
          <Card style={{ flex: 1 }}>
            <BarChart width={340} height={110} c={c} bars={p.byChannel.slice(0, 7).map((x, i) => ({ label: channelLabel(x.channel, c.lang), value: x.count, color: colors[i % colors.length] }))} />
          </Card>
        ) : null}
      </View>
      <Note>{c.t(`En el periodo anterior: ${p.prevTotal}.`, `In the previous period: ${p.prevTotal}.`)}</Note>
    </View>
  );
}

// ---------- Sin datos ----------

function EmptyView({ d, c }: { d: ReportData; c: Ctx }) {
  const hints = setupHints(d, c.lang);
  return (
    <View>
      <SectionTitle title={c.t("Todavía no hay datos para este reporte", "There's no data for this report yet")} c={c} />
      <Text style={{ fontSize: 10, lineHeight: 1.5, color: INK }}>
        {c.t(
          "Este reporte se arma con lo que ya revisaste en la app (posiciones en Google, mapa de calor, reseñas, IAs, tu sitio y publicaciones). Para que el próximo tenga números, empieza por aquí:",
          "This report is built from what you've already checked in the app (Google rankings, heatmap, reviews, AI assistants, your website and posts). For the next one to have numbers, start here:",
        )}
      </Text>
      <View style={{ marginTop: 10, backgroundColor: c.pal.soft, borderRadius: 8, padding: 12 }}>
        {hints.map((h, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
            <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c.pal.primary, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 8.5, color: c.pal.onPrimary, fontFamily: BODY_BOLD }}>{i + 1}</Text>
            </View>
            <Text style={{ flex: 1, fontSize: 10, lineHeight: 1.4, color: INK }}>{h}</Text>
          </View>
        ))}
      </View>
      <Note>{c.t("Todo esto se hace en la sección SEO de la app. El reporte no gasta nada: solo lee lo que ya está guardado.", "All of this is done in the app's SEO section. The report costs nothing: it only reads what's already saved.")}</Note>
    </View>
  );
}

// ---------- Documento ----------

export type PdfOptions = { lang: UiLang; summary: ReportSummary; whiteLabel: boolean; logo: LogoSource | null; tz?: string };

export function ReportDocument({ data: d, opts }: { data: ReportData; opts: PdfOptions }) {
  const lang = opts.lang;
  const tz = opts.tz ?? BUSINESS_TZ;
  const pal = palette(d.business.color, d.business.color2, d.business.color3);
  const head = headingFont(d.business.fontHeading);
  const c: Ctx = {
    lang,
    t: translator(lang),
    nf: new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 1 }),
    int: new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 0 }),
    pal,
    head,
    day: (s: string) => {
      const dt = new Date(s);
      return Number.isNaN(dt.getTime()) ? "—" : new Intl.DateTimeFormat(intlLocale(lang), { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(dt);
    },
    pct: (n: number) => (lang === "en" ? `${Math.round(n)}%` : `${Math.round(n)} %`),
  };
  const prepared = new Intl.DateTimeFormat(intlLocale(lang), { timeZone: tz, day: "numeric", month: "long", year: "numeric" }).format(d.generatedAt);
  const empty = isEmptyReport(d);
  const title = c.t(`Reporte de SEO y marketing — ${d.business.name} — ${periodLabel(d.period, lang, tz)}`, `SEO & marketing report — ${d.business.name} — ${periodLabel(d.period, lang, tz)}`);
  return (
    <Document title={title} author={opts.whiteLabel ? d.business.name : "Matya"} subject={c.t("Reporte de SEO y marketing", "SEO & marketing report")} creator={opts.whiteLabel ? d.business.name : "Matya"} producer={opts.whiteLabel ? d.business.name : "Matya"} language={lang}>
      <Page size="A4" style={{ paddingTop: 40, paddingBottom: 54, paddingHorizontal: 40, fontFamily: BODY, fontSize: 9.5, color: INK, backgroundColor: "#ffffff" }}>
        <Cover d={d} c={c} logo={opts.logo} summaryDate={prepared} />
        {empty ? (
          <EmptyView d={d} c={c} />
        ) : (
          <>
            <Kpis d={d} c={c} />
            <Summary d={d} c={c} summary={opts.summary} />
            <RankSectionView d={d} c={c} />
            <MapsSectionView d={d} c={c} />
            <MarketSectionView d={d} c={c} />
            <GbpSectionView d={d} c={c} />
            <AiSectionView d={d} c={c} />
            <SentimentSectionView d={d} c={c} />
            <SiteSectionView d={d} c={c} />
            <CannibalSectionView d={d} c={c} />
            <LinksSectionView d={d} c={c} />
            <TrafficSectionView d={d} c={c} />
            <OpportunitiesView d={d} c={c} />
            <PostsView d={d} c={c} />
          </>
        )}
        <View fixed style={{ position: "absolute", bottom: 22, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 0.5, borderColor: LINE, paddingTop: 6 }}>
          <Text style={{ fontSize: 7.5, color: MUTED }}>{opts.whiteLabel ? trunc(d.business.name, 60) : c.t("Preparado con Matya", "Prepared with Matya")}</Text>
          <Text style={{ fontSize: 7.5, color: MUTED }} render={({ pageNumber, totalPages }) => c.t(`Página ${pageNumber} de ${totalPages}`, `Page ${pageNumber} of ${totalPages}`)} />
        </View>
      </Page>
    </Document>
  );
}

/** El PDF del reporte como Buffer (empieza con "%PDF"). */
export async function renderReportPdf(data: ReportData, opts: PdfOptions): Promise<Buffer> {
  return renderToBuffer(<ReportDocument data={data} opts={opts} />);
}
