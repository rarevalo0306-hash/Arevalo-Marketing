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
      return { id: "usr_1" };
    }),
    revalidatePath: vi.fn(),
    createClientOrg: vi.fn(),
    renameClientOrg: vi.fn(),
    deleteClientOrg: vi.fn(),
    moveBusiness: vi.fn(),
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
}));

import { createClientOrgAction, deleteClientOrgAction, moveBusinessAction, renameClientOrgAction } from "@/app/actions-client-orgs";
import { InvalidArgs } from "@/lib/ensure";
import { bi } from "@/lib/i18n";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const stores = [m.createClientOrg, m.renameClientOrg, m.deleteClientOrg, m.moveBusiness];
const notInAccount = () => bi("Esa organización no es de esta cuenta.", "That organization isn't in this account.");

/** Cada acción, ya con una cuenta, un id y un formulario de ejemplo. */
const calls = (accountId: string) => ({
  create: () => createClientOrgAction(accountId, null, form({ name: "Juan" })),
  rename: () => renameClientOrgAction(accountId, "c1", null, form({ name: "Juan" })),
  remove: () => deleteClientOrgAction(accountId, "c1"),
  move: () => moveBusinessAction(accountId, "b1", null, form({ clientOrgId: "c2" })),
});

beforeEach(() => {
  m.lang = "es";
  m.requireOrgAdmin.mockClear();
  m.revalidatePath.mockClear();
  for (const s of stores) s.mockReset().mockResolvedValue(undefined);
  m.createClientOrg.mockResolvedValue("corg_new");
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
