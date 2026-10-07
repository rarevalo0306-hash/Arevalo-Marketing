"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { KitResult } from "@/app/actions-brand-kit";
import { KitCard, KitFavicons } from "@/components/brand/KitCard";
import { KitSignature } from "@/components/brand/KitSignature";
import { useT } from "@/components/I18n";
import { KIT_FORMATS, KIT_GROUPS, TAGLINE_MAX, type CoverLang, type CoverText } from "@/lib/brand-kit-formats";
import { intlLocale } from "@/lib/i18n";
import s from "./Kit.module.css";

export type KitItem = { id: string; url: string; w: number; h: number; format: string; transparent: boolean; createdAt: string };
export type KitBusiness = { name: string; color: string; phone: string; website: string; hasLogo: boolean };

type Suggest = () => Promise<{ ok: boolean; es: string; en: string; ai: boolean; message?: string }>;

const STEPS: [string, string][] = [
  ["Preparando tu logo…", "Preparing your logo…"],
  ["Dibujando la foto de perfil y los íconos…", "Drawing the profile picture and icons…"],
  ["Creando las portadas de las redes…", "Creating the social media covers…"],
  ["Armando el encabezado de email y la tarjeta…", "Building the email header and business card…"],
  ["Guardando las imágenes…", "Saving the images…"],
];

function Progress() {
  const { t } = useT();
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => Math.min(n + 1, STEPS.length - 1)), 2600);
    return () => clearInterval(id);
  }, []);
  return (
    <div className={s.progress} role="status" aria-live="polite">
      <span className={s.spinner} aria-hidden />
      <span>{t(...STEPS[i])}</span>
    </div>
  );
}

export function KitPanel({
  businessId,
  business,
  items,
  generatedAt,
  cover,
  autoSuggest,
  aiOn,
  create,
  suggest,
}: {
  businessId: string;
  business: KitBusiness;
  items: KitItem[];
  generatedAt: string | null;
  cover: CoverText;
  autoSuggest: boolean;
  aiOn: boolean;
  create: (prev: KitResult, form: FormData) => Promise<KitResult>;
  suggest: Suggest;
}) {
  const { t, lang } = useT();
  const [result, run, pending] = useActionState(create, null);
  const [coverLang, setCoverLang] = useState<CoverLang>(cover.lang);
  const [es, setEs] = useState(cover.es);
  const [en, setEn] = useState(cover.en);
  const [thinking, setThinking] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const touched = useRef(false);

  const propose = async (auto: boolean) => {
    setThinking(true);
    setAiNote("");
    try {
      const r = await suggest();
      if (auto && touched.current) return;
      if (r.es) setEs(r.es);
      if (r.en) setEn(r.en);
      // Al abrir, si la IA falla, se queda la frase de respaldo sin avisar; el aviso sale solo al pedirla con el botón.
      if (r.message && !auto) setAiNote(r.message);
      if (auto && r.ok) {
        try {
          sessionStorage.setItem(`kit-tagline-${businessId}`, JSON.stringify({ es: r.es, en: r.en }));
        } catch {}
      }
    } catch {
      if (!auto) setAiNote(t("La IA no pudo proponer una frase. Escríbela tú.", "The AI couldn't suggest a tagline. Write your own."));
    } finally {
      setThinking(false);
    }
  };

  // La primera vez (sin frase guardada), la IA propone una. Se recuerda en esta pestaña para no pedirla otra vez.
  useEffect(() => {
    if (!autoSuggest) return;
    let cached: { es?: string; en?: string } | null = null;
    try {
      cached = JSON.parse(sessionStorage.getItem(`kit-tagline-${businessId}`) ?? "null");
    } catch {}
    if (cached?.es || cached?.en) {
      if (cached.es) setEs(cached.es);
      if (cached.en) setEn(cached.en);
      return;
    }
    void propose(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSuggest, businessId]);

  const byFormat = new Map(items.map((a) => [a.format, a]));
  const has = items.length > 0;
  const when = generatedAt ? new Date(generatedAt).toLocaleString(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" }) : "";
  const total = KIT_FORMATS.length;

  return (
    <section className="card" id="kit" aria-labelledby="kit-title">
      <div className="stack" style={{ gap: 4 }}>
        <h2 id="kit-title">{t("Kit de marca listo para usar", "Ready-to-use brand kit")}</h2>
        <p className="small muted">
          {t(
            `Con un botón creamos las ${total} imágenes que tu negocio necesita —logos limpios, foto de perfil, portadas de cada red, íconos del sitio web, encabezado de email y tarjeta de presentación— con tu logo, tus colores y tu letra. Listas para descargar y subir.`,
            `With one button we create the ${total} images your business needs —clean logos, profile picture, a cover for each network, website icons, email header and business card— with your logo, colors and font. Ready to download and upload.`,
          )}
        </p>
      </div>

      {!business.hasLogo && (
        <p className="note">
          {t("Todavía no tienes logo, así que usamos el nombre de tu negocio escrito con tu letra. Con tu logo de verdad se ve mucho mejor: ", "You don't have a logo yet, so we use your business name written in your font. Your real logo looks much better: ")}
          <a href="#logos" className={s.inlineLink}>{t("súbelo arriba, en Logos", "upload it above, under Logos")}</a>
          {t(" y vuelve a crear el kit.", " and create the kit again.")}
        </p>
      )}

      <form action={run} className={s.form}>
        <input type="hidden" name="lang" value={coverLang} />
        <fieldset className={s.langs}>
          <legend className="lbl">{t("Idioma de las portadas", "Cover language")}</legend>
          {(
            [
              ["es", t("Español", "Spanish")],
              ["en", t("Inglés", "English")],
              ["both", t("Los dos", "Both")],
            ] as [CoverLang, string][]
          ).map(([v, label]) => (
            <label key={v} className={`${s.langOpt} ${coverLang === v ? s.langOn : ""}`}>
              <input type="radio" name="coverLangPick" value={v} checked={coverLang === v} onChange={() => setCoverLang(v)} />
              {label}
            </label>
          ))}
        </fieldset>

        <div className={s.taglines}>
          {coverLang !== "en" && (
            <label className="stack" style={{ gap: 6 }}>
              <span className="lbl">{coverLang === "both" ? t("Frase para las portadas (español)", "Cover tagline (Spanish)") : t("Frase para las portadas", "Cover tagline")}</span>
              <input className="field" name="es" value={es} maxLength={TAGLINE_MAX} onChange={(e) => { touched.current = true; setEs(e.target.value); }} placeholder={t("Ej.: Puertas enrollables en Managua", "E.g.: Roll-up doors in Managua")} />
            </label>
          )}
          {coverLang !== "es" && (
            <label className="stack" style={{ gap: 6 }}>
              <span className="lbl">{coverLang === "both" ? t("Frase para las portadas (inglés)", "Cover tagline (English)") : t("Frase para las portadas", "Cover tagline")}</span>
              <input className="field" name="en" value={en} maxLength={TAGLINE_MAX} onChange={(e) => { touched.current = true; setEn(e.target.value); }} placeholder={t("Ej.: We help with your insurance claim", "E.g.: We help with your insurance claim")} />
            </label>
          )}
          {coverLang === "es" && <input type="hidden" name="en" value={en} />}
          {coverLang === "en" && <input type="hidden" name="es" value={es} />}
          <p className="small muted">
            {t("Va en las portadas, la imagen para compartir y la tarjeta, junto con tu teléfono y tu sitio web. Corta se lee mejor (3 a 8 palabras). Déjala vacía si no quieres frase.", "It goes on the covers, the share image and the business card, along with your phone and website. Short reads best (3 to 8 words). Leave it empty for no tagline.")}
          </p>
          {aiOn && (
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn ai" onClick={() => { touched.current = false; void propose(false); }} disabled={thinking || pending}>
                {thinking ? t("La IA está pensando una frase…", "The AI is thinking of a tagline…") : t("✦ Que la IA proponga otra", "✦ Ask the AI for another")}
              </button>
              <span className="small muted">{t("Cuesta menos de un centavo.", "Costs less than a cent.")}</span>
            </div>
          )}
          {aiNote && <p className="note" role="status">{aiNote}</p>}
        </div>

        <div className={s.actions}>
          <button type="submit" className="btn primary" disabled={pending}>
            {pending ? t("Creando tu kit…", "Creating your kit…") : has ? t("Volver a crear", "Create again") : t("Crear mi kit", "Create my kit")}
          </button>
          {!pending && <span className="small muted">{t("Gratis: no usa IA. Tarda unos 20 segundos.", "Free: no AI involved. Takes about 20 seconds.")}</span>}
          {pending && <Progress />}
        </div>
        {result && !pending && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
      </form>

      {has && (
        <>
          <div className={s.toolbar}>
            <span className="small muted">{when && t(`Creado el ${when}.`, `Created ${when}.`)}</span>
            <a className="btn outline" href={`/api/brand-kit/${businessId}/zip?lang=${lang}`} download>
              {t("Descargar todo (ZIP)", "Download all (ZIP)")}
            </a>
          </div>
          {KIT_GROUPS.map((g) => {
            const formats = KIT_FORMATS.filter((f) => f.group === g.key && byFormat.has(f.key));
            if (!formats.length) return null;
            const favicons = formats.filter((f) => f.family === "favicon");
            return (
              <div key={g.key} className={s.group}>
                <h3 className={s.groupTitle}>{g.label[lang]}</h3>
                <div className={s.grid}>
                  {formats.map((f) => {
                    if (f.family === "favicon") {
                      return f === favicons[0] ? <KitFavicons key="favicons" businessId={businessId} formats={favicons} items={byFormat} /> : null;
                    }
                    if (f.key === "email-logo") {
                      return <KitSignature key={f.key} businessId={businessId} business={business} logo={byFormat.get(f.key)!} format={f} tagline={coverLang === "en" ? en : es} />;
                    }
                    return <KitCard key={f.key} businessId={businessId} format={f} item={byFormat.get(f.key)!} />;
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
