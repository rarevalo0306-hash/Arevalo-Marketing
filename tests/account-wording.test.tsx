// «Cuenta»: la pantalla le dice «cuenta» a lo que el código llama Organization, para que «organización» solo signifique un
// cliente (ClientOrg). Aquí: los campos de acceso agrupados por organización, la cuenta arriba del selector y el correo de la invitación.
// Se pinta con `renderToStaticMarkup` (sin DOM) y los CSS Modules simulados, como tests/biz-picker.test.tsx.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/I18n";
import { AccessFields } from "@/components/team/AccessFields";
import type { TeamBusiness } from "@/components/team/types";

vi.mock("@/components/team/Team.module.css", () => ({ default: new Proxy({}, { get: (_, k) => String(k) }) }));
vi.mock("@/components/nav/Nav.module.css", () => ({ default: new Proxy({}, { get: (_, k) => String(k) }) }));

// El correo de la invitación: lo que recibe sendAuthEmail, sin base de datos ni correo de verdad.
const mail = vi.hoisted(() => ({ sent: [] as { intro: string[] }[] }));
vi.mock("@/lib/auth-email", () => ({
  sendAuthEmail: async (m: { intro: string[] }) => {
    mail.sent.push(m);
    return true;
  },
}));
const stored = vi.hoisted(() => ({ orgName: "" }));
vi.mock("@/lib/db", () => ({
  db: {
    invitation: {
      findFirst: async () => ({ id: "inv1", email: "ana@ejemplo.com", role: "viewer", allBusinesses: true, businessIds: [] }),
      update: async () => ({}),
    },
    organization: { findUniqueOrThrow: async () => ({ name: stored.orgName }) },
    business: { findMany: async () => side.businesses },
  },
}));

// El menú lateral (Sidebar es un componente de servidor: se llama como función y se pinta lo que devuelve).
const side = vi.hoisted(() => ({
  lang: "es" as "es" | "en",
  memberships: [] as { organizationId: string; role: string; organization: { name: string } }[],
  businesses: [] as { id: string; name: string; color: string; organizationId: string; clientOrg: { id: string; name: string } }[],
  /** Las cuentas que el menú le pasa al selector de la computadora. */
  accounts: null as unknown,
}));
vi.mock("next/link", () => ({ default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));
vi.mock("@/app/actions", () => ({ logout: async () => {} }));
vi.mock("@/lib/approvals", () => ({ loadApprovals: async () => [] }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ email: "yo@ejemplo.com", memberships: side.memberships }),
  myBusinessesWhere: async () => ({}),
  businessAccess: async () => null,
}));
vi.mock("@/lib/i18n-server", () => ({ getT: async () => ({ t: (es: string, en: string) => (side.lang === "es" ? es : en) }) }));
vi.mock("@/components/AppPreferences", () => ({ AppPreferences: () => null }));
vi.mock("@/components/MobileBizMenu", () => ({ MobileBizMenu: () => null }));
vi.mock("@/components/NavLinks", () => ({ NavLinks: () => null }));
vi.mock("@/components/nav/BizSwitcher", () => ({
  BizSwitcher: ({ accounts }: { accounts: unknown }) => {
    side.accounts = accounts;
    return null;
  },
}));

import { Sidebar } from "@/components/Sidebar";
import { resendInvite } from "@/lib/team";

const BUSINESSES: TeamBusiness[] = [
  { id: "b1", name: "Techos Pérez", color: "#0a7", clientOrg: { id: "o1", name: "Familia Pérez" } },
  { id: "b2", name: "Pisos Pérez", color: "#a07", clientOrg: { id: "o1", name: "Familia Pérez" } },
  { id: "b3", name: "Café Rivera", color: "#07a", clientOrg: { id: "o2", name: "Grupo Rivera" } },
];

const here = (node: React.ReactElement, lang: "es" | "en" = "es") => renderToStaticMarkup(<I18nProvider lang={lang}>{node}</I18nProvider>);
const fields = (businesses: TeamBusiness[], lang: "es" | "en" = "es", businessIds: string[] = []) =>
  here(<AccessFields businesses={businesses} allBusinesses={false} businessIds={businessIds} />, lang);
/** Lo que hay desde cada grupo de empresas hasta el siguiente: el encabezado y sus casillas. */
const groups = (html: string) => html.split('<div role="group" aria-label="').slice(1).filter((g) => g.includes("<label"));
const count = (html: string, text: string) => html.split(text).length - 1;

describe("campos de acceso agrupados por organización", () => {
  it("cada organización es un grupo con su nombre como encabezado visible, una sola vez, sobre las casillas de sus negocios", () => {
    const html = fields(BUSINESSES);
    const [first, second] = groups(html);
    expect(groups(html)).toHaveLength(2);
    expect(count(html, ">Familia Pérez<")).toBe(1);
    expect(count(html, ">Grupo Rivera<")).toBe(1);

    expect(first.startsWith("Familia Pérez")).toBe(true);
    expect(first.indexOf(">Familia Pérez<")).toBeLessThan(first.indexOf('value="b1"'));
    expect(first).toContain('value="b1"');
    expect(first).toContain('value="b2"');
    expect(first).not.toContain('value="b3"');

    expect(second.startsWith("Grupo Rivera")).toBe(true);
    expect(second.indexOf(">Grupo Rivera<")).toBeLessThan(second.indexOf('value="b3"'));
    expect(second).toContain('value="b3"');
    expect(second).not.toContain('value="b1"');
  });

  it("las casillas siguen siendo name=businessIds con el id del negocio, y las marcadas siguen marcadas", () => {
    const boxes = fields(BUSINESSES, "es", ["b3"]).match(/<input type="checkbox"[^>]*>/g) ?? [];
    expect(boxes.map((b) => [/name="businessIds"/.test(b), b.match(/value="([^"]*)"/)?.[1], /checked=""/.test(b)])).toEqual([
      [true, "b1", false],
      [true, "b2", false],
      [true, "b3", true],
    ]);
  });

  it("una organización que no tiene negocios en la lista no se pinta", () => {
    const html = fields(BUSINESSES.filter((b) => b.clientOrg.id === "o2"));
    expect(groups(html)).toHaveLength(1);
    expect(html).not.toContain("Familia Pérez");
    expect(html).toContain(">Grupo Rivera<");
  });

  it("sin negocios dice que todavía no hay empresas en esta cuenta, en español y en inglés", () => {
    const es = fields([]);
    expect(es).toContain("Todavía no hay empresas en esta cuenta.");
    expect(es).not.toContain("en esta organización");
    const en = fields([], "en");
    expect(en).toContain("There are no businesses in this account yet.");
    expect(en).not.toContain("this organization");
  });
});

describe("la cuenta va arriba, en el selector, y ya no en el pie del menú", () => {
  const sidebar = async (lang: "es" | "en") => {
    side.lang = lang;
    side.accounts = null;
    return renderToStaticMarkup(await Sidebar({}));
  };

  beforeEach(() => {
    side.memberships = [
      { organizationId: "a1", role: "admin", organization: { name: "Agencia Arévalo" } },
      { organizationId: "a2", role: "viewer", organization: { name: "Estudio Luna" } },
    ];
    side.businesses = [
      { id: "b1", name: "Techos Pérez", color: "#0a7", organizationId: "a1", clientOrg: { id: "o1", name: "Familia Pérez" } },
      { id: "b3", name: "Café Luna", color: "#07a", organizationId: "a2", clientOrg: { id: "o3", name: "Mis compañías" } },
      { id: "b2", name: "Pisos Pérez", color: "#a07", organizationId: "a1", clientOrg: { id: "o1", name: "Familia Pérez" } },
    ];
  });
  afterEach(() => {
    side.businesses = [];
  });

  it("el selector recibe cada cuenta, en el orden de la persona, con sus organizaciones y sus negocios debajo", async () => {
    await sidebar("es");
    expect(side.accounts).toEqual([
      {
        id: "a1",
        name: "Agencia Arévalo",
        groups: [
          {
            id: "o1",
            name: "Familia Pérez",
            businesses: [
              { id: "b1", name: "Techos Pérez", color: "#0a7" },
              { id: "b2", name: "Pisos Pérez", color: "#a07" },
            ],
          },
        ],
      },
      { id: "a2", name: "Estudio Luna", groups: [{ id: "o3", name: "Mis compañías", businesses: [{ id: "b3", name: "Café Luna", color: "#07a" }] }] },
    ]);
  });

  it("el pie ya no repite «Cuenta: …» (es) ni «Account: …» (en); el correo sigue ahí", async () => {
    const es = await sidebar("es");
    expect(es).not.toContain("Cuenta: ");
    expect(es).not.toContain("Agencia Arévalo");
    expect(es).toContain("yo@ejemplo.com");
    const en = await sidebar("en");
    expect(en).not.toContain("Account: ");
    expect(en).toContain("yo@ejemplo.com");
  });

  it("sin ninguna cuenta el selector no recibe ninguna", async () => {
    side.memberships = [];
    const html = await sidebar("es");
    expect(side.accounts).toEqual([]);
    expect(html).toContain("yo@ejemplo.com");
  });
});

describe("el correo de la invitación", () => {
  it("dice «en la cuenta «nombre».» en español y `in the account \"name\".` en inglés", async () => {
    stored.orgName = "Agencia Arévalo";
    mail.sent.length = 0;
    await resendInvite("acct1", "inv1", { name: "Rosa", email: "rosa@ejemplo.com" }, "es");
    await resendInvite("acct1", "inv1", { name: "Rosa", email: "rosa@ejemplo.com" }, "en");
    const [es, en] = mail.sent.map((m) => m.intro.join(" "));
    expect(es).toContain("en la cuenta «Agencia Arévalo».");
    expect(es).not.toContain("organización");
    expect(en).toContain('in the account "Agencia Arévalo".');
    expect(en).not.toContain("organization");
  });
});
