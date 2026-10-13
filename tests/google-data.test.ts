import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// La base, el descifrado y Google se reemplazan: estas pruebas nunca tocan la base ni la red.
const m = vi.hoisted(() => ({
  conns: [] as unknown[],
  connFind: vi.fn(),
  connUpdate: vi.fn(),
  metricDelete: vi.fn(),
  reportFind: vi.fn(),
  reportDelete: vi.fn(),
  purge: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    connection: { findMany: m.connFind, updateMany: m.connUpdate },
    postMetric: { deleteMany: m.metricDelete },
    seoReport: { findMany: m.reportFind, deleteMany: m.reportDelete },
  },
}));
vi.mock("@/lib/crypto", () => ({ decryptJson: (s: string) => JSON.parse(s), encryptJson: (v: unknown) => JSON.stringify(v) }));
vi.mock("@/lib/data-deletion", () => ({ GOOGLE_CHANNELS: ["google", "gsc", "ga4", "youtube"], purgeGoogleChannelData: m.purge }));

import { checkGoogleConnections, pruneSeoReports, pruneYoutubeData, runGoogleDataMaintenance } from "@/lib/google-data";
import { DAY_MS, GOOGLE_REVOKED_GRACE_MS } from "@/lib/google-data-shape";

const H = 3_600_000;
const now = new Date("2026-10-13T13:05:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const oldUpdatedAt = new Date("2026-09-01T00:00:00Z");
const client = { clientId: "cid", clientSecret: "csecret" };

const conn = (id: string, channel: string, secret: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id,
  businessId: `biz-${id}`,
  channel,
  secret: JSON.stringify({ ...client, ...secret }),
  updatedAt: oldUpdatedAt,
  ...extra,
});

/** Google simulado: el refresh token dice qué responde. */
function mockGoogle() {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push(url);
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        const token = new URLSearchParams(String(init.body)).get("refresh_token");
        if (token === "revoked") return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), { status: 400 });
        if (token === "badclient") return new Response(JSON.stringify({ error: "invalid_client", error_description: "The OAuth client was not found." }), { status: 401 });
        if (token === "down") return new Response("backendError", { status: 503 });
        return new Response(JSON.stringify({ access_token: "at" }), { status: 200 });
      }
      if (url.startsWith("https://www.googleapis.com/youtube/v3/channels")) {
        if ((init.headers as Record<string, string>)?.Authorization !== "Bearer at") return new Response("{}", { status: 401 });
        return new Response(JSON.stringify({ items: [{ id: "UC1", snippet: { title: "Canal nuevo" } }] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
  return calls;
}

/** Lo que se guardó en cada updateMany (secreto ya «descifrado»). */
const writes = () =>
  m.connUpdate.mock.calls.map(([a]) => {
    const arg = a as { where: { id: string; updatedAt: Date }; data: { secret?: string; label?: string; updatedAt: Date } };
    return { where: arg.where, updatedAt: arg.data.updatedAt, label: arg.data.label, secret: arg.data.secret ? JSON.parse(arg.data.secret) : undefined };
  });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.GOOGLE_CLIENT_ID = "env-id";
  process.env.GOOGLE_CLIENT_SECRET = "env-secret";
  delete process.env.GOOGLE_REVOKED_PURGE;
  m.conns = [];
  m.connFind.mockImplementation(async () => m.conns);
  m.connUpdate.mockResolvedValue({ count: 1 });
  m.purge.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllGlobals());

describe("checkGoogleConnections", () => {
  it("con un solo cron al día y más conexiones que el máximo, todas se revisan por turno (las menos recientes primero)", async () => {
    mockGoogle();
    // 60 conexiones con el mismo updatedAt; la 55 perdió el permiso. Cada «día» se guarda lo que escribió la revisión.
    m.conns = Array.from({ length: 60 }, (_, i) => conn(`c${i + 1}`, "gsc", { refreshToken: i + 1 === 55 ? "revoked" : "ok" }));
    const apply = () => {
      for (const w of writes()) {
        const row = m.conns.find((c) => (c as { id: string }).id === w.where.id) as { secret: string };
        row.secret = JSON.stringify(w.secret);
      }
      m.connUpdate.mockClear();
    };
    const day1 = await checkGoogleConnections(now, { budgetMs: 30_000, max: 50 });
    expect(day1.checked).toBe(50);
    apply();
    const day2 = await checkGoogleConnections(new Date(now.getTime() + DAY_MS), { budgetMs: 30_000, max: 50 });
    // Primero las 10 que faltaban (nunca revisadas), entre ellas la 55.
    expect(day2.revoked).toBe(1);
    expect(writes().slice(0, 10).map((w) => w.where.id).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `c${i + 51}`).sort());
  });

  it("solo mira canales de Google y no hace nada sin el cliente de Google de la app", async () => {
    const calls = mockGoogle();
    m.conns = [conn("a", "gsc", { refreshToken: "ok" })];
    await checkGoogleConnections(now, { budgetMs: 30_000 });
    expect(m.connFind.mock.calls[0][0]).toMatchObject({ where: { channel: { in: ["google", "gsc", "ga4", "youtube"] } } });

    vi.clearAllMocks();
    delete process.env.GOOGLE_CLIENT_ID;
    expect(await checkGoogleConnections(now, { budgetMs: 30_000 })).toEqual({ checked: 0, revoked: 0, purged: 0, errors: 0 });
    expect(m.connFind).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it("invalid_grant guarda revokedAt sin mover updatedAt y solo si la conexión sigue igual", async () => {
    mockGoogle();
    m.conns = [conn("a", "ga4", { refreshToken: "revoked", propertyId: "123", lastError: "x" })];
    const sum = await checkGoogleConnections(now, { budgetMs: 30_000 });
    expect(sum).toEqual({ checked: 1, revoked: 1, purged: 0, errors: 0 });
    const [w] = writes();
    expect(w.where).toEqual({ id: "a", updatedAt: oldUpdatedAt });
    expect(w.updatedAt).toBe(oldUpdatedAt);
    expect(w.label).toBeUndefined();
    expect(w.secret).toMatchObject({ refreshToken: "revoked", propertyId: "123", lastError: "x", checkedAt: now.toISOString(), revokedAt: now.toISOString() });
    expect(w.secret.okAt).toBeUndefined();
  });

  it("ya marcada y con el borrado encendido: espera su borrado sin volver a revisarse (no ocupa lugar)", async () => {
    const calls = mockGoogle();
    m.conns = [conn("a", "gsc", { refreshToken: "revoked", checkedAt: ago(21 * H), revokedAt: ago(DAY_MS) })];
    expect(await checkGoogleConnections(now, { budgetMs: 30_000 })).toEqual({ checked: 0, revoked: 0, purged: 0, errors: 0 });
    expect(calls).toEqual([]);
    expect(m.purge).not.toHaveBeenCalled();
  });

  it("con el borrado apagado se sigue revisando y conserva la primera fecha de revokedAt", async () => {
    process.env.GOOGLE_REVOKED_PURGE = "off";
    mockGoogle();
    const first = ago(DAY_MS);
    m.conns = [conn("a", "gsc", { refreshToken: "revoked", checkedAt: ago(21 * H), revokedAt: first })];
    await checkGoogleConnections(now, { budgetMs: 30_000 });
    expect(writes()[0].secret).toMatchObject({ checkedAt: now.toISOString(), revokedAt: first });
  });

  it("a los 3 días de la marca borra la conexión y sus datos (con el guardia), sin llamar a Google", async () => {
    const calls = mockGoogle();
    // Primera vuelta: Google dice invalid_grant.
    m.conns = [conn("a", "youtube", { refreshToken: "revoked" })];
    await checkGoogleConnections(now, { budgetMs: 30_000 });
    const marked = writes()[0].secret;
    // Segunda vuelta, pasado el plazo, con lo que quedó guardado.
    const later = new Date(now.getTime() + GOOGLE_REVOKED_GRACE_MS);
    m.conns = [{ ...conn("a", "youtube", {}), secret: JSON.stringify(marked) }];
    m.connUpdate.mockClear();
    const before = calls.length;
    const sum = await checkGoogleConnections(later, { budgetMs: 30_000 });
    expect(sum).toMatchObject({ purged: 1, checked: 0 });
    expect(m.purge).toHaveBeenCalledWith("biz-a", "youtube", { id: "a", updatedAt: oldUpdatedAt });
    expect(calls.length).toBe(before);
    expect(m.connUpdate).not.toHaveBeenCalled();
  });

  it("antes de los 3 días no borra nada", async () => {
    mockGoogle();
    m.conns = [conn("a", "gsc", { refreshToken: "revoked", checkedAt: ago(H), revokedAt: ago(GOOGLE_REVOKED_GRACE_MS - H) })];
    await checkGoogleConnections(now, { budgetMs: 30_000 });
    expect(m.purge).not.toHaveBeenCalled();
    expect(m.connUpdate).not.toHaveBeenCalled();
  });

  it("GOOGLE_REVOKED_PURGE=off: no borra, solo vuelve a revisar", async () => {
    mockGoogle();
    process.env.GOOGLE_REVOKED_PURGE = "off";
    m.conns = [conn("a", "gsc", { refreshToken: "revoked", checkedAt: ago(21 * H), revokedAt: ago(5 * DAY_MS) })];
    const sum = await checkGoogleConnections(now, { budgetMs: 30_000 });
    expect(m.purge).not.toHaveBeenCalled();
    expect(sum).toMatchObject({ checked: 1, revoked: 1 });
  });

  it("si el permiso sirve: borra revokedAt, guarda okAt y vuelve a leer el nombre del canal de YouTube", async () => {
    // Con el borrado apagado, una marcada se vuelve a revisar (si el permiso volvió a servir, se le quita la marca).
    process.env.GOOGLE_REVOKED_PURGE = "off";
    const calls = mockGoogle();
    m.conns = [conn("y", "youtube", { refreshToken: "ok", channelId: "UC1", revokedAt: ago(DAY_MS), checkedAt: ago(21 * H) }, { label: "Canal viejo" })];
    const sum = await checkGoogleConnections(now, { budgetMs: 30_000 });
    expect(sum).toEqual({ checked: 1, revoked: 0, purged: 0, errors: 0 });
    expect(calls.some((u) => u.includes("channels?part=snippet&mine=true"))).toBe(true);
    const [w] = writes();
    expect(w.label).toBe("Canal nuevo");
    expect(w.updatedAt).toBe(oldUpdatedAt);
    expect(w.secret).toMatchObject({ channelId: "UC1", checkedAt: now.toISOString(), okAt: now.toISOString() });
    expect(w.secret).not.toHaveProperty("revokedAt");
  });

  it("si no se puede leer el canal de YouTube, no cuenta como al día (sin okAt ni nombre nuevo)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/token") ? new Response(JSON.stringify({ access_token: "at" }), { status: 200 }) : new Response(JSON.stringify({ error: { message: "forbidden" } }), { status: 403 }),
      ),
    );
    m.conns = [conn("y", "youtube", { refreshToken: "ok" })];
    await checkGoogleConnections(now, { budgetMs: 30_000 });
    const [w] = writes();
    expect(w.label).toBeUndefined();
    expect(w.secret.checkedAt).toBe(now.toISOString());
    expect(w.secret.okAt).toBeUndefined();
  });

  it("invalid_client, 5xx o falta de datos nunca marcan el permiso como quitado, pero sí guardan checkedAt", async () => {
    mockGoogle();
    m.conns = [conn("a", "gsc", { refreshToken: "badclient" }), conn("b", "ga4", { refreshToken: "down" }), conn("c", "gsc", { refreshToken: "ok", clientId: "own-client", clientSecret: "" })];
    const sum = await checkGoogleConnections(now, { budgetMs: 30_000 });
    expect(sum).toEqual({ checked: 3, revoked: 0, purged: 0, errors: 3 });
    for (const w of writes()) {
      expect(w.secret.checkedAt).toBe(now.toISOString());
      expect(w.secret.revokedAt).toBeUndefined();
      expect(w.updatedAt).toBe(oldUpdatedAt);
    }
  });

  it("no revisa lo revisado hace menos de 20 h, ni conexiones sin refresh token o ilegibles", async () => {
    const calls = mockGoogle();
    m.conns = [conn("a", "gsc", { refreshToken: "ok", checkedAt: ago(2 * H) }), conn("b", "gsc", { refreshToken: "" }), { ...conn("c", "gsc", {}), secret: "no-es-json" }];
    const sum = await checkGoogleConnections(now, { budgetMs: 30_000 });
    expect(sum).toEqual({ checked: 0, revoked: 0, purged: 0, errors: 1 });
    expect(calls).toHaveLength(0);
  });

  it("para al llegar al máximo y cuando se acaba el tiempo", async () => {
    const calls = mockGoogle();
    m.conns = [conn("a", "gsc", { refreshToken: "ok" }), conn("b", "gsc", { refreshToken: "ok" }), conn("c", "gsc", { refreshToken: "ok" })];
    expect((await checkGoogleConnections(now, { budgetMs: 30_000, max: 2 })).checked).toBe(2);
    expect(calls).toHaveLength(2);
    expect((await checkGoogleConnections(now, { budgetMs: 0 })).checked).toBe(0);
    expect(calls).toHaveLength(2);
  });
});

describe("borrar lo viejo", () => {
  it("pruneYoutubeData: resultados de más de 28 días y nombres de canal sin leer en 30 días", async () => {
    m.metricDelete.mockResolvedValue({ count: 4 });
    m.conns = [
      conn("old", "youtube", { refreshToken: "ok", okAt: ago(31 * DAY_MS) }, { label: "Canal" }),
      conn("fresh", "youtube", { refreshToken: "ok", okAt: ago(DAY_MS) }, { label: "Canal" }),
      conn("never", "youtube", { refreshToken: "ok" }, { label: "Canal", updatedAt: new Date(now.getTime() - 40 * DAY_MS) }),
    ];
    const r = await pruneYoutubeData(now);
    expect(m.metricDelete).toHaveBeenCalledWith({ where: { channel: "youtube", fetchedAt: { lt: new Date(now.getTime() - 28 * DAY_MS) } } });
    expect(m.connFind.mock.calls[0][0]).toMatchObject({ where: { channel: "youtube", label: { not: "" } } });
    expect(r).toEqual({ metrics: 4, labels: 2 });
    const ids = m.connUpdate.mock.calls.map(([a]) => (a as { where: { id: string } }).where.id);
    expect(ids).toEqual(["old", "never"]);
    expect(m.connUpdate.mock.calls[0][0]).toEqual({ where: { id: "old", updatedAt: oldUpdatedAt }, data: { label: "", updatedAt: oldUpdatedAt } });
  });

  it("pruneSeoReports: solo gsc y ga4; se quedan las más nuevas de cada negocio", async () => {
    m.reportFind.mockImplementation(async (a: { where: { kind: string; businessId?: string }; distinct?: string[] }) => {
      if (a.distinct) return a.where.kind === "gsc" ? [{ businessId: "b1" }] : [];
      return [{ id: "new1" }, { id: "new2" }];
    });
    m.reportDelete.mockResolvedValue({ count: 3 });
    expect(await pruneSeoReports(now)).toBe(3);
    const kinds = m.reportFind.mock.calls.filter(([a]) => (a as { distinct?: string[] }).distinct).map(([a]) => (a as { where: { kind: string } }).where.kind);
    expect(kinds).toEqual(["gsc", "ga4"]);
    expect(m.reportFind).toHaveBeenCalledWith({ where: { businessId: "b1", kind: "gsc" }, orderBy: { createdAt: "desc" }, take: 2, select: { id: true } });
    expect(m.reportDelete).toHaveBeenCalledTimes(1);
    expect(m.reportDelete).toHaveBeenCalledWith({ where: { businessId: "b1", kind: "gsc", createdAt: { lt: new Date(now.getTime() - 45 * DAY_MS) }, id: { notIn: ["new1", "new2"] } } });
  });

  it("runGoogleDataMaintenance: revisa siempre, pero borra lo viejo solo a las 13 UTC", async () => {
    mockGoogle();
    m.metricDelete.mockResolvedValue({ count: 0 });
    m.reportFind.mockResolvedValue([]);
    await runGoogleDataMaintenance(new Date("2026-10-13T09:00:00Z"), { budgetMs: 30_000 });
    expect(m.connFind).toHaveBeenCalledTimes(1);
    expect(m.metricDelete).not.toHaveBeenCalled();
    expect(m.reportFind).not.toHaveBeenCalled();

    const sum = await runGoogleDataMaintenance(now, { budgetMs: 30_000 });
    expect(m.metricDelete).toHaveBeenCalledTimes(1);
    expect(m.reportFind).toHaveBeenCalledTimes(2);
    expect(sum).toEqual({ checked: 0, revoked: 0, purged: 0, errors: 0, metrics: 0, labels: 0, reports: 0 });
  });

  it("runGoogleDataMaintenance: si la revisión falla, igual borra lo viejo", async () => {
    m.connFind.mockRejectedValueOnce(new Error("db caída"));
    m.metricDelete.mockResolvedValue({ count: 2 });
    m.reportFind.mockResolvedValue([]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sum = await runGoogleDataMaintenance(now, { budgetMs: 30_000 });
    expect(sum).toMatchObject({ errors: 1, metrics: 2 });
  });
});
