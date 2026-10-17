/** Solo contra la base local aislada (127.0.0.1:55439/matya_agent), nunca contra una base configurada de verdad. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ensureDefaultClientOrg } from "@/lib/client-orgs-store";

const url = process.env.MATYA_TEST_DATABASE_URL ?? "";
const safe = !!url && process.env.DATABASE_URL === url && /^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/matya_agent$/.test(url);

const A = "corg-it-a";
const B = "corg-it-b";

/** Primero los negocios (su organización de cliente y su cuenta los protegen con Restrict), después las cuentas (borran sus organizaciones). */
async function clean() {
  await db.business.deleteMany({ where: { organizationId: { in: [A, B] } } });
  await db.organization.deleteMany({ where: { id: { in: [A, B] } } });
}

describe.skipIf(!safe)("client organizations on an isolated PostgreSQL", () => {
  beforeEach(async () => {
    await clean();
    await db.organization.createMany({ data: [{ id: A, name: "Cuenta A IT" }, { id: B, name: "Cuenta B IT" }] });
  });
  afterAll(async () => {
    await clean();
    await db.$disconnect();
  });

  it("a business cannot sit in an organization of another account", async () => {
    const other = await db.clientOrg.create({ data: { organizationId: B, name: "Otra" } });
    await expect(db.business.create({ data: { id: "corg-it-x", name: "X", organizationId: A, clientOrgId: other.id } }))
      .rejects.toMatchObject({ code: "P2003" });
  });

  it("the weekly cron row is unique per organization and week; manual and test can repeat", async () => {
    const c = await db.clientOrg.create({ data: { organizationId: A, name: "Juan" } });
    const row = { clientOrgId: c.id, week: "2026-10-12", state: "sent" };
    await db.clientOrgReport.create({ data: { ...row, trigger: "cron" } });
    await expect(db.clientOrgReport.create({ data: { ...row, trigger: "cron" } })).rejects.toMatchObject({ code: "P2002" });
    await db.clientOrgReport.create({ data: { ...row, trigger: "manual" } });
    await db.clientOrgReport.create({ data: { ...row, trigger: "manual" } });
    await db.clientOrgReport.create({ data: { ...row, trigger: "test" } });
    expect(await db.clientOrgReport.count({ where: { clientOrgId: c.id } })).toBe(4);
  });

  it("ensureDefaultClientOrg creates «Mis compañías» once and then returns the oldest", async () => {
    const first = await ensureDefaultClientOrg(A);
    expect(await db.clientOrg.findUnique({ where: { id: first } })).toMatchObject({ name: "Mis compañías", organizationId: A });
    expect(await ensureDefaultClientOrg(A)).toBe(first);
  });
});
