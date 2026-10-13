import Link from "next/link";
import { logout } from "@/app/actions";
import { loadApprovals } from "@/lib/approvals";
import { businessAccess, myBusinessesWhere, requireUser } from "@/lib/auth";
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
  const [businesses, approvals, access] = await Promise.all([
    db.business.findMany({ where: await myBusinessesWhere(), orderBy: { createdAt: "asc" }, select: { id: true, name: true, color: true } }),
    activeId ? loadApprovals(activeId).catch(() => []) : Promise.resolve([]),
    activeId ? businessAccess(activeId) : Promise.resolve(null),
  ]);
  const { t } = await getT();
  const list = businesses.map((b) => ({ id: b.id, name: b.name, color: b.color }));
  // Lo que espera la aprobación del dueño: numerito turquesa en «Inicio».
  const waiting = approvalTotal(approvals);
  const orgs = user.memberships.map((m) => m.organization.name).join(" · ");
  // El centro de MATYA es solo del Administrador; «Equipo y permisos» y «Agregar negocio» aparecen si administra alguna organización.
  const role = access?.ok ? access.role : null;
  const hide = role && role !== "admin" ? ["matya"] : undefined;
  const managesTeam = user.memberships.some((m) => m.role === "admin");
  const teamLink = (className: string) => (
    <Link href="/equipo" className={className}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.3-6 6.5-6s5.9 2.4 6.5 6" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.4c1.7.8 2.8 2.9 3 5.6" /></svg>
      {t("Equipo y permisos", "Team & permissions")}
    </Link>
  );
  return (
    <>
      <nav className="sidebar" aria-label={t("Menú principal", "Main menu")}>
        <Link href="/" className="brandmark">Matya</Link>

        <MobileBizMenu businesses={list} activeId={activeId} canAdd={managesTeam}>
          {managesTeam && teamLink("biz")}
          <form action={logout}>
            <button type="submit" className="biz" style={{ width: "100%", background: "none", border: 0, cursor: "pointer", font: "inherit" }}>
              {t("Salir", "Log out")}
            </button>
          </form>
        </MobileBizMenu>

        <BizSwitcher businesses={list} activeId={activeId} canAdd={managesTeam} />

        {activeId && <NavLinks businessId={activeId} badges={waiting ? { inicio: waiting } : undefined} hide={hide} />}

        {managesTeam && <div className={`desk-only ${navStyles.side}`} style={{ marginTop: "auto" }}>{teamLink(navStyles.row)}</div>}
        <p className={`desk-only small muted ${navStyles.side}`} style={{ marginTop: managesTeam ? 0 : "auto", padding: "0 12px", overflowWrap: "anywhere" }}>
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
