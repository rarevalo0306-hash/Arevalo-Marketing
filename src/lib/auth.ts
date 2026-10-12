// Quién entró y a qué negocios puede entrar. Toda página, acción del servidor y ruta que use un negocio empieza aquí:
//   páginas:            await pageBusiness(id)                  (sin sesión → /login, sin acceso → 404)
//   acciones y rutas:   await requireBusiness(id, "publish")    (sin acceso → error «Negocio no encontrado»)
//   si debe responder:  if (!(await hasBusiness(id))) return …
// Un negocio es de una organización; la persona entra si es miembro de esa organización y su papel alcanza
// (src/lib/roles.ts). Si llega el id de algo de un negocio (post, campaña…), primero se busca su businessId y se revisa ese.
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { asRole, roleAllows, type Need, type Role } from "@/lib/roles";
import { readSession, SESSION_COOKIE } from "@/lib/session";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  memberships: { organizationId: string; role: Role; organization: { id: string; name: string; kind: string } }[];
};

/** La persona de esta visita, o null si no hay sesión válida (cookie firmada, persona que existe y versión vigente). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  let cookie: string | undefined;
  try {
    cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    return null; // Fuera de una visita (el publicador automático) no hay persona.
  }
  const session = await readSession(cookie);
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      sessionVersion: true,
      memberships: { orderBy: { createdAt: "asc" }, select: { organizationId: true, role: true, organization: { select: { id: true, name: true, kind: true } } } },
    },
  });
  if (!user || user.sessionVersion !== session.version) return null;
  const memberships = user.memberships.flatMap((m) => {
    const role = asRole(m.role);
    return role ? [{ organizationId: m.organizationId, role, organization: m.organization }] : [];
  });
  return { id: user.id, email: user.email, name: user.name, memberships };
});

/** La persona de esta visita; sin sesión válida, a /login (en páginas, acciones y rutas). */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

const ID = /^[A-Za-z0-9_-]{1,100}$/;

/** El papel de la persona en la organización dueña del negocio, o null si no entra (o el negocio no existe). */
async function roleIn(user: SessionUser, businessId: string): Promise<Role | null> {
  if (typeof businessId !== "string" || !ID.test(businessId)) return null;
  const business = await db.business.findUnique({ where: { id: businessId }, select: { organizationId: true } });
  if (!business) return null;
  return user.memberships.find((m) => m.organizationId === business.organizationId)?.role ?? null;
}

export type Access = { ok: true; user: SessionUser; role: Role } | { ok: false; status: 401 | 403 | 404 };

/** Sin lanzar nada: si la persona puede usar ese negocio para lo que pide. 401 sin sesión, 404 sin acceso, 403 papel corto. */
export async function businessAccess(businessId: string, need: Need = "view"): Promise<Access> {
  const user = await getSessionUser();
  if (!user) return { ok: false, status: 401 };
  const role = await roleIn(user, businessId);
  if (!role) return { ok: false, status: 404 };
  if (!roleAllows(role, need)) return { ok: false, status: 403 };
  return { ok: true, user, role };
}

/** Error de permiso con el código que debe devolver una ruta. El mensaje ya va traducido. */
export class AccessError extends Error {
  constructor(
    message: string,
    public status: 403 | 404,
  ) {
    super(message);
  }
}

async function denied(status: 403 | 404): Promise<AccessError> {
  const { t } = await getT();
  return status === 404
    ? new AccessError(t("Negocio no encontrado", "Business not found"), 404)
    : new AccessError(t("Tu papel en esta empresa no permite hacer esto.", "Your role in this business doesn't allow this."), 403);
}

/** Para acciones y rutas. Sin sesión, a /login; sin acceso o con un papel corto, lanza AccessError. */
export async function requireBusiness(businessId: string, need: Need = "view"): Promise<{ user: SessionUser; role: Role }> {
  const access = await businessAccess(businessId, need);
  if (access.ok) return { user: access.user, role: access.role };
  if (access.status === 401) redirect("/login");
  throw await denied(access.status);
}

/** Para acciones que devuelven { ok, message } en vez de lanzar: true si la persona puede. */
export async function hasBusiness(businessId: string, need: Need = "view"): Promise<boolean> {
  return (await businessAccess(businessId, need)).ok;
}

/** Para páginas: sin sesión, a /login; sin acceso, la página de «no encontrado» (no se dice si el negocio existe). */
export async function pageBusiness(businessId: string, need: Need = "view"): Promise<{ user: SessionUser; role: Role }> {
  const access = await businessAccess(businessId, need);
  if (access.ok) return { user: access.user, role: access.role };
  if (access.status === 401) redirect("/login");
  notFound();
}

/** Filtro de los negocios que ve esta persona: los de sus organizaciones. */
export async function myBusinessesWhere(): Promise<Prisma.BusinessWhereInput> {
  const user = await requireUser();
  return { organizationId: { in: user.memberships.map((m) => m.organizationId) } };
}

/** Dónde se crea un negocio nuevo: la primera organización donde la persona es Administrador. */
export async function newBusinessOrganizationId(): Promise<string> {
  const user = await requireUser();
  const org = user.memberships.find((m) => roleAllows(m.role, "admin"));
  if (org) return org.organizationId;
  const { t } = await getT();
  throw new AccessError(t("Solo un Administrador puede agregar empresas.", "Only an Administrator can add businesses."), 403);
}
