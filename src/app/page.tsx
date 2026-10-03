import { redirect } from "next/navigation";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const first = await db.business.findFirst({ orderBy: { createdAt: "asc" } });
  redirect(first ? `/b/${first.id}/publicar` : "/negocios/nuevo");
}
