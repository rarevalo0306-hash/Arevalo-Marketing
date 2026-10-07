"use client";

// Subir una plantilla propia: la imagen del dueño + dónde van la foto y el titular, con vista previa en vivo.
import { useActionState, useEffect, useRef, useState, startTransition } from "react";
import type { CustomTemplateResult } from "@/app/actions-media";
import { useT } from "@/components/I18n";
import { PHOTO_BOXES, textBox, type CustomSpec } from "@/lib/design-shapes";
import s from "./TemplateUpload.module.css";

type Upload = (contentType: string) => Promise<{ uploadUrl: string; publicUrl: string }>;
type Save = (prev: CustomTemplateResult, f: FormData) => Promise<CustomTemplateResult>;

/** ¿La imagen tiene partes transparentes? (se mira en una copia pequeña). */
async function hasTransparency(src: string): Promise<boolean> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = Math.max(1, Math.round((64 * img.naturalHeight) / img.naturalWidth));
  const ctx = c.getContext("2d");
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 200) return true;
  return false;
}

export function TemplateUpload({ save, upload, color }: { save: Save; upload: Upload | null; color: string }) {
  const { t } = useT();
  const [result, run, pending] = useActionState(save, null);
  const [file, setFile] = useState<File | null>(null);
  const [src, setSrc] = useState("");
  const [ratio, setRatio] = useState(1);
  const [mode, setMode] = useState<CustomSpec["mode"]>("fondo");
  const [photo, setPhoto] = useState<CustomSpec["photo"]>("arriba");
  const [text, setText] = useState<CustomSpec["text"]>("abajo");
  const [ink, setInk] = useState<CustomSpec["ink"]>("oscuro");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  // Al guardar bien, se limpia para subir otra.
  useEffect(() => {
    if (result?.ok) {
      setFile(null);
      setSrc("");
      setName("");
      form.current?.reset();
    }
  }, [result]);

  async function choose(f: File | undefined) {
    setError("");
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) return setError(t("Usa una imagen PNG, JPG o WEBP.", "Use a PNG, JPG or WEBP image."));
    if (f.size > 8 * 1024 * 1024) return setError(t("La imagen es muy grande (máximo 8 MB).", "The image is too large (8 MB max)."));
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => null);
    setRatio(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1);
    setFile(f);
    setSrc(url);
    if (!name) setName(f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").slice(0, 40));
    // Si tiene partes transparentes, casi seguro es un marco: la foto va detrás.
    const clear = f.type !== "image/jpeg" && (await hasTransparency(url).catch(() => false));
    setMode(clear ? "marco" : "fondo");
    setInk(clear ? "claro" : "oscuro");
    setText(clear ? "arriba" : "abajo");
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return setError(t("Elige la imagen de tu plantilla.", "Choose your template image."));
    setError("");
    const fd = new FormData();
    fd.set("name", name);
    fd.set("mode", mode);
    fd.set("photo", mode === "marco" ? "completa" : photo);
    fd.set("text", text);
    fd.set("ink", ink);
    try {
      if (upload) {
        setBusy(t("Subiendo la imagen…", "Uploading the image…"));
        const { uploadUrl, publicUrl } = await upload(file.type);
        const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!res.ok) throw new Error(t("No se pudo subir la imagen. Intenta de nuevo.", "Couldn't upload the image. Please try again."));
        fd.set("imageUrl", publicUrl);
      } else fd.set("file", file);
    } catch (err) {
      setError((err as Error).message);
      return;
    } finally {
      setBusy("");
    }
    startTransition(() => run(fd));
  }

  const PHOTO_OPTS: [CustomSpec["photo"], string][] = [
    ["arriba", t("Arriba", "Top")],
    ["abajo", t("Abajo", "Bottom")],
    ["izquierda", t("Izquierda", "Left")],
    ["derecha", t("Derecha", "Right")],
    ["centro", t("Centro", "Center")],
    ["ninguna", t("Sin foto", "No photo")],
  ];
  const TEXT_OPTS: [CustomSpec["text"], string][] = [
    ["arriba", t("Arriba", "Top")],
    ["centro", t("Centro", "Middle")],
    ["abajo", t("Abajo", "Bottom")],
    ["ninguno", t("Sin titular", "No headline")],
  ];
  const INK_OPTS: [CustomSpec["ink"], string][] = [
    ["claro", t("Blancas", "White")],
    ["oscuro", t("Oscuras", "Dark")],
    ["marca", t("Color de mi marca", "My brand color")],
  ];
  const spot = mode === "marco" ? "completa" : photo;
  const box = spot !== "completa" && spot !== "ninguna" ? PHOTO_BOXES[spot] : null;
  const tb = textBox({ photo: spot, text });
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const inkColor = ink === "claro" ? "#ffffff" : ink === "oscuro" ? "#111827" : color;

  return (
    <details className={s.wrap}>
      <summary className={s.summary}>
        <span className={s.plus} aria-hidden>+</span>
        <span className="stack" style={{ gap: 2 }}>
          <strong>{t("Subir mi propia plantilla", "Upload my own template")}</strong>
          <span className="small muted">{t("¿Ya tienes un diseño (de Canva u otro)? Súbelo y la app pone encima la foto y el titular.", "Already have a design (from Canva or elsewhere)? Upload it and the app adds the photo and headline.")}</span>
        </span>
      </summary>

      {pending ? (
        <p className="small muted" role="status">{t("Guardando tu plantilla…", "Saving your template…")}</p>
      ) : null}
      <form ref={form} onSubmit={submit} className={s.body} style={pending ? { display: "none" } : undefined}>
        <div className={s.cols}>
          <div className="stack" style={{ gap: 16, minWidth: 0 }}>
            <div className="stack" style={{ gap: 6 }}>
              <label htmlFor="tpl-file" className="lbl">1. {t("Tu imagen", "Your image")}</label>
              <input id="tpl-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => choose(e.target.files?.[0])} />
              <span className="small muted">{t("PNG con el centro transparente (marco) o una imagen de fondo. Mejor de 1080×1080 o 1080×1350.", "A PNG with a transparent center (frame) or a background image. Best at 1080×1080 or 1080×1350.")}</span>
            </div>

            <fieldset className={s.group}>
              <legend className="lbl">2. {t("¿Cómo es tu plantilla?", "What kind of template is it?")}</legend>
              <div className={s.cards}>
                <label className={mode === "marco" ? `${s.card} ${s.on}` : s.card}>
                  <input type="radio" name="tpl-mode" checked={mode === "marco"} onChange={() => { setMode("marco"); setInk("claro"); }} />
                  <span><strong>{t("Marco", "Frame")}</strong><span className="small muted">{t("Tiene una parte transparente: la foto se ve por detrás.", "It has a transparent part: the photo shows through.")}</span></span>
                </label>
                <label className={mode === "fondo" ? `${s.card} ${s.on}` : s.card}>
                  <input type="radio" name="tpl-mode" checked={mode === "fondo"} onChange={() => setMode("fondo")} />
                  <span><strong>{t("Fondo", "Background")}</strong><span className="small muted">{t("La foto va en un recuadro encima de tu diseño.", "The photo goes in a box on top of your design.")}</span></span>
                </label>
              </div>
            </fieldset>

            {mode === "fondo" && (
              <fieldset className={s.group}>
                <legend className="lbl">3. {t("¿Dónde va la foto?", "Where does the photo go?")}</legend>
                <div className={s.chips}>
                  {PHOTO_OPTS.map(([v, l]) => (
                    <label key={v} className={photo === v ? `${s.opt} ${s.on}` : s.opt}>
                      <input type="radio" name="tpl-photo" checked={photo === v} onChange={() => setPhoto(v)} />
                      {l}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <fieldset className={s.group}>
              <legend className="lbl">{mode === "fondo" ? "4." : "3."} {t("¿Dónde va el titular?", "Where does the headline go?")}</legend>
              <div className={s.chips}>
                {TEXT_OPTS.map(([v, l]) => (
                  <label key={v} className={text === v ? `${s.opt} ${s.on}` : s.opt}>
                    <input type="radio" name="tpl-text" checked={text === v} onChange={() => setText(v)} />
                    {l}
                  </label>
                ))}
              </div>
              {text !== "ninguno" && (
                <div className={s.chips} aria-label={t("Color de las letras", "Letter color")}>
                  <span className="small muted">{t("Letras:", "Letters:")}</span>
                  {INK_OPTS.map(([v, l]) => (
                    <label key={v} className={ink === v ? `${s.opt} ${s.on}` : s.opt}>
                      <input type="radio" name="tpl-ink" checked={ink === v} onChange={() => setInk(v)} />
                      {l}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <div className="stack" style={{ gap: 6 }}>
              <label htmlFor="tpl-name" className="lbl">{t("Nombre", "Name")}</label>
              <input id="tpl-name" className="field" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Ej.: Marco azul", "E.g., Blue frame")} />
            </div>
          </div>

          <div className="stack" style={{ gap: 8, minWidth: 0 }}>
            <span className="lbl">{t("Así se verá", "Preview")}</span>
            <div className={s.preview} style={{ aspectRatio: String(ratio) }}>
              {!src && <span className={s.empty}>{t("Elige tu imagen para ver la vista previa", "Choose your image to see the preview")}</span>}
              {src && mode === "fondo" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" className={s.layer} />
              )}
              {src && spot !== "ninguna" && (
                <div className={s.photo} style={box ? { left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h), borderRadius: 10 } : { inset: 0 }}>
                  <span>{t("Tu foto", "Your photo")}</span>
                </div>
              )}
              {src && mode === "marco" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" className={s.layer} />
              )}
              {src && tb && (
                <div className={s.text} style={{ left: pct(tb.x), top: pct(tb.y), width: pct(tb.w), height: pct(tb.h), color: inkColor, alignItems: tb.y < 0.2 ? "flex-start" : tb.y > 0.5 ? "flex-end" : "center" }}>
                  {t("Tu titular va aquí", "Your headline goes here")}
                </div>
              )}
            </div>
            <span className="small muted">{t("Si una red pide otra forma (por ejemplo historias 9:16), tu diseño se centra sin cortarlo.", "If a network needs another shape (like 9:16 stories), your design is centered without cutting it.")}</span>
          </div>
        </div>

        {busy && <p className="small muted" role="status">{busy}</p>}
        {error && <p className="note error" role="alert">{error}</p>}
        {result && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
        <div>
          <button type="submit" className="btn on" disabled={!file || !!busy}>{t("Guardar mi plantilla", "Save my template")}</button>
        </div>
      </form>
    </details>
  );
}
