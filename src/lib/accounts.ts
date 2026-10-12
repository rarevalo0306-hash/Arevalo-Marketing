// Quién puede entrar y con qué persona queda la sesión. Lo usan la contraseña (/api/auth/login) y Google
// (/api/auth/google/callback). Los dueños de Matya son los correos de LOGIN_EMAILS: entran con APP_PASSWORD o con
// Google. Cualquier otra persona entra solo con Google y solo si ya es miembro de alguna organización.
import { db } from "@/lib/db";
import { loginEmails } from "@/lib/google-login";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const looksLikeEmail = (email: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email);

/** ¿Es un dueño de Matya (LOGIN_EMAILS)? */
export const isOwnerEmail = (email: string, raw = process.env.LOGIN_EMAILS) => loginEmails(raw).includes(normalizeEmail(email));

/**
 * Busca o crea a la persona y la deja lista para entrar. Devuelve null si no puede entrar.
 * Un dueño sin organización toma la más antigua que aún no tiene Administrador (la que creó el SQL con los negocios
 * de Ricardo); si no hay ninguna, se le crea una organización personal vacía.
 */
export async function loginUser(rawEmail: string, opts: { owner: boolean; name?: string }): Promise<{ id: string; sessionVersion: number } | null> {
  const email = normalizeEmail(rawEmail);
  if (!looksLikeEmail(email)) return null;
  const name = (opts.name ?? "").trim().slice(0, 120);
  return db.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { email }, select: { id: true, name: true, sessionVersion: true, _count: { select: { memberships: true } } } });
    if (!user && !opts.owner) return null;
    if (!user) user = await tx.user.create({ data: { email, name }, select: { id: true, name: true, sessionVersion: true, _count: { select: { memberships: true } } } });
    if (user._count.memberships === 0) {
      if (!opts.owner) return null;
      const free = await tx.organization.findFirst({ where: { members: { none: { role: "admin" } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
      const organizationId = free?.id ?? (await tx.organization.create({ data: { name: name || email, kind: "personal" }, select: { id: true } })).id;
      await tx.membership.create({ data: { userId: user.id, organizationId, role: "admin" } });
    }
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), ...(name && !user.name && { name }) } });
    return { id: user.id, sessionVersion: user.sessionVersion };
  });
}
