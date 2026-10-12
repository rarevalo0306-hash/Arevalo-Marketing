import Link from "next/link";
import { logout } from "@/app/actions";
import { loadApprovals } from "@/lib/approvals";
import { approvalTotal } from "@/lib/approvals-shape";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { LangPicker } from "./I18n";
import { MobileBizMenu } from "./MobileBizMenu";
import { NavLinks } from "./NavLinks";
import { BizSwitcher } from "./nav/BizSwitcher";
import navStyles from "./nav/Nav.module.css";
import { ThemePicker } from "./ThemePicker";

export async function Sidebar({ activeId }: { activeId?: string }) {
  const [businesses, approvals] = await Promise.all([
    db.business.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, color: true } }),
    activeId ? loadApprovals(activeId).catch(() => []) : Promise.resolve([]),
  ]);
  const { t } = await getT();
  const list = businesses.map((b) => ({ id: b.id, name: b.name, color: b.color }));
  // Lo que espera la aprobación del dueño: numerito turquesa en «Inicio».
  const waiting = approvalTotal(approvals);
  return (
    <nav className="sidebar" aria-label={t("Menú principal", "Main menu")}>
      <Link href="/" className="brandmark">Matya</Link>

      <MobileBizMenu businesses={list} activeId={activeId}>
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

      <BizSwitcher businesses={list} activeId={activeId} />

      {activeId && <NavLinks businessId={activeId} badges={waiting ? { inicio: waiting } : undefined} />}

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
