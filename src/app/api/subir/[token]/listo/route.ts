import { after } from "next/server";
import { kickUploadAnalysis } from "@/lib/library-sync";
import { clientIp, finishUpload, guard, type DoneBody } from "@/lib/upload";
import { failure, langOf, readBody } from "../reply";

export const dynamic = "force-dynamic";
// Después de responder, la IA mira lo que se subió (de a poco, puede tardar un par de minutos).
export const maxDuration = 300;

/** Link de subida: el archivo ya está en R2. Se revisa que llegó, se guarda en «Tus fotos» y la IA lo mira. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await readBody<DoneBody>(req);
  const lang = langOf(body);
  try {
    const b = await guard(token, clientIp(req.headers), "done");
    const item = await finishUpload(b.id, body);
    if (item.created) {
      after(async () => {
        try {
          await kickUploadAnalysis(b.id, { budgetMs: 240_000 });
        } catch (e) {
          console.error("[subir] la IA no pudo mirar lo subido:", e instanceof Error ? e.message : e);
        }
      });
    }
    return Response.json({ ok: true, id: item.id, kind: item.kind }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e, lang, "listo");
  }
}
