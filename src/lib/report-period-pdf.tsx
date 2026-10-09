// El reporte de un periodo en PDF (@react-pdf/renderer), con los colores, la letra de títulos y el logo de la marca.
// Dibuja las mismas secciones que la pantalla y el email (reportSections). Reusa las letras, los colores y el logo
// del reporte mensual de SEO (src/lib/seo/report-pdf.tsx) sin cambiarlo.
import { Document, Image, Link, Page, Polygon, renderToBuffer, Svg, Text, View } from "@react-pdf/renderer";
import { headingFont, palette, trunc, type LogoSource } from "@/lib/seo/report-pdf";
import { isSingleDay, periodText, type PeriodReport } from "@/lib/report-period";
import { reportSections, type ViewSection, type ViewTone } from "@/lib/report-period-view";

type Lang = "es" | "en";
const BODY = "Helvetica";
const BODY_BOLD = "Helvetica-Bold";
const INK = "#1f2933";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const ZEBRA = "#f8fafc";
const TONE: Record<ViewTone, string> = { good: "#067647", bad: "#b42318", neutral: "#9ca3af" };

/** Helvetica (las letras estándar del PDF) no trae ★, ▲, ▼, → ni el signo menos: se cambian por algo que sí trae. */
export function pdfText(s: string): string {
  return s
    .replace(/★{2,}/g, (m) => `(${m.length}/5)`)
    .replace(/\s?★/g, "")
    .replace(/[▲▼]/g, "")
    .replace(/→/g, "")
    .replace(/−/g, "-")
    .replace(/[^\n\x20-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const STAR = "5,0.4 6.2,3.8 9.8,3.9 6.9,6.1 8,9.6 5,7.5 2,9.6 3.1,6.1 0.2,3.9 3.8,3.8";
function Star({ size = 10 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 10 10">
      <Polygon points={STAR} fill="#f59e0b" />
    </Svg>
  );
}

function Mark({ tone }: { tone: ViewTone }) {
  const color = TONE[tone];
  return (
    <Svg width={7} height={7} viewBox="0 0 10 10" style={{ marginTop: 2.5 }}>
      {tone === "good" ? <Polygon points="0,9 5,1 10,9" fill={color} /> : tone === "bad" ? <Polygon points="0,1 10,1 5,9" fill={color} /> : <Polygon points="3,3 7,3 7,7 3,7" fill={color} />}
    </Svg>
  );
}

type Ctx = { lang: Lang; t: (es: string, en: string) => string; head: ReturnType<typeof headingFont>; pal: ReturnType<typeof palette>; base: string };

function SectionView({ s, c }: { s: ViewSection; c: Ctx }) {
  const linkOf = (href?: string) => (href ? (/^https?:\/\//i.test(href) ? href : `${c.base}${href}`) : undefined);
  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <View style={{ width: 4, height: 15, backgroundColor: c.pal.primary, borderRadius: 2 }} />
      <Text style={{ fontFamily: c.head.family, fontWeight: c.head.bold, fontSize: 14, color: c.pal.strong }}>{pdfText(s.title)}</Text>
    </View>
  );
  // Cada bloque va entero en una página; el título va pegado al primero (nunca queda solo al final de una página).
  const blocks: { node: React.ReactNode; wrap?: boolean }[] = [];
  if (s.stats?.length)
    blocks.push({
      node: (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
          {s.stats.map((st, i) => (
            <View key={i} style={{ width: "32%", borderWidth: 1, borderColor: LINE, borderRadius: 7, padding: 7 }}>
              <Text style={{ fontSize: 7, color: MUTED, textTransform: "uppercase", letterSpacing: 0.3 }}>{pdfText(st.label)}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 }}>
                <Text style={{ fontFamily: c.head.family, fontWeight: c.head.bold, fontSize: 14, color: st.tone && st.tone !== "neutral" ? TONE[st.tone] : INK }}>{pdfText(st.value)}</Text>
                {st.value.includes("★") ? <Star size={10} /> : null}
              </View>
              {st.sub ? <Text style={{ fontSize: 7, color: MUTED, marginTop: 1 }}>{pdfText(st.sub)}</Text> : null}
            </View>
          ))}
        </View>
      ),
    });
  for (const [k, i] of (s.items ?? []).entries())
    blocks.push({
      node: (
        <View style={{ flexDirection: "row", gap: 6, paddingVertical: 3, borderBottomWidth: k === s.items!.length - 1 ? 0 : 0.5, borderColor: LINE }}>
          <Mark tone={i.tone ?? "neutral"} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 9, lineHeight: 1.35, color: INK }}>
              {pdfText(i.text)}
              {i.href ? (
                <>
                  {"  "}
                  <Link src={linkOf(i.href)!} style={{ color: c.pal.strong, fontFamily: BODY_BOLD, textDecoration: "none" }}>
                    {pdfText(i.linkText ?? c.t("Ver", "View"))}
                  </Link>
                </>
              ) : null}
            </Text>
            {i.meta ? <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 1 }}>{pdfText(i.meta)}</Text> : null}
          </View>
        </View>
      ),
    });
  if (s.table?.rows.length) {
    const table = s.table;
    blocks.push({
      wrap: true,
      node: (
        <View style={{ borderWidth: 1, borderColor: LINE, borderRadius: 6, marginTop: 4 }}>
          <View style={{ flexDirection: "row", paddingVertical: 4, paddingHorizontal: 6, borderBottomWidth: 1, borderColor: LINE }}>
            {table.head.map((h, i) => (
              <Text key={i} style={{ flex: i ? 1 : 3, fontSize: 7.5, color: MUTED, textAlign: i ? "right" : "left" }}>
                {pdfText(h)}
              </Text>
            ))}
          </View>
          {table.rows.map((r, ri) => (
            <View key={ri} style={{ flexDirection: "row", paddingVertical: 4, paddingHorizontal: 6, backgroundColor: ri % 2 ? ZEBRA : "#ffffff" }} wrap={false}>
              {r.map((cell, i) =>
                i === 0 && table.links?.[ri] ? (
                  <Link key={i} src={linkOf(table.links[ri]!)!} style={{ flex: 3, fontSize: 8.5, color: c.pal.strong, textDecoration: "none" }}>
                    {pdfText(trunc(cell, 90))}
                  </Link>
                ) : (
                  <Text key={i} style={{ flex: i ? 1 : 3, fontSize: 8.5, color: INK, textAlign: i ? "right" : "left" }}>
                    {pdfText(i ? cell : trunc(cell, 90))}
                  </Text>
                ),
              )}
            </View>
          ))}
        </View>
      ),
    });
  }
  if (s.more) blocks.push({ node: <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 3 }}>{pdfText(s.more)}</Text> });
  if (s.note) blocks.push({ node: <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 4, lineHeight: 1.35 }}>{pdfText(s.note)}</Text> });
  return (
    <View style={{ marginTop: 16 }}>
      <View wrap={false}>
        {header}
        {blocks[0]?.node ?? null}
      </View>
      {blocks.slice(1).map((b, i) => (
        <View key={i} wrap={Boolean(b.wrap)}>
          {b.node}
        </View>
      ))}
    </View>
  );
}

export type PeriodPdfOptions = { lang: Lang; highlights: string[]; logo: LogoSource | null; baseUrl: string };

export function PeriodReportDocument({ r, opts }: { r: PeriodReport; opts: PeriodPdfOptions }) {
  const lang = opts.lang;
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const pal = palette(r.business.color, r.business.color2, r.business.color3);
  const head = headingFont(r.business.fontHeading);
  const c: Ctx = { lang, t, head, pal, base: opts.baseUrl.replace(/\/+$/, "") };
  const sections = reportSections(r, lang);
  const when = periodText(r.period, lang, "long");
  const day = isSingleDay(r.period);
  const prepared = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es", { timeZone: r.period.tz, day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }).format(
    r.generatedAt,
  );
  const title = t(`Reporte de ${r.business.name} — ${when}`, `${r.business.name} report — ${when}`);
  return (
    <Document title={title} author="Matya" creator="Matya" producer="Matya" subject={t("Reporte de resultados", "Results report")} language={lang}>
      <Page size="A4" style={{ paddingTop: 40, paddingBottom: 54, paddingHorizontal: 40, fontFamily: BODY, fontSize: 9.5, color: INK, backgroundColor: "#ffffff" }}>
        <View style={{ marginTop: -40, marginHorizontal: -40, marginBottom: 12 }}>
          <View style={{ backgroundColor: pal.primary, paddingHorizontal: 40, paddingTop: 26, paddingBottom: 20, flexDirection: "row", alignItems: "center", gap: 14 }}>
            {opts.logo ? (
              <View style={{ width: 60, height: 60, backgroundColor: "#ffffff", borderRadius: 10, padding: 5, alignItems: "center", justifyContent: "center" }}>
                <Image src={opts.logo} style={{ width: 50, height: 50, objectFit: "contain" }} />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 9, color: pal.onPrimary, opacity: 0.85, fontFamily: BODY_BOLD, letterSpacing: 1 }}>MATYA</Text>
              <Text style={{ fontSize: 11, color: pal.onPrimary, marginTop: 4 }}>{pdfText(trunc(r.business.name, 70))}</Text>
              <Text style={{ fontFamily: head.family, fontWeight: head.bold, fontSize: 20, color: pal.onPrimary, marginTop: 2 }}>
                {day ? t("Reporte del día", "Daily report") : t("Reporte", "Report")}
              </Text>
              <Text style={{ fontSize: 10.5, color: pal.onPrimary, marginTop: 2 }}>{pdfText(when)}</Text>
            </View>
          </View>
          <View style={{ height: 4, backgroundColor: pal.accent }} />
        </View>
        <View style={{ backgroundColor: pal.soft, borderRadius: 8, padding: 10, borderLeftWidth: 4, borderColor: pal.primary }} wrap={false}>
          <Text style={{ fontFamily: head.family, fontWeight: head.bold, fontSize: 12, color: pal.strong, marginBottom: 4 }}>
            {day ? t("Lo más importante del día", "The most important today") : t("Lo más importante", "The most important")}
          </Text>
          {opts.highlights.map((h, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 5, marginTop: 3 }}>
              <Text style={{ fontSize: 9.5, color: pal.strong, fontFamily: BODY_BOLD }}>{i + 1}.</Text>
              <Text style={{ flex: 1, fontSize: 9.5, lineHeight: 1.4 }}>{pdfText(h)}</Text>
            </View>
          ))}
        </View>
        {sections.length ? (
          sections.map((s) => <SectionView key={s.id} s={s} c={c} />)
        ) : (
          <Text style={{ marginTop: 16, color: MUTED }}>{t("Todavía no hay datos para este periodo.", "There's no data for this period yet.")}</Text>
        )}
        <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 14 }}>
          {pdfText(t(`Preparado el ${prepared} (zona ${r.period.tz}). Solo con datos guardados en la app.`, `Prepared on ${prepared} (${r.period.tz} time zone). Only from data saved in the app.`))}
        </Text>
        <View
          fixed
          style={{
            position: "absolute",
            bottom: 22,
            left: 40,
            right: 40,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            borderTopWidth: 0.5,
            borderColor: LINE,
            paddingTop: 6,
          }}
        >
          <Text style={{ fontSize: 7.5, color: MUTED }}>{t("Preparado con Matya", "Prepared with Matya")}</Text>
          <Text style={{ fontSize: 7.5, color: MUTED }} render={({ pageNumber, totalPages }) => t(`Página ${pageNumber} de ${totalPages}`, `Page ${pageNumber} of ${totalPages}`)} />
        </View>
      </Page>
    </Document>
  );
}

/** El PDF como Buffer (empieza con "%PDF"). */
export async function renderPeriodPdf(r: PeriodReport, opts: PeriodPdfOptions): Promise<Buffer> {
  return renderToBuffer(<PeriodReportDocument r={r} opts={opts} />);
}

/** "reporte-fameseg-2026-10-01-a-2026-10-07.pdf" (solo letras sin acento, números y guiones). */
export function periodPdfName(businessName: string, r: Pick<PeriodReport, "period">, lang: Lang): string {
  const slug =
    businessName
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || (lang === "en" ? "business" : "negocio");
  const p = r.period;
  const span = p.fromDay === p.toDay ? p.fromDay : `${p.fromDay}-${lang === "en" ? "to" : "a"}-${p.toDay}`;
  return `${lang === "en" ? "report" : "reporte"}-${slug}-${span}.pdf`;
}
