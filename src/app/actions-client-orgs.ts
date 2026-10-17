"use server";

// «Organizaciones»: crear, renombrar y borrar las organizaciones de cliente de una cuenta, y pasar un negocio de una a
// otra. Todo lo hace solo el Administrador de esa cuenta (requireOrgAdmin). Las reglas y la base de datos están en
// src/lib/client-orgs-store.ts, que solo toca lo de la cuenta que recibe.
import { revalidatePath } from "next/cache";
import { requireOrgAdmin } from "@/lib/auth";
import { createClientOrg, deleteClientOrg, moveBusiness, renameClientOrg } from "@/lib/client-orgs-store";
import { ensure } from "@/lib/ensure";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";

export type OrgResult = { ok: boolean; message: string } | null;

/** El campo tal como llegó: el almacén valida y recorta los nombres, y rechaza un id que no sea de la cuenta. */
const field = (f: FormData, k: string) => String(f.get(k) ?? "");

/** Después de un cambio: la lista de esta página y el menú de negocios (que agrupa por organización) se vuelven a leer. */
function refresh() {
  revalidatePath("/organizaciones");
  revalidatePath("/", "layout");
}

/** Crea una organización en la cuenta (campo `name`). */
export async function createClientOrgAction(accountId: string, _prev: OrgResult, f: FormData): Promise<OrgResult> {
  ensure.text(accountId);
  await requireOrgAdmin(accountId);
  const { lang, t } = await getT();
  try {
    await createClientOrg(accountId, field(f, "name"));
    refresh();
    return { ok: true, message: t("Listo.", "Done.") };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** Cambia el nombre de una organización de la cuenta (campo `name`). */
export async function renameClientOrgAction(accountId: string, clientOrgId: string, _prev: OrgResult, f: FormData): Promise<OrgResult> {
  ensure.text(accountId, clientOrgId);
  await requireOrgAdmin(accountId);
  const { lang, t } = await getT();
  try {
    await renameClientOrg(accountId, clientOrgId, field(f, "name"));
    refresh();
    return { ok: true, message: t("Listo.", "Done.") };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** Borra una organización de la cuenta; con negocios dentro no se borra (el almacén avisa). */
export async function deleteClientOrgAction(accountId: string, clientOrgId: string): Promise<OrgResult> {
  ensure.text(accountId, clientOrgId);
  await requireOrgAdmin(accountId);
  const { lang, t } = await getT();
  try {
    await deleteClientOrg(accountId, clientOrgId);
    refresh();
    return { ok: true, message: t("Listo.", "Done.") };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** Pasa un negocio de la cuenta a otra organización de la cuenta (campo `clientOrgId`). */
export async function moveBusinessAction(accountId: string, businessId: string, _prev: OrgResult, f: FormData): Promise<OrgResult> {
  ensure.text(accountId, businessId);
  await requireOrgAdmin(accountId);
  const { lang, t } = await getT();
  try {
    await moveBusiness(accountId, businessId, field(f, "clientOrgId"));
    refresh();
    return { ok: true, message: t("Listo.", "Done.") };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
