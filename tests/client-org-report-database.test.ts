/** Solo contra la base local aislada (127.0.0.1:55439/matya_agent), nunca contra una base configurada de verdad. */
import type { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { BiError } from "@/lib/i18n";
import { listClientOrgs, saveClientOrgReport } from "@/lib/client-orgs-store";
import { claimCronWeek, runClientOrgReports, sendClientOrgReport } from "@/lib/client-org-report-run";
import { SenderConfigError, sendSeoEmail } from "@/lib/seo/alerts";

// El envío de verdad (Brevo/Resend) se reemplaza; todo lo demás de seo/alerts (SenderConfigError, parseAlertEmails) es el real.
vi.mock("@/lib/seo/alerts", async (orig) => ({ ...(await orig<typeof import("@/lib/seo/alerts")>()), sendSeoEmail: vi.fn() }));

const url = process.env.MATYA_TEST_DATABASE_URL ?? "";
const safe = !!url && process.env.DATABASE_URL === url && /^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/matya_agent$/.test(url);

const A = "corep-it-a";
const B = "corep-it-b";
const NOT_IN_ACCOUNT = "Esa organización no es de esta cuenta.";
const SENDER = { name: "Ricardo Arevalo", email: "r@x.com", apiKey: "k", via: "app" as const };

/** Lunes 2026-10-19 09:00 en Nueva York (EDT): ya pasaron las 8:00 del reporte, así que toca la semana 2026-10-12. */
const now = new Date("2026-10-19T13:00:00Z");
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const WEEK = "2026-10-12";

const send = vi.mocked(sendSeoEmail);

/** Primero los negocios (su organización de cliente y su cuenta los protegen con Restrict), después las cuentas (borran sus organizaciones y sus envíos). */
async function clean() {
  await db.business.deleteMany({ where: { organizationId: { in: [A, B] } } });
  await db.organization.deleteMany({ where: { id: { in: [A, B] } } });
}

/** Una organización de cliente lista para el reporte semanal del lunes a las 8:00 de Nueva York. */
function makeOrg(account: string, over: Partial<Prisma.ClientOrgUncheckedCreateInput> = {}) {
  return db.clientOrg.create({
    data: { organizationId: account, name: "Cliente Uno", reportEmail: "a@x.com, b@y.com", reportLang: "es", reportOn: true, reportDay: 1, reportHour: 8, timezone: "America/New_York", ...over },
  });
}

function makeBusiness(id: string, org: { id: string; organizationId: string }, over: { name?: string; createdAt?: Date } = {}) {
  return db.business.create({ data: { id, name: over.name ?? `Negocio ${id}`, organizationId: org.organizationId, clientOrgId: org.id, ...(over.createdAt ? { createdAt: over.createdAt } : {}) } });
}

const cronRows = (clientOrgId: string) => db.clientOrgReport.findMany({ where: { clientOrgId, trigger: "cron" }, orderBy: { week: "asc" } });

describe.skipIf(!safe)("the weekly client report on an isolated PostgreSQL", () => {
  beforeEach(async () => {
    await clean();
    await db.organization.createMany({ data: [{ id: A, name: "Agencia A IT" }, { id: B, name: "Agencia B IT" }] });
    send.mockReset();
    send.mockResolvedValue(SENDER);
  });
  afterAll(async () => {
    await clean();
    await db.$disconnect();
  });

  it("two automatic runs at the same moment send once", async () => {
    const org = await makeOrg(A);
    await makeBusiness("corep-it-b1", org);
    await Promise.all([runClientOrgReports(now), runClientOrgReports(now)]);
    expect(send).toHaveBeenCalledTimes(1);
    const rows = await cronRows(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ week: WEEK, trigger: "cron", state: "sent", attempts: 1, to: ["a@x.com", "b@y.com"] });
  });

  it("a later run the same week sends nothing", async () => {
    const org = await makeOrg(A);
    await makeBusiness("corep-it-b1", org);
    expect(await runClientOrgReports(now)).toEqual({ checked: 1, sent: 1, errors: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await runClientOrgReports(at(5 * 60))).toEqual({ checked: 0, sent: 0, errors: 0 });
    expect(await runClientOrgReports(at(2 * 24 * 60))).toEqual({ checked: 0, sent: 0, errors: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("an error is retried after 30 minutes, at most 3 attempts, then waits for next week", async () => {
    const org = await makeOrg(A);
    await makeBusiness("corep-it-b1", org);
    for (let i = 0; i < 3; i++) send.mockRejectedValueOnce(new BiError("El proveedor no responde.", "The provider is not answering."));

    expect(await runClientOrgReports(now)).toEqual({ checked: 1, sent: 0, errors: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    await runClientOrgReports(at(29));
    expect(send).toHaveBeenCalledTimes(1);
    await runClientOrgReports(at(30));
    expect(send).toHaveBeenCalledTimes(2);
    await runClientOrgReports(at(60));
    expect(send).toHaveBeenCalledTimes(3);
    await runClientOrgReports(at(120));
    expect(send).toHaveBeenCalledTimes(3);
    expect(await cronRows(org.id)).toMatchObject([{ week: WEEK, state: "error", attempts: 3, error: "El proveedor no responde." }]);

    // Next Monday the provider is back: a new week, a new row, one email.
    await runClientOrgReports(at(7 * 24 * 60));
    expect(send).toHaveBeenCalledTimes(4);
    expect(await cronRows(org.id)).toMatchObject([
      { week: WEEK, state: "error", attempts: 3 },
      { week: "2026-10-19", state: "sent", attempts: 1 },
    ]);
  });

  it("a configuration error is never retried", async () => {
    const org = await makeOrg(A);
    await makeBusiness("corep-it-b1", org);
    send.mockRejectedValue(new SenderConfigError("Falta el email de envío.", "The sending email is missing."));
    await runClientOrgReports(now);
    await runClientOrgReports(at(60));
    expect(send).toHaveBeenCalledTimes(1);
    expect(await cronRows(org.id)).toMatchObject([{ state: "error", attempts: 3, error: "Falta el email de envío." }]);
  });

  it("a send that got stuck in sending for 30 minutes is retried", async () => {
    const org = await makeOrg(A);
    await makeBusiness("corep-it-b1", org);
    const row = await db.clientOrgReport.create({ data: { clientOrgId: org.id, week: WEEK, trigger: "cron", state: "sending", attempts: 1, to: [] } });
    const stamp = (minutesAgo: number) => db.$executeRaw`UPDATE "ClientOrgReport" SET "updatedAt" = ${at(-minutesAgo)} WHERE id = ${row.id}`;

    await stamp(29); // still in progress: leave it alone
    await runClientOrgReports(now);
    expect(send).not.toHaveBeenCalled();

    await stamp(31);
    await runClientOrgReports(now);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await cronRows(org.id)).toMatchObject([{ id: row.id, state: "sent", attempts: 2 }]);
  });

  it("manual and test can repeat in the same week and do not block the automatic one", async () => {
    const org = await makeOrg(A);
    await makeBusiness("corep-it-b1", org);
    const manual = { trigger: "manual", organizationId: A, now } as const;
    expect(await sendClientOrgReport(org.id, manual)).toMatchObject({ state: "sent", week: { week: WEEK } });
    expect(await sendClientOrgReport(org.id, manual)).toMatchObject({ state: "sent" });
    expect(await sendClientOrgReport(org.id, { trigger: "test", organizationId: A, to: ["t@x.com"], now })).toMatchObject({ state: "sent", to: ["t@x.com"] });
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2][0]).toMatchObject({ to: ["t@x.com"] });
    expect(send.mock.calls[2][0].subject).toMatch(/^Prueba · /);

    expect(await runClientOrgReports(now)).toEqual({ checked: 1, sent: 1, errors: 0 });
    expect(send).toHaveBeenCalledTimes(4);
    const all = await db.clientOrgReport.findMany({ where: { clientOrgId: org.id }, select: { trigger: true, state: true } });
    expect(all.filter((r) => r.trigger === "manual")).toHaveLength(2);
    expect(all.filter((r) => r.trigger === "test")).toHaveLength(1);
    expect(all.filter((r) => r.trigger === "cron")).toEqual([{ trigger: "cron", state: "sent" }]);
  });

  it("skips organizations that are off, have no email or have no business", async () => {
    const off = await makeOrg(A, { name: "Apagada", reportOn: false });
    const noEmail = await makeOrg(A, { name: "Sin email", reportEmail: "" });
    await makeOrg(A, { name: "Sin negocio" });
    await makeBusiness("corep-it-off", off);
    await makeBusiness("corep-it-noemail", noEmail);
    expect(await runClientOrgReports(now)).toEqual({ checked: 0, sent: 0, errors: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await db.clientOrgReport.count({ where: { clientOrg: { organizationId: A } } })).toBe(0);
  });

  it("does not send before the send moment of the week", async () => {
    const org = await makeOrg(A);
    await makeBusiness("corep-it-b1", org);
    await runClientOrgReports(new Date("2026-10-19T11:59:00Z")); // 7:59 in New York
    expect(send).not.toHaveBeenCalled();
    expect(await db.clientOrgReport.count({ where: { clientOrgId: org.id } })).toBe(0);
    await runClientOrgReports(new Date("2026-10-19T12:00:00Z")); // 8:00 in New York
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sendClientOrgReport with another account's organizationId is refused and records nothing", async () => {
    const orgB = await makeOrg(B);
    await makeBusiness("corep-it-bb", orgB);
    for (const trigger of ["manual", "test", "cron"] as const) {
      await expect(sendClientOrgReport(orgB.id, { trigger, organizationId: A, to: ["t@x.com"], now })).rejects.toThrow(NOT_IN_ACCOUNT);
    }
    await expect(sendClientOrgReport("corep-it-nobody", { trigger: "manual", organizationId: A, now })).rejects.toThrow(NOT_IN_ACCOUNT);
    expect(send).not.toHaveBeenCalled();
    expect(await db.clientOrgReport.count({ where: { clientOrgId: orgB.id } })).toBe(0);
  });

  it("refuses an organization without businesses or without email before recording anything", async () => {
    const empty = await makeOrg(A, { name: "Sin negocio" });
    const noEmail = await makeOrg(A, { name: "Sin email", reportEmail: "" });
    await makeBusiness("corep-it-noemail", noEmail);
    for (const trigger of ["manual", "cron"] as const) {
      await expect(sendClientOrgReport(empty.id, { trigger, organizationId: A, now })).rejects.toBeInstanceOf(BiError);
      await expect(sendClientOrgReport(noEmail.id, { trigger, organizationId: A, now })).rejects.toBeInstanceOf(BiError);
    }
    await expect(sendClientOrgReport(empty.id, { trigger: "test", organizationId: A, to: ["t@x.com"], now })).rejects.toBeInstanceOf(BiError);
    expect(send).not.toHaveBeenCalled();
    expect(await db.clientOrgReport.count({ where: { clientOrg: { organizationId: A } } })).toBe(0);
  });

  it("the email goes from the first business with the account name, to the parsed emails", async () => {
    const org = await makeOrg(A, { name: "Techos Pérez", reportEmail: "A@x.com; b@y.com" });
    await makeBusiness("corep-it-newer", org, { name: "Segundo", createdAt: new Date("2026-03-02T00:00:00Z") });
    await makeBusiness("corep-it-older", org, { name: "Primero", createdAt: new Date("2026-03-01T00:00:00Z") });
    const out = await sendClientOrgReport(org.id, { trigger: "manual", organizationId: A, now });
    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0][0];
    expect(arg.businessId).toBe("corep-it-older");
    expect(arg.fromName).toBe("Agencia A IT");
    expect(arg.to).toEqual(["a@x.com", "b@y.com"]);
    expect(arg.subject).toMatch(/^Reporte semanal de Techos Pérez/);
    expect(arg.html).toContain("Enviado por Agencia A IT");
    expect(arg.html).toContain("Primero");
    expect(arg.html).toContain("Segundo");
    expect(out).toMatchObject({ state: "sent", to: ["a@x.com", "b@y.com"], subject: arg.subject, sender: SENDER, week: { week: WEEK, fromDay: "2026-10-12", toDay: "2026-10-18" } });
  });

  it("writes in the organization's language", async () => {
    const org = await makeOrg(A, { name: "Roofing Co", reportLang: "en" });
    await makeBusiness("corep-it-b1", org);
    await sendClientOrgReport(org.id, { trigger: "manual", organizationId: A, now });
    expect(send.mock.calls[0][0].subject).toMatch(/^Weekly report for Roofing Co/);
    expect(send.mock.calls[0][0].html).toContain("Sent by Agencia A IT");
  });

  it("each account's organizations go out from their own businesses and account name", async () => {
    const orgA = await makeOrg(A);
    const orgB = await makeOrg(B);
    await makeBusiness("corep-it-ba", orgA);
    await makeBusiness("corep-it-bb", orgB);
    expect(await runClientOrgReports(now)).toEqual({ checked: 2, sent: 2, errors: 0 });
    const calls = send.mock.calls.map((c) => [c[0].businessId, c[0].fromName]).sort();
    expect(calls).toEqual([["corep-it-ba", "Agencia A IT"], ["corep-it-bb", "Agencia B IT"]]);
  });

  it("builds the email only from what the client may see", async () => {
    const org = await makeOrg(A);
    await makeBusiness("corep-it-b1", org);
    const inWeek = new Date("2026-10-14T15:00:00Z");
    const post = await db.post.create({ data: { businessId: "corep-it-b1", text: "Promoción visible del taller", status: "done", scheduledAt: inWeek } });
    await db.postTarget.create({ data: { postId: post.id, channel: "instagram", status: "sent", sentAt: inWeek, externalUrl: "https://instagram.com/p/visible" } });
    const failed = await db.post.create({ data: { businessId: "corep-it-b1", text: "Borrador fallido interno", status: "failed", scheduledAt: inWeek } });
    await db.postTarget.create({ data: { postId: failed.id, channel: "facebook", status: "failed", detail: "TOKEN-VENCIDO-INTERNO", sentAt: inWeek } });
    await db.aiAction.create({ data: { businessId: "corep-it-b1", kind: "post.scheduled", summary: { es: "ACCION-IA-INTERNA", en: "INTERNAL-AI-ACTION" }, actor: "auto", costCents: 4321, createdAt: inWeek } });
    await db.actionTask.create({ data: { businessId: "corep-it-b1", key: "t1", source: "audit", area: "web", title: { es: "TAREA-HECHA-INTERNA", en: "DONE-TASK-INTERNAL" }, status: "done", doneAt: inWeek } });
    await db.actionTask.create({ data: { businessId: "corep-it-b1", key: "t2", source: "audit", area: "web", title: { es: "TAREA-PENDIENTE-INTERNA", en: "TODO-TASK-INTERNAL" }, status: "todo" } });
    await db.aiProposal.create({ data: { businessId: "corep-it-b1", kind: "other", title: { es: "PROPUESTA-IA-INTERNA", en: "INTERNAL-PROPOSAL" }, createdAt: inWeek } });

    await sendClientOrgReport(org.id, { trigger: "manual", organizationId: A, now });
    const { html, text } = send.mock.calls[0][0];
    for (const body of [html, text]) {
      expect(body).toContain("Promoción visible del taller");
      for (const secret of ["INTERNA", "INTERNAL", "TOKEN-VENCIDO", "Borrador fallido", "43.21", "/b/corep-it-b1"]) expect(body).not.toContain(secret);
    }
  });

  it("records a failed send with its message cut to 300 characters and returns the outcome instead of throwing", async () => {
    const org = await makeOrg(A);
    await makeBusiness("corep-it-b1", org);
    send.mockRejectedValueOnce(new Error("x".repeat(500)));
    const out = await sendClientOrgReport(org.id, { trigger: "manual", organizationId: A, now });
    expect(out).toMatchObject({ state: "error", week: { week: WEEK }, to: ["a@x.com", "b@y.com"], error: "x".repeat(300) });
    expect(await db.clientOrgReport.findMany({ where: { clientOrgId: org.id } })).toMatchObject([{ trigger: "manual", state: "error", attempts: 1, error: "x".repeat(300) }]);
  });

  it("stamps every row with the caller's clock, not the database's", async () => {
    const org = await makeOrg(A);
    await makeBusiness("corep-it-b1", org);
    const later = at(90);
    await runClientOrgReports(later);
    const [row] = await cronRows(org.id);
    expect(row.createdAt).toEqual(later);
    expect(row.updatedAt).toEqual(later);
  });

  it("claimCronWeek: the first caller gets the row, the second gets null, and a stale error is reclaimed once", async () => {
    const org = await makeOrg(A);
    const first = await claimCronWeek(org.id, WEEK, now);
    expect(first).toEqual({ id: expect.any(String), attempts: 1 });
    expect(await claimCronWeek(org.id, WEEK, now)).toBeNull();
    await db.clientOrgReport.update({ where: { id: first!.id }, data: { state: "error", updatedAt: now } });
    expect(await claimCronWeek(org.id, WEEK, at(29))).toBeNull();
    const [x, y] = await Promise.all([claimCronWeek(org.id, WEEK, at(30)), claimCronWeek(org.id, WEEK, at(30))]);
    expect([x, y].filter(Boolean)).toEqual([{ id: first!.id, attempts: 2 }]);
  });

  it("claimCronWeek never reclaims a sent row or one that used its 3 attempts", async () => {
    const org = await makeOrg(A);
    await db.clientOrgReport.create({ data: { clientOrgId: org.id, week: "2026-10-05", trigger: "cron", state: "sent", attempts: 1, createdAt: at(-9999), updatedAt: at(-9999) } });
    await db.clientOrgReport.create({ data: { clientOrgId: org.id, week: WEEK, trigger: "cron", state: "error", attempts: 3, createdAt: at(-9999), updatedAt: at(-9999) } });
    expect(await claimCronWeek(org.id, "2026-10-05", now)).toBeNull();
    expect(await claimCronWeek(org.id, WEEK, now)).toBeNull();
  });

  it("runClientOrgReports takes at most `max` organizations per call and the rest follow on the next", async () => {
    for (const n of [1, 2, 3]) {
      const org = await makeOrg(A, { name: `Cliente ${n}` });
      await makeBusiness(`corep-it-m${n}`, org);
    }
    expect(await runClientOrgReports(now, { max: 2 })).toEqual({ checked: 2, sent: 2, errors: 0 });
    expect(await runClientOrgReports(now, { max: 2 })).toEqual({ checked: 1, sent: 1, errors: 0 });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("an organization that throws does not stop the others, and the log has the id and no secrets", async () => {
    const bad = await makeOrg(A, { name: "Falla" });
    const good = await makeOrg(A, { name: "Bien" });
    await makeBusiness("corep-it-bad", bad, { createdAt: new Date("2026-01-01T00:00:00Z") });
    await makeBusiness("corep-it-good", good, { createdAt: new Date("2026-01-02T00:00:00Z") });
    const load = vi.spyOn(db.clientOrg, "findFirst").mockImplementationOnce((() => Promise.reject(new Error("postgres://user:secret-pass@host/db"))) as never);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runClientOrgReports(now);
    const logged = log.mock.calls.map((c) => c.join(" ")).join("\n");
    log.mockRestore();
    load.mockRestore();
    expect(result).toEqual({ checked: 2, sent: 1, errors: 1 });
    expect(logged).toContain(`[reporte-semanal] ${bad.id}`);
    expect(logged).not.toContain("secret-pass");
    expect(await cronRows(good.id)).toMatchObject([{ state: "sent" }]);
  });

  it("saveClientOrgReport saves its own organization and validates before writing", async () => {
    const org = await makeOrg(A, { reportOn: false, reportEmail: "" });
    const raw = { contactName: " Juan Pérez ", reportEmail: "J@x.com, m@y.com", phone: "555-1234", reportLang: "en", reportDay: "5", reportHour: "17", timezone: "Europe/Madrid", reportOn: "on" };
    await saveClientOrgReport(A, org.id, raw);
    expect(await db.clientOrg.findUnique({ where: { id: org.id } })).toMatchObject({
      contactName: "Juan Pérez",
      reportEmail: "j@x.com, m@y.com",
      phone: "555-1234",
      reportLang: "en",
      reportOn: true,
      reportDay: 5,
      reportHour: 17,
      timezone: "Europe/Madrid",
    });
    await expect(saveClientOrgReport(A, org.id, { ...raw, reportHour: "99" })).rejects.toBeInstanceOf(BiError);
    expect(await db.clientOrg.findUnique({ where: { id: org.id } })).toMatchObject({ reportHour: 17 });
  });

  it("saveClientOrgReport writes only its own account's organization", async () => {
    const orgB = await makeOrg(B, { contactName: "Original", reportOn: false });
    const raw = { contactName: "Forjado", reportEmail: "f@x.com", phone: "", reportLang: "es", reportDay: "1", reportHour: "8", timezone: "", reportOn: "on" };
    await expect(saveClientOrgReport(A, orgB.id, raw)).rejects.toThrow(NOT_IN_ACCOUNT);
    await expect(saveClientOrgReport(A, "corep-it-nobody", raw)).rejects.toThrow(NOT_IN_ACCOUNT);
    expect(await db.clientOrg.findUnique({ where: { id: orgB.id } })).toMatchObject({ contactName: "Original", reportOn: false, reportEmail: "a@x.com, b@y.com" });
  });

  it("listClientOrgs returns the settings and the newest send", async () => {
    const org = await makeOrg(A, { name: "Con envíos", contactName: "Juan", phone: "555" });
    const quiet = await makeOrg(A, { name: "Sin envíos", reportOn: false, reportEmail: "", timezone: "", reportLang: "en", reportDay: 3, reportHour: 20 });
    const foreign = await makeOrg(B, { name: "Ajena" });
    const row = (over: Pick<Prisma.ClientOrgReportUncheckedCreateInput, "trigger"> & Partial<Prisma.ClientOrgReportUncheckedCreateInput>): Prisma.ClientOrgReportCreateManyInput => ({ clientOrgId: org.id, week: WEEK, state: "sent", ...over });
    await db.clientOrgReport.createMany({
      data: [
        row({ trigger: "cron", state: "error", error: "Falló antes", createdAt: new Date("2026-10-19T12:00:00Z"), updatedAt: new Date("2026-10-19T12:00:00Z") }),
        row({ trigger: "manual", state: "sent", to: ["a@x.com"], createdAt: new Date("2026-10-19T14:00:00Z"), updatedAt: new Date("2026-10-19T14:05:00Z") }),
        row({ trigger: "test", state: "error", error: "Viejo", createdAt: new Date("2026-10-12T14:00:00Z"), updatedAt: new Date("2026-10-12T14:00:00Z") }),
      ],
    });
    await db.clientOrgReport.create({ data: { clientOrgId: foreign.id, week: WEEK, trigger: "manual", state: "sent", createdAt: new Date("2026-10-20T00:00:00Z") } });

    const list = await listClientOrgs(A);
    expect(list.map((o) => o.name)).toEqual(["Con envíos", "Sin envíos"]);
    expect(list[0].report).toEqual({ contactName: "Juan", reportEmail: "a@x.com, b@y.com", phone: "555", reportLang: "es", reportOn: true, reportDay: 1, reportHour: 8, timezone: "America/New_York" });
    expect(list[0].last).toEqual({ at: "2026-10-19T14:05:00.000Z", trigger: "manual", state: "sent", to: ["a@x.com"], error: "" });
    expect(list[1].id).toBe(quiet.id);
    expect(list[1].report).toEqual({ contactName: "", reportEmail: "", phone: "", reportLang: "en", reportOn: false, reportDay: 3, reportHour: 20, timezone: "" });
    expect(list[1].last).toBeNull();
    expect((await listClientOrgs(B))[0].last).toMatchObject({ trigger: "manual" });
  });
});
