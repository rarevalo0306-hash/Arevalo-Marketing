import { describe, expect, it, vi } from "vitest";
import type { GapDomain } from "@/lib/seo/backlinks";
import {
  buildOutreach,
  businessCity,
  cleanEmail,
  findContact,
  finishOutreachEmail,
  mergeOutreach,
  outreachBusiness,
  outreachPrompt,
  outreachSteps,
  outreachType,
  pickContactEmail,
  pickTopGap,
  readOutreachStore,
  scanContactHtml,
  type FetchHtml,
  type OutreachDraft,
} from "@/lib/seo/outreach";
import fameseg from "./fixtures/fameseg.json";

const famesegRow = {
  name: fameseg.business.name,
  website: fameseg.business.website,
  phone: "+505 2222 3333",
  aiProfile: "",
  aiText: "",
  brandVoice: "",
  seoLanguage: "es",
  seoLocations: fameseg.business.seoLocations,
  seoLocationCode: fameseg.business.seoLocationCode,
  seoLocationName: fameseg.business.seoLocationName,
  seoMapPlace: null,
  study: fameseg.business.study,
};
const business = outreachBusiness(famesegRow);

describe("outreachType (según la pista del sitio)", () => {
  it("directorios, gobierno, asociaciones y proveedores: registrarse (sin correo)", () => {
    for (const h of ["directory", "public", "association", "supplier"] as const) expect(outreachType(h)).toBe("signup");
  });
  it("noticias, blogs, foros y otros: correo", () => {
    for (const h of ["news", "blog", "forum", "other"] as const) expect(outreachType(h)).toBe("email");
  });
  it("redes sociales: perfil", () => {
    expect(outreachType("social")).toBe("profile");
  });
});

describe("scanContactHtml", () => {
  const html = `<!doctype html><html lang="es"><head><title>Diario Ejemplo | Noticias de Managua</title>
    <meta name="description" content="Noticias locales de Managua y Nicaragua."></head><body>
    <nav><a href="/">Inicio</a> <a href="/contactenos">Contáctenos</a> <a href="/registro-empresas">Registra tu empresa</a>
    <a href="https://facebook.com/diario">Facebook</a></nav>
    <p>Escríbanos a <a href="mailto:Redaccion%40DiarioEjemplo.com.ni?subject=Hola">la redacción</a>.</p>
    <p>Ventas: ventas&#64;diarioejemplo.com.ni</p>
    <p>Soporte: soporte [arroba] diarioejemplo [punto] com</p>
    <p>Correo de ejemplo: nombre@example.com · logo@2x.png</p>
    <img src="logo@2x.png"><script>var x = "oculto@diarioejemplo.com.ni";</script>
    <a href="mailto:noreply@diarioejemplo.com.ni">no</a>
    </body></html>`;
  const scan = scanContactHtml(html, "https://diarioejemplo.com.ni/");

  it("saca los correos de mailto: y los escritos tal cual, sin adivinar los disfrazados", () => {
    expect(scan.emails).toContain("redaccion@diarioejemplo.com.ni");
    expect(scan.emails).toContain("ventas@diarioejemplo.com.ni");
    // "soporte [arroba] diarioejemplo [punto] com" no se arma; tampoco ejemplos, imágenes, scripts ni noreply.
    expect(scan.emails.some((e) => e.startsWith("soporte"))).toBe(false);
    expect(scan.emails).not.toContain("nombre@example.com");
    expect(scan.emails.some((e) => e.includes("png"))).toBe(false);
    expect(scan.emails).not.toContain("oculto@diarioejemplo.com.ni");
    expect(scan.emails).not.toContain("noreply@diarioejemplo.com.ni");
  });

  it("encuentra la página de contacto y la de registro del mismo sitio, el idioma, título y descripción", () => {
    expect(scan.contactUrl).toBe("https://diarioejemplo.com.ni/contactenos");
    expect(scan.signupUrl).toBe("https://diarioejemplo.com.ni/registro-empresas");
    expect(scan.lang).toBe("es");
    expect(scan.title).toBe("Diario Ejemplo | Noticias de Managua");
    expect(scan.description).toBe("Noticias locales de Managua y Nicaragua.");
  });

  it("una página sin correos no inventa ninguno", () => {
    const s = scanContactHtml(`<html lang="en"><body><p>Email us: info (at) site (dot) com</p><form action="/send"></form></body></html>`, "https://site.com/contact");
    expect(s.emails).toEqual([]);
    expect(s.lang).toBe("en");
  });

  it("cleanEmail", () => {
    expect(cleanEmail("mailto:Info%40Sitio.com?subject=x")).toBe("info@sitio.com");
    expect(cleanEmail("info [at] sitio.com")).toBeNull();
    expect(cleanEmail("no-reply@sitio.com")).toBeNull();
  });

  it("prefiere el correo del mismo sitio y el de redacción para noticias", () => {
    expect(pickContactEmail(["gerente@gmail.com", "info@diario.com", "redaccion@diario.com"], "diario.com", "news")).toBe("redaccion@diario.com");
    expect(pickContactEmail(["x@gmail.com", "contacto@guia.com"], "guia.com", "directory")).toBe("contacto@guia.com");
  });
});

describe("findContact", () => {
  it("máximo 3 visitas, solo hasta encontrar un correo, siguiendo el enlace de contacto de la portada", async () => {
    const calls: string[] = [];
    const fetchHtml: FetchHtml = async (url, timeoutMs) => {
      calls.push(url);
      expect(timeoutMs).toBe(5000);
      if (url === "https://blog.example.org/") return { html: `<html lang="en"><a href="/about-us/contact">Contact</a></html>`, url };
      if (url === "https://blog.example.org/about-us/contact") return { html: `<a href="mailto:hello@blog.example.org">mail</a>`, url };
      throw new Error("404");
    };
    const c = await findContact("blog.example.org", "blog", fetchHtml);
    expect(calls).toEqual(["https://blog.example.org/", "https://blog.example.org/about-us/contact"]);
    expect(c.email).toBe("hello@blog.example.org");
    expect(c.contactUrl).toBe("https://blog.example.org/about-us/contact");
    expect(c.lang).toBe("en");
  });

  it("si no hay nada, prueba /contacto y /contact y se detiene en 3 visitas sin inventar el correo", async () => {
    const calls: string[] = [];
    const fetchHtml: FetchHtml = async (url) => {
      calls.push(url);
      if (url.endsWith("/")) return { html: "<p>Hola</p>", url };
      throw new Error("404");
    };
    const c = await findContact("noticias.com.ni", "news", fetchHtml);
    expect(calls).toEqual(["https://noticias.com.ni/", "https://noticias.com.ni/contacto", "https://noticias.com.ni/contact"]);
    expect(c.email).toBeUndefined();
    expect(c.fetched).toBe(3);
  });
});

describe("datos del negocio y el correo", () => {
  it("la ciudad sale del estudio (Managua) y los servicios también", () => {
    expect(business.city).toBe("Managua");
    expect(business.services).toContain("Cortinas de acero");
    expect(businessCity({ ...famesegRow, study: null, seoLocations: [{ code: 1, name: "Miami,Florida,United States", type: "City" }] })).toBe("Miami");
    expect(businessCity({ ...famesegRow, study: null, seoMapPlace: { title: "Fameseg", lat: 12.1, lng: -86.2, address: "Km 7 Carretera Norte, Managua, Nicaragua" } })).toBe("Managua");
  });

  it("el prompt lleva la ciudad, los servicios, el idioma y las reglas de no pagar ni inventar", () => {
    const { system, user } = outreachPrompt(business, { domain: "laprensani.com", hint: "news", linksTo: ["competidor.com"], lang: "es", title: "La Prensa" });
    expect(system).toContain("Managua");
    expect(system).toContain("Cortinas de acero");
    expect(system).toContain("Fameseg");
    expect(system).toContain("Write in Spanish");
    expect(system).toMatch(/Never offer money/);
    expect(user).toContain("laprensani.com");
    expect(user).toContain("news site");
    expect(user).not.toContain("competidor.com");
    expect(outreachPrompt(business, { domain: "blog.com", hint: "blog", linksTo: [], lang: "en" }).system).toContain("US English");
  });

  it("finishOutreachEmail limpia markdown, asunto repetido, marcadores y despedida, y pone la firma", () => {
    const r = finishOutreachEmail(
      {
        subject: "Asunto: **Ideas de seguridad para comercios de Managua**",
        body: "Asunto: Otra cosa\n\nHola, equipo de La Prensa:\n\nSomos **Fameseg**, en Managua. Fabricamos cortinas metálicas y portones para comercios. [Nombre] Podríamos compartir consejos prácticos para sus lectores.\n\n¿Les interesaría?\n\nSaludos cordiales,\nFameseg",
      },
      business,
      "es",
    );
    expect(r.subject).toBe("Ideas de seguridad para comercios de Managua");
    expect(r.body.startsWith("Hola, equipo de La Prensa:")).toBe(true);
    expect(r.body).not.toContain("**");
    expect(r.body).not.toContain("[Nombre]");
    expect(r.body).not.toContain("Asunto");
    expect(r.body).not.toContain("Saludos cordiales");
    expect(r.body.endsWith("Saludos,\nFameseg\n+505 2222 3333\nhttps://fameseg.com")).toBe(true);
  });

  it("finishOutreachEmail rechaza un correo vacío", () => {
    expect(() => finishOutreachEmail({ subject: "x", body: "Hola" }, business, "es")).toThrow();
  });
});

describe("buildOutreach", () => {
  const gap = (domain: string, hint: GapDomain["hint"]): GapDomain => ({ domain, hint, linksTo: ["otro.com"], rank: 100, backlinks: 3, spamScore: 1 });

  it("noticias: busca el correo, usa el idioma del sitio y escribe el correo", async () => {
    const write = vi.fn(async () => ({ subject: "Hello", body: "Body" }));
    const fetchHtml: FetchHtml = async (url) => ({ html: `<html lang="en"><a href="mailto:news@paper.com">x</a></html>`, url });
    const d = await buildOutreach(business, gap("paper.com", "news"), { fetchHtml, write, now: new Date("2026-10-06T10:00:00Z") });
    expect(d.type).toBe("email");
    expect(d.lang).toBe("en");
    expect(d.contactEmail).toBe("news@paper.com");
    expect(d.subject).toBe("Hello");
    expect(write).toHaveBeenCalledWith(business, expect.objectContaining({ domain: "paper.com", lang: "en" }));
    expect(d.steps.some((s) => s.es.includes("news@paper.com"))).toBe(true);
  });

  it("directorio: sin IA, con pasos y dónde registrarse", async () => {
    const write = vi.fn();
    const fetchHtml: FetchHtml = async (url) => ({ html: `<a href="/agregar-empresa">Agregar empresa</a>`, url });
    const d = await buildOutreach(business, gap("guianica.com", "directory"), { fetchHtml, write: write as never });
    expect(write).not.toHaveBeenCalled();
    expect(d.type).toBe("signup");
    expect(d.signupUrl).toBe("https://guianica.com/agregar-empresa");
    expect(d.body).toBeUndefined();
    expect(d.steps[0].es).toContain("https://guianica.com/agregar-empresa");
  });

  it("red social: no visita la página, solo pasos", async () => {
    const fetchHtml = vi.fn();
    const d = await buildOutreach(business, gap("facebook.com", "social"), { fetchHtml: fetchHtml as never });
    expect(fetchHtml).not.toHaveBeenCalled();
    expect(d.type).toBe("profile");
    expect(d.steps.length).toBeGreaterThan(2);
    expect(outreachSteps("social", { domain: "facebook.com", business }).some((s) => s.es.includes("Managua"))).toBe(true);
  });
});

describe("guardar y leer", () => {
  const draft = (domain: string, createdAt: string): OutreachDraft => ({ domain, hint: "news", type: "email", lang: "es", steps: [{ es: "a", en: "b" }], subject: "s", body: "b", createdAt });

  it("lee lo guardado sin confiar en la forma y descarta correos inválidos", () => {
    const store = readOutreachStore({ drafts: { "a.com": { ...draft("a.com", "2026-10-01"), contactEmail: "info [at] a.com" }, bad: { domain: "", hint: "news" }, "b.com": { domain: "b.com", hint: "nope" } } });
    expect(Object.keys(store.drafts)).toEqual(["a.com"]);
    expect(store.drafts["a.com"].contactEmail).toBeUndefined();
    expect(readOutreachStore(null).drafts).toEqual({});
  });

  it("mergeOutreach cambia en su lugar y deja solo los más nuevos; pickTopGap salta los preparados", () => {
    let store = mergeOutreach({ version: 1, drafts: {} }, [draft("a.com", "2026-10-01"), draft("b.com", "2026-10-02")]);
    store = mergeOutreach(store, [draft("a.com", "2026-10-03"), draft("c.com", "2026-10-04")], 2);
    expect(Object.keys(store.drafts).sort()).toEqual(["a.com", "c.com"]);
    const gaps = ["a.com", "b.com", "c.com", "d.com"].map((domain) => ({ domain, hint: "news" as const, linksTo: [], rank: null, backlinks: null, spamScore: null }));
    expect(pickTopGap(gaps, store, 5).map((g) => g.domain)).toEqual(["b.com", "d.com"]);
  });
});
