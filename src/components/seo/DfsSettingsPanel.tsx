import { saveSeoSettings } from "@/app/actions-seo-dfs";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { dataForSeoBalance, dataForSeoEnabled, readTrackedKeywords, readZones } from "@/lib/seo/dataforseo";
import { readKeywordsReport, reportLookup } from "@/lib/seo/keywords";
import { RANK_COST_PER_KEYWORD, readRankReport } from "@/lib/seo/rank";
import { guessCountry, settingsSuggestions, setupState } from "@/lib/seo/setup";
import { asFrequency, keywordExample, normKeyword } from "@/lib/seo/setup-shared";
import { latestByZone } from "@/lib/seo/zones";
import { readStudy, topKeywords } from "@/lib/study-shape";
import { DfsSettingsForm, type KwInfo } from "./DfsSettingsForm";

/** El idioma de una búsqueda, si se nota (acentos o palabras comunes); null si no se sabe. */
function guessLang(k: string): "es" | "en" | null {
  if (/[áéíóúñü¿]/i.test(k) || /\b(de|del|para|en|cerca|el|la|los|las|y|con|por|precio|servicio|mantenimiento|reparaci[oó]n)\b/i.test(k) || /\w(ci[oó]n|ones|ales|icas?|icos?|ados?|adas?)\b/i.test(k)) return "es";
  if (/\b(near|me|for|in|best|the|and|repair|service|services|company|cost|how|to|of|with|my|help|claim|insurance|damage|water|roof|door|doors|cheap|top)\b/i.test(k)) return "en";
  return null;
}

/** Configuración de los datos de Google con DataForSEO: zonas, idioma, palabras clave que se siguen, frecuencia y saldo. */
export async function DfsSettingsPanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  if (!dataForSeoEnabled()) {
    return (
      <section className="card" id="dataforseo">
        <h2>{t("Datos reales de Google (DataForSEO)", "Real Google data (DataForSEO)")}</h2>
        <p className="small muted">
          {t(
            "Con una cuenta de DataForSEO verás cuánta gente busca cada palabra clave, en qué lugar sales en Google y qué hacen tus competidores. Agrega DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel.",
            "With a DataForSEO account you'll see how many people search each keyword, where you rank on Google and what your competitors do. Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel.",
          )}
        </p>
      </section>
    );
  }
  const b = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      seoLocations: true,
      seoLocationCode: true,
      seoLocationName: true,
      seoLanguage: true,
      seoKeywords: true,
      seoDaily: true,
      seoRankDays: true,
      study: true,
      aiProfile: true,
      seoReports: { where: { kind: { in: ["rank", "keywords"] } }, orderBy: { createdAt: "desc" }, take: 30, select: { kind: true, data: true } },
    },
  });
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const tracked = readTrackedKeywords(b.seoKeywords);
  const study = readStudy(b.study);
  const fromStudy = !tracked.length && Boolean(study);
  const initialKeywords = tracked.length ? tracked : study ? topKeywords(study, 15) : [];
  const [balance, sug, setup] = await Promise.all([dataForSeoBalance(), settingsSuggestions(businessId), setupState(businessId)]);

  // Lo que ya se sabe de cada palabra en la zona principal: su lugar en Google y las búsquedas al mes.
  const rank = zones.length ? latestByZone(b.seoReports.filter((r) => r.kind === "rank").map((r) => readRankReport(r.data)), zones).get(zones[0].code) : undefined;
  const kw = zones.length ? latestByZone(b.seoReports.filter((r) => r.kind === "keywords").map((r) => readKeywordsReport(r.data)), zones).get(zones[0].code) : undefined;
  const volumes = reportLookup(kw ?? null);
  const info: Record<string, KwInfo> = {};
  for (const k of initialKeywords) {
    const n = normKeyword(k);
    const row = rank?.rows.find((r) => normKeyword(r.keyword) === n && !r.error);
    // Búsquedas al mes: del último reporte de palabras clave o, si no hay, de la medición de la puesta en marcha.
    const v = volumes.get(n)?.volume ?? setup.proposal?.keywords.find((x) => normKeyword(x.keyword) === n)?.volume;
    info[n] = { ...(row ? { position: row.position } : {}), ...(v !== undefined ? { volume: v } : {}) };
  }
  for (const s of sug.list) {
    const v = volumes.get(normKeyword(s.keyword));
    if (v && s.volume === undefined) s.volume = v.volume;
  }

  // Ejemplos del propio negocio para el idioma (los del estudio dicen su idioma).
  const pool = [...(study?.keywords.map((k) => ({ k: k.keyword, l: k.lang })) ?? []), ...[...initialKeywords, ...sug.list.map((s) => s.keyword)].map((k) => ({ k, l: guessLang(k) }))];
  const examples = {
    es: keywordExample(pool.filter((x) => x.l === "es").map((x) => x.k), "es"),
    en: keywordExample(pool.filter((x) => x.l === "en").map((x) => x.k), "en"),
  };
  const money = new Intl.NumberFormat(lang === "en" ? "en-US" : "es", { style: "currency", currency: "USD" });
  return (
    <section className="card stack" id="dataforseo" style={{ gap: 16 }}>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div className="stack" style={{ gap: 4, flex: "1 1 260px" }}>
          <h2>{t("Ajustes de tu SEO", "Your SEO settings")}</h2>
          <p className="small muted">
            {t(
              "Cuatro pasos: dónde están tus clientes, en qué idioma buscan, qué buscan y cada cuánto revisamos. Con esto se llenan las demás pestañas con datos reales de Google.",
              "Four steps: where your customers are, what language they search in, what they search for and how often we check. This fills the other tabs with real Google data.",
            )}
          </p>
        </div>
        {balance !== null && (
          <span className="pill done" title={t("Saldo de tu cuenta de DataForSEO", "Your DataForSEO account balance")}>
            {t("Saldo", "Balance")}: {money.format(balance)}
          </span>
        )}
      </div>
      <DfsSettingsForm
        businessId={businessId}
        action={saveSeoSettings.bind(null, businessId)}
        initial={{ zones, language: b.seoLanguage === "en" ? "en" : "es", keywords: initialKeywords, frequency: asFrequency(b.seoDaily, b.seoRankDays) }}
        info={info}
        suggestions={sug.list.filter((s) => !initialKeywords.some((k) => normKeyword(k) === normKeyword(s.keyword)))}
        price={RANK_COST_PER_KEYWORD}
        examples={examples}
        defaultCountry={guessCountry([b.aiProfile, study?.market.area].filter(Boolean).join(" "), zones)}
        fromStudy={fromStudy}
      />
    </section>
  );
}
