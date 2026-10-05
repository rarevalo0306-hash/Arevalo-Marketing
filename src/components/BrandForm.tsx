"use client";

import { useState } from "react";

type Props = {
  logoUrl: string;
  phone: string;
  brandImages: boolean;
  color: string;
  save: (f: FormData) => Promise<void>;
  upload: ((contentType: string) => Promise<{ uploadUrl: string; publicUrl: string }>) | null;
};

/** Logo, teléfono y diseño automático de las fotos con la marca del negocio. */
export function BrandForm({ logoUrl, phone, brandImages, color, save, upload }: Props) {
  const [logo, setLogo] = useState(logoUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function onLogo(f: File | undefined) {
    setError("");
    if (!f || !upload) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) return setError("Usa un PNG (mejor con fondo transparente), JPG o WEBP.");
    setBusy(true);
    try {
      const { uploadUrl, publicUrl } = await upload(f.type);
      const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": f.type }, body: f });
      if (!res.ok) throw new Error(await res.text());
      setLogo(publicUrl);
    } catch (e) {
      setError(`No se pudo subir el logo: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      action={async (f) => {
        await save(f);
        setSaved(true);
      }}
      className="card"
      style={{ gridColumn: "1 / -1" }}
    >
      <h2>Tu marca en las fotos</h2>
      <p className="small muted">La app pone tu logo, tu color, un titular y tu teléfono sobre las fotos, con letras perfectas.</p>
      <input type="hidden" name="logoUrl" value={logo} />
      <div className="row" style={{ gap: 20, alignItems: "flex-start" }}>
        <div className="stack" style={{ gap: 8 }}>
          <span className="lbl">Logo</span>
          <div style={{ width: 200, height: 110, borderRadius: 14, border: "1.5px dashed var(--line)", display: "grid", placeItems: "center", background: `linear-gradient(135deg, ${color}22, #fff)` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logo ? <img src={logo} alt="Tu logo" style={{ maxWidth: 170, maxHeight: 80, objectFit: "contain" }} /> : <span className="small muted">Sin logo</span>}
          </div>
          {upload ? (
            <label className="btn outline" style={{ cursor: "pointer" }}>
              {busy ? "Subiendo…" : logo ? "Cambiar logo" : "Subir logo"}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => onLogo(e.target.files?.[0])} />
            </label>
          ) : (
            <span className="small muted">Para subir el logo, la app necesita Supabase Storage.</span>
          )}
          {logo && <button type="button" className="btn link" onClick={() => setLogo("")}>Quitar logo</button>}
          <span className="small muted">Mejor en PNG con fondo transparente.</span>
        </div>
        <div className="stack" style={{ gap: 12, flex: "1 1 260px" }}>
          <div className="stack" style={{ gap: 4 }}>
            <label className="lbl" htmlFor="phone">Teléfono que sale en las fotos</label>
            <input id="phone" name="phone" className="field" defaultValue={phone} placeholder="305-394-8090" />
          </div>
          <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" name="brandImages" defaultChecked={brandImages} style={{ marginTop: 4 }} />
            <span>
              <strong>Diseñar solas las fotos de la IA</strong>
              <span className="small muted" style={{ display: "block" }}>Las fotos que crea la IA (en Publicar y en el Plan) salen con tu marca. Siempre puedes usar la foto sin diseño.</span>
            </span>
          </label>
        </div>
      </div>
      {error && <p className="note error" role="alert">{error}</p>}
      {saved && <p className="note ok" role="status">Guardado.</p>}
      <div><button className="btn on" type="submit" disabled={busy}>Guardar</button></div>
    </form>
  );
}
