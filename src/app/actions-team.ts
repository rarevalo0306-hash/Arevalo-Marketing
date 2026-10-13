"use server";

// «Equipo y permisos»: invitar, cambiar el papel o las empresas, quitar acceso y mandar un enlace para una contraseña
// nueva. Todo lo hace solo el Administrador de esa organización (requireOrgAdmin). La lógica está en src/lib/team.ts.
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireOrgAdmin, requireUser } from "@/lib/auth";
import { ensure } from "@/lib/ensure";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { looksLikeToken } from "@/lib/password";
import { readSession, SESSION_COOKIE } from "@/lib/session";
import { acceptInvitation, adminResetLink, cancelInvite, changeMember, invite, removeMember, resendInvite } from "@/lib/team";

export type TeamResult = { ok: boolean; message: string; link?: string } | null;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const accessFrom = (f: FormData) => ({ role: str(f, "role"), allBusinesses: str(f, "scope") !== "some", businessIds: f.getAll("businessIds").map(String) });

/** Invita a alguien: crea la invitación, manda el correo y devuelve el enlace para copiarlo. */
export async function inviteMemberAction(organizationId: string, _prev: TeamResult, f: FormData): Promise<TeamResult> {
  ensure.text(organizationId);
  const user = await requireOrgAdmin(organizationId);
  const { lang, t } = await getT();
  try {
    const r = await invite(organizationId, user, { email: str(f, "email"), ...accessFrom(f) }, lang);
    revalidatePath("/equipo");
    return {
      ok: true,
      link: r.link,
      message: r.emailed
        ? t(`Listo: le mandamos la invitación a ${r.email}. También puedes copiar el enlace.`, `Done: we sent the invitation to ${r.email}. You can also copy the link.`)
        : t(`La invitación está lista, pero el correo no salió. Copia el enlace y mándaselo a ${r.email}.`, `The invitation is ready, but the email didn't go out. Copy the link and send it to ${r.email}.`),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

export async function resendInviteAction(organizationId: string, invitationId: string): Promise<TeamResult> {
  ensure.text(organizationId, invitationId);
  const user = await requireOrgAdmin(organizationId);
  const { lang, t } = await getT();
  try {
    const r = await resendInvite(organizationId, invitationId, user, lang);
    revalidatePath("/equipo");
    return { ok: true, link: r.link, message: r.emailed ? t("La volvimos a mandar con un enlace nuevo.", "We sent it again with a new link.") : t("Enlace nuevo listo, pero el correo no salió: cópialo y mándalo.", "New link ready, but the email didn't go out: copy it and send it.") };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

export async function cancelInviteAction(organizationId: string, invitationId: string): Promise<TeamResult> {
  ensure.text(organizationId, invitationId);
  await requireOrgAdmin(organizationId);
  const { t } = await getT();
  await cancelInvite(organizationId, invitationId);
  revalidatePath("/equipo");
  return { ok: true, message: t("Invitación cancelada: el enlace ya no sirve.", "Invitation canceled: the link no longer works.") };
}

/** Cambia el papel o las empresas de un miembro. */
export async function changeMemberAction(organizationId: string, membershipId: string, _prev: TeamResult, f: FormData): Promise<TeamResult> {
  ensure.text(organizationId, membershipId);
  await requireOrgAdmin(organizationId);
  const { lang, t } = await getT();
  try {
    await changeMember(organizationId, membershipId, accessFrom(f));
    revalidatePath("/equipo");
    return { ok: true, message: t("Guardado.", "Saved.") };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** Quita el acceso: deja la organización y se cierran sus sesiones. */
export async function removeMemberAction(organizationId: string, membershipId: string): Promise<TeamResult> {
  ensure.text(organizationId, membershipId);
  const user = await requireOrgAdmin(organizationId);
  const { lang, t } = await getT();
  let removed: string | null = null;
  try {
    removed = await removeMember(organizationId, membershipId);
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
  revalidatePath("/equipo");
  // Si se quitó a sí mismo, su sesión ya se cerró.
  if (removed === user.id) redirect("/login");
  return { ok: true, message: t("Listo: ya no tiene acceso.", "Done: they no longer have access.") };
}

/** Enlace para que un miembro elija contraseña nueva (para mandárselo por WhatsApp si el correo no le llega). */
export async function resetLinkAction(organizationId: string, membershipId: string): Promise<TeamResult> {
  ensure.text(organizationId, membershipId);
  await requireOrgAdmin(organizationId);
  const { lang, t } = await getT();
  try {
    const link = await adminResetLink(organizationId, membershipId);
    return { ok: true, link, message: t("Enlace listo (vence en 1 hora). Cópialo y mándaselo.", "Link ready (expires in 1 hour). Copy it and send it.") };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** Sale de la cuenta actual y vuelve a la misma invitación (entró con otra cuenta). */
export async function signOutForInvitation(token: string): Promise<void> {
  ensure.text(token);
  await requireUser();
  (await cookies()).delete(SESSION_COOKIE);
  redirect(looksLikeToken(token) ? `/invitacion/${token}` : "/login");
}

/** Acepta una invitación estando ya dentro: solo si el correo de la sesión es el invitado. */
export async function acceptInvitationAction(token: string): Promise<TeamResult> {
  ensure.text(token);
  const user = await requireUser();
  const { lang, t } = await getT();
  const jar = await cookies();
  const before = await readSession(jar.get(SESSION_COOKIE)?.value);
  let done: Awaited<ReturnType<typeof acceptInvitation>> = null;
  try {
    done = await acceptInvitation(token, user.email);
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
  if (!done) return { ok: false, message: t("Esta invitación no es para tu correo, o ya no sirve.", "This invitation isn't for your email, or it no longer works.") };
  // Si al aceptar se cerraron sus sesiones (su contraseña venía de un enlace que vio el Administrador de otra
  // organización), esta también: quien tenía esa contraseña podría ser ese Administrador. Vuelve a entrar con Google o
  // eligiendo una contraseña nueva con «¿Olvidaste tu contraseña?».
  if (!before || done.sessionVersion !== before.version) {
    jar.delete(SESSION_COOKIE);
    redirect("/login?aceptada=1");
  }
  redirect("/");
}
