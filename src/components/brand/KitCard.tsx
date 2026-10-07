"use client";

import { useT } from "@/components/I18n";
import type { KitItem } from "@/components/brand/KitPanel";
import type { KitFormat, KitPlace } from "@/lib/brand-kit-formats";
import s from "./Kit.module.css";

export const downloadUrl = (businessId: string, assetId: string, lang: string) => `/api/brand-kit/${businessId}/file/${assetId}?lang=${lang}`;

/** "¿Cómo la subo?": pasos cortos para cada lugar donde se usa. */
export function HowTo({ places, title }: { places: KitPlace[]; title?: string }) {
  const { t, lang } = useT();
  if (!places.length) return null;
  return (
    <details className={s.howto}>
      <summary>{title ?? t("¿Cómo la subo?", "How do I upload it?")}</summary>
      <div className={s.places}>
        {places.map((p) => (
          <div key={p.name.es} className={s.place}>
            <strong>{p.name[lang]}</strong>
            <ol>
              {p.steps[lang].map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </details>
  );
}

function Preview({ item, alt, small }: { item: KitItem; alt: string; small?: boolean }) {
  return (
    <div className={`${s.preview} ${item.transparent ? s.checker : ""} ${item.format === "logo-white" ? s.onDark : ""} ${small ? s.previewSmall : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.url} alt={alt} loading="lazy" width={item.w} height={item.h} />
    </div>
  );
}

export function KitCard({ businessId, format, item }: { businessId: string; format: KitFormat; item: KitItem }) {
  const { t, lang } = useT();
  const label = format.label[lang];
  return (
    <figure className={s.item}>
      <Preview item={item} alt={label} />
      <figcaption className={s.body}>
        <div className={s.head}>
          <strong>{label}</strong>
          <span className={`small muted ${s.size}`}>
            {item.w} × {item.h} px{item.transparent ? t(" · fondo transparente", " · transparent background") : ""}
          </span>
        </div>
        <p className="small">
          <span className="muted">{t("Dónde se usa: ", "Where it's used: ")}</span>
          {format.where[lang]}
        </p>
        <HowTo places={format.places} />
        <a className={`btn ${s.download}`} href={downloadUrl(businessId, item.id, lang)} download>
          {t("Descargar", "Download")}
        </a>
      </figcaption>
    </figure>
  );
}

/** Los cuatro íconos del sitio en una sola tarjeta. */
export function KitFavicons({ businessId, formats, items }: { businessId: string; formats: KitFormat[]; items: Map<string, KitItem> }) {
  const { t, lang } = useT();
  const big = items.get("favicon-512") ?? items.get(formats[formats.length - 1].key)!;
  const howTo = formats.find((f) => f.places.length)?.places ?? [];
  return (
    <figure className={s.item}>
      <Preview item={big} alt={t("Ícono del sitio", "Site icon")} small />
      <figcaption className={s.body}>
        <div className={s.head}>
          <strong>{t("Íconos del sitio web (favicon)", "Website icons (favicon)")}</strong>
          <span className="small muted">{t("4 tamaños", "4 sizes")}</span>
        </div>
        <p className="small">
          <span className="muted">{t("Dónde se usa: ", "Where it's used: ")}</span>
          {t("La pestaña del navegador y la pantalla del celular cuando alguien guarda tu sitio.", "The browser tab and the phone's home screen when someone saves your site.")}
        </p>
        <ul className={s.sizes}>
          {formats.map((f) => {
            const it = items.get(f.key);
            if (!it) return null;
            return (
              <li key={f.key}>
                <span className={s.sizeName}>
                  <span>{f.label[lang]}</span>
                  <span className="small muted">{f.where[lang]}</span>
                </span>
                <a className="btn" href={downloadUrl(businessId, it.id, lang)} download aria-label={`${t("Descargar", "Download")} ${f.label[lang]}`}>
                  {t("Descargar", "Download")}
                </a>
              </li>
            );
          })}
        </ul>
        <HowTo places={howTo} />
      </figcaption>
    </figure>
  );
}
