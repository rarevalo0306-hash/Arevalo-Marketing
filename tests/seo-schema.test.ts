import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  buildLocalBusinessSchema,
  countryCode,
  isLocalType,
  normTime,
  openingHours,
  parseAddress,
  readDfsTimetable,
  readSchemaExtras,
  readWeekHours,
  type SchemaInput,
  schemaSnippet,
  schemaStatus,
  schemaTypeFor,
  serializeJsonLd,
  type WeekHours,
} from "@/lib/seo/schema";
import { readZones } from "@/lib/seo/dataforseo";
import { readStudy } from "@/lib/study-shape";
import fameseg from "./fixtures/fameseg.json";

const study = readStudy(fameseg.business.study);
const zones = readZones(fameseg.business.seoLocations, fameseg.business.seoLocationCode, fameseg.business.seoLocationName);

// Lunes a viernes de 8 a 5, sábado de 8 a 12, domingo cerrado (como dice el estudio: "de lunes a sábado").
const famesegHours: WeekHours = {
  Monday: [{ opens: "08:00", closes: "17:00" }],
  Tuesday: [{ opens: "08:00", closes: "17:00" }],
  Wednesday: [{ opens: "08:00", closes: "17:00" }],
  Thursday: [{ opens: "08:00", closes: "17:00" }],
  Friday: [{ opens: "08:00", closes: "17:00" }],
  Saturday: [{ opens: "08:00", closes: "12:00" }],
};

const famesegInput = (extra: Partial<SchemaInput> = {}): SchemaInput => ({
  name: fameseg.business.name,
  lang: "es",
  website: fameseg.business.website,
  phone: "+505 2222-3333",
  address: "Edificio Armando Guido, 2 cuadras al este y 1 cuadra al sur, Managua, Nicaragua",
  countryHint: zones[0]?.name,
  lat: 12.1328201,
  lng: -86.2503915,
  category: "Proveedor de puertas de garaje",
  hours: famesegHours,
  sameAs: ["https://www.facebook.com/123456789012", "https://www.instagram.com/fameseg/", "https://fameseg.com/contacto"],
  logo: "https://fameseg.com/logo.png",
  zones: zones.map((z) => ({ name: z.name, type: z.type })),
  services: study?.services ?? [],
  mapUrl: "https://www.google.com/maps?cid=123",
  ...extra,
});

describe("schemaTypeFor", () => {
  it("elige el tipo más específico solo cuando es obvio", () => {
    expect(schemaTypeFor("Cerrajería")).toBe("Locksmith");
    expect(schemaTypeFor("Locksmith")).toBe("Locksmith");
    expect(schemaTypeFor("Roofing contractor")).toBe("RoofingContractor");
    expect(schemaTypeFor("Contratista de techos")).toBe("RoofingContractor");
    expect(schemaTypeFor("Insurance agency")).toBe("InsuranceAgency");
    expect(schemaTypeFor("Agencia de seguros")).toBe("InsuranceAgency");
    expect(schemaTypeFor("Home goods store")).toBe("HomeGoodsStore");
    expect(schemaTypeFor("Tienda de artículos para el hogar")).toBe("HomeGoodsStore");
    expect(schemaTypeFor("Ferretería")).toBe("HardwareStore");
    expect(schemaTypeFor("Restaurante")).toBe("Restaurant");
  });
  it("si no es obvio (o no hay categoría) usa LocalBusiness", () => {
    expect(schemaTypeFor("Proveedor de puertas de garaje")).toBe("LocalBusiness");
    expect(schemaTypeFor("Metal fabricator")).toBe("LocalBusiness");
    expect(schemaTypeFor("")).toBe("LocalBusiness");
    expect(schemaTypeFor(null)).toBe("LocalBusiness");
    // "bar" dentro de otra palabra no es un bar; "spa" tampoco dentro de "España".
    expect(schemaTypeFor("Barbacoas España")).toBe("LocalBusiness");
  });
});

describe("parseAddress", () => {
  it("separa la ciudad y el país de una dirección de Nicaragua", () => {
    expect(parseAddress("Edificio Armando Guido, 2 cuadras al este y 1 cuadra al sur, Managua, Nicaragua")).toEqual({
      streetAddress: "Edificio Armando Guido, 2 cuadras al este y 1 cuadra al sur",
      addressLocality: "Managua",
      addressCountry: "NI",
    });
    expect(parseAddress("Km 5 Carretera Norte, Managua 11001, Nicaragua")).toEqual({
      streetAddress: "Km 5 Carretera Norte",
      addressLocality: "Managua",
      postalCode: "11001",
      addressCountry: "NI",
    });
  });
  it("entiende direcciones de EE. UU. y México", () => {
    expect(parseAddress("148 W 51st St, New York, NY 10019, United States")).toEqual({
      streetAddress: "148 W 51st St",
      addressLocality: "New York",
      addressRegion: "NY",
      postalCode: "10019",
      addressCountry: "US",
    });
    expect(parseAddress("Av. Insurgentes Sur 123, 06600 Ciudad de México, CDMX, México")?.addressCountry).toBe("MX");
  });
  it("usa el país de la zona solo si la dirección no lo dice, y nunca inventa la ciudad", () => {
    expect(parseAddress("Del Hospital Militar 2c al lago", "Nicaragua")).toEqual({ streetAddress: "Del Hospital Militar 2c al lago", addressCountry: "NI" });
    expect(parseAddress("Calle 1", "Narnia")).toEqual({ streetAddress: "Calle 1" });
    expect(parseAddress("")).toBeNull();
    expect(countryCode("Estados Unidos")).toBe("US");
    expect(countryCode("Panamá")).toBe("PA");
  });
});

describe("horario", () => {
  it("normaliza las horas", () => {
    expect(normTime("8:00")).toBe("08:00");
    expect(normTime("17:30:00")).toBe("17:30");
    expect(normTime("24:00")).toBe("23:59");
    expect(normTime("25:00")).toBe("");
    expect(normTime(800)).toBe("");
  });
  it("junta los días con el mismo horario y deja fuera los cerrados", () => {
    expect(openingHours(famesegHours)).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "08:00", closes: "17:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: "Saturday", opens: "08:00", closes: "12:00" },
    ]);
    expect(openingHours(null)).toEqual([]);
  });
  it("lee el horario de DataForSEO (work_time.work_hours.timetable)", () => {
    const tt = {
      sunday: null,
      monday: [{ open: { hour: 8, minute: 0 }, close: { hour: 17, minute: 0 } }],
      tuesday: [{ open: { hour: 8, minute: 0 }, close: { hour: 17, minute: 0 } }],
      saturday: [{ open: { hour: 0, minute: 0 }, close: { hour: 24, minute: 0 } }],
    };
    expect(readDfsTimetable(tt)).toEqual({
      Monday: [{ opens: "08:00", closes: "17:00" }],
      Tuesday: [{ opens: "08:00", closes: "17:00" }],
      Saturday: [{ opens: "00:00", closes: "23:59" }],
    });
    expect(readDfsTimetable({ sunday: null })).toBeNull();
  });
  it("lee con cuidado lo guardado", () => {
    expect(readWeekHours({ Monday: [{ opens: "9:00", closes: "9:00" }], Friday: [{ opens: "x", closes: "18:00" }] })).toBeNull();
    expect(readSchemaExtras({ hours: { Monday: [{ opens: "09:00", closes: "18:00" }] }, priceRange: "  $$ ", updatedAt: "2026-10-06T00:00:00Z" })).toEqual({
      hours: { Monday: [{ opens: "09:00", closes: "18:00" }] },
      priceRange: "$$",
      updatedAt: "2026-10-06T00:00:00Z",
    });
    expect(readSchemaExtras(null)).toBeNull();
  });
});

describe("buildLocalBusinessSchema (Fameseg)", () => {
  const { schema, type, missing, tips } = buildLocalBusinessSchema(famesegInput());

  it("arma la estructura que pide Google", () => {
    expect(type).toBe("LocalBusiness");
    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema["@type"]).toBe("LocalBusiness");
    expect(schema["@id"]).toBe("https://fameseg.com/#business");
    expect(schema.name).toBe("Fameseg");
    expect(schema.url).toBe("https://fameseg.com/");
    expect(schema.telephone).toBe("+505 2222-3333");
    expect(schema.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "Edificio Armando Guido, 2 cuadras al este y 1 cuadra al sur",
      addressLocality: "Managua",
      addressCountry: "NI",
    });
    expect(schema.geo).toEqual({ "@type": "GeoCoordinates", latitude: 12.1328201, longitude: -86.2503915 });
    expect(schema.openingHoursSpecification).toHaveLength(2);
    expect(schema.areaServed).toEqual({ "@type": "Country", name: "Nicaragua" });
    expect(schema.logo).toBe("https://fameseg.com/logo.png");
    expect(schema.image).toBe("https://fameseg.com/logo.png");
    expect(schema.hasMap).toBe("https://www.google.com/maps?cid=123");
    // Su propia página no va en sameAs.
    expect(schema.sameAs).toEqual(["https://www.facebook.com/123456789012", "https://www.instagram.com/fameseg/"]);
    const catalog = schema.hasOfferCatalog as { "@type": string; name: string; itemListElement: { "@type": string; itemOffered: { "@type": string; name: string } }[] };
    expect(catalog["@type"]).toBe("OfferCatalog");
    expect(catalog.name).toBe("Servicios");
    expect(catalog.itemListElement[0]).toMatchObject({ "@type": "Offer", itemOffered: { "@type": "Service", name: "Cortinas de acero" } });
    expect(catalog.itemListElement.length).toBe(study?.services.length);
  });

  it("nunca pone estrellas, reseñas ni precios inventados", () => {
    expect(schema).not.toHaveProperty("aggregateRating");
    expect(schema).not.toHaveProperty("review");
    expect(schema).not.toHaveProperty("priceRange");
    expect(schema).not.toHaveProperty("description");
    expect(missing.map((m) => m.id)).toEqual(["priceRange"]);
    expect(tips).toEqual([]);
  });

  it("es JSON válido y se puede volver a leer igual", () => {
    expect(JSON.parse(serializeJsonLd(schema))).toEqual(schema);
  });

  it("los datos que no se saben no salen (ni vacíos) y aparecen en lo que falta", () => {
    const r = buildLocalBusinessSchema({ name: "Fameseg" });
    expect(Object.keys(r.schema).sort()).toEqual(["@context", "@type", "name"]);
    const ids = r.missing.map((m) => m.id);
    expect(ids[0]).toBe("address");
    expect(ids).toEqual(expect.arrayContaining(["address", "url", "telephone", "geo", "hours", "logo", "sameAs", "areaServed", "services", "priceRange"]));
    expect(r.missing.find((m) => m.id === "address")).toMatchObject({ level: "required", where: "gbp" });
    expect(r.missing.find((m) => m.id === "telephone")?.es).toMatch(/Identidad de la marca/);
    expect(r.missing.find((m) => m.id === "url")?.es).toMatch(/Ajustes del negocio/);
    expect(r.missing.find((m) => m.id === "hours")?.where).toBe("here");
  });

  it("avisa del teléfono sin código de país y de la ubicación poco precisa", () => {
    const r = buildLocalBusinessSchema(famesegInput({ phone: "2222-3333", lat: 12.13, lng: -86.25 }));
    expect(r.schema.telephone).toBe("2222-3333");
    expect(r.tips.map((x) => x.es).join(" ")).toMatch(/código de país/);
    expect(r.tips.map((x) => x.es).join(" ")).toMatch(/5/);
  });

  it("usa el tipo más específico con la categoría de Google", () => {
    expect(buildLocalBusinessSchema(famesegInput({ category: "Cerrajero" })).schema["@type"]).toBe("Locksmith");
    expect(buildLocalBusinessSchema(famesegInput({ category: "Roofing contractor" })).type).toBe("RoofingContractor");
  });

  it("pone el rango de precios solo si el dueño lo escribió (menos de 100 letras)", () => {
    expect(buildLocalBusinessSchema(famesegInput({ priceRange: "$$" })).schema.priceRange).toBe("$$");
    expect((buildLocalBusinessSchema(famesegInput({ priceRange: "x".repeat(200) })).schema.priceRange as string).length).toBeLessThan(100);
  });

  it("descarta direcciones que no son web", () => {
    const r = buildLocalBusinessSchema(famesegInput({ website: "javascript:alert(1)", sameAs: ["ftp://x.com", "not a url"], logo: "data:image/png;base64,xx" }));
    expect(r.schema).not.toHaveProperty("url");
    expect(r.schema).not.toHaveProperty("sameAs");
    expect(r.schema).not.toHaveProperty("logo");
    expect(absoluteUrl("fameseg.com")).toBe("https://fameseg.com/");
  });
});

describe("serializeJsonLd", () => {
  it("no deja que un texto cierre la etiqueta <script>", () => {
    const evil = buildLocalBusinessSchema({ name: "Fameseg</script><script>alert(1)</script>", description: "<!-- hola -->" });
    const snippet = schemaSnippet(evil.schema);
    // Solo un cierre: el nuestro, al final.
    expect(snippet.match(/<\/script/gi)).toHaveLength(1);
    expect(snippet.endsWith("</script>")).toBe(true);
    expect(snippet.startsWith('<script type="application/ld+json">')).toBe(true);
    expect(snippet).not.toContain("<!--");
    expect(snippet).toContain("Fameseg\\u003c/script>");
    // Y al leerlo vuelve el nombre original.
    const json = snippet.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    expect(JSON.parse(json).name).toBe("Fameseg</script><script>alert(1)</script>");
  });
  it("escapa los separadores de línea U+2028 y U+2029", () => {
    const ls = String.fromCharCode(0x2028);
    const ps = String.fromCharCode(0x2029);
    const out = serializeJsonLd({ name: `a${ls}b${ps}c` });
    expect(out).not.toContain(ls);
    expect(out).not.toContain(ps);
    expect(JSON.parse(out).name).toBe(`a${ls}b${ps}c`);
  });
});

describe("schemaStatus", () => {
  const page = (url: string, schema: string[]) => ({ url, finalUrl: url, schema });
  const audit = (pages: ReturnType<typeof page>[], localBusinessSchema = false) => ({ site: { home: "https://fameseg.com/", localBusinessSchema }, pages });

  it("sin auditoría: sin revisar", () => {
    expect(schemaStatus(null).status).toBe("unknown");
  });
  it("ya está si la página de inicio tiene un tipo de negocio local", () => {
    expect(schemaStatus(audit([page("https://fameseg.com/", ["WebSite", "LocalBusiness", "PostalAddress"])])).status).toBe("present");
    expect(schemaStatus(audit([page("https://fameseg.com", ["Locksmith"])])).status).toBe("present");
    expect(schemaStatus(audit([page("https://fameseg.com/", ["HomeAndConstructionBusiness"])])).status).toBe("present");
  });
  it("incompleto si solo dice Organization o el negocio local está en otra página", () => {
    expect(schemaStatus(audit([page("https://fameseg.com/", ["Organization", "WebSite"])])).status).toBe("incomplete");
    expect(schemaStatus(audit([page("https://fameseg.com/", ["WebSite"]), page("https://fameseg.com/contacto", ["LocalBusiness"])])).status).toBe("incomplete");
  });
  it("falta si no hay nada que diga qué negocio es (un Service suelto no cuenta)", () => {
    expect(schemaStatus(audit([page("https://fameseg.com/", [])])).status).toBe("missing");
    expect(schemaStatus(audit([page("https://fameseg.com/", ["WebSite", "Service", "Offer", "BreadcrumbList"])])).status).toBe("missing");
  });
  it("isLocalType", () => {
    expect(isLocalType("ProfessionalService")).toBe(true);
    expect(isLocalType("Dentist")).toBe(true);
    expect(isLocalType("Organization")).toBe(false);
    expect(isLocalType("Service")).toBe(false);
    expect(isLocalType("Product")).toBe(false);
  });
});
