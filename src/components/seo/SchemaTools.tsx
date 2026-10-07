"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import type { SchemaSaveResult } from "@/app/actions-seo-schema";
import { useT } from "@/components/I18n";
import { Fold } from "@/components/seo/Fold";
import fold from "@/components/seo/Fold.module.css";
import styles from "@/components/seo/SchemaPanel.module.css";
import { buildLocalBusinessSchema, DAY_NAMES, DAYS, type Day, type FixPlace, type MissingLevel, type SchemaInput, schemaSnippet, type WeekHours } from "@/lib/seo/schema";

export type FixLinks = Record<FixPlace, string>;

type Props = {
  /** Todo lo que se sabe del negocio, menos el horario y el precio (que se editan aquí). */
  base: SchemaInput;
  initialHours: WeekHours | null;
  initialPrice: string;
  /** De dónde salió el horario: guardado aquí, del Perfil de Google o ninguno. */
  hoursFrom: "saved" | "google" | "none";
  links: FixLinks;
  save: (prev: SchemaSaveResult, f: FormData) => Promise<SchemaSaveResult>;
};

type DayState = { open: boolean; opens: string; closes: string };

const toState = (h: WeekHours | null): Record<Day, DayState> =>
  Object.fromEntries(
    DAYS.map((d) => {
      const r = h?.[d]?.[0];
      return [d, r ? { open: true, opens: r.opens, closes: r.closes } : { open: false, opens: "08:00", closes: "17:00" }];
    }),
  ) as Record<Day, DayState>;

const toHours = (s: Record<Day, DayState>): WeekHours => {
  const out: WeekHours = {};
  for (const d of DAYS) if (s[d].open && s[d].opens && s[d].closes && s[d].opens !== s[d].closes) out[d] = [{ opens: s[d].opens, closes: s[d].closes }];
  return out;
};

/** Copia un texto (con un respaldo para navegadores sin permiso de portapapeles). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

type Platform = "wordpress" | "wix" | "shopify" | "other";

/** El código listo para copiar, lo que falta, el horario editable y dónde pegarlo. */
export function SchemaTools({ base, initialHours, initialPrice, hoursFrom, links, save }: Props) {
  const { t, lang } = useT();
  const [days, setDays] = useState(() => toState(initialHours));
  const [price, setPrice] = useState(initialPrice);
  const [copied, setCopied] = useState<"" | "ok" | "error">("");
  const [platform, setPlatform] = useState<Platform>("wordpress");
  const [result, run, pending] = useActionState(save, null);
  // El horario se abre solo si falta y el dueño nunca guardó uno; si no, queda cerrado con un resumen.
  const [hoursOpen, setHoursOpen] = useState(() => hoursFrom === "none" && !Object.keys(initialHours ?? {}).length);

  // Si llegan con #schema-hours (el enlace «Ir» de lo que falta, o desde otra página), se abre el horario.
  useEffect(() => {
    const check = () => {
      if (window.location.hash === "#schema-hours") setHoursOpen(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  const built = useMemo(() => buildLocalBusinessSchema({ ...base, hours: toHours(days), priceRange: price }), [base, days, price]);
  const code = useMemo(() => schemaSnippet(built.schema), [built]);
  const dirty = JSON.stringify(toHours(days)) !== JSON.stringify(toHours(toState(initialHours))) || price.trim() !== initialPrice.trim();

  const setDay = (d: Day, patch: Partial<DayState>) => setDays((s) => ({ ...s, [d]: { ...s[d], ...patch } }));
  const copyMonday = () =>
    setDays((s) => Object.fromEntries(DAYS.map((d) => [d, d === "Monday" || !s[d].open ? s[d] : { ...s[d], opens: s.Monday.opens, closes: s.Monday.closes }])) as Record<Day, DayState>);

  const onCopy = async () => {
    const ok = await copyText(code);
    setCopied(ok ? "ok" : "error");
    window.setTimeout(() => setCopied(""), 4000);
  };

  const level: Record<MissingLevel, { cls: string; text: string }> = {
    required: { cls: styles.required, text: t("Obligatorio", "Required") },
    recommended: { cls: styles.recommended, text: t("Recomendado", "Recommended") },
    optional: { cls: styles.optional, text: t("Opcional", "Optional") },
  };
  const counts = { required: 0, recommended: built.tips.length, optional: 0 };
  for (const m of built.missing) counts[m.level]++;
  const missingParts = [
    counts.required && t(`${counts.required} obligatorio${counts.required === 1 ? "" : "s"}`, `${counts.required} required`),
    counts.recommended && t(`${counts.recommended} recomendado${counts.recommended === 1 ? "" : "s"}`, `${counts.recommended} recommended`),
    counts.optional && t(`${counts.optional} opcional${counts.optional === 1 ? "" : "es"}`, `${counts.optional} optional`),
  ].filter(Boolean) as string[];
  const and = t(" y ", " and ");
  const missingSummary = t(
    `Lo que falta: ${missingParts.slice(0, -1).join(", ")}${missingParts.length > 1 ? and : ""}${missingParts[missingParts.length - 1] ?? ""}`,
    `What's missing: ${missingParts.slice(0, -1).join(", ")}${missingParts.length > 1 ? and : ""}${missingParts[missingParts.length - 1] ?? ""}`,
  );
  const openDays = DAYS.filter((d) => days[d].open);
  const hoursSummary = openDays.length
    ? t(`Tu horario: ${openDays.length} día${openDays.length === 1 ? "" : "s"} abierto${openDays.length === 1 ? "" : "s"}`, `Your hours: open ${openDays.length} day${openDays.length === 1 ? "" : "s"}`)
    : t("Tu horario: todavía sin horario", "Your hours: no hours yet");
  const hoursNote =
    hoursFrom === "saved"
      ? t("Guardado aquí · tócalo para cambiarlo o poner tus precios", "Saved here · tap to change it or add your prices")
      : hoursFrom === "google"
        ? t("Traído de tu Perfil de Google · tócalo para revisarlo", "From your Google Business Profile · tap to check it")
        : t("Ponlo para que Google sepa a qué hora abres", "Add it so Google knows when you're open");
  const tabs: [Platform, string][] = [
    ["wordpress", "WordPress"],
    ["wix", "Wix"],
    ["shopify", "Shopify"],
    ["other", t("Otra página", "Other website")],
  ];

  return (
    <div className={styles.wrap}>
      {/* El código */}
      <div className="stack" style={{ gap: 10 }}>
        <div className="row between">
          <span className="small muted">
            {t("Tipo de negocio para Google:", "Business type for Google:")} <strong>{built.type}</strong>
          </span>
          <button type="button" className="btn on" onClick={onCopy}>
            {copied === "ok" ? t("¡Copiado!", "Copied!") : t("Copiar código", "Copy code")}
          </button>
        </div>
        <pre className={styles.code} tabIndex={0} aria-label={t("Código para pegar en tu página", "Code to paste on your website")}>
          <code>{code}</code>
        </pre>
        {copied === "error" && (
          <p className="note error" role="status">
            {t("No se pudo copiar solo. Selecciona el código con el dedo o el ratón y cópialo a mano.", "Couldn't copy automatically. Select the code with your finger or mouse and copy it by hand.")}
          </p>
        )}
        {dirty && <p className="small muted">{t("El código ya incluye tus cambios de horario y precios. Guárdalos abajo para que queden la próxima vez.", "The code already includes your hours and price changes. Save them below so they're kept next time.")}</p>}
      </div>

      {/* Lo que falta */}
      {(built.missing.length > 0 || built.tips.length > 0) && (
        <Fold summary={missingSummary} note={t("Para que el código esté completo · tócalo para ver qué y dónde arreglarlo", "To make the code complete · tap to see what and where to fix it")}>
          <ul className={styles.missing}>
            {built.missing.map((m) => (
              <li key={m.id}>
                <span className={`${styles.level} ${level[m.level].cls}`}>{level[m.level].text}</span>
                <span className={styles.missingText}>
                  {lang === "en" ? m.en : m.es}{" "}
                  {links[m.where].startsWith("#") ? (
                    <a href={links[m.where]} onClick={links[m.where] === "#schema-hours" ? () => setHoursOpen(true) : undefined}>
                      {t("Ir", "Go")}
                    </a>
                  ) : (
                    <Link href={links[m.where]}>{t("Ir", "Go")}</Link>
                  )}
                </span>
              </li>
            ))}
            {built.tips.map((tip) => (
              <li key={tip.es}>
                <span className={`${styles.level} ${styles.recommended}`}>{t("Revisa", "Check")}</span>
                <span className={styles.missingText}>{lang === "en" ? tip.en : tip.es}</span>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {/* Horario y precios */}
      <details className={fold.fold} id="schema-hours" open={hoursOpen} onToggle={(e) => setHoursOpen(e.currentTarget.open)}>
        <summary>
          <span className={fold.sumText}>
            <span>{hoursSummary}</span>
            <span className={fold.sumNote}>{hoursNote}</span>
          </span>
        </summary>
      <form action={run} className={styles.hours}>
        <div className="stack" style={{ gap: 4 }}>
          <p className="small muted">
            {hoursFrom === "google"
              ? t("Lo trajimos de tu Perfil de Google. Si cambió, corrígelo aquí y en Google.", "We got it from your Google Business Profile. If it changed, fix it here and on Google.")
              : t("Marca los días que abres y la hora. Que sea el mismo horario que tienes en tu Perfil de Google.", "Check the days you're open and the times. Use the same hours as on your Google Business Profile.")}
          </p>
        </div>
        <div className={styles.days}>
          {DAYS.map((d) => (
            <div key={d} className={styles.day}>
              <label className={styles.dayName}>
                <input type="checkbox" name={`open-${d}`} checked={days[d].open} onChange={(e) => setDay(d, { open: e.target.checked })} />
                {lang === "en" ? DAY_NAMES[d].en : DAY_NAMES[d].es}
              </label>
              {days[d].open ? (
                <div className={styles.times}>
                  <input type="time" className="field" name={`opens-${d}`} value={days[d].opens} onChange={(e) => setDay(d, { opens: e.target.value })} aria-label={t(`Abre el ${DAY_NAMES[d].es}`, `Opens on ${DAY_NAMES[d].en}`)} required />
                  <span aria-hidden>–</span>
                  <input type="time" className="field" name={`closes-${d}`} value={days[d].closes} onChange={(e) => setDay(d, { closes: e.target.value })} aria-label={t(`Cierra el ${DAY_NAMES[d].es}`, `Closes on ${DAY_NAMES[d].en}`)} required />
                </div>
              ) : (
                <span className="small muted">{t("Cerrado", "Closed")}</span>
              )}
            </div>
          ))}
        </div>
        <div className="row">
          <button type="button" className="btn outline" onClick={copyMonday} disabled={!days.Monday.open}>
            {t("Copiar el horario del lunes a los demás días", "Copy Monday's hours to the other days")}
          </button>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="small" htmlFor="schema-price">
            <strong>{t("Rango de precios (opcional)", "Price range (optional)")}</strong> · {t("ej. «$$» o «C$500 a C$5,000». Déjalo vacío si no quieres mostrarlo.", "e.g. “$$” or “$50 to $500”. Leave it empty if you don't want to show it.")}
          </label>
          <input id="schema-price" name="priceRange" className="field" maxLength={99} value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="row">
          <button type="submit" className="btn on" disabled={pending}>
            {pending ? t("Guardando…", "Saving…") : t("Guardar horario y precios", "Save hours and prices")}
          </button>
          <span className="small muted">{t("Gratis: no usa saldo de DataForSEO.", "Free: doesn't use DataForSEO balance.")}</span>
        </div>
        {result && !pending && (
          <p className={result.ok ? "note ok" : "note error"} role="status">
            {result.message}
          </p>
        )}
      </form>
      </details>

      {/* Dónde pegarlo */}
      <Fold summary={t("Dónde pegarlo", "Where to paste it")} note={t("Pasos para WordPress, Wix, Shopify u otra página", "Steps for WordPress, Wix, Shopify or another website")}>
        <div className="tabs" role="tablist" aria-label={t("Tu tipo de página", "Your website type")}>
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={platform === id} className={platform === id ? "tab on" : "tab"} onClick={() => setPlatform(id)}>
              {label}
            </button>
          ))}
        </div>
        <ol className={styles.steps} role="tabpanel">
          {platform === "wordpress" && (
            <>
              <li>{t("Entra a tu WordPress (tudominio.com/wp-admin).", "Log in to your WordPress (yourdomain.com/wp-admin).")}</li>
              <li>{t("Ve a Plugins → Añadir nuevo, busca «WPCode» (o «Insert Headers and Footers»), instálalo y actívalo.", "Go to Plugins → Add New, search for “WPCode” (or “Insert Headers and Footers”), install and activate it.")}</li>
              <li>{t("Abre Code Snippets → Header & Footer.", "Open Code Snippets → Header & Footer.")}</li>
              <li>{t("Pega el código en el cuadro «Header» y presiona Guardar.", "Paste the code in the “Header” box and press Save.")}</li>
              <li>{t("Si usas Yoast o Rank Math, ya ponen un código de «Organization»: déjalo, este lo completa.", "If you use Yoast or Rank Math, they already add an “Organization” code: keep it, this one completes it.")}</li>
            </>
          )}
          {platform === "wix" && (
            <>
              <li>{t("Entra a tu panel de Wix y abre Configuración (Settings).", "Open your Wix dashboard and go to Settings.")}</li>
              <li>{t("Baja hasta Avanzado → Código personalizado (Custom code) y presiona «+ Agregar código».", "Scroll to Advanced → Custom code and press “+ Add Custom Code”.")}</li>
              <li>{t("Pega el código, ponle un nombre (ej. «Google negocio»), elige «Todas las páginas» y «Head».", "Paste the code, give it a name (e.g. “Google business”), choose “All pages” and “Head”.")}</li>
              <li>{t("Presiona Aplicar. Necesitas un dominio propio conectado (plan Premium).", "Press Apply. You need your own connected domain (Premium plan).")}</li>
            </>
          )}
          {platform === "shopify" && (
            <>
              <li>{t("En Shopify ve a Tienda online → Temas.", "In Shopify go to Online Store → Themes.")}</li>
              <li>{t("En tu tema presiona «…» → Editar código y abre el archivo theme.liquid.", "On your theme press “…” → Edit code and open the theme.liquid file.")}</li>
              <li>{t("Pega el código justo antes de la línea </head> y presiona Guardar.", "Paste the code right before the </head> line and press Save.")}</li>
            </>
          )}
          {platform === "other" && (
            <>
              <li>{t("Pídele a quien hizo tu página (o búscalo en su editor) que pegue este código dentro de <head> de la página de inicio.", "Ask whoever built your website (or look in its editor) to paste this code inside the <head> of the home page.")}</li>
              <li>{t("En Squarespace: Configuración → Avanzado → Inyección de código → Encabezado. En GoDaddy: Configuración → SEO o «HTML personalizado».", "In Squarespace: Settings → Advanced → Code Injection → Header. In GoDaddy: Settings → SEO or “Custom HTML”.")}</li>
              <li>{t("Basta con la página de inicio (o la de contacto). No lo pegues dos veces en la misma página.", "The home page (or contact page) is enough. Don't paste it twice on the same page.")}</li>
            </>
          )}
        </ol>
        <p className="small">
          {t("Después de pegarlo, compruébalo con la ", "After pasting it, check it with Google's ")}
          <a href="https://search.google.com/test/rich-results" target="_blank" rel="noopener noreferrer">
            {t("Prueba de resultados enriquecidos de Google", "Rich Results Test")}
          </a>
          {t(
            ": escribe la dirección de tu página y debe aparecer «Empresas locales» sin errores. También puedes pegar el código ahí antes de ponerlo en tu página.",
            ": enter your website address and it should show “Local businesses” with no errors. You can also paste the code there before adding it to your site.",
          )}
        </p>
      </Fold>
    </div>
  );
}
