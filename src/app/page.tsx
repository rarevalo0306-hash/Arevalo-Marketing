import { redirect } from "next/navigation";
import { myBusinessesWhere } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  // El primer negocio de las organizaciones de esta persona (src/lib/auth.ts).
  const first = await db.business.findFirst({ where: await myBusinessesWhere(), orderBy: { createdAt: "asc" }, select: { id: true } });
  redirect(first ? `/b/${first.id}/${process.env.MATYA_AGENT_ENABLED === "true" ? "matya" : "inicio"}` : "/negocios/nuevo");
}
