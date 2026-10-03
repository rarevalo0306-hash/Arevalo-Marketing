import { publishDue } from "@/lib/publish";
import { safeEqual } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Publica lo programado. Llámalo cada minuto con: Authorization: Bearer <CRON_SECRET>. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return new Response("No autorizado", { status: 401 });
  const published = await publishDue();
  return Response.json({ published });
}
