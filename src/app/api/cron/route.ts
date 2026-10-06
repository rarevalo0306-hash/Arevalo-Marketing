import { after } from "next/server";
import { getT } from "@/lib/i18n-server";
import { publishDue } from "@/lib/publish";
import { runDueRankChecks } from "@/lib/seo/rank";
import { safeEqual } from "@/lib/session";

export const dynamic = "force-dynamic";
// La revisión diaria de posiciones en Google (después de responder) puede tardar 1-2 minutos.
export const maxDuration = 300;

/** Publica lo programado. Llámalo cada minuto con: Authorization: Bearer <CRON_SECRET>. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    const { t } = await getT();
    return new Response(t("No autorizado", "Unauthorized"), { status: 401 });
  }
  const published = await publishDue();
  // Posiciones en Google: como mucho UN negocio por llamada, después de responder (no retrasa ni rompe lo de publicar).
  after(async () => {
    try {
      const rank = await runDueRankChecks();
      if (rank) console.log("[posiciones] revisión diaria:", JSON.stringify(rank));
    } catch (e) {
      console.error("[posiciones] error en la revisión diaria:", e);
    }
  });
  return Response.json({ published });
}
