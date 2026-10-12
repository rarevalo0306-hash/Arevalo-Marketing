/** Solo contra la base local aislada (127.0.0.1:55439/matya_agent), nunca contra una base configurada de verdad. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loginUser } from "@/lib/accounts";
import { db } from "@/lib/db";

const url = process.env.MATYA_TEST_DATABASE_URL ?? "";
const safe = !!url && process.env.DATABASE_URL === url && /^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/matya_agent$/.test(url);
const EMAILS = ["owner-a@gmail.com", "owner-b@gmail.com", "guest@gmail.com"];

describe.skipIf(!safe)("sign-in accounts on an isolated PostgreSQL", () => {
  beforeEach(async () => {
    await db.user.deleteMany({ where: { email: { in: EMAILS } } });
    await db.organization.upsert({ where: { id: "matya-it-org" }, create: { id: "matya-it-org", name: "MATYA fixture" }, update: {} });
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { email: { in: EMAILS } } });
    await db.$disconnect();
  });

  it("an owner becomes Administrator of the main (oldest) organization, once", async () => {
    const main = await db.organization.findFirst({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(main).not.toBeNull();
    const first = await loginUser(" Owner-A@Gmail.com ", { owner: true, name: "Owner A" });
    const again = await loginUser("owner-a@gmail.com", { owner: true });
    expect(again).toEqual(first);
    const memberships = await db.membership.findMany({ where: { user: { email: "owner-a@gmail.com" } } });
    expect(memberships).toEqual([expect.objectContaining({ organizationId: main!.id, role: "admin" })]);
    expect((await db.user.findUnique({ where: { email: "owner-a@gmail.com" } }))?.name).toBe("Owner A");
  });

  it("a second owner joins the same main organization instead of an empty one", async () => {
    await loginUser("owner-a@gmail.com", { owner: true });
    await loginUser("owner-b@gmail.com", { owner: true });
    const orgs = await db.membership.findMany({ where: { user: { email: { in: ["owner-a@gmail.com", "owner-b@gmail.com"] } } }, select: { organizationId: true } });
    expect(new Set(orgs.map((o) => o.organizationId)).size).toBe(1);
  });

  it("someone who is not an owner gets in only while they are on a team", async () => {
    expect(await loginUser("guest@gmail.com", { owner: false })).toBeNull();
    expect(await db.user.findUnique({ where: { email: "guest@gmail.com" } })).toBeNull();
    await loginUser("guest@gmail.com", { owner: true }); // fue dueño: quedó en el equipo...
    expect(await loginUser("guest@gmail.com", { owner: false })).not.toBeNull(); // ...y sigue entrando como miembro
    await db.membership.deleteMany({ where: { user: { email: "guest@gmail.com" } } }); // «Quitar acceso» en Equipo
    expect(await loginUser("guest@gmail.com", { owner: false })).toBeNull();
  });

  it("rejects things that are not emails", async () => {
    expect(await loginUser("not-an-email", { owner: true })).toBeNull();
  });
});
