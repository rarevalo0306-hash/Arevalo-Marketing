"use client";

import Link from "next/link";
import type { AiWriteResult, MediaResult, VideoCheck, VideoStart } from "@/app/actions";
import type { MoreIdeasResult } from "@/app/actions-ideas";
import type { LibraryMediaResult } from "@/app/actions-library";
import type { AiPostOut } from "@/lib/ai";
import type { VideoJob } from "@/lib/fal";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { MediaStep } from "@/components/ComposerMedia";
import { useT } from "@/components/I18n";
import { IdeaList } from "@/components/IdeaList";
import s from "./Composer.module.css";
import { joinBilingual } from "@/lib/bilingual";
import type { ContentIdea, IdeasBasis } from "@/lib/content-ideas";
import type { LibraryCard } from "@/lib/library-match";
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
  aiWrite: ((idea: string, lang: string, opts?: { bilingual?: boolean }) => Promise<AiWriteResult>) | null;
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
  /** Ideas de hoy según el SEO del negocio (la primera es la mejor). */
  ideas?: ContentIdea[];
  ideasBasis?: IdeasBasis;
  /** "✦ Más ideas con IA". */
  moreIdeas?: (() => Promise<MoreIdeasResult>) | null;
  /** El negocio atiende en español e inglés: Facebook e Instagram salen en los dos idiomas (se puede apagar). */
  bilingual?: boolean;
  /** «Tus fotos»: fotos y videos reales del negocio (su carpeta de Drive). */
  library?: {
    list: () => Promise<LibraryCard[]>;
    /** La dirección del archivo para la publicación (los videos se traen de Drive en ese momento). */
    media: (itemId: string) => Promise<LibraryMediaResult>;
    /** Modo mágico: la foto real que va con el texto, o null (entonces la IA crea una). */
    photoFor: (text: string, keywords: string[]) => Promise<{ id: string; url: string } | null>;
    manageHref: string;
  } | null;
  /** Foto o video ya elegido al abrir (desde «Tus fotos» → «Crear publicación con esta foto»). */
  initialMedia?: { url: string; type: "photo" | "video" } | { error: string } | null;
};

/** Las copias locales (/media/…) necesitan la dirección completa para publicarse y diseñarse. */
const absUrl = (u: string) => (u.startsWith("/") && typeof window !== "undefined" ? window.location.origin + u : u);

/** Pasos del modo mágico: [español, inglés]. */
const MAGIC_STEPS = [
  ["Escribiendo para cada red", "Writing for each network"],
  ["Eligiendo la foto", "Choosing the photo"],
  ["Poniendo tu marca", "Adding your brand"],
  ["Listo para revisar", "Ready to review"],
] as const;

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  const { t } = useT();
  return (
    <button type="submit" className={`primary ${s.submit}`} disabled={disabled || pending}>
      {pending ? t("Publicando… no cierres esta página", "Publishing… don't close this page") : label}
    </button>
  );
}

/** Título de cada paso con su número. */
function StepHead({ n, id, title, sub }: { n: number; id: string; title: string; sub?: string }) {
  return (
    <div className={s.stepHead}>
      <span className={s.num} aria-hidden="true">{n}</span>
      <div className={s.stepHeadText}>
        <h2 id={id} className={s.stepTitle}>{title}</h2>
        {sub && <p className={s.stepSub}>{sub}</p>}
      </div>
    </div>
  );
}

export function Composer({
  businessId,
  businessName,
  color,
  connected,
  contactCounts,
  action,
  upload,
  aiWrite,
  aiMedia,
  initialIdea = "",
  autoMagic = false,
  ideas = [],
  ideasBasis = "season",
  moreIdeas = null,
  bilingual = false,
  library = null,
  initialMedia = null,
}: Props) {
  const { lang: uiLang, t } = useT();
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [mediaType, setMediaType] = useState<MediaType>("none");
  const [fileUrl, setFileUrl] = useState("");
  const [mediaLink, setMediaLink] = useState("");
  // Email solo si el negocio tiene contactos que aceptaron recibirlo, y nunca marcado de entrada.
  const [on, setOn] = useState<Set<ChannelId>>(() => new Set(connected.filter((c) => c !== "email")));
  const [preview, setPreview] = useState<ChannelId | null>(null);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [localDate, setLocalDate] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [variants, setVariants] = useState<Partial<Record<ChannelId, string>>>({});
  const [idea, setIdea] = useState(initialIdea);
  // La idea elegida de la lista (o la que eligió la IA sola con la caja vacía).
  const [pickedId, setPickedId] = useState("");
  const [autoPicked, setAutoPicked] = useState<ContentIdea | null>(null);
  // Paso del modo mágico (-1 = apagado).
  const [magicStep, setMagicStep] = useState(-1);
  const magicStarted = useRef(false);
  // Idioma en que escribe la IA (aparte del idioma de la app) y si Facebook e Instagram llevan los dos idiomas.
  const [lang, setLang] = useState<"es" | "en">("es");
  const [bi, setBi] = useState(bilingual);
  // Lo que escribió la IA para Facebook e Instagram: en el idioma principal y en el otro (para unirlos o no).
  const [aiSocial, setAiSocial] = useState<{ lang: "es" | "en"; facebook: string; instagram: string; facebookOther: string; instagramOther: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [imageIdea, setImageIdea] = useState("");
  const [mediaBusy, setMediaBusy] = useState("");
  // Mientras la IA hace un video: cuándo empezó y cuánto tarda normalmente ese modelo (barra de avance honesta).
  const [videoJob, setVideoJob] = useState<{ startedAt: number; etaSec: number } | null>(null);
  const [mediaError, setMediaError] = useState("");
  // Foto original (sin diseño), para poder volver a diseñarla con otro titular o tamaño.
  const [basePhoto, setBasePhoto] = useState("");
  const [headline, setHeadline] = useState("");
  const [shape, setShape] = useState("square");
  const [template, setTemplate] = useState(-1);
  const [steps, setSteps] = useState<string[]>([]);
  const [libError, setLibError] = useState("");
  // Lo último elegido como foto (el modo mágico lo lee después de esperar a la IA).
  const mediaLinkRef = useRef("");
  const fileUrlRef = useRef("");
  mediaLinkRef.current = mediaLink;
  fileUrlRef.current = fileUrl;
  // Con IA, primero se ve solo el paso de la idea. El resto aparece al elegir un camino.
  const [started, setStarted] = useState(false);
  // Volver a abrir el paso de la idea después de empezar (para cambiarla o usar la IA otra vez).
  const [boxOpen, setBoxOpen] = useState(false);

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
      setMediaBusy(t("Creando el video… no cierres esta página", "Creating the video… don't close this page"));
      const start = await aiMedia.videoStart(img.url, "");
      if (!start.ok) return setMediaError(start.error);
      setVideoJob({ startedAt: start.job.startedAt ?? Date.now(), etaSec: start.job.etaSec ?? 120 });
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
      setVideoJob(null);
    }
  }

  /** Facebook e Instagram: el texto principal y, si está encendido "en español e inglés", la otra versión debajo. */
  function socialVariants(p: { facebook: string; instagram: string; facebookOther?: string; instagramOther?: string }, both: boolean, main: "es" | "en") {
    return {
      facebook: both ? joinBilingual(p.facebook, p.facebookOther ?? "", main) : p.facebook,
      instagram: both ? joinBilingual(p.instagram, p.instagramOther ?? "", main) : p.instagram,
    };
  }

  async function runAi(theIdea = idea): Promise<AiPostOut | null> {
    if (!aiWrite) return null;
    setAiBusy(true);
    setAiError("");
    try {
      const r = await aiWrite(theIdea, lang, { bilingual: bi });
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
      setAiSocial({ lang, facebook: p.facebook, instagram: p.instagram, facebookOther: p.facebookOther ?? "", instagramOther: p.instagramOther ?? "" });
      setVariants({ ...socialVariants(p, bi, lang), tiktok: p.tiktok, google: p.google, sms: p.sms, email: p.email });
      setStarted(true);
      setBoxOpen(false);
      return p;
    } catch (e) {
      setAiError(errorText(e, uiLang));
      return null;
    } finally {
      setAiBusy(false);
    }
  }

  /** Encender o apagar "en español e inglés" después de que la IA escribió: se unen o se separan los textos. */
  function toggleBi(next: boolean) {
    setBi(next);
    if (aiSocial && (aiSocial.facebookOther || aiSocial.instagramOther)) setVariants((v) => ({ ...v, ...socialVariants(aiSocial, next, aiSocial.lang) }));
  }

  /** Modo mágico: la IA escribe para cada red, crea la foto y le pone la marca. Tú solo revisas y publicas. */
  async function runMagic(theIdea = idea) {
    if (!aiWrite || !theIdea.trim()) return;
    setMagicStep(0);
    const p = await runAi(theIdea);
    if (!p) return setMagicStep(-1);
    // Si ya elegiste una foto de «Tus fotos», se queda esa.
    const hasMedia = !!(mediaLinkRef.current || fileUrlRef.current);
    if (!hasMedia && (aiMedia || library) && p.imageIdea.trim()) {
      setMagicStep(1);
      // Primero una foto real de «Tus fotos» que vaya con el tema; si no hay, la IA crea una.
      const real = library ? await library.photoFor([p.imageHeadline, p.imageIdea, p.seoTitle, p.google].join("\n"), [p.imageHeadline]).catch(() => null) : null;
      if (real) {
        const url = absUrl(real.url);
        setFileUrl("");
        setMediaType("photo");
        setMediaLink(url);
        setBasePhoto(url);
        if (aiMedia?.autoBrand && p.imageHeadline.trim()) {
          setMagicStep(2);
          setMediaBusy(t("Diseñando con tu marca…", "Designing with your brand…"));
          try {
            const d = await aiMedia.design(url, p.imageHeadline, shape, template, p.imageSteps ?? []);
            if (d.ok) setMediaLink(d.url);
            else setMediaError(d.error);
          } catch (e) {
            setMediaError(errorText(e, uiLang));
          } finally {
            setMediaBusy("");
          }
        }
      } else if (aiMedia) {
        await runMedia("photo", p.imageIdea, p.imageHeadline, () => setMagicStep(2), p.imageSteps ?? []);
      }
    }
    setMagicStep(3);
  }

  /** La idea para la IA: lo escrito o, con la caja vacía, la mejor idea de hoy (y se muestra cuál eligió). */
  function ideaForAi(): string {
    if (idea.trim()) return idea;
    const top = ideas[0];
    if (!top) {
      setAiError(t("Escribe qué quieres publicar.", "Write what you want to post."));
      document.getElementById("idea")?.focus();
      return "";
    }
    setIdea(top.idea);
    setPickedId(top.id);
    setAutoPicked(top);
    return top.idea;
  }

  function pick(x: ContentIdea) {
    setIdea(x.idea);
    setPickedId(x.id);
    setAutoPicked(null);
    if (aiError) setAiError("");
  }

  /** "Lo escribo yo": lo que escribiste pasa tal cual a "Tu mensaje", sin IA. */
  function keepOwnText() {
    if (idea.trim() && !pickedId) {
      setText(idea);
      // Sin versiones de la IA: se publica tu texto en todos los canales.
      setVariants({});
      setAiSocial(null);
    }
    setAiError("");
    setStarted(true);
    setBoxOpen(false);
  }

  useEffect(() => {
    if (autoMagic && !magicStarted.current) {
      const first = initialIdea.trim() || ideas[0]?.idea || "";
      if (!first) return;
      magicStarted.current = true;
      if (!initialIdea.trim() && ideas[0]) {
        setIdea(ideas[0].idea);
        setPickedId(ideas[0].id);
        setAutoPicked(ideas[0]);
      }
      void runMagic(first);
    }
    // Solo una vez, al abrir la página desde el Inicio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Foto o video que llega elegido desde «Tus fotos».
  useEffect(() => {
    if (!initialMedia) return;
    if ("error" in initialMedia) return setLibError(initialMedia.error);
    const url = absUrl(initialMedia.url);
    setMediaType(initialMedia.type);
    setMediaLink(url);
    if (initialMedia.type === "photo") setBasePhoto(url);
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Elegir de «Tus fotos»: la foto o el video pasa a ser el de la publicación. */
  async function pickFromLibrary(c: LibraryCard): Promise<string> {
    if (!library) return "";
    setMediaError("");
    setUploadError("");
    setLibError("");
    const r = await library.media(c.id);
    if (!r.ok) return r.error;
    const url = absUrl(r.url);
    setFileUrl("");
    setMediaType(r.type);
    setMediaLink(url);
    setBasePhoto(r.type === "photo" ? url : "");
    return "";
  }

  async function onFile(f: File | undefined) {
    setFileUrl(f ? URL.createObjectURL(f) : "");
    setUploadError("");
    setMediaError("");
    if (!f) return;
    setMediaType(f.type.startsWith("video/") ? "video" : "photo");
    setBasePhoto("");
    setMediaLink("");
    if (!upload) return;
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

  function clearMedia() {
    setFileUrl("");
    setMediaLink("");
    setBasePhoto("");
    setMediaType("none");
    setUploadError("");
  }

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  const draft: Draft = { text, subject, seoTitle, mediaType };
  const textFor = (id: ChannelId) => variants[id]?.trim() || text;
  const draftFor = (id: ChannelId): Draft => ({ ...draft, text: textFor(id) });
  // Email: se ve solo si hay contactos que aceptaron recibirlo.
  const channels = CHANNELS.filter((c) => c.id !== "email" || contactCounts.email > 0 || on.has("email")).map((c) => channelText(c, uiLang));
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
  const shownMedia: MediaType = mediaSrc ? mediaType : "none";

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
    headLabel = t("Artículo en tu página web (en español e inglés)", "Article on your website (in Spanish and English)");
  }
  if (pv?.id === "email") { head = subject || t("[Asunto del email]", "[Email subject]"); headLabel = t("Asunto", "Subject"); }

  const magicRunning = magicStep >= 0 && magicStep < 3;
  const busy = aiBusy || magicRunning;
  // Con IA: el paso de la idea se ve al principio, mientras la IA trabaja, o si lo vuelves a abrir.
  const showBox = !!aiWrite && (!started || boxOpen || busy);
  const showRest = !aiWrite || started;
  const fromAi = Object.keys(variants).length > 0;
  const photoIdea = imageIdea && !aiMedia && <p className="small"><strong>{t("Idea de foto:", "Photo idea:")}</strong> {imageIdea}</p>;
  // Números de los pasos: sin IA no hay paso de la idea.
  const first = aiWrite ? 1 : 0;
  const N = { idea: 1, text: first + 1, media: first + 2, where: first + 3, when: first + 4 };
  const otherLang = lang === "en" ? t("español", "Spanish") : t("inglés", "English");
  const biMissing = bi && fromAi && !!aiSocial && !aiSocial.facebookOther && !aiSocial.instagramOther;
  const showDesign = !!aiMedia && mediaType === "photo" && (!!basePhoto || /^https:\/\//.test(mediaLink));

  return (
    <form action={action} className={s.form}>
      <input type="hidden" name="variants" value={JSON.stringify(variants)} />
      <input type="hidden" name="source" value={fromAi ? "ai" : "manual"} />
      <input type="hidden" name="mediaType" value={shownMedia} />
      <input type="hidden" name="mediaLink" value={/^https?:\/\//i.test(mediaLink) ? mediaLink : ""} />

      {showBox && (
        <section className={busy ? `ai-box glow busy ${s.start}` : `ai-box glow ${s.start}`} aria-labelledby="h-idea">
          <StepHead n={N.idea} id="h-idea" title={t("¿Sobre qué publicamos?", "What should we post about?")} sub={t("Elige una idea o escribe la tuya. Si no eliges nada, la IA usa la mejor idea de hoy.", "Pick an idea or write your own. If you don't pick anything, AI uses today's best idea.")} />

          {initialMedia && "url" in initialMedia && mediaLink && (
            <p className="note ok">
              {initialMedia.type === "video"
                ? t("Tu video de «Tus fotos» ya está puesto en esta publicación. Ahora elige de qué se trata.", "Your video from «Your photos» is already in this post. Now choose what it's about.")
                : t("Tu foto de «Tus fotos» ya está puesta en esta publicación. Ahora elige de qué se trata.", "Your photo from «Your photos» is already in this post. Now choose what it's about.")}
            </p>
          )}
          {ideas.length > 0 && (
            <IdeaList ideas={ideas} basis={ideasBasis} variant="box" selected={pickedId} onPick={pick} more={moreIdeas} disabled={busy} seoHref={`/b/${businessId}/seo`} />
          )}

          <div className="stack">
            <label htmlFor="idea" className={s.ideaLbl}>{ideas.length ? t("o escribe tu idea (opcional)", "or write your idea (optional)") : t("Tu idea", "Your idea")}</label>
            <textarea
              id="idea"
              className={`field ${s.idea}`}
              rows={3}
              placeholder={t("Ej.: esta semana 10% de descuento para clientes nuevos", "E.g., 10% off for new customers this week")}
              value={idea}
              onChange={(e) => {
                setIdea(e.target.value);
                setPickedId("");
                setAutoPicked(null);
                if (aiError) setAiError("");
              }}
            />
          </div>

          <div className={s.opts}>
            <span className={s.lang}>
              <label htmlFor="lang">{t("La IA escribe en", "AI writes in")}</label>
              <select id="lang" className={`field ${s.langSelect}`} value={lang} onChange={(e) => setLang(e.target.value === "en" ? "en" : "es")}>
                <option value="es">{t("Español", "Spanish")}</option>
                <option value="en">English</option>
              </select>
            </span>
            <label className={s.toggle}>
              <input type="checkbox" checked={bi} onChange={(e) => toggleBi(e.target.checked)} />
              <span>
                <strong>{t("Publicar en español e inglés", "Post in Spanish and English")}</strong>
                <small>{t(`Facebook e Instagram llevan también la versión en ${otherLang}`, `Facebook and Instagram also get the ${otherLang} version`)}</small>
              </span>
            </label>
          </div>

          <div className={s.choices} role="group" aria-label={t("¿Cómo lo hacemos?", "How should we do it?")}>
            {aiMedia && (
              <button type="button" className={`btn ai ${s.choice} ${s.main}`} disabled={busy || !!mediaBusy} onClick={() => { const x = ideaForAi(); if (x) void runMagic(x); }}>
                <span>✦ {t("Que la IA lo haga todo", "Let AI do it all")}</span>
                <small>{t("Texto para cada red, foto y tu marca", "Text for each network, photo, and your brand")}</small>
              </button>
            )}
            <button type="button" className={aiMedia ? `btn ${s.choice}` : `btn ai ${s.choice} ${s.main}`} disabled={busy || !!mediaBusy} onClick={() => { const x = ideaForAi(); if (!x) return; setMagicStep(-1); void runAi(x); }}>
              <span>✦ {aiBusy && magicStep < 0 ? t("Escribiendo…", "Writing…") : aiMedia ? t("Solo el texto", "Just the text") : t("Que la IA escriba el texto", "Let AI write the text")}</span>
              <small>{t("Una versión para cada red, sin foto", "A version for each network, no photo")}</small>
            </button>
            <button type="button" className={`btn ${s.choice} ${s.own}`} disabled={busy} onClick={() => { setMagicStep(-1); keepOwnText(); }}>
              <span>{idea.trim() && !pickedId ? t("Usar mi texto tal cual", "Use my text as is") : t("Lo escribo yo", "I'll write it myself")}</span>
              <small>{t("Sin IA: pasas directo a escribir", "No AI: go straight to writing")}</small>
            </button>
          </div>

          {autoPicked && (
            <p className={s.picked} role="status">
              ✦ {t("La IA eligió la idea de hoy:", "AI picked today's idea:")} <strong>{autoPicked.topic}</strong> <span>· {autoPicked.why}</span>
            </p>
          )}
          {magicStep >= 0 && (
            <ol className="magic-steps" aria-live="polite">
              {MAGIC_STEPS.map(([es, en], i) => {
                if (i > 0 && i < 3 && !aiMedia) return null;
                const state = i < magicStep || magicStep === 3 ? "done" : i === magicStep ? "now" : "next";
                return <li key={es} className={state}>{t(es, en)}</li>;
              })}
            </ol>
          )}
          {aiBusy && magicStep < 0 && <p className="small muted" role="status">{t("La IA está escribiendo una versión para cada red…", "AI is writing a version for each network…")}</p>}
          {aiError && <p className="note error" role="alert">{aiError}</p>}
          {photoIdea}
          {started && !busy && (
            <div className="row">
              <button type="button" className="btn link" onClick={() => setBoxOpen(false)}>{t("Cancelar, seguir con lo que tenía", "Cancel, keep what I had")}</button>
            </div>
          )}
        </section>
      )}

      {aiWrite && !showBox && (
        <div className={s.bar}>
          <span className={`${s.num} ${s.numDone}`} aria-hidden="true">✓</span>
          <div className={s.barText}>
            <span>
              {magicStep === 3
                ? aiMedia
                  ? t("Listo: la IA escribió para cada red y preparó la foto. Revisa y publica.", "Done: AI wrote for each network and made the photo. Check it and publish.")
                  : t("Listo: la IA escribió para cada red. Revisa y publica.", "Done: AI wrote for each network. Check it and publish.")
                : fromAi
                  ? t("La IA escribió una versión para cada red. Revisa y publica.", "AI wrote a version for each network. Check it and publish.")
                  : t("Usas tu propio texto. Revísalo y publica.", "You're using your own text. Check it and publish.")}
            </span>
            {idea.trim() && <span className={s.quote}>«{autoPicked?.topic ?? idea.trim()}»</span>}
          </div>
          <div className={s.barBtns}>
            <button type="button" className="btn" onClick={() => { setMagicStep(-1); setBoxOpen(true); }}>✦ {t("Cambiar la idea", "Change the idea")}</button>
          </div>
        </div>
      )}
      {aiWrite && !showBox && photoIdea}

      {showRest && (
        <div className={s.steps}>
          <section className={`card ${s.step} ${s.aText}`} aria-labelledby="h-msg">
            <StepHead n={N.text} id="h-msg" title={t("Tu mensaje", "Your message")} sub={fromAi ? t("La IA escribió una versión para cada red. Puedes cambiar cualquier palabra.", "AI wrote a version for each network. You can change any word.") : t("Un solo texto para todos los canales.", "One text for all channels.")} />
            <label htmlFor="text" className="sr-only">{t("Tu mensaje", "Your message")}</label>
            <textarea id="text" name="text" className="field" rows={6} required placeholder={t("¿Qué quieres decirle a tus clientes hoy?", "What do you want to tell your customers today?")} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="row between small muted">
              <span>{fromAi ? t("Cada red tiene su versión en la vista previa", "Each network has its version in the preview") : t("Se publica igual en todos", "Posted the same everywhere")}</span>
              <span>{text.length.toLocaleString(intlLocale(uiLang))} {t("caracteres", "characters")}</span>
            </div>
            {fromAi && bi && !biMissing && (on.has("facebook") || on.has("instagram")) && (
              <p className="note ok">{t(`Facebook e Instagram llevan tu mensaje y, debajo, la versión en ${otherLang}. Míralo en la vista previa.`, `Facebook and Instagram carry your message and, below it, the ${otherLang} version. See it in the preview.`)}</p>
            )}
            {biMissing && <p className="note">{t(`Para agregar la versión en ${otherLang}, pídele el texto otra vez a la IA («Cambiar la idea»).`, `To add the ${otherLang} version, ask AI for the text again ("Change the idea").`)}</p>}
          </section>

          <section className={`card ${s.step} ${s.aMedia}`} aria-labelledby="h-media">
            <StepHead n={N.media} id="h-media" title={t("Foto o video (opcional)", "Photo or video (optional)")} sub={t("Las publicaciones con foto llegan a más gente.", "Posts with a photo reach more people.")} />
            <MediaStep
              mediaType={shownMedia}
              mediaSrc={mediaSrc}
              mediaLink={mediaLink}
              setMediaLink={(v) => { setFileUrl(""); setBasePhoto(""); setMediaLink(v); }}
              setMediaType={setMediaType}
              fileInForm={!upload}
              onFile={onFile}
              uploading={uploading}
              uploadError={uploadError}
              clear={clearMedia}
              library={library ? { load: library.list, pick: pickFromLibrary, manageHref: library.manageHref, error: libError } : null}
              ai={
                aiMedia
                  ? {
                      video: aiMedia.video,
                      imageIdea,
                      setImageIdea,
                      busy: mediaBusy,
                      videoJob,
                      error: mediaError,
                      create: (kind) => void runMedia(kind),
                      design: showDesign
                        ? {
                            basePhoto,
                            showingDesign: !!basePhoto && mediaLink !== basePhoto,
                            headline,
                            setHeadline,
                            template,
                            setTemplate,
                            templates: aiMedia.templates,
                            shape,
                            setShape,
                            steps,
                            setSteps,
                            busy: !!mediaBusy,
                            run: () => void runDesign(basePhoto || mediaLink),
                            useOriginal: () => setMediaLink(basePhoto),
                          }
                        : null,
                    }
                  : null
              }
            />
          </section>

          <section className={`card ${s.step} ${s.aWhere}`} aria-labelledby="h-where">
            <StepHead n={N.where} id="h-where" title={t("¿Dónde se publica?", "Where does it go?")} />
            <fieldset className={s.fieldset}>
              <legend className="sr-only">{t("Canales", "Channels")}</legend>
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
            </fieldset>
            {connected.length < CHANNELS.length && (
              <p className="small muted">
                {t("Los canales en gris no están conectados.", "Grayed-out channels aren't connected.")}{" "}
                <Link href={`/b/${businessId}/conexiones`}>{t("Conectar canales", "Connect channels")}</Link>
              </p>
            )}
            {on.has("seo") && (
              <div className={s.extra}>
                <label htmlFor="seoTitle" className={s.extraLbl}>{t("Título del artículo para tu página web", "Article title for your website")}</label>
                <p className="small muted">{t("Tu página web publica un artículo con este título. La IA lo llena sola; puedes cambiarlo.", "Your website publishes an article with this title. AI fills it in; you can change it.")}</p>
                <input id="seoTitle" name="seoTitle" className="field" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder={t("Ej.: Cómo saber si tu techo tiene una filtración", "E.g., How to tell if your roof has a leak")} />
              </div>
            )}
            {on.has("email") && (
              <div className={s.extra}>
                <label htmlFor="subject" className={s.extraLbl}>{t("Asunto del email", "Email subject")}</label>
                <p className="small muted">{t("Lo primero que leen tus contactos en su bandeja de entrada.", "The first thing your contacts read in their inbox.")}</p>
                <input id="subject" name="subject" className="field" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("Ej.: Lo que debes saber antes de reclamar a tu seguro", "E.g., What to know before filing an insurance claim")} />
              </div>
            )}
          </section>

          <section className={`card ${s.step} ${s.aPreview}`} aria-labelledby="h-prev">
            <div className="row between">
              <h2 id="h-prev" className={s.stepTitle}>{t("Vista previa", "Preview")}</h2>
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
                        "La IA ordena tu texto en secciones, lo traduce al inglés y elige una foto de tu sitio. No agrega datos que no escribiste.",
                        "AI organizes your text into sections, translates it into English, and picks a photo from your website. It doesn't add facts you didn't write.",
                      )}</div>}
                    </div>
                  )}
                  {shownMedia !== "none" && pv.id !== "sms" && (
                    <div className="preview-media">
                      {shownMedia === "video" ? <video src={mediaSrc} controls muted /> : (
                        // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) o enlace externo
                        <img src={mediaSrc} alt={t("Vista previa del archivo", "File preview")} />
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
                {notesFor(pv.id, draftFor(pv.id), uiLang).filter((x) => x.id !== "empty").map((x) => (
                  <p key={x.id} className="note">{x.text}</p>
                ))}
              </>
            )}
          </section>

          <section className={`card ${s.step} ${s.aWhen}`} aria-labelledby="h-when">
            <StepHead n={N.when} id="h-when" title={t("¿Cuándo?", "When?")} />
            <input type="hidden" name="when" value={when} />
            <input type="hidden" name="scheduledAt" value={scheduledIso} />
            <div className={s.seg} role="group" aria-label={t("Cuándo publicar", "When to publish")}>
              <button type="button" className={when === "now" ? "btn on" : "btn"} aria-pressed={when === "now"} onClick={() => setWhen("now")}>{t("Ahora mismo", "Right now")}</button>
              <button type="button" className={when === "later" ? "btn on" : "btn"} aria-pressed={when === "later"} onClick={() => setWhen("later")}>{t("Programar", "Schedule")}</button>
            </div>
            {when === "later" && (
              <div className="stack">
                <label htmlFor="when" className="small" style={{ fontWeight: 600 }}>{t("Fecha y hora", "Date and time")}</label>
                <input id="when" type="datetime-local" className={`field ${s.date}`} value={localDate} onChange={(e) => setLocalDate(e.target.value)} />
              </div>
            )}
            {selected.length > 0 && (
              <ul className={s.status}>
                {selected.map((c) => {
                  const bad = isBlocked(c.id, draftFor(c.id));
                  return (
                    <li key={c.id}>
                      <span>{c.name}</span>
                      <span className={!text.trim() ? "pill" : bad ? "pill partial" : "pill sent"}>{!text.trim() ? t("Esperando mensaje", "Waiting for message") : bad ? t("Revisar", "Check") : t("Listo", "Ready")}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className={s.send}>
              <SubmitButton disabled={cant} label={uploading ? t("Esperando a que suba el archivo…", "Waiting for the file to upload…") : label} />
              <span className="small muted">
                {!selected.length ? t("Elige al menos un canal", "Pick at least one channel") : !text.trim() ? t("Escribe tu mensaje para empezar", "Write your message to get started") : t(`${ready} de ${n} listos`, `${ready} of ${n} ready`)}
              </span>
            </div>
          </section>
        </div>
      )}
    </form>
  );
}
