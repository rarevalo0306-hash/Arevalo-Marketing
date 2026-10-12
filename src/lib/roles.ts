// Los papeles de una persona en una organización y qué puede hacer cada uno (sin base, para poder probarlo).
// Administrador: todo, también conexiones, quitar empresas, equipo y pagos. Puede publicar: crea, publica y gasta
// (hasta el límite que pone el Administrador). Solo ver: mira resultados y reportes.

export const ROLES = ["admin", "publisher", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** Lo que pide una acción: ver, crear/publicar/gastar, o administrar (conexiones, borrar, ajustes de dinero y autonomía). */
export type Need = "view" | "publish" | "admin";

const RANK: Record<Role, number> = { viewer: 0, publisher: 1, admin: 2 };
const NEEDS: Record<Need, number> = { view: 0, publish: 1, admin: 2 };

export const asRole = (value: string): Role | null => ((ROLES as readonly string[]).includes(value) ? (value as Role) : null);

/** ¿Ese papel alcanza para lo que se pide? Un papel desconocido no alcanza para nada. */
export function roleAllows(role: string, need: Need): boolean {
  const r = asRole(role);
  return r !== null && RANK[r] >= NEEDS[need];
}

export function roleLabel(role: Role, t: (es: string, en: string) => string): string {
  return role === "admin" ? t("Administrador", "Administrator") : role === "publisher" ? t("Puede publicar", "Can publish") : t("Solo ver", "View only");
}
