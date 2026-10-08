"use client";

// Paso "Foto o video (opcional)" de Nueva publicación: subir desde el celular o la computadora, elegir de «Tus fotos»
// (la carpeta de Drive del negocio), crear con IA, o (en "Más opciones") usar un enlace. Separado del compositor para poder cambiar los tamaños y diseños aparte.
// Todo el estado vive en Composer.tsx; aquí solo se dibuja.
import { useRef, useState } from "react";
import { useT } from "@/components/I18n";
import type { MediaType } from "@/lib/channels";
import s from "./Composer.module.css";
import { VideoProgress } from "@/components/VideoProgress";
import { LibraryPicker } from "@/components/library/LibraryPicker";
import type { LibraryCard } from "@/lib/library-match";

export type MediaStepProps = {
  mediaType: MediaType;
  /** Lo que se ve: el archivo local (blob:) o el enlace. */
  mediaSrc: string;
  mediaLink: string;
  setMediaLink: (v: string) => void;
  setMediaType: (v: MediaType) => void;
  /** Sin Supabase Storage el archivo va con el formulario (name="file"). */
  fileInForm: boolean;
  onFile: (f: File | undefined) => void;
  uploading: boolean;
  uploadError: string;
  /** Quita la foto o el video. */
  clear: () => void;
  /** «Tus fotos»: las fotos y videos reales del negocio (carpeta de Drive). */
  library: null | {
    load: () => Promise<LibraryCard[]>;
    /** Pone el archivo como foto o video de la publicación. Devuelve un error en palabras simples, o "". */
    pick: (c: LibraryCard) => Promise<string>;
    manageHref: string;
    /** No se pudo poner el archivo elegido. */
    error: string;
  };
  ai: null | {
    video: boolean;
    imageIdea: string;
    setImageIdea: (v: string) => void;
    busy: string;
    /** Video en camino: barra de avance según el tiempo típico del modelo. */
    videoJob?: { startedAt: number; etaSec: number } | null;
    error: string;
    create: (kind: "photo" | "video") => void;
    design: BrandDesignProps | null;
  };
};

export type BrandDesignProps = {
  basePhoto: string;
  showingDesign: boolean;
  headline: string;
  setHeadline: (v: string) => void;
  template: number;
  setTemplate: (v: number) => void;
  templates: { name: string; list: boolean; photo: boolean }[];
  shape: string;
  setShape: (v: string) => void;
  steps: string[];
  setSteps: (v: string[]) => void;
  busy: boolean;
  run: () => void;
  useOriginal: () => void;
};

const isVideoUrl = (u: string) => /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u);

export function MediaStep(p: MediaStepProps) {
  const { t } = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const has = p.mediaType !== "none" && !!p.mediaSrc;
  const showAi = !!p.ai && (aiOpen || !!p.ai.imageIdea.trim() || !!p.ai.busy);

  const clear = () => {
    if (fileRef.current) fileRef.current.value = "";
    p.clear();
  };

  return (
    <div className={s.stepBody}>
      {has && (
        <div className={s.current}>
          {p.mediaType === "video" ? (
            <video src={p.mediaSrc} className={s.thumb} muted playsInline />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) o enlace externo
            <img src={p.mediaSrc} alt="" className={s.thumb} />
          )}
          <div className={s.currentText}>
            <strong>{p.mediaType === "video" ? t("Video listo", "Video ready") : t("Foto lista", "Photo ready")}</strong>
            <span className="small muted">{p.uploading ? t("Subiendo… espera un momento", "Uploading… wait a moment") : t("Se publica junto con tu mensaje.", "It's posted with your message.")}</span>
          </div>
          <button type="button" className="btn" onClick={clear} disabled={p.uploading}>{t("Quitar", "Remove")}</button>
        </div>
      )}

      <div className={s.mediaBtns}>
        <label htmlFor="file" className={`btn ${s.mediaBtn}`}>
          <span className={s.mbTitle}><span aria-hidden="true">⤒</span> {has ? t("Cambiar foto o video", "Change photo or video") : t("Subir foto o video", "Upload a photo or video")}</span>
          <small>{t("Desde tu celular o computadora", "From your phone or computer")}</small>
        </label>
        {p.library && (
          <button type="button" className={libOpen ? `btn ${s.mediaBtn} ${s.mediaBtnOn}` : `btn ${s.mediaBtn}`} aria-haspopup="dialog" aria-expanded={libOpen} onClick={() => setLibOpen(true)}>
            <span className={s.mbTitle}><span aria-hidden="true">▦</span> {t("Tus fotos", "Your photos")}</span>
            <small>{t("Fotos reales de tu carpeta de Drive", "Real photos from your Drive folder")}</small>
          </button>
        )}
        {p.ai && (
          <button type="button" className={showAi ? `btn ${s.mediaBtn} ${s.mediaBtnOn}` : `btn ${s.mediaBtn}`} aria-expanded={showAi} onClick={() => setAiOpen((v) => !v)}>
            <span className={s.mbTitle}><span aria-hidden="true">✦</span> {t("Crear con IA", "Create with AI")}</span>
            <small>{p.ai.video ? t("Una foto o un video corto", "A photo or a short video") : t("Una foto con tu marca", "A photo with your brand")}</small>
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        id="file"
        name={p.fileInForm ? "file" : undefined}
        type="file"
        className="sr-only"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
        onChange={(e) => p.onFile(e.target.files?.[0])}
      />
      {p.library && libOpen && (
        <LibraryPicker
          onClose={() => setLibOpen(false)}
          load={p.library.load}
          manageHref={p.library.manageHref}
          onPick={async (c) => {
            // El archivo elegido antes (sin Supabase va con el formulario) ya no vale.
            if (fileRef.current) fileRef.current.value = "";
            return p.library!.pick(c);
          }}
        />
      )}
      {p.library?.error && <p className="note error" role="alert">{p.library.error}</p>}
      {p.uploading && <p className="small muted" role="status">{t("Subiendo archivo…", "Uploading file…")}</p>}
      {p.uploadError && <p className="note error" role="alert">{p.uploadError}</p>}

      {p.ai && showAi && (
        <div className={`ai-box ${s.aiMedia}`}>
          <label htmlFor="imageIdea" className="lbl ai-title">✦ {t("¿Qué se ve en la foto?", "What's in the photo?")}</label>
          <textarea
            id="imageIdea"
            className={`field ${s.short}`}
            rows={2}
            placeholder={t("Describe la imagen. Ej.: casa en Miami con el techo reparado, día soleado", "Describe the image. E.g., a house in Miami with a repaired roof, sunny day")}
            value={p.ai.imageIdea}
            onChange={(e) => p.ai!.setImageIdea(e.target.value)}
          />
          <div className="row">
            <button type="button" className="btn on" disabled={!!p.ai.busy || !p.ai.imageIdea.trim()} onClick={() => p.ai!.create("photo")}>{t("Crear foto", "Create photo")}</button>
            {p.ai.video && <button type="button" className="btn outline" disabled={!!p.ai.busy || !p.ai.imageIdea.trim()} onClick={() => p.ai!.create("video")}>{t("Crear video (5 seg)", "Create video (5 sec)")}</button>}
          </div>
          {p.ai.videoJob ? <VideoProgress startedAt={p.ai.videoJob.startedAt} etaSec={p.ai.videoJob.etaSec} /> : p.ai.busy && <p className="small muted" role="status">{p.ai.busy}</p>}
          {p.ai.error && <p className="note error" role="alert">{p.ai.error}</p>}
        </div>
      )}

      {p.ai?.design && <BrandDesign {...p.ai.design} />}

      <details className={s.more}>
        <summary>{t("Más opciones", "More options")}</summary>
        <div className={s.moreBody}>
          <label htmlFor="mediaLinkField" className="small" style={{ fontWeight: 700 }}>{t("Usar un enlace", "Use a link")}</label>
          <p className="small muted">
            {t(
              "Si tu foto o video ya está en internet (por ejemplo en tu página web o en Google Drive compartido para cualquiera), pega aquí su dirección. Tiene que abrirse sin pedir contraseña.",
              "If your photo or video is already online (for example on your website or a Google Drive file shared with anyone), paste its address here. It must open without asking for a password.",
            )}
          </p>
          <input
            id="mediaLinkField"
            type="url"
            className="field"
            placeholder="https://…"
            value={/^blob:/.test(p.mediaLink) ? "" : p.mediaLink}
            onChange={(e) => {
              const v = e.target.value;
              p.setMediaLink(v);
              p.setMediaType(v.trim() ? (isVideoUrl(v) ? "video" : p.mediaType === "video" ? "video" : "photo") : "none");
            }}
          />
          {/^https?:\/\//i.test(p.mediaLink) && (
            <div className="row" role="group" aria-label={t("¿Qué es?", "What is it?")}>
              <button type="button" className={p.mediaType === "photo" ? "btn on" : "btn"} aria-pressed={p.mediaType === "photo"} onClick={() => p.setMediaType("photo")}>{t("Es una foto", "It's a photo")}</button>
              <button type="button" className={p.mediaType === "video" ? "btn on" : "btn"} aria-pressed={p.mediaType === "video"} onClick={() => p.setMediaType("video")}>{t("Es un video", "It's a video")}</button>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

/** Diseño con tu marca: logo, color, titular y teléfono sobre la foto (plantilla y tamaño). */
function BrandDesign(d: BrandDesignProps) {
  const { t } = useT();
  return (
    <div className={s.design}>
      <div className="lbl">✦ {t("Diseño con tu marca", "Design with your brand")}</div>
      <p className="small muted">{t("Pone tu logo, tu color, un titular y tu teléfono sobre la foto, con letras perfectas.", "Puts your logo, your color, a headline, and your phone number on the photo, with perfect lettering.")}</p>
      <label htmlFor="headline" className="small" style={{ fontWeight: 600 }}>{t("Titular en la foto", "Headline on the photo")}</label>
      <input id="headline" className="field" maxLength={80} placeholder={t("Ej.: ¿Daños en tu techo después de la tormenta?", "E.g., Roof damage after the storm?")} value={d.headline} onChange={(e) => d.setHeadline(e.target.value)} />
      <div className={s.designRow}>
        <label htmlFor="template" className="sr-only">{t("Plantilla", "Template")}</label>
        <select id="template" className="field" value={d.template} onChange={(e) => d.setTemplate(Number(e.target.value))}>
          <option value={-1}>✦ {t("La IA elige la plantilla", "AI picks the template")}</option>
          {d.templates.map((x, i) => <option key={i} value={i}>{x.name}</option>)}
        </select>
        <label htmlFor="shape" className="sr-only">{t("Tamaño", "Size")}</label>
        <select id="shape" className="field" value={d.shape} onChange={(e) => d.setShape(e.target.value)}>
          <option value="square">{t("Cuadrado · Facebook e Instagram", "Square · Facebook and Instagram")}</option>
          <option value="portrait">{t("Vertical 4:5 · Instagram", "Portrait 4:5 · Instagram")}</option>
          <option value="story">{t("Historia / Reel 9:16", "Story / Reel 9:16")}</option>
        </select>
        <button type="button" className="btn on" disabled={d.busy || !d.headline.trim()} onClick={d.run}>{t("Diseñar", "Design")}</button>
      </div>
      {(d.template === -1 ? d.steps.length > 0 : d.templates[d.template]?.list) && (
        <div className="stack" style={{ gap: 6 }}>
          <label htmlFor="steps" className="small" style={{ fontWeight: 600 }}>{t("Pasos para la plantilla de lista (uno por línea, máximo 3)", "Steps for the list template (one per line, 3 max)")}</label>
          <textarea id="steps" className={`field ${s.short}`} value={d.steps.join("\n")} onChange={(e) => d.setSteps(e.target.value.split("\n").slice(0, 3))} />
        </div>
      )}
      {d.basePhoto && d.showingDesign && (
        <div className="row">
          <button type="button" className="btn link" onClick={d.useOriginal}>{t("Usar la foto sin diseño", "Use the photo without the design")}</button>
        </div>
      )}
    </div>
  );
}
