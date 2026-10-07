"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import type { SeoSettingsResult } from "@/app/actions-seo-dfs";
import { proposeSeoSetup } from "@/app/actions-seo-setup";
import { useT } from "@/components/I18n";
import { MAX_ZONES, type Zone } from "@/lib/seo/dataforseo";
import {
  checkCost,
  frequencyLabel,
  keywordExample,
  monthlyRankCost,
  normKeyword,
  type ProposedKeyword,
  RANK_FREQUENCIES,
  type RankFrequency,
  sourceLabel,
  usd,
} from "@/lib/seo/setup-shared";
import styles from "./DfsSettings.module.css";
import { ZonePicker } from "./ZonePicker";

export type KwInfo = { position?: number | null; volume?: number | null };

const MAX_KEYWORDS = 25;

type Props = {
  businessId: string;
  action: (prev: SeoSettingsResult, f: FormData) => Promise<SeoSettingsResult>;
  initial: { zones: Zone[]; language: "es" | "en"; keywords: string[]; frequency: RankFrequency };
  /** Posición y búsquedas al mes ya conocidas de cada palabra (zona principal), en minúsculas. */
  info: Record<string, KwInfo>;
  suggestions: ProposedKeyword[];
  /** Precio de revisar una palabra en una zona (USD), de rank.ts. */
  price: number;
  /** Ejemplos de búsqueda del propio negocio en cada idioma (o genéricos). */
  examples: { es: string; en: string };
  defaultCountry?: string;
  /** true si las palabras que se ven vienen del estudio y todavía no se han guardado. */
  fromStudy: boolean;
};

export function DfsSettingsForm({ businessId, action, initial, info, suggestions: initialSuggestions, price, examples, defaultCountry, fromStudy }: Props) {
  const { lang, t } = useT();
  const [result, run, saving] = useActionState(action, null);
  const [zones, setZones] = useState<Zone[]>(initial.zones);
  const [language, setLanguage] = useState(initial.language);
  const [keywords, setKeywords] = useState<string[]>(initial.keywords);
  const [frequency, setFrequency] = useState<RankFrequency>(initial.frequency);
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [rejected, setRejected] = useState<string[]>([]);
  const [aiError, setAiError] = useState("");
  const [asking, startAsking] = useTransition();

  const dirty = useMemo(
    () =>
      fromStudy ||
      JSON.stringify(zones.map((z) => z.code)) !== JSON.stringify(initial.zones.map((z) => z.code)) ||
      language !== initial.language ||
      frequency !== initial.frequency ||
      keywords.join("\n") !== initial.keywords.join("\n") ||
      rejected.length > 0,
    [fromStudy, zones, language, frequency, keywords, rejected, initial],
  );

  const has = (k: string) => keywords.some((x) => normKeyword(x) === normKeyword(k));
  const addKeyword = (k: string) => {
    const n = normKeyword(k);
    if (!n || has(n) || keywords.length >= MAX_KEYWORDS) return;
    setKeywords((all) => [...all, n]);
    setSuggestions((s) => s.filter((x) => normKeyword(x.keyword) !== n));
  };
  const addDraft = () => {
    // Se pueden pegar varias separadas por coma o en varias líneas.
    for (const part of draft.split(/[\n,;]/)) addKeyword(part);
    setDraft("");
  };
  const reject = (k: string) => {
    setRejected((r) => [...r, normKeyword(k)]);
    setSuggestions((s) => s.filter((x) => normKeyword(x.keyword) !== normKeyword(k)));
  };
  const askAi = () =>
    startAsking(async () => {
      setAiError("");
      const r = await proposeSeoSetup(businessId, true);
      if (!r.ok) return setAiError(r.error);
      const skip = new Set([...keywords.map(normKeyword), ...rejected, ...r.rejected]);
      const fresh = r.proposal.keywords.filter((k) => !skip.has(normKeyword(k.keyword)));
      setSuggestions((old) => [...fresh, ...old.filter((o) => !fresh.some((f) => normKeyword(f.keyword) === normKeyword(o.keyword)))].slice(0, 25));
      if (r.proposal.aiError) setAiError(lang === "en" ? r.proposal.aiError.en : r.proposal.aiError.es);
    });

  const nf = new Intl.NumberFormat(lang === "en" ? "en-US" : "es");
  const perCheck = checkCost(keywords.length, zones.length, price);
  const placeholder = keywordExample(keywords, lang);

  return (
    <form action={run} className={styles.steps}>
      <input type="hidden" name="zones" value={JSON.stringify(zones)} />
      <input type="hidden" name="keywords" value={keywords.join("\n")} />
      <input type="hidden" name="rejected" value={JSON.stringify(rejected)} />
      <input type="hidden" name="rankDays" value={String(frequency)} />
      <input type="hidden" name="language" value={language} />

      {/* 1. Zonas */}
      <section className={styles.step} aria-labelledby="dfs-zones">
        <div className={styles.stepHead}>
          <span className={styles.num}>1</span>
          <div>
            <h3 id="dfs-zones">
              {t("¿Dónde están tus clientes?", "Where are your customers?")} <span className="small muted">({zones.length}/{MAX_ZONES})</span>
            </h3>
            <p className="small muted">
              {t(
                "Elige el país, luego el estado o departamento y, si quieres, el condado o la ciudad. Puedes elegir hasta 5 zonas; la primera (★) es la principal. Cada zona se revisa aparte, así que el costo se multiplica por el número de zonas.",
                "Pick the country, then the state or department and, if you like, the county or city. You can pick up to 5 areas; the first one (★) is the main one. Each area is checked separately, so the cost multiplies by the number of areas.",
              )}
            </p>
          </div>
        </div>
        <ZonePicker zones={zones} onChange={setZones} defaultCountry={defaultCountry} />
      </section>

      {/* 2. Idioma */}
      <section className={styles.step} aria-labelledby="dfs-lang">
        <div className={styles.stepHead}>
          <span className={styles.num}>2</span>
          <div>
            <h3 id="dfs-lang">{t("¿En qué idioma escriben tus clientes en Google?", "What language do your customers type in on Google?")}</h3>
            <p className="small muted">
              {t(
                "Así Google nos muestra los mismos resultados que ven ellos. Si buscan en los dos idiomas, elige el que más usan: igual puedes seguir palabras en español y en inglés abajo, escritas como las busca la gente.",
                "This way Google shows us the same results they see. If they search in both languages, pick the one they use most: you can still track keywords in Spanish and English below, written the way people search.",
              )}
            </p>
          </div>
        </div>
        <div className={`${styles.options} ${styles.options2}`} role="radiogroup" aria-labelledby="dfs-lang">
          {(["es", "en"] as const).map((l) => (
            <label key={l} className={`${styles.option} ${language === l ? styles.optionOn : ""}`}>
              <input type="radio" name="language-pick" value={l} checked={language === l} onChange={() => setLanguage(l)} />
              <strong>{l === "es" ? t("Español", "Spanish") : t("Inglés", "English")}</strong>
              <span className="small muted">
                {t("Ej.:", "E.g.:")} «{l === "es" ? examples.es : examples.en}»
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* 3. Palabras clave */}
      <section className={styles.step} aria-labelledby="dfs-kw">
        <div className={styles.stepHead}>
          <span className={styles.num}>3</span>
          <div>
            <h3 id="dfs-kw">
              {t("¿Qué buscan tus clientes?", "What do your customers search for?")} <span className="small muted">({keywords.length}/{MAX_KEYWORDS})</span>
            </h3>
            <p className="small muted">
              {fromStudy
                ? t("Estas salen de tu estudio del negocio y todavía no están guardadas. Quita las que no sirvan y guarda.", "These come from your business study and aren't saved yet. Remove the ones that don't fit and save.")
                : t("Las frases que seguimos en Google para ver en qué lugar sales. Escríbelas como las busca la gente.", "The phrases we track on Google to see where you rank. Write them the way people search.")}
            </p>
          </div>
        </div>
        {keywords.length > 0 ? (
          <ul className={styles.kwList}>
            {keywords.map((k) => {
              const i = info[normKeyword(k)] ?? {};
              return (
                <li key={k} className={styles.kwRow}>
                  <span className={styles.kwName}>{k}</span>
                  <span className={styles.kwStats}>
                    <span className={`${styles.stat} ${i.position ? styles.statGood : ""}`} title={t("Tu lugar en Google (zona principal)", "Your Google position (main area)")}>
                      {i.position === undefined ? t("Sin revisar", "Not checked") : i.position === null ? t("No sales (top 20)", "Not in top 20") : t(`Lugar #${i.position}`, `Position #${i.position}`)}
                    </span>
                    {i.volume !== undefined && (
                      <span className={styles.stat} title={t("Búsquedas al mes en tu zona principal", "Monthly searches in your main area")}>
                        {i.volume === null ? t("Pocas búsquedas", "Few searches") : t(`${nf.format(i.volume)} búsquedas/mes`, `${nf.format(i.volume)} searches/mo`)}
                      </span>
                    )}
                  </span>
                  <button type="button" className={styles.chipBtn} onClick={() => setKeywords((all) => all.filter((x) => x !== k))} aria-label={t(`Quitar ${k}`, `Remove ${k}`)}>
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="small muted">{t("Todavía no sigues ninguna. Agrega abajo o acepta sugerencias.", "You don't track any yet. Add below or accept suggestions.")}</p>
        )}
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
            placeholder={t(`Ej.: ${placeholder}`, `E.g.: ${placeholder}`)}
            aria-label={t("Agregar palabra clave", "Add keyword")}
            disabled={keywords.length >= MAX_KEYWORDS}
          />
          <button type="button" className="btn" onClick={addDraft} disabled={!draft.trim() || keywords.length >= MAX_KEYWORDS}>
            {t("+ Agregar", "+ Add")}
          </button>
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <div className="row between" style={{ gap: 8 }}>
            <span className="lbl">{t("Sugerencias para tu negocio", "Suggestions for your business")}</span>
            <button type="button" className="btn small" onClick={askAi} disabled={asking}>
              {asking ? t("Pensando…", "Thinking…") : t("✨ Pedir ideas nuevas a la IA", "✨ Ask the AI for new ideas")}
            </button>
          </div>
          <span className="small muted">
            {t(
              "Salen de tu perfil, tu estudio y lo que Google ya sabe de tu página. Acepta las que sirvan y quita las que no; las que quites no vuelven a salir. Pedir ideas no usa saldo de DataForSEO.",
              "They come from your profile, your study and what Google already knows about your site. Accept the useful ones and remove the rest; removed ones won't come back. Asking for ideas doesn't use DataForSEO balance.",
            )}
          </span>
          {aiError && <p className="note error" role="alert">{aiError}</p>}
          {suggestions.length > 0 ? (
            <ul className={styles.sugList}>
              {suggestions.map((s) => (
                <li key={s.keyword} className={styles.sug}>
                  <span className={styles.sugText}>
                    <strong>{s.keyword}</strong>
                    <span className="small muted">
                      {sourceLabel(s.source, t)}
                      {s.volume !== undefined && ` · ${s.volume === null ? t("pocas búsquedas", "few searches") : t(`${nf.format(s.volume)} búsquedas/mes`, `${nf.format(s.volume)} searches/mo`)}`}
                      {s.source === "profile" && ` · ${lang === "en" ? s.why.en : s.why.es}`}
                    </span>
                  </span>
                  <span className={styles.sugBtns}>
                    <button type="button" className={styles.yes} onClick={() => addKeyword(s.keyword)} disabled={keywords.length >= MAX_KEYWORDS}>
                      ✓ {t("Aceptar", "Accept")}
                    </button>
                    <button type="button" className={styles.no} onClick={() => reject(s.keyword)}>
                      ✗ {t("Quitar", "Remove")}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">{t("No hay más sugerencias por ahora. Pide ideas nuevas a la IA.", "No more suggestions for now. Ask the AI for new ideas.")}</p>
          )}
        </div>
      </section>

      {/* 4. Frecuencia */}
      <section className={styles.step} aria-labelledby="dfs-freq">
        <div className={styles.stepHead}>
          <span className={styles.num}>4</span>
          <div>
            <h3 id="dfs-freq">{t("¿Cada cuánto revisamos tus posiciones?", "How often should we check your rankings?")}</h3>
            <p className="small muted">
              {t(
                `Cada revisión busca ${keywords.length} ${keywords.length === 1 ? "palabra" : "palabras"} en ${Math.max(1, zones.length)} ${zones.length === 1 ? "zona" : "zonas"} = ${keywords.length * Math.max(1, zones.length)} búsquedas en Google, a US$${price.toFixed(4)} cada una (${usd(perCheck, "es")} por revisión). Para un negocio local, cada semana es suficiente.`,
                `Each check looks up ${keywords.length} ${keywords.length === 1 ? "keyword" : "keywords"} in ${Math.max(1, zones.length)} ${zones.length === 1 ? "area" : "areas"} = ${keywords.length * Math.max(1, zones.length)} Google searches, at US$${price.toFixed(4)} each (${usd(perCheck, "en")} per check). For a local business, weekly is enough.`,
              )}
            </p>
          </div>
        </div>
        <div className={styles.options} role="radiogroup" aria-labelledby="dfs-freq">
          {RANK_FREQUENCIES.map((f) => (
            <label key={f} className={`${styles.option} ${frequency === f ? styles.optionOn : ""}`}>
              <input type="radio" name="frequency-pick" value={f} checked={frequency === f} onChange={() => setFrequency(f)} />
              {f === 7 && <span className={styles.tag}>{t("Recomendado", "Recommended")}</span>}
              <strong>{frequencyLabel(f, t)}</strong>
              <span className={`small ${styles.cost}`}>
                {f === 0 ? t("Gratis · solo a mano", "Free · manual only") : t(`≈ ${usd(monthlyRankCost(f, keywords.length, zones.length, price), "es")} al mes`, `≈ ${usd(monthlyRankCost(f, keywords.length, zones.length, price), "en")} a month`)}
              </span>
            </label>
          ))}
        </div>
      </section>

      {result && (
        <p className={result.ok ? "note ok" : "note error"} role="status">
          {result.message}
        </p>
      )}
      <div className={styles.saveBar}>
        <button type="submit" className="btn primary" disabled={saving || zones.length === 0 || keywords.length === 0}>
          {saving ? t("Guardando…", "Saving…") : t("Guardar cambios", "Save changes")}
        </button>
        {zones.length === 0 ? (
          <span className="small muted">{t("Elige primero una zona (paso 1).", "Pick an area first (step 1).")}</span>
        ) : keywords.length === 0 ? (
          <span className="small muted">{t("Agrega al menos una palabra (paso 3).", "Add at least one keyword (step 3).")}</span>
        ) : dirty && !saving ? (
          <span className="small muted">{t("Tienes cambios sin guardar.", "You have unsaved changes.")}</span>
        ) : null}
      </div>
    </form>
  );
}
