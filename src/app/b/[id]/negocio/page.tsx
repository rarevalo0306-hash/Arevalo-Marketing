import Link from "next/link";
import { deleteBusiness, updateAiSettings, updateBusiness } from "@/app/actions";
import { PageHead } from "@/components/PageHead";
import { availableText } from "@/lib/ai";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { availableImage } from "@/lib/imagegen";

export default async function NegocioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getT();
  const b = await db.business.findUniqueOrThrow({ where: { id } });
  return (
    <>
      <PageHead business={b} prefix={t("Ajustes de", "Settings for")} title={t("Ajustes del negocio", "Business settings")} />
      <div className="grid-2">
        <form action={updateBusiness.bind(null, id)} className="card">
          <h2>{t("Datos", "Details")}</h2>
          <div className="stack"><label className="lbl" htmlFor="name">{t("Nombre", "Name")}</label><input id="name" name="name" className="field" defaultValue={b.name} required /></div>
          <div className="stack"><label className="lbl" htmlFor="website">{t("Sitio web", "Website")}</label><input id="website" name="website" type="url" className="field" defaultValue={b.website} placeholder="https://" /></div>
          <div className="stack"><label className="lbl" htmlFor="color">Color</label><input id="color" name="color" type="color" defaultValue={b.color} style={{ width: 80, height: 44, border: 0, padding: 0, background: "none" }} /></div>
          <div><button className="btn on" type="submit">{t("Guardar", "Save")}</button></div>
        </form>
        <Link href={`/b/${id}/marca`} className="card brand-link" style={{ gridColumn: "1 / -1", textDecoration: "none", color: "inherit" }}>
          <h2>{t("Identidad de la marca →", "Brand identity →")}</h2>
          <p className="small muted">{t("Logos, colores, letras, voz y plantillas de diseño ahora están en la sección Marca.", "Logos, colors, fonts, voice, and design templates are now in the Brand section.")}</p>
        </Link>
        <form action={updateAiSettings.bind(null, id)} className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>{t("Agente de IA", "AI agent")}</h2>
          <p className="small muted">
            {t("Cuéntale a la IA sobre tu negocio. Solo usará estos datos: no inventa precios, teléfonos ni resultados. ¿No sabes qué poner? El", "Tell the AI about your business. It will only use this info: it doesn't make up prices, phone numbers, or results. Not sure what to write? The")}{" "}
            <Link href={`/b/${id}/estudio`}>{t("Estudio del negocio", "Business study")}</Link> {t("lo escribe por ti.", "writes it for you.")}
          </p>
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
          <div className="row" style={{ gap: 16 }}>
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
        <form action={deleteBusiness.bind(null, id)} className="card">
          <h2>{t("Borrar negocio", "Delete business")}</h2>
          <p className="small muted">{t("Se borran sus conexiones, contactos e historial en esta app. No se borra nada de Facebook, Instagram ni de tus otras cuentas.", "This deletes its connections, contacts, and history in this app. Nothing is deleted from Facebook, Instagram, or your other accounts.")}</p>
          <div className="stack">
            <label className="small" style={{ fontWeight: 500 }} htmlFor="confirm">{t(`Escribe "${b.name}" para confirmar`, `Type "${b.name}" to confirm`)}</label>
            <input id="confirm" name="confirm" className="field" autoComplete="off" />
          </div>
          <div><button className="btn danger" type="submit">{t("Borrar negocio", "Delete business")}</button></div>
        </form>
      </div>
    </>
  );
}
