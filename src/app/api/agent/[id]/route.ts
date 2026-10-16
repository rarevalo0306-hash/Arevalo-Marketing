import { after, NextResponse } from "next/server";
import { z } from "zod";
import { AgentError, requireAgentOwner, sameOrigin } from "@/lib/agent/access";
import {
  changeRun,
  enqueue,
  pauseAll,
  resumeAll,
  saveSettings,
} from "@/lib/agent/queue";
import { runAgentCycle, snapshot, verifyNews } from "@/lib/agent/service";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
const response = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
function failure(e: unknown) {
  if (e instanceof AgentError) return response({ error: e.message }, e.status);
  if (e instanceof z.ZodError || e instanceof SyntaxError)
    return response({ error: "Revisa los campos del formulario." }, 400);
  if (typeof e === "object" && e && "code" in e && e.code === "P2021")
    return response(
      {
        error:
          "Falta aplicar la migración del centro de MATYA en este entorno.",
      },
      503,
    );
  console.error(
    "MATYA request failed",
    e instanceof Error ? e.name : "unknown",
  );
  return response(
    {
      error:
        "No se pudo completar la solicitud. Tus datos guardados se conservan.",
    },
    500,
  );
}
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireAgentOwner(id);
    return response(await snapshot(id));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(req);
    const { id } = await params;
    await requireAgentOwner(id);
    if (Number(req.headers.get("content-length") ?? 0) > 60000)
      throw new AgentError("La solicitud es demasiado grande.", 413);
    const text = await req.text();
    if (text.length > 60000)
      throw new AgentError("La solicitud es demasiado grande.", 413);
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AgentError("Solicitud no válida.");
    if (body.action === "settings") {
      await saveSettings(id, body.settings);
      return response({ ok: true });
    }
    if (body.action === "verify_news") {
      await verifyNews(
        id,
        z.string().max(100).parse(body.newsId),
        z.string().parse(body.eventDate),
        z.string().parse(body.factStatus),
        z.string().parse(body.summary),
      );
      return response({ ok: true });
    }
    // "Pausar todo": nothing runs after it, so there is no cycle to start.
    if (body.action === "pause_all") {
      await pauseAll(id);
      return response({ ok: true });
    }
    let runId: string | undefined;
    if (["cancel", "approve", "refresh", "redo"].includes(body.action))
      await changeRun(id, z.string().max(100).parse(body.runId), body.action);
    else if (body.action === "resume_all") await resumeAll(id);
    else if (body.action === "message") runId = (await enqueue(id, body)).id;
    else if (body.action !== "work")
      throw new AgentError("Acción desconocida.");
    after(async () => {
      try {
        await runAgentCycle(id);
      } catch {
        console.error("MATYA background cycle did not complete");
      }
    });
    return response({ ok: true, runId }, 202);
  } catch (e) {
    return failure(e);
  }
}
