/** Solo contra la base local aislada (127.0.0.1:55439/matya_agent), nunca contra una base configurada de verdad. */
// Las acciones de «Organizaciones» con el almacén de verdad: un Administrador de dos cuentas no puede tocar, desde una,
// las organizaciones ni los negocios de la otra, ni con ids forjados en el formulario. Solo la sesión está simulada.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireOrgAdmin: vi.fn(async () => ({ id: "usr_both" })), requireUser: vi.fn() }));
vi.mock("@/lib/i18n-server", () => ({ getT: async () => ({ lang: "es", t: (es: string) => es }) }));

import { createClientOrgAction, deleteClientOrgAction, moveBusinessAction, renameClientOrgAction } from "@/app/actions-client-orgs";
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
});
