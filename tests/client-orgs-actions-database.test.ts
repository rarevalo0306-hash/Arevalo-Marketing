/** Solo contra la base local aislada (127.0.0.1:55439/matya_agent), nunca contra una base configurada de verdad. */
// Las acciones de «Organizaciones» con el almacén de verdad: un Administrador de dos cuentas no puede tocar, desde una,
// las organizaciones ni los negocios de la otra, ni con ids forjados en el formulario. Solo la sesión está simulada.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireOrgAdmin: vi.fn(async () => ({ id: "usr_both" })), requireUser: vi.fn() }));
vi.mock("@/lib/i18n-server", () => ({ getT: async () => ({ lang: "es", t: (es: string) => es }) }));

import { createClientOrgAction, deleteClientOrgAction, moveBusinessAction, renameClientOrgAction, saveClientOrgReportAction } from "@/app/actions-client-orgs";
import { db } from "@/lib/db";

const url = process.env.MATYA_TEST_DATABASE_URL ?? "";
const safe = !!url && process.env.DATABASE_URL === url && /^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/matya_agent$/.test(url);

const A = "corg-act-a";
const B = "corg-act-b";
const NOT_IN_ACCOUNT = { ok: false, message: "Esa organización no es de esta cuenta." };
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

async function clean() {
  await db.business.deleteMany({ where: { organizationId: { in: [A, B] } } });
  await db.organization.deleteMany({ where: { id: { in: [A, B] } } });
}

describe.skipIf(!safe)("the Organizaciones actions on an isolated PostgreSQL, for an Administrator of two accounts", () => {
  let orgA1: string;
  let orgA2: string;
  let orgB1: string;
  beforeEach(async () => {
    await clean();
    await db.organization.createMany({ data: [{ id: A, name: "Cuenta A" }, { id: B, name: "Cuenta B" }] });
    orgA1 = (await db.clientOrg.create({ data: { organizationId: A, name: "A uno" } })).id;
    orgA2 = (await db.clientOrg.create({ data: { organizationId: A, name: "A dos" } })).id;
    orgB1 = (await db.clientOrg.create({ data: { organizationId: B, name: "B uno" } })).id;
    await db.business.create({ data: { id: "corg-act-biz-a", name: "Negocio A", organizationId: A, clientOrgId: orgA1 } });
    await db.business.create({ data: { id: "corg-act-biz-b", name: "Negocio B", organizationId: B, clientOrgId: orgB1 } });
  });
  afterEach(() => {
    vi.useRealTimers(); // some tests set the clock
  });
  afterAll(async () => {
    await clean();
    await db.$disconnect();
  });

  const clientOrgOf = async (businessId: string) => (await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { clientOrgId: true } })).clientOrgId;

  it("creates, renames, moves and deletes inside the account", async () => {
    expect(await createClientOrgAction(A, null, form({ name: "  Juan Pérez  " }))).toEqual({ ok: true, message: "Listo." });
    expect((await db.clientOrg.findMany({ where: { organizationId: A }, select: { name: true } })).map((o) => o.name)).toContain("Juan Pérez");

    expect(await renameClientOrgAction(A, orgA2, null, form({ name: "<b>Otro</b>" }))).toEqual({ ok: true, message: "Listo." });
    expect((await db.clientOrg.findUniqueOrThrow({ where: { id: orgA2 } })).name).toBe("<b>Otro</b>"); // stored as typed; React escapes it

    expect(await moveBusinessAction(A, "corg-act-biz-a", null, form({ clientOrgId: orgA2 }))).toEqual({ ok: true, message: "Listo." });
    expect(await clientOrgOf("corg-act-biz-a")).toBe(orgA2);

    expect(await deleteClientOrgAction(A, orgA1)).toEqual({ ok: true, message: "Listo." });
    expect(await db.clientOrg.count({ where: { id: orgA1 } })).toBe(0);
  });

  it("refuses a business or an organization of the other account, even with forged ids", async () => {
    // Una organización de la cuenta B como destino, desde la cuenta A.
    expect(await moveBusinessAction(A, "corg-act-biz-a", null, form({ clientOrgId: orgB1 }))).toEqual(NOT_IN_ACCOUNT);
    // Un negocio de la cuenta B, desde la cuenta A, hacia una organización de A.
    expect(await moveBusinessAction(A, "corg-act-biz-b", null, form({ clientOrgId: orgA2 }))).toEqual(NOT_IN_ACCOUNT);
    expect(await renameClientOrgAction(A, orgB1, null, form({ name: "Robada" }))).toEqual(NOT_IN_ACCOUNT);
    expect(await deleteClientOrgAction(A, orgB1)).toEqual(NOT_IN_ACCOUNT);
    // Una cuenta forjada en el formulario no cambia a cuál se escribe.
    await createClientOrgAction(A, null, form({ name: "Solo en A", organizationId: B, accountId: B }));

    expect(await clientOrgOf("corg-act-biz-a")).toBe(orgA1);
    expect(await clientOrgOf("corg-act-biz-b")).toBe(orgB1);
    expect((await db.clientOrg.findUniqueOrThrow({ where: { id: orgB1 } })).name).toBe("B uno");
    expect((await db.clientOrg.findMany({ where: { organizationId: B } })).map((o) => o.name)).toEqual(["B uno"]);
    expect(await db.clientOrg.count({ where: { organizationId: A, name: "Solo en A" } })).toBe(1);
  });

  it("explains a name that is blank or too long, and an organization that still has businesses", async () => {
    const bad = { ok: false, message: "Escribe un nombre de 1 a 120 caracteres." };
    expect(await createClientOrgAction(A, null, form({ name: "   " }))).toEqual(bad);
    expect(await createClientOrgAction(A, null, form({ name: "x".repeat(121) }))).toEqual(bad);
    expect(await renameClientOrgAction(A, orgA1, null, form({ name: "" }))).toEqual(bad);
    expect(await deleteClientOrgAction(A, orgA1)).toEqual({ ok: false, message: "Esta organización todavía tiene negocios: muévelos antes de borrarla." });
    expect(await db.clientOrg.count({ where: { id: orgA1 } })).toBe(1);
    expect((await db.clientOrg.findUniqueOrThrow({ where: { id: orgA1 } })).name).toBe("A uno");
  });

  it("saves the report settings of an organization of the account, and refuses one of the other account without writing anything", async () => {
    const settings = { contactName: "Ana", reportEmail: "ana@x.com", phone: "555", reportLang: "en", timezone: "America/Mexico_City", reportOn: "on", reportDay: "2", reportHour: "9" };
    vi.setSystemTime(new Date("2026-10-19T12:00:00Z")); // a Monday: Tuesday 9:00 in Mexico City has not come, so nothing is skipped
    expect(await saveClientOrgReportAction(A, orgA1, null, form(settings))).toEqual({ ok: true, message: "Guardado." });
    expect(await db.clientOrg.findUniqueOrThrow({ where: { id: orgA1 }, select: { contactName: true, reportEmail: true, phone: true, reportLang: true, timezone: true, reportOn: true, reportDay: true, reportHour: true } })).toEqual({
      contactName: "Ana",
      reportEmail: "ana@x.com",
      phone: "555",
      reportLang: "en",
      timezone: "America/Mexico_City",
      reportOn: true,
      reportDay: 2,
      reportHour: 9,
    });

    // La organización de la cuenta B, desde la cuenta A, con ids forjados: se rechaza y la fila de B queda como estaba.
    const before = await db.clientOrg.findUniqueOrThrow({ where: { id: orgB1 } });
    expect(await saveClientOrgReportAction(A, orgB1, null, form({ ...settings, reportEmail: "robado@x.com", organizationId: B, accountId: B }))).toEqual(NOT_IN_ACCOUNT);
    expect(await db.clientOrg.findUniqueOrThrow({ where: { id: orgB1 } })).toEqual(before);
    expect(await db.clientOrg.count({ where: { reportEmail: "robado@x.com" } })).toBe(0);
  });

  it("switching the report on after this week's send time says the first report goes out next week, and only the first time", async () => {
    const settings = { contactName: "Ana", reportEmail: "ana@x.com", phone: "", reportLang: "es", timezone: "America/Mexico_City", reportOn: "on", reportDay: "2", reportHour: "9" };
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z")); // Wednesday: Tuesday 9:00 in Mexico City already passed
    expect(await saveClientOrgReportAction(A, orgA1, null, form(settings))).toEqual({
      ok: true,
      message: "Guardado. Esta semana ya pasó la hora de envío: el primer reporte sale la próxima semana.",
    });
    expect(await db.clientOrgReport.findMany({ where: { clientOrgId: orgA1 }, select: { week: true, trigger: true, state: true, attempts: true } })).toEqual([
      { week: "2026-10-12", trigger: "cron", state: "skipped", attempts: 3 },
    ]);
    expect(await saveClientOrgReportAction(A, orgA1, null, form(settings))).toEqual({ ok: true, message: "Guardado." });
    expect(await db.clientOrgReport.count({ where: { clientOrgId: orgA1 } })).toBe(1);
    // Another account's organization: refused, and no skipped row appears for it.
    expect(await saveClientOrgReportAction(A, orgB1, null, form(settings))).toEqual(NOT_IN_ACCOUNT);
    expect(await db.clientOrgReport.count({ where: { clientOrgId: orgB1 } })).toBe(0);
  });

  it("explains a setting that does not work and keeps what was saved", async () => {
    await saveClientOrgReportAction(A, orgA1, null, form({ contactName: "Ana", reportEmail: "ana@x.com", reportLang: "es", reportDay: "1", reportHour: "8" }));
    expect(await saveClientOrgReportAction(A, orgA1, null, form({ reportEmail: "no-es-un-email", reportLang: "es", reportDay: "1", reportHour: "8" }))).toEqual({
      ok: false,
      message: "Escribe hasta 3 emails válidos para el reporte.",
    });
    expect(await db.clientOrg.findUniqueOrThrow({ where: { id: orgA1 }, select: { reportEmail: true } })).toEqual({ reportEmail: "ana@x.com" });
  });
});
