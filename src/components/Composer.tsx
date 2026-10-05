"use client";

import Link from "next/link";
import type { AiWriteResult } from "@/app/actions";
import { useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  CHANNELS,
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
};

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="primary" disabled={disabled || pending}>
      {pending ? "Publicando… no cierres esta página" : label}
    </button>
  );
}

export function Composer({ businessId, businessName, color, connected, contactCounts, action, upload, aiWrite }: Props) {
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
  const [idea, setIdea] = useState("");
  const [lang, setLang] = useState("es");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [imageIdea, setImageIdea] = useState("");

  async function runAi() {
    if (!aiWrite) return;
    setAiBusy(true);
    setAiError("");
    try {
      const r = await aiWrite(idea, lang);
      if (!r.ok) return setAiError(r.error);
      const p = r.post;
      setText(p.facebook);
      setSubject(p.emailSubject);
      setSeoTitle(p.seoTitle);
      setImageIdea(p.imageIdea);
      setVariants({ facebook: p.facebook, instagram: p.instagram, tiktok: p.tiktok, google: p.google, sms: p.sms, email: p.email });
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

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
    } catch (e) {
      setUploadError(`No se pudo subir el archivo: ${(e as Error).message}`);
      setMediaLink("");
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  const draft: Draft = { text, subject, seoTitle, mediaType };
  const textFor = (id: ChannelId) => variants[id]?.trim() || text;
  const draftFor = (id: ChannelId): Draft => ({ ...draft, text: textFor(id) });
  const selected = CHANNELS.filter((c) => on.has(c.id));
  const pv = selected.find((c) => c.id === preview) ?? selected[0];
  const ready = selected.filter((c) => !isBlocked(c.id, draftFor(c.id))).length;
  const scheduledIso = useMemo(() => (localDate ? new Date(localDate).toISOString() : ""), [localDate]);
  const cant = uploading || !selected.length || !text.trim() || (when === "later" && !scheduledIso);
  const n = selected.length;
  const label = `${when === "later" ? "Programar en" : "Publicar en"} ${n} ${n === 1 ? "canal" : "canales"}`;
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
  let body = pvText || "Tu mensaje aparecerá aquí.";
  if (pv?.id === "sms") body = smsBody(pvText || "Tu mensaje aparecerá aquí.");
  if (pv?.id === "seo") { head = seoTitle || "[Título del artículo]"; headLabel = "Artículo en tu sitio (se redacta en español e inglés)"; }
  if (pv?.id === "email") { head = subject || "[Asunto del email]"; headLabel = "Asunto"; }

  return (
    <form action={action} className="grid-2">
      <section className="card" aria-labelledby="h-msg">
        <input type="hidden" name="variants" value={JSON.stringify(variants)} />
        <input type="hidden" name="source" value={Object.keys(variants).length ? "ai" : "manual"} />
        {aiWrite && (
          <div className="stack" style={{ gap: 10, padding: 16, borderRadius: 10, background: "#e3eef9" }}>
            <label htmlFor="idea" className="lbl" style={{ color: "var(--brand)" }}>✦ Escribir con IA</label>
            <textarea id="idea" className="field" rows={2} style={{ minHeight: 64 }} placeholder="Ej.: qué hacer si se filtra el techo después de una tormenta en Miami" value={idea} onChange={(e) => setIdea(e.target.value)} />
            <div className="row">
              <label htmlFor="lang" className="sr-only">Idioma</label>
              <select id="lang" className="field" style={{ width: "auto" }} value={lang} onChange={(e) => setLang(e.target.value)}>
                <option value="es">Español</option>
                <option value="en">English</option>
                <option value="both">Español + English</option>
              </select>
              <button type="button" className="btn on" disabled={aiBusy || !idea.trim()} onClick={runAi}>
                {aiBusy ? "Escribiendo… (unos segundos)" : "Escribir publicación"}
              </button>
            </div>
            <p className="small muted">La IA escribe una versión para cada canal. Revísala antes de publicar; puedes cambiar cualquier texto.</p>
            {aiError && <p className="note error" role="alert">{aiError}</p>}
            {imageIdea && <p className="small"><strong>Idea de foto:</strong> {imageIdea}</p>}
          </div>
        )}
        <div className="stack">
          <label id="h-msg" htmlFor="text" className="lbl">Tu mensaje</label>
          <textarea id="text" name="text" className="field" rows={6} required placeholder="¿Qué quieres decirle a tus clientes hoy?" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row between small muted"><span>Un solo texto para todos los canales</span><span>{text.length.toLocaleString("es")} caracteres</span></div>
        </div>

        <div className="stack">
          <div className="lbl">Foto o video</div>
          <input type="hidden" name="mediaType" value={mediaType} />
          <div className="row" role="group" aria-label="Tipo de archivo">
            {([["none", "Sin archivo"], ["photo", "Foto"], ["video", "Video"]] as const).map(([v, l]) => (
              <button key={v} type="button" className={mediaType === v ? "btn on" : "btn"} aria-pressed={mediaType === v} onClick={() => { setMediaType(v); setFileUrl(""); }}>{l}</button>
            ))}
          </div>
          {mediaType !== "none" && (
            <div className="stack" style={{ padding: 14, border: "1.5px dashed #94a3b8", borderRadius: 10 }}>
              <label htmlFor="file" className="small" style={{ fontWeight: 500 }}>Sube el archivo desde tu computadora o celular</label>
              <input
                id="file"
                name={upload ? undefined : "file"}
                type="file"
                accept={mediaType === "video" ? "video/mp4,video/quicktime,video/webm" : "image/jpeg,image/png,image/webp,image/gif"}
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              {uploading && <p className="small muted" role="status">Subiendo archivo…</p>}
              {uploadError && <p className="note error" role="alert">{uploadError}</p>}
              <label htmlFor="mediaLink" className="small muted">o pega un enlace público al archivo</label>
              <input id="mediaLink" name="mediaLink" type="url" className="field" placeholder="https://…" value={mediaLink} onChange={(e) => setMediaLink(e.target.value)} />
            </div>
          )}
        </div>

        <fieldset style={{ border: 0, margin: 0, padding: 0 }} className="stack">
          <legend className="lbl" style={{ padding: 0, marginBottom: 10 }}>¿Dónde se publica?</legend>
          <div className="chips">
            {CHANNELS.map((c) => {
              const isConnected = connected.includes(c.id);
              const checked = on.has(c.id);
              return (
                <label key={c.id} className={!isConnected ? "chip off" : checked ? "chip on" : "chip"}>
                  <input type="checkbox" name="channels" value={c.id} checked={checked} disabled={!isConnected} onChange={() => toggle(c.id)} />
                  <span className="mono">{c.mono}</span>
                  <span className="stack" style={{ gap: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                    <span className="sub">
                      {!isConnected ? "Sin conectar"
                        : c.id === "email" ? `${contactCounts.email} contactos`
                        : c.id === "sms" ? `${contactCounts.sms} contactos`
                        : c.kind}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {connected.length < CHANNELS.length && (
            <p className="small muted">
              Los canales en gris no están conectados. <Link href={`/b/${businessId}/conexiones`}>Conectar canales</Link>
            </p>
          )}
        </fieldset>

        {(on.has("email") || on.has("seo")) && (
          <div className="stack" style={{ gap: 14, padding: 16, borderRadius: 10, background: "var(--ground)" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Datos extra para algunos canales</div>
            {on.has("email") && (
              <div className="stack">
                <label htmlFor="subject" className="small" style={{ fontWeight: 500 }}>Asunto del email</label>
                <input id="subject" name="subject" className="field" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ej.: Lo que debes saber antes de reclamar a tu seguro" />
              </div>
            )}
            {on.has("seo") && (
              <div className="stack">
                <label htmlFor="seoTitle" className="small" style={{ fontWeight: 500 }}>Título del artículo para tu sitio (en español)</label>
                <input id="seoTitle" name="seoTitle" className="field" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder="Ej.: Ajustador público en [tu ciudad]" />
              </div>
            )}
          </div>
        )}

        <div className="stack">
          <div className="lbl">¿Cuándo?</div>
          <input type="hidden" name="when" value={when} />
          <input type="hidden" name="scheduledAt" value={scheduledIso} />
          <div className="row" role="group" aria-label="Cuándo publicar">
            <button type="button" className={when === "now" ? "btn on" : "btn"} aria-pressed={when === "now"} onClick={() => setWhen("now")}>Ahora mismo</button>
            <button type="button" className={when === "later" ? "btn on" : "btn"} aria-pressed={when === "later"} onClick={() => setWhen("later")}>Programar</button>
            {when === "later" && (
              <>
                <label htmlFor="when" className="sr-only">Fecha y hora</label>
                <input id="when" type="datetime-local" className="field" style={{ width: "auto" }} value={localDate} onChange={(e) => setLocalDate(e.target.value)} />
              </>
            )}
          </div>
        </div>

        <div className="row" style={{ borderTop: "1px solid var(--line)", paddingTop: 16, gap: 16 }}>
          <SubmitButton disabled={cant} label={uploading ? "Esperando a que suba el archivo…" : label} />
          <span className="small muted">{!text.trim() ? "Escribe tu mensaje para empezar" : `${ready} de ${n} listos`}</span>
        </div>
      </section>

      <section className="card" aria-labelledby="h-prev">
        <div className="row between">
          <h2 id="h-prev">Vista previa por canal</h2>
          <span className="small muted">Así se verá en cada lugar</span>
        </div>
        {!pv ? (
          <p className="empty">Elige al menos un canal para ver la vista previa.</p>
        ) : (
          <>
            <div className="tabs" role="tablist" aria-label="Canales">
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
                  {pv.id === "seo" && <div className="small muted" style={{ marginTop: 4 }}>Claude ordena tu texto en secciones, lo traduce al inglés y elige una foto de tu sitio. No agrega datos que no escribiste.</div>}
                </div>
              )}
              {mediaType !== "none" && pv.id !== "sms" && (
                <div className="preview-media">
                  {mediaSrc ? (
                    mediaType === "video" ? <video src={mediaSrc} controls muted /> : (
                      // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) o enlace externo
                      <img src={mediaSrc} alt="Vista previa del archivo" />
                    )
                  ) : (
                    <span>{mediaType === "video" ? "Tu video" : "Tu foto"}</span>
                  )}
                </div>
              )}
              <div className="preview-body">{body}</div>
            </div>
            {variants[pv.id] !== undefined && (
              <div className="stack">
                <label htmlFor="variant" className="small" style={{ fontWeight: 600 }}>Texto solo para {pv.name}</label>
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
              {notesFor(pv.id, draftFor(pv.id)).filter((x) => x.text !== "Escribe tu mensaje.").map((x) => (
                <p key={x.text} className="note">{x.text}</p>
              ))}
            </div>
            <div className="stack" style={{ gap: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Estado de cada canal</div>
              {selected.map((c) => {
                const bad = isBlocked(c.id, draftFor(c.id));
                return (
                  <div key={c.id} className="target">
                    <span>{c.name}</span>
                    <span className={!text.trim() ? "pill" : bad ? "pill partial" : "pill sent"}>{!text.trim() ? "Esperando mensaje" : bad ? "Revisar" : "Listo"}</span>
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
