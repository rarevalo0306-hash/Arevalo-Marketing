import { Sidebar } from "@/components/Sidebar";
import { pageBusiness } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function BusinessLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Solo quien es miembro de la organización de este negocio (src/lib/auth.ts). Cada página lo vuelve a revisar:
  // el layout no corre en todas las navegaciones.
  await pageBusiness(id);
  return (
    <div className="shell">
      <Sidebar activeId={id} />
      <main className="content">{children}</main>
    </div>
  );
}
