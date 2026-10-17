// La pantalla «Organizaciones»: las organizaciones de la cuenta con sus negocios, mover un negocio, renombrar, borrar las
// vacías y crear una nueva. Se pinta con `renderToStaticMarkup` (sin DOM) y el CSS Module simulado, como
// tests/agent-team-settings-ui.test.tsx; lo que pasa al tocar un botón lo prueban las acciones (tests/client-orgs-actions.test.ts).
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ClientOrgs, deleteQuestion } from "@/components/orgs/ClientOrgs";
import { I18nProvider } from "@/components/I18n";
import { translator } from "@/lib/i18n";

vi.mock("@/components/orgs/Orgs.module.css", () => ({ default: new Proxy({}, { get: (_, k) => String(k) }) }));
// Las acciones abren la base de datos y la sesión solo cuando alguien toca un botón.
vi.mock("@/app/actions-client-orgs", () => ({
  createClientOrgAction: vi.fn(),
  renameClientOrgAction: vi.fn(),
  deleteClientOrgAction: vi.fn(),
  moveBusinessAction: vi.fn(),
}));

type Org = { id: string; name: string; businesses: { id: string; name: string; color: string }[] };
const ORGS: Org[] = [
  {
    id: "c1",
    name: "Juan Pérez",
    businesses: [
      { id: "b1", name: "Techos Pérez", color: "#0f766e" },
      { id: "b2", name: "Pinturas Juan", color: "#c2410c" },
    ],
  },
  { id: "c2", name: "Compañía vacía", businesses: [] },
];

const render = (orgs: Org[] = ORGS, lang: "es" | "en" = "es", accountName = "Agencia Arévalo") =>
  renderToStaticMarkup(
    <I18nProvider lang={lang}>
      <ClientOrgs accountId="acc1" accountName={accountName} orgs={orgs} />
    </I18nProvider>,
  );
const count = (html: string, text: string) => html.split(text).length - 1;
/** The markup of one organization's card. */
const card = (html: string, id: string) => html.match(new RegExp(`<section[^>]*data-org="${id}"[\\s\\S]*?</section>`))?.[0] ?? "";

describe("la pantalla Organizaciones", () => {
  it("shows the heading, the account's name and every organization with its name", () => {
    const html = render();
    expect(html).toMatch(/<h1[^>]*>Organizaciones<\/h1>/);
    expect(html).toContain("Los clientes de «Agencia Arévalo» y sus negocios");
    expect(card(html, "c1")).toMatch(/<h2[^>]*>Juan Pérez<\/h2>/);
    expect(card(html, "c2")).toMatch(/<h2[^>]*>Compañía vacía<\/h2>/);
  });

  it("links each business to its home and counts them", () => {
    const c1 = card(render(), "c1");
    expect(c1).toMatch(/<a [^>]*href="\/b\/b1\/inicio"[^>]*>Techos Pérez<\/a>/);
    expect(c1).toMatch(/<a [^>]*href="\/b\/b2\/inicio"[^>]*>Pinturas Juan<\/a>/);
    expect(c1).toContain("2 negocios");
    expect(card(render(), "c2")).toContain("0 negocios");
    expect(card(render([{ ...ORGS[0], businesses: [ORGS[0].businesses[0]] }, ORGS[1]]), "c1")).toContain("1 negocio<");
  });

  it("offers «Mover a…» on every business, listing only the other organizations", () => {
    const html = render();
    expect(count(html, "Mover a…")).toBe(2);
    const c1 = card(html, "c1");
    const selects = [...c1.matchAll(/<select[\s\S]*?<\/select>/g)].map((m) => m[0]);
    expect(selects).toHaveLength(2);
    for (const select of selects) {
      expect(select).toMatch(/<option value="c2"[^>]*>Compañía vacía<\/option>/);
      expect(select).not.toContain('value="c1"');
      expect(count(select, "<option")).toBe(1);
    }
    // El campo se llama como lo lee la acción, y hay un botón «Mover» por negocio.
    expect(selects[0]).toContain('name="clientOrgId"');
    expect(count(c1, ">Mover<")).toBe(2);
  });

  it("with a single organization there is nowhere to move a business to", () => {
    const html = render([ORGS[0]]);
    expect(html).not.toContain("Mover a…");
    expect(html).not.toContain("<select");
    expect(html).toContain("Techos Pérez");
  });

  it("offers «Borrar organización» only on the empty organization", () => {
    const html = render();
    expect(count(html, "Borrar organización")).toBe(1);
    expect(card(html, "c2")).toContain("Borrar organización");
    expect(card(html, "c1")).not.toContain("Borrar organización");
  });

  it("offers «Editar nombre» and «Agregar negocio» (to that organization) on each organization", () => {
    const html = render();
    for (const id of ["c1", "c2"]) {
      expect(card(html, id)).toContain("Editar nombre");
      expect(card(html, id)).toMatch(new RegExp(`<a [^>]*href="/negocios/nuevo\\?organizacion=${id}"[^>]*>Agregar negocio<`));
    }
    // El formulario para renombrar está cerrado hasta que se pide.
    expect(card(html, "c1")).not.toContain('name="name"');
    expect(card(html, "c1")).not.toContain("Guardar");
  });

  it("always has «Nueva organización» with a name field", () => {
    const html = render();
    expect(html).toMatch(/<h2[^>]*>Nueva organización<\/h2>/);
    expect(html).toContain('name="name"');
    expect(html).toContain('maxLength="120"');
    expect(html).toContain('role="status"');
  });

  it("an account with no organizations yet still renders: an explanation and «Nueva organización»", () => {
    const html = render([]);
    expect(html).toMatch(/<h1[^>]*>Organizaciones<\/h1>/);
    expect(html).toContain("Todavía no hay organizaciones.");
    expect(html).toMatch(/<h2[^>]*>Nueva organización<\/h2>/);
    expect(html).not.toContain("data-org=");
    expect(html).not.toContain("Borrar organización");
  });

  it("shows names as text: an organization named <script>x</script> is escaped", () => {
    const html = render([{ id: "c9", name: "<script>x</script>", businesses: [{ id: "b9", name: "<img src=x onerror=alert(1)>", color: "#000000" }] }, ORGS[1]]);
    expect(html).not.toContain("<script>x</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    // También en el nombre de la cuenta.
    expect(render(ORGS, "es", "<b>Cuenta</b>")).not.toContain("<b>Cuenta</b>");
  });

  it("says everything in English when the app is in English", () => {
    const html = render(ORGS, "en");
    expect(html).toMatch(/<h1[^>]*>Organizations<\/h1>/);
    expect(html).toContain("The clients of &quot;Agencia Arévalo&quot; and their businesses");
    expect(html).toMatch(/<h2[^>]*>New organization<\/h2>/);
    expect(count(html, "Delete organization")).toBe(1);
    expect(html).toContain("Move to…");
    expect(html).toContain("Rename");
    expect(html).toContain("Add business");
    expect(html).toContain("2 businesses");
    expect(html).not.toContain("Organizaciones");
    expect(html).not.toContain("Borrar organización");
    expect(render([], "en")).toContain("There are no organizations yet.");
  });
});

describe("confirm before deleting", () => {
  it("asks with the organization's name, in both languages", () => {
    expect(deleteQuestion("Compañía vacía", translator("es"))).toBe("¿Borrar «Compañía vacía»? No tiene negocios.");
    expect(deleteQuestion("Empty co", translator("en"))).toBe('Delete "Empty co"? It has no businesses.');
  });
});

describe("the stylesheet", () => {
  it("defines every class the screen asks the CSS Module for (the mock above would hide a missing one)", () => {
    const css = readFileSync("src/components/orgs/Orgs.module.css", "utf8");
    const defined = new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
    for (const file of ["src/components/orgs/ClientOrgs.tsx", "src/app/organizaciones/page.tsx"]) {
      const used = [...readFileSync(file, "utf8").matchAll(/\bs\.([A-Za-z]\w*)/g)].map((m) => m[1]);
      expect(used.length, file).toBeGreaterThan(0);
      for (const name of used) expect(defined.has(name), `${file}: s.${name}`).toBe(true);
    }
  });
});
