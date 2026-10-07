"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { BrandKitResult } from "@/app/actions";
import { BrandMockups } from "@/components/BrandMockups";
import { startBookRun, useBookRun } from "@/components/brand/BookRun";
import { useT } from "@/components/I18n";
import f from "./BrandKitForm.module.css";

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
  website?: string;
};

type Upload = (contentType: string) => Promise<{ uploadUrl: string; publicUrl: string }>;

type Props = {
  kit: Kit;
  save: (f: FormData) => Promise<void>;
  upload: Upload | null;
  /** Guarda un logo apenas se sube o se quita (para que no se pierda si no presionan "Guardar la marca"). */
  saveLogo?: (field: "logoUrl" | "logoLightUrl", url: string) => Promise<{ ok: boolean; message: string }>;
  brandBook: { url: string; upload: Upload | null; read: (url: string) => Promise<BrandKitResult>; suggest: (() => Promise<BrandKitResult>) | null };
};

const BOOK_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

function LogoField({
  label,
  help,
  value,
  onChange,
  upload,
  dark,
  persist,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
  upload: Props["upload"];
  dark?: boolean;
  persist?: (url: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stored, setStored] = useState(false);
  const { t } = useT();
  async function keep(url: string) {
    onChange(url);
    setStored(false);
    if (!persist) return;
    const r = await persist(url);
    if (r.ok) setStored(true);
    else setError(r.message);
  }
  async function onFile(f: File | undefined) {
    setError("");
    if (!f || !upload) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) return setError(t("Usa PNG (mejor con fondo transparente), JPG o WEBP.", "Use PNG (best with a transparent background), JPG, or WEBP."));
    setBusy(true);
    try {
      const { uploadUrl, publicUrl } = await upload(f.type);
      const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": f.type }, body: f });
      if (!res.ok) throw new Error(await res.text());
      await keep(publicUrl);
    } catch (e) {
      setError(`${t("No se pudo subir", "Couldn't upload")}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="lbl">{label}</span>
      <div className="logo-box" style={{ background: dark ? "#0b1220" : "#ffffff" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {value ? <img src={value} alt={label} /> : <span className="small" style={{ color: dark ? "#8c9ab3" : "#5d6b7e" }}>{t("Sin logo", "No logo")}</span>}
      </div>
      <div className="row">
        {upload ? (
          <label className="btn" style={{ cursor: "pointer" }}>
            {busy ? t("Subiendo…", "Uploading…") : value ? t("Cambiar", "Change") : t("Subir", "Upload")}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => {
                // El logo se guarda solo: no cuenta como "cambio sin guardar" del formulario.
                if (persist) e.stopPropagation();
                onFile(e.target.files?.[0]);
              }}
            />
          </label>
        ) : (
          <span className="small muted">{t("Subir logos necesita Supabase Storage.", "Uploading logos requires Supabase Storage.")}</span>
        )}
        {value && <button type="button" className="btn link" onClick={() => keep("")}>{t("Quitar", "Remove")}</button>}
        {stored && <span className="pill done">{value ? t("Guardado", "Saved") : t("Quitado", "Removed")}</span>}
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
  const { t } = useT();
  const businessId = useParams<{ id: string }>()?.id ?? "";
  const run = useBookRun();
  const pulling = run.businessId === businessId && (run.status === "opening" || run.status === "reading");

  function done(r: BrandKitResult) {
    if (r.ok) {
      onKit(r.kit);
      setNote({ ok: true, text: `${r.kit.summary} ${t('Mira la maqueta de abajo: si te gusta, presiona "Guardar la marca".', 'Look at the mockup below: if you like it, press "Save brand".')}` });
    } else setNote({ ok: false, text: r.message });
  }

  async function onFile(f: File | undefined) {
    setNote(null);
    if (!f || !brandBook.upload) return;
    if (!BOOK_TYPES.includes(f.type)) return setNote({ ok: false, text: t("Usa un PDF o una imagen (PNG, JPG o WEBP).", "Use a PDF or an image (PNG, JPG, or WEBP).") });
    setBusy("book");
    try {
      const { uploadUrl, publicUrl } = await brandBook.upload(f.type);
      const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": f.type }, body: f });
      if (!res.ok) throw new Error(await res.text());
      setBookUrl(publicUrl);
      // Al mismo tiempo, la IA saca los logos e imágenes del manual (se ven en "Imágenes de tu manual").
      if (businessId) void startBookRun(businessId, f, { auto: true });
      done(await brandBook.read(publicUrl));
    } catch (e) {
      setNote({ ok: false, text: `${t("No se pudo subir", "Couldn't upload")}: ${(e as Error).message}` });
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
    <section className="card" id="manual">
      <h2>{t("Manual de marca", "Brand book")}</h2>
      <p className="small muted">
        {t(
          "¿Ya tienes un manual de marca (brand book)? Súbelo y la IA saca de ahí tus colores, letras y forma de hablar. ¿No tienes uno? La IA te crea una identidad a partir de lo que contaste de tu negocio.",
          "Already have a brand book? Upload it and the AI pulls your colors, fonts, and way of speaking from it. Don't have one? The AI creates an identity based on what you told it about your business.",
        )}
      </p>
      <div className="grid-2" style={{ gap: 14 }}>
        <div className="source-option">
          <strong>{t("Subir mi manual de marca", "Upload my brand book")}</strong>
          <span className="small muted">{t("PDF o imagen (PNG, JPG). Se guarda aquí para tenerlo siempre a mano, y la IA lo lee para llenar tus colores y letras y sacar tus logos e imágenes.", "PDF or image (PNG, JPG). It's saved here so you always have it handy, and the AI reads it to fill in your colors and fonts and pull out your logos and images.")}</span>
          {brandBook.upload ? (
            <label className="btn" style={{ cursor: busy ? "wait" : "pointer" }} aria-disabled={Boolean(busy)}>
              {busy === "book" ? t("La IA está leyendo tu manual…", "The AI is reading your brand book…") : bookUrl ? t("Subir otro manual", "Upload another brand book") : t("Subir manual", "Upload brand book")}
              <input type="file" accept={BOOK_TYPES.join(",")} className="sr-only" disabled={Boolean(busy)} onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          ) : (
            <span className="small muted">{t("Subir archivos necesita Supabase Storage.", "Uploading files requires Supabase Storage.")}</span>
          )}
          {bookUrl && (
            <span className={`small ${f.saved}`}>
              ✓ {t("Manual guardado.", "Brand book saved.")}{" "}
              <a href={bookUrl} target="_blank" rel="noopener noreferrer">{t("Verlo", "View it")}</a>
            </span>
          )}
        </div>
        <div className="source-option">
          <strong>{t("Crear mi identidad con IA", "Create my identity with AI")}</strong>
          <span className="small muted">{t("Colores, letras, voz y hashtags pensados para tu negocio. Tú decides si los guardas.", "Colors, fonts, voice, and hashtags designed for your business. You decide whether to save them.")}</span>
          {brandBook.suggest ? (
            <button type="button" className="btn on" onClick={onAi} disabled={Boolean(busy)}>
              {busy === "ai" ? t("La IA está creando tu identidad…", "The AI is creating your identity…") : t("✦ Crear con IA", "✦ Create with AI")}
            </button>
          ) : (
            <span className="small muted">{t("Falta la clave de la IA.", "The AI key is missing.")}</span>
          )}
        </div>
      </div>
      {note && <p className={note.ok ? "note ok" : "note error"} role="status">{note.text}</p>}
      {pulling && (
        <p className="note info" role="status">
          {t("La IA también está sacando tus logos e imágenes del manual. ", "The AI is also pulling your logos and images from the brand book. ")}
          <a href="#imagenes-manual">{t("Míralas en «Imágenes de tu manual»", "See them in “Images from your brand book”")}</a>
        </p>
      )}
    </section>
  );
}

export function BrandKitForm({ kit, save, upload, brandBook, saveLogo }: Props) {
  const [logo, setLogo] = useState(kit.logoUrl);
  const [logoLight, setLogoLight] = useState(kit.logoLightUrl);
  const [c1, setC1] = useState(kit.color);
  const [c2, setC2] = useState(kit.color2 || kit.color);
  const [c3, setC3] = useState(kit.color3 || kit.color2 || kit.color);
  const [font, setFont] = useState(kit.fontHeading);
  const [fontBody, setFontBody] = useState(kit.fontBody);
  const [voice, setVoice] = useState(kit.brandVoice);
  const [hashtags, setHashtags] = useState(kit.hashtags);
  const [phone, setPhone] = useState(kit.phone);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const { t } = useT();
  const fontCss = FONT_CHOICES.find(([id]) => id === font)?.[2] ?? "inherit";
  // Los logos se guardan solos (también al aceptar uno del manual): si cambian en el servidor, se muestran aquí, y
  // "Guardar la marca" no los pisa con el valor viejo.
  useEffect(() => setLogo(kit.logoUrl), [kit.logoUrl]);
  useEffect(() => setLogoLight(kit.logoLightUrl), [kit.logoLightUrl]);

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
        setDirty(true);
      }}
    />
    <section className="card" aria-labelledby="mockups-title">
      <div className="stack" style={{ gap: 4 }}>
        <h2 id="mockups-title">{t("Así se ve tu marca", "This is how your brand looks")}</h2>
        <p className="small muted">
          {t(
            "Una maqueta con tus colores, letras y logo. Cambia algo abajo y la maqueta se actualiza al momento.",
            "A mockup with your colors, fonts and logo. Change something below and the mockup updates right away.",
          )}
        </p>
      </div>
      <BrandMockups
        brand={{ name: kit.name, logo, logoLight, c1, c2, c3, headingCss: fontCss, bodyFont: fontBody, phone, website: kit.website ?? "", hashtags }}
      />
    </section>
    <form
      action={async (fd) => {
        setSaving(true);
        try {
          await save(fd);
          setSaved(true);
          setDirty(false);
        } finally {
          setSaving(false);
        }
      }}
      className="stack"
      style={{ gap: 22 }}
      onChange={() => {
        setSaved(false);
        setDirty(true);
      }}
    >
      <input type="hidden" name="logoUrl" value={logo} />
      <input type="hidden" name="logoLightUrl" value={logoLight} />

      <section className="card" id="logos">
        <h2>Logos</h2>
        <div className="grid-2" style={{ gap: 18 }}>
          <LogoField
            label={t("Logo principal", "Main logo")}
            help={t("Para fondos claros. Mejor en PNG con fondo transparente. Se guarda apenas lo subes.", "For light backgrounds. Best as a PNG with a transparent background. It's saved as soon as you upload it.")}
            value={logo}
            onChange={setLogo}
            upload={upload}
            persist={saveLogo && ((url) => saveLogo("logoUrl", url))}
          />
          <LogoField
            label={t("Logo blanco (opcional)", "White logo (optional)")}
            help={t("Para fondos oscuros y fotos. Si no lo tienes, se usa el principal en una tarjeta blanca.", "For dark backgrounds and photos. If you don't have one, the main logo is used on a white card.")}
            value={logoLight}
            onChange={setLogoLight}
            upload={upload}
            dark
            persist={saveLogo && ((url) => saveLogo("logoLightUrl", url))}
          />
        </div>
      </section>

      <section className="card" id="colores">
        <h2>{t("Colores", "Colors")}</h2>
        <div className="swatches">
          {([["color", t("Principal", "Primary"), c1, setC1], ["color2", t("Secundario", "Secondary"), c2, setC2], ["color3", t("Acento", "Accent"), c3, setC3]] as const).map(([name, label, value, set]) => (
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

      <section className="card" id="letras">
        <h2>{t("Letras", "Fonts")}</h2>
        <div className="grid-2" style={{ gap: 18 }}>
          <div className="stack" style={{ gap: 6 }}>
            <label className="lbl" htmlFor="fontHeading">{t("Letra de los titulares (en los diseños)", "Headline font (in the designs)")}</label>
            <select id="fontHeading" name="fontHeading" className="field" value={font} onChange={(e) => setFont(e.target.value)}>
              {FONT_CHOICES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <div className="font-preview" style={{ fontFamily: fontCss, color: c1 }}>{t("Revisa tu casa después de la tormenta", "Check your home after the storm")}</div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <label className="lbl" htmlFor="fontBody">{t("Letra del texto (de tu guía de marca)", "Body text font (from your brand guide)")}</label>
            <input id="fontBody" name="fontBody" className="field" value={fontBody} onChange={(e) => setFontBody(e.target.value)} placeholder={t("Ej.: IBM Plex Sans", "E.g.: IBM Plex Sans")} />
            <span className="small muted">{t("Se guarda como referencia de tu identidad.", "Saved as a reference for your identity.")}</span>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>{t("Voz de la marca", "Brand voice")}</h2>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="brandVoice">{t("Cómo habla tu marca", "How your brand talks")}</label>
          <textarea id="brandVoice" name="brandVoice" className="field" style={{ minHeight: 110 }} maxLength={2000} value={voice} onChange={(e) => setVoice(e.target.value)} placeholder={t(
              "Ej.: cercano y claro, como un vecino que conoce el proceso. Tratamos de “tú”. Nunca prometemos resultados. Frases que usamos: “Miami es nuestro hogar”.",
              "E.g.: friendly and clear, like a neighbor who knows the process. Casual, never stiff. We never promise results. Phrases we use: “Miami is our home”.",
            )} />
          <span className="small muted">{t("La IA lo sigue en todo lo que escribe.", "The AI follows it in everything it writes.")}</span>
        </div>
        <div className="grid-2" style={{ gap: 18 }}>
          <div className="stack" style={{ gap: 6 }}>
            <label className="lbl" htmlFor="hashtags">{t("Hashtags de la marca", "Brand hashtags")}</label>
            <input id="hashtags" name="hashtags" className="field" value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder={t("Ej.: #TuNegocio #TuCiudad", "E.g.: #YourBusiness #YourCity")} />
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <label className="lbl" htmlFor="phone">{t("Teléfono en los diseños", "Phone number on designs")}</label>
            <input id="phone" name="phone" className="field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("Ej.: +505 8888 1234", "E.g.: 305-394-8090")} />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" name="brandImages" defaultChecked={kit.brandImages} />
          <span>
            <strong>{t("Diseñar solas las fotos de la IA", "Auto-design the AI photos")}</strong>
            <span className="small muted" style={{ display: "block" }}>{t("Las fotos que crea la IA salen con tu marca y una de tus plantillas.", "Photos the AI creates come out with your brand and one of your templates.")}</span>
          </span>
        </label>
      </section>

      <div className={`row ${f.saveBar}${dirty ? ` ${f.dirty}` : ""}`}>
        <button className="btn on" type="submit" disabled={saving}>{saving ? t("Guardando…", "Saving…") : t("Guardar la marca", "Save brand")}</button>
        {saved && <span className="pill done">{t("Guardado", "Saved")}</span>}
        {dirty && !saving && <span className={f.unsaved}>{t("Tienes cambios sin guardar.", "You have unsaved changes.")}</span>}
      </div>
    </form>
    </>
  );
}
