"use client";

// Las fotos 2 a 10 del carrusel (la primera es la del paso de la foto): agregar de «Tus fotos», subir, crear con
// IA o pegar un enlace; cambiar el orden, quitar y escribir el texto alternativo de cada una.
import { useRef, useState } from "react";
import { useT } from "@/components/I18n";
import { LibraryPicker } from "@/components/library/LibraryPicker";
import { errorText } from "@/lib/i18n";
import type { LibraryCard } from "@/lib/library-match";
import { CAROUSEL_MAX, CAROUSEL_MIN } from "@/lib/post-media";
import s from "./posts.module.css";

export type Slide = { url: string; alt: string; what: string };

type Props = {
  /** La primera foto (la del paso de la foto), o "" si todavía no hay. */
  first: string;
  slides: Slide[];
  setSlides: (fn: (prev: Slide[]) => Slide[]) => void;
  /** Agrega una foto (pide su texto alternativo). */
  add: (slide: Omit<Slide, "alt">) => void;
  /** Pone una foto de las demás como primera. */
  makeFirst: (i: number) => void;
  library: null | { load: () => Promise<LibraryCard[]>; url: (c: LibraryCard) => Promise<{ url: string } | { error: string }>; manageHref: string };
  upload: ((contentType: string) => Promise<{ uploadUrl: string; publicUrl: string }>) | null;
  aiImage: ((description: string) => Promise<{ ok: true; url: string } | { ok: false; error: string }>) | null;
};

export function CarouselSlides({ first, slides, setSlides, add, makeFirst, library, upload, aiImage }: Props) {
  const { lang, t } = useT();
  const [libOpen, setLibOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiIdea, setAiIdea] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const total = (first ? 1 : 0) + slides.length;
  const full = total >= CAROUSEL_MAX;

  async function onFiles(files: FileList | null) {
    if (!upload || !files?.length) return;
    setError("");
    const list = [...files].filter((f) => f.type.startsWith("image/")).slice(0, CAROUSEL_MAX - total);
    for (const f of list) {
      setBusy(t(`Subiendo ${f.name}…`, `Uploading ${f.name}…`));
      try {
        const { uploadUrl, publicUrl } = await upload(f.type);
        const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": f.type }, body: f });
        if (!res.ok) throw new Error(await res.text());
        add({ url: publicUrl, what: "" });
      } catch (e) {
        setError(`${t("No se pudo subir la foto", "Couldn't upload the photo")}: ${errorText(e, lang)}`);
      }
    }
    setBusy("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function makeAi() {
    if (!aiImage || !aiIdea.trim()) return;
    setError("");
    setBusy(t("Creando la foto…", "Creating the photo…"));
    try {
      const r = await aiImage(aiIdea);
      if (!r.ok) setError(r.error);
      else {
        add({ url: r.url, what: aiIdea.trim() });
        setAiIdea("");
        setAiOpen(false);
      }
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy("");
    }
  }

  const move = (i: number, d: number) =>
    setSlides((prev) => {
      const next = [...prev];
      const j = i + d;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <div className={s.carousel}>
      <div className="row between">
        <span className={total < CAROUSEL_MIN ? `${s.count} ${s.countBad}` : s.count} role="status">
          {t(`${total} de ${CAROUSEL_MAX} fotos`, `${total} of ${CAROUSEL_MAX} photos`)}
          {total < CAROUSEL_MIN && ` · ${t(`faltan ${CAROUSEL_MIN - total}`, `${CAROUSEL_MIN - total} more needed`)}`}
        </span>
        <span className="small muted">{t("La 1.ª es la de arriba", "Photo 1 is the one above")}</span>
      </div>
      {slides.length > 0 && (
        <ol className={s.slides}>
          {slides.map((sl, i) => (
            <li key={`${sl.url}-${i}`} className={s.slide}>
              <span className={s.slideImg}>
                {/* eslint-disable-next-line @next/next/no-img-element -- foto del carrusel (almacenamiento o enlace) */}
                <img src={sl.url} alt="" />
                <span className={s.slideNum}>{i + 2}</span>
              </span>
              <div className={s.slideBody}>
                <label htmlFor={`slide-alt-${i}`} className="sr-only">{t(`Descripción de la foto ${i + 2}`, `Description of photo ${i + 2}`)}</label>
                <textarea id={`slide-alt-${i}`} className="field" rows={3} maxLength={250} value={sl.alt} placeholder={t("Qué se ve en la foto (con tu palabra clave)", "What the photo shows (with your keyword)")} onChange={(e) => setSlides((prev) => prev.map((x, n) => (n === i ? { ...x, alt: e.target.value } : x)))} />
                <div className={s.slideBtns}>
                  <button type="button" className="btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t(`Mover la foto ${i + 2} antes`, `Move photo ${i + 2} earlier`)}>↑</button>
                  <button type="button" className="btn" onClick={() => move(i, 1)} disabled={i === slides.length - 1} aria-label={t(`Mover la foto ${i + 2} después`, `Move photo ${i + 2} later`)}>↓</button>
                  <button type="button" className="btn" onClick={() => makeFirst(i)}>{t("Poner primera", "Make it first")}</button>
                  <button type="button" className="btn" onClick={() => setSlides((prev) => prev.filter((_, n) => n !== i))}>{t("Quitar", "Remove")}</button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {!full && (
        <div className={s.addRow}>
          {library && <button type="button" className="btn" onClick={() => setLibOpen(true)} disabled={!!busy} aria-haspopup="dialog">▦ {t("Agregar de Tus fotos", "Add from Your photos")}</button>}
          {upload && (
            <label className="btn" htmlFor="carousel-files">
              ⤒ {t("Subir fotos", "Upload photos")}
            </label>
          )}
          {aiImage && <button type="button" className={aiOpen ? "btn on" : "btn"} onClick={() => setAiOpen((v) => !v)} disabled={!!busy} aria-expanded={aiOpen}>✦ {t("Crear con IA", "Create with AI")}</button>}
          <button type="button" className={linkOpen ? "btn on" : "btn"} onClick={() => setLinkOpen((v) => !v)} aria-expanded={linkOpen}>{t("Pegar un enlace", "Paste a link")}</button>
        </div>
      )}
      {upload && <input ref={fileRef} id="carousel-files" type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void onFiles(e.target.files)} />}
      {aiOpen && aiImage && !full && (
        <div className="stack" style={{ gap: 8 }}>
          <label htmlFor="carousel-ai" className="small" style={{ fontWeight: 700 }}>{t("¿Qué se ve en la foto?", "What's in the photo?")}</label>
          <textarea id="carousel-ai" className="field" rows={2} value={aiIdea} onChange={(e) => setAiIdea(e.target.value)} placeholder={t("Ej.: portón enrollable rojo en una tienda de Managua", "E.g., a red roll-up door at a store in Managua")} />
          <div className="row"><button type="button" className="btn on" disabled={!!busy || !aiIdea.trim()} onClick={() => void makeAi()}>{t("Crear foto", "Create photo")}</button></div>
        </div>
      )}
      {linkOpen && !full && (
        <div className={s.linkRow}>
          <label htmlFor="carousel-link" className="sr-only">{t("Enlace de la foto", "Photo link")}</label>
          <input id="carousel-link" type="url" className="field" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
          <button type="button" className="btn on" disabled={!/^https:\/\/\S+$/.test(link.trim())} onClick={() => { add({ url: link.trim(), what: "" }); setLink(""); setLinkOpen(false); }}>{t("Agregar", "Add")}</button>
        </div>
      )}
      {busy && <p className="small muted" role="status">{busy}</p>}
      {error && <p className="note error" role="alert">{error}</p>}
      {library && libOpen && (
        <LibraryPicker
          onClose={() => setLibOpen(false)}
          load={async () => (await library.load()).filter((c) => c.kind === "photo")}
          manageHref={library.manageHref}
          onPick={async (c) => {
            const r = await library.url(c);
            if ("error" in r) return r.error;
            add({ url: r.url, what: c.description ? c.description[lang] : "" });
            return "";
          }}
        />
      )}
    </div>
  );
}
