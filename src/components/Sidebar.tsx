import Link from "next/link";
import { logout } from "@/app/actions";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { LangPicker } from "./I18n";
import { MobileBizMenu } from "./MobileBizMenu";
import { NavLinks } from "./NavLinks";
import navStyles from "./nav/Nav.module.css";
import { ThemePicker } from "./ThemePicker";

export async function Sidebar({ activeId }: { activeId?: string }) {
  const businesses = await db.business.findMany({ orderBy: { createdAt: "asc" } });
  const { t } = await getT();
  return (
    <nav className="sidebar" aria-label={t("Menú principal", "Main menu")}>
      <Link href="/" className="brandmark"><span className="logo">M</span>Matya</Link>

      <MobileBizMenu businesses={businesses.map((b) => ({ id: b.id, name: b.name, color: b.color }))} activeId={activeId}>
        <div className="mbiz-label">{t("Idioma", "Language")}</div>
        <LangPicker />
        <div className="mbiz-label">{t("Estilo", "Style")}</div>
        <ThemePicker />
        <form action={logout}>
          <button type="submit" className="biz" style={{ width: "100%", background: "none", border: 0, cursor: "pointer", font: "inherit" }}>
            {t("Salir", "Log out")}
          </button>
        </form>
      </MobileBizMenu>

      <div className="stack desk-only" style={{ gap: 2 }}>
        <div className="side-label">{t("Mis negocios", "My businesses")}</div>
        {businesses.map((b) => (
          <Link
            key={b.id}
            href={`/b/${b.id}/inicio`}
            className={b.id === activeId ? "biz on" : "biz"}
            aria-current={b.id === activeId ? "true" : undefined}
          >
            <span className="dot" style={{ background: b.color }}>{b.name.trim().charAt(0).toUpperCase()}</span>
            <span style={{ flexGrow: 1 }}>{b.name}</span>
          </Link>
        ))}
        <Link href="/negocios/nuevo" className="biz">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ margin: "0 3px" }}><path d="M12 5v14M5 12h14" /></svg>
          {t("Agregar negocio", "Add business")}
        </Link>
      </div>

      {activeId && (
        <>
          <div className="side-sep" />
          <NavLinks businessId={activeId} />
        </>
      )}

      <div className="stack desk-only" style={{ marginTop: "auto", gap: 8 }}>
        <div className="side-label">{t("Idioma", "Language")}</div>
        <LangPicker />
        <div className="side-label">{t("Estilo", "Style")}</div>
        <ThemePicker />
      </div>
      <form action={logout} className={`desk-only ${navStyles.side}`}>
        <button type="submit" className={navStyles.row}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>
          {t("Salir", "Log out")}
        </button>
      </form>
    </nav>
  );
}
