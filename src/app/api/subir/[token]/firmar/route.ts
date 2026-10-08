import { clientIp, guard, signFor, type SignBody } from "@/lib/upload";
import { failure, langOf, readBody } from "../reply";

export const dynamic = "force-dynamic";

/** Link de subida: da la dirección para subir UN archivo directo a Cloudflare R2 (el navegador lo sube con PUT). */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await readBody<SignBody>(req);
  const lang = langOf(body);
  try {
    const b = await guard(token, clientIp(req.headers), "sign");
    return Response.json({ ok: true, ...signFor(b.id, body) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e, lang, "firmar");
  }
}
