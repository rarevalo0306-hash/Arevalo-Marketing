// Los papeles de una persona en una organización y qué puede hacer cada uno (sin base, para poder probarlo).
// Administrador: todo, también conexiones, quitar empresas, equipo y pagos. Puede conectar: lo de «Puede publicar» y
// además conecta las cuentas de Google (Perfil de Negocio, Search Console, Analytics y YouTube) de sus empresas.
// Puede publicar: crea, publica y gasta (hasta el límite que pone el Administrador). Solo ver: mira resultados y reportes.
// Lo de la organización (equipo, agregar o borrar empresas, el centro de Matya) es solo del Administrador.

export const ROLES = ["admin", "manager", "publisher", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Lo que pide una acción: ver, crear/publicar/gastar, conectar las cuentas de Google, o administrar (las demás
 * conexiones, borrar, ajustes de dinero y autonomía).
 */
export type Need = "view" | "publish" | "connect" | "admin";

const RANK: Record<Role, number> = { viewer: 0, publisher: 1, manager: 2, admin: 3 };
const NEEDS: Record<Need, number> = { view: 0, publish: 1, connect: 2, admin: 3 };

export const asRole = (value: string): Role | null => ((ROLES as readonly string[]).includes(value) ? (value as Role) : null);

/** ¿Ese papel alcanza para lo que se pide? Un papel desconocido no alcanza para nada. */
export function roleAllows(role: string, need: Need): boolean {
  const r = asRole(role);
  return r !== null && RANK[r] >= NEEDS[need];
}

export function roleLabel(role: Role, t: (es: string, en: string) => string): string {
  return role === "admin"
    ? t("Administrador", "Administrator")
    : role === "manager"
      ? t("Puede conectar", "Can connect")
      : role === "publisher"
        ? t("Puede publicar", "Can publish")
        : t("Solo ver", "View only");
}

/** Para quien no puede conectar una cuenta: quién sí puede (las de Google, también «Puede conectar»). */
export function whoConnects(google: boolean, t: (es: string, en: string) => string): string {
  return google
    ? t("Esta cuenta solo la conecta el Administrador o alguien con el papel «Puede conectar».", 'Only the Administrator or someone with the "Can connect" role can connect this account.')
    : t("Solo el Administrador puede conectar esta cuenta.", "Only the Administrator can connect this account.");
}
