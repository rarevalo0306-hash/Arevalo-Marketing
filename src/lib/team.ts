// El equipo de una organización: miembros, invitaciones y enlaces para una contraseña nueva. Lo usan «Equipo y
// permisos» (src/app/actions-team.ts), la página de la invitación y las rutas de entrar. Quien llama ya revisó que la
// persona es Administrador de la organización (requireOrgAdmin) o, al aceptar, que el correo es el de la invitación.
// Reglas: siempre queda al menos un Administrador; el Administrador entra a todas las empresas; los enlaces sirven una
// vez y vencen (invitación 7 días, contraseña 1 hora); a un dueño de Matya (LOGIN_EMAILS) no se le quita ni se le
// cambia la contraseña desde aquí.
import { isOwnerEmail, looksLikeEmail, normalizeEmail } from "@/lib/accounts";
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

// ---------- Ver el equipo ----------

export async function teamOf(organizationId: string) {
  const [org, members, invitations, businesses] = await Promise.all([
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
  const access = await cleanAccess(organizationId, raw);
  const member = await db.membership.findFirst({ where: { organizationId, user: { email } }, select: { id: true } });
  if (member) throw bi("Esa persona ya es parte del equipo. Cambia su papel en la lista.", "That person is already on the team. Change their role in the list.");
  const { token, hash } = newLinkToken();
  await db.$transaction([
    db.invitation.updateMany({ where: { organizationId, email, acceptedAt: null, canceledAt: null }, data: { canceledAt: new Date() } }),
    db.invitation.create({
      data: { organizationId, email, ...access, tokenHash: hash, invitedById: inviter.id, expiresAt: new Date(Date.now() + INVITE_DAYS * DAY) },
    }),
  ]);
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
  /** Ya existe una cuenta con ese correo: debe entrar con ella para aceptar (nunca se le pone contraseña desde el enlace). */
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
    db.user.findUnique({ where: { email: inv.email }, select: { id: true } }),
    inv.allBusinesses ? Promise.resolve(null) : db.business.findMany({ where: { id: { in: inv.businessIds }, organizationId: inv.organizationId }, select: { name: true } }),
  ]);
  if (!org) return null;
  return {
    email: inv.email,
    organizationName: org.name,
    role: asRole(inv.role) ?? "viewer",
    businessNames: businesses ? businesses.map((b) => b.name) : null,
    inviterName: inviter?.name || inviter?.email || "",
    existingUser: Boolean(user),
  };
}

/**
 * Acepta la invitación para ese correo (debe ser el de la invitación): crea la persona si no existe (con su contraseña,
 * si la eligió) y le da el papel. El enlace queda usado. Devuelve la persona para abrir su sesión, o null.
 * Con `newPassword` solo funciona si la cuenta no existe: a una cuenta que ya existe nunca se le pone contraseña aquí.
 */
export async function acceptInvitation(token: string, rawEmail: string, opts: { name?: string; newPassword?: string } = {}): Promise<{ id: string; sessionVersion: number } | null> {
  const inv = await pendingByToken(token);
  const email = normalizeEmail(rawEmail);
  if (!inv || inv.email !== email) return null;
  const passwordHash = opts.newPassword ? await hashPassword(opts.newPassword) : "";
  const name = (opts.name ?? "").trim().slice(0, 120);
  return db.$transaction(async (tx) => {
    // El enlace sirve una vez: si otro lo usó al mismo tiempo, este no cambia nada.
    const used = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null, canceledAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
    if (used.count !== 1) return null;
    let user = await tx.user.findUnique({ where: { email }, select: { id: true, name: true, sessionVersion: true } });
    if (user && passwordHash) throw bi("Ya tienes una cuenta con ese correo: entra con ella para aceptar.", "You already have an account with that email: sign in with it to accept.");
    user ??= await tx.user.create({ data: { email, name, passwordHash }, select: { id: true, name: true, sessionVersion: true } });
    const access = { role: inv.role, allBusinesses: inv.role === "admin" || inv.allBusinesses };
    const businessIds = access.allBusinesses ? [] : (await tx.business.findMany({ where: { id: { in: inv.businessIds }, organizationId: inv.organizationId }, select: { id: true } })).map((b) => b.id);
    const m = await tx.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: inv.organizationId } },
      create: { userId: user.id, organizationId: inv.organizationId, ...access },
      update: access,
      select: { id: true },
    });
    await tx.membershipBusiness.deleteMany({ where: { membershipId: m.id } });
    if (businessIds.length) await tx.membershipBusiness.createMany({ data: businessIds.map((businessId) => ({ membershipId: m.id, businessId })) });
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), ...(name && !user.name && { name }) } });
    return { id: user.id, sessionVersion: user.sessionVersion };
  });
}

// ---------- Cambiar o quitar ----------

async function adminsLeftWithout(organizationId: string, membershipId: string) {
  return db.membership.count({ where: { organizationId, role: "admin", id: { not: membershipId } } });
}

export async function changeMember(organizationId: string, membershipId: string, raw: { role: string; allBusinesses: boolean; businessIds: string[] }): Promise<void> {
  const m = await db.membership.findFirst({ where: { id: membershipId, organizationId }, select: { id: true, role: true } });
  if (!m) throw bi("Esa persona ya no está en el equipo.", "That person is no longer on the team.");
  const access = await cleanAccess(organizationId, raw);
  if (m.role === "admin" && access.role !== "admin" && (await adminsLeftWithout(organizationId, m.id)) === 0)
    throw bi("Tiene que quedar al menos un Administrador.", "There must be at least one Administrator.");
  await db.$transaction([
    db.membership.update({ where: { id: m.id }, data: { role: access.role, allBusinesses: access.allBusinesses } }),
    db.membershipBusiness.deleteMany({ where: { membershipId: m.id } }),
    ...(access.businessIds.length ? [db.membershipBusiness.createMany({ data: access.businessIds.map((businessId) => ({ membershipId: m.id, businessId })) })] : []),
  ]);
}

/** Quita a la persona de la organización y cierra sus sesiones en todos lados. Devuelve a quién quitó. */
export async function removeMember(organizationId: string, membershipId: string): Promise<string | null> {
  const m = await db.membership.findFirst({ where: { id: membershipId, organizationId }, select: { id: true, role: true, userId: true, user: { select: { email: true } } } });
  if (!m) return null;
  if (isOwnerEmail(m.user.email)) throw bi("Es dueño de Matya: para quitarlo, primero quita su correo de LOGIN_EMAILS en Vercel.", "They're a Matya owner: to remove them, first take their email out of LOGIN_EMAILS in Vercel.");
  if (m.role === "admin" && (await adminsLeftWithout(organizationId, m.id)) === 0) throw bi("Tiene que quedar al menos un Administrador.", "There must be at least one Administrator.");
  await db.$transaction([db.membership.delete({ where: { id: m.id } }), db.user.update({ where: { id: m.userId }, data: { sessionVersion: { increment: 1 } } })]);
  return m.userId;
}

// ---------- Contraseña nueva ----------

const resetLink = (token: string) => `${appBase()}/clave/${token}`;

async function newReset(userId: string): Promise<string> {
  const { token, hash } = newLinkToken();
  await db.passwordReset.create({ data: { userId, tokenHash: hash, expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) } });
  return token;
}

/**
 * «¿Olvidaste tu contraseña?»: si ese correo puede entrar (es miembro o dueño), le manda un enlace. No dice si existe.
 */
export async function requestPasswordReset(rawEmail: string, lang: UiLang): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!looksLikeEmail(email)) return;
  const user = await db.user.findUnique({ where: { email }, select: { id: true, _count: { select: { memberships: true } } } });
  if (!user || (!user._count.memberships && !isOwnerEmail(email))) return;
  const token = await newReset(user.id);
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
  return resetLink(await newReset(m.userId));
}

/** El correo del enlace de contraseña nueva, o null si no sirve. */
export async function readReset(token: string): Promise<{ email: string } | null> {
  if (!looksLikeToken(token)) return null;
  const r = await db.passwordReset.findUnique({ where: { tokenHash: tokenHash(token) }, select: { usedAt: true, expiresAt: true, user: { select: { email: true } } } });
  return r && !r.usedAt && r.expiresAt > new Date() ? { email: r.user.email } : null;
}

/** Guarda la contraseña nueva (el enlace queda usado) y cierra las demás sesiones. Devuelve la persona para entrar. */
export async function completeReset(token: string, password: string): Promise<{ id: string; sessionVersion: number } | null> {
  if (!looksLikeToken(token)) return null;
  const passwordHash = await hashPassword(password);
  return db.$transaction(async (tx) => {
    const r = await tx.passwordReset.findUnique({ where: { tokenHash: tokenHash(token) }, select: { id: true, userId: true } });
    if (!r) return null;
    const used = await tx.passwordReset.updateMany({ where: { id: r.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (used.count !== 1) return null;
    const user = await tx.user.update({ where: { id: r.userId }, data: { passwordHash, sessionVersion: { increment: 1 }, lastLoginAt: new Date() }, select: { id: true, sessionVersion: true } });
    return user;
  });
}
