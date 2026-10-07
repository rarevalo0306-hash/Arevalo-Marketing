"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { BrandKitResult } from "@/app/actions";
import { BrandMockups } from "@/components/BrandMockups";
import { bookRunText, startBookRun, useBookRun } from "@/components/brand/BookRun";
import { useT } from "@/components/I18n";
import { emitBrandSaved } from "@/lib/brand-events";
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
  brandBook: {
    url: string;
    /** Nombre del archivo del manual en uso. */
    name: string;
    upload: Upload | null;
    save: (url: string, name: string) => Promise<{ ok: boolean; message: string }>;
    read: (url: string) => Promise<BrandKitResult>;
    suggest: (() => Promise<BrandKitResult>) | null;
    /** Hay clave de Gemini para sacar logos e imágenes del manual. */
    canRead: boolean;
  };
  /** Las imágenes del manual (para aceptar o rechazar): van entre los campos y «Guardar la marca». */
  children?: React.ReactNode;
  /** Ya existe el kit de marca (si no, se crea al guardar aunque no cambien colores ni logos). */
  hasKit: boolean;
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

/** Nombre que se muestra del manual: el del archivo que subió el dueño, o uno genérico. */
function bookLabel(name: string, url: string, t: (es: string, en: string) => string): string {
  if (name) return name;
  return /\.pdf($|\?)/i.test(url) ? t("Tu manual de marca (PDF)", "Your brand book (PDF)") : t("Tu manual de marca (imagen)", "Your brand book (image)");
}

type StepState = "wait" | "run" | "ok" | "err";

/**
 * Paso 1 de la página: elegir el manual en uso y «Crear mi marca». La IA lee de ahí colores, letras y voz (llenan el
 * formulario de abajo) y saca logos e imágenes (propuestas para aceptar o rechazar). Sin manual, la IA crea la identidad.
 * Al final de las propuestas está «Guardar la marca», que crea el kit y propone las plantillas.
 */
function BrandSource({ brandBook, onKit }: { brandBook: Props["brandBook"]; onKit: (k: Extract<BrandKitResult, { ok: true }>["kit"]) => void }) {
  const [busy, setBusy] = useState<"" | "upload" | "create">("");
  const [error, setError] = useState("");
  const [bookUrl, setBookUrl] = useState(brandBook.url);
  const [bookName, setBookName] = useState(brandBook.name);
  // El archivo elegido en esta visita: se usa para sacar las imágenes sin volver a bajarlo.
  const file = useRef<File | null>(null);
  const [colors, setColors] = useState<{ state: StepState; text: string }>({ state: "wait", text: "" });
  const [started, setStarted] = useState<"" | "book" | "ai">("");
  const { t } = useT();
  const businessId = useParams<{ id: string }>()?.id ?? "";
  const run = useBookRun();
  const mine = run.businessId === businessId;
  const pulling = mine && (run.status === "opening" || run.status === "reading");
  const hasBook = Boolean(bookUrl || file.current);

  function applied(r: BrandKitResult) {
    if (r.ok) {
      onKit(r.kit);
      setColors({ state: "ok", text: r.kit.summary });
    } else setColors({ state: "err", text: r.message });
  }

  async function onFile(f: File | undefined) {
    setError("");
    if (!f) return;
    if (!BOOK_TYPES.includes(f.type)) return setError(t("Usa un PDF o una imagen (PNG, JPG o WEBP).", "Use a PDF or an image (PNG, JPG, or WEBP)."));
    file.current = f;
    setStarted("");
    setColors({ state: "wait", text: "" });
    if (!brandBook.upload) {
      // Sin almacenamiento (en la computadora): se usa el archivo solo para esta visita.
      setBookName(f.name);
      setBookUrl("");
      return;
    }
    setBusy("upload");
    try {
      const { uploadUrl, publicUrl } = await brandBook.upload(f.type);
      const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": f.type }, body: f });
      if (!res.ok) throw new Error(await res.text());
      const saved = await brandBook.save(publicUrl, f.name);
      if (!saved.ok) throw new Error(saved.message);
      setBookUrl(publicUrl);
      setBookName(f.name);
    } catch (e) {
      file.current = null;
      setError(`${t("No se pudo subir", "Couldn't upload")}: ${(e as Error).message}`);
    } finally {
      setBusy("");
    }
  }

  async function createFromBook() {
    if (!hasBook) return;
    setError("");
    setStarted("book");
    setBusy("create");
    // Las imágenes se sacan al mismo tiempo (se ven en «Imágenes de tu manual», más abajo).
    if (businessId && brandBook.canRead) void startBookRun(businessId, file.current ?? bookUrl);
    if (!bookUrl) {
      setColors({ state: "err", text: t("Para leer colores y letras, el manual tiene que estar guardado (falta Supabase Storage).", "To read colors and fonts, the brand book must be saved (Supabase Storage is missing).") });
      setBusy("");
      return;
    }
    setColors({ state: "run", text: "" });
    try {
      applied(await brandBook.read(bookUrl));
    } catch (e) {
      setColors({ state: "err", text: (e as Error).message });
    } finally {
      setBusy("");
    }
  }

  async function createWithAi() {
    if (!brandBook.suggest) return;
    setError("");
    setStarted("ai");
    setBusy("create");
    setColors({ state: "run", text: "" });
    try {
      applied(await brandBook.suggest());
    } catch (e) {
      setColors({ state: "err", text: (e as Error).message });
    } finally {
      setBusy("");
    }
  }

  const imgState: StepState = !mine || run.status === "idle" ? "wait" : pulling ? "run" : run.status === "done" ? "ok" : "err";
  const imgText = mine ? (run.status === "error" ? (run.error ? t(run.error.es, run.error.en) : "") : bookRunText(run, t)) : "";
  const icon = (s: StepState) => (s === "ok" ? "✓" : s === "err" ? "!" : s === "run" ? "…" : "○");

  return (
    <section className="card" id="manual">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{t("1. Crea tu marca", "1. Create your brand")}</h2>
        <p className="small muted">
          {t(
            "Con tu manual de marca, la IA saca tus colores, letras, forma de hablar, logos e imágenes. Sin manual, la IA te crea una identidad con lo que sabe de tu negocio. Después revisas todo abajo y lo guardas.",
            "With your brand book, the AI pulls your colors, fonts, way of speaking, logos and images. Without one, the AI creates an identity from what it knows about your business. Then you review everything below and save it.",
          )}
        </p>
      </div>
      <div className="grid-2" style={{ gap: 14 }}>
        <div className="source-option">
          <strong>{t("Tengo manual de marca", "I have a brand book")}</strong>
          {hasBook ? (
            <div className={f.inUse}>
              <span className={f.fileIcon} aria-hidden="true">📄</span>
              <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                <span className="small muted">{t("Manual en uso", "Brand book in use")}</span>
                <strong className={f.fileName}>{bookLabel(bookName, bookUrl, t)}</strong>
              </span>
              {bookUrl && <a className="small" href={bookUrl} target="_blank" rel="noopener noreferrer">{t("Ver", "View")}</a>}
            </div>
          ) : (
            <span className="small muted">{t("Sube tu manual (PDF o imagen). Se guarda aquí para tenerlo siempre a mano.", "Upload your brand book (PDF or image). It's saved here so you always have it handy.")}</span>
          )}
          <div className="row" style={{ gap: 8 }}>
            {hasBook && (
              <button type="button" className="btn on" onClick={createFromBook} disabled={Boolean(busy) || pulling}>
                {busy === "create" && started === "book" ? t("Creando tu marca…", "Creating your brand…") : t("✦ Crear mi marca con este manual", "✦ Create my brand from this book")}
              </button>
            )}
            <label className={`btn${hasBook ? "" : " on"}`} style={{ cursor: busy ? "wait" : "pointer" }} aria-disabled={Boolean(busy) || pulling}>
              {busy === "upload" ? t("Subiendo…", "Uploading…") : hasBook ? t("Cambiar manual", "Change brand book") : t("Subir mi manual", "Upload my brand book")}
              <input type="file" accept={BOOK_TYPES.join(",")} className="sr-only" disabled={Boolean(busy) || pulling} onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>
        </div>
        <div className="source-option">
          <strong>{t("No tengo manual", "I don't have a brand book")}</strong>
          <span className="small muted">{t("La IA propone colores, letras, voz y hashtags pensados para tu negocio. Tú decides si los guardas.", "The AI suggests colors, fonts, voice, and hashtags designed for your business. You decide whether to save them.")}</span>
          {brandBook.suggest ? (
            <button type="button" className="btn ai" onClick={createWithAi} disabled={Boolean(busy) || pulling}>
              {busy === "create" && started === "ai" ? t("La IA está creando tu identidad…", "The AI is creating your identity…") : t("✦ Crear mi marca con IA", "✦ Create my brand with AI")}
            </button>
          ) : (
            <span className="small muted">{t("Falta la clave de la IA.", "The AI key is missing.")}</span>
          )}
        </div>
      </div>
      {error && <p className="note error" role="status">{error}</p>}

      {started && (
        <ol className={f.steps} aria-live="polite">
          <li className={f[colors.state]}>
            <span className={f.dot} aria-hidden="true">{icon(colors.state)}</span>
            <span>
              <strong>{t("Colores, letras y voz", "Colors, fonts and voice")}</strong>{" "}
              {colors.state === "run"
                ? t(started === "ai" ? "— la IA los está pensando…" : "— la IA los está leyendo del manual…", started === "ai" ? "— the AI is coming up with them…" : "— the AI is reading them from the book…")
                : colors.state === "ok"
                  ? `— ${colors.text} ${t("Ya están abajo, en la maqueta y en los campos.", "They're below, in the mockup and the fields.")}`
                  : colors.text && `— ${colors.text}`}
            </span>
          </li>
          {started === "book" && brandBook.canRead && (
            <li className={f[imgState]}>
              <span className={f.dot} aria-hidden="true">{icon(imgState)}</span>
              <span>
                <strong>{t("Logos e imágenes del manual", "Logos and images from the book")}</strong> {imgText && `— ${imgText}`}{" "}
                {(imgState === "ok" || imgState === "run") && <a href="#imagenes-manual">{t("Ver abajo ↓", "See below ↓")}</a>}
              </span>
            </li>
          )}
          <li className={f.wait}>
            <span className={f.dot} aria-hidden="true">{started === "book" && brandBook.canRead ? "3" : "2"}</span>
            <span>
              <strong>{t("Revisa y guarda", "Review and save")}</strong>{" "}
              {t("— revisa las propuestas de abajo y presiona «Guardar la marca» al final. Al guardar creamos tu kit de marca y la IA te propone plantillas.", "— review the suggestions below and press “Save brand” at the end. When you save, we create your brand kit and the AI suggests templates.")}{" "}
              <a href="#guardar">{t("Ir a guardar ↓", "Go to save ↓")}</a>
            </span>
          </li>
        </ol>
      )}
    </section>
  );
}

export function BrandKitForm({ kit, save, upload, brandBook, saveLogo, children, hasKit }: Props) {
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
  const businessId = useParams<{ id: string }>()?.id ?? "";
  // Cómo se veía la marca la última vez que se guardó: si cambian colores, letras o logos, al guardar se vuelven a
  // crear el kit y las plantillas.
  const look = [c1, c2, c3, font, logo, logoLight].join("|");
  const savedLook = useRef([kit.color, kit.color2 || kit.color, kit.color3 || kit.color2 || kit.color, kit.fontHeading, kit.logoUrl, kit.logoLightUrl].join("|"));
  const [after, setAfter] = useState("");

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
        <h2 id="mockups-title">{t("2. Revisa tu marca: así se ve", "2. Review your brand: this is how it looks")}</h2>
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
      id="brand-form"
      action={async (fd) => {
        setSaving(true);
        setAfter("");
        try {
          await save(fd);
          setSaved(true);
          setDirty(false);
          const visual = look !== savedLook.current || !hasKit;
          savedLook.current = look;
          // El kit y las plantillas (más abajo) escuchan este aviso y se vuelven a crear solos.
          if (businessId) emitBrandSaved({ businessId, visual });
          if (visual) setAfter(t("Estamos creando tu kit de marca y la IA te está proponiendo plantillas. Míralos abajo.", "We're creating your brand kit and the AI is suggesting templates. See them below."));
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

    </form>
    {children}
    {/* Al final de todas las propuestas (fuera del formulario, que no puede tener otros formularios adentro). */}
    <div id="guardar" className={`${f.saveBar}${dirty ? ` ${f.dirty}` : ""}`}>
      <div className="row">
        <button className="btn on" type="submit" form="brand-form" disabled={saving}>{saving ? t("Guardando…", "Saving…") : t("Guardar la marca", "Save brand")}</button>
        {saved && <span className="pill done">{t("Guardado", "Saved")}</span>}
        {dirty && !saving && <span className={f.unsaved}>{t("Tienes cambios sin guardar.", "You have unsaved changes.")}</span>}
      </div>
      {!saved && !dirty && <span className="small muted">{t("Al guardar, creamos tu kit de marca y la IA te propone plantillas con esta marca.", "When you save, we create your brand kit and the AI suggests templates with this brand.")}</span>}
      {after && <p className="note ok" role="status">{after} <a href="#kit">{t("Ver el kit ↓", "See the kit ↓")}</a></p>}
    </div>
    </>
  );
}
