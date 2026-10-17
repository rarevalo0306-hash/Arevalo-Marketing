// Organizaciones de cliente: las reglas que no tocan la base de datos (nombre válido, agrupar negocios por organización).
// Cada cuenta (Organization) agrupa sus negocios en organizaciones de cliente (ClientOrg). Lo que sí lee y escribe la base
// está en client-orgs-store.ts.

/** El nombre de la organización que se crea sola. Es dato guardado: igual en español y en inglés. */
export const DEFAULT_CLIENT_ORG = "Mis compañías";

/** Largo máximo del nombre de una organización. */
export const ORG_NAME_MAX = 120;

/**
 * El nombre sin espacios al inicio ni al final, o null si queda vacío o pasa de 120 caracteres.
 * Se guarda tal como se escribió (incluso con <b>…</b>): React lo escapa al mostrarlo.
 */
export function readOrgName(text: string): string | null {
  const name = text.trim();
  return name.length >= 1 && name.length <= ORG_NAME_MAX ? name : null;
}

/**
 * Agrupa los negocios por su organización, en el orden en que aparece cada una y respetando el orden de los negocios
 * dentro de cada grupo. Nunca devuelve un grupo vacío: una organización sin negocios en la lista no aparece.
 */
export function groupByClientOrg<B extends { clientOrg: { id: string; name: string } }>(
  businesses: B[],
): { id: string; name: string; businesses: B[] }[] {
  const groups = new Map<string, { id: string; name: string; businesses: B[] }>();
  for (const business of businesses) {
    const { id, name } = business.clientOrg;
    const group = groups.get(id);
    if (group) group.businesses.push(business);
    else groups.set(id, { id, name, businesses: [business] });
  }
  return [...groups.values()];
}

/**
 * El árbol del selector de negocios: cada cuenta de la persona (en su orden) con sus organizaciones y los negocios de cada una.
 * Una cuenta sin negocios a la vista sale igual, con su nombre y sin grupos; un negocio de una cuenta que no está en la lista no sale.
 */
export function groupByAccount<B extends { organizationId: string; clientOrg: { id: string; name: string } }>(
  accounts: { id: string; name: string }[],
  businesses: B[],
): { id: string; name: string; groups: { id: string; name: string; businesses: B[] }[] }[] {
  return accounts.map(({ id, name }) => ({ id, name, groups: groupByClientOrg(businesses.filter((b) => b.organizationId === id)) }));
}
