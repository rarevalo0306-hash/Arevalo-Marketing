// Quién puede entrar y con qué persona queda la sesión. Lo usan la contraseña (/api/auth/login) y Google
// (/api/auth/google/callback). Por ahora solo entran los dueños de Matya: los correos de LOGIN_EMAILS, con APP_PASSWORD o
// con Google. Las invitaciones a otras personas llegan en la etapa 2. Para sacar a alguien: quita su correo de
// LOGIN_EMAILS y cambia APP_PASSWORD (saca a todos) o sube su User.sessionVersion (solo a esa persona).
import { db } from "@/lib/db";
import { loginEmails } from "@/lib/google-login";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const looksLikeEmail = (email: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email);

/** ¿Es un dueño de Matya (LOGIN_EMAILS)? */
export const isOwnerEmail = (email: string, raw = process.env.LOGIN_EMAILS) => loginEmails(raw).includes(normalizeEmail(email));

/**
 * Busca o crea a la persona y la deja lista para entrar. Devuelve null si no puede entrar (no es dueño).
 * Un dueño sin organización queda como Administrador de la organización principal (la más antigua: la que creó el SQL
 * con los negocios de Ricardo); si no hay ninguna, se le crea una organización personal.
 */
export async function loginUser(rawEmail: string, opts: { owner: boolean; name?: string }): Promise<{ id: string; sessionVersion: number } | null> {
  const email = normalizeEmail(rawEmail);
  if (!opts.owner || !looksLikeEmail(email)) return null;
  const name = (opts.name ?? "").trim().slice(0, 120);
  return db.$transaction(async (tx) => {
    const select = { id: true, name: true, sessionVersion: true, _count: { select: { memberships: true } } } as const;
    const user = (await tx.user.findUnique({ where: { email }, select })) ?? (await tx.user.create({ data: { email, name }, select }));
    if (user._count.memberships === 0) {
      const main = await tx.organization.findFirst({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
      const organizationId = main?.id ?? (await tx.organization.create({ data: { name: name || email, kind: "personal" }, select: { id: true } })).id;
      await tx.membership.create({ data: { userId: user.id, organizationId, role: "admin" } });
    }
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), ...(name && !user.name && { name }) } });
    return { id: user.id, sessionVersion: user.sessionVersion };
  });
}
