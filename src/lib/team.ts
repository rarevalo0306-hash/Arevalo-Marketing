// El equipo de una organización: miembros, invitaciones y enlaces para una contraseña nueva. Lo usan «Equipo y
// permisos» (src/app/actions-team.ts), la página de la invitación y las rutas de entrar. Quien llama ya revisó que la
// persona es Administrador de la organización (requireOrgAdmin) o, al aceptar, que el correo es el de la invitación.
// Reglas: siempre queda al menos un Administrador; el Administrador entra a todas las empresas; los enlaces sirven una
// vez y vencen (invitación 7 días, contraseña 1 hora); a un dueño de Matya (LOGIN_EMAILS) no se le invita, ni se le
// quita, ni se le cambia el papel o la contraseña desde aquí (en la organización principal siempre es Administrador).
// Una contraseña elegida con un enlace que pudo ver un Administrador guarda de qué organización era (passwordOrgId):
// deja de servir si la persona entra a otra organización (src/lib/accounts.ts checkPassword).
import type { Prisma } from "@prisma/client";
import { isOwnerEmail, looksLikeEmail, mainOrganizationId, makeOwnerAdmin, normalizeEmail } from "@/lib/accounts";
import { sendAuthEmail } from "@/lib/auth-email";
import { db } from "@/lib/db";
import { appBase } from "@/lib/google-login";
import { bi, translator, type UiLang } from "@/lib/i18n";
import { hashPassword, looksLikeToken, newLinkToken, tokenHash } from "@/lib/password";
import { asRole, roleLabel, type Role } from "@/lib/roles";

export const INVITE_DAYS = 7;
export const RESET_MINUTES = 60;
const DAY = 24 * 60 * 60 * 1000;

export type Access = { role: Role; allBusinesses: boolean; businessIds: string[] };

/** Papel y empresas limpios: el Administrador entra a todas; si no entra a todas, al menos una y solo de esta organización. */
async function cleanAccess(organizationId: string, raw: { role: string; allBusinesses: boolean; businessIds: string[] }): Promise<Access> {
  const role = asRole(raw.role);
  if (!role) throw bi("Elige un papel.", "Choose a role.");
  if (role === "admin" || raw.allBusinesses) return { role, allBusinesses: true, businessIds: [] };
  const wanted = [...new Set(raw.businessIds.filter((id) => typeof id === "string"))].slice(0, 200);
  const found = await db.business.findMany({ where: { organizationId, id: { in: wanted } }, select: { id: true } });
  if (!found.length) throw bi("Elige al menos una empresa.", "Choose at least one business.");
  return { role, allBusinesses: false, businessIds: found.map((b) => b.id) };
}

/**
 * Cambios del equipo uno a la vez por organización: dos Administradores que se bajan al mismo tiempo no la dejan sin
 * ninguno, y dos invitaciones al mismo correo no quedan las dos pendientes.
 */
async function lockOrganization(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
}

// ---------- Ver el equipo ----------

export async function teamOf(organizationId: string) {
  const [org, members, invitations, businesses, main] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { id: true, name: true, kind: true } }),
    db.membership.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, allBusinesses: true, businesses: { select: { businessId: true } }, user: { select: { id: true, email: true, name: true, lastLoginAt: true, passwordHash: true } } },
    }),
    db.invitation.findMany({
      where: { organizationId, acceptedAt: null, canceledAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, allBusinesses: true, businessIds: true, createdAt: true, expiresAt: true },
    }),
    db.business.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, color: true } }),
    mainOrganizationId(),
  ]);
  return {
    org,
    businesses,
    members: members.map((m) => ({
      membershipId: m.id,
      userId: m.user.id,
      email: m.user.email,
      name: m.user.name,
      role: asRole(m.role) ?? "viewer",
      allBusinesses: m.role === "admin" || m.allBusinesses,
      businessIds: m.businesses.map((b) => b.businessId),
      lastLoginAt: m.user.lastLoginAt,
      hasPassword: Boolean(m.user.passwordHash),
      owner: isOwnerEmail(m.user.email),
      /** Dueño en la organización principal: siempre Administrador, no se cambia ni se quita desde aquí. */
      fixedAdmin: isOwnerEmail(m.user.email) && organizationId === main,
    })),
    invitations: invitations.map((i) => ({ ...i, role: asRole(i.role) ?? "viewer" })),
  };
}

// ---------- Invitar ----------

const inviteLink = (token: string) => `${appBase()}/invitacion/${token}`;

async function sendInvite(to: string, token: string, organizationId: string, access: Access, inviterName: string, lang: UiLang) {
  const t = translator(lang);
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
  const names = access.allBusinesses
    ? t("Todas las empresas", "All businesses")
    : (await db.business.findMany({ where: { id: { in: access.businessIds } }, select: { name: true } })).map((b) => b.name).join(", ");
  return sendAuthEmail({
    to,
    subject: t(`${inviterName} te invitó a Matya`, `${inviterName} invited you to Matya`),
    intro: [t(`Hola. ${inviterName} te invitó a trabajar en Matya, en la organización «${org.name}».`, `Hi. ${inviterName} invited you to work in Matya, in the organization "${org.name}".`)],
    facts: [
      [t("Tu papel:", "Your role:"), roleLabel(access.role, t)],
      [t("Empresas:", "Businesses:"), names],
    ],
    button: { label: t("Aceptar la invitación", "Accept the invitation"), href: inviteLink(token) },
    footer: t(
      `El enlace vence en ${INVITE_DAYS} días y sirve una sola vez. Si no esperabas esta invitación, ignora este correo.`,
      `The link expires in ${INVITE_DAYS} days and works only once. If you weren't expecting this invitation, ignore this email.`,
    ),
  });
}

/** Crea la invitación (reemplaza otra pendiente al mismo correo) y manda el correo. Devuelve el enlace para copiarlo. */
export async function invite(
  organizationId: string,
  inviter: { id: string; name: string; email: string },
  raw: { email: string; role: string; allBusinesses: boolean; businessIds: string[] },
  lang: UiLang,
): Promise<{ link: string; emailed: boolean; email: string }> {
  const email = normalizeEmail(String(raw.email ?? "")).slice(0, 254);
  if (!looksLikeEmail(email)) throw bi("Ese correo no parece válido.", "That email doesn't look valid.");
  if (isOwnerEmail(email)) throw bi("Ese correo es de un dueño de Matya: ya entra como Administrador, no hace falta invitarlo.", "That email belongs to a Matya owner: they already sign in as Administrator, no invitation needed.");
  const access = await cleanAccess(organizationId, raw);
  const { token, hash } = newLinkToken();
  // Una invitación pendiente por correo: dos Administradores que invitan a la vez no dejan dos enlaces que sirvan.
  await db.$transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    const member = await tx.membership.findFirst({ where: { organizationId, user: { email } }, select: { id: true } });
    if (member) throw bi("Esa persona ya es parte del equipo. Cambia su papel en la lista.", "That person is already on the team. Change their role in the list.");
    await tx.invitation.updateMany({ where: { organizationId, email, acceptedAt: null, canceledAt: null }, data: { canceledAt: new Date() } });
    await tx.invitation.create({
      data: { organizationId, email, ...access, tokenHash: hash, invitedById: inviter.id, expiresAt: new Date(Date.now() + INVITE_DAYS * DAY) },
    });
  });
  const emailed = await sendInvite(email, token, organizationId, access, inviter.name || inviter.email, lang);
  return { link: inviteLink(token), emailed, email };
}

/** Enlace nuevo para una invitación pendiente (el anterior deja de servir) y se vuelve a mandar. */
export async function resendInvite(organizationId: string, invitationId: string, inviter: { name: string; email: string }, lang: UiLang): Promise<{ link: string; emailed: boolean }> {
  const inv = await db.invitation.findFirst({ where: { id: invitationId, organizationId, acceptedAt: null, canceledAt: null }, select: { id: true, email: true, role: true, allBusinesses: true, businessIds: true } });
  if (!inv) throw bi("Esa invitación ya no está pendiente.", "That invitation is no longer pending.");
  const { token, hash } = newLinkToken();
  await db.invitation.update({ where: { id: inv.id }, data: { tokenHash: hash, expiresAt: new Date(Date.now() + INVITE_DAYS * DAY) } });
  const access: Access = { role: asRole(inv.role) ?? "viewer", allBusinesses: inv.allBusinesses, businessIds: inv.businessIds };
  const emailed = await sendInvite(inv.email, token, organizationId, access, inviter.name || inviter.email, lang);
  return { link: inviteLink(token), emailed };
}

export async function cancelInvite(organizationId: string, invitationId: string): Promise<void> {
  await db.invitation.updateMany({ where: { id: invitationId, organizationId, acceptedAt: null, canceledAt: null }, data: { canceledAt: new Date() } });
}

// ---------- Aceptar ----------

export type InvitationView = {
  email: string;
  organizationName: string;
  role: Role;
  businessNames: string[] | null;
  inviterName: string;
  /** Ya existe una cuenta con ese correo que entra a algo (o es dueño): debe entrar con ella para aceptar. Nunca se le pone
   *  contraseña desde el enlace. Una cuenta que ya no está en ninguna organización sí puede elegir contraseña nueva. */
  existingUser: boolean;
};

async function pendingByToken(token: string) {
  if (!looksLikeToken(token)) return null;
  const inv = await db.invitation.findUnique({ where: { tokenHash: tokenHash(token) } });
  return inv && !inv.acceptedAt && !inv.canceledAt && inv.expiresAt > new Date() ? inv : null;
}

/** Lo que muestra la página de la invitación, o null si el enlace no sirve (venció, se usó o lo cancelaron). */
export async function readInvitation(token: string): Promise<InvitationView | null> {
  const inv = await pendingByToken(token);
  if (!inv) return null;
  const [org, inviter, user, businesses] = await Promise.all([
    db.organization.findUnique({ where: { id: inv.organizationId }, select: { name: true } }),
    db.user.findUnique({ where: { id: inv.invitedById }, select: { name: true, email: true } }),
    db.user.findUnique({ where: { email: inv.email }, select: { id: true, _count: { select: { memberships: true } } } }),
    inv.allBusinesses ? Promise.resolve(null) : db.business.findMany({ where: { id: { in: inv.businessIds }, organizationId: inv.organizationId }, select: { name: true } }),
  ]);
  if (!org) return null;
  return {
    email: inv.email,
    organizationName: org.name,
    role: asRole(inv.role) ?? "viewer",
    businessNames: businesses ? businesses.map((b) => b.name) : null,
    inviterName: inviter?.name || inviter?.email || "",
    existingUser: isOwnerEmail(inv.email) || Boolean(user?._count.memberships),
  };
}

/**
 * Acepta la invitación para ese correo (debe ser el de la invitación): crea la persona si no existe (con su contraseña,
 * si la eligió) y le da el papel. El enlace queda usado. Devuelve la persona para abrir su sesión, o null.
 * Con `newPassword` solo funciona si la cuenta no existe, o si ya no está en ninguna organización (alguien a quien
 * quitaron y vuelven a invitar): a una cuenta que entra a algo nunca se le pone contraseña aquí. Quien tiene el enlace
 * (también el Administrador que invitó) puede elegir esa contraseña, así que queda atada a esta organización.
 * Un dueño de Matya nunca acepta invitaciones: entra solo y es Administrador de la organización principal.
 */
export async function acceptInvitation(token: string, rawEmail: string, opts: { name?: string; newPassword?: string } = {}): Promise<{ id: string; sessionVersion: number } | null> {
  const inv = await pendingByToken(token);
  const email = normalizeEmail(rawEmail);
  if (!inv || inv.email !== email) return null;
  if (isOwnerEmail(email)) throw bi("Ese correo es de un dueño de Matya: entra normalmente, sin la invitación.", "That email belongs to a Matya owner: sign in normally, without the invitation.");
  const passwordHash = opts.newPassword ? await hashPassword(opts.newPassword) : "";
  const name = (opts.name ?? "").trim().slice(0, 120);
  return db.$transaction(async (tx) => {
    // Primero la organización (en el mismo orden que invitar o cambiar el equipo, para que nunca se esperen en cruz).
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${inv.organizationId} FOR KEY SHARE`;
    // El enlace sirve una vez: si otro lo usó al mismo tiempo, este no cambia nada.
    const used = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null, canceledAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
    if (used.count !== 1) return null;
    // Una sola cosa a la vez con esta cuenta (otra invitación, un enlace de contraseña): ver y cambiar van juntos.
    await tx.$queryRaw`SELECT id FROM "User" WHERE email = ${email} FOR UPDATE`;
    const select = { id: true, name: true, sessionVersion: true, passwordHash: true, passwordOrgId: true, _count: { select: { memberships: true } } } as const;
    let user = await tx.user.findUnique({ where: { email }, select });
    if (user && passwordHash) {
      if (user._count.memberships > 0) throw bi("Ya tienes una cuenta con ese correo: entra con ella para aceptar.", "You already have an account with that email: sign in with it to accept.");
      // Cuenta sin ninguna organización (la quitaron antes): elige contraseña nueva y se cierran sus sesiones viejas.
      user = await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordOrgId: inv.organizationId, sessionVersion: { increment: 1 } }, select });
    } else if (user) {
      // Ya está en este equipo (quedó otra invitación pendiente): el enlace queda usado y su papel no cambia.
      const already = await tx.membership.findUnique({ where: { userId_organizationId: { userId: user.id, organizationId: inv.organizationId } }, select: { id: true } });
      if (already) return { id: user.id, sessionVersion: user.sessionVersion };
      // Su contraseña salió de un enlace que vio un Administrador de otra organización: deja de servir y se cierran sus
      // sesiones, para que ese Administrador no entre aquí. La vuelve a elegir con «¿Olvidaste tu contraseña?».
      if (user.passwordHash && user.passwordOrgId && user.passwordOrgId !== inv.organizationId)
        user = await tx.user.update({ where: { id: user.id }, data: { passwordHash: "", passwordOrgId: "", sessionVersion: { increment: 1 } }, select });
    }
    user ??= await tx.user.create({ data: { email, name, passwordHash, passwordOrgId: passwordHash ? inv.organizationId : "" }, select });
    // Los enlaces para contraseña nueva que hizo el Administrador de otra organización dejan de servir.
    await tx.passwordReset.updateMany({ where: { userId: user.id, usedAt: null, organizationId: { notIn: ["", inv.organizationId] } }, data: { usedAt: new Date() } });
    const access = { role: inv.role, allBusinesses: inv.role === "admin" || inv.allBusinesses };
    const businessIds = access.allBusinesses ? [] : (await tx.business.findMany({ where: { id: { in: inv.businessIds }, organizationId: inv.organizationId }, select: { id: true } })).map((b) => b.id);
    const m = await tx.membership.create({ data: { userId: user.id, organizationId: inv.organizationId, ...access }, select: { id: true } });
    if (businessIds.length) await tx.membershipBusiness.createMany({ data: businessIds.map((businessId) => ({ membershipId: m.id, businessId })) });
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), ...(name && !user.name && { name }) } });
    return { id: user.id, sessionVersion: user.sessionVersion };
  });
}

// ---------- Cambiar o quitar ----------

async function adminsLeftWithout(tx: Prisma.TransactionClient, organizationId: string, membershipId: string) {
  return tx.membership.count({ where: { organizationId, role: "admin", id: { not: membershipId } } });
}

/** ¿Es un dueño de Matya en la organización principal? Ahí siempre es Administrador con todas las empresas. */
async function fixedAdmin(tx: Prisma.TransactionClient, organizationId: string, email: string) {
  return isOwnerEmail(email) && (await mainOrganizationId(tx)) === organizationId;
}

export async function changeMember(organizationId: string, membershipId: string, raw: { role: string; allBusinesses: boolean; businessIds: string[] }): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    const m = await tx.membership.findFirst({ where: { id: membershipId, organizationId }, select: { id: true, role: true, user: { select: { email: true } } } });
    if (!m) throw bi("Esa persona ya no está en el equipo.", "That person is no longer on the team.");
    if (await fixedAdmin(tx, organizationId, m.user.email)) throw bi("Es dueño de Matya: siempre es Administrador con todas las empresas.", "They're a Matya owner: they're always an Administrator with every business.");
    const access = await cleanAccess(organizationId, raw);
    if (m.role === "admin" && access.role !== "admin" && (await adminsLeftWithout(tx, organizationId, m.id)) === 0)
      throw bi("Tiene que quedar al menos un Administrador.", "There must be at least one Administrator.");
    await tx.membership.update({ where: { id: m.id }, data: { role: access.role, allBusinesses: access.allBusinesses } });
    await tx.membershipBusiness.deleteMany({ where: { membershipId: m.id } });
    if (access.businessIds.length) await tx.membershipBusiness.createMany({ data: access.businessIds.map((businessId) => ({ membershipId: m.id, businessId })) });
  });
}

/** Quita a la persona de la organización y cierra sus sesiones en todos lados. Devuelve a quién quitó. */
export async function removeMember(organizationId: string, membershipId: string): Promise<string | null> {
  return db.$transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    const m = await tx.membership.findFirst({ where: { id: membershipId, organizationId }, select: { id: true, role: true, userId: true, user: { select: { email: true } } } });
    if (!m) return null;
    if (await fixedAdmin(tx, organizationId, m.user.email)) throw bi("Es dueño de Matya: para quitarlo, primero quita su correo de LOGIN_EMAILS en Vercel.", "They're a Matya owner: to remove them, first take their email out of LOGIN_EMAILS in Vercel.");
    if (m.role === "admin" && (await adminsLeftWithout(tx, organizationId, m.id)) === 0) throw bi("Tiene que quedar al menos un Administrador.", "There must be at least one Administrator.");
    await tx.membership.delete({ where: { id: m.id } });
    await tx.user.update({ where: { id: m.userId }, data: { sessionVersion: { increment: 1 } } });
    return m.userId;
  });
}

// ---------- Contraseña nueva ----------

const resetLink = (token: string) => `${appBase()}/clave/${token}`;

/** Un enlace nuevo (los anteriores de esa persona dejan de servir). organizationId: la del Administrador que lo hizo, o "". */
async function newReset(userId: string, organizationId: string): Promise<string> {
  const { token, hash } = newLinkToken();
  await db.$transaction([
    db.passwordReset.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
    db.passwordReset.create({ data: { userId, organizationId, tokenHash: hash, expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) } }),
  ]);
  return token;
}

type ResetRow = { usedAt: Date | null; expiresAt: Date; organizationId: string; user: { email: string; memberships: { organizationId: string }[] } };
const resetSelect = { usedAt: true, expiresAt: true, organizationId: true, user: { select: { email: true, memberships: { select: { organizationId: true } } } } } as const;

/**
 * ¿Sirve todavía? Sin usar, sin vencer y la persona sigue en algún equipo (o es dueño). Si lo hizo un Administrador,
 * además la persona sigue solo en esa organización y no es dueño: se revisa al usarlo, no solo al hacerlo.
 */
function resetUsable(r: ResetRow | null): r is ResetRow {
  if (!r || r.usedAt || r.expiresAt <= new Date()) return false;
  const orgs = r.user.memberships.map((m) => m.organizationId);
  if (!r.organizationId) return orgs.length > 0 || isOwnerEmail(r.user.email);
  return orgs.length > 0 && orgs.every((id) => id === r.organizationId) && !isOwnerEmail(r.user.email);
}

/**
 * «¿Olvidaste tu contraseña?»: si ese correo puede entrar (es miembro o dueño), le manda un enlace. No dice si existe.
 */
export async function requestPasswordReset(rawEmail: string, lang: UiLang): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!looksLikeEmail(email)) return;
  const user = await db.user.findUnique({ where: { email }, select: { id: true, _count: { select: { memberships: true } } } });
  if (!user || (!user._count.memberships && !isOwnerEmail(email))) return;
  const token = await newReset(user.id, "");
  const t = translator(lang);
  await sendAuthEmail({
    to: email,
    subject: t("Tu enlace para una contraseña nueva en Matya", "Your link for a new Matya password"),
    intro: [t("Pediste una contraseña nueva para entrar a Matya. Toca el botón y elígela.", "You asked for a new password to sign in to Matya. Tap the button and choose it.")],
    button: { label: t("Elegir contraseña nueva", "Choose a new password"), href: resetLink(token) },
    footer: t(`El enlace vence en ${RESET_MINUTES} minutos y sirve una sola vez. Si no lo pediste, ignora este correo.`, `The link expires in ${RESET_MINUTES} minutes and works only once. If you didn't ask for it, ignore this email.`),
  });
}

/** Enlace para que un miembro elija contraseña nueva, para que el Administrador se lo mande. Solo si esa persona no está
 *  en ninguna otra organización y no es dueño de Matya (así nadie toma la cuenta de alguien de afuera). */
export async function adminResetLink(organizationId: string, membershipId: string): Promise<string> {
  const m = await db.membership.findFirst({ where: { id: membershipId, organizationId }, select: { userId: true, user: { select: { email: true } } } });
  if (!m) throw bi("Esa persona ya no está en el equipo.", "That person is no longer on the team.");
  if (isOwnerEmail(m.user.email)) throw bi("Es dueño de Matya: elige su contraseña con «¿Olvidaste tu contraseña?».", "They're a Matya owner: they choose their password with \"Forgot your password?\".");
  const elsewhere = await db.membership.count({ where: { userId: m.userId, organizationId: { not: organizationId } } });
  if (elsewhere) throw bi("Esa persona también está en otra organización: que use «¿Olvidaste tu contraseña?».", "That person is also in another organization: they should use \"Forgot your password?\".");
  return resetLink(await newReset(m.userId, organizationId));
}

/** El correo del enlace de contraseña nueva, o null si no sirve. */
export async function readReset(token: string): Promise<{ email: string } | null> {
  if (!looksLikeToken(token)) return null;
  const r = await db.passwordReset.findUnique({ where: { tokenHash: tokenHash(token) }, select: resetSelect });
  return resetUsable(r) ? { email: r.user.email } : null;
}

/**
 * Guarda la contraseña nueva (el enlace queda usado) y cierra las demás sesiones. Devuelve la persona para entrar.
 * La contraseña queda atada a la organización del Administrador que hizo el enlace (o a nadie, si llegó al correo).
 */
export async function completeReset(token: string, password: string): Promise<{ id: string; sessionVersion: number } | null> {
  // Primero el enlace (barato): scrypt solo corre con un enlace que sirve.
  if (!(await readReset(token))) return null;
  const passwordHash = await hashPassword(password);
  return db.$transaction(async (tx) => {
    const found = await tx.passwordReset.findUnique({ where: { tokenHash: tokenHash(token) }, select: { id: true, userId: true } });
    if (!found) return null;
    // Una sola cosa a la vez con esta cuenta (p. ej. aceptar otra invitación): se vuelve a revisar ya bloqueada.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${found.userId} FOR UPDATE`;
    const r = await tx.passwordReset.findUnique({ where: { id: found.id }, select: { ...resetSelect, id: true, userId: true } });
    if (!resetUsable(r)) return null;
    const used = await tx.passwordReset.updateMany({ where: { id: r.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (used.count !== 1) return null;
    // Un dueño que entra así también queda Administrador de la organización principal (como al entrar con contraseña o Google).
    if (isOwnerEmail(r.user.email)) await makeOwnerAdmin(tx, r.userId, r.user.email);
    return tx.user.update({
      where: { id: r.userId },
      data: { passwordHash, passwordOrgId: r.organizationId, sessionVersion: { increment: 1 }, lastLoginAt: new Date() },
      select: { id: true, sessionVersion: true },
    });
  });
}
