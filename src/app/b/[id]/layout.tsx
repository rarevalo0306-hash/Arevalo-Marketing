import { notFound } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function BusinessLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await db.business.findUnique({ where: { id }, select: { id: true } });
  if (!b) notFound();
  return (
    <div className="shell">
      <Sidebar activeId={id} />
      <main className="content">{children}</main>
    </div>
  );
}
