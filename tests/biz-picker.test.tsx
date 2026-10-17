// El selector de negocio en orden: la cuenta arriba, sus organizaciones de cliente debajo y los negocios de cada una, en la computadora
// (BizSwitcher) y en el celular (MobileBizMenu). Se pinta con `renderToStaticMarkup` (sin DOM) y el CSS Module simulado, como
// tests/agent-team-settings-ui.test.tsx. El menú del celular vive en un portal que solo se abre al tocarlo, así que su lista se prueba
// por separado (MobileBizList).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/I18n";
import { MobileBizList, MobileBizMenu } from "@/components/MobileBizMenu";
import { BizSwitcher, type BizAccount, type BizGroup } from "@/components/nav/BizSwitcher";

vi.mock("@/components/nav/Nav.module.css", () => ({ default: new Proxy({}, { get: (_, k) => String(k) }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const GROUPS: BizGroup[] = [
  {
    id: "o1",
    name: "Familia Pérez",
    businesses: [
      { id: "b1", name: "Techos Pérez", color: "#0a7" },
      { id: "b2", name: "Pisos Pérez", color: "#a07" },
    ],
  },
  { id: "o2", name: "Grupo Rivera", businesses: [{ id: "b3", name: "Café Rivera", color: "#07a" }] },
];
const ACCOUNTS: BizAccount[] = [{ id: "a1", name: "Ricardo Arevalo", groups: GROUPS }];
/** Una sola cuenta con estos grupos. */
const one = (groups: BizGroup[], name = "Ricardo Arevalo"): BizAccount[] => [{ id: "a1", name, groups }];

const here = (node: React.ReactElement, lang: "es" | "en" = "es") => renderToStaticMarkup(<I18nProvider lang={lang}>{node}</I18nProvider>);
const desktop = (accounts: BizAccount[], activeId?: string, canAdd = false, lang: "es" | "en" = "es") =>
  here(<BizSwitcher accounts={accounts} activeId={activeId} canAdd={canAdd} />, lang);
const phoneList = (accounts: BizAccount[], activeId?: string, canAdd = false, lang: "es" | "en" = "es") =>
  here(<MobileBizList accounts={accounts} activeId={activeId} canAdd={canAdd} />, lang);
const phoneTrigger = (accounts: BizAccount[], activeId?: string, lang: "es" | "en" = "es") =>
  here(
    <MobileBizMenu accounts={accounts} activeId={activeId} canAdd={false}>
      <span>Salir</span>
    </MobileBizMenu>,
    lang,
  );

const count = (html: string, text: string) => html.split(text).length - 1;
/** La parte del selector que se ve cerrada: el botón (desktop) antes de la lista. */
const deskTrigger = (html: string) => html.slice(0, html.indexOf("switchList"));

const SURFACES = [
  { name: "computadora", render: desktop, orgClass: "switchGroup", accountHead: "switchAccountHead" },
  { name: "celular", render: phoneList, orgClass: "mbiz-group", accountHead: "mbiz-account-head" },
] as const;

describe.each(SURFACES)("selector en orden ($name)", ({ render, orgClass, accountHead }) => {
  /** Lo que hay desde cada organización hasta la siguiente: su encabezado y sus negocios. */
  const chunks = (html: string) =>
    html
      .split('<div role="group"')
      .slice(1)
      .filter((c) => c.slice(0, c.indexOf(">")).includes(`class="${orgClass}"`));
  /** Lo que hay desde el encabezado de cada cuenta hasta el de la siguiente: su nombre, sus organizaciones y sus negocios. */
  const accountChunks = (html: string) => html.split(`class="${accountHead}"`).slice(1);

  it("cada organización es un grupo con su nombre una sola vez como encabezado, seguido de sus negocios", () => {
    const html = render(ACCOUNTS);
    const groups = chunks(html);
    expect(groups).toHaveLength(2);
    expect(count(html, 'aria-label="Familia Pérez"')).toBe(1);
    expect(count(html, 'aria-label="Grupo Rivera"')).toBe(1);
    expect(count(html, ">Familia Pérez<")).toBe(1);
    expect(count(html, ">Grupo Rivera<")).toBe(1);

    const [first, second] = groups;
    expect(first.indexOf(">Familia Pérez<")).toBeGreaterThan(-1);
    expect(first.indexOf(">Familia Pérez<")).toBeLessThan(first.indexOf("Techos Pérez"));
    expect(first.indexOf("Techos Pérez")).toBeLessThan(first.indexOf("Pisos Pérez"));
    expect(first).not.toContain("Café Rivera");
    expect(second.indexOf(">Grupo Rivera<")).toBeLessThan(second.indexOf("Café Rivera"));
    expect(second).not.toContain("Techos Pérez");
    // Cada negocio sigue siendo un enlace a su Inicio.
    for (const id of ["b1", "b2", "b3"]) expect(html).toContain(`href="/b/${id}/inicio"`);
  });

  it("la cuenta va arriba de todo, una sola vez, como grupo con su nombre de encabezado y sus organizaciones dentro", () => {
    const html = render(ACCOUNTS);
    expect(count(html, 'aria-label="Ricardo Arevalo"')).toBe(1);
    expect(count(html, `class="${accountHead}"`)).toBe(1);
    // El nombre de la cuenta sale antes que cualquier organización o negocio.
    const account = html.indexOf("Ricardo Arevalo");
    expect(account).toBeGreaterThan(-1);
    expect(account).toBeLessThan(html.indexOf(">Familia Pérez<"));
    expect(account).toBeLessThan(html.indexOf("Techos Pérez"));
    // El encabezado dice «Cuenta: » a quien usa lector de pantalla, y «Account: » en inglés.
    const head = accountChunks(html)[0];
    expect(head.slice(0, head.indexOf("Ricardo Arevalo"))).toContain("Cuenta: ");
    const en = accountChunks(render(ACCOUNTS, undefined, false, "en"))[0];
    expect(en.slice(0, en.indexOf("Ricardo Arevalo"))).toContain("Account: ");
  });

  it("con dos cuentas, cada una lleva sus organizaciones debajo de su nombre y no las de la otra", () => {
    const accounts: BizAccount[] = [
      { id: "a1", name: "Ricardo Arevalo", groups: [GROUPS[0]] },
      { id: "a2", name: "Estudio Luna", groups: [GROUPS[1]] },
    ];
    const [first, second] = accountChunks(render(accounts));
    expect(first).toContain("Ricardo Arevalo");
    expect(first).toContain(">Familia Pérez<");
    expect(first).not.toContain("Grupo Rivera");
    expect(second).toContain("Estudio Luna");
    expect(second).toContain(">Grupo Rivera<");
    expect(second).not.toContain("Familia Pérez");
  });

  it("una cuenta sin negocios a la vista muestra su nombre y ningún grupo vacío", () => {
    const html = render(one([]), undefined, true);
    expect(html).toContain("Ricardo Arevalo");
    expect(chunks(html)).toHaveLength(0);
    expect(html).toContain("Agregar negocio");
  });

  it("con una sola organización igual se ve su encabezado", () => {
    const html = render(one([GROUPS[1]]));
    expect(chunks(html)).toHaveLength(1);
    expect(html).toContain('role="group" aria-label="Grupo Rivera"');
    expect(count(html, ">Grupo Rivera<")).toBe(1);
    expect(html).toContain("Café Rivera");
  });

  it("los nombres de la cuenta, la organización y el negocio con HTML se escapan", () => {
    const evil = one([{ id: "o9", name: '<b>Hola</b> "x"', businesses: [{ id: "b9", name: "<i>Negocio</i>", color: "#000" }] }], "<u>Cuenta</u>");
    const html = render(evil);
    expect(html).not.toContain("<b>Hola</b>");
    expect(html).not.toContain("<i>Negocio</i>");
    expect(html).not.toContain("<u>Cuenta</u>");
    expect(html).toContain("&lt;b&gt;Hola&lt;/b&gt;");
    expect(html).toContain("&lt;i&gt;Negocio&lt;/i&gt;");
    expect(html).toContain("&lt;u&gt;Cuenta&lt;/u&gt;");
  });

  it("«Agregar negocio» solo con canAdd y después de todos los grupos", () => {
    expect(render(ACCOUNTS, undefined, false)).not.toContain("Agregar negocio");
    const html = render(ACCOUNTS, undefined, true);
    expect(count(html, "Agregar negocio")).toBe(1);
    expect(html).toContain('href="/negocios/nuevo"');
    expect(html.indexOf("Agregar negocio")).toBeGreaterThan(html.indexOf("Café Rivera"));
    expect(render(ACCOUNTS, undefined, true, "en")).toContain("Add business");
  });

  it("no inventa un grupo vacío si no llegan cuentas", () => {
    const html = render([], undefined, true);
    expect(chunks(html)).toHaveLength(0);
    expect(count(html, `class="${accountHead}"`)).toBe(0);
    expect(html).toContain("Agregar negocio");
  });
});

describe("computadora (BizSwitcher)", () => {
  it("con un negocio activo del segundo grupo, el botón muestra la cuenta, debajo su organización y debajo el negocio", () => {
    const html = desktop(ACCOUNTS, "b3");
    const trigger = deskTrigger(html);
    expect(trigger).toContain("Ricardo Arevalo");
    expect(trigger).toContain(">Grupo Rivera<");
    expect(trigger).toContain("Café Rivera");
    expect(trigger.indexOf("Ricardo Arevalo")).toBeLessThan(trigger.indexOf(">Grupo Rivera<"));
    expect(trigger.indexOf(">Grupo Rivera<")).toBeLessThan(trigger.indexOf("Café Rivera"));
    // Cada línea se anuncia por lo que es.
    expect(trigger.indexOf("Cuenta: ")).toBeLessThan(trigger.indexOf("Ricardo Arevalo"));
    expect(trigger).toContain("Organización: ");
    expect(trigger).toContain("Negocio: ");
    expect(trigger).not.toContain("Familia Pérez");
    expect(trigger).not.toContain("Mis negocios");
    // Y en la lista: el activo marcado, los demás no.
    expect(count(html, 'aria-current="true"')).toBe(1);
  });

  it("con dos cuentas, el botón muestra la cuenta del negocio activo y no la otra", () => {
    const accounts: BizAccount[] = [
      { id: "a1", name: "Ricardo Arevalo", groups: [GROUPS[0]] },
      { id: "a2", name: "Estudio Luna", groups: [GROUPS[1]] },
    ];
    const trigger = deskTrigger(desktop(accounts, "b3"));
    expect(trigger).toContain("Estudio Luna");
    expect(trigger).not.toContain("Ricardo Arevalo");
  });

  it("el nombre de la organización con HTML se escapa también en el botón", () => {
    const html = desktop(one([{ id: "o9", name: "<script>x</script>", businesses: [{ id: "b9", name: "Uno", color: "#000" }] }]), "b9");
    expect(html).not.toContain("<script>");
    expect(deskTrigger(html)).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  it("sin negocio activo el botón dice «Mis negocios» y no muestra ninguna organización", () => {
    const trigger = deskTrigger(desktop(ACCOUNTS));
    expect(trigger).toContain("Mis negocios");
    expect(trigger).not.toContain("Familia Pérez");
    expect(trigger).not.toContain("Grupo Rivera");
    expect(deskTrigger(desktop(ACCOUNTS, undefined, false, "en"))).toContain("My businesses");
  });

  it("un id activo que no está entre los negocios visibles se trata como sin negocio activo", () => {
    const trigger = deskTrigger(desktop(ACCOUNTS, "ajeno"));
    expect(trigger).toContain("Mis negocios");
    expect(trigger).not.toContain("Grupo Rivera");
  });
});

describe("celular (MobileBizMenu)", () => {
  it("con un negocio activo del segundo grupo, el botón muestra su organización arriba del negocio", () => {
    const html = phoneTrigger(ACCOUNTS, "b3");
    expect(html).toContain("mbiz-name");
    expect(html).toContain(">Grupo Rivera<");
    expect(html).toContain("Café Rivera");
    expect(html.indexOf(">Grupo Rivera<")).toBeLessThan(html.indexOf("Café Rivera"));
    expect(html).not.toContain("Familia Pérez");
    expect(html).not.toContain("Mis negocios");
  });

  it("el nombre de la organización con HTML se escapa también en el botón", () => {
    const html = phoneTrigger(one([{ id: "o9", name: "<img src=x>", businesses: [{ id: "b9", name: "Uno", color: "#000" }] }]), "b9");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x&gt;");
  });

  it("sin negocio activo el botón dice «Mis negocios»", () => {
    const html = phoneTrigger(ACCOUNTS);
    expect(html).toContain("Mis negocios");
    expect(html).not.toContain("Familia Pérez");
    expect(phoneTrigger(ACCOUNTS, undefined, "en")).toContain("My businesses");
  });

  it("en la lista, el negocio activo lleva la marca ✓ y los demás no", () => {
    const html = phoneList(ACCOUNTS, "b2");
    expect(count(html, "✓")).toBe(1);
    expect(count(html, 'aria-current="true"')).toBe(1);
    const groups = html.split('<div role="group"').slice(1).filter((c) => c.slice(0, c.indexOf(">")).includes('class="mbiz-group"'));
    expect(groups[0]).toContain("✓");
    expect(groups[1]).not.toContain("✓");
  });
});
