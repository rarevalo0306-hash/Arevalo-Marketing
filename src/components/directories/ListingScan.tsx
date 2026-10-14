import { scanListings } from "@/app/actions-directories";
import { RunButton } from "@/components/seo/RunButton";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { readScanReport, SCAN_KIND, scanCostEstimate } from "@/lib/listings-scan";
import { dataForSeoEnabled } from "@/lib/seo/dataforseo";
import { costText } from "@/lib/seo/keywords";
import { latestReports } from "@/lib/seo/reports";
import { BUSINESS_TZ } from "@/lib/time";

/** «Buscar mis fichas automáticamente»: busca en Google tus fichas en los directorios y revisa el teléfono. */
export async function ListingScan({ businessId, phone }: { businessId: string; phone: string }) {
  if (!dataForSeoEnabled()) return null;
  const { lang, t } = await getT();
  const [row] = await latestReports(businessId, SCAN_KIND, 1);
  const scan = row ? readScanReport(row.data) : null;
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeStyle: "short", timeZone: BUSINESS_TZ });
  const different = scan?.hits.filter((h) => h.phone === "different") ?? [];
  return (
    <div className="note info stack" style={{ gap: 10 }}>
      <div className="stack" style={{ gap: 2 }}>
        <strong>{t("🔎 Buscar mis fichas automáticamente", "🔎 Find my listings automatically")}</strong>
        <span className="small">
          {t(
            "Buscamos en Google tu nombre, tu ciudad y tu teléfono, y te decimos en qué directorios ya tienes ficha y si muestran tu mismo teléfono. Las que encontremos se marcan solas abajo.",
            "We search Google for your name, city and phone, and tell you which directories already have your listing and whether they show the same phone. The ones we find get marked below automatically.",
          )}
        </span>
      </div>
      <RunButton
        action={scanListings.bind(null, businessId)}
        label={scan ? t("Buscar otra vez", "Search again") : t("Buscar mis fichas", "Find my listings")}
        busy={t("Buscando en Google…", "Searching Google…")}
        note={t(`Cuesta ≈ ${costText(scanCostEstimate(Boolean(phone)))} de tu saldo de DataForSEO.`, `Costs ≈ ${costText(scanCostEstimate(Boolean(phone)))} from your DataForSEO balance.`)}
      />
      {scan && row && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small muted">
            {t(`Última búsqueda: ${fmt.format(row.createdAt)} · ${scan.hits.length} ${scan.hits.length === 1 ? "ficha encontrada" : "fichas encontradas"}`, `Last search: ${fmt.format(row.createdAt)} · ${scan.hits.length} ${scan.hits.length === 1 ? "listing found" : "listings found"}`)}
          </span>
          {scan.hits.length > 0 && (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {scan.hits.map((h) => (
                <li key={h.id}>
                  <strong>{h.name}</strong>
                  {": "}
                  <a href={h.url} target="_blank" rel="noopener noreferrer">
                    {h.title || h.url}
                  </a>
                  {h.phone === "ok" && <span className="pill done" style={{ marginLeft: 6 }}>{t("teléfono correcto", "phone matches")}</span>}
                  {h.phone === "different" && <span className="pill failed" style={{ marginLeft: 6 }}>{t("teléfono distinto", "different phone")}</span>}
                </li>
              ))}
            </ul>
          )}
          {different.length > 0 && (
            <span className="small">
              {t(
                `Corrige el teléfono en: ${different.map((h) => h.name).join(", ")}. Entra a la ficha, reclámala si no es tuya todavía y pon exactamente el de tu tarjeta de arriba.`,
                `Fix the phone on: ${different.map((h) => h.name).join(", ")}. Open the listing, claim it if it isn't yours yet and enter exactly the one on your card above.`,
              )}
            </span>
          )}
          <span className="small muted">
            {t(
              "Que un directorio no salga no siempre quiere decir que no tengas ficha: Google no muestra todas. Revísalo con «Buscar si ya estoy».",
              "A directory not showing up doesn't always mean you have no listing: Google doesn't show them all. Check with “Check if I'm listed”.",
            )}
          </span>
        </div>
      )}
      <span className="small muted">
        {t(
          "Publicar tus datos en todos los directorios a la vez (como hace Semrush o Yext) requiere un servicio pagado con mensualidad por local; no lo activamos sin tu permiso. Mientras tanto, la lista de abajo te lleva directorio por directorio.",
          "Publishing your details to every directory at once (like Semrush or Yext do) needs a paid service with a monthly fee per location; we don't turn it on without your permission. Meanwhile, the list below takes you directory by directory.",
        )}
      </span>
    </div>
  );
}
