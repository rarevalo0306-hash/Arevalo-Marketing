"use client";

// "¿Los tamaños están bien?": qué tamaño recibe cada red. La app los hace sola al publicar.
import { useT } from "@/components/I18n";
import { CHANNEL_FORMATS, VIDEO_FORMAT } from "@/lib/formats";

export function SizesInfo() {
  const { lang, t } = useT();
  const rows = Object.values(CHANNEL_FORMATS).filter(Boolean);
  return (
    <details className="small">
      <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--link)" }}>{t("¿Qué tamaño recibe cada red?", "What size does each network get?")}</summary>
      <div className="stack" style={{ gap: 6, marginTop: 8 }}>
        <span className="muted">{t("No tienes que hacer nada: al publicar, la app prepara una copia del tamaño correcto para cada red (y vuelve a dibujar tu diseño para que no se corte el titular).", "You don't have to do anything: when publishing, the app makes a copy in the right size for each network (and redraws your design so the headline isn't cut off).")}</span>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {rows.map((f) => <li key={f!.es}>{lang === "en" ? f!.en : f!.es}</li>)}
          <li>{lang === "en" ? VIDEO_FORMAT.en : VIDEO_FORMAT.es}</li>
        </ul>
      </div>
    </details>
  );
}
