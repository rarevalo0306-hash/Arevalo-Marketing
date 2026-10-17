// La pantalla «Organizaciones»: las organizaciones de la cuenta con sus negocios, mover un negocio, renombrar, borrar las
// vacías y crear una nueva. Se pinta con `renderToStaticMarkup` (sin DOM) y el CSS Module simulado, como
// tests/agent-team-settings-ui.test.tsx; lo que pasa al tocar un botón lo prueban las acciones (tests/client-orgs-actions.test.ts).
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ClientOrgs, deleteQuestion } from "@/components/orgs/ClientOrgs";
import { CONTACT_MAX, hourLabel, PHONE_MAX, sendNowQuestion, testQuestion } from "@/components/orgs/ReportPanel";
import { I18nProvider } from "@/components/I18n";
import { readReportSettings, type ReportSettings } from "@/lib/client-org-report";
import type { LastSend } from "@/lib/client-orgs-store";
import { translator } from "@/lib/i18n";

vi.mock("@/components/orgs/Orgs.module.css", () => ({ default: new Proxy({}, { get: (_, k) => String(k) }) }));
// Las acciones abren la base de datos y la sesión solo cuando alguien toca un botón.
vi.mock("@/app/actions-client-orgs", () => ({
  createClientOrgAction: vi.fn(),
  renameClientOrgAction: vi.fn(),
  deleteClientOrgAction: vi.fn(),
  moveBusinessAction: vi.fn(),
  saveClientOrgReportAction: vi.fn(),
  sendClientOrgTestAction: vi.fn(),
  sendClientOrgNowAction: vi.fn(),
}));

type Org = { id: string; name: string; businesses: { id: string; name: string; color: string }[]; report: ReportSettings; last: LastSend | null };
const OFF: ReportSettings = { contactName: "", reportEmail: "", phone: "", reportLang: "es", reportOn: false, reportDay: 1, reportHour: 8, timezone: "" };
const ON: ReportSettings = {
  contactName: "Ana López",
  reportEmail: "juan@x.com",
  phone: "+1 305 555 0100",
  reportLang: "en",
  reportOn: true,
  reportDay: 1,
  reportHour: 8,
  timezone: "America/Managua",
};
const SENT: LastSend = { at: "2026-10-12T14:00:00.000Z", trigger: "cron", state: "sent", to: ["juan@x.com"], error: "" };
const ORGS: Org[] = [
  {
    id: "c1",
    name: "Juan Pérez",
    businesses: [
      { id: "b1", name: "Techos Pérez", color: "#0f766e" },
      { id: "b2", name: "Pinturas Juan", color: "#c2410c" },
    ],
    report: ON,
    last: SENT,
  },
  { id: "c2", name: "Compañía vacía", businesses: [], report: OFF, last: null },
];
/** The first organization (it has businesses) with other report settings / last send. */
const withReport = (report: Partial<ReportSettings>, last: LastSend | null = SENT): Org[] => [{ ...ORGS[0], report: { ...ON, ...report }, last }, ORGS[1]];
const withLast = (last: Partial<LastSend> | null): Org[] => withReport({}, last && { ...SENT, ...last });

const render = (orgs: Org[] = ORGS, lang: "es" | "en" = "es", accountName = "Agencia Arévalo", appTz = "America/New_York") =>
  renderToStaticMarkup(
    <I18nProvider lang={lang}>
      <ClientOrgs accountId="acc1" accountName={accountName} orgs={orgs} appTz={appTz} />
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
    // (The report panel has selects of its own.)
    const selects = [...c1.matchAll(/<select[\s\S]*?<\/select>/g)].map((m) => m[0]).filter((x) => x.includes('name="clientOrgId"'));
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
    expect(html).not.toContain('name="clientOrgId"');
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
    expect(card(html, "c1")).not.toContain("Cambiar el nombre de");
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
    const html = render([{ id: "c9", name: "<script>x</script>", businesses: [{ id: "b9", name: "<img src=x onerror=alert(1)>", color: "#000000" }], report: OFF, last: null }, ORGS[1]]);
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
    expect(html).not.toContain("«"); // screen-reader suffixes included
    expect(render([], "en")).toContain("There are no organizations yet.");
  });
});

// ---------- El reporte semanal de cada organización ----------

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The `<input>`/`<select>` tag with that name inside a card. */
const field = (html: string, name: string) => html.match(new RegExp(`<(?:input|select)[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
const select = (html: string, name: string) => html.match(new RegExp(`<select[^>]*name="${name}"[\\s\\S]*?</select>`))?.[0] ?? "";
const optionValues = (sel: string) => [...sel.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
const optionTexts = (sel: string) => [...sel.matchAll(/<option [^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);
const selectedValues = (sel: string) => [...sel.matchAll(/<option value="([^"]*)"[^>]*selected=""/g)].map((m) => m[1]);
const button = (html: string, text: string) => html.match(new RegExp(`<button[^>]*>${esc(text)}</button>`))?.[0] ?? "";
const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const NAMES = ["contactName", "reportEmail", "phone", "reportLang", "timezone", "reportOn", "reportDay", "reportHour"];

describe("the weekly report panel: what it says without opening it", () => {
  it("says when the report goes out and to whom, in 12-hour time", () => {
    const html = render();
    expect(card(html, "c1")).toContain("Reporte: lunes 8:00 a. m. a juan@x.com");
    // The words follow the app's language, not the report's (this organization's report is in English).
    expect(card(render(withReport({ reportDay: 0, reportHour: 0 })), "c1")).toContain("Reporte: domingo 12:00 a. m. a juan@x.com");
    expect(card(render(withReport({ reportDay: 6, reportHour: 20, reportEmail: "juan@x.com, ana@x.com" })), "c1")).toContain("Reporte: sábado 8:00 p. m. a juan@x.com, ana@x.com");
    expect(card(render(withReport({ reportHour: 12 })), "c1")).toContain("Reporte: lunes 12:00 p. m. a juan@x.com");
  });

  it("says the report is off when it is off, and never promises an address it doesn't have", () => {
    const html = render();
    expect(card(html, "c2")).toContain("Reporte apagado");
    expect(card(html, "c2")).not.toContain("Reporte: ");
    expect(card(html, "c1")).not.toContain("Reporte apagado");
    // Off with an email saved is still off.
    expect(card(render(withReport({ reportOn: false })), "c1")).toContain("Reporte apagado");
    // On with no email: no dangling «a».
    const noEmail = card(render(withReport({ reportEmail: "" })), "c1");
    expect(noEmail).toContain("Reporte: lunes 8:00 a. m., sin email");
    expect(noEmail).not.toMatch(/8:00 a\. m\. a /);
  });

  it("writes the hours as 12-hour times in both languages", () => {
    expect([0, 1, 8, 11, 12, 13, 23].map((h) => hourLabel(h, "es"))).toEqual(["12:00 a. m.", "1:00 a. m.", "8:00 a. m.", "11:00 a. m.", "12:00 p. m.", "1:00 p. m.", "11:00 p. m."]);
    expect([0, 8, 12, 23].map((h) => hourLabel(h, "en"))).toEqual(["12:00 AM", "8:00 AM", "12:00 PM", "11:00 PM"]);
  });

  it("has a «Reporte semanal» button, closed at first, that points at the panel", () => {
    const c1 = card(render(), "c1");
    const toggle = c1.match(/<button[^>]*>Reporte semanal<\/button>/)?.[0] ?? "";
    expect(toggle).toContain('aria-expanded="false"');
    expect(toggle).toContain('type="button"');
    const id = attr(toggle, "aria-controls");
    expect(id).not.toBe("");
    expect(c1).toMatch(new RegExp(`<div[^>]*id="${esc(id)}"[^>]*hidden=""|<div[^>]*hidden=""[^>]*id="${esc(id)}"`));
    // The group is named after the organization, so the buttons inside need no suffix to be told apart.
    expect(c1).toMatch(/role="group"[^>]*aria-label="Reporte semanal de «Juan Pérez»"|aria-label="Reporte semanal de «Juan Pérez»"[^>]*role="group"/);
    // It lives below the businesses.
    expect(c1.indexOf("Pinturas Juan")).toBeLessThan(c1.indexOf("Reporte semanal"));
  });

  it("has a status line for the result of saving or sending, inside the card", () => {
    // The one under the actions (renaming, deleting) and the report's own, which is where «Guardar» and the send buttons report.
    const c2 = card(render(), "c2");
    expect(count(c2, 'role="status"')).toBe(2);
    expect(c2).toMatch(/<div role="status" class="reportStatus"><\/div><\/div><\/div><\/section>$/);
  });
});

describe("the weekly report panel: the form", () => {
  it("has every field the save action reads, each with a label", () => {
    for (const id of ["c1", "c2"]) {
      const c = card(render(), id);
      for (const name of NAMES) {
        const tag = field(c, name);
        expect(tag, `${id}: ${name}`).not.toBe("");
        if (name === "reportOn") continue; // the switch sits inside its own label
        const inputId = attr(tag, "id");
        expect(inputId, `${id}: ${name} id`).not.toBe("");
        expect(c, `${id}: label for ${name}`).toMatch(new RegExp(`<label[^>]*for="${esc(inputId)}"`));
      }
      expect(c, `${id}: the switch`).toMatch(/<label class="check"><input [^>]*name="reportOn"/);
    }
    const c1 = card(render(), "c1");
    for (const text of ["Contacto", "Emails para el reporte (hasta 3, separados por comas)", "Teléfono", "Idioma del reporte", "Zona horaria", "Mandar el reporte cada semana", "Día", "Hora"]) {
      expect(c1, text).toContain(text);
    }
    expect(button(c1, "Guardar")).toContain('type="submit"');
  });

  it("shows the saved values: text typed in, options selected, the switch checked", () => {
    const c1 = card(render(), "c1");
    expect(field(c1, "contactName")).toContain('value="Ana López"');
    expect(field(c1, "contactName")).toContain('maxLength="120"');
    expect(field(c1, "reportEmail")).toContain('value="juan@x.com"');
    expect(field(c1, "phone")).toContain('value="+1 305 555 0100"');
    expect(field(c1, "phone")).toContain('maxLength="40"');
    expect(field(c1, "reportOn")).toContain('type="checkbox"');
    expect(field(c1, "reportOn")).toContain('checked=""');
    expect(selectedValues(select(c1, "reportLang"))).toEqual(["en"]);
    expect(selectedValues(select(c1, "timezone"))).toEqual(["America/Managua"]);
    expect(selectedValues(select(c1, "reportDay"))).toEqual(["1"]);
    expect(selectedValues(select(c1, "reportHour"))).toEqual(["8"]);

    const c2 = card(render(), "c2");
    expect(field(c2, "contactName")).not.toContain('value="Ana');
    expect(field(c2, "reportOn")).not.toContain("checked");
    expect(selectedValues(select(c2, "reportLang"))).toEqual(["es"]);
    expect(selectedValues(select(c2, "timezone"))).toEqual([""]);
    expect(selectedValues(select(c2, "reportDay"))).toEqual(["1"]);
    expect(selectedValues(select(c2, "reportHour"))).toEqual(["8"]);
  });

  it("offers the days domingo to sábado and the 24 hours as 12-hour times", () => {
    const c1 = card(render(), "c1");
    expect(optionValues(select(c1, "reportDay"))).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    expect(optionTexts(select(c1, "reportDay"))).toEqual(["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]);
    expect(optionValues(select(c1, "reportHour"))).toEqual(Array.from({ length: 24 }, (_, h) => String(h)));
    expect(optionTexts(select(c1, "reportHour")).slice(0, 3)).toEqual(["12:00 a. m.", "1:00 a. m.", "2:00 a. m."]);
    expect(optionTexts(select(c1, "reportHour")).slice(11, 14)).toEqual(["11:00 a. m.", "12:00 p. m.", "1:00 p. m."]);
    expect(optionTexts(select(c1, "reportHour")).at(-1)).toBe("11:00 p. m.");
    expect(optionTexts(select(c1, "reportLang"))).toEqual(["Español", "English"]);
  });

  it("offers «La de la app» plus the common zones, and keeps a saved zone that isn't one of them", () => {
    const zones = select(card(render(), "c1"), "timezone");
    expect(optionValues(zones)[0]).toBe("");
    expect(optionTexts(zones)[0]).toMatch(/^La de la app \(.+\)$/); // it says which zone the app has
    expect(optionValues(zones)).toEqual(expect.arrayContaining(["America/Managua", "America/New_York", "America/Costa_Rica"]));
    expect(optionTexts(zones)).toContain("Nicaragua (Managua)");
    const odd = select(card(render(withReport({ timezone: "Asia/Tokyo" })), "c1"), "timezone");
    expect(selectedValues(odd)).toEqual(["Asia/Tokyo"]);
    expect(count(odd, 'value="Asia/Tokyo"')).toBe(1);
    // Knowing the app's zone, «La de la app» says which one it is.
    expect(optionTexts(select(card(render(ORGS, "es", "Agencia", "America/Managua"), "c1"), "timezone"))[0]).toBe("La de la app (Nicaragua (Managua))");
  });

  it("doesn't let the browser fill the owner's own details into a client's fields", () => {
    const c1 = card(render(), "c1");
    for (const name of ["contactName", "reportEmail", "phone"]) expect(field(c1, name), name).toContain('autoComplete="off"');
    expect(field(c1, "reportEmail")).toContain('inputMode="email"');
    expect(field(c1, "phone")).toContain('inputMode="tel"');
  });

  it("shows what was typed as text: a contact named <b>x</b> is escaped", () => {
    const html = render(withReport({ contactName: "<b>x</b>", reportEmail: "<i>@x.com", phone: "<u>1</u>" }));
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<i>@x.com");
    expect(html).not.toContain("<u>1</u>");
    expect(html).toContain('value="&lt;b&gt;x&lt;/b&gt;"');
    expect(html).toContain("a &lt;i&gt;@x.com"); // the line under the title
  });
});

describe("the weekly report panel: warnings and buttons", () => {
  it("warns that an email is missing when the report is on without one, and can't send now", () => {
    const c1 = card(render(withReport({ reportEmail: "" })), "c1");
    expect(c1).toContain("Falta un email: sin él no se manda.");
    expect(button(c1, "Mandar ahora")).toContain('disabled=""');
  });

  it("says nothing about the email when there is one, or when the report is off", () => {
    const withEmail = card(render(), "c1");
    expect(withEmail).not.toContain("Falta un email");
    expect(button(withEmail, "Mandar ahora")).not.toContain("disabled");
    const off = card(render(withReport({ reportOn: false, reportEmail: "" })), "c1");
    expect(off).not.toContain("Falta un email");
    expect(button(off, "Mandar ahora")).toContain('disabled=""'); // still nowhere to send it
  });

  it("warns that without businesses there is no report, and can't send now even with an email", () => {
    const empty = card(render([{ ...ORGS[1], report: ON }]), "c2");
    expect(empty).toContain("Sin negocios no hay reporte.");
    expect(button(empty, "Mandar ahora")).toContain('disabled=""');
    expect(card(render(), "c1")).not.toContain("Sin negocios no hay reporte.");
  });

  it("links the warnings to the switch for screen readers", () => {
    const c = card(render([{ ...ORGS[1], report: { ...ON, reportEmail: "" } }]), "c2");
    const described = attr(field(c, "reportOn"), "aria-describedby").split(" ");
    expect(described).toHaveLength(2);
    for (const id of described) expect(c).toMatch(new RegExp(`id="${esc(id)}"`));
    expect(attr(field(card(render(), "c1"), "reportOn"), "aria-describedby")).toBe("");
  });

  it("offers «Mandarme una prueba» always (it goes to the person's own email) and «Mandar ahora»", () => {
    const c2 = card(render(), "c2");
    expect(button(c2, "Mandarme una prueba")).toContain('type="button"');
    expect(button(c2, "Mandarme una prueba")).not.toContain("disabled");
    expect(button(c2, "Mandar ahora")).toContain('type="button"');
    expect(button(card(render(), "c1"), "Mandarme una prueba")).not.toContain("disabled");
  });
});

describe("the weekly report panel: the last send", () => {
  it("says it hasn't been sent yet when nothing was tried", () => {
    const c1 = card(render(withLast(null)), "c1");
    expect(c1).toContain("Todavía no se ha mandado.");
    expect(c1).not.toContain("Último envío");
  });

  it("says when it went out and to whom", () => {
    const line = card(render(), "c1").match(/Último envío: [^<]*/)?.[0] ?? "";
    expect(line).toMatch(/^Último envío: .*2026.* a juan@x\.com · salió$/);
    expect(line).not.toContain("no salió");
    expect(line).not.toContain("(prueba)");
    expect(line).not.toContain("(enviado ahora)");
  });

  it("says it didn't go out, with the reason", () => {
    const c1 = card(render(withLast({ state: "error", error: "Brevo dijo 401", trigger: "cron" })), "c1");
    expect(c1).toContain("no salió: Brevo dijo 401");
    expect(c1).not.toContain("· salió");
    expect(c1).not.toContain("Todavía no se ha mandado.");
    // Without a reason or addressees there is nothing dangling.
    const bare = card(render(withLast({ state: "error", error: "", to: [] })), "c1").match(/Último envío: [^<]*/)?.[0] ?? "";
    expect(bare).toMatch(/ · no salió$/);
    expect(bare).not.toContain(" a ");
  });

  it("tells a test and a send-now from the automatic one", () => {
    expect(card(render(withLast({ trigger: "test" })), "c1")).toMatch(/Último envío: [^<]*\(prueba\)[^<]* · salió/);
    expect(card(render(withLast({ trigger: "manual" })), "c1")).toMatch(/Último envío: [^<]*\(enviado ahora\)[^<]* · salió/);
    expect(card(render(withLast({ trigger: "cron" })), "c1")).not.toMatch(/\((prueba|enviado ahora)\)/);
  });

  it("reads «enviando…» while it is going out, and «no salió» when the process that was sending it died", () => {
    const fresh = card(render(withLast({ state: "sending", to: [], at: minutesAgo(29) })), "c1");
    expect(fresh).toContain("enviando…");
    expect(fresh).not.toContain("no salió");
    const dead = card(render(withLast({ state: "sending", to: [], at: minutesAgo(31) })), "c1");
    expect(dead).toContain("no salió");
    expect(dead).not.toContain("enviando…");
  });

  it("shows the moment in the organization's zone, or the app's when it has none", () => {
    const at = "2026-10-12T14:35:00.000Z";
    const line = (timezone: string, appTz = "America/New_York") => card(render(withReport({ timezone }, { ...SENT, at }), "es", "Agencia", appTz), "c1").match(/Último envío: [^<]*/)?.[0] ?? "";
    expect(line("America/Managua")).toContain("8:35"); // UTC-6
    expect(line("", "America/New_York")).toContain("10:35"); // UTC-4 in October
    expect(line("", "Asia/Tokyo")).toContain("11:35"); // UTC+9
    expect(line("America/Managua", "Asia/Tokyo")).toContain("8:35");
    // A zone that doesn't exist is not a reason to break the page.
    expect(line("Not/AZone", "Asia/Tokyo")).toContain("11:35");
    expect(line("America/Managua")).toContain("12 oct 2026");
  });

  it("shows the reason and the addressees as text", () => {
    const html = render(withLast({ state: "error", error: "<img src=x>", to: ["<u>a</u>@x.com"] }));
    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("<u>a</u>");
    expect(html).toContain("no salió: &lt;img src=x&gt;");
    expect(html).toContain("a &lt;u&gt;a&lt;/u&gt;@x.com");
  });
});

describe("the weekly report panel: in English", () => {
  it("says everything in English", () => {
    const html = render(ORGS, "en");
    const c1 = card(html, "c1");
    expect(c1).toContain("Weekly report");
    expect(c1).toContain("Report: Monday 8:00 AM to juan@x.com");
    expect(card(html, "c2")).toContain("Report off");
    expect(card(html, "c2")).toContain("Not sent yet.");
    expect(c1).toMatch(/Last send: [^<]*2026[^<]* to juan@x\.com · sent</);
    for (const text of ["Contact", "Report emails (up to 3, separated by commas)", "Phone", "Report language", "Time zone", "The app&#x27;s", "Send the report every week", "Day", "Hour", "Save", "Send me a test", "Send now"]) {
      expect(c1, text).toContain(text);
    }
    expect(optionTexts(select(c1, "reportDay"))).toEqual(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
    expect(optionTexts(select(c1, "reportHour"))[0]).toBe("12:00 AM");
    expect(optionTexts(select(c1, "reportHour"))[13]).toBe("1:00 PM");
    expect(c1).toContain("aria-label=\"Weekly report for &quot;Juan Pérez&quot;\"");
    for (const spanish of ["Reporte", "Mandar", "Guardar", "Todavía", "Último", "Contacto", "Teléfono", "«"]) expect(html, spanish).not.toContain(spanish);
  });

  it("says in English that an email is missing, that there are no businesses, and that it didn't go out", () => {
    const noEmail = card(render(withReport({ reportEmail: "" }, { ...SENT, state: "error", error: "Brevo dijo 401" }), "en"), "c1");
    expect(noEmail).toContain("An email is missing: without one it won&#x27;t be sent.");
    expect(noEmail).toContain("Report: Monday 8:00 AM, no email");
    expect(noEmail).toContain("· didn&#x27;t go out: Brevo dijo 401");
    expect(card(render([{ ...ORGS[1], report: ON }], "en"), "c2")).toContain("No businesses, no report.");
    expect(card(render(withLast({ trigger: "test" }), "en"), "c1")).toContain("(test)");
    expect(card(render(withLast({ trigger: "manual" }), "en"), "c1")).toContain("(sent now)");
    expect(card(render(withLast({ state: "sending", to: [], at: minutesAgo(5) }), "en"), "c1")).toContain("sending…");
  });
});

describe("the weekly report panel: the limits of its fields", () => {
  it("are the ones the server accepts (a longer text would be refused only after sending it)", () => {
    const raw = { contactName: "", reportEmail: "", phone: "", reportLang: "es", reportOn: "", reportDay: "1", reportHour: "8", timezone: "" };
    expect(() => readReportSettings({ ...raw, contactName: "x".repeat(CONTACT_MAX) })).not.toThrow();
    expect(() => readReportSettings({ ...raw, contactName: "x".repeat(CONTACT_MAX + 1) })).toThrow();
    expect(() => readReportSettings({ ...raw, phone: "1".repeat(PHONE_MAX) })).not.toThrow();
    expect(() => readReportSettings({ ...raw, phone: "1".repeat(PHONE_MAX + 1) })).toThrow();
    const c1 = card(render(), "c1");
    expect(field(c1, "contactName")).toContain(`maxLength="${CONTACT_MAX}"`);
    expect(field(c1, "phone")).toContain(`maxLength="${PHONE_MAX}"`);
  });
});

describe("the weekly report panel: what it may import", () => {
  it("takes only types from the server-only report and store modules (a value would drag the database into the browser)", () => {
    const source = readFileSync("src/components/orgs/ReportPanel.tsx", "utf8");
    expect(source.startsWith('"use client";')).toBe(true);
    const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gm)].map((m) => ({ type: Boolean(m[1]), from: m[2] }));
    expect(imports.length).toBeGreaterThan(3);
    for (const { type, from } of imports) {
      if (/client-org-report$|client-orgs-store$|seo\/alerts$|\/db$/.test(from)) expect(type, from).toBe(true);
    }
  });
});

describe("confirm before deleting", () => {
  it("asks with the organization's name, in both languages", () => {
    expect(deleteQuestion("Compañía vacía", translator("es"))).toBe("¿Borrar «Compañía vacía»? No tiene negocios.");
    expect(deleteQuestion("Empty co", translator("en"))).toBe('Delete "Empty co"? It has no businesses.');
  });

  it("asks before sending a test, and before sending now (naming who gets it), in both languages", () => {
    expect(testQuestion(translator("es"))).toBe("¿Te mandamos una prueba del reporte de la semana pasada a tu email?");
    expect(testQuestion(translator("en"))).toBe("Send a test of last week's report to your email?");
    expect(sendNowQuestion("juan@x.com, ana@x.com", translator("es"))).toBe("¿Mandamos ahora el reporte de la semana pasada a juan@x.com, ana@x.com?");
    expect(sendNowQuestion("juan@x.com", translator("en"))).toBe("Send last week's report to juan@x.com now?");
  });
});

describe("the stylesheet", () => {
  it("defines every class the screen asks the CSS Module for (the mock above would hide a missing one)", () => {
    const css = readFileSync("src/components/orgs/Orgs.module.css", "utf8");
    const defined = new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
    for (const file of ["src/components/orgs/ClientOrgs.tsx", "src/components/orgs/ReportPanel.tsx", "src/app/organizaciones/page.tsx"]) {
      const used = [...readFileSync(file, "utf8").matchAll(/\bs\.([A-Za-z]\w*)/g)].map((m) => m[1]);
      expect(used.length, file).toBeGreaterThan(0);
      for (const name of used) expect(defined.has(name), `${file}: s.${name}`).toBe(true);
    }
  });
});
