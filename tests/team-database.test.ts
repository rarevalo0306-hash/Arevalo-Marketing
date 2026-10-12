/** Solo contra la base local aislada (127.0.0.1:55439/matya_agent), nunca contra una base configurada de verdad. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as { to: string; href: string }[]);
vi.mock("@/lib/auth-email", () => ({
  sendAuthEmail: async (m: { to: string; button: { href: string } }) => {
    sent.push({ to: m.to, href: m.button.href });
    return true;
  },
}));

import { checkPassword, loginUser, mainOrganizationId } from "@/lib/accounts";
import { db } from "@/lib/db";
import { hashPassword, newLinkToken } from "@/lib/password";
import {
  acceptInvitation,
  adminResetLink,
  cancelInvite,
  changeMember,
  completeReset,
  invite,
  readInvitation,
  readReset,
  removeMember,
  requestPasswordReset,
  resendInvite,
  teamOf,
} from "@/lib/team";

const url = process.env.MATYA_TEST_DATABASE_URL ?? "";
const safe = !!url && process.env.DATABASE_URL === url && /^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/matya_agent$/.test(url);

const ORG = "team-it-org";
const OTHER = "team-it-other";
const B1 = "team-it-b1";
const B2 = "team-it-b2";
const BX = "team-it-bx";
const EMAILS = ["boss@gmail.com", "ana@ejemplo.com", "luis@ejemplo.com", "owner-it@gmail.com", "both@ejemplo.com"];
const tokenOf = (href: string) => href.split("/").pop()!;
const lastLink = () => sent[sent.length - 1].href;

describe.skipIf(!safe)("team: invitations, roles and passwords on an isolated PostgreSQL", () => {
  let boss: { id: string; name: string; email: string };
  let bossMembership: string;

  beforeEach(async () => {
    sent.length = 0;
    vi.stubEnv("LOGIN_EMAILS", "owner-it@gmail.com");
    vi.stubEnv("APP_PASSWORD", "app-pass-123");
    vi.stubEnv("PUBLIC_BASE_URL", "https://app.example");
    await db.user.deleteMany({ where: { email: { in: EMAILS } } });
    await db.business.deleteMany({ where: { id: { in: [B1, B2, BX] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, OTHER] } } });
    await db.organization.createMany({ data: [{ id: ORG, name: "Equipo IT" }, { id: OTHER, name: "Otra IT" }] });
    await db.business.createMany({ data: [{ id: B1, name: "Uno", organizationId: ORG }, { id: B2, name: "Dos", organizationId: ORG }, { id: BX, name: "Ajena", organizationId: OTHER }] });
    const u = await db.user.create({ data: { email: "boss@gmail.com", name: "Boss" } });
    boss = { id: u.id, name: u.name, email: u.email };
    bossMembership = (await db.membership.create({ data: { userId: u.id, organizationId: ORG, role: "admin" } })).id;
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { email: { in: EMAILS } } });
    await db.business.deleteMany({ where: { id: { in: [B1, B2, BX] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, OTHER] } } });
    vi.unstubAllEnvs();
    await db.$disconnect();
  });

  it("invites by email with a one-time link limited to some businesses, and only of this organization", async () => {
    const r = await invite(ORG, boss, { email: " Ana@Ejemplo.com ", role: "publisher", allBusinesses: false, businessIds: [B1, BX] }, "es");
    expect(r.emailed).toBe(true);
    expect(sent).toEqual([{ to: "ana@ejemplo.com", href: r.link }]);
    expect(r.link).toMatch(/^https:\/\/app\.example\/invitacion\/[A-Za-z0-9_-]{43}$/);
    const stored = await db.invitation.findFirstOrThrow({ where: { organizationId: ORG, email: "ana@ejemplo.com" } });
    expect(stored.businessIds).toEqual([B1]);
    expect(JSON.stringify(stored)).not.toContain(tokenOf(r.link));
    expect(await readInvitation(tokenOf(r.link))).toMatchObject({ email: "ana@ejemplo.com", role: "publisher", businessNames: ["Uno"], existingUser: false, inviterName: "Boss" });
  });

  it("a new person accepts with their own password, gets exactly that access, and the link can't be reused", async () => {
    const { link } = await invite(ORG, boss, { email: "ana@ejemplo.com", role: "publisher", allBusinesses: false, businessIds: [B2] }, "es");
    const user = await acceptInvitation(tokenOf(link), "ana@ejemplo.com", { newPassword: "clave-de-ana-1" });
    expect(user).not.toBeNull();
    const m = await db.membership.findFirstOrThrow({ where: { userId: user!.id, organizationId: ORG }, include: { businesses: true } });
    expect(m).toMatchObject({ role: "publisher", allBusinesses: false });
    expect(m.businesses.map((b) => b.businessId)).toEqual([B2]);
    expect(await checkPassword("ana@ejemplo.com", "clave-de-ana-1")).toBe(true);
    expect(await checkPassword("ana@ejemplo.com", "app-pass-123")).toBe(false);
    expect(await acceptInvitation(tokenOf(link), "ana@ejemplo.com")).toBeNull();
    expect(await readInvitation(tokenOf(link))).toBeNull();
    expect(await loginUser("ana@ejemplo.com", { owner: false })).toMatchObject({ id: user!.id });
  });

  it("never sets a password on an account that is in use elsewhere, and the email must match", async () => {
    const luis = await db.user.create({ data: { email: "luis@ejemplo.com", passwordHash: await hashPassword("clave-de-luis-1") } });
    await db.membership.create({ data: { userId: luis.id, organizationId: OTHER, role: "admin" } });
    const { link } = await invite(ORG, boss, { email: "luis@ejemplo.com", role: "viewer", allBusinesses: true, businessIds: [] }, "es");
    expect((await readInvitation(tokenOf(link)))?.existingUser).toBe(true);
    await expect(acceptInvitation(tokenOf(link), "luis@ejemplo.com", { newPassword: "otra-clave-123" })).rejects.toThrow();
    expect(await checkPassword("luis@ejemplo.com", "clave-de-luis-1")).toBe(true);
    expect(await acceptInvitation(tokenOf(link), "ana@ejemplo.com")).toBeNull();
    expect(await acceptInvitation(tokenOf(link), "LUIS@ejemplo.com")).not.toBeNull();
  });

  it("someone removed and invited again can choose a new password; an owner's account never", async () => {
    const { link } = await invite(ORG, boss, { email: "ana@ejemplo.com", role: "viewer", allBusinesses: true, businessIds: [] }, "es");
    const ana = (await acceptInvitation(tokenOf(link), "ana@ejemplo.com", { newPassword: "clave-de-ana-1" }))!;
    const m = await db.membership.findFirstOrThrow({ where: { userId: ana.id, organizationId: ORG } });
    await removeMember(ORG, m.id);
    const again = await invite(ORG, boss, { email: "ana@ejemplo.com", role: "publisher", allBusinesses: true, businessIds: [] }, "es");
    expect((await readInvitation(tokenOf(again.link)))?.existingUser).toBe(false);
    const back = await acceptInvitation(tokenOf(again.link), "ana@ejemplo.com", { newPassword: "clave-nueva-ana" });
    expect(back?.id).toBe(ana.id);
    expect(back!.sessionVersion).toBeGreaterThan(ana.sessionVersion);
    expect(await checkPassword("ana@ejemplo.com", "clave-nueva-ana")).toBe(true);
  });

  it("an owner's email can't be invited, and an old invitation never creates or changes an owner's account", async () => {
    await expect(invite(ORG, boss, { email: "Owner-IT@gmail.com", role: "admin", allBusinesses: true, businessIds: [] }, "es")).rejects.toThrow(/dueño/);
    // Una invitación hecha antes de que el correo estuviera en LOGIN_EMAILS, sin cuenta todavía.
    const { token, hash } = newLinkToken();
    await db.invitation.create({ data: { organizationId: ORG, email: "owner-it@gmail.com", role: "viewer", tokenHash: hash, invitedById: boss.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    expect((await readInvitation(token))?.existingUser).toBe(true);
    await expect(acceptInvitation(token, "owner-it@gmail.com", { newPassword: "toma-de-cuenta" })).rejects.toThrow(/dueño/);
    await expect(acceptInvitation(token, "owner-it@gmail.com")).rejects.toThrow(/dueño/);
    expect(await db.user.findUnique({ where: { email: "owner-it@gmail.com" } })).toBeNull();
    expect(await checkPassword("owner-it@gmail.com", "toma-de-cuenta")).toBe(false);
  });

  it("a password chosen with an invitation link stops working once the person is in another organization", async () => {
    const { link } = await invite(ORG, boss, { email: "ana@ejemplo.com", role: "viewer", allBusinesses: true, businessIds: [] }, "es");
    const ana = (await acceptInvitation(tokenOf(link), "ana@ejemplo.com", { newPassword: "clave-de-ana-1" }))!;
    expect((await db.user.findUniqueOrThrow({ where: { id: ana.id } })).passwordOrgId).toBe(ORG);
    expect(await checkPassword("ana@ejemplo.com", "clave-de-ana-1")).toBe(true);
    // Si de algún modo entra a otra organización, esa contraseña (que el Administrador de ORG pudo elegir) ya no sirve.
    const extra = await db.membership.create({ data: { userId: ana.id, organizationId: OTHER, role: "viewer" } });
    expect(await checkPassword("ana@ejemplo.com", "clave-de-ana-1")).toBe(false);
    await db.membership.delete({ where: { id: extra.id } });
    expect(await checkPassword("ana@ejemplo.com", "clave-de-ana-1")).toBe(true);
    // Al aceptar una invitación de otra organización (con Google o ya dentro), se borra y se cierran sus sesiones.
    const pending = await adminResetLink(ORG, (await db.membership.findFirstOrThrow({ where: { userId: ana.id, organizationId: ORG } })).id);
    const other = await invite(OTHER, boss, { email: "ana@ejemplo.com", role: "viewer", allBusinesses: true, businessIds: [] }, "es");
    expect((await readInvitation(tokenOf(other.link)))?.existingUser).toBe(true);
    const joined = (await acceptInvitation(tokenOf(other.link), "ana@ejemplo.com"))!;
    expect(joined.sessionVersion).toBe(ana.sessionVersion + 1);
    expect(await db.user.findUniqueOrThrow({ where: { id: ana.id } })).toMatchObject({ passwordHash: "", passwordOrgId: "" });
    expect(await checkPassword("ana@ejemplo.com", "clave-de-ana-1")).toBe(false);
    // El enlace de contraseña nueva que había hecho el Administrador de ORG tampoco sirve ya.
    expect(await readReset(tokenOf(pending))).toBeNull();
    expect(await completeReset(tokenOf(pending), "clave-del-admin-x")).toBeNull();
    // Con el enlace que le llega a su correo sí elige una que sirve en las dos.
    await requestPasswordReset("ana@ejemplo.com", "es");
    expect(await completeReset(tokenOf(lastLink()), "clave-propia-ana")).not.toBeNull();
    expect(await db.user.findUniqueOrThrow({ where: { id: ana.id } })).toMatchObject({ passwordOrgId: "" });
    expect(await checkPassword("ana@ejemplo.com", "clave-propia-ana")).toBe(true);
  });

  it("resending makes the old link useless; canceling and expiry too", async () => {
    const first = await invite(ORG, boss, { email: "ana@ejemplo.com", role: "viewer", allBusinesses: true, businessIds: [] }, "es");
    const inv = await db.invitation.findFirstOrThrow({ where: { organizationId: ORG, email: "ana@ejemplo.com", canceledAt: null } });
    const again = await resendInvite(ORG, inv.id, boss, "es");
    expect(await readInvitation(tokenOf(first.link))).toBeNull();
    expect(await readInvitation(tokenOf(again.link))).not.toBeNull();
    await cancelInvite(ORG, inv.id);
    expect(await readInvitation(tokenOf(again.link))).toBeNull();
    const late = await invite(ORG, boss, { email: "ana@ejemplo.com", role: "viewer", allBusinesses: true, businessIds: [] }, "es");
    await db.invitation.updateMany({ where: { organizationId: ORG, email: "ana@ejemplo.com", canceledAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await acceptInvitation(tokenOf(late.link), "ana@ejemplo.com", { newPassword: "clave-de-ana-1" })).toBeNull();
  });

  it("another organization's admin can't touch this team's invitations or members", async () => {
    const { link } = await invite(ORG, boss, { email: "ana@ejemplo.com", role: "viewer", allBusinesses: true, businessIds: [] }, "es");
    const inv = await db.invitation.findFirstOrThrow({ where: { organizationId: ORG, email: "ana@ejemplo.com", canceledAt: null } });
    await expect(resendInvite(OTHER, inv.id, boss, "es")).rejects.toThrow();
    await cancelInvite(OTHER, inv.id);
    expect(await readInvitation(tokenOf(link))).not.toBeNull();
    await expect(changeMember(OTHER, bossMembership, { role: "viewer", allBusinesses: true, businessIds: [] })).rejects.toThrow();
    expect(await removeMember(OTHER, bossMembership)).toBeNull();
    await expect(adminResetLink(OTHER, bossMembership)).rejects.toThrow();
  });

  it("always keeps an Administrator, and removing someone closes their sessions", async () => {
    await expect(changeMember(ORG, bossMembership, { role: "viewer", allBusinesses: true, businessIds: [] })).rejects.toThrow(/Administrador/);
    await expect(removeMember(ORG, bossMembership)).rejects.toThrow(/Administrador/);
    const { link } = await invite(ORG, boss, { email: "ana@ejemplo.com", role: "admin", allBusinesses: false, businessIds: [B1] }, "es");
    const ana = (await acceptInvitation(tokenOf(link), "ana@ejemplo.com", { newPassword: "clave-de-ana-1" }))!;
    const anaM = await db.membership.findFirstOrThrow({ where: { userId: ana.id, organizationId: ORG } });
    expect(anaM.allBusinesses).toBe(true);
    await changeMember(ORG, bossMembership, { role: "viewer", allBusinesses: false, businessIds: [B1] });
    await changeMember(ORG, anaM.id, { role: "publisher", allBusinesses: true, businessIds: [] }).catch((e) => expect(String(e)).toMatch(/Administrador/));
    expect(await removeMember(ORG, anaM.id).catch(() => "blocked")).toBe("blocked");
    const before = (await db.user.findUniqueOrThrow({ where: { id: boss.id } })).sessionVersion;
    expect(await removeMember(ORG, bossMembership)).toBe(boss.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: boss.id } })).sessionVersion).toBe(before + 1);
    expect(await loginUser("boss@gmail.com", { owner: false })).toBeNull();
  });

  it("an owner of Matya is always Administrator of the main organization: no change, removal or reset link there", async () => {
    const main = (await mainOrganizationId())!;
    expect(main).not.toBe(ORG);
    const owner = await db.user.create({ data: { email: "owner-it@gmail.com" } });
    const inMain = await db.membership.create({ data: { userId: owner.id, organizationId: main, role: "admin" } });
    await expect(changeMember(main, inMain.id, { role: "viewer", allBusinesses: false, businessIds: [] })).rejects.toThrow(/dueño/);
    await expect(changeMember(main, inMain.id, { role: "publisher", allBusinesses: true, businessIds: [] })).rejects.toThrow(/dueño/);
    await expect(removeMember(main, inMain.id)).rejects.toThrow(/LOGIN_EMAILS/);
    await expect(adminResetLink(main, inMain.id)).rejects.toThrow();
    expect(await db.membership.findUniqueOrThrow({ where: { id: inMain.id } })).toMatchObject({ role: "admin", allBusinesses: true });
    expect((await teamOf(main)).members.find((m) => m.email === "owner-it@gmail.com")).toMatchObject({ owner: true, fixedAdmin: true });
    // En otra organización es un miembro más (pero su contraseña nunca se cambia desde ahí).
    const inOrg = await db.membership.create({ data: { userId: owner.id, organizationId: ORG, role: "viewer" } });
    expect((await teamOf(ORG)).members.find((m) => m.email === "owner-it@gmail.com")).toMatchObject({ owner: true, fixedAdmin: false });
    await expect(adminResetLink(ORG, inOrg.id)).rejects.toThrow();
    expect(await removeMember(ORG, inOrg.id)).toBe(owner.id);
    expect(await checkPassword("owner-it@gmail.com", "app-pass-123")).toBe(true);
  });

  it("two Administrators demoting or removing each other at the same time still leave one", async () => {
    const { link } = await invite(ORG, boss, { email: "ana@ejemplo.com", role: "admin", allBusinesses: true, businessIds: [] }, "es");
    const ana = (await acceptInvitation(tokenOf(link), "ana@ejemplo.com", { newPassword: "clave-de-ana-1" }))!;
    const anaM = (await db.membership.findFirstOrThrow({ where: { userId: ana.id, organizationId: ORG } })).id;
    const viewer = { role: "viewer", allBusinesses: true, businessIds: [] };
    const demoted = await Promise.allSettled([changeMember(ORG, bossMembership, viewer), changeMember(ORG, anaM, viewer)]);
    expect(demoted.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.membership.count({ where: { organizationId: ORG, role: "admin" } })).toBe(1);
    await db.membership.updateMany({ where: { id: { in: [bossMembership, anaM] } }, data: { role: "admin" } });
    const removed = await Promise.allSettled([removeMember(ORG, bossMembership), removeMember(ORG, anaM)]);
    expect(removed.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.membership.count({ where: { organizationId: ORG, role: "admin" } })).toBe(1);
  });

  it("forgot password: only real members get a one-time link that closes their other sessions", async () => {
    await requestPasswordReset("nadie@ejemplo.com", "es");
    await requestPasswordReset("boss@gmail.com", "es");
    expect(sent.map((s) => s.to)).toEqual(["boss@gmail.com"]);
    const token = tokenOf(lastLink());
    expect(await readReset(token)).toEqual({ email: "boss@gmail.com" });
    const user = await completeReset(token, "clave-nueva-boss");
    expect(user?.sessionVersion).toBe(1);
    expect(await completeReset(token, "otra-mas-larga")).toBeNull();
    expect(await checkPassword("boss@gmail.com", "clave-nueva-boss")).toBe(true);
  });

  it("an admin reset link only works for people who are only in this organization, checked again when it's used", async () => {
    const both = await db.user.create({ data: { email: "both@ejemplo.com" } });
    const inOrg = await db.membership.create({ data: { userId: both.id, organizationId: ORG, role: "viewer" } });
    const first = await adminResetLink(ORG, inOrg.id);
    expect(first).toMatch(/\/clave\/[A-Za-z0-9_-]{43}$/);
    // Un enlace nuevo deja sin efecto el anterior: el Administrador no puede guardar uno escondido.
    const second = await adminResetLink(ORG, inOrg.id);
    expect(await readReset(tokenOf(first))).toBeNull();
    expect(await readReset(tokenOf(second))).toEqual({ email: "both@ejemplo.com" });
    // Entra a otra organización antes de que se use: el enlace ya no sirve.
    const elsewhere = await db.membership.create({ data: { userId: both.id, organizationId: OTHER, role: "admin" } });
    expect(await readReset(tokenOf(second))).toBeNull();
    expect(await completeReset(tokenOf(second), "clave-del-admin-x")).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: both.id } })).passwordHash).toBe("");
    await expect(adminResetLink(ORG, inOrg.id)).rejects.toThrow(/otra organización/);
    // Solo en ORG otra vez: la contraseña que elige queda atada a ORG.
    await db.membership.delete({ where: { id: elsewhere.id } });
    const third = await adminResetLink(ORG, inOrg.id);
    expect(await completeReset(tokenOf(third), "clave-de-both-1")).not.toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: both.id } })).passwordOrgId).toBe(ORG);
    expect(await checkPassword("both@ejemplo.com", "clave-de-both-1")).toBe(true);
  });

  it("the team view lists members, pending invitations and the organization's businesses", async () => {
    await invite(ORG, boss, { email: "ana@ejemplo.com", role: "viewer", allBusinesses: false, businessIds: [B1] }, "es");
    const team = await teamOf(ORG);
    expect(team.members.map((m) => [m.email, m.role, m.allBusinesses])).toEqual([["boss@gmail.com", "admin", true]]);
    expect(team.invitations.map((i) => [i.email, i.role, i.businessIds])).toEqual([["ana@ejemplo.com", "viewer", [B1]]]);
    expect(team.businesses.map((b) => b.id)).toEqual([B1, B2]);
  });
});
