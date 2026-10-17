// Las acciones de «Organizaciones»: solo el Administrador de la cuenta, argumentos revisados con ensure antes que nada y
// los errores del almacén (BiError) de vuelta como { ok: false, message } en el idioma de la app. Sin base de datos.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  class AccessError extends Error {
    constructor(
      message: string,
      public status: 403 | 404,
    ) {
      super(message);
    }
  }
  return {
    AccessError,
    lang: "es" as "es" | "en",
    // Como el real: solo es Administrador de «acc1».
    requireOrgAdmin: vi.fn(async (accountId: string) => {
      if (accountId !== "acc1") throw new AccessError("Esto solo lo puede hacer el Administrador.", 403);
      return { id: "usr_1", email: "admin@x.com" };
    }),
    revalidatePath: vi.fn(),
    createClientOrg: vi.fn(),
    renameClientOrg: vi.fn(),
    deleteClientOrg: vi.fn(),
    moveBusiness: vi.fn(),
    saveClientOrgReport: vi.fn(),
    sendClientOrgReport: vi.fn(),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/auth", () => ({ requireOrgAdmin: m.requireOrgAdmin, requireUser: vi.fn() }));
vi.mock("@/lib/i18n-server", () => ({ getT: async () => ({ lang: m.lang, t: (es: string, en: string) => (m.lang === "en" ? en : es) }) }));
vi.mock("@/lib/client-orgs-store", () => ({
  createClientOrg: m.createClientOrg,
  renameClientOrg: m.renameClientOrg,
  deleteClientOrg: m.deleteClientOrg,
  moveBusiness: m.moveBusiness,
  saveClientOrgReport: m.saveClientOrgReport,
}));
vi.mock("@/lib/client-org-report-run", () => ({ sendClientOrgReport: m.sendClientOrgReport }));

import {
  createClientOrgAction,
  deleteClientOrgAction,
  moveBusinessAction,
  renameClientOrgAction,
  saveClientOrgReportAction,
  sendClientOrgNowAction,
  sendClientOrgTestAction,
} from "@/app/actions-client-orgs";
import { appTz } from "@/lib/business-tz";
import { InvalidArgs } from "@/lib/ensure";
import { bi } from "@/lib/i18n";
import { periodText, rangePeriod } from "@/lib/report-period";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const stores = [m.createClientOrg, m.renameClientOrg, m.deleteClientOrg, m.moveBusiness, m.saveClientOrgReport, m.sendClientOrgReport];
const notInAccount = () => bi("Esa organización no es de esta cuenta.", "That organization isn't in this account.");

/** Cada acción, ya con una cuenta, un id y un formulario de ejemplo. */
const calls = (accountId: string) => ({
  create: () => createClientOrgAction(accountId, null, form({ name: "Juan" })),
  rename: () => renameClientOrgAction(accountId, "c1", null, form({ name: "Juan" })),
  remove: () => deleteClientOrgAction(accountId, "c1"),
  move: () => moveBusinessAction(accountId, "b1", null, form({ clientOrgId: "c2" })),
  save: () => saveClientOrgReportAction(accountId, "c1", null, form({ reportEmail: "ana@x.com" })),
  test: () => sendClientOrgTestAction(accountId, "c1", null),
  now: () => sendClientOrgNowAction(accountId, "c1", null),
});

// La semana del 5 al 11 de octubre de 2026; el remitente trae su clave, que nunca debe salir de la acción.
const week = { week: "2026-10-05", fromDay: "2026-10-05", toDay: "2026-10-11" };
const sentOutcome = () => ({
  state: "sent" as const,
  week,
  to: ["ana@x.com", "luis@x.com"],
  subject: "Reporte semanal",
  sender: { name: "Agencia", email: "agencia@x.com", apiKey: "SECRET-API-KEY" },
});

beforeEach(() => {
  m.lang = "es";
  m.requireOrgAdmin.mockClear();
  m.revalidatePath.mockClear();
  for (const s of stores) s.mockReset().mockResolvedValue(undefined);
  m.createClientOrg.mockResolvedValue("corg_new");
  m.saveClientOrgReport.mockResolvedValue({ skippedWeek: false });
  m.sendClientOrgReport.mockResolvedValue(sentOutcome());
});

describe("only the Administrator of the account changes its organizations", () => {
  it("rejects a caller who is not the Administrator of the account, and touches nothing", async () => {
    for (const [name, run] of Object.entries(calls("acc2"))) {
      await expect(run(), name).rejects.toMatchObject({ status: 403 });
    }
    for (const s of stores) expect(s).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("checks the account the caller named, and never one that comes in the form", async () => {
    await createClientOrgAction("acc1", null, form({ name: "Juan", organizationId: "acc2", accountId: "acc2" }));
    expect(m.requireOrgAdmin).toHaveBeenCalledWith("acc1");
    expect(m.createClientOrg).toHaveBeenCalledWith("acc1", "Juan");
    await moveBusinessAction("acc1", "b1", null, form({ clientOrgId: "c2", organizationId: "acc2" }));
    expect(m.moveBusiness).toHaveBeenCalledWith("acc1", "b1", "c2");
  });

  it("a non-string argument throws before the permission is even checked", async () => {
    const forged = { in: ["acc1", "acc2"] } as unknown as string;
    await expect(createClientOrgAction(forged, null, form({ name: "x" }))).rejects.toThrow(InvalidArgs);
    await expect(renameClientOrgAction("acc1", forged, null, form({ name: "x" }))).rejects.toThrow(InvalidArgs);
    await expect(renameClientOrgAction(forged, "c1", null, form({ name: "x" }))).rejects.toThrow(InvalidArgs);
    await expect(deleteClientOrgAction("acc1", { not: "c1" } as unknown as string)).rejects.toThrow(InvalidArgs);
    await expect(deleteClientOrgAction(undefined as unknown as string, "c1")).rejects.toThrow(InvalidArgs);
    await expect(moveBusinessAction("acc1", forged, null, form({ clientOrgId: "c2" }))).rejects.toThrow(InvalidArgs);
    await expect(moveBusinessAction(forged, "b1", null, form({ clientOrgId: "c2" }))).rejects.toThrow(InvalidArgs);
    expect(m.requireOrgAdmin).not.toHaveBeenCalled();
    for (const s of stores) expect(s).not.toHaveBeenCalled();
  });

  it("the report actions throw InvalidArgs before any guard when the account or the organization is missing or not a string", async () => {
    const forged = { in: ["c1", "c2"] } as unknown as string;
    const missing = undefined as unknown as string;
    for (const bad of [forged, missing]) {
      await expect(saveClientOrgReportAction(bad, "c1", null, form({}))).rejects.toThrow(InvalidArgs);
      await expect(saveClientOrgReportAction("acc1", bad, null, form({}))).rejects.toThrow(InvalidArgs);
      await expect(sendClientOrgTestAction(bad, "c1", null)).rejects.toThrow(InvalidArgs);
      await expect(sendClientOrgTestAction("acc1", bad, null)).rejects.toThrow(InvalidArgs);
      await expect(sendClientOrgNowAction(bad, "c1", null)).rejects.toThrow(InvalidArgs);
      await expect(sendClientOrgNowAction("acc1", bad, null)).rejects.toThrow(InvalidArgs);
    }
    expect(m.requireOrgAdmin).not.toHaveBeenCalled();
    for (const s of stores) expect(s).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("create, rename, delete and move", () => {
  it("create hands the name as typed to the store (it validates and trims) and says «Listo.»", async () => {
    expect(await createClientOrgAction("acc1", null, form({ name: "  Juan  " }))).toEqual({ ok: true, message: "Listo." });
    expect(m.createClientOrg).toHaveBeenCalledWith("acc1", "  Juan  ");
    expect(m.revalidatePath).toHaveBeenCalledWith("/organizaciones");
    expect(m.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("create with no name field sends an empty name, which the store refuses", async () => {
    m.createClientOrg.mockRejectedValue(bi("Escribe un nombre de 1 a 120 caracteres.", "Enter a name of 1 to 120 characters."));
    expect(await createClientOrgAction("acc1", null, new FormData())).toEqual({ ok: false, message: "Escribe un nombre de 1 a 120 caracteres." });
    expect(m.createClientOrg).toHaveBeenCalledWith("acc1", "");
  });

  it("rename passes the account, the organization and the name", async () => {
    expect(await renameClientOrgAction("acc1", "c1", null, form({ name: " Nuevo " }))).toEqual({ ok: true, message: "Listo." });
    expect(m.renameClientOrg).toHaveBeenCalledWith("acc1", "c1", " Nuevo ");
    expect(m.revalidatePath).toHaveBeenCalledWith("/organizaciones");
    expect(m.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("delete passes the account and the organization", async () => {
    expect(await deleteClientOrgAction("acc1", "c1")).toEqual({ ok: true, message: "Listo." });
    expect(m.deleteClientOrg).toHaveBeenCalledWith("acc1", "c1");
    expect(m.revalidatePath).toHaveBeenCalledWith("/organizaciones");
    expect(m.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("move passes the account, the business and the target organization", async () => {
    expect(await moveBusinessAction("acc1", "b1", null, form({ clientOrgId: "c2" }))).toEqual({ ok: true, message: "Listo." });
    expect(m.moveBusiness).toHaveBeenCalledWith("acc1", "b1", "c2");
    expect(m.revalidatePath).toHaveBeenCalledWith("/organizaciones");
    expect(m.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("says «Done.» in English", async () => {
    m.lang = "en";
    expect(await createClientOrgAction("acc1", null, form({ name: "Juan" }))).toEqual({ ok: true, message: "Done." });
    expect(await deleteClientOrgAction("acc1", "c1")).toEqual({ ok: true, message: "Done." });
  });
});

describe("a store refusal comes back as a message, not a crash", () => {
  it("shows the store's error in the app's language and does not revalidate", async () => {
    m.moveBusiness.mockRejectedValue(notInAccount());
    expect(await moveBusinessAction("acc1", "b1", null, form({ clientOrgId: "corg_of_another_account" }))).toEqual({ ok: false, message: "Esa organización no es de esta cuenta." });
    m.lang = "en";
    expect(await moveBusinessAction("acc1", "b1", null, form({ clientOrgId: "x" }))).toEqual({ ok: false, message: "That organization isn't in this account." });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("every action reports the store's error", async () => {
    m.createClientOrg.mockRejectedValue(notInAccount());
    m.renameClientOrg.mockRejectedValue(notInAccount());
    m.deleteClientOrg.mockRejectedValue(bi("Esta organización todavía tiene negocios: muévelos antes de borrarla.", "This organization still has businesses: move them before deleting it."));
    const { create, rename, remove } = calls("acc1");
    expect(await create()).toEqual({ ok: false, message: "Esa organización no es de esta cuenta." });
    expect(await rename()).toEqual({ ok: false, message: "Esa organización no es de esta cuenta." });
    expect(await remove()).toEqual({ ok: false, message: "Esta organización todavía tiene negocios: muévelos antes de borrarla." });
    m.lang = "en";
    expect(await remove()).toEqual({ ok: false, message: "This organization still has businesses: move them before deleting it." });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("save the weekly report settings", () => {
  it("hands the store the fields of the form as plain text, missing ones empty, and says «Guardado.»", async () => {
    const f = form({
      contactName: "Ana",
      reportEmail: "ana@x.com, luis@x.com",
      phone: "555",
      reportLang: "en",
      timezone: "America/Mexico_City",
      reportOn: "on",
      reportDay: "1",
      reportHour: "8",
      organizationId: "acc2", // forjado: no cambia a cuál se escribe
      clientOrgId: "c9",
    });
    expect(await saveClientOrgReportAction("acc1", "c1", null, f)).toEqual({ ok: true, message: "Guardado." });
    expect(m.requireOrgAdmin).toHaveBeenCalledWith("acc1");
    expect(m.saveClientOrgReport).toHaveBeenCalledWith("acc1", "c1", {
      contactName: "Ana",
      reportEmail: "ana@x.com, luis@x.com",
      phone: "555",
      reportLang: "en",
      timezone: "America/Mexico_City",
      reportOn: "on",
      reportDay: "1",
      reportHour: "8",
    });
    expect(m.revalidatePath).toHaveBeenCalledWith("/organizaciones");
    expect(m.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("an unchecked box and absent fields go as empty text", async () => {
    await saveClientOrgReportAction("acc1", "c1", null, new FormData());
    expect(m.saveClientOrgReport).toHaveBeenCalledWith("acc1", "c1", {
      contactName: "",
      reportEmail: "",
      phone: "",
      reportLang: "",
      timezone: "",
      reportOn: "",
      reportDay: "",
      reportHour: "",
    });
  });

  it("says «Saved.» in English", async () => {
    m.lang = "en";
    expect(await saveClientOrgReportAction("acc1", "c1", null, form({ reportEmail: "ana@x.com" }))).toEqual({ ok: true, message: "Saved." });
  });

  it("when the report was switched on after this week's send time, it says the first report goes out next week", async () => {
    m.saveClientOrgReport.mockResolvedValue({ skippedWeek: true });
    expect(await saveClientOrgReportAction("acc1", "c1", null, form({ reportEmail: "ana@x.com", reportOn: "on" }))).toEqual({
      ok: true,
      message: "Guardado. Esta semana ya pasó la hora de envío: el primer reporte sale la próxima semana.",
    });
    m.lang = "en";
    expect(await saveClientOrgReportAction("acc1", "c1", null, form({ reportEmail: "ana@x.com", reportOn: "on" }))).toEqual({
      ok: true,
      message: "Saved. This week's send time has passed: the first report goes out next week.",
    });
    expect(m.revalidatePath).toHaveBeenCalledWith("/organizaciones");
    expect(m.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("a refusal of the store (invalid field, organization of another account) comes back as a message and revalidates nothing", async () => {
    m.saveClientOrgReport.mockRejectedValue(bi("Escribe hasta 3 emails válidos para el reporte.", "Enter up to 3 valid emails for the report."));
    expect(await saveClientOrgReportAction("acc1", "c1", null, form({ reportEmail: "no" }))).toEqual({ ok: false, message: "Escribe hasta 3 emails válidos para el reporte." });
    m.lang = "en";
    expect(await saveClientOrgReportAction("acc1", "c1", null, form({ reportEmail: "no" }))).toEqual({ ok: false, message: "Enter up to 3 valid emails for the report." });
    m.saveClientOrgReport.mockRejectedValue(notInAccount());
    expect(await saveClientOrgReportAction("acc1", "corg_of_another_account", null, form({}))).toEqual({ ok: false, message: "That organization isn't in this account." });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("send the weekly report by hand", () => {
  it("the test goes only to the signed-in Administrator, as a test, for the account that was checked", async () => {
    await sendClientOrgTestAction("acc1", "c1", null);
    expect(m.requireOrgAdmin).toHaveBeenCalledWith("acc1");
    expect(m.sendClientOrgReport).toHaveBeenCalledTimes(1);
    expect(m.sendClientOrgReport).toHaveBeenCalledWith("c1", { trigger: "test", organizationId: "acc1", to: ["admin@x.com"] });
  });

  it("the send-now uses the saved recipients, as a manual send, for the account that was checked", async () => {
    await sendClientOrgNowAction("acc1", "c1", null);
    expect(m.sendClientOrgReport).toHaveBeenCalledTimes(1);
    expect(m.sendClientOrgReport).toHaveBeenCalledWith("c1", { trigger: "manual", organizationId: "acc1" });
  });

  it("a sent outcome says who got which week and from which sender, and revalidates", async () => {
    // El texto de la semana lo dibuja periodText (Intl): aquí se arma con la misma función para no atarlo a la versión de ICU.
    const weekText = (lang: "es" | "en") => periodText(rangePeriod(week.fromDay, week.toDay, appTz()), lang, "short");
    expect(weekText("es")).toContain("oct");
    const es = `Listo: mandamos el reporte de ${weekText("es")} a ana@x.com, luis@x.com desde Agencia <agencia@x.com>.`;
    expect(await sendClientOrgNowAction("acc1", "c1", null)).toEqual({ ok: true, message: es });
    expect(await sendClientOrgTestAction("acc1", "c1", null)).toEqual({ ok: true, message: es });
    expect(m.revalidatePath).toHaveBeenCalledWith("/organizaciones");
    expect(m.revalidatePath).toHaveBeenCalledWith("/", "layout");
    m.lang = "en";
    expect(await sendClientOrgNowAction("acc1", "c1", null)).toEqual({
      ok: true,
      message: `Done: we sent the report for ${weekText("en")} to ana@x.com, luis@x.com from Agencia <agencia@x.com>.`,
    });
  });

  it("a sender with no name is shown by its email alone", async () => {
    m.sendClientOrgReport.mockResolvedValue({ ...sentOutcome(), to: ["ana@x.com"], sender: { name: "", email: "agencia@x.com", apiKey: "SECRET-API-KEY" } });
    const out = await sendClientOrgNowAction("acc1", "c1", null);
    expect(out?.ok).toBe(true);
    expect(out?.message).toMatch(/ a ana@x\.com desde agencia@x\.com\.$/);
  });

  it("never lets the sender, or its key, reach the browser", async () => {
    for (const run of [calls("acc1").now, calls("acc1").test]) {
      const out = await run();
      expect(Object.keys(out ?? {}).sort()).toEqual(["message", "ok"]);
      expect(JSON.stringify(out)).not.toContain("SECRET-API-KEY");
      expect(JSON.stringify(out)).not.toContain("apiKey");
    }
  });

  it("an error outcome is a failure that carries its error, and revalidates so the page shows the last send", async () => {
    m.sendClientOrgReport.mockResolvedValue({ state: "error", week, to: ["ana@x.com"], subject: "", error: "No se pudo enviar el email (503). Revisa Email en Conexiones." });
    const es = await sendClientOrgNowAction("acc1", "c1", null);
    expect(es?.ok).toBe(false);
    expect(es?.message).toContain("No se pudo enviar el email (503). Revisa Email en Conexiones.");
    expect(es?.message).toMatch(/^No se pudo mandar el reporte/);
    expect(m.revalidatePath).toHaveBeenCalledWith("/organizaciones");
    m.lang = "en";
    const en = await sendClientOrgTestAction("acc1", "c1", null);
    expect(en?.ok).toBe(false);
    expect(en?.message).toMatch(/^Couldn't send the report/);
    expect(en?.message).toContain("No se pudo enviar el email (503)");
  });

  it("a BiError from the engine (no businesses, no email, not in the account) comes back in the visitor's language", async () => {
    m.sendClientOrgReport.mockRejectedValue(bi("Falta a quién mandarlo: escribe un email válido para el reporte.", "There's no one to send it to: enter a valid email for the report."));
    expect(await sendClientOrgNowAction("acc1", "c1", null)).toEqual({ ok: false, message: "Falta a quién mandarlo: escribe un email válido para el reporte." });
    m.lang = "en";
    expect(await sendClientOrgTestAction("acc1", "c1", null)).toEqual({ ok: false, message: "There's no one to send it to: enter a valid email for the report." });
    m.sendClientOrgReport.mockRejectedValue(notInAccount());
    expect(await sendClientOrgNowAction("acc1", "corg_of_another_account", null)).toEqual({ ok: false, message: "That organization isn't in this account." });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});
