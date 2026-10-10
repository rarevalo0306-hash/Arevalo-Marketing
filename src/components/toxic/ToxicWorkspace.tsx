"use client";

import { useMemo, useState, useTransition } from "react";
import { makeDisavowFile, type DisavowResult } from "@/app/actions-toxic";
import { useT } from "@/components/I18n";
import type { ToxicRow } from "@/lib/toxic-links-data";
import { DISAVOW_HELP_URL, DISAVOW_TOOL_URL, MANUAL_ACTIONS_URL, type Outcome, type RiskLevel } from "@/lib/toxic-links-shape";
import s from "./Toxic.module.css";

type Filter = "all" | RiskLevel | "new" | "import";
type Sort = "risk" | "spam" | "newest" | "name";

type Props = {
  businessId: string;
  rows: ToxicRow[];
  /** Resultado guardado de «¿Necesito desautorizar?» (null = no respondió: se trata como «No hagas nada»). */
  outcome: Outcome | null;
  /** Tu dominio (para el nombre del archivo y los textos). */
  site: string;
};

const PAGE = 40;
const LEVEL_CLASS: Record<RiskLevel, string> = { alto: s.lvlAlto, medio: s.lvlMedio, bajo: s.lvlBajo, seguro: s.lvlSeguro };
const ITEM_CLASS: Partial<Record<RiskLevel, string>> = { alto: s.itemAlto, medio: s.itemMedio };
const ORDER: Record<RiskLevel, number> = { alto: 0, medio: 1, bajo: 2, seguro: 3 };

function download(text: string, fileName: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** La lista de sitios (filtros, orden, razones y casillas) y el archivo de desautorización para Google. */
export function ToxicWorkspace({ businessId, rows, outcome, site }: Props) {
  const { t, lang } = useT();
  const levelName: Record<RiskLevel, string> = {
    alto: t("Riesgo alto", "High risk"),
    medio: t("Riesgo medio", "Medium risk"),
    bajo: t("Riesgo bajo", "Low risk"),
    seguro: t("Seguro", "Safe"),
  };
  const [filter, setFilter] = useState<Filter>(() => (rows.some((r) => r.level === "alto") ? "alto" : "all"));
  const [sort, setSort] = useState<Sort>("risk");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(rows.filter((r) => r.level === "alto" && !r.safe).map((r) => r.domain)));
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState(() =>
    outcome === "prepare"
      ? t("Enlaces no naturales que no pedimos (revisados uno por uno)", "Unnatural links we didn't ask for (reviewed one by one)")
      : t("Enlaces de spam que no pedimos", "Spam links we didn't ask for"),
  );
  const [file, setFile] = useState<DisavowResult | null>(null);
  const [pending, start] = useTransition();
  const fmtDate = (iso: string) => new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es", { dateStyle: "medium" }).format(new Date(iso));

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, alto: 0, medio: 0, bajo: 0, seguro: 0, new: 0, import: 0 };
    for (const r of rows) {
      c[r.level]++;
      if (r.isNew) c.new++;
      if (r.fromImport) c.import++;
    }
    return c;
  }, [rows]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (filter === "new" ? !r.isNew : filter === "import" ? !r.fromImport : filter !== "all" && r.level !== filter) return false;
      return !q || r.domain.includes(q) || r.anchors.some((a) => a.toLowerCase().includes(q));
    });
    const by: Record<Sort, (a: ToxicRow, b: ToxicRow) => number> = {
      risk: (a, b) => ORDER[a.level] - ORDER[b.level] || b.points - a.points || (b.spamScore ?? -1) - (a.spamScore ?? -1),
      spam: (a, b) => (b.spamScore ?? -1) - (a.spamScore ?? -1) || (b.toolScore ?? -1) - (a.toolScore ?? -1),
      newest: (a, b) => (b.firstSeen ?? "").localeCompare(a.firstSeen ?? "") || Number(b.isNew) - Number(a.isNew),
      name: (a, b) => a.domain.localeCompare(b.domain),
    };
    return out.sort((a, b) => by[sort](a, b) || a.domain.localeCompare(b.domain));
  }, [rows, filter, sort, query]);

  const toggle = (d: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  const selectLevel = (lvl: RiskLevel) => setSelected(new Set(rows.filter((r) => r.level === lvl && !r.safe).map((r) => r.domain)));
  const selectShown = () => setSelected((cur) => new Set([...cur, ...list.filter((r) => !r.safe).map((r) => r.domain)]));

  const allowed = outcome === "prepare" || confirmed;
  const make = (domains: string[]) =>
    start(async () => {
      const r = await makeDisavowFile(businessId, { domains, reason, outcome });
      setFile(r);
      if (r.ok && r.text && r.fileName) download(r.text, r.fileName);
    });

  const filters: [Filter, string][] = [
    ["alto", levelName.alto],
    ["medio", levelName.medio],
    ["bajo", levelName.bajo],
    ["seguro", levelName.seguro],
    ["new", t("Nuevos", "New")],
    ["all", t("Todos", "All")],
  ];
  if (counts.import) filters.push(["import", t("De tu lista", "From your list")]);

  return (
    <>
      <section className="card" id="lista">
        <div className="row between">
          <h2>{t("Los sitios que te enlazan", "The sites linking to you")}</h2>
          <span className="small muted">{t(`${rows.length} sitios`, `${rows.length} sites`)}</span>
        </div>
        <p className="small muted" style={{ marginTop: -6 }}>
          {t(
            "Cada sitio tiene un nivel de riesgo y el porqué en palabras simples. Marcamos solo los de riesgo alto para el archivo; nunca tu propio sitio, directorios, redes sociales, noticias, gobierno ni universidades.",
            "Each site has a risk level and the reason in plain words. Only high-risk ones are ticked for the file; never your own site, directories, social networks, news, government or universities.",
          )}
        </p>

        <div className={s.toolbar}>
          <div className={s.filters} role="group" aria-label={t("Filtrar por riesgo", "Filter by risk")}>
            {filters.map(([f, label]) => (
              <button
                key={f}
                type="button"
                className={`${s.filter} ${filter === f ? s.filterOn : ""}`}
                aria-pressed={filter === f}
                onClick={() => {
                  setFilter(f);
                  setShown(PAGE);
                }}
              >
                {label} · {counts[f]}
              </button>
            ))}
          </div>
          <div className={s.searchRow}>
            <input
              className="field"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(PAGE);
              }}
              placeholder={t("Buscar", "Search")}
              aria-label={t("Buscar sitio o texto", "Search site or text")}
            />
            <select className="field" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t("Ordenar", "Sort")}>
              <option value="risk">{t("Más riesgo", "Riskiest")}</option>
              <option value="spam">{t("Más spam", "Most spam")}</option>
              <option value="newest">{t("Más nuevos", "Newest")}</option>
              <option value="name">{t("Nombre (A-Z)", "Name (A-Z)")}</option>
            </select>
          </div>
        </div>

        <div className={s.selBar}>
          <span>
            <strong>{selected.size}</strong> {t(selected.size === 1 ? "marcado para el archivo" : "marcados para el archivo", selected.size === 1 ? "ticked for the file" : "ticked for the file")}
          </span>
          <span className={s.selLinks}>
            <button type="button" className="btn link" onClick={() => selectLevel("alto")}>
              {t("Solo los de riesgo alto", "Only high risk")}
            </button>
            <button type="button" className="btn link" onClick={selectShown}>
              {t("Marcar los de esta vista", "Tick this view")}
            </button>
            <button type="button" className="btn link" onClick={() => setSelected(new Set())}>
              {t("Quitar todos", "Untick all")}
            </button>
          </span>
        </div>

        {list.length === 0 ? (
          <p className={s.empty}>{rows.length ? t("Ningún sitio con este filtro.", "No sites with this filter.") : t("Todavía no hay sitios para revisar.", "No sites to review yet.")}</p>
        ) : (
          <ul className={s.list}>
            {list.slice(0, shown).map((r) => {
              const on = selected.has(r.domain);
              const bad = r.reasons.filter((x) => x.tone !== "good");
              const first = (bad.length ? bad : r.reasons).slice(0, 2);
              const rest = r.reasons.filter((x) => !first.includes(x));
              return (
                <li key={r.domain} className={`${s.item} ${ITEM_CLASS[r.level] ?? ""} ${on ? s.itemSel : ""}`}>
                  <input
                    type="checkbox"
                    className={s.itemCheck}
                    checked={on}
                    disabled={r.safe}
                    onChange={() => toggle(r.domain)}
                    aria-label={r.safe ? t(`${r.domain}: es seguro, no se puede desautorizar`, `${r.domain}: safe, can't be disavowed`) : t(`Poner ${r.domain} en el archivo`, `Put ${r.domain} in the file`)}
                  />
                  <div className={s.itemBody}>
                    <div className={s.itemHead}>
                      <span className={s.domain}>{r.domain}</span>
                      <span className={`pill plain ${LEVEL_CLASS[r.level]}`}>{levelName[r.level]}</span>
                      {r.isNew && <span className={`pill plain ${s.newTag}`}>{t("Nuevo", "New")}</span>}
                      {r.fromImport && <span className="pill plain neutral">{t("De tu lista", "From your list")}</span>}
                    </div>
                    <div className={s.meta}>
                      {r.spamScore !== null && (
                        <span>
                          {t("Spam", "Spam")} <b>{r.spamScore}/100</b>
                        </span>
                      )}
                      {r.toolScore !== null && (
                        <span>
                          {t("Tóxico (tu herramienta)", "Toxic (your tool)")} <b>{r.toolScore}/100</b>
                        </span>
                      )}
                      {r.rank !== null && (
                        <span>
                          {t("Fuerza", "Strength")} <b>{r.rank}/1000</b>
                        </span>
                      )}
                      {r.backlinks !== null && (
                        <span>
                          <b>{r.backlinks}</b> {t(r.backlinks === 1 ? "enlace" : "enlaces", r.backlinks === 1 ? "link" : "links")}
                        </span>
                      )}
                      {r.firstSeen && <span>{t(`Desde ${fmtDate(r.firstSeen)}`, `Since ${fmtDate(r.firstSeen)}`)}</span>}
                      {r.dofollow === false && <span>nofollow</span>}
                    </div>
                    <ul className={s.reasons}>
                      {first.map((x, i) => (
                        <li key={i} className={x.tone === "bad" ? s.rBad : x.tone === "good" ? s.rGood : s.rInfo}>
                          {x.text}
                        </li>
                      ))}
                    </ul>
                    {(rest.length > 0 || r.anchors.length > 0 || r.url) && (
                      <details className={s.more}>
                        <summary>{t("Más detalles", "More details")}</summary>
                        <div className="stack" style={{ gap: 6 }}>
                          {rest.length > 0 && (
                            <ul className={s.reasons}>
                              {rest.map((x, i) => (
                                <li key={i} className={x.tone === "bad" ? s.rBad : x.tone === "good" ? s.rGood : s.rInfo}>
                                  {x.text}
                                </li>
                              ))}
                            </ul>
                          )}
                          {r.anchors.length > 0 && (
                            <span className={s.anchor}>
                              {t("Texto del enlace: ", "Link text: ")}
                              {r.anchors.map((a) => `«${a}»`).join(", ")}
                            </span>
                          )}
                          {/* Sin enlace a propósito: abrir sitios de spam (adultos, malware) no es seguro. */}
                          {r.url && (
                            <span className={s.anchor}>
                              {t("Página: ", "Page: ")}
                              {r.url}
                            </span>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {list.length > shown && (
          <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE)}>
            {t(`Mostrar más (${list.length - shown} restantes)`, `Show more (${list.length - shown} left)`)}
          </button>
        )}
      </section>

      <section className="card" id="archivo">
        <div>
          <h2>{t("Archivo de desautorización para Google", "Disavow file for Google")}</h2>
          <p className="small muted">
            {t(
              "La app arma el archivo con los sitios que marcaste, en el formato que pide Google. Nunca lo sube sola: lo subes tú, solo si de verdad hace falta.",
              "The app builds the file with the sites you ticked, in Google's format. It never uploads it on its own: you do, only if it's really needed.",
            )}
          </p>
        </div>

        {outcome !== "prepare" ? (
          <div className="note" role="note">
            <strong>{outcome === "watch" ? t("Nuestra recomendación ahora es vigilar, no subir nada.", "Our recommendation now is to watch, not upload anything.") : t("Nuestra recomendación es no subir nada.", "Our recommendation is not to upload anything.")}</strong>{" "}
            {t(
              "Sin una acción manual en Search Console o un ataque claro, desautorizar suele no servir y puede bajarte en Google si quitas enlaces buenos.",
              "Without a manual action in Search Console or a clear attack, disavowing usually does nothing and can push you down if you remove good links.",
            )}
            <label className="check" style={{ marginTop: 10, background: "var(--surface)", color: "var(--ink)" }}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span className="small">
                {t(
                  "Entiendo el riesgo y quiero preparar el archivo igual (por ejemplo, porque me lo pidió alguien que sabe de SEO).",
                  "I understand the risk and want to prepare the file anyway (for example, because someone who knows SEO asked me to).",
                )}
              </span>
            </label>
          </div>
        ) : (
          <p className="note error" role="note">
            {t(
              "Pon solo los sitios claramente dañinos que revisaste uno por uno. Si un sitio te trae clientes o es de alguien que conoces, quítalo de la lista.",
              "Include only the clearly harmful sites you reviewed one by one. If a site brings you customers or belongs to someone you know, untick it.",
            )}
          </p>
        )}

        <div className={s.fileBox}>
          <label className="stack" style={{ gap: 4 }}>
            <span className="small" style={{ fontWeight: 700 }}>
              {t("Motivo (queda como comentario en el archivo)", "Reason (kept as a comment in the file)")}
            </span>
            <input className="field" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className={s.actions} style={{ display: pending ? "none" : undefined }}>
            <button type="button" className={`btn solid ${s.wrapBtn}`} disabled={!allowed || selected.size === 0} onClick={() => make([...selected])}>
              {t(`Descargar archivo (${selected.size} ${selected.size === 1 ? "dominio" : "dominios"})`, `Download file (${selected.size} ${selected.size === 1 ? "domain" : "domains"})`)}
            </button>
            <button type="button" className={`btn ${s.wrapBtn}`} onClick={() => make([])}>
              {t("Descargar archivo vacío (deshacer)", "Download empty file (undo)")}
            </button>
          </div>
          {pending && <p className="small muted">{t("Armando el archivo…", "Building the file…")}</p>}
          {!allowed && selected.size > 0 && <p className="small muted">{t("Para descargarlo, marca la casilla de arriba.", "To download it, tick the box above.")}</p>}
          {file && !pending && (
            <>
              <p className={file.ok ? "note ok" : "note error"} role="status">
                {file.message}
                {file.excluded && file.excluded.length > 0
                  ? t(` Quitamos ${file.excluded.length} que son seguros: ${file.excluded.slice(0, 5).join(", ")}.`, ` We removed ${file.excluded.length} safe ones: ${file.excluded.slice(0, 5).join(", ")}.`)
                  : ""}
              </p>
              {file.text && (
                <>
                  <pre className={s.preview} aria-label={t("Contenido del archivo", "File contents")}>
                    {file.text}
                  </pre>
                  {file.fileName && (
                    <button type="button" className="btn link" onClick={() => download(file.text!, file.fileName!)}>
                      {t("¿No se descargó? Descargar otra vez", "Didn't download? Download again")}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <details className={s.more} open={outcome === "prepare"}>
          <summary>{t("Cómo subirlo a Google, paso a paso", "How to upload it to Google, step by step")}</summary>
          <ol className={s.steps}>
            <li>
              {t("Abre la ", "Open Google's ")}
              <a href={DISAVOW_TOOL_URL} target="_blank" rel="noopener noreferrer">
                {t("herramienta para desautorizar enlaces de Google", "Disavow Links tool")}
              </a>
              {t(` y elige la propiedad de tu página (${site || "tu dominio"}).`, ` and pick your website's property (${site || "your domain"}).`)}
            </li>
            <li>{t("Toca «Subir lista de desautorización» y elige el archivo .txt que descargaste.", "Tap “Upload disavow list” and choose the .txt file you downloaded.")}</li>
            <li>
              <strong>{t("Esto reemplaza el archivo anterior.", "This replaces the previous file.")}</strong>{" "}
              {t(
                "Si ya habías subido uno, Google lo muestra ahí: descárgalo, impórtalo abajo en «Importar tu lista» y vuelve a armar el archivo para no perder esos sitios.",
                "If you had uploaded one before, Google shows it there: download it, import it below in “Import your list” and rebuild the file so you don't lose those sites.",
              )}
            </li>
            <li>{t("Google tarda semanas en tenerlo en cuenta (cuando vuelve a pasar por esos sitios). No hace falta subirlo más de una vez.", "Google takes weeks to apply it (as it recrawls those sites). No need to upload it more than once.")}</li>
            <li>
              {t("Si fue por una acción manual, después pide una revisión en ", "If it was for a manual action, then request a review in ")}
              <a href={MANUAL_ACTIONS_URL} target="_blank" rel="noopener noreferrer">
                {t("«Acciones manuales»", "“Manual actions”")}
              </a>
              {t(", contando qué limpiaste.", ", explaining what you cleaned up.")}
            </li>
            <li>
              <strong>{t("Puedes deshacerlo subiendo uno vacío", "You can undo it by uploading an empty one")}</strong>
              {t(" (el botón «Descargar archivo vacío») o con «Cancelar desautorización» en la misma herramienta.", " (the “Download empty file” button) or with “Cancel disavowal” in the same tool.")}
            </li>
          </ol>
          <p className="small muted" style={{ marginTop: 8 }}>
            <a href={DISAVOW_HELP_URL} target="_blank" rel="noopener noreferrer">
              {t("Ayuda oficial de Google sobre desautorizar enlaces", "Google's official help on disavowing links")}
            </a>
          </p>
        </details>
      </section>
    </>
  );
}
