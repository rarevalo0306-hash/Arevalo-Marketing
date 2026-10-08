import { createBusinessFromWeb } from "@/app/actions-study";
import { Sidebar } from "@/components/Sidebar";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import s from "./nuevo.module.css";

export const dynamic = "force-dynamic";

export default async function NewBusiness() {
  const count = await db.business.count();
  const { t } = await getT();
  return (
    <div className="shell">
      <Sidebar />
      <main className="content">
        <div className="page-head">
          <div>
            <h1>{count ? t("Agregar negocio", "Add a business") : t("Bienvenido. Agrega tu primer negocio", "Welcome. Add your first business")}</h1>
            <p className="muted">
              {t(
                "Pon el nombre, tu página web y quién es el dueño o representante. La IA lee tu web y arma el perfil de tu negocio: qué vendes, dónde trabajas y quiénes son tus clientes. Tú solo lo revisas.",
                "Enter the name, your website and who the owner or representative is. The AI reads your site and builds your business profile: what you sell, where you work and who your customers are. You just review it.",
              )}
            </p>
          </div>
        </div>
        <div className={s.wrap}>
          <form action={createBusinessFromWeb} className="card">
            <div className="stack">
              <label className="lbl" htmlFor="name">{t("Nombre del negocio", "Business name")}</label>
              <input id="name" name="name" className="field" required maxLength={120} autoComplete="organization" placeholder={t("Ej.: Ricardo Public Adjusters", "E.g.: Ricardo Public Adjusters")} />
            </div>
            <div className="stack">
              <label className="lbl" htmlFor="website">{t("Tu página web", "Your website")} <span className="small muted">{t("(recomendado)", "(recommended)")}</span></label>
              <input id="website" name="website" type="text" inputMode="url" autoComplete="url" autoCapitalize="none" spellCheck={false} className="field" maxLength={300} placeholder={t("Ej.: ricardopa.com", "E.g.: ricardopa.com")} />
              <span className="small muted">{t("Con tu web, la IA llena casi todo sola. Si no tienes, puedes contarle tú.", "With your website, the AI fills in almost everything. If you don't have one, you can tell it yourself.")}</span>
            </div>
            <fieldset className={s.owner}>
              <legend className="lbl">{t("Dueño o representante", "Owner or representative")}</legend>
              <span className="small muted">{t("A quién le llegan los reportes del negocio.", "Who gets the business reports.")}</span>
              <div className={s.ownerGrid}>
                <div className="stack">
                  <label className="small" htmlFor="ownerName">{t("Nombre", "Name")}</label>
                  <input id="ownerName" name="ownerName" className="field" required maxLength={120} autoComplete="name" placeholder={t("Ej.: Ricardo Arévalo", "E.g.: Ricardo Arevalo")} />
                </div>
                <div className="stack">
                  <label className="small" htmlFor="ownerEmail">{t("Correo", "Email")}</label>
                  <input id="ownerEmail" name="ownerEmail" type="email" className="field" maxLength={200} autoComplete="email" placeholder={t("Ej.: nombre@tunegocio.com", "E.g.: name@yourbusiness.com")} />
                </div>
                <div className="stack">
                  <label className="small" htmlFor="ownerPhone">{t("Teléfono", "Phone")}</label>
                  <input id="ownerPhone" name="ownerPhone" type="tel" className="field" maxLength={40} autoComplete="tel" placeholder={t("Ej.: +505 8888 1234", "E.g.: 305-555-0100")} />
                </div>
              </div>
            </fieldset>
            <div className="stack">
              <label className="lbl" htmlFor="color">{t("Color del negocio", "Business color")}</label>
              <input id="color" name="color" type="color" defaultValue="#126BBC" className={s.color} />
            </div>
            <div>
              <button className="primary" type="submit">{t("Crear negocio y leer mi web →", "Create business and read my website →")}</button>
            </div>
          </form>
          <ol className={s.next} aria-label={t("Qué pasa después", "What happens next")}>
            <li>
              <strong>{t("La IA lee tu web", "The AI reads your website")}</strong>
              <span className="small muted">{t("Inicio, servicios, nosotros y contacto.", "Home, services, about and contact.")}</span>
            </li>
            <li>
              <strong>{t("Tú revisas", "You review")}</strong>
              <span className="small muted">{t("Qué vendes, dónde trabajas y tus clientes, en orden de importancia.", "What you sell, where you work and your customers, in order of importance.")}</span>
            </li>
            <li>
              <strong>{t("Tu estudio queda listo", "Your study is ready")}</strong>
              <span className="small muted">{t("Las búsquedas de Google, ideas para publicar y anuncios.", "Google searches, post ideas and ads.")}</span>
            </li>
          </ol>
        </div>
      </main>
    </div>
  );
}
