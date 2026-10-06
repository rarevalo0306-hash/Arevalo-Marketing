"use client";

import Link from "next/link";
import type { AiWriteResult, MediaResult, VideoCheck, VideoStart } from "@/app/actions";
import type { AiPost } from "@/lib/ai";
import type { VideoJob } from "@/lib/fal";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useT } from "@/components/I18n";
import { errorText, intlLocale } from "@/lib/i18n";
import {
  CHANNELS,
  channelText,
  isBlocked,
  notesFor,
  smsBody,
  type ChannelId,
  type Draft,
  type MediaType,
} from "@/lib/channels";

type Props = {
  businessId: string;
  businessName: string;
  color: string;
  connected: ChannelId[];
  contactCounts: { email: number; sms: number };
  action: (f: FormData) => Promise<void>;
  /** Con Supabase Storage: pide una dirección para subir el archivo directo desde el navegador. */
  upload: ((contentType: string) => Promise<{ uploadUrl: string; publicUrl: string }>) | null;
  /** Agente de IA: escribe la publicación y sus versiones por canal a partir de una idea. */
  aiWrite: ((idea: string, lang: string) => Promise<AiWriteResult>) | null;
  /** Fotos y videos con IA (fal.ai). */
  aiMedia: {
    image: (description: string, shape: string) => Promise<MediaResult>;
    /** Los videos solo se hacen con fal.ai. */
    video: boolean;
    /** Pone logo, color, titular y teléfono del negocio sobre la foto. */
    design: (photoUrl: string, headline: string, shape: string, template: number, steps: string[]) => Promise<MediaResult>;
    /** Plantillas de la marca (en orden); -1 = la IA elige. */
    templates: { name: string; list: boolean; photo: boolean }[];
    /** Si la marca se aplica sola a las fotos que crea la IA. */
    autoBrand: boolean;
    videoStart: (imageUrl: string, motion: string) => Promise<VideoStart>;
    videoCheck: (job: VideoJob) => Promise<VideoCheck>;
  } | null;
  /** Idea que viene del Inicio ("¿Qué quieres publicar hoy?"). */
  initialIdea?: string;
  /** Si es true, al abrir la página la IA hace todo: texto, foto y diseño. */
  autoMagic?: boolean;
};

/** Pasos del modo mágico: [español, inglés]. */
const MAGIC_STEPS = [
  ["Escribiendo para cada red", "Writing for each network"],
  ["Creando la foto", "Creating the photo"],
  ["Poniendo tu marca", "Adding your brand"],
  ["Listo para revisar", "Ready to review"],
] as const;

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  const { t } = useT();
  return (
    <button type="submit" className="primary" disabled={disabled || pending}>
      {pending ? t("Publicando… no cierres esta página", "Publishing… don't close this page") : label}
    </button>
  );
}

export function Composer({ businessId, businessName, color, connected, contactCounts, action, upload, aiWrite, aiMedia, initialIdea = "", autoMagic = false }: Props) {
  const { lang: uiLang, t } = useT();
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [mediaType, setMediaType] = useState<MediaType>("none");
  const [fileUrl, setFileUrl] = useState("");
  const [mediaLink, setMediaLink] = useState("");
  const [on, setOn] = useState<Set<ChannelId>>(() => new Set(connected));
  const [preview, setPreview] = useState<ChannelId | null>(null);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [localDate, setLocalDate] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [variants, setVariants] = useState<Partial<Record<ChannelId, string>>>({});
  const [idea, setIdea] = useState(initialIdea);
  // Paso del modo mágico (-1 = apagado).
  const [magicStep, setMagicStep] = useState(-1);
  const magicStarted = useRef(false);
  // Idioma en que escribe la IA (aparte del idioma de la app).
  const [lang, setLang] = useState("es");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [imageIdea, setImageIdea] = useState("");
  const [mediaBusy, setMediaBusy] = useState("");
  // Foto original (sin diseño), para poder volver a diseñarla con otro titular o tamaño.
  const [basePhoto, setBasePhoto] = useState("");
  const [headline, setHeadline] = useState("");
  const [shape, setShape] = useState("square");
  const [template, setTemplate] = useState(-1);
  const [steps, setSteps] = useState<string[]>([]);

  async function runDesign(photo = basePhoto) {
    if (!aiMedia || !photo) return;
    setMediaError("");
    setMediaBusy(t("Diseñando con tu marca…", "Designing with your brand…"));
    try {
      const r = await aiMedia.design(photo, headline, shape, template, steps);
      if (!r.ok) return setMediaError(r.error);
      setMediaType("photo");
      setMediaLink(r.url);
    } finally {
      setMediaBusy("");
    }
  }
  const [mediaError, setMediaError] = useState("");

  /** Foto con IA. Para video: primero una foto vertical y luego la IA le da movimiento (1-3 minutos). */
  async function runMedia(kind: "photo" | "video", description = imageIdea, head = headline, onBrand?: () => void, theSteps = steps) {
    if (!aiMedia) return;
    setMediaError("");
    setFileUrl("");
    try {
      setMediaBusy(t("Creando la imagen…", "Creating the image…"));
      const img = await aiMedia.image(description, kind === "video" ? "vertical" : "square");
      if (!img.ok) return setMediaError(img.error);
      if (kind === "photo") {
        setMediaType("photo");
        setMediaLink(img.url);
        setBasePhoto(img.url);
        if (aiMedia.autoBrand && head.trim()) {
          setMediaBusy(t("Diseñando con tu marca…", "Designing with your brand…"));
          onBrand?.();
          const d = await aiMedia.design(img.url, head, shape, template, theSteps);
          if (d.ok) setMediaLink(d.url);
          else setMediaError(d.error);
        }
        return;
      }
      setMediaBusy(t("Creando el video… tarda de 1 a 3 minutos, no cierres esta página", "Creating the video… it takes 1 to 3 minutes, don't close this page"));
      const start = await aiMedia.videoStart(img.url, "");
      if (!start.ok) return setMediaError(start.error);
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 6000));
        const r = await aiMedia.videoCheck(start.job);
        if (!r.ok) return setMediaError(r.error);
        if (r.done) {
          setMediaType("video");
          setMediaLink(r.url);
          return;
        }
      }
      setMediaError(t("El video está tardando demasiado. Intenta de nuevo más tarde.", "The video is taking too long. Try again later."));
    } catch (e) {
      setMediaError(errorText(e, uiLang));
    } finally {
      setMediaBusy("");
    }
  }

  async function runAi(theIdea = idea): Promise<AiPost | null> {
    if (!aiWrite) return null;
    setAiBusy(true);
    setAiError("");
    try {
      const r = await aiWrite(theIdea, lang);
      if (!r.ok) {
        setAiError(r.error);
        return null;
      }
      const p = r.post;
      setText(p.facebook);
      setSubject(p.emailSubject);
      setSeoTitle(p.seoTitle);
      setImageIdea(p.imageIdea);
      setHeadline(p.imageHeadline);
      setSteps(p.imageSteps ?? []);
      setVariants({ facebook: p.facebook, instagram: p.instagram, tiktok: p.tiktok, google: p.google, sms: p.sms, email: p.email });
      return p;
    } catch (e) {
      setAiError(errorText(e, uiLang));
      return null;
    } finally {
      setAiBusy(false);
    }
  }

  /** Modo mágico: la IA escribe para cada red, crea la foto y le pone la marca. Tú solo revisas y publicas. */
  async function runMagic(theIdea = idea) {
    if (!aiWrite || !theIdea.trim()) return;
    setMagicStep(0);
    const p = await runAi(theIdea);
    if (!p) return setMagicStep(-1);
    if (aiMedia && p.imageIdea.trim()) {
      setMagicStep(1);
      await runMedia("photo", p.imageIdea, p.imageHeadline, () => setMagicStep(2), p.imageSteps ?? []);
    }
    setMagicStep(3);
  }

  useEffect(() => {
    if (autoMagic && initialIdea.trim() && !magicStarted.current) {
      magicStarted.current = true;
      void runMagic(initialIdea);
    }
    // Solo una vez, al abrir la página desde el Inicio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onFile(f: File | undefined) {
    setFileUrl(f ? URL.createObjectURL(f) : "");
    setUploadError("");
    if (!f || !upload) return;
    setUploading(true);
    try {
      const { uploadUrl, publicUrl } = await upload(f.type);
      const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": f.type }, body: f });
      if (!res.ok) throw new Error(await res.text());
      setMediaLink(publicUrl);
      if (f.type.startsWith("image/")) setBasePhoto(publicUrl);
    } catch (e) {
      setUploadError(`${t("No se pudo subir el archivo", "Couldn't upload the file")}: ${errorText(e, uiLang)}`);
      setMediaLink("");
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  const draft: Draft = { text, subject, seoTitle, mediaType };
  const textFor = (id: ChannelId) => variants[id]?.trim() || text;
  const draftFor = (id: ChannelId): Draft => ({ ...draft, text: textFor(id) });
  const channels = CHANNELS.map((c) => channelText(c, uiLang));
  const selected = channels.filter((c) => on.has(c.id));
  const pv = selected.find((c) => c.id === preview) ?? selected[0];
  const ready = selected.filter((c) => !isBlocked(c.id, draftFor(c.id))).length;
  const scheduledIso = useMemo(() => (localDate ? new Date(localDate).toISOString() : ""), [localDate]);
  const cant = uploading || !!mediaBusy || !selected.length || !text.trim() || (when === "later" && !scheduledIso);
  const n = selected.length;
  const label = when === "later"
    ? t(`Programar en ${n} ${n === 1 ? "canal" : "canales"}`, `Schedule on ${n} ${n === 1 ? "channel" : "channels"}`)
    : t(`Publicar en ${n} ${n === 1 ? "canal" : "canales"}`, `Publish on ${n} ${n === 1 ? "channel" : "channels"}`);
  const mediaSrc = fileUrl || mediaLink;

  const toggle = (id: ChannelId) =>
    setOn((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  let head = "";
  let headLabel = "";
  const pvText = pv ? textFor(pv.id) : text;
  const placeholderBody = t("Tu mensaje aparecerá aquí.", "Your message will appear here.");
  let body = pvText || placeholderBody;
  // El pie del SMS (SMS_FOOTER) va tal cual se envía a los clientes.
  if (pv?.id === "sms") body = smsBody(pvText || placeholderBody);
  if (pv?.id === "seo") {
    head = seoTitle || t("[Título del artículo]", "[Article title]");
    headLabel = t("Artículo en tu sitio (se redacta en español e inglés)", "Article on your website (written in Spanish and English)");
  }
  if (pv?.id === "email") { head = subject || t("[Asunto del email]", "[Email subject]"); headLabel = t("Asunto", "Subject"); }

  return (
    <form action={action} className="grid-2">
      <section className="card" aria-labelledby="h-msg">
        <input type="hidden" name="variants" value={JSON.stringify(variants)} />
        <input type="hidden" name="source" value={Object.keys(variants).length ? "ai" : "manual"} />
        {aiWrite && (
          <div className={aiBusy || magicStep >= 0 && magicStep < 3 ? "ai-box glow busy" : "ai-box glow"}>
            <label htmlFor="idea" className="lbl ai-title">✦ {t("Crea con IA", "Create with AI")}</label>
            <textarea id="idea" className="field" rows={2} style={{ minHeight: 64 }} placeholder={t(
                "¿Sobre qué quieres publicar? Ej.: qué hacer si se filtra el techo después de una tormenta en Miami",
                "What do you want to post about? E.g., what to do if your roof leaks after a storm in Miami",
              )} value={idea} onChange={(e) => setIdea(e.target.value)} />
            <div className="row">
              <label htmlFor="lang" className="sr-only">{t("Idioma", "Language")}</label>
              <select id="lang" className="field" style={{ width: "auto" }} value={lang} onChange={(e) => setLang(e.target.value)}>
                <option value="es">{t("Español", "Spanish")}</option>
                <option value="en">English</option>
                <option value="both">{t("Español + English", "Spanish + English")}</option>
              </select>
              {aiMedia && (
                <button type="button" className="btn ai" disabled={aiBusy || !!mediaBusy || !idea.trim()} onClick={() => runMagic()}>
                  ✦ {t("Hacer todo con IA", "Do it all with AI")}
                </button>
              )}
              <button type="button" className={aiMedia ? "btn" : "btn ai"} disabled={aiBusy || !!mediaBusy || !idea.trim()} onClick={() => runAi()}>
                {aiBusy && magicStep < 0 ? t("Escribiendo…", "Writing…") : aiMedia ? t("Solo el texto", "Just the text") : t("Escribir publicación", "Write post")}
              </button>
            </div>
            {magicStep >= 0 && (
              <ol className="magic-steps" aria-live="polite">
                {MAGIC_STEPS.map(([es, en], i) => {
                  if (i > 0 && i < 3 && !aiMedia) return null;
                  const state = i < magicStep || magicStep === 3 ? "done" : i === magicStep ? "now" : "next";
                  return <li key={es} className={state}>{t(es, en)}</li>;
                })}
              </ol>
            )}
            {magicStep < 0 && (
              <p className="small muted">
                {aiMedia
                  ? t("La IA escribe una versión para cada red, crea la foto y le pone tu marca. Tú revisas y publicas.", "AI writes a version for each network, creates the photo, and adds your brand. You review and publish.")
                  : t("La IA escribe una versión para cada red. Tú revisas y publicas.", "AI writes a version for each network. You review and publish.")}
              </p>
            )}
            {aiError && <p className="note error" role="alert">{aiError}</p>}
            {imageIdea && !aiMedia && <p className="small"><strong>{t("Idea de foto:", "Photo idea:")}</strong> {imageIdea}</p>}
          </div>
        )}
        <div className="stack">
          <label id="h-msg" htmlFor="text" className="lbl">{t("Tu mensaje", "Your message")}</label>
          <textarea id="text" name="text" className="field" rows={6} required placeholder={t("¿Qué quieres decirle a tus clientes hoy?", "What do you want to tell your customers today?")} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row between small muted"><span>{t("Un solo texto para todos los canales", "One text for all channels")}</span><span>{text.length.toLocaleString(intlLocale(uiLang))} {t("caracteres", "characters")}</span></div>
        </div>

        <div className="stack">
          <div className="lbl">{t("Foto o video", "Photo or video")}</div>
          {aiMedia && (
            <div className="ai-box">
              <label htmlFor="imageIdea" className="lbl ai-title">✦ {t("Crear foto o video con IA", "Create a photo or video with AI")}</label>
              <textarea id="imageIdea" className="field" rows={2} style={{ minHeight: 64 }} placeholder={t("Describe la imagen. Ej.: casa en Miami con el techo reparado, día soleado", "Describe the image. E.g., a house in Miami with a repaired roof, sunny day")} value={imageIdea} onChange={(e) => setImageIdea(e.target.value)} />
              <div className="row">
                <button type="button" className="btn on" disabled={!!mediaBusy || !imageIdea.trim()} onClick={() => runMedia("photo")}>{t("Crear foto", "Create photo")}</button>
                {aiMedia.video && <button type="button" className="btn outline" disabled={!!mediaBusy || !imageIdea.trim()} onClick={() => runMedia("video")}>{t("Crear video (5 seg)", "Create video (5 sec)")}</button>}
              </div>
              {mediaBusy && <p className="small muted" role="status">{mediaBusy}</p>}
              {mediaError && <p className="note error" role="alert">{mediaError}</p>}
            </div>
          )}
          {aiMedia && mediaType === "photo" && (basePhoto || /^https:\/\//.test(mediaLink)) && (
            <div className="stack" style={{ gap: 10, padding: 16, borderRadius: 12, border: "1.5px solid var(--line)" }}>
              <div className="lbl">✦ {t("Diseño con tu marca", "Design with your brand")}</div>
              <p className="small muted">{t("Pone tu logo, tu color, un titular y tu teléfono sobre la foto, con letras perfectas.", "Puts your logo, your color, a headline, and your phone number on the photo, with perfect lettering.")}</p>
              <label htmlFor="headline" className="small" style={{ fontWeight: 600 }}>{t("Titular en la foto", "Headline on the photo")}</label>
              <input id="headline" className="field" maxLength={80} placeholder={t("Ej.: ¿Daños en tu techo después de la tormenta?", "E.g., Roof damage after the storm?")} value={headline} onChange={(e) => setHeadline(e.target.value)} />
              <div className="row">
                <label htmlFor="template" className="sr-only">{t("Plantilla", "Template")}</label>
                <select id="template" className="field" style={{ width: "auto" }} value={template} onChange={(e) => setTemplate(Number(e.target.value))}>
                  <option value={-1}>✦ {t("La IA elige la plantilla", "AI picks the template")}</option>
                  {aiMedia.templates.map((t, i) => <option key={i} value={i}>{t.name}</option>)}
                </select>
                <label htmlFor="shape" className="sr-only">{t("Tamaño", "Size")}</label>
                <select id="shape" className="field" style={{ width: "auto" }} value={shape} onChange={(e) => setShape(e.target.value)}>
                  <option value="square">{t("Cuadrado · Facebook e Instagram", "Square · Facebook and Instagram")}</option>
                  <option value="portrait">{t("Vertical 4:5 · Instagram", "Portrait 4:5 · Instagram")}</option>
                  <option value="story">{t("Historia / Reel 9:16", "Story / Reel 9:16")}</option>
                </select>
                <button type="button" className="btn on" disabled={!!mediaBusy || !headline.trim()} onClick={() => runDesign(basePhoto || mediaLink)}>{t("Diseñar", "Design")}</button>
              </div>
              {(template === -1 ? steps.length > 0 : aiMedia.templates[template]?.list) && (
                <div className="stack" style={{ gap: 6 }}>
                  <label htmlFor="steps" className="small" style={{ fontWeight: 600 }}>{t("Pasos para la plantilla de lista (uno por línea, máximo 3)", "Steps for the list template (one per line, 3 max)")}</label>
                  <textarea id="steps" className="field" style={{ minHeight: 84 }} value={steps.join("\n")} onChange={(e) => setSteps(e.target.value.split("\n").slice(0, 3))} />
                </div>
              )}
              <div className="row">
                {basePhoto && mediaLink !== basePhoto && (
                  <button type="button" className="btn link" onClick={() => setMediaLink(basePhoto)}>{t("Usar la foto sin diseño", "Use the photo without the design")}</button>
                )}
              </div>
            </div>
          )}
          <input type="hidden" name="mediaType" value={mediaType} />
          <div className="row" role="group" aria-label={t("Tipo de archivo", "File type")}>
            {([["none", t("Sin archivo", "No file")], ["photo", t("Foto", "Photo")], ["video", t("Video", "Video")]] as const).map(([v, l]) => (
              <button key={v} type="button" className={mediaType === v ? "btn on" : "btn"} aria-pressed={mediaType === v} onClick={() => { setMediaType(v); setFileUrl(""); }}>{l}</button>
            ))}
          </div>
          {mediaType !== "none" && (
            <div className="stack" style={{ padding: 14, border: "1.5px dashed #94a3b8", borderRadius: 10 }}>
              <label htmlFor="file" className="small" style={{ fontWeight: 500 }}>{t("Sube el archivo desde tu computadora o celular", "Upload the file from your computer or phone")}</label>
              <input
                id="file"
                name={upload ? undefined : "file"}
                type="file"
                accept={mediaType === "video" ? "video/mp4,video/quicktime,video/webm" : "image/jpeg,image/png,image/webp,image/gif"}
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              {uploading && <p className="small muted" role="status">{t("Subiendo archivo…", "Uploading file…")}</p>}
              {uploadError && <p className="note error" role="alert">{uploadError}</p>}
              <label htmlFor="mediaLink" className="small muted">{t("o pega un enlace público al archivo", "or paste a public link to the file")}</label>
              <input id="mediaLink" name="mediaLink" type="url" className="field" placeholder="https://…" value={mediaLink} onChange={(e) => setMediaLink(e.target.value)} />
            </div>
          )}
        </div>

        <fieldset style={{ border: 0, margin: 0, padding: 0 }} className="stack">
          <legend className="lbl" style={{ padding: 0, marginBottom: 10 }}>{t("¿Dónde se publica?", "Where does it go?")}</legend>
          <div className="chips">
            {channels.map((c) => {
              const isConnected = connected.includes(c.id);
              const checked = on.has(c.id);
              return (
                <label key={c.id} className={!isConnected ? "chip off" : checked ? "chip on" : "chip"}>
                  <input type="checkbox" name="channels" value={c.id} checked={checked} disabled={!isConnected} onChange={() => toggle(c.id)} />
                  <span className="mono">{c.mono}</span>
                  <span className="stack" style={{ gap: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                    <span className="sub">
                      {!isConnected ? t("Sin conectar", "Not connected")
                        : c.id === "email" ? t(`${contactCounts.email} contactos`, `${contactCounts.email} contacts`)
                        : c.id === "sms" ? t(`${contactCounts.sms} contactos`, `${contactCounts.sms} contacts`)
                        : c.kind}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {connected.length < CHANNELS.length && (
            <p className="small muted">
              {t("Los canales en gris no están conectados.", "Grayed-out channels aren't connected.")}{" "}
              <Link href={`/b/${businessId}/conexiones`}>{t("Conectar canales", "Connect channels")}</Link>
            </p>
          )}
        </fieldset>

        {(on.has("email") || on.has("seo")) && (
          <div className="stack" style={{ gap: 14, padding: 16, borderRadius: 10, background: "var(--ground)" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{t("Datos extra para algunos canales", "Extra details for some channels")}</div>
            {on.has("email") && (
              <div className="stack">
                <label htmlFor="subject" className="small" style={{ fontWeight: 500 }}>{t("Asunto del email", "Email subject")}</label>
                <input id="subject" name="subject" className="field" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("Ej.: Lo que debes saber antes de reclamar a tu seguro", "E.g., What to know before filing an insurance claim")} />
              </div>
            )}
            {on.has("seo") && (
              <div className="stack">
                <label htmlFor="seoTitle" className="small" style={{ fontWeight: 500 }}>{t("Título del artículo para tu sitio (en español)", "Article title for your website (in Spanish)")}</label>
                <input id="seoTitle" name="seoTitle" className="field" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder={t("Ej.: Ajustador público en [tu ciudad]", "E.g., Ajustador público en [your city]")} />
              </div>
            )}
          </div>
        )}

        <div className="stack">
          <div className="lbl">{t("¿Cuándo?", "When?")}</div>
          <input type="hidden" name="when" value={when} />
          <input type="hidden" name="scheduledAt" value={scheduledIso} />
          <div className="row" role="group" aria-label={t("Cuándo publicar", "When to publish")}>
            <button type="button" className={when === "now" ? "btn on" : "btn"} aria-pressed={when === "now"} onClick={() => setWhen("now")}>{t("Ahora mismo", "Right now")}</button>
            <button type="button" className={when === "later" ? "btn on" : "btn"} aria-pressed={when === "later"} onClick={() => setWhen("later")}>{t("Programar", "Schedule")}</button>
            {when === "later" && (
              <>
                <label htmlFor="when" className="sr-only">{t("Fecha y hora", "Date and time")}</label>
                <input id="when" type="datetime-local" className="field" style={{ width: "auto" }} value={localDate} onChange={(e) => setLocalDate(e.target.value)} />
              </>
            )}
          </div>
        </div>

        <div className="row" style={{ borderTop: "1px solid var(--line)", paddingTop: 16, gap: 16 }}>
          <SubmitButton disabled={cant} label={uploading ? t("Esperando a que suba el archivo…", "Waiting for the file to upload…") : label} />
          <span className="small muted">{!text.trim() ? t("Escribe tu mensaje para empezar", "Write your message to get started") : t(`${ready} de ${n} listos`, `${ready} of ${n} ready`)}</span>
        </div>
      </section>

      <section className="card" aria-labelledby="h-prev">
        <div className="row between">
          <h2 id="h-prev">{t("Vista previa por canal", "Preview by channel")}</h2>
          <span className="small muted">{t("Así se verá en cada lugar", "How it will look in each place")}</span>
        </div>
        {!pv ? (
          <p className="empty">{t("Elige al menos un canal para ver la vista previa.", "Pick at least one channel to see the preview.")}</p>
        ) : (
          <>
            <div className="tabs" role="tablist" aria-label={t("Canales", "Channels")}>
              {selected.map((c) => (
                <button key={c.id} type="button" role="tab" aria-selected={c.id === pv.id} className={c.id === pv.id ? "tab on" : "tab"} onClick={() => setPreview(c.id)}>{c.name}</button>
              ))}
            </div>
            <div className="preview">
              <div className="preview-head">
                <span className="avatar" style={{ background: color }}>{businessName.trim().charAt(0).toUpperCase()}</span>
                <div>
                  <div style={{ fontWeight: 600 }}>{businessName}</div>
                  <div className="small muted">{pv.kind} · {pv.name}</div>
                </div>
              </div>
              {head && (
                <div style={{ padding: "14px 16px 0" }}>
                  <div className="small muted" style={{ fontWeight: 500 }}>{headLabel}</div>
                  <div style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 700 }}>{head}</div>
                  {pv.id === "seo" && <div className="small muted" style={{ marginTop: 4 }}>{t(
                    "Claude ordena tu texto en secciones, lo traduce al inglés y elige una foto de tu sitio. No agrega datos que no escribiste.",
                    "Claude organizes your text into sections, translates it into English, and picks a photo from your website. It doesn't add facts you didn't write.",
                  )}</div>}
                </div>
              )}
              {mediaType !== "none" && pv.id !== "sms" && (
                <div className="preview-media">
                  {mediaSrc ? (
                    mediaType === "video" ? <video src={mediaSrc} controls muted /> : (
                      // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) o enlace externo
                      <img src={mediaSrc} alt={t("Vista previa del archivo", "File preview")} />
                    )
                  ) : (
                    <span>{mediaType === "video" ? t("Tu video", "Your video") : t("Tu foto", "Your photo")}</span>
                  )}
                </div>
              )}
              <div className="preview-body">{body}</div>
            </div>
            {variants[pv.id] !== undefined && (
              <div className="stack">
                <label htmlFor="variant" className="small" style={{ fontWeight: 600 }}>{t(`Texto solo para ${pv.name}`, `Text just for ${pv.name}`)}</label>
                <textarea
                  id="variant"
                  className="field"
                  rows={5}
                  value={variants[pv.id]}
                  onChange={(e) => setVariants((v) => ({ ...v, [pv.id]: e.target.value }))}
                />
              </div>
            )}
            <div className="stack">
              {notesFor(pv.id, draftFor(pv.id), uiLang).filter((x) => x.id !== "empty").map((x) => (
                <p key={x.id} className="note">{x.text}</p>
              ))}
            </div>
            <div className="stack" style={{ gap: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{t("Estado de cada canal", "Status of each channel")}</div>
              {selected.map((c) => {
                const bad = isBlocked(c.id, draftFor(c.id));
                return (
                  <div key={c.id} className="target">
                    <span>{c.name}</span>
                    <span className={!text.trim() ? "pill" : bad ? "pill partial" : "pill sent"}>{!text.trim() ? t("Esperando mensaje", "Waiting for message") : bad ? t("Revisar", "Check") : t("Listo", "Ready")}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </form>
  );
}
