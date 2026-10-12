import { redirect } from "next/navigation";
import { myBusinessesWhere, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  // El primer negocio de las organizaciones de esta persona (src/lib/auth.ts). El centro de MATYA es solo para el
  // Administrador; los demás papeles empiezan en Inicio.
  const user = await requireUser();
  const first = await db.business.findFirst({ where: await myBusinessesWhere(), orderBy: { createdAt: "asc" }, select: { id: true, organizationId: true } });
  if (!first) redirect("/negocios/nuevo");
  const admin = user.memberships.some((m) => m.organizationId === first.organizationId && m.role === "admin");
  redirect(`/b/${first.id}/${process.env.MATYA_AGENT_ENABLED === "true" && admin ? "matya" : "inicio"}`);
}
