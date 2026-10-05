"use client";

import { useState } from "react";
import type { BrandKitResult } from "@/app/actions";

const FONT_CHOICES = [
  ["montserrat", "Montserrat", "'Montserrat', sans-serif"],
  ["poppins", "Poppins", "'Poppins', sans-serif"],
  ["inter", "Inter", "'Inter', sans-serif"],
  ["oswald", "Oswald", "'Oswald', sans-serif"],
  ["playfair-display", "Playfair Display", "'Playfair Display', serif"],
] as const;

type Kit = {
  name: string;
  logoUrl: string;
  logoLightUrl: string;
  color: string;
  color2: string;
  color3: string;
  fontHeading: string;
  fontBody: string;
  brandVoice: string;
  hashtags: string;
  phone: string;
  brandImages: boolean;
};

type Upload = (contentType: string) => Promise<{ uploadUrl: string; publicUrl: string }>;

type Props = {
  kit: Kit;
  save: (f: FormData) => Promise<void>;
  upload: Upload | null;
  brandBook: { url: string; upload: Upload | null; read: (url: string) => Promise<BrandKitResult>; suggest: (() => Promise<BrandKitResult>) | null };
};

const BOOK_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

function LogoField({ label, help, value, onChange, upload, dark }: { label: string; help: string; value: string; onChange: (v: string) => void; upload: Props["upload"]; dark?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function onFile(f: File | undefined) {
    setError("");
    if (!f || !upload) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) return setError("Usa PNG (mejor con fondo transparente), JPG o WEBP.");
    setBusy(true);
    try {
      const { uploadUrl, publicUrl } = await upload(f.type);
      const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": f.type }, body: f });
      if (!res.ok) throw new Error(await res.text());
      onChange(publicUrl);
    } catch (e) {
      setError(`No se pudo subir: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="lbl">{label}</span>
      <div className="logo-box" style={{ background: dark ? "#0b1220" : "#ffffff" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {value ? <img src={value} alt={label} /> : <span className="small" style={{ color: dark ? "#8c9ab3" : "#5d6b7e" }}>Sin logo</span>}
      </div>
      <div className="row">
        {upload ? (
          <label className="btn" style={{ cursor: "pointer" }}>
            {busy ? "Subiendo…" : value ? "Cambiar" : "Subir"}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        ) : (
          <span className="small muted">Subir logos necesita Supabase Storage.</span>
        )}
        {value && <button type="button" className="btn link" onClick={() => onChange("")}>Quitar</button>}
      </div>
      <span className="small muted">{help}</span>
      {error && <p className="note error">{error}</p>}
    </div>
  );
}

/** La identidad de la marca de cada negocio: logos, colores, letras, tono de voz y datos de contacto. */
/** Dos caminos para llenar la identidad: subir el manual de marca para que la IA lo lea, o que la IA la cree. */
function BrandSource({ brandBook, onKit }: { brandBook: Props["brandBook"]; onKit: (k: Extract<BrandKitResult, { ok: true }>["kit"]) => void }) {
  const [busy, setBusy] = useState<"" | "book" | "ai">("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [bookUrl, setBookUrl] = useState(brandBook.url);

  function done(r: BrandKitResult) {
    if (r.ok) {
      onKit(r.kit);
      setNote({ ok: true, text: `${r.kit.summary} Revisa los campos de abajo y presiona "Guardar la marca".` });
    } else setNote({ ok: false, text: r.message });
  }

  async function onFile(f: File | undefined) {
    setNote(null);
    if (!f || !brandBook.upload) return;
    if (!BOOK_TYPES.includes(f.type)) return setNote({ ok: false, text: "Usa un PDF o una imagen (PNG, JPG o WEBP)." });
    setBusy("book");
    try {
      const { uploadUrl, publicUrl } = await brandBook.upload(f.type);
      const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": f.type }, body: f });
      if (!res.ok) throw new Error(await res.text());
      setBookUrl(publicUrl);
      done(await brandBook.read(publicUrl));
    } catch (e) {
      setNote({ ok: false, text: `No se pudo subir: ${(e as Error).message}` });
    } finally {
      setBusy("");
    }
  }

  async function onAi() {
    if (!brandBook.suggest) return;
    setNote(null);
    setBusy("ai");
    try {
      done(await brandBook.suggest());
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="card">
      <h2>Manual de marca</h2>
      <p className="small muted">
        ¿Ya tienes un manual de marca (brand book)? Súbelo y la IA saca de ahí tus colores, letras y forma de hablar. ¿No tienes uno? La IA te crea una
        identidad a partir de lo que contaste de tu negocio.
      </p>
      <div className="grid-2" style={{ gap: 14 }}>
        <div className="source-option">
          <strong>Subir mi manual de marca</strong>
          <span className="small muted">PDF o imagen. Se guarda aquí para tenerlo siempre a mano.</span>
          {brandBook.upload ? (
            <label className="btn" style={{ cursor: busy ? "wait" : "pointer" }} aria-disabled={Boolean(busy)}>
              {busy === "book" ? "La IA está leyendo tu manual…" : bookUrl ? "Subir otro manual" : "Subir manual"}
              <input type="file" accept={BOOK_TYPES.join(",")} className="sr-only" disabled={Boolean(busy)} onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          ) : (
            <span className="small muted">Subir archivos necesita Supabase Storage.</span>
          )}
          {bookUrl && (
            <a className="small" href={bookUrl} target="_blank" rel="noopener noreferrer">Ver el manual guardado</a>
          )}
        </div>
        <div className="source-option">
          <strong>Crear mi identidad con IA</strong>
          <span className="small muted">Colores, letras, voz y hashtags pensados para tu negocio. Tú decides si los guardas.</span>
          {brandBook.suggest ? (
            <button type="button" className="btn on" onClick={onAi} disabled={Boolean(busy)}>
              {busy === "ai" ? "La IA está creando tu identidad…" : "✦ Crear con IA"}
            </button>
          ) : (
            <span className="small muted">Falta la clave de la IA.</span>
          )}
        </div>
      </div>
      {note && <p className={note.ok ? "note ok" : "note error"} role="status">{note.text}</p>}
    </section>
  );
}

export function BrandKitForm({ kit, save, upload, brandBook }: Props) {
  const [logo, setLogo] = useState(kit.logoUrl);
  const [logoLight, setLogoLight] = useState(kit.logoLightUrl);
  const [c1, setC1] = useState(kit.color);
  const [c2, setC2] = useState(kit.color2 || kit.color);
  const [c3, setC3] = useState(kit.color3 || kit.color2 || kit.color);
  const [font, setFont] = useState(kit.fontHeading);
  const [fontBody, setFontBody] = useState(kit.fontBody);
  const [voice, setVoice] = useState(kit.brandVoice);
  const [hashtags, setHashtags] = useState(kit.hashtags);
  const [saved, setSaved] = useState(false);
  const fontCss = FONT_CHOICES.find(([id]) => id === font)?.[2] ?? "inherit";

  return (
    <>
    <BrandSource
      brandBook={brandBook}
      onKit={(k) => {
        setC1(k.color);
        setC2(k.color2);
        setC3(k.color3);
        setFont(k.fontHeading);
        setFontBody(k.fontBody);
        setVoice(k.brandVoice);
        setHashtags(k.hashtags);
        setSaved(false);
      }}
    />
    <form
      action={async (f) => {
        await save(f);
        setSaved(true);
      }}
      className="stack"
      style={{ gap: 22 }}
      onChange={() => setSaved(false)}
    >
      <input type="hidden" name="logoUrl" value={logo} />
      <input type="hidden" name="logoLightUrl" value={logoLight} />

      <section className="card">
        <h2>Logos</h2>
        <div className="grid-2" style={{ gap: 18 }}>
          <LogoField label="Logo principal" help="Para fondos claros. Mejor en PNG con fondo transparente." value={logo} onChange={setLogo} upload={upload} />
          <LogoField label="Logo blanco (opcional)" help="Para fondos oscuros y fotos. Si no lo tienes, se usa el principal en una tarjeta blanca." value={logoLight} onChange={setLogoLight} upload={upload} dark />
        </div>
      </section>

      <section className="card">
        <h2>Colores</h2>
        <div className="swatches">
          {([["color", "Principal", c1, setC1], ["color2", "Secundario", c2, setC2], ["color3", "Acento", c3, setC3]] as const).map(([name, label, value, set]) => (
            <label key={name} className="swatch">
              <input type="color" name={name} value={value} onChange={(e) => set(e.target.value)} />
              <span className="swatch-chip" style={{ background: value }} />
              <span className="stack" style={{ gap: 0 }}>
                <strong>{label}</strong>
                <span className="small muted" style={{ textTransform: "uppercase" }}>{value}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="brand-bar" style={{ background: `linear-gradient(90deg, ${c1}, ${c2} 60%, ${c3})` }} />
      </section>

      <section className="card">
        <h2>Letras</h2>
        <div className="grid-2" style={{ gap: 18 }}>
          <div className="stack" style={{ gap: 6 }}>
            <label className="lbl" htmlFor="fontHeading">Letra de los titulares (en los diseños)</label>
            <select id="fontHeading" name="fontHeading" className="field" value={font} onChange={(e) => setFont(e.target.value)}>
              {FONT_CHOICES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <div className="font-preview" style={{ fontFamily: fontCss, color: c1 }}>Revisa tu casa después de la tormenta</div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <label className="lbl" htmlFor="fontBody">Letra del texto (de tu guía de marca)</label>
            <input id="fontBody" name="fontBody" className="field" value={fontBody} onChange={(e) => setFontBody(e.target.value)} placeholder="Ej.: IBM Plex Sans" />
            <span className="small muted">Se guarda como referencia de tu identidad.</span>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Voz de la marca</h2>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="brandVoice">Cómo habla tu marca</label>
          <textarea id="brandVoice" name="brandVoice" className="field" style={{ minHeight: 110 }} maxLength={2000} value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="Ej.: cercano y claro, como un vecino que conoce el proceso. Tratamos de “tú”. Nunca prometemos resultados. Frases que usamos: “Miami es nuestro hogar”." />
          <span className="small muted">La IA lo sigue en todo lo que escribe.</span>
        </div>
        <div className="grid-2" style={{ gap: 18 }}>
          <div className="stack" style={{ gap: 6 }}>
            <label className="lbl" htmlFor="hashtags">Hashtags de la marca</label>
            <input id="hashtags" name="hashtags" className="field" value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#RicardoPublicAdjusters #Miami" />
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <label className="lbl" htmlFor="phone">Teléfono en los diseños</label>
            <input id="phone" name="phone" className="field" defaultValue={kit.phone} placeholder="305-394-8090" />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" name="brandImages" defaultChecked={kit.brandImages} />
          <span>
            <strong>Diseñar solas las fotos de la IA</strong>
            <span className="small muted" style={{ display: "block" }}>Las fotos que crea la IA salen con tu marca y una de tus plantillas.</span>
          </span>
        </label>
      </section>

      <div className="row">
        <button className="btn on" type="submit">Guardar la marca</button>
        {saved && <span className="pill done">Guardado</span>}
      </div>
    </form>
    </>
  );
}
