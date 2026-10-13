// Quién puede entrar y con qué persona queda la sesión. Lo usan la contraseña (/api/auth/login), Google
// (/api/auth/google/callback) y las invitaciones (src/lib/team.ts).
// - Los dueños de Matya son los correos de LOGIN_EMAILS: entran con APP_PASSWORD (si no tienen contraseña propia) o con
//   Google, y quedan como Administradores de la organización principal.
// - Las demás personas entran si son miembros de alguna organización (las invitó un Administrador): con su contraseña
//   propia o con Google.
// Para sacar a alguien: «Quitar acceso» en Equipo (borra su papel y cierra sus sesiones). A un dueño, además, quita su
// correo de LOGIN_EMAILS.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { loginEmails } from "@/lib/google-login";
import { verifyPassword } from "@/lib/password";
import { safeEqual } from "@/lib/session";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const looksLikeEmail = (email: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email);

/** ¿Es un dueño de Matya (LOGIN_EMAILS)? */
export const isOwnerEmail = (email: string, raw = process.env.LOGIN_EMAILS) => loginEmails(raw).includes(normalizeEmail(email));

/** La organización principal: la más antigua (la que creó el SQL con los negocios de Ricardo). Los dueños son sus Administradores. */
export async function mainOrganizationId(client: Pick<Prisma.TransactionClient, "organization"> = db): Promise<string | null> {
  const main = await client.organization.findFirst({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
  return main?.id ?? null;
}

/** Deja a un dueño como Administrador (con todas las empresas) de la organización principal; si no hay ninguna, crea una personal. */
export async function makeOwnerAdmin(tx: Prisma.TransactionClient, userId: string, label: string): Promise<void> {
  const organizationId = (await mainOrganizationId(tx)) ?? (await tx.organization.create({ data: { name: label, kind: "personal" }, select: { id: true } })).id;
  const m = await tx.membership.upsert({
    where: { userId_organizationId: { userId, organizationId } },
    create: { userId, organizationId, role: "admin", allBusinesses: true },
    update: { role: "admin", allBusinesses: true },
    select: { id: true },
  });
  await tx.membershipBusiness.deleteMany({ where: { membershipId: m.id } });
}

/**
 * Busca o crea a la persona y la deja lista para entrar. Devuelve null si no puede entrar.
 * Un dueño siempre queda como Administrador (con todas las empresas) de la organización principal (la más antigua: la
 * que creó el SQL con los negocios de Ricardo); si no hay ninguna, se le crea una organización personal. Si su
 * contraseña salió de un enlace que vio un Administrador, se borra y se cierran sus otras sesiones. Alguien que no es
 * dueño entra solo si ya es miembro de alguna organización.
 * `expectedVersion`: la sessionVersion que vio la revisión de la contraseña (null = la cuenta aún no existía). Si cambió
 * mientras tanto (se cambió o se borró la contraseña, o la sacaron), no entra: la sesión nunca lleva una versión nueva
 * con una contraseña vieja.
 */
export async function loginUser(rawEmail: string, opts: { owner: boolean; name?: string; expectedVersion?: number | null }): Promise<{ id: string; sessionVersion: number } | null> {
  const email = normalizeEmail(rawEmail);
  if (!looksLikeEmail(email)) return null;
  const name = (opts.name ?? "").trim().slice(0, 120);
  return db.$transaction(async (tx) => {
    // Una sola cosa a la vez con esta cuenta (una invitación, un enlace de contraseña): ver y decidir van juntos.
    await tx.$queryRaw`SELECT id FROM "User" WHERE email = ${email} FOR UPDATE`;
    const select = { id: true, name: true, sessionVersion: true, passwordOrgId: true, _count: { select: { memberships: true } } } as const;
    let user = await tx.user.findUnique({ where: { email }, select });
    if (opts.expectedVersion !== undefined && (user?.sessionVersion ?? null) !== opts.expectedVersion) return null;
    if (!opts.owner && !user?._count.memberships) return null;
    user ??= await tx.user.create({ data: { email, name }, select });
    if (opts.owner) {
      await makeOwnerAdmin(tx, user.id, name || email);
      if (user.passwordOrgId) user = await tx.user.update({ where: { id: user.id }, data: { passwordHash: "", passwordOrgId: "", sessionVersion: { increment: 1 } }, select });
    }
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), ...(name && !user.name && { name }) } });
    return { id: user.id, sessionVersion: user.sessionVersion };
  });
}

/**
 * ¿Correo y contraseña son correctos? Con contraseña propia se revisa esa. Sin contraseña propia, solo un dueño puede
 * entrar con APP_PASSWORD. Siempre hace el mismo trabajo (scrypt) para no delatar qué correos tienen cuenta.
 * Una contraseña elegida con un enlace que vio un Administrador (passwordOrgId) solo sirve mientras la persona esté
 * solo en esa organización y no sea dueño: así ese Administrador nunca entra a otra organización ni a la cuenta de un
 * dueño con ella. Devuelve la sessionVersion que vio (para loginUser; null si la cuenta aún no existe) o false.
 */
export async function verifyLogin(rawEmail: string, password: string): Promise<{ sessionVersion: number | null } | false> {
  const email = normalizeEmail(rawEmail);
  const user = looksLikeEmail(email)
    ? await db.user.findUnique({ where: { email }, select: { sessionVersion: true, passwordHash: true, passwordOrgId: true, memberships: { select: { organizationId: true } } } })
    : null;
  const own = await verifyPassword(password, user?.passwordHash ?? "");
  const seen = { sessionVersion: user?.sessionVersion ?? null };
  const owner = isOwnerEmail(email);
  // La contraseña atada de un dueño nunca cuenta: es como si no tuviera (entra con APP_PASSWORD o Google, y al entrar se borra).
  if (user?.passwordHash && !(user.passwordOrgId && owner)) {
    const tied = user.passwordOrgId;
    const trusted = !tied || (user.memberships.length > 0 && user.memberships.every((m) => m.organizationId === tied));
    return own && trusted ? seen : false;
  }
  const appPassword = process.env.APP_PASSWORD?.trim() ?? "";
  return Boolean(appPassword) && owner && safeEqual(password, appPassword) ? seen : false;
}

/** ¿Correo y contraseña son correctos? (verifyLogin sin la versión.) */
export const checkPassword = async (rawEmail: string, password: string) => (await verifyLogin(rawEmail, password)) !== false;
