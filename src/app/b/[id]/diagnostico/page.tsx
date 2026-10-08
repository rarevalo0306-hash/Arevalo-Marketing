// Diagnóstico guiado: la app corre sola los estudios en orden (leer la web, estudio, zonas y palabras, competencia,
// revisión de la página, posiciones, Google Maps, perfil, IAs) y al final arma el plan de acción.
import { notFound } from "next/navigation";
import { PageHead } from "@/components/PageHead";
import { DiagnosisRunner } from "@/components/diagnosis/DiagnosisRunner";
import { loadDiagnosis } from "@/components/diagnosis/load";
import { MapPlacePicker } from "@/components/seo/MapPlacePicker";
import { SeoSetup } from "@/components/seo/SeoSetup";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { readZones, zoneLabel } from "@/lib/seo/dataforseo";
import { KEYWORDS_CALL_COST } from "@/lib/seo/keywords";
import { MAP_COST_PER_POINT, readMapPlace } from "@/lib/seo/maprank";
import { RANK_COST_PER_KEYWORD } from "@/lib/seo/rank";
import { setupState } from "@/lib/seo/setup";

// Cada paso es una llamada aparte desde el navegador; algunos (estudio, revisión, IAs) tardan unos minutos.
export const maxDuration = 300;

export default async function DiagnosticoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ rehacer?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const [view, b] = await Promise.all([
    loadDiagnosis(id),
    db.business.findUnique({ where: { id }, select: { name: true, color: true, website: true, seoMapPlace: true, seoLocations: true, seoLocationCode: true, seoLocationName: true } }),
  ]);
  if (!view || !b) notFound();
  const { t } = await getT();
  const { facts } = view;

  // Paso 3: aceptar o quitar las zonas y palabras propuestas (la misma tarjeta del Resumen).
  const needsSetup = !(facts.zones > 0 && facts.keywords > 0);
  const saved = needsSetup ? (await setupState(id)).proposal : null;
  const setupSlot = needsSetup ? (
    <SeoSetup businessId={id} needed saved={saved} price={RANK_COST_PER_KEYWORD} measurePrice={KEYWORDS_CALL_COST} hasWebsite={facts.website} />
  ) : null;

  // Paso 7: decir cuál es el negocio en Google Maps.
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const place = readMapPlace(b.seoMapPlace);
  const mapSlot = zones.length ? (
    <div className="card">
      <MapPlacePicker
        businessId={id}
        current={place}
        defaultQuery={place?.title ?? b.name}
        zoneName={zoneLabel(zones[0].name) || t("tu zona principal", "your main area")}
        perSearch={MAP_COST_PER_POINT}
      />
    </div>
  ) : null;

  // Negocio nuevo con página web: el paso 1 (leer la web, gratis) empieza solo.
  const autoStart = !view.state.startedAt && facts.website && !facts.study && view.steps[0].status === "pending";

  return (
    <>
      <PageHead
        business={{ ...b, id }}
        prefix={t("Diagnóstico de", "Diagnosis for")}
        title={t("Diagnóstico guiado", "Guided diagnosis")}
        subtitle={t(
          "La IA conoce tu negocio paso a paso: lee tu web, estudia tu mercado, revisa tu página, tu competencia, Google Maps y las IAs, y te deja un plan de acción. Solo te pregunta lo importante.",
          "The AI gets to know your business step by step: it reads your website, studies your market, checks your site, your competitors, Google Maps and AI assistants, and leaves you an action plan. It only asks you what matters.",
        )}
      />
      <DiagnosisRunner initial={view} setupSlot={setupSlot} mapSlot={mapSlot} autoStart={autoStart} redoAll={q.rehacer === "1"} />
    </>
  );
}
