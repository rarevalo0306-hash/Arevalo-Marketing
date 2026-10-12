import { redirect } from "next/navigation";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const first = await db.business.findFirst({ orderBy: { createdAt: "asc" }, select:{id:true} });
  redirect(first ? `/b/${first.id}/${process.env.MATYA_AGENT_ENABLED==='true'?'matya':'inicio'}` : "/negocios/nuevo");
}
