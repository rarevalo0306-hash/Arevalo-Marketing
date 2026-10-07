"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { acceptSeoSetup, measureSeoKeywords, proposeSeoSetup } from "@/app/actions-seo-setup";
import { useT } from "@/components/I18n";
import { MAX_ZONES, type Zone } from "@/lib/seo/dataforseo";
import {
  checkCost,
  frequencyLabel,
  monthlyRankCost,
  normKeyword,
  type ProposedKeyword,
  type ProposedZone,
  RANK_FREQUENCIES,
  type RankFrequency,
  type SetupProposal,
  sourceLabel,
  usd,
  zoneCountry,
  placeLabel,
  zoneTypeLabel,
} from "@/lib/seo/setup-shared";
import styles from "./SeoSetup.module.css";
import { ZonePicker } from "./ZonePicker";

type Choice = "maybe" | "ok" | "no";

type Props = {
  businessId: string;
  /** true si al negocio le faltan zonas o palabras clave. */
  needed: boolean;
  /** La propuesta ya guardada (si hay), para no esperar. */
  saved: SetupProposal | null;
  /** Precio de revisar una palabra en una zona (USD) y de medir las búsquedas (una llamada). */
  price: number;
  measurePrice: number;
  hasWebsite: boolean;
};

/** Botones ✓ / ✗ de cada propuesta. */
function Decide({ choice, onChoice, label }: { choice: Choice; onChoice: (c: Choice) => void; label: string }) {
  const { t } = useT();
  if (choice !== "maybe")
    return (
      <span className={styles.btns}>
        <span className={choice === "ok" ? styles.okMark : styles.noMark}>{choice === "ok" ? t("✓ Aceptada", "✓ Accepted") : t("Quitada", "Removed")}</span>
        <button type="button" className={styles.undo} onClick={() => onChoice("maybe")} aria-label={t(`Deshacer: ${label}`, `Undo: ${label}`)}>
          ↺ {t("Deshacer", "Undo")}
        </button>
      </span>
    );
  return (
    <span className={styles.btns}>
      <button type="button" className={styles.yes} onClick={() => onChoice("ok")} aria-label={t(`Aceptar ${label}`, `Accept ${label}`)}>
        ✓ {t("Aceptar", "Accept")}
      </button>
      <button type="button" className={styles.no} onClick={() => onChoice("no")} aria-label={t(`Quitar ${label}`, `Remove ${label}`)}>
        ✗ {t("Quitar", "Remove")}
      </button>
    </span>
  );
}

/**
 * Puesta en marcha automática (pestaña Resumen): el sistema propone zonas, idioma y palabras clave a partir de lo que
 * ya sabe del negocio, y el dueño acepta o quita cada una. "Aceptar todo y empezar" guarda y hace la primera revisión.
 */
export function SeoSetup({ businessId, needed, saved, price, measurePrice, hasWebsite }: Props) {
  const { lang, t } = useT();
  const [proposal, setProposal] = useState<SetupProposal | null>(saved);
  const [error, setError] = useState("");
  const [loading, startLoading] = useTransition();
  const [zoneChoice, setZoneChoice] = useState<Record<number, Choice>>({});
  const [extraZones, setExtraZones] = useState<Zone[]>([]);
  const [kwChoice, setKwChoice] = useState<Record<string, Choice>>({});
  const [extraKw, setExtraKw] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [language, setLanguage] = useState<"es" | "en">(saved?.language ?? "es");
  const [frequency, setFrequency] = useState<RankFrequency>(7);
  const [volumes, setVolumes] = useState<Record<string, number | null>>({});
  const [measureMsg, setMeasureMsg] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [measuring, startMeasuring] = useTransition();
  const [result, run, saving] = useActionState(acceptSeoSetup.bind(null, businessId), null);

  const load = (force: boolean) =>
    startLoading(async () => {
      setError("");
      const r = await proposeSeoSetup(businessId, force);
      if (!r.ok) return setError(r.error);
      setProposal(r.proposal);
      setLanguage(r.proposal.language);
      setZoneChoice({});
      setKwChoice({});
    });

  // Si hace falta y no hay propuesta guardada, se prepara sola al abrir la página.
  useEffect(() => {
    if (needed && !saved) load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zones: Zone[] = useMemo(
    () => [...(proposal?.zones ?? []).filter((z) => zoneChoice[z.code] !== "no").map(({ code, name, type }) => ({ code, name, ...(type ? { type } : {}) })), ...extraZones].slice(0, MAX_ZONES),
    [proposal, zoneChoice, extraZones],
  );
  const keywords = useMemo(
    () => [...new Set([...(proposal?.keywords ?? []).filter((k) => kwChoice[k.keyword] !== "no").map((k) => k.keyword), ...extraKw])].slice(0, 25),
    [proposal, kwChoice, extraKw],
  );
  const rejected = (proposal?.keywords ?? []).filter((k) => kwChoice[k.keyword] === "no").map((k) => k.keyword);

  // Ya terminó (o ya no hace falta) y no hay nada que mostrar.
  if (!needed && !result) return null;

  if (result?.ok || (result && !needed)) {
    return (
      <section className={`card stack ${styles.card}`} style={{ gap: 12 }} aria-live="polite">
        <h2>{result.ok ? t("¡Listo! Tu SEO ya está en marcha", "Done! Your SEO is up and running") : t("Guardamos tus ajustes", "We saved your settings")}</h2>
        <p className={result.ok ? "note ok" : "note error"} role="status">
          {result.message}
        </p>
        <div className="row" style={{ gap: 10 }}>
          <Link className="btn primary" href={`/b/${businessId}/seo?tab=google#posiciones`}>
            {t("Ver mis posiciones →", "See my rankings →")}
          </Link>
          <Link className="btn" href={`/b/${businessId}/seo?tab=ajustes#dataforseo`}>
            {t("Cambiar en Ajustes", "Change in Settings")}
          </Link>
        </div>
      </section>
    );
  }

  const measure = () =>
    startMeasuring(async () => {
      setMeasureMsg("");
      if (!zones[0]) return setMeasureMsg(t("Acepta primero al menos una zona.", "Accept at least one area first."));
      const r = await measureSeoKeywords(businessId, keywords, { code: zones[0].code, name: zones[0].name }, language);
      if (!r.ok) return setMeasureMsg(r.error);
      setVolumes(r.volumes);
      setMeasureMsg(t(`Listo: Google nos dijo cuánta gente busca cada una en ${placeLabel(zones[0].name)}. Costó ${usd(r.cost, "es")}.`, `Done: Google told us how many people search each one in ${placeLabel(zones[0].name)}. It cost ${usd(r.cost, "en")}.`));
    });

  const addDraft = () => {
    const list = draft.split(/[\n,;]/).map(normKeyword).filter(Boolean);
    setExtraKw((x) => [...new Set([...x, ...list.filter((k) => !keywords.includes(k))])]);
    setDraft("");
  };

  const nf = new Intl.NumberFormat(lang === "en" ? "en-US" : "es");
  const volumeOf = (k: ProposedKeyword) => (normKeyword(k.keyword) in volumes ? volumes[normKeyword(k.keyword)] : k.volume);
  const firstCheck = checkCost(keywords.length, zones.length, price);
  const pick = (x: { es: string; en: string }) => (lang === "en" ? x.en : x.es);
  const okCount = (proposal?.keywords ?? []).filter((k) => kwChoice[k.keyword] !== "no").length + extraKw.length;

  if (!proposal) {
    return (
      <section className={`card stack ${styles.card}`} style={{ gap: 10 }} aria-busy={loading}>
        <h2>{t("Estamos preparando tu SEO", "We're preparing your SEO")}</h2>
        {error ? (
          <>
            <p className="note error" role="alert">
              {error}
            </p>
            <div className="row" style={{ gap: 10 }}>
              <button type="button" className="btn primary" onClick={() => load(false)} disabled={loading}>
                {t("Intentar de nuevo", "Try again")}
              </button>
              <a className="btn" href="#dataforseo">
                {t("Elegir a mano en Ajustes", "Pick by hand in Settings")}
              </a>
            </div>
          </>
        ) : (
          <>
            <p className="small muted">
              {t(
                "Estamos leyendo tu perfil, tu página web y tu estudio para proponerte dónde y con qué palabras seguir tu lugar en Google. Tarda unos segundos.",
                "We're reading your profile, your website and your study to propose where and with which keywords to track your Google ranking. It takes a few seconds.",
              )}
            </p>
            <div className={styles.skeleton} aria-hidden>
              <span />
              <span />
              <span />
            </div>
          </>
        )}
      </section>
    );
  }

  return (
    <form action={run} className={`card stack ${styles.card}`} style={{ gap: 18 }}>
      <input type="hidden" name="zones" value={JSON.stringify(zones)} />
      <input type="hidden" name="keywords" value={keywords.join("\n")} />
      <input type="hidden" name="rejected" value={JSON.stringify(rejected)} />
      <input type="hidden" name="language" value={language} />
      <input type="hidden" name="rankDays" value={String(frequency)} />

      <div className="stack" style={{ gap: 6 }}>
        <span className={styles.kicker}>{t("Paso único · 2 minutos", "One step · 2 minutes")}</span>
        <h2>{t("Ya preparamos tu SEO: revisa y acepta", "We've prepared your SEO: review and accept")}</h2>
        <p className="small muted">
          {proposal.ai
            ? t(
                "Leímos lo que sabemos de tu negocio y te proponemos dónde buscar, en qué idioma y qué palabras seguir en Google. Acepta lo que esté bien y quita lo que no: tú tienes la última palabra.",
                "We read what we know about your business and propose where to look, in what language and which keywords to track on Google. Accept what's right and remove what isn't: you have the final say.",
              )
            : t(
                "Esto sale de tu estudio y de los datos que ya tenemos. Acepta lo que esté bien y quita lo que no.",
                "This comes from your study and the data we already have. Accept what's right and remove what isn't.",
              )}
        </p>
        {proposal.aiError && <p className="note">{t("La IA no pudo ayudar esta vez: ", "The AI couldn't help this time: ")}{pick(proposal.aiError)}</p>}
      </div>

      {/* Zonas */}
      <div className="stack" style={{ gap: 10 }}>
        <h3 className={styles.h3}>📍 {t("Dónde están tus clientes", "Where your customers are")}</h3>
        {proposal.zones.length === 0 && extraZones.length === 0 && (
          <p className="small muted">{t("No pudimos adivinar tu zona. Agrégala abajo.", "We couldn't guess your area. Add it below.")}</p>
        )}
        <ul className={styles.list}>
          {proposal.zones.map((z: ProposedZone) => {
            const c = zoneChoice[z.code] ?? "maybe";
            return (
              <li key={z.code} className={`${styles.item} ${c === "ok" ? styles.itemOk : ""} ${c === "no" ? styles.itemNo : ""}`}>
                <span className={styles.itemText}>
                  <strong>{placeLabel(z.name)}</strong>
                  <span className="small muted">
                    {zoneTypeLabel(z.type, lang)} · {pick(z.why)}
                  </span>
                </span>
                <Decide choice={c} label={placeLabel(z.name)} onChoice={(v) => setZoneChoice((s) => ({ ...s, [z.code]: v }))} />
              </li>
            );
          })}
          {extraZones.map((z) => (
            <li key={z.code} className={`${styles.item} ${styles.itemOk}`}>
              <span className={styles.itemText}>
                <strong>{placeLabel(z.name)}</strong>
                <span className="small muted">{zoneTypeLabel(z.type, lang)} · {t("La agregaste tú", "You added it")}</span>
              </span>
              <button type="button" className={styles.undo} onClick={() => setExtraZones((x) => x.filter((y) => y.code !== z.code))}>
                × {t("Quitar", "Remove")}
              </button>
            </li>
          ))}
        </ul>
        {proposal.missingPlaces.length > 0 && (
          <p className="small muted">
            {t("Google no tiene como zona: ", "Google doesn't have these as an area: ")}
            {proposal.missingPlaces.join(", ")}
          </p>
        )}
        {zones.length < MAX_ZONES && (
          <details className={styles.more} onToggle={(e) => setPickerOpen(e.currentTarget.open)}>
            <summary>{t("+ Agregar otra zona", "+ Add another area")}</summary>
            {pickerOpen && (
              <div style={{ marginTop: 10 }}>
                <ZonePicker
                  zones={extraZones}
                  onChange={(z) => setExtraZones(z.filter((x) => !proposal.zones.some((p) => p.code === x.code)).slice(0, MAX_ZONES - (zones.length - extraZones.length)))}
                  defaultCountry={zoneCountry(proposal.zones[0]?.name ?? "") ?? undefined}
                />
              </div>
            )}
          </details>
        )}
      </div>

      {/* Idioma */}
      <div className="stack" style={{ gap: 10 }}>
        <h3 className={styles.h3}>💬 {t("En qué idioma te buscan en Google", "What language they search in on Google")}</h3>
        <div className={styles.langs} role="radiogroup">
          {(["es", "en"] as const).map((l) => (
            <label key={l} className={`${styles.lang} ${language === l ? styles.langOn : ""}`}>
              <input type="radio" name="lang-pick" checked={language === l} onChange={() => setLanguage(l)} />
              <strong>{l === "es" ? t("Español", "Spanish") : t("Inglés", "English")}</strong>
              {proposal.language === l && <span className="small muted">{t("Te lo proponemos: ", "Our suggestion: ")}{pick(proposal.languageWhy)}</span>}
            </label>
          ))}
        </div>
        <p className="small muted">
          {t(
            "Si te buscan en los dos idiomas, deja el que más usan: las palabras de abajo pueden estar en español y en inglés.",
            "If they search in both languages, keep the one they use most: the keywords below can be in Spanish and English.",
          )}
        </p>
      </div>

      {/* Palabras clave */}
      <div className="stack" style={{ gap: 10 }}>
        <div className="row between" style={{ gap: 8 }}>
          <h3 className={styles.h3}>🔎 {t("Qué buscan tus clientes", "What your customers search for")}</h3>
          <span className="small muted">{t(`${okCount} de 25 posibles`, `${okCount} of 25 allowed`)}</span>
        </div>
        <ul className={styles.list}>
          {proposal.keywords.map((k) => {
            const c = kwChoice[k.keyword] ?? "maybe";
            const v = volumeOf(k);
            return (
              <li key={k.keyword} className={`${styles.item} ${c === "ok" ? styles.itemOk : ""} ${c === "no" ? styles.itemNo : ""}`}>
                <span className={styles.itemText}>
                  <strong>{k.keyword}</strong>
                  <span className="small muted">
                    <span className={styles.src}>{sourceLabel(k.source, t)}</span>
                    {v !== undefined && <> · {v === null ? t("pocas búsquedas", "few searches") : t(`${nf.format(v)} búsquedas/mes`, `${nf.format(v)} searches/mo`)}</>}
                    {k.source === "profile" && <> · {pick(k.why)}</>}
                  </span>
                </span>
                <Decide choice={c} label={k.keyword} onChoice={(x) => setKwChoice((s) => ({ ...s, [k.keyword]: x }))} />
              </li>
            );
          })}
          {extraKw.map((k) => (
            <li key={k} className={`${styles.item} ${styles.itemOk}`}>
              <span className={styles.itemText}>
                <strong>{k}</strong>
                <span className="small muted">{t("La agregaste tú", "You added it")}</span>
              </span>
              <button type="button" className={styles.undo} onClick={() => setExtraKw((x) => x.filter((y) => y !== k))}>
                × {t("Quitar", "Remove")}
              </button>
            </li>
          ))}
        </ul>
        <div className={styles.addRow}>
          <input
            className="field"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addDraft();
              }
            }}
            placeholder={t("¿Falta alguna? Escríbela como la busca la gente", "Missing one? Type it the way people search")}
            aria-label={t("Agregar palabra clave", "Add keyword")}
          />
          <button type="button" className="btn" onClick={addDraft} disabled={!draft.trim()}>
            {t("+ Agregar", "+ Add")}
          </button>
        </div>
        <div className={styles.measure}>
          <button type="button" className="btn" onClick={measure} disabled={measuring || !keywords.length || !zones.length}>
            {measuring ? t("Preguntando a Google…", "Asking Google…") : t(`📊 Ver cuánta gente busca cada una · ${usd(measurePrice, "es")}`, `📊 See how many people search each one · ${usd(measurePrice, "en")}`)}
          </button>
          <span className="small muted">
            {measureMsg ||
              t("Opcional. Usa un poco de saldo de DataForSEO; te ayuda a quedarte con las que más se buscan.", "Optional. Uses a little DataForSEO balance; it helps you keep the most searched ones.")}
          </span>
        </div>
        <button type="button" className={styles.again} onClick={() => load(true)} disabled={loading}>
          {loading ? t("Preparando otra propuesta…", "Preparing a new proposal…") : t("↻ Preparar otra propuesta", "↻ Prepare a new proposal")}
        </button>
      </div>

      {/* Frecuencia */}
      <div className="stack" style={{ gap: 10 }}>
        <h3 className={styles.h3}>📅 {t("Cada cuánto revisamos tu lugar en Google", "How often we check your Google ranking")}</h3>
        <div className={styles.freqs} role="radiogroup">
          {RANK_FREQUENCIES.map((f) => (
            <label key={f} className={`${styles.freq} ${frequency === f ? styles.langOn : ""}`}>
              <input type="radio" name="freq-pick" checked={frequency === f} onChange={() => setFrequency(f)} />
              <strong>{frequencyLabel(f, t)}</strong>
              <span className="small muted">{f === 0 ? t("solo a mano", "manual only") : t(`≈ ${usd(monthlyRankCost(f, keywords.length, zones.length, price), "es")}/mes`, `≈ ${usd(monthlyRankCost(f, keywords.length, zones.length, price), "en")}/mo`)}</span>
            </label>
          ))}
        </div>
      </div>

      {result && !result.ok && (
        <p className="note error" role="alert">
          {result.message}
        </p>
      )}
      {saving ? (
        <p className="note" role="status">
          {t("Guardando y revisando tus posiciones en Google… puede tardar un minuto. No cierres la página.", "Saving and checking your Google rankings… it may take a minute. Don't close the page.")}
        </p>
      ) : (
        <div className={styles.actions}>
          <button type="submit" name="check" value="on" className="btn primary" disabled={!zones.length || !keywords.length}>
            ✓ {t("Aceptar todo y empezar", "Accept all and start")}
          </button>
          <button type="submit" className="btn" disabled={!zones.length || !keywords.length}>
            {t("Solo guardar", "Just save")}
          </button>
          <span className="small muted">
            {!zones.length || !keywords.length
              ? t("Necesitas al menos una zona y una palabra.", "You need at least one area and one keyword.")
              : hasWebsite
                ? t(
                    `Guarda ${zones.length} ${zones.length === 1 ? "zona" : "zonas"} y ${keywords.length} palabras, y revisa ya tu lugar en Google (≈ ${usd(firstCheck, "es")}).`,
                    `Saves ${zones.length} ${zones.length === 1 ? "area" : "areas"} and ${keywords.length} keywords, and checks your Google ranking now (≈ ${usd(firstCheck, "en")}).`,
                  )
                : t("Falta la dirección de tu página web en Ajustes del negocio para revisar posiciones.", "Your website address is missing in Business settings to check rankings.")}
          </span>
        </div>
      )}
    </form>
  );
}
