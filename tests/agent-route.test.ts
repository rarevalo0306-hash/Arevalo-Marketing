// La ruta del centro de MATYA: las acciones «Pausar todo», «Reanudar» y «Rehacer» llegan a su función, con las mismas
// comprobaciones de siempre (permiso del dueño, mismo origen, campos válidos). Sin base de datos: las funciones son simulacros.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  owner: vi.fn(),
  pauseAll: vi.fn(),
  resumeAll: vi.fn(),
  changeRun: vi.fn(),
  enqueue: vi.fn(),
  saveSettings: vi.fn(),
  runAgentCycle: vi.fn(),
  snapshot: vi.fn(),
  verifyNews: vi.fn(),
}));
// Fuera de una solicitud de Next no hay donde dejar el trabajo de fondo: se corre en el acto.
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => unknown) => void fn(),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/agent/access", async (original) => ({
  ...(await original<typeof import("@/lib/agent/access")>()),
  requireAgentOwner: mocks.owner,
}));
vi.mock("@/lib/agent/queue", () => ({
  pauseAll: mocks.pauseAll,
  resumeAll: mocks.resumeAll,
  changeRun: mocks.changeRun,
  enqueue: mocks.enqueue,
  saveSettings: mocks.saveSettings,
}));
vi.mock("@/lib/agent/service", () => ({
  runAgentCycle: mocks.runAgentCycle,
  snapshot: mocks.snapshot,
  verifyNews: mocks.verifyNews,
}));

import { AgentError } from "@/lib/agent/access";
import { POST } from "@/app/api/agent/[id]/route";

const ORIGIN = "https://app.example";
const send = (body: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
  POST(
    new Request(`${ORIGIN}/api/agent/biz1`, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "biz1" }) },
  );
const json = async (res: Response) => res.json() as Promise<Record<string, unknown>>;
const untouched = () => {
  for (const f of [mocks.pauseAll, mocks.resumeAll, mocks.changeRun, mocks.enqueue, mocks.saveSettings, mocks.runAgentCycle])
    expect(f).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.owner.mockResolvedValue(undefined);
  mocks.runAgentCycle.mockResolvedValue({ steps: 0, published: 0 });
});

describe("POST /api/agent/[id]: pause all, resume and redo", () => {
  it("pause_all pauses this business and does not start work", async () => {
    const res = await send({ action: "pause_all" });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
    expect(mocks.owner).toHaveBeenCalledWith("biz1");
    expect(mocks.pauseAll).toHaveBeenCalledExactlyOnceWith("biz1");
    expect(mocks.runAgentCycle).not.toHaveBeenCalled();
  });

  it("resume_all lifts the pause and lets the cycle run (the morning plan may be due)", async () => {
    const res = await send({ action: "resume_all" });
    expect(res.status).toBe(202);
    expect(mocks.resumeAll).toHaveBeenCalledExactlyOnceWith("biz1");
    expect(mocks.runAgentCycle).toHaveBeenCalledExactlyOnceWith("biz1");
  });

  it("redo asks changeRun to redo that run", async () => {
    const res = await send({ action: "redo", runId: "run-1" });
    expect(res.status).toBe(202);
    expect(mocks.changeRun).toHaveBeenCalledExactlyOnceWith("biz1", "run-1", "redo");
    expect(mocks.runAgentCycle).toHaveBeenCalledExactlyOnceWith("biz1");
  });

  it("redo with a 501-character note is 400", async () => {
    const res = await send({ action: "redo", runId: "run-1", note: "n".repeat(501) });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "Revisa los campos del formulario." });
    expect(mocks.changeRun).not.toHaveBeenCalled();
    expect(mocks.runAgentCycle).not.toHaveBeenCalled();
    // 500 is the longest one that goes through; a note that is not text is refused too.
    expect((await send({ action: "redo", runId: "run-1", note: "n".repeat(500) })).status).toBe(202);
    for (const note of [5, null, ["x"], { text: "x" }]) {
      vi.clearAllMocks();
      expect((await send({ action: "redo", runId: "run-1", note })).status).toBe(400);
      expect(mocks.changeRun).not.toHaveBeenCalled();
    }
  });

  it("redo passes the trimmed note to changeRun", async () => {
    const res = await send({ action: "redo", runId: "run-1", note: "  x  " });
    expect(res.status).toBe(202);
    expect(mocks.changeRun).toHaveBeenCalledExactlyOnceWith("biz1", "run-1", "redo", { note: "x" });
    expect(mocks.changeRun.mock.calls[0][3]).toEqual({ note: "x" });
    expect(mocks.runAgentCycle).toHaveBeenCalledExactlyOnceWith("biz1");
    // The spaces count against nothing: 500 characters plus the spaces around them are still 500.
    vi.clearAllMocks();
    expect((await send({ action: "redo", runId: "run-1", note: ` ${"n".repeat(500)} ` })).status).toBe(202);
    expect(mocks.changeRun.mock.calls[0][3]).toEqual({ note: "n".repeat(500) });
  });

  it("a redo with no text in its note is a plain redo, and only redo carries a note", async () => {
    for (const note of [undefined, "", "   "]) {
      vi.clearAllMocks();
      expect((await send({ action: "redo", runId: "run-1", note })).status).toBe(202);
      expect(mocks.changeRun).toHaveBeenCalledExactlyOnceWith("biz1", "run-1", "redo");
    }
    for (const action of ["cancel", "approve", "refresh"]) {
      vi.clearAllMocks();
      expect((await send({ action, runId: "run-1", note: "x" })).status).toBe(202);
      expect(mocks.changeRun).toHaveBeenCalledExactlyOnceWith("biz1", "run-1", action);
    }
  });

  it("redo needs a run id, like cancel and approve", async () => {
    for (const action of ["redo", "cancel", "approve"]) {
      vi.clearAllMocks();
      const res = await send({ action });
      expect(res.status).toBe(400);
      expect(await json(res)).toEqual({ error: "Revisa los campos del formulario." });
      expect(mocks.changeRun).not.toHaveBeenCalled();
    }
    const long = await send({ action: "redo", runId: "x".repeat(101) });
    expect(long.status).toBe(400);
    expect(mocks.changeRun).not.toHaveBeenCalled();
  });

  it("the actions that already existed keep working", async () => {
    for (const action of ["cancel", "approve", "refresh"]) {
      expect((await send({ action, runId: "run-2" })).status).toBe(202);
      expect(mocks.changeRun).toHaveBeenLastCalledWith("biz1", "run-2", action);
    }
    expect((await send({ action: "work" })).status).toBe(202);
    mocks.enqueue.mockResolvedValue({ id: "run-3" });
    const msg = await send({ action: "message", text: "Hola", requestKey: "abcdefghijklmnop" });
    expect(await json(msg)).toEqual({ ok: true, runId: "run-3" });
  });

  it("an unknown action is refused and changes nothing", async () => {
    const res = await send({ action: "pausar" });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "Acción desconocida." });
    untouched();
  });

  it.each(["pause_all", "resume_all", "redo"])("%s keeps the owner check: someone else changes nothing", async (action) => {
    mocks.owner.mockRejectedValue(new AgentError("Solo el Administrador puede usar el centro de MATYA.", 403));
    const res = await send({ action, runId: "run-1" });
    expect(res.status).toBe(403);
    untouched();
  });

  it.each(["pause_all", "resume_all", "redo"])("%s keeps the same-origin check", async (action) => {
    const attempts: Record<string, string>[] = [{}, { origin: "https://evil.example" }, { origin: ORIGIN, "sec-fetch-site": "cross-site" }];
    for (const headers of attempts) {
      const res = await send({ action, runId: "run-1" }, headers);
      expect(res.status).toBe(403);
    }
    expect(mocks.owner).not.toHaveBeenCalled();
    untouched();
  });

  it("an AgentError from the function reaches the owner with its own status and text", async () => {
    mocks.changeRun.mockRejectedValue(new AgentError("Solo se puede rehacer una pieza que espera tu aprobación después de su revisión."));
    const res = await send({ action: "redo", runId: "run-1" });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: expect.stringContaining("Solo se puede rehacer") });
    expect(mocks.runAgentCycle).not.toHaveBeenCalled();
  });
});
