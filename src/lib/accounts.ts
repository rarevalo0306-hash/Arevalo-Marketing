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

/**
 * Busca o crea a la persona y la deja lista para entrar. Devuelve null si no puede entrar.
 * Un dueño sin organización queda como Administrador de la organización principal (la más antigua: la que creó el SQL
 * con los negocios de Ricardo); si no hay ninguna, se le crea una organización personal. Alguien que no es dueño
 * entra solo si ya es miembro de alguna organización.
 */
export async function loginUser(rawEmail: string, opts: { owner: boolean; name?: string }): Promise<{ id: string; sessionVersion: number } | null> {
  const email = normalizeEmail(rawEmail);
  if (!looksLikeEmail(email)) return null;
  const name = (opts.name ?? "").trim().slice(0, 120);
  return db.$transaction(async (tx) => {
    const select = { id: true, name: true, sessionVersion: true, _count: { select: { memberships: true } } } as const;
    let user = await tx.user.findUnique({ where: { email }, select });
    if (!opts.owner && !user?._count.memberships) return null;
    user ??= await tx.user.create({ data: { email, name }, select });
    if (user._count.memberships === 0) {
      const organizationId = (await mainOrganizationId(tx)) ?? (await tx.organization.create({ data: { name: name || email, kind: "personal" }, select: { id: true } })).id;
      await tx.membership.create({ data: { userId: user.id, organizationId, role: "admin" } });
    }
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), ...(name && !user.name && { name }) } });
    return { id: user.id, sessionVersion: user.sessionVersion };
  });
}

/**
 * ¿Correo y contraseña son correctos? Con contraseña propia se revisa esa. Sin contraseña propia, solo un dueño puede
 * entrar con APP_PASSWORD. Siempre hace el mismo trabajo (scrypt) para no delatar qué correos tienen cuenta.
 * Una contraseña elegida con un enlace que vio un Administrador (passwordOrgId) solo sirve mientras la persona esté
 * solo en esa organización: así ese Administrador nunca entra a otra organización con ella.
 */
export async function checkPassword(rawEmail: string, password: string): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  const user = looksLikeEmail(email)
    ? await db.user.findUnique({ where: { email }, select: { passwordHash: true, passwordOrgId: true, memberships: { select: { organizationId: true } } } })
    : null;
  const own = await verifyPassword(password, user?.passwordHash ?? "");
  if (user?.passwordHash) return own && (!user.passwordOrgId || user.memberships.every((m) => m.organizationId === user.passwordOrgId));
  const appPassword = process.env.APP_PASSWORD?.trim() ?? "";
  return Boolean(appPassword) && isOwnerEmail(email) && safeEqual(password, appPassword);
}
