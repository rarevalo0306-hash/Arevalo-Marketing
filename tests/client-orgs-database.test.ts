/** Solo contra la base local aislada (127.0.0.1:55439/matya_agent), nunca contra una base configurada de verdad. */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  clientOrgForNewBusiness,
  createClientOrg,
  deleteClientOrg,
  ensureDefaultClientOrg,
  listClientOrgs,
  moveBusiness,
  renameClientOrg,
} from "@/lib/client-orgs-store";

const url = process.env.MATYA_TEST_DATABASE_URL ?? "";
const safe = !!url && process.env.DATABASE_URL === url && /^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/matya_agent$/.test(url);

const A = "corg-it-a";
const B = "corg-it-b";

const BAD_NAME = { message: "Escribe un nombre de 1 a 120 caracteres.", en: "Enter a name of 1 to 120 characters." };
const NOT_IN_ACCOUNT = { message: "Esa organización no es de esta cuenta.", en: "That organization isn't in this account." };
const HAS_BUSINESSES = {
  message: "Esta organización todavía tiene negocios: muévelos antes de borrarla.",
  en: "This organization still has businesses: move them before deleting it.",
};

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
  afterEach(() => {
    vi.restoreAllMocks();
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

  it("ensureDefaultClientOrg returns the oldest organization by creation time, not the last one inserted", async () => {
    const recent = await db.clientOrg.create({ data: { organizationId: A, name: "Reciente", createdAt: new Date("2026-10-01T00:00:00Z") } });
    const oldest = await db.clientOrg.create({ data: { organizationId: A, name: "Antigua", createdAt: new Date("2026-01-01T00:00:00Z") } });
    expect(await ensureDefaultClientOrg(A)).toBe(oldest.id);
    expect(await ensureDefaultClientOrg(A)).not.toBe(recent.id);
    expect(await db.clientOrg.count({ where: { organizationId: A } })).toBe(2);
  });

  it("two concurrent ensureDefaultClientOrg on an account without organizations create one «Mis compañías»", async () => {
    expect(await db.clientOrg.count({ where: { organizationId: A } })).toBe(0);
    const [x, y] = await Promise.all([ensureDefaultClientOrg("corg-it-a"), ensureDefaultClientOrg("corg-it-a")]);
    expect(x).toBe(y);
    expect(await db.clientOrg.count({ where: { organizationId: "corg-it-a", name: "Mis compañías" } })).toBe(1);
    expect(await db.clientOrg.count({ where: { organizationId: A } })).toBe(1);
  });

  it("creates, renames and lists organizations in creation order, empty ones included, only for this account", async () => {
    const old = await db.clientOrg.create({ data: { organizationId: A, name: "Antigua", createdAt: new Date("2026-01-01T00:00:00Z") } });
    const juan = await createClientOrg(A, "  Juan Pérez  ");
    const maria = await createClientOrg(A, "<b>María</b>");
    expect(await db.clientOrg.findUnique({ where: { id: juan } })).toMatchObject({ organizationId: A, name: "Juan Pérez" });
    await renameClientOrg(A, maria, "  María López ");

    const foreign = await db.clientOrg.create({ data: { organizationId: B, name: "De la otra cuenta" } });
    await db.business.create({ data: { id: "corg-it-foreign", name: "Ajeno", organizationId: B, clientOrgId: foreign.id } });
    // Negocios creados al revés de su orden de creación: la lista los ordena por createdAt.
    await db.business.create({ data: { id: "corg-it-b2", name: "Segundo", color: "#222222", organizationId: A, clientOrgId: juan, createdAt: new Date("2026-03-02T00:00:00Z") } });
    await db.business.create({ data: { id: "corg-it-b1", name: "Primero", color: "#111111", organizationId: A, clientOrgId: juan, createdAt: new Date("2026-03-01T00:00:00Z") } });

    expect(await listClientOrgs(A)).toEqual([
      { id: old.id, name: "Antigua", businesses: [] },
      {
        id: juan,
        name: "Juan Pérez",
        businesses: [
          { id: "corg-it-b1", name: "Primero", color: "#111111" },
          { id: "corg-it-b2", name: "Segundo", color: "#222222" },
        ],
      },
      { id: maria, name: "María López", businesses: [] },
    ]);
    expect(await listClientOrgs(B)).toEqual([{ id: foreign.id, name: "De la otra cuenta", businesses: [{ id: "corg-it-foreign", name: "Ajeno", color: "#126BBC" }] }]);
    expect(await listClientOrgs("corg-it-nobody")).toEqual([]);
  });

  it("rejects blank, spaces-only and over-long names on create and rename, and changes nothing", async () => {
    const id = await createClientOrg(A, "x".repeat(120));
    for (const bad of ["", "   ", "x".repeat(121)]) {
      await expect(createClientOrg(A, bad)).rejects.toMatchObject(BAD_NAME);
      await expect(renameClientOrg(A, id, bad)).rejects.toMatchObject(BAD_NAME);
    }
    expect(await db.clientOrg.findMany({ where: { organizationId: A } })).toEqual([expect.objectContaining({ id, name: "x".repeat(120) })]);
  });

  it("rejects an organization or business of another account, even with forged ids, and changes nothing", async () => {
    const mine = await createClientOrg(A, "Mía");
    const theirs = await db.clientOrg.create({ data: { organizationId: B, name: "Suya" } });
    const theirBusiness = await db.business.create({ data: { id: "corg-it-theirs", name: "Del otro", organizationId: B, clientOrgId: theirs.id } });
    const myBusiness = await db.business.create({ data: { id: "corg-it-mine", name: "Mío", organizationId: A, clientOrgId: mine } });
    const before = {
      orgs: await db.clientOrg.findMany({ orderBy: { id: "asc" } }),
      businesses: await db.business.findMany({ where: { organizationId: { in: [A, B] } }, orderBy: { id: "asc" } }),
    };

    await expect(renameClientOrg(A, theirs.id, "Robada")).rejects.toMatchObject(NOT_IN_ACCOUNT);
    await expect(deleteClientOrg(A, theirs.id)).rejects.toMatchObject(NOT_IN_ACCOUNT);
    await expect(deleteClientOrg(A, "corg-no-existe")).rejects.toMatchObject(NOT_IN_ACCOUNT);
    await expect(moveBusiness(A, theirBusiness.id, mine)).rejects.toMatchObject(NOT_IN_ACCOUNT);
    await expect(moveBusiness(A, myBusiness.id, theirs.id)).rejects.toMatchObject(NOT_IN_ACCOUNT);
    await expect(moveBusiness(A, theirBusiness.id, theirs.id)).rejects.toMatchObject(NOT_IN_ACCOUNT);
    await expect(moveBusiness(A, "corg-no-existe", mine)).rejects.toMatchObject(NOT_IN_ACCOUNT);

    expect({
      orgs: await db.clientOrg.findMany({ orderBy: { id: "asc" } }),
      businesses: await db.business.findMany({ where: { organizationId: { in: [A, B] } }, orderBy: { id: "asc" } }),
    }).toEqual(before);
  });

  it("refuses to delete an organization that still has businesses, and deletes an empty one", async () => {
    const full = await createClientOrg(A, "Con negocios");
    const empty = await createClientOrg(A, "Vacía");
    await db.business.create({ data: { id: "corg-it-inside", name: "Dentro", organizationId: A, clientOrgId: full } });

    await expect(deleteClientOrg(A, full)).rejects.toMatchObject(HAS_BUSINESSES);
    expect(await db.clientOrg.count({ where: { id: full } })).toBe(1);

    await deleteClientOrg(A, empty);
    expect(await db.clientOrg.count({ where: { id: empty } })).toBe(0);
    await expect(deleteClientOrg(A, empty)).rejects.toMatchObject(NOT_IN_ACCOUNT);
  });

  it("maps the database refusal (a business moved in while deleting) to the same text, not a crash", async () => {
    const full = await createClientOrg(A, "Carrera");
    await db.business.create({ data: { id: "corg-it-race", name: "Llegó tarde", organizationId: A, clientOrgId: full } });
    // La revisión previa no ve el negocio (se movió justo después): la base de datos lo rechaza con P2003.
    vi.spyOn(db.business, "count").mockResolvedValueOnce(0);
    await expect(deleteClientOrg(A, full)).rejects.toMatchObject(HAS_BUSINESSES);
    expect(await db.clientOrg.count({ where: { id: full } })).toBe(1);
    expect(await db.business.count({ where: { id: "corg-it-race", clientOrgId: full } })).toBe(1);
  });

  it("maps the database refusal when the target organization disappears while moving a business", async () => {
    const from = await createClientOrg(A, "Origen");
    await db.business.create({ data: { id: "corg-it-gone", name: "Sin destino", organizationId: A, clientOrgId: from } });
    // La revisión previa ve el destino, pero ya no existe al cambiar: la llave foránea compuesta lo rechaza (P2003).
    vi.spyOn(db.clientOrg, "findFirst").mockResolvedValueOnce({ id: "corg-no-existe" } as never);
    await expect(moveBusiness(A, "corg-it-gone", "corg-no-existe")).rejects.toMatchObject(NOT_IN_ACCOUNT);
    expect(await db.business.findUniqueOrThrow({ where: { id: "corg-it-gone" } })).toMatchObject({ clientOrgId: from });
  });

  it("moveBusiness changes only clientOrgId: its posts and agent workspace stay", async () => {
    const from = await createClientOrg(A, "Origen");
    const to = await createClientOrg(A, "Destino");
    await db.business.create({ data: { id: "corg-it-move", name: "Mudanza", color: "#abcdef", organizationId: A, clientOrgId: from } });
    await db.post.create({ data: { id: "corg-it-post", businessId: "corg-it-move", text: "Hola" } });
    await db.agentWorkspace.create({ data: { businessId: "corg-it-move", objective: "Más llamadas" } });
    const before = await db.business.findUniqueOrThrow({ where: { id: "corg-it-move" } });
    const workspace = await db.agentWorkspace.findUniqueOrThrow({ where: { businessId: "corg-it-move" } });

    await moveBusiness(A, "corg-it-move", to);

    expect(await db.business.findUniqueOrThrow({ where: { id: "corg-it-move" } })).toEqual({ ...before, clientOrgId: to });
    expect(await db.post.findMany({ where: { businessId: "corg-it-move" } })).toEqual([expect.objectContaining({ id: "corg-it-post", text: "Hola" })]);
    expect(await db.agentWorkspace.findUniqueOrThrow({ where: { businessId: "corg-it-move" } })).toEqual(workspace);
    expect((await listClientOrgs(A)).map((o) => [o.name, o.businesses.map((b) => b.id)])).toEqual([["Origen", []], ["Destino", ["corg-it-move"]]]);
  });

  it("clientOrgForNewBusiness uses the requested organization of this account, or the default for an empty request", async () => {
    // Sin organizaciones: "" crea «Mis compañías» y la devuelve.
    const made = await clientOrgForNewBusiness(A, "");
    expect(await db.clientOrg.findUnique({ where: { id: made } })).toMatchObject({ organizationId: A, name: "Mis compañías" });
    expect(await clientOrgForNewBusiness(A, "")).toBe(made);

    const other = await createClientOrg(A, "Otra");
    expect(await clientOrgForNewBusiness(A, other)).toBe(other);
    expect(await clientOrgForNewBusiness(A, made)).toBe(made);
    expect(await db.clientOrg.count({ where: { organizationId: A } })).toBe(2);

    const theirs = await db.clientOrg.create({ data: { organizationId: B, name: "Suya" } });
    await expect(clientOrgForNewBusiness(A, theirs.id)).rejects.toMatchObject(NOT_IN_ACCOUNT);
    await expect(clientOrgForNewBusiness(A, "corg-no-existe")).rejects.toMatchObject(NOT_IN_ACCOUNT);
    expect(await db.clientOrg.count({ where: { organizationId: A } })).toBe(2);
  });
});
