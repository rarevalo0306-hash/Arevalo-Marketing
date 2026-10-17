// El selector de negocio agrupado por organización de cliente: en la computadora (BizSwitcher) y en el celular (MobileBizMenu).
// Se pinta con `renderToStaticMarkup` (sin DOM) y el CSS Module simulado, como tests/agent-team-settings-ui.test.tsx.
// El menú del celular vive en un portal que solo se abre al tocarlo, así que su lista se prueba por separado (MobileBizList).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/I18n";
import { MobileBizList, MobileBizMenu } from "@/components/MobileBizMenu";
import { BizSwitcher, type BizGroup } from "@/components/nav/BizSwitcher";

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

const here = (node: React.ReactElement, lang: "es" | "en" = "es") => renderToStaticMarkup(<I18nProvider lang={lang}>{node}</I18nProvider>);
const desktop = (groups: BizGroup[], activeId?: string, canAdd = false, lang: "es" | "en" = "es") =>
  here(<BizSwitcher groups={groups} activeId={activeId} canAdd={canAdd} />, lang);
const phoneList = (groups: BizGroup[], activeId?: string, canAdd = false, lang: "es" | "en" = "es") =>
  here(<MobileBizList groups={groups} activeId={activeId} canAdd={canAdd} />, lang);
const phoneTrigger = (groups: BizGroup[], activeId?: string, lang: "es" | "en" = "es") =>
  here(
    <MobileBizMenu groups={groups} activeId={activeId} canAdd={false}>
      <span>Salir</span>
    </MobileBizMenu>,
    lang,
  );

const count = (html: string, text: string) => html.split(text).length - 1;
/** Lo que hay desde cada grupo hasta el siguiente: el encabezado y sus negocios. */
const chunks = (html: string) => html.split('<div role="group"').slice(1);
/** La parte del selector que se ve cerrada: el botón (desktop) antes de la lista. */
const deskTrigger = (html: string) => html.slice(0, html.indexOf("switchList"));

const SURFACES = [
  { name: "computadora", render: desktop },
  { name: "celular", render: phoneList },
] as const;

describe.each(SURFACES)("selector agrupado ($name)", ({ render }) => {
  it("cada organización es un grupo con su nombre una sola vez como encabezado, seguido de sus negocios", () => {
    const html = render(GROUPS);
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

  it("con una sola organización igual se ve su encabezado", () => {
    const html = render([GROUPS[1]]);
    expect(chunks(html)).toHaveLength(1);
    expect(html).toContain('role="group" aria-label="Grupo Rivera"');
    expect(count(html, ">Grupo Rivera<")).toBe(1);
    expect(html).toContain("Café Rivera");
  });

  it("el nombre de la organización con HTML se escapa", () => {
    const evil: BizGroup[] = [{ id: "o9", name: '<b>Hola</b> "x"', businesses: [{ id: "b9", name: "<i>Negocio</i>", color: "#000" }] }];
    const html = render(evil);
    expect(html).not.toContain("<b>Hola</b>");
    expect(html).not.toContain("<i>Negocio</i>");
    expect(html).toContain("&lt;b&gt;Hola&lt;/b&gt;");
    expect(html).toContain("&lt;i&gt;Negocio&lt;/i&gt;");
  });

  it("«Agregar negocio» solo con canAdd y después de todos los grupos", () => {
    expect(render(GROUPS, undefined, false)).not.toContain("Agregar negocio");
    const html = render(GROUPS, undefined, true);
    expect(count(html, "Agregar negocio")).toBe(1);
    expect(html).toContain('href="/negocios/nuevo"');
    expect(html.indexOf("Agregar negocio")).toBeGreaterThan(html.indexOf("Café Rivera"));
    expect(render(GROUPS, undefined, true, "en")).toContain("Add business");
  });

  it("no inventa un grupo vacío si no llegan organizaciones", () => {
    const html = render([], undefined, true);
    expect(chunks(html)).toHaveLength(0);
    expect(html).toContain("Agregar negocio");
  });
});

describe("computadora (BizSwitcher)", () => {
  it("con un negocio activo del segundo grupo, el botón muestra su organización arriba del negocio", () => {
    const html = desktop(GROUPS, "b3");
    const trigger = deskTrigger(html);
    expect(trigger).toContain(">Grupo Rivera<");
    expect(trigger).toContain("Café Rivera");
    expect(trigger.indexOf(">Grupo Rivera<")).toBeLessThan(trigger.indexOf("Café Rivera"));
    expect(trigger).not.toContain("Familia Pérez");
    expect(trigger).not.toContain("Mis negocios");
    // Y en la lista: el activo marcado, los demás no.
    expect(count(html, 'aria-current="true"')).toBe(1);
  });

  it("el nombre de la organización con HTML se escapa también en el botón", () => {
    const evil: BizGroup[] = [{ id: "o9", name: "<script>x</script>", businesses: [{ id: "b9", name: "Uno", color: "#000" }] }];
    const html = desktop(evil, "b9");
    expect(html).not.toContain("<script>");
    expect(deskTrigger(html)).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  it("sin negocio activo el botón dice «Mis negocios» y no muestra ninguna organización", () => {
    const trigger = deskTrigger(desktop(GROUPS));
    expect(trigger).toContain("Mis negocios");
    expect(trigger).not.toContain("Familia Pérez");
    expect(trigger).not.toContain("Grupo Rivera");
    expect(deskTrigger(desktop(GROUPS, undefined, false, "en"))).toContain("My businesses");
  });

  it("un id activo que no está entre los negocios visibles se trata como sin negocio activo", () => {
    const trigger = deskTrigger(desktop(GROUPS, "ajeno"));
    expect(trigger).toContain("Mis negocios");
    expect(trigger).not.toContain("Grupo Rivera");
  });
});

describe("celular (MobileBizMenu)", () => {
  it("con un negocio activo del segundo grupo, el botón muestra su organización arriba del negocio", () => {
    const html = phoneTrigger(GROUPS, "b3");
    expect(html).toContain("mbiz-name");
    expect(html).toContain(">Grupo Rivera<");
    expect(html).toContain("Café Rivera");
    expect(html.indexOf(">Grupo Rivera<")).toBeLessThan(html.indexOf("Café Rivera"));
    expect(html).not.toContain("Familia Pérez");
    expect(html).not.toContain("Mis negocios");
  });

  it("el nombre de la organización con HTML se escapa también en el botón", () => {
    const evil: BizGroup[] = [{ id: "o9", name: "<img src=x>", businesses: [{ id: "b9", name: "Uno", color: "#000" }] }];
    const html = phoneTrigger(evil, "b9");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x&gt;");
  });

  it("sin negocio activo el botón dice «Mis negocios»", () => {
    const html = phoneTrigger(GROUPS);
    expect(html).toContain("Mis negocios");
    expect(html).not.toContain("Familia Pérez");
    expect(phoneTrigger(GROUPS, undefined, "en")).toContain("My businesses");
  });

  it("en la lista, el negocio activo lleva la marca ✓ y los demás no", () => {
    const html = phoneList(GROUPS, "b2");
    expect(count(html, "✓")).toBe(1);
    expect(count(html, 'aria-current="true"')).toBe(1);
    const [first, second] = chunks(html);
    expect(first).toContain("✓");
    expect(second).not.toContain("✓");
  });
});
