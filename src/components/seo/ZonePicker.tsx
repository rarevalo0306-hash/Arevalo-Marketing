"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { searchSeoPlaces, seoLocationChildren } from "@/app/actions-seo-dfs";
import { useT } from "@/components/I18n";
import { MAX_ZONES, type Zone } from "@/lib/seo/dataforseo";
import { COUNTRIES, placeLabel, type TreeLocation, zoneCountry, zoneTypeLabel } from "@/lib/seo/setup-shared";
import styles from "./DfsSettings.module.css";

// Lo que ya se pidió en esta visita (las listas no cambian): no volver a llamar al servidor.
const memo = new Map<string, TreeLocation[]>();

async function children(iso: string, parent: number | null): Promise<TreeLocation[]> {
  const key = `${iso}:${parent ?? "root"}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const r = await seoLocationChildren(iso, parent);
  if (!r.ok) throw new Error(r.error);
  memo.set(key, r.locations);
  return r.locations;
}

/** El tipo que más se repite en una lista ("State", "County"…), para el título de la lista. */
function mainType(list: TreeLocation[]): string | undefined {
  const count = new Map<string, number>();
  for (const l of list) count.set(l.type, (count.get(l.type) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Agrupa por tipo para las listas (<optgroup>): condados, ciudades… */
function groups(list: TreeLocation[]): [string, TreeLocation[]][] {
  const out = new Map<string, TreeLocation[]>();
  for (const l of list) out.set(l.type, [...(out.get(l.type) ?? []), l]);
  return [...out.entries()];
}

const shortName = (name: string) => name.split(",")[0].trim();

/**
 * Escoger zonas de Google en cascada: país → estado/departamento → condado o ciudad, más un buscador por nombre.
 * Las elegidas se ven como fichas; la primera es la principal. Máximo 5.
 */
export function ZonePicker({ zones, onChange, defaultCountry }: { zones: Zone[]; onChange: (z: Zone[]) => void; defaultCountry?: string }) {
  const { lang, t } = useT();
  const [country, setCountry] = useState<string>(() => (zones[0] && zoneCountry(zones[0].name)) || defaultCountry || "us");
  const [root, setRoot] = useState<TreeLocation | null>(null);
  const [level1, setLevel1] = useState<TreeLocation[]>([]);
  const [pick1, setPick1] = useState<number | null>(null);
  const [level2, setLevel2] = useState<TreeLocation[]>([]);
  const [pick2, setPick2] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, startLoading] = useTransition();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<TreeLocation[] | null>(null);
  const [searching, startSearch] = useTransition();
  const full = zones.length >= MAX_ZONES;

  // País elegido: el país mismo y lo que tiene adentro (estados, departamentos…).
  useEffect(() => {
    let alive = true;
    setRoot(null);
    setLevel1([]);
    setPick1(null);
    setLevel2([]);
    setPick2(null);
    setFound(null);
    setError("");
    startLoading(async () => {
      try {
        const top = await children(country, null);
        const c = top.find((l) => l.type === "Country") ?? null;
        const inside = c ? await children(country, c.code) : top.filter((l) => l.type !== "Country");
        if (!alive) return;
        setRoot(c);
        setLevel1(inside);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    });
    return () => {
      alive = false;
    };
  }, [country]);

  const choose1 = (code: number | null) => {
    setPick1(code);
    setPick2(null);
    setLevel2([]);
    if (code === null) return;
    startLoading(async () => {
      try {
        setLevel2(await children(country, code));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const add = (l: { code: number; name: string; type?: string }) => {
    if (zones.some((z) => z.code === l.code) || full) return;
    onChange([...zones, { code: l.code, name: l.name, ...(l.type ? { type: l.type } : {}) }]);
  };
  const remove = (code: number) => onChange(zones.filter((z) => z.code !== code));
  const makeMain = (code: number) => {
    const z = zones.find((x) => x.code === code);
    if (z) onChange([z, ...zones.filter((x) => x.code !== code)]);
  };

  const selected = useMemo(() => {
    if (pick2 !== null) return level2.find((l) => l.code === pick2) ?? null;
    if (pick1 !== null) return level1.find((l) => l.code === pick1) ?? null;
    return root;
  }, [pick1, pick2, level1, level2, root]);
  const countryName = COUNTRIES.find(([iso]) => iso === country);
  const already = selected ? zones.some((z) => z.code === selected.code) : false;

  const search = () =>
    startSearch(async () => {
      setError("");
      const r = await searchSeoPlaces(country, query);
      if (r.ok) setFound(r.locations);
      else setError(r.error);
    });

  const t1 = mainType(level1);
  const label1 = t1 ? zoneTypeLabel(t1, lang) : t("Región", "Region");

  return (
    <div className="stack" style={{ gap: 12 }}>
      {zones.length > 0 ? (
        <ul className={styles.chips} aria-label={t("Zonas elegidas", "Chosen areas")}>
          {zones.map((z, i) => (
            <li key={z.code} className={`${styles.chip} ${i === 0 ? styles.chipMain : ""}`} title={z.name}>
              <span className={styles.chipText}>
                <strong>{placeLabel(z.name) || z.code}</strong>
                <span className="small muted">
                  {[zoneTypeLabel(z.type, lang), i === 0 ? t("principal", "main") : ""].filter(Boolean).join(" · ")}
                </span>
              </span>
              {i > 0 && (
                <button type="button" className={styles.chipBtn} onClick={() => makeMain(z.code)} title={t("Hacerla la principal", "Make it the main one")} aria-label={t(`Hacer principal: ${z.name}`, `Make main: ${z.name}`)}>
                  ★
                </button>
              )}
              <button type="button" className={styles.chipBtn} onClick={() => remove(z.code)} aria-label={t(`Quitar ${z.name}`, `Remove ${z.name}`)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">{t("Todavía no hay zonas. Elige abajo dónde están tus clientes.", "No areas yet. Pick below where your customers are.")}</p>
      )}

      {full ? (
        <p className="small muted">{t("Ya tienes 5 zonas (el máximo). Quita una para agregar otra.", "You already have 5 areas (the maximum). Remove one to add another.")}</p>
      ) : (
        <div className={styles.picker}>
          <div className={styles.cascade}>
            <label className={styles.level}>
              <span className="lbl">{t("País", "Country")}</span>
              <select className="field" value={country} onChange={(e) => setCountry(e.target.value)}>
                {COUNTRIES.map(([iso, es, en]) => (
                  <option key={iso} value={iso}>
                    {t(es, en)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.level}>
              <span className="lbl">{label1}</span>
              <select className="field" value={pick1 ?? ""} onChange={(e) => choose1(e.target.value ? Number(e.target.value) : null)} disabled={!level1.length}>
                <option value="">{level1.length ? t("— Todo el país —", "— Whole country —") : loading ? t("Cargando…", "Loading…") : "—"}</option>
                {groups(level1).map(([type, list]) => (
                  <optgroup key={type} label={zoneTypeLabel(type, lang)}>
                    {list.map((l) => (
                      <option key={l.code} value={l.code}>
                        {shortName(l.name)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {pick1 !== null && (
              <label className={styles.level}>
                <span className="lbl">{t("Condado, ciudad o distrito", "County, city or district")}</span>
                <select className="field" value={pick2 ?? ""} onChange={(e) => setPick2(e.target.value ? Number(e.target.value) : null)} disabled={!level2.length}>
                  <option value="">
                    {level2.length ? t(`— Todo ${shortName(level1.find((l) => l.code === pick1)?.name ?? "")} —`, `— All of ${shortName(level1.find((l) => l.code === pick1)?.name ?? "")} —`) : loading ? t("Cargando…", "Loading…") : t("— No hay más divisiones —", "— No smaller areas —")}
                  </option>
                  {groups(level2).map(([type, list]) => (
                    <optgroup key={type} label={zoneTypeLabel(type, lang)}>
                      {list.map((l) => (
                        <option key={l.code} value={l.code}>
                          {shortName(l.name)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn primary" disabled={!selected || already || loading} onClick={() => selected && add(selected)}>
              {selected
                ? already
                  ? t(`✓ ${shortName(selected.name)} ya está`, `✓ ${shortName(selected.name)} is added`)
                  : selected.type === "Country"
                    ? t(`+ Agregar todo ${countryName?.[1] ?? shortName(selected.name)}`, `+ Add all of ${countryName?.[2] ?? shortName(selected.name)}`)
                    : t(`+ Agregar ${shortName(selected.name)} (${zoneTypeLabel(selected.type, "es").toLowerCase()})`, `+ Add ${shortName(selected.name)} (${zoneTypeLabel(selected.type, "en").toLowerCase()})`)
                : loading
                  ? t("Cargando zonas…", "Loading areas…")
                  : t("+ Agregar", "+ Add")}
            </button>
          </div>
          <details className={styles.searchBox}>
            <summary className="small">{t("¿No la encuentras? Búscala por nombre ›", "Can't find it? Search by name ›")}</summary>
            <div className="row" style={{ alignItems: "stretch", marginTop: 8 }}>
              <input
                className="field"
                style={{ flex: 1, minWidth: 0 }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    search();
                  }
                }}
                placeholder={t("Ciudad, condado, barrio o código postal", "City, county, neighborhood or ZIP code")}
                aria-label={t("Buscar zona", "Search area")}
              />
              <button type="button" className="btn" onClick={search} disabled={searching || query.trim().length < 2}>
                {searching ? t("Buscando…", "Searching…") : t("Buscar", "Search")}
              </button>
            </div>
            {found && (
              <div className={styles.results}>
                {found.length === 0 && <span className="small muted">{t("No encontramos esa zona en este país.", "We couldn't find that area in this country.")}</span>}
                {found
                  .filter((l) => !zones.some((z) => z.code === l.code))
                  .map((l) => (
                    <button key={l.code} type="button" className="opt" onClick={() => add(l)}>
                      + {placeLabel(l.name)} <span className="small muted">· {zoneTypeLabel(l.type, lang)}</span>
                    </button>
                  ))}
              </div>
            )}
          </details>
        </div>
      )}
      {error && (
        <p className="note error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
