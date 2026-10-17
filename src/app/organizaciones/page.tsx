import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { ClientOrgs } from "@/components/orgs/ClientOrgs";
import s from "@/components/orgs/Orgs.module.css";
import { requireUser } from "@/lib/auth";
import { listClientOrgs } from "@/lib/client-orgs-store";
import { getT } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

/**
 * «Organizaciones»: las organizaciones de cliente de la cuenta y los negocios de cada una. Solo la ve su Administrador;
 * si administra varias cuentas, ?cuenta=<id> elige cuál (si no, la primera).
 */
export default async function OrganizacionesPage({ searchParams }: { searchParams: Promise<{ cuenta?: string | string[] }> }) {
  const user = await requireUser();
  const { cuenta: wanted } = await searchParams;
  const { t } = await getT();
  const accounts = user.memberships.filter((m) => m.role === "admin").map((m) => m.organization);
  const account = accounts.find((a) => a.id === wanted) ?? accounts[0];

  if (!account)
    return (
      <div className="shell">
        <Sidebar />
        <main className="content">
          <header className="page-head">
            <div>
              <h1>{t("Organizaciones", "Organizations")}</h1>
            </div>
          </header>
          <div className="card">
            <p>{t("Solo el Administrador puede ver y cambiar las organizaciones.", "Only the Administrator can see and change the organizations.")}</p>
          </div>
        </main>
      </div>
    );

  const orgs = await listClientOrgs(account.id);

  return (
    <div className="shell">
      <Sidebar />
      <main className="content">
        <ClientOrgs key={account.id} accountId={account.id} accountName={account.name} orgs={orgs}>
          {accounts.length > 1 && (
            <nav className={`tabs ${s.tabs}`} aria-label={t("Cuentas que administras", "Accounts you manage")}>
              {accounts.map((a) => (
                <Link key={a.id} href={`/organizaciones?cuenta=${encodeURIComponent(a.id)}`} className={`tab ${a.id === account.id ? "on" : ""}`} aria-current={a.id === account.id ? "page" : undefined}>
                  {a.name}
                </Link>
              ))}
            </nav>
          )}
        </ClientOrgs>
      </main>
    </div>
  );
}
