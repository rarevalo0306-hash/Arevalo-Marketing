import Link from "next/link";
import { deleteBusiness, updateAiSettings, updateBusiness } from "@/app/actions";
import { PageHead } from "@/components/PageHead";
import { availableText } from "@/lib/ai";
import { db } from "@/lib/db";
import { BUILTIN_TEMPLATES, builtinTemplateName, FONTS, fontId } from "@/lib/design-shapes";
import { getT } from "@/lib/i18n-server";
import { availableImage } from "@/lib/imagegen";
import s from "./negocio.module.css";

const FONT_CSS: Record<string, string> = {
  montserrat: "'Montserrat', sans-serif",
  poppins: "'Poppins', sans-serif",
  inter: "'Inter', sans-serif",
  oswald: "'Oswald', sans-serif",
  "playfair-display": "'Playfair Display', serif",
};

export default async function NegocioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lang, t } = await getT();
  const b = await db.business.findUniqueOrThrow({ where: { id }, include: { templates: { orderBy: { createdAt: "asc" } } } });
  const marca = `/b/${id}/marca`;
  const colors = [
    [t("Principal", "Primary"), b.color],
    [t("Secundario", "Secondary"), b.color2],
    [t("Acento", "Accent"), b.color3],
  ].filter(([, c]) => c) as [string, string][];
  const heading = fontId(b.fontHeading);
  const own = b.templates.map((x) => ({ key: x.id, name: x.name }));
  const tpls = (own.length ? own : BUILTIN_TEMPLATES.map((x, i) => ({ key: `builtin-${i}`, name: builtinTemplateName(x.name, lang) }))).slice(0, 4);
  const v = b.createdAt.getTime().toString(36) + (b.templates.at(-1)?.createdAt.getTime().toString(36) ?? "");
  const bookIsPdf = /\.pdf($|\?)/i.test(b.brandBookUrl);
  const missing = [!b.logoUrl && t("logo", "logo"), !b.brandBookUrl && t("manual de marca", "brand book"), !own.length && t("plantillas propias", "your own templates")].filter(Boolean);

  return (
    <>
      <PageHead
        business={b}
        prefix={t("Ajustes de", "Settings for")}
        title={t("Ajustes del negocio", "Business settings")}
        subtitle={t("Los datos de tu negocio, lo que sabe la IA y un resumen de tu marca.", "Your business details, what the AI knows, and a summary of your brand.")}
      />

      <nav className={s.jump} aria-label={t("Secciones", "Sections")}>
        <a href="#datos">{t("Datos del negocio", "Business details")}</a>
        <a href="#marca">{t("Tu marca", "Your brand")}</a>
        <a href="#ia">{t("IA", "AI")}</a>
        <a href="#peligro">{t("Zona de peligro", "Danger zone")}</a>
      </nav>

      <form id="datos" action={updateBusiness.bind(null, id)} className={`card ${s.section}`}>
        <div className={s.head}>
          <h2>{t("Datos del negocio", "Business details")}</h2>
          <p className="small muted">{t("El nombre y la página web que usa la app en tus diseños, artículos y SEO.", "The name and website the app uses in your designs, articles and SEO.")}</p>
        </div>
        <div className={s.fields}>
          <div className="stack"><label className="lbl" htmlFor="name">{t("Nombre", "Name")}</label><input id="name" name="name" className="field" defaultValue={b.name} required /></div>
          <div className="stack"><label className="lbl" htmlFor="website">{t("Sitio web", "Website")}</label><input id="website" name="website" type="url" className="field" defaultValue={b.website} placeholder="https://" /></div>
        </div>
        <div><button className="btn on" type="submit">{t("Guardar", "Save")}</button></div>
      </form>

      <section id="marca" className={`card ${s.section}`} aria-labelledby="marca-title">
        <div className={s.headRow}>
          <div className={s.head}>
            <h2 id="marca-title">{t("Tu marca", "Your brand")}</h2>
            <p className="small muted">{t("Todo lo que tiene tu marca, en un vistazo. Se cambia en la sección Marca.", "Everything your brand has, at a glance. You change it in the Brand section.")}</p>
          </div>
          <Link className="btn outline" href={marca}>{t("Editar en Marca →", "Edit in Brand →")}</Link>
        </div>

        {missing.length > 0 && (
          <p className="note">
            {t("Te falta: ", "Still missing: ")}
            {missing.join(", ")}. <Link href={marca}>{t("Complétalo en Marca", "Complete it in Brand")}</Link>.
          </p>
        )}

        <div className={s.brandGrid}>
          <div className={s.tile}>
            <span className={s.tileTitle}>{t("Logotipo", "Logo")}</span>
            <div className={s.logos}>
              <div className={s.logoBox} style={{ background: "#ffffff" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {b.logoUrl ? <img src={b.logoUrl} alt={t("Logo principal", "Main logo")} /> : <span className={s.none} style={{ color: "#5d6b7e" }}>{t("Sin logo", "No logo")}</span>}
              </div>
              <div className={s.logoBox} style={{ background: "#0b1220" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {b.logoLightUrl ? <img src={b.logoLightUrl} alt={t("Logo blanco", "White logo")} /> : <span className={s.none} style={{ color: "#8c9ab3" }}>{t("Sin logo blanco", "No white logo")}</span>}
              </div>
            </div>
            <Link className={s.edit} href={`${marca}#logos`}>{b.logoUrl ? t("Cambiar logos", "Change logos") : t("Subir logo", "Upload logo")}</Link>
          </div>

          <div className={s.tile}>
            <span className={s.tileTitle}>{t("Colores", "Colors")}</span>
            <div className={s.swatches}>
              {colors.map(([label, c]) => (
                <div key={label} className={s.swatch}>
                  <span className={s.chip} style={{ background: c }} />
                  <span className="stack" style={{ gap: 0 }}>
                    <strong className="small">{label}</strong>
                    <span className={s.hex}>{c}</span>
                  </span>
                </div>
              ))}
            </div>
            <Link className={s.edit} href={`${marca}#colores`}>{t("Cambiar colores", "Change colors")}</Link>
          </div>

          <div className={s.tile}>
            <span className={s.tileTitle}>{t("Tipografía", "Typography")}</span>
            <div className={s.fontSample} style={{ fontFamily: FONT_CSS[heading], color: b.color }}>Aa</div>
            <span className="small">
              {t("Titulares: ", "Headlines: ")}
              <strong>{FONTS[heading].name}</strong>
            </span>
            <span className="small">
              {t("Texto: ", "Body text: ")}
              <strong>{b.fontBody || t("no definida", "not set")}</strong>
            </span>
            <Link className={s.edit} href={`${marca}#letras`}>{t("Cambiar letras", "Change fonts")}</Link>
          </div>

          <div className={s.tile}>
            <span className={s.tileTitle}>{t("Manual de marca", "Brand book")}</span>
            {b.brandBookUrl ? (
              <a className={s.book} href={b.brandBookUrl} target="_blank" rel="noopener noreferrer">
                <span className={s.bookIcon} aria-hidden="true">{bookIsPdf ? "PDF" : "IMG"}</span>
                <span>{t("Abrir tu manual de marca", "Open your brand book")}</span>
              </a>
            ) : (
              <span className="small muted">{t("Todavía no has subido tu manual de marca.", "You haven't uploaded your brand book yet.")}</span>
            )}
            <Link className={s.edit} href={`${marca}#manual`}>{b.brandBookUrl ? t("Subir otro", "Upload another") : t("Subir manual", "Upload brand book")}</Link>
          </div>
        </div>

        <div className={s.tile}>
          <div className={s.headRow}>
            <span className={s.tileTitle}>
              {own.length
                ? t(`Plantillas de diseño (${own.length} tuyas)`, `Design templates (${own.length} of yours)`)
                : t("Plantillas de diseño (de fábrica)", "Design templates (built-in)")}
            </span>
            <Link className={s.edit} href={`${marca}#plantillas`}>{own.length ? t("Ver todas", "See all") : t("Crear las tuyas con IA", "Create yours with AI")}</Link>
          </div>
          <div className={s.thumbs}>
            {tpls.map((x) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={x.key} src={`/api/plantilla?b=${id}&t=${x.key}&v=${v}-${b.color}${b.fontHeading}`} alt={t(`Plantilla ${x.name}`, `${x.name} template`)} loading="lazy" />
            ))}
          </div>
        </div>

        {(b.brandVoice || b.hashtags) && (
          <div className={s.voice}>
            {b.brandVoice && (
              <p className="small">
                <strong>{t("Voz: ", "Voice: ")}</strong>
                {b.brandVoice.length > 220 ? `${b.brandVoice.slice(0, 220)}…` : b.brandVoice}
              </p>
            )}
            {b.hashtags && (
              <p className="small">
                <strong>Hashtags: </strong>
                {b.hashtags}
              </p>
            )}
          </div>
        )}
      </section>

      <form id="ia" action={updateAiSettings.bind(null, id)} className={`card ${s.section}`}>
        <div className={s.head}>
          <h2>{t("Agente de IA", "AI agent")}</h2>
          <p className="small muted">
            {t("Cuéntale a la IA sobre tu negocio. Solo usará estos datos: no inventa precios, teléfonos ni resultados. ¿No sabes qué poner? El", "Tell the AI about your business. It will only use this info: it doesn't make up prices, phone numbers, or results. Not sure what to write? The")}{" "}
            <Link href={`/b/${id}/estudio`}>{t("Estudio del negocio", "Business study")}</Link> {t("lo escribe por ti.", "writes it for you.")}
          </p>
        </div>
        <div className="stack">
          <label className="lbl" htmlFor="aiProfile">{t("Sobre el negocio", "About the business")}</label>
          <textarea
            id="aiProfile"
            name="aiProfile"
            className="field"
            maxLength={4000}
            defaultValue={b.aiProfile}
            placeholder={t(
              "Ej.: Somos ajustadores públicos con licencia en Florida. Ayudamos a dueños de casa con reclamos por huracán, agua, fuego y techo. Hablamos español e inglés. Teléfono: … Evaluación inicial gratis. Zona: Miami-Dade y Broward.",
              "E.g.: We're licensed public adjusters in Florida. We help homeowners with hurricane, water, fire, and roof claims. We speak Spanish and English. Phone: … Free initial assessment. Area: Miami-Dade and Broward.",
            )}
          />
        </div>
        <div className={s.fields}>
          <div className="stack" style={{ gap: 4 }}>
            <label className="lbl" htmlFor="aiText">{t("IA para escribir", "AI for writing")}</label>
            <select id="aiText" name="aiText" className="field" defaultValue={b.aiText}>
              <option value="">{t("Automático", "Automatic")}</option>
              {availableText().map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <label className="lbl" htmlFor="aiImage">{t("IA para fotos", "AI for photos")}</label>
            <select id="aiImage" name="aiImage" className="field" defaultValue={b.aiImage}>
              <option value="">{t("Automático", "Automatic")}</option>
              {availableImage().map((p) => <option key={p.id} value={p.id}>{t(p.name, p.nameEn)}</option>)}
            </select>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" name="aiAutopublish" defaultChecked={b.aiAutopublish} style={{ marginTop: 4 }} />
          <span>
            <strong>{t("Publicar automáticamente lo que planee la IA", "Automatically post what the AI plans")}</strong>
            <span className="small muted" style={{ display: "block" }}>{t("Si lo activas, el plan semanal sale solo, sin que lo revises. Recomendado: déjalo apagado hasta que confíes en lo que escribe.", "If you turn this on, the weekly plan goes out on its own, without you reviewing it. Recommended: leave it off until you trust what it writes.")}</span>
          </span>
        </label>
        <div><button className="btn on" type="submit">{t("Guardar", "Save")}</button></div>
      </form>

      <details id="peligro" className={`card ${s.danger}`}>
        <summary>
          <span className={s.dangerTitle}>{t("Zona de peligro", "Danger zone")}</span>
          <span className="small muted">{t("Borrar este negocio de la app", "Delete this business from the app")}</span>
        </summary>
        <form action={deleteBusiness.bind(null, id)} className="stack" style={{ gap: 12 }}>
          <p className="small muted">{t("Se borran sus conexiones, contactos e historial en esta app. No se borra nada de Facebook, Instagram ni de tus otras cuentas.", "This deletes its connections, contacts, and history in this app. Nothing is deleted from Facebook, Instagram, or your other accounts.")}</p>
          <div className="stack">
            <label className="small" style={{ fontWeight: 500 }} htmlFor="confirm">{t(`Escribe "${b.name}" para confirmar`, `Type "${b.name}" to confirm`)}</label>
            <input id="confirm" name="confirm" className="field" autoComplete="off" />
          </div>
          <div><button className="btn danger" type="submit">{t("Borrar negocio", "Delete business")}</button></div>
        </form>
      </details>
    </>
  );
}
