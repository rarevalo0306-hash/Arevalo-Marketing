"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18n";
import { translator } from "@/lib/i18n";
import { rankBand, type MapReport, type MapTiles } from "@/lib/seo/maprank-shared";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const PIN =
  '<svg width="28" height="40" viewBox="0 0 28 40" aria-hidden="true"><path d="M14 1C6.8 1 1 6.7 1 13.8 1 23.5 14 39 14 39s13-15.5 13-25.2C27 6.7 21.2 1 14 1z" fill="#0a5bb5" stroke="#fff" stroke-width="2"/><circle cx="14" cy="13.5" r="5" fill="#fff"/></svg>';

/**
 * El mapa de calor: un círculo de color por punto con tu lugar adentro, y un pin en tu negocio.
 * Leaflet solo funciona en el navegador, así que se carga dentro de useEffect.
 */
export function MapRankMap({ report, placeTitle, tiles }: { report: MapReport; placeTitle: string; tiles: MapTiles }) {
  const { lang } = useT();
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const t = translator(lang);
    let cancelled = false;
    let map: import("leaflet").Map | null = null;
    (async () => {
      try {
        const mod = await import("leaflet");
        const L = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
        if (cancelled || !el.current) return;
        // En el celular, un dedo mueve la página (no el mapa); con dos dedos se mueve y acerca el mapa.
        map = L.map(el.current, { scrollWheelZoom: false, dragging: !L.Browser.mobile, attributionControl: true });
        L.tileLayer(tiles.url, { ...(tiles.subdomains ? { subdomains: tiles.subdomains } : {}), maxZoom: tiles.maxZoom, attribution: tiles.attribution }).addTo(map);

        const n = report.points.length;
        report.points.forEach((p, i) => {
          const band = rankBand(p.rank, p.error);
          const label = p.error ? "!" : p.rank === null ? "20+" : String(p.rank);
          const icon = L.divIcon({
            className: "mr-icon",
            html: `<span class="mr-dot mr-${band}">${esc(label)}</span>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
            popupAnchor: [0, -14],
          });
          const where = p.error
            ? `<p class="mr-pop-bad">${esc(t("No se pudo revisar este punto:", "This point couldn't be checked:"))} ${esc(lang === "en" ? p.error.en : p.error.es)}</p>`
            : p.rank === null
              ? `<p class="mr-pop-bad">${esc(t("Aquí no sales en los 20 primeros.", "You're not in the top 20 here."))}</p>`
              : `<p><strong>${esc(t(`Aquí sales en el lugar ${p.rank}`, `You're #${p.rank} here`))}</strong></p>`;
          const top = p.top3.length
            ? `<ol class="mr-pop-top">${p.top3
                .map((x) => `<li value="${x.rank}"${x.rank === p.rank ? ' class="mine"' : ""}>${esc(x.title)}${x.rank === p.rank ? ` ${esc(t("(tú)", "(you)"))}` : ""}</li>`)
                .join("")}</ol>`
            : "";
          const html = `<div class="mr-pop"><span class="mr-pop-head">${esc(t(`Punto ${i + 1} de ${n}`, `Point ${i + 1} of ${n}`))}</span>${where}${
            top ? `<span class="mr-pop-head">${esc(t("Los 3 primeros aquí:", "Top 3 here:"))}</span>${top}` : ""
          }</div>`;
          L.marker([p.lat, p.lng], { icon, keyboard: true, title: label, riseOnHover: true }).bindPopup(html, { maxWidth: 260 }).addTo(map!);
        });

        // Tu negocio: un pin detrás del punto del centro (la punta del pin queda justo en tu negocio).
        L.marker([report.center.lat, report.center.lng], {
          icon: L.divIcon({ className: "mr-icon", html: PIN, iconSize: [28, 40], iconAnchor: [14, 40], popupAnchor: [0, -36] }),
          zIndexOffset: -1000,
          title: placeTitle,
        })
          .bindPopup(`<div class="mr-pop"><strong>${esc(placeTitle)}</strong><span class="mr-pop-head">${esc(t("Tu negocio", "Your business"))}</span></div>`)
          .addTo(map);

        const bounds = L.latLngBounds(report.points.map((p) => [p.lat, p.lng] as [number, number]));
        map.fitBounds(bounds.pad(0.08), { padding: [20, 20] });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [report, placeTitle, lang, tiles.url, tiles.attribution, tiles.subdomains, tiles.maxZoom]);

  const t = translator(lang);
  return (
    <div className="mr-map-box">
      <div ref={el} className="mr-map" role="region" aria-label={t("Mapa de calor de tu posición en Google Maps", "Heatmap of your Google Maps ranking")} />
      {failed && <p className="note error">{t("No se pudo cargar el mapa. Revisa tu conexión y recarga la página.", "The map couldn't load. Check your connection and reload the page.")}</p>}
    </div>
  );
}
