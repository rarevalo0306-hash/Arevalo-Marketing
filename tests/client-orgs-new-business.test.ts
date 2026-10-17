// Elegir la organización al agregar un negocio: la acción `createBusinessFromWeb` y la página /negocios/nuevo.
// Sin base de datos ni sesión: se simulan la sesión, la base y el almacén de organizaciones, como tests/save-connection.test.ts.
// Que el almacén rechace una organización de otra cuenta lo prueba tests/client-orgs-database.test.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  create: vi.fn(),
  count: vi.fn(),
  listClientOrgs: vi.fn(),
  clientOrgForNewBusiness: vi.fn(),
  newBusinessOrganizationId: vi.fn(),
  requireUser: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw Object.assign(new Error(`redirect:${to}`), { to }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireBusiness: vi.fn(),
  requireUser: m.requireUser,
  myBusinessesWhere: vi.fn(async () => ({})),
  newBusinessOrganizationId: m.newBusinessOrganizationId,
}));
vi.mock("@/lib/db", () => ({ db: { business: { create: m.create, count: m.count } } }));
vi.mock("@/lib/client-orgs-store", () => ({ listClientOrgs: m.listClientOrgs, clientOrgForNewBusiness: m.clientOrgForNewBusiness }));
vi.mock("@/lib/i18n-server", () => ({ getT: async () => ({ lang: "es", t: (es: string) => es }) }));
vi.mock("@/components/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("@/app/negocios/nuevo/nuevo.module.css", () => ({ default: new Proxy({}, { get: (_, k) => String(k) }) }));

import { createBusinessFromWeb } from "@/app/actions-study";
import NewBusiness from "@/app/negocios/nuevo/page";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ name: "Techos Pérez", ownerName: "Ricardo", ...fields })) f.set(k, v);
  return f;
};
/** Lo que lanza `redirect` (la acción termina siempre con un redirect si todo sale bien). */
const redirectedTo = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { to?: string }).to;
  }
  return undefined;
};

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.newBusinessOrganizationId.mockResolvedValue("acc1");
  m.clientOrgForNewBusiness.mockImplementation(async (_account: string, requested: string) => requested || "c-default");
  m.create.mockResolvedValue({ id: "biz1" });
});

describe("createBusinessFromWeb: la organización del negocio nuevo", () => {
  it("con clientOrgId pide esa organización a la cuenta donde se crea el negocio y la guarda", async () => {
    m.newBusinessOrganizationId.mockResolvedValue("acc7");
    m.clientOrgForNewBusiness.mockResolvedValue("c2-real");
    const to = await redirectedTo(createBusinessFromWeb(form({ clientOrgId: "c2" })));
    expect(m.clientOrgForNewBusiness).toHaveBeenCalledExactlyOnceWith("acc7", "c2");
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.create.mock.calls[0][0].data).toMatchObject({ organizationId: "acc7", clientOrgId: "c2-real", name: "Techos Pérez" });
    expect(to).toBe("/b/biz1/diagnostico");
  });

  it("sin el campo pasa \"\" (la organización por defecto de la cuenta)", async () => {
    await redirectedTo(createBusinessFromWeb(form({})));
    expect(m.clientOrgForNewBusiness).toHaveBeenCalledExactlyOnceWith("acc1", "");
    expect(m.create.mock.calls[0][0].data).toMatchObject({ organizationId: "acc1", clientOrgId: "c-default" });
  });

  it("recorta los espacios del campo antes de pedirlo", async () => {
    await redirectedTo(createBusinessFromWeb(form({ clientOrgId: "  c3  " })));
    expect(m.clientOrgForNewBusiness).toHaveBeenCalledExactlyOnceWith("acc1", "c3");
  });

  it("si la organización no es de la cuenta, no se crea ningún negocio y el error llega tal cual", async () => {
    m.clientOrgForNewBusiness.mockRejectedValue(new Error("Esa organización no es de esta cuenta."));
    await expect(createBusinessFromWeb(form({ clientOrgId: "de-otra-cuenta" }))).rejects.toThrow("Esa organización no es de esta cuenta.");
    expect(m.create).not.toHaveBeenCalled();
  });

  it("un dato inválido del formulario se rechaza antes de tocar las organizaciones", async () => {
    await expect(createBusinessFromWeb(form({ name: "" }))).rejects.toThrow("Escribe el nombre del negocio");
    await expect(createBusinessFromWeb(form({ ownerEmail: "no-es-un-correo" }))).rejects.toThrow("El correo del dueño no es válido.");
    expect(m.clientOrgForNewBusiness).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });
});

const ORGS = [
  { id: "c1", name: "Mis compañías", businesses: [] },
  { id: "c2", name: "Juan Pérez", businesses: [{ id: "b1", name: "Techos Pérez", color: "#0f766e" }] },
];
const page = async (searchParams: { organizacion?: string | string[] } = {}) =>
  renderToStaticMarkup(await NewBusiness({ searchParams: Promise.resolve(searchParams) }));
/** The <select name="clientOrgId"> and its options, or "" when the page has none. */
const select = (html: string) => html.match(/<select[^>]*name="clientOrgId"[\s\S]*?<\/select>/)?.[0] ?? "";
const selectedIds = (html: string) => [...select(html).matchAll(/<option[^>]*value="([^"]*)"[^>]*selected=""/g)].map((x) => x[1]);

describe("/negocios/nuevo: elegir la organización", () => {
  beforeEach(() => {
    m.requireUser.mockResolvedValue({ memberships: [{ organizationId: "acc1", role: "admin" }] });
    m.count.mockResolvedValue(1);
    m.listClientOrgs.mockResolvedValue(ORGS);
  });

  it("lista las organizaciones de la cuenta donde se crea el negocio, con la etiqueta «Organización»", async () => {
    m.newBusinessOrganizationId.mockResolvedValue("acc9");
    const html = await page();
    expect(m.listClientOrgs).toHaveBeenCalledExactlyOnceWith("acc9");
    expect(html).toMatch(/<label[^>]*for="clientOrgId"[^>]*>Organización<\/label>/);
    expect(select(html)).toMatch(/<select[^>]*id="clientOrgId"[^>]*class="field"|<select[^>]*class="field"[^>]*id="clientOrgId"/);
    expect(select(html)).toMatch(/<option[^>]*value="c1"[^>]*>Mis compañías<\/option>/);
    expect(select(html)).toMatch(/<option[^>]*value="c2"[^>]*>Juan Pérez<\/option>/);
  });

  it("sin ?organizacion= deja elegida la primera (la de por defecto)", async () => {
    expect(selectedIds(await page())).toEqual(["c1"]);
  });

  it("con ?organizacion= de una organización de la cuenta, la deja elegida", async () => {
    expect(selectedIds(await page({ organizacion: "c2" }))).toEqual(["c2"]);
  });

  it("con un id desconocido, o una lista de ids, vuelve a la primera", async () => {
    expect(selectedIds(await page({ organizacion: "de-otra-cuenta" }))).toEqual(["c1"]);
    expect(selectedIds(await page({ organizacion: ["c2", "c1"] }))).toEqual(["c1"]);
    expect(selectedIds(await page({ organizacion: "" }))).toEqual(["c1"]);
  });

  it("con una sola organización igual muestra el selector, ya elegida", async () => {
    m.listClientOrgs.mockResolvedValue([ORGS[0]]);
    const html = await page();
    expect(select(html)).toContain("Mis compañías");
    expect(selectedIds(html)).toEqual(["c1"]);
  });

  it("sin ninguna organización no muestra selector ni crea nada al abrir la página", async () => {
    m.listClientOrgs.mockResolvedValue([]);
    const html = await page();
    expect(html).not.toContain("clientOrgId");
    expect(html).toContain('name="name"');
    expect(m.clientOrgForNewBusiness).not.toHaveBeenCalled();
  });

  it("escapa el nombre de la organización", async () => {
    m.listClientOrgs.mockResolvedValue([{ id: "c1", name: "<img src=x onerror=alert(1)>", businesses: [] }]);
    const html = await page();
    expect(html).not.toContain("<img src=x");
    expect(select(html)).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("quien no es Administrador no ve el formulario ni las organizaciones", async () => {
    m.requireUser.mockResolvedValue({ memberships: [{ organizationId: "acc1", role: "staff" }] });
    m.count.mockResolvedValue(0);
    const html = await page();
    expect(html).toContain("Sin negocios todavía");
    expect(m.listClientOrgs).not.toHaveBeenCalled();
    expect(m.newBusinessOrganizationId).not.toHaveBeenCalled();
  });
});
