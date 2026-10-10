"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import type { SiteResult } from "@/app/actions-seo-site";
import { useT } from "@/components/I18n";
import type { SiteCopy } from "@/lib/publishers/website";
import type { SitePhoto, PhotoOption } from "@/lib/seo/site-article";
import styles from "./SitePublish.module.css";

type Bi = { es: string; en: string };
type Action = (prev: SiteResult, f: FormData) => Promise<SiteResult>;

export type SitePublishProps = {
  /** ready: conectado y sin preparar · prepared: vista previa · stale: el artículo cambió · published · changed: publicado y luego mejorado. */
  state: "ready" | "prepared" | "stale" | "published" | "changed";
  prepare: Action;
  pick: Action;
  regen: Action;
  approve: Action;
  /** Lo que cuesta una foto con IA (centavos); 0 = no hay IA de imágenes. */
  photoCents: number;
  photoCost: string;
  /** Lo que se gasta al autorizar, y el texto del botón (ya con el precio). */
  approveCents: number;
  approveLabel: Bi;
  prepared?: {
    mode: "new" | "update";
    es: SiteCopy;
    en: SiteCopy;
    urlEs: string;
    urlEn: string;
    photo: SitePhoto;
    photoWhy: Bi;
    options: PhotoOption[];
    /** La fecha que va a mostrar el sitio, ya escrita en cada idioma. */
    date: Bi;
    sourceLang: "es" | "en";
  };
  published?: { url: string; urlEn: string; date: Bi; updated?: Bi; at: Bi };
  postHref: string;
};

/** Mientras trabaja: pasos y segundos. */
function Working({ steps }: { steps: [number, string][] }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const now = steps.findLastIndex(([at]) => seconds >= at);
  return (
    <div className="stack" style={{ gap: 10 }} aria-live="polite">
      <ul className="magic-steps">
        {steps.map(([, label], i) => (
          <li key={label} className={i < now ? "done" : i === now ? "now" : ""}>
            {label}
          </li>
        ))}
      </ul>
      <span className="small muted">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
      </span>
    </div>
  );
}

const Result = ({ r }: { r: SiteResult }) => (r ? <p className={r.ok ? "note ok" : "note error"} role="status">{r.message}</p> : null);

/** El artículo como lo va a mostrar la web: categoría, título, resumen, fecha, foto, secciones y preguntas. */
function SitePreview({ copy, date, photo, photoText }: { copy: SiteCopy; date: string; photo: string; photoText: string }) {
  const { t } = useT();
  return (
    <article className={styles.page}>
      <p className={styles.category}>{copy.category}</p>
      <h3 className={styles.h1}>{copy.title}</h3>
      <p className={styles.lead}>{copy.description}</p>
      <span className="small muted">{date}</span>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.photo} src={photo} alt={copy.title} />
      ) : (
        <div className={styles.photoBox}>{photoText}</div>
      )}
      {copy.sections.map((s, i) => (
        <section key={i} className={styles.section}>
          <h4>{s.title}</h4>
          <p>{s.text}</p>
          {s.items && (
            <ul>
              {s.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          )}
          {s.after && <p>{s.after}</p>}
        </section>
      ))}
      {copy.faq && copy.faq.length > 0 && (
        <section className={styles.section}>
          <h4>{t("Preguntas frecuentes", "Frequently asked questions")}</h4>
          {copy.faq.map(([q, a], i) => (
            <details key={i} className={styles.faq}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </section>
      )}
    </article>
  );
}

/** «Publicar en mi web»: prepara con IA, muestra cómo va a quedar y publica con un clic del dueño. */
export function SitePublish(p: SitePublishProps) {
  const { t, lang } = useT();
  const pick = (b: Bi) => (lang === "en" ? b.en : b.es);
  const [prep, runPrep, prepPending] = useActionState(p.prepare, null);
  const [picked, runPick, pickPending] = useActionState(p.pick, null);
  const [regen, runRegen, regenPending] = useActionState(p.regen, null);
  const [ok, runApprove, approvePending] = useActionState(p.approve, null);
  const [view, setView] = useState<"es" | "en">(p.prepared?.sourceLang ?? "es");
  const busy = prepPending || pickPending || regenPending || approvePending;

  const prepareForm = (label: string, note: string, cls = "btn ai") => (
    <form action={runPrep} className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ display: prepPending ? "none" : undefined }}>
        <button type="submit" className={cls} disabled={busy}>
          {label}
        </button>
        <span className="small muted">{note}</span>
      </div>
      {prepPending && (
        <Working
          steps={[
            [0, t("Revisando tu web…", "Checking your website…")],
            [3, t("Traduciendo el artículo al otro idioma…", "Translating the article into the other language…")],
            [40, t("Buscando la mejor foto…", "Finding the best photo…")],
          ]}
        />
      )}
      {!prepPending && <Result r={prep} />}
    </form>
  );
  const prepNote = t(
    "La IA lo prepara en español e inglés, elige una foto y te muestra cómo va a quedar. No se publica nada hasta que lo autorices. Usa la IA de texto (alrededor de US$0.01).",
    "The AI prepares it in Spanish and English, picks a photo and shows you how it will look. Nothing is published until you approve. Uses the text AI (about US$0.01).",
  );

  if (p.state === "published" || p.state === "changed") return <Published {...p} prepareForm={prepareForm} />;
  if (p.state !== "prepared" || !p.prepared)
    return (
      <section className="card">
        <div className="stack" style={{ gap: 4 }}>
          <h2>{t("Publicar en tu web", "Publish on your website")}</h2>
          {p.state === "stale" && (
            <p className="note">{t("El artículo cambió después de preparar la vista previa. Prepárala otra vez.", "The article changed after the preview was prepared. Prepare it again.")}</p>
          )}
        </div>
        {prepareForm(t("Publicar en mi web", "Publish on my website"), prepNote)}
      </section>
    );

  const pr = p.prepared;
  const copy = view === "es" ? pr.es : pr.en;
  const photoUrl = pr.photo.kind === "library" || pr.photo.kind === "generated" || pr.photo.kind === "current" ? pr.photo.url : "";
  const photoText =
    pr.photo.kind === "generate"
      ? t(`Foto: la IA va a crear una (${p.photoCost})`, `Photo: the AI will create one (${p.photoCost})`)
      : t("Foto: la del tema que ya usa tu web", "Photo: your website's topic photo");
  const selectedId = pr.photo.kind === "library" ? pr.photo.itemId : "";

  return (
    <section className="card">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{pr.mode === "update" ? t("Actualizar en tu web: revisa y autoriza", "Update on your website: check and approve") : t("Publicar en tu web: revisa y autoriza", "Publish on your website: check and approve")}</h2>
        <p className="small muted">{t("Así va a quedar en tu web. No se publica nada hasta que toques el botón de abajo.", "This is how it will look on your website. Nothing is published until you tap the button below.")}</p>
      </div>

      <dl className={styles.facts}>
        <div>
          <dt>{t("Título en español", "Spanish title")}</dt>
          <dd>{pr.es.title}</dd>
        </div>
        <div>
          <dt>{t("Título en inglés", "English title")}</dt>
          <dd>{pr.en.title}</dd>
        </div>
        <div>
          <dt>{t("Dirección en tu web", "Address on your website")}</dt>
          <dd className={styles.urls}>
            <span>{pr.urlEs}</span>
            <span>{pr.urlEn}</span>
          </dd>
        </div>
      </dl>

      <div className="stack" style={{ gap: 8 }}>
        <span className="lbl">{t("Foto", "Photo")}</span>
        <div className={styles.photoRow}>
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={styles.thumbBig} src={photoUrl} alt="" />
          ) : (
            <div className={`${styles.thumbBig} ${styles.photoBox}`}>{pr.photo.kind === "generate" ? "✨" : "🖼"}</div>
          )}
          <div className="stack" style={{ gap: 4, minWidth: 0 }}>
            <strong>
              {pr.photo.kind === "library"
                ? t("De tu biblioteca", "From your library")
                : pr.photo.kind === "generated"
                  ? t("Creada por la IA", "Created by the AI")
                  : pr.photo.kind === "current"
                    ? t("La que ya está en tu web", "The one already on your website")
                    : photoText}
            </strong>
            <span className="small muted">{pick(pr.photoWhy)}</span>
          </div>
        </div>
        <details className={styles.change}>
          <summary className="btn link">{t("Cambiar foto", "Change photo")}</summary>
          <div className="stack" style={{ gap: 10, marginTop: 10 }}>
            {pr.options.length > 0 && (
              <form action={runPick} className={styles.grid} style={{ display: pickPending ? "none" : undefined }}>
                {pr.options.map((o) => (
                  <button key={o.id} type="submit" name="photo" value={o.id} className={`${styles.option} ${o.id === selectedId ? styles.on : ""}`} disabled={busy} title={o.label} aria-label={o.label || t("Foto de tu biblioteca", "Photo from your library")} aria-pressed={o.id === selectedId}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={o.thumb} alt="" loading="lazy" />
                  </button>
                ))}
              </form>
            )}
            {pickPending && <span className="small muted">{t("Cambiando…", "Changing…")}</span>}
            {!pr.options.length && <span className="small muted">{t("Tu biblioteca no tiene fotos listas para usar.", "Your library has no photos ready to use.")}</span>}
            <div className="row">
              {p.photoCents > 0 && (
                <form action={runRegen}>
                  <input type="hidden" name="cents" value={p.photoCents} />
                  <button type="submit" className="btn" disabled={busy}>
                    {regenPending
                      ? t("Creando foto…", "Creating photo…")
                      : pr.photo.kind === "generated"
                        ? t(`Crear otra con IA · ${p.photoCost}`, `Create another with AI · ${p.photoCost}`)
                        : t(`Crear una con IA · ${p.photoCost}`, `Create one with AI · ${p.photoCost}`)}
                  </button>
                </form>
              )}
              {pr.photo.kind !== "stock" && (
                <form action={runPick}>
                  <input type="hidden" name="photo" value="stock" />
                  <button type="submit" className="btn link" disabled={busy}>
                    {t("Usar la foto del tema de mi web", "Use my website's topic photo")}
                  </button>
                </form>
              )}
            </div>
            <Result r={picked} />
            <Result r={regen} />
          </div>
        </details>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="row between">
          <span className="lbl">{t("Así se va a ver", "How it will look")}</span>
          <div className={styles.tabs} role="tablist">
            {(["es", "en"] as const).map((l) => (
              <button key={l} type="button" role="tab" aria-selected={view === l} className={view === l ? styles.tabOn : undefined} onClick={() => setView(l)}>
                {l === "es" ? "Español" : "English"}
              </button>
            ))}
          </div>
        </div>
        <SitePreview copy={copy} date={view === "es" ? pr.date.es : pr.date.en} photo={photoUrl} photoText={photoText} />
      </div>

      <form action={runApprove} className="stack" style={{ gap: 10 }}>
        <input type="hidden" name="cents" value={p.approveCents} />
        <div className="row" style={{ display: approvePending ? "none" : undefined }}>
          <button type="submit" className="btn on" disabled={busy}>
            {pick(p.approveLabel)}
          </button>
          <span className="small muted">
            {p.approveCents > 0
              ? t("Primero la IA crea la foto y luego se publica. Tu web lo muestra en unos minutos.", "First the AI creates the photo, then it's published. Your website shows it in a few minutes.")
              : t("Tu web lo muestra en unos minutos.", "Your website shows it in a few minutes.")}
          </span>
        </div>
        {approvePending && (
          <Working
            steps={[
              ...(p.approveCents > 0 ? ([[0, t("Creando la foto…", "Creating the photo…")]] as [number, string][]) : []),
              [p.approveCents > 0 ? 15 : 0, t("Subiendo la foto…", "Uploading the photo…")],
              [p.approveCents > 0 ? 20 : 4, t("Publicando el artículo…", "Publishing the article…")],
            ]}
          />
        )}
        {!approvePending && <Result r={ok} />}
      </form>
      {prepareForm(
        t("Preparar otra vez", "Prepare again"),
        t("Si quieres otra traducción. Usa la IA de texto (alrededor de US$0.01).", "If you want another translation. Uses the text AI (about US$0.01)."),
        "btn link",
      )}
    </section>
  );
}

/** Ya publicado: la dirección, la fecha que muestra la web, «Hacer un post» y, si el artículo cambió, «Actualizar en la web». */
function Published(p: SitePublishProps & { prepareForm: (label: string, note: string, cls?: string) => React.ReactNode }) {
  const { t } = useT();
  const pub = p.published;
  if (!pub) return null;
  return (
    <section className={`card ${styles.done}`}>
      <div className="stack" style={{ gap: 4 }}>
        <h2>✓ {t("Publicado en tu web", "Published on your website")}</h2>
        <p className="small muted">
          {pub.updated
            ? t(`Tu web muestra «Actualizado ${pub.updated.es}».`, `Your website shows “Updated ${pub.updated.en}”.`)
            : t(`Tu web muestra «Publicado ${pub.date.es}».`, `Your website shows “Published ${pub.date.en}”.`)}{" "}
          {t(`Lo autorizaste el ${pub.at.es}.`, `You approved it on ${pub.at.en}.`)}
        </p>
      </div>
      <div className={styles.links}>
        <a href={pub.url} target="_blank" rel="noopener noreferrer">
          {t("Ver en español", "See in Spanish")} ↗
        </a>
        <a href={pub.urlEn} target="_blank" rel="noopener noreferrer">
          {t("Ver en inglés", "See in English")} ↗
        </a>
      </div>
      <span className={`small muted ${styles.urls}`}>
        <span>{pub.url}</span>
      </span>
      <div className="row">
        <Link href={p.postHref} className="btn on">
          {t("Hacer un post", "Make a post")}
        </Link>
        <span className="small muted">{t("Para avisar en tus redes que el artículo ya está en tu web.", "To tell your followers the article is on your website.")}</span>
      </div>
      {p.state === "changed" &&
        p.prepareForm(
          t("Actualizar en la web", "Update on the website"),
          t(
            "Mejoraste el artículo después de publicarlo. La IA prepara la versión nueva (misma dirección) y te la muestra antes de cambiar nada. Usa la IA de texto (alrededor de US$0.01).",
            "You improved the article after publishing it. The AI prepares the new version (same address) and shows it to you before changing anything. Uses the text AI (about US$0.01).",
          ),
        )}
    </section>
  );
}
