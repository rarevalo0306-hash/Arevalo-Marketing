"use client";

// «Tus plantillas en cada red»: cada formato de cada red (Facebook, Instagram, TikTok, YouTube…) con tu plantilla
// dibujada en su medida (se reacomoda, no se estira). Los que todavía no se hacen con plantillas lo dicen.
import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/I18n";
import type { PlacementPlan } from "@/lib/placements";
import s from "./Placements.module.css";

export type PlacementCard = {
  id: string;
  label: string;
  size: string;
  /** Medida de la vista previa (para reservar su lugar mientras carga). */
  w: number;
  h: number;
  plan: PlacementPlan;
  planLabel: { es: string; en: string };
  evidence: { es: string; en: string };
  experimental: boolean;
};
export type PlacementGroup = { platform: string; label: string; items: PlacementCard[] };

export function PlacementsPanel({ businessId, templates, groups, version }: { businessId: string; templates: { key: string; name: string }[]; groups: PlacementGroup[]; version: string }) {
  const { lang, t } = useT();
  const L = lang === "en" ? "en" : "es";
  const [tpl, setTpl] = useState(templates[0]?.key ?? "");
  const src = (id: string, dl = false) => `/api/plantilla?${new URLSearchParams({ b: businessId, t: tpl, p: id, v: version, ...(dl ? { dl: "1" } : {}) })}`;
  return (
    <div className="stack" style={{ gap: 14 }}>
      {templates.length > 1 && (
        <label className={s.pick}>
          <span className="lbl">{t("Ver con la plantilla", "Show with the template")}</span>
          <select className="field" value={tpl} onChange={(e) => setTpl(e.target.value)}>
            {templates.map((x) => (
              <option key={x.key} value={x.key}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {groups.map((g, gi) => {
        const ready = g.items.filter((x) => x.plan === "design" || x.plan === "photo").length;
        return (
          <details key={g.platform} className={s.group} open={gi === 0}>
            <summary className={s.summary}>
              <strong>{g.label}</strong>
              <span className="small muted">
                {t(`${g.items.length} formatos · ${ready} con tus plantillas`, `${g.items.length} formats · ${ready} with your templates`)}
              </span>
            </summary>
            <div className={s.grid}>
              {g.items.map((x) => {
                const drawn = x.plan === "design" || x.plan === "photo";
                return (
                  <figure key={x.id} className={s.card}>
                    <div className={s.frame} style={{ aspectRatio: `${x.w} / ${x.h}` }}>
                      {drawn && tpl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- vista previa dibujada en el servidor
                        <img src={src(x.id)} alt={`${g.label}: ${x.label}`} width={x.w} height={x.h} loading="lazy" />
                      ) : (
                        <span className={s.placeholder}>{x.planLabel[L]}</span>
                      )}
                    </div>
                    <figcaption className="stack" style={{ gap: 2 }}>
                      <strong className={s.label}>{x.label}</strong>
                      <span className="small muted">{x.size}</span>
                      <span className={s.chips}>
                        <span className={`${s.chip} ${s[x.plan]}`}>{x.planLabel[L]}</span>
                        <span className={s.chip}>{x.evidence[L]}</span>
                        {x.experimental && <span className={`${s.chip} ${s.adapt}`}>{t("Experimental", "Experimental")}</span>}
                      </span>
                      {drawn && tpl && (
                        <a className="small" href={src(x.id, true)} download>
                          {t("Descargar en tamaño real", "Download at full size")}
                        </a>
                      )}
                      {x.plan === "kit" && (
                        <a className="small" href="#kit">
                          {t("Ver el kit de marca ↑", "See the brand kit ↑")}
                        </a>
                      )}
                      {x.plan === "video" && (
                        <Link className="small" href={`/b/${businessId}/videos`}>
                          {t("Ir a Videos →", "Go to Videos →")}
                        </Link>
                      )}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}
