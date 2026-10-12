import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { TeamBoard } from "@/components/team/TeamBoard";
import s from "@/components/team/Team.module.css";
import { requireUser } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import { INVITE_DAYS, RESET_MINUTES, teamOf } from "@/lib/team";
import { fmtDate } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * «Equipo y permisos»: quién puede entrar a la organización, con qué papel y a qué empresas. Solo la ve su
 * Administrador; si administra varias organizaciones, ?org=<id> elige cuál (si no, la primera).
 */
export default async function TeamPage({ searchParams }: { searchParams: Promise<{ org?: string | string[] }> }) {
  const user = await requireUser();
  const { org: wanted } = await searchParams;
  const { lang, t } = await getT();
  const orgs = user.memberships.filter((m) => m.role === "admin").map((m) => m.organization);
  const org = orgs.find((o) => o.id === wanted) ?? orgs[0];

  if (!org)
    return (
      <div className="shell">
        <Sidebar />
        <main className="content">
          <header className="page-head">
            <div>
              <h1>{t("Equipo", "Team")}</h1>
            </div>
          </header>
          <div className="card">
            <p>{t("Solo el Administrador puede ver y cambiar el equipo.", "Only the Administrator can see and change the team.")}</p>
          </div>
        </main>
      </div>
    );

  const team = await teamOf(org.id);
  // Fechas ya en texto (hora del negocio), para que el servidor y el navegador muestren lo mismo.
  const members = team.members.map((m) => ({
    membershipId: m.membershipId,
    userId: m.userId,
    email: m.email,
    name: m.name,
    role: m.role,
    allBusinesses: m.allBusinesses,
    businessIds: m.businessIds,
    lastLogin: m.lastLoginAt ? fmtDate(m.lastLoginAt, lang) : null,
    owner: m.owner,
  }));
  const invitations = team.invitations.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    allBusinesses: i.role === "admin" || i.allBusinesses,
    businessIds: i.businessIds,
    expires: fmtDate(i.expiresAt, lang),
  }));
  const people = members.length;
  const pending = invitations.length;

  return (
    <div className="shell">
      <Sidebar />
      <main className="content">
        <header className="page-head">
          <div>
            {orgs.length > 1 && (
              <nav className={`tabs ${s.orgs}`} aria-label={t("Organizaciones que administras", "Organizations you manage")}>
                {orgs.map((o) => (
                  <Link key={o.id} href={`/equipo?org=${encodeURIComponent(o.id)}`} className={`tab ${o.id === org.id ? "on" : ""}`} aria-current={o.id === org.id ? "page" : undefined}>
                    {o.name}
                  </Link>
                ))}
              </nav>
            )}
            <h1>{t("Equipo", "Team")}</h1>
            <p className="page-sub">{t(`Quién puede entrar a «${team.org.name}» y qué puede hacer`, `Who can get into "${team.org.name}" and what they can do`)}</p>
          </div>
          <div className={s.counts}>
            <span className="pill neutral">{t(`${people} ${people === 1 ? "persona" : "personas"}`, `${people} ${people === 1 ? "person" : "people"}`)}</span>
            {pending > 0 && (
              <span className="pill warn">
                {t(`${pending} ${pending === 1 ? "invitación pendiente" : "invitaciones pendientes"}`, `${pending} pending ${pending === 1 ? "invitation" : "invitations"}`)}
              </span>
            )}
          </div>
        </header>
        <TeamBoard
          key={team.org.id}
          orgId={team.org.id}
          orgName={team.org.name}
          meId={user.id}
          businesses={team.businesses}
          members={members}
          invitations={invitations}
          life={{ inviteDays: INVITE_DAYS, resetMinutes: RESET_MINUTES }}
        />
      </main>
    </div>
  );
}
