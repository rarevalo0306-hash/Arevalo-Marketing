// Organizaciones de cliente (ClientOrg) en la base de datos. Cada cuenta (Organization) agrupa sus negocios en
// organizaciones de cliente. Todas las funciones reciben primero el id de la cuenta y solo tocan lo de esa cuenta:
// un id de otra cuenta (por ejemplo, forjado en un formulario) se rechaza igual que uno que no existe.
// Quién puede llamarlas (el Administrador de la cuenta) lo decide quien las llama, no este archivo.
import { db } from "@/lib/db";
import { readReportSettings, type ReportSettings } from "@/lib/client-org-report";
import { DEFAULT_CLIENT_ORG, readOrgName } from "@/lib/client-orgs";
import { bi } from "@/lib/i18n";

const badName = () => bi("Escribe un nombre de 1 a 120 caracteres.", "Enter a name of 1 to 120 characters.");
export const notInAccount = () => bi("Esa organización no es de esta cuenta.", "That organization isn't in this account.");
const stillHasBusinesses = () =>
  bi("Esta organización todavía tiene negocios: muévelos antes de borrarla.", "This organization still has businesses: move them before deleting it.");

const nameTaken = () => bi("Ya hay una organización con ese nombre en esta cuenta.", "This account already has an organization with that name.");

/** La base de datos rechazó por una llave foránea (Prisma P2003). */
const isForeignKeyRefusal = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2003";

/**
 * El id de la organización más antigua de la cuenta; si la cuenta no tiene ninguna, crea «Mis compañías».
 * Dentro de una transacción que primero toma un candado por cuenta, así dos negocios nuevos al mismo tiempo en una
 * cuenta sin organizaciones crean una sola.
 */
export async function ensureDefaultClientOrg(organizationId: string): Promise<string> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('client-org:' || ${organizationId}::text))`;
    const oldest = await tx.clientOrg.findFirst({ where: { organizationId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
    if (oldest) return oldest.id;
    const made = await tx.clientOrg.create({ data: { organizationId, name: DEFAULT_CLIENT_ORG }, select: { id: true } });
    return made.id;
  });
}

/** El último movimiento del reporte semanal de una organización: cuándo, cómo se disparó, cómo quedó y a quién iba. */
export type LastSend = { at: string; trigger: string; state: string; to: string[]; error: string };

export type ClientOrgListItem = {
  id: string;
  name: string;
  businesses: { id: string; name: string; color: string }[];
  /** Los ajustes del reporte semanal. */
  report: ReportSettings;
  /** El envío más reciente (por fecha de creación; `at` es cuando cambió por última vez, o sea cuando salió o falló), o null si nunca se intentó. */
  last: LastSend | null;
};

/** Las organizaciones de la cuenta con sus negocios, sus ajustes de reporte y su último envío, en el orden en que se crearon; las organizaciones vacías también salen. */
export async function listClientOrgs(organizationId: string): Promise<ClientOrgListItem[]> {
  const rows = await db.clientOrg.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      contactName: true,
      reportEmail: true,
      phone: true,
      reportLang: true,
      reportOn: true,
      reportDay: true,
      reportHour: true,
      timezone: true,
      businesses: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, color: true } },
      reports: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { updatedAt: true, trigger: true, state: true, to: true, error: true } },
    },
  });
  return rows.map((o) => {
    const last = o.reports[0];
    return {
      id: o.id,
      name: o.name,
      businesses: o.businesses,
      report: {
        contactName: o.contactName,
        reportEmail: o.reportEmail,
        phone: o.phone,
        reportLang: o.reportLang === "en" ? "en" : "es",
        reportOn: o.reportOn,
        reportDay: o.reportDay,
        reportHour: o.reportHour,
        timezone: o.timezone,
      },
      last: last ? { at: last.updatedAt.toISOString(), trigger: last.trigger, state: last.state, to: last.to, error: last.error } : null,
    };
  });
}

/**
 * Guarda los ajustes del reporte semanal de una organización de la cuenta (contacto, emails, idioma, día, hora y zona).
 * Primero se validan (un campo que no sirve lanza un BiError que lo nombra) y después se escribe solo si la organización
 * es de la cuenta: con el id de otra cuenta no cambia nada.
 */
export async function saveClientOrgReport(organizationId: string, clientOrgId: string, raw: Record<string, string>): Promise<void> {
  const settings = readReportSettings(raw);
  const { count } = await db.clientOrg.updateMany({ where: { id: clientOrgId, organizationId }, data: settings });
  if (count === 0) throw notInAccount();
}

/** ¿Otra organización de la cuenta ya se llama así? Sin distinguir mayúsculas; `exceptId` deja fuera a la que se renombra. */
async function nameInUse(organizationId: string, name: string, exceptId?: string): Promise<boolean> {
  const same = await db.clientOrg.findFirst({
    where: { organizationId, name: { equals: name, mode: "insensitive" }, ...(exceptId === undefined ? {} : { id: { not: exceptId } }) },
    select: { id: true },
  });
  return same !== null;
}

/**
 * Crea una organización en la cuenta y devuelve su id. El nombre se recorta, debe tener de 1 a 120 caracteres y no puede
 * ser el de otra organización de la cuenta (sin distinguir mayúsculas).
 */
export async function createClientOrg(organizationId: string, name: string): Promise<string> {
  const clean = readOrgName(name);
  if (clean === null) throw badName();
  if (await nameInUse(organizationId, clean)) throw nameTaken();
  const made = await db.clientOrg.create({ data: { organizationId, name: clean }, select: { id: true } });
  return made.id;
}

/** Cambia el nombre de una organización de la cuenta (mismas reglas de nombre que al crearla; el suyo, con otras mayúsculas, sí vale). */
export async function renameClientOrg(organizationId: string, clientOrgId: string, name: string): Promise<void> {
  const clean = readOrgName(name);
  if (clean === null) throw badName();
  if (await nameInUse(organizationId, clean, clientOrgId)) throw nameTaken();
  const { count } = await db.clientOrg.updateMany({ where: { id: clientOrgId, organizationId }, data: { name: clean } });
  if (count === 0) throw notInAccount();
}

/**
 * Borra una organización vacía de la cuenta. Con negocios dentro no se borra: primero se revisa, y si un negocio llega
 * justo después, la base de datos lo rechaza (P2003) y se avisa con el mismo texto.
 */
export async function deleteClientOrg(organizationId: string, clientOrgId: string): Promise<void> {
  if ((await db.business.count({ where: { clientOrgId, organizationId } })) > 0) throw stillHasBusinesses();
  let count: number;
  try {
    ({ count } = await db.clientOrg.deleteMany({ where: { id: clientOrgId, organizationId } }));
  } catch (e) {
    if (isForeignKeyRefusal(e)) throw stillHasBusinesses();
    throw e;
  }
  if (count === 0) throw notInAccount();
}

/** Pasa un negocio de la cuenta a otra organización de la cuenta. Solo cambia `clientOrgId`. */
export async function moveBusiness(organizationId: string, businessId: string, clientOrgId: string): Promise<void> {
  const target = await db.clientOrg.findFirst({ where: { id: clientOrgId, organizationId }, select: { id: true } });
  if (!target) throw notInAccount();
  let count: number;
  try {
    ({ count } = await db.business.updateMany({ where: { id: businessId, organizationId }, data: { clientOrgId } }));
  } catch (e) {
    // La organización de destino se borró entre la revisión y el cambio: la llave foránea compuesta lo rechaza.
    if (isForeignKeyRefusal(e)) throw notInAccount();
    throw e;
  }
  if (count === 0) throw notInAccount();
}

/**
 * La organización donde va un negocio nuevo: la pedida, si es de la cuenta; la de por defecto (la más antigua, o
 * «Mis compañías» recién creada) cuando no se pidió ninguna (""); si no, error.
 */
export async function clientOrgForNewBusiness(organizationId: string, requested: string): Promise<string> {
  if (requested === "") return ensureDefaultClientOrg(organizationId);
  const found = await db.clientOrg.findFirst({ where: { id: requested, organizationId }, select: { id: true } });
  if (!found) throw notInAccount();
  return found.id;
}
