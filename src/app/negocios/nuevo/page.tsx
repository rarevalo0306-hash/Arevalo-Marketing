import { createBusiness } from "@/app/actions";
import { Sidebar } from "@/components/Sidebar";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";

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
            <p className="muted">{t("Cada negocio tiene su color, sus cuentas conectadas y sus contactos.", "Each business has its own color, connected accounts, and contacts.")}</p>
          </div>
        </div>
        <form action={createBusiness} className="card" style={{ maxWidth: 560 }}>
          <div className="stack">
            <label className="lbl" htmlFor="name">{t("Nombre del negocio", "Business name")}</label>
            <input id="name" name="name" className="field" required placeholder={t("Ej.: Ricardo Public Adjusters", "E.g.: Ricardo Public Adjusters")} />
          </div>
          <div className="stack">
            <label className="lbl" htmlFor="website">{t("Sitio web (opcional)", "Website (optional)")}</label>
            <input id="website" name="website" type="url" className="field" placeholder="https://" />
          </div>
          <div className="stack">
            <label className="lbl" htmlFor="color">{t("Color del negocio", "Business color")}</label>
            <input id="color" name="color" type="color" defaultValue="#126BBC" style={{ width: 80, height: 44, border: 0, padding: 0, background: "none" }} />
          </div>
          <div>
            <button className="primary" type="submit">{t("Crear negocio", "Create business")}</button>
          </div>
        </form>
      </main>
    </div>
  );
}
