"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  CHANNELS,
  isBlocked,
  notesFor,
  seoDescription,
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
};

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="primary" disabled={disabled || pending}>
      {pending ? "Publicando… no cierres esta página" : label}
    </button>
  );
}

export function Composer({ businessId, businessName, color, connected, contactCounts, action }: Props) {
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

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  const draft: Draft = { text, subject, seoTitle, mediaType };
  const selected = CHANNELS.filter((c) => on.has(c.id));
  const pv = selected.find((c) => c.id === preview) ?? selected[0];
  const ready = selected.filter((c) => !isBlocked(c.id, draft)).length;
  const scheduledIso = useMemo(() => (localDate ? new Date(localDate).toISOString() : ""), [localDate]);
  const cant = !selected.length || !text.trim() || (when === "later" && !scheduledIso);
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
  let body = text || "Tu mensaje aparecerá aquí.";
  if (pv?.id === "sms") body = smsBody(text || "Tu mensaje aparecerá aquí.");
  if (pv?.id === "seo") { head = seoTitle || "[Título de la página]"; headLabel = "Artículo y resultado en Google"; }
  if (pv?.id === "email") { head = subject || "[Asunto del email]"; headLabel = "Asunto"; }

  return (
    <form action={action} className="grid-2">
      <section className="card" aria-labelledby="h-msg">
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
                name="file"
                type="file"
                accept={mediaType === "video" ? "video/mp4,video/quicktime,video/webm" : "image/jpeg,image/png,image/webp,image/gif"}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setFileUrl(f ? URL.createObjectURL(f) : "");
                }}
              />
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
                <label htmlFor="seoTitle" className="small" style={{ fontWeight: 500 }}>Título del artículo (para Google)</label>
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
          <SubmitButton disabled={cant} label={label} />
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
                  {pv.id === "seo" && <div className="small" style={{ color: "var(--teal-text)", marginTop: 4 }}>{seoDescription(text) || "Descripción para Google"}</div>}
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
            <div className="stack">
              {notesFor(pv.id, draft).filter((x) => x.text !== "Escribe tu mensaje.").map((x) => (
                <p key={x.text} className="note">{x.text}</p>
              ))}
            </div>
            <div className="stack" style={{ gap: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Estado de cada canal</div>
              {selected.map((c) => {
                const bad = isBlocked(c.id, draft);
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
