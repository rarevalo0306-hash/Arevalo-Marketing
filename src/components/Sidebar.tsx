import Link from "next/link";
import { logout } from "@/app/actions";
import { loadApprovals } from "@/lib/approvals";
import { myBusinessesWhere, requireUser } from "@/lib/auth";
import { approvalTotal } from "@/lib/approvals-shape";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { AppPreferences } from "./AppPreferences";
import { MobileBizMenu } from "./MobileBizMenu";
import { NavLinks } from "./NavLinks";
import { BizSwitcher } from "./nav/BizSwitcher";
import navStyles from "./nav/Nav.module.css";

export async function Sidebar({ activeId }: { activeId?: string }) {
  // Solo los negocios de las organizaciones de esta persona (src/lib/auth.ts).
  const user = await requireUser();
  const [businesses, approvals] = await Promise.all([
    db.business.findMany({ where: await myBusinessesWhere(), orderBy: { createdAt: "asc" }, select: { id: true, name: true, color: true } }),
    activeId ? loadApprovals(activeId).catch(() => []) : Promise.resolve([]),
  ]);
  const { t } = await getT();
  const list = businesses.map((b) => ({ id: b.id, name: b.name, color: b.color }));
  // Lo que espera la aprobación del dueño: numerito turquesa en «Inicio».
  const waiting = approvalTotal(approvals);
  const orgs = user.memberships.map((m) => m.organization.name).join(" · ");
  return (
    <>
      <nav className="sidebar" aria-label={t("Menú principal", "Main menu")}>
        <Link href="/" className="brandmark">Matya</Link>

        <MobileBizMenu businesses={list} activeId={activeId}>
          <form action={logout}>
            <button type="submit" className="biz" style={{ width: "100%", background: "none", border: 0, cursor: "pointer", font: "inherit" }}>
              {t("Salir", "Log out")}
            </button>
          </form>
        </MobileBizMenu>

        <BizSwitcher businesses={list} activeId={activeId} />

        {activeId && <NavLinks businessId={activeId} badges={waiting ? { inicio: waiting } : undefined} />}

        <p className={`desk-only small muted ${navStyles.side}`} style={{ marginTop: "auto", padding: "0 12px", overflowWrap: "anywhere" }}>
          {orgs && <span style={{ display: "block", fontWeight: 600 }}>{orgs}</span>}
          {user.email}
        </p>
        <form action={logout} className={`desk-only ${navStyles.side}`}>
          <button type="submit" className={navStyles.row}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>
            {t("Salir", "Log out")}
          </button>
        </form>
      </nav>
      <AppPreferences />
    </>
  );
}
