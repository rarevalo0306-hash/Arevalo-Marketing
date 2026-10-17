"use server";

// «Organizaciones»: crear, renombrar y borrar las organizaciones de cliente de una cuenta, pasar un negocio de una a otra,
// guardar los ajustes de su reporte semanal y mandarlo (de prueba o ahora). Todo lo hace solo el Administrador de esa cuenta
// (requireOrgAdmin). Las reglas y la base de datos están en src/lib/client-orgs-store.ts, que solo toca lo de la cuenta que
// recibe, y el envío en src/lib/client-org-report-run.ts.
import { revalidatePath } from "next/cache";
import { requireOrgAdmin } from "@/lib/auth";
import { appTz } from "@/lib/business-tz";
import { sendClientOrgReport, type ClientOrgSendOutcome } from "@/lib/client-org-report-run";
import { createClientOrg, deleteClientOrg, moveBusiness, renameClientOrg, saveClientOrgReport } from "@/lib/client-orgs-store";
import { ensure } from "@/lib/ensure";
import { errorText, type T, type UiLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { periodText, rangePeriod } from "@/lib/report-period";
import { senderLabel } from "@/lib/seo/alerts";

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

/** Los campos del formulario de los ajustes del reporte: los de `ReportSettings`, y nada más. */
const REPORT_FIELDS = ["contactName", "reportEmail", "phone", "reportLang", "timezone", "reportOn", "reportDay", "reportHour"] as const;

/** Guarda los ajustes del reporte semanal de una organización de la cuenta (los campos de REPORT_FIELDS; el almacén los valida). */
export async function saveClientOrgReportAction(accountId: string, clientOrgId: string, _prev: OrgResult, f: FormData): Promise<OrgResult> {
  ensure.text(accountId, clientOrgId);
  await requireOrgAdmin(accountId);
  const { lang, t } = await getT();
  try {
    const { skippedWeek } = await saveClientOrgReport(accountId, clientOrgId, Object.fromEntries(REPORT_FIELDS.map((k) => [k, field(f, k)])));
    refresh();
    // Encendido después de la hora de envío de esta semana: el primer reporte sale la próxima (no se manda el de la semana pasada).
    return {
      ok: true,
      message: skippedWeek
        ? t("Guardado. Esta semana ya pasó la hora de envío: el primer reporte sale la próxima semana.", "Saved. This week's send time has passed: the first report goes out next week.")
        : t("Guardado.", "Saved."),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/**
 * Lo que se le dice al Administrador de un envío. Del remitente sale solo su etiqueta (nombre y email): el `Sender` completo
 * lleva la clave de la cuenta de email y no debe salir nunca de esta acción.
 */
function sendResult(out: ClientOrgSendOutcome | null, lang: UiLang, t: T): OrgResult {
  if (out?.state === "sent") {
    const period = periodText(rangePeriod(out.week.fromDay, out.week.toDay, appTz()), lang, "short");
    const to = out.to.join(", ");
    const from = out.sender ? senderLabel(out.sender) : "";
    return {
      ok: true,
      message: t(`Listo: mandamos el reporte de ${period} a ${to} desde ${from}.`, `Done: we sent the report for ${period} to ${to} from ${from}.`),
    };
  }
  const why = out?.error ? `: ${out.error}` : ".";
  return { ok: false, message: t(`No se pudo mandar el reporte${why}`, `Couldn't send the report${why}`) };
}

/** Manda un reporte de prueba, solo al email de quien lo pide (el Administrador con la sesión abierta). */
export async function sendClientOrgTestAction(accountId: string, clientOrgId: string, _prev: OrgResult): Promise<OrgResult> {
  ensure.text(accountId, clientOrgId);
  const user = await requireOrgAdmin(accountId);
  const { lang, t } = await getT();
  try {
    const out = await sendClientOrgReport(clientOrgId, { trigger: "test", organizationId: accountId, to: [user.email] });
    refresh(); // el envío quedó anotado (salió o falló): «Último envío» cambió
    return sendResult(out, lang, t);
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** Manda ahora el reporte de la última semana completa a los emails guardados de la organización. */
export async function sendClientOrgNowAction(accountId: string, clientOrgId: string, _prev: OrgResult): Promise<OrgResult> {
  ensure.text(accountId, clientOrgId);
  await requireOrgAdmin(accountId);
  const { lang, t } = await getT();
  try {
    const out = await sendClientOrgReport(clientOrgId, { trigger: "manual", organizationId: accountId });
    refresh(); // el envío quedó anotado (salió o falló): «Último envío» cambió
    return sendResult(out, lang, t);
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
