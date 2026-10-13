import { Sidebar } from "@/components/Sidebar";
import { pageBusiness } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function BusinessLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Solo quien es miembro de la organización de este negocio (src/lib/auth.ts). Cada página lo vuelve a revisar:
  // el layout no corre en todas las navegaciones.
  const { role } = await pageBusiness(id);
  const { t } = await getT();
  return (
    <div className="shell">
      <Sidebar activeId={id} />
      <main className="content">
        {role === "viewer" && (
          <p className="note" role="status" style={{ marginBottom: 16 }}>
            {t(
              "Tienes acceso de «Solo ver»: puedes mirar todo, pero no cambiar nada. Para más permisos, pídeselo al Administrador.",
              "You have View only access: you can look at everything but not change anything. Ask the Administrator for more access.",
            )}
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
