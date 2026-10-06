import { runMapRank } from "@/app/actions-seo-maprank";
import { MapPlacePicker } from "@/components/seo/MapPlacePicker";
import { MapRankForm } from "@/components/seo/MapRankForm";
import { MapRankView, type MapHistoryItem } from "@/components/seo/MapRankView";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readTrackedKeywords, readZones, zoneLabel } from "@/lib/seo/dataforseo";
import { MAP_COST_PER_POINT, MAP_KEEP, mapTiles, readMapPlace, readMapReport } from "@/lib/seo/maprank";
import { latestReports } from "@/lib/seo/reports";
import { BUSINESS_TZ } from "@/lib/time";

/** Lo que se manda al navegador: el mapa con su id (sin la fecha de la base de datos). */
const stripSaved = <R extends { savedAt: Date }>({ savedAt, ...rest }: R) => {
  void savedAt;
  return rest;
};

/**
 * Mapa de calor en Google Maps: el lugar del negocio en Google Maps desde muchos puntos alrededor de él.
 * `mapId` (opcional) abre un mapa guardado en particular; si no, el más nuevo.
 */
export async function MapRankPanel({ businessId, mapId }: { businessId: string; mapId?: string }) {
  const { lang, t } = await getT();
  const header = (
    <div className="stack" style={{ gap: 4 }}>
      <h2>{t("Mapa de calor en Google Maps", "Google Maps heatmap")}</h2>
      <p className="small muted">
        {t(
          "Cada punto es alguien buscando desde ese lugar; el número es tu lugar en el mapa de Google. Verde = te ven primero; rojo o gris = no te encuentran.",
          "Each point is someone searching from that spot; the number is your place on Google's map. Green = they see you first; red or gray = they can't find you.",
        )}
      </p>
    </div>
  );

  if (!dataForSeoEnabled()) {
    return (
      <section className="card" id="mapa">
        {header}
        <p className="note">
          {t(
            "Para hacer el mapa de calor necesitas conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).",
            "To make the heatmap you need to connect DataForSEO (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).",
          )}
        </p>
      </section>
    );
  }

  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, seoKeywords: true, seoMapPlace: true },
  });
  if (!b) return null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  if (!zones.length) {
    return (
      <section className="card" id="mapa">
        {header}
        <p className="note">
          {t(
            "Para hacer el mapa, primero elige la zona donde buscan tus clientes en «Datos reales de Google», aquí arriba.",
            "To make the map, first pick the area where your customers search in “Real Google data” above.",
          )}
        </p>
      </section>
    );
  }

  const place = readMapPlace(b.seoMapPlace);
  const picker = (
    <MapPlacePicker
      businessId={businessId}
      current={place}
      defaultQuery={place?.title ?? b.name}
      zoneName={zoneLabel(zones[0].name) || t("tu zona principal", "your main area")}
      perSearch={MAP_COST_PER_POINT}
    />
  );

  if (!place) {
    return (
      <section className="card" id="mapa">
        {header}
        {picker}
      </section>
    );
  }

  const saved = await latestReports(businessId, "maprank", MAP_KEEP);
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeStyle: "short", timeZone: BUSINESS_TZ });
  const maps = saved.flatMap((r) => {
    const report = readMapReport(r.data);
    return report ? [{ ...report, id: r.id, savedAt: r.createdAt }] : [];
  });
  const selected = maps.find((m) => m.id === mapId) ?? maps[0] ?? null;
  const history: MapHistoryItem[] = maps.map((m) => ({
    id: m.id,
    keyword: m.keyword,
    size: m.size,
    spacingKm: m.spacingKm,
    when: fmt.format(m.savedAt),
    avgRank: m.avgRank,
    top3Share: m.top3Share,
    placeTitle: m.place.title,
  }));
  const keywords = readTrackedKeywords(b.seoKeywords);
  const last = maps[0];

  return (
    <section className="card" id="mapa">
      {header}
      {picker}
      <MapRankForm
        action={runMapRank.bind(null, businessId)}
        keywords={keywords}
        lastKeyword={last?.keyword}
        lastSize={last?.size}
        lastSpacing={last?.spacingKm}
        has={maps.length > 0}
      />
      {selected ? (
        <MapRankView
          // Un mapa nuevo vuelve a empezar la vista en él.
          key={maps[0].id}
          businessId={businessId}
          initial={stripSaved(selected)}
          history={history}
          placeTitle={place.title}
          // Clave gratis de CARTO (carto.com/basemaps/apikey) en Vercel; sin ella se usa OpenStreetMap.
          tiles={mapTiles(process.env.CARTO_BASEMAPS_KEY)}
        />
      ) : saved.length ? (
        <p className="note">{t("Tu último mapa tiene un formato viejo y no se puede mostrar. Haz uno nuevo.", "Your last map is in an old format and can't be shown. Make a new one.")}</p>
      ) : (
        <p className="small muted">
          {t(
            "Todavía no has hecho tu mapa. Elige una palabra clave (por ejemplo, lo que vendes + tu ciudad) y presiona «Hacer mi mapa». Empieza con 5×5 y 1 km si atiendes una ciudad.",
            "You haven't made your map yet. Pick a keyword (for example, what you sell + your city) and press “Make my map”. Start with 5×5 and 1 km if you serve one city.",
          )}
        </p>
      )}
    </section>
  );
}
