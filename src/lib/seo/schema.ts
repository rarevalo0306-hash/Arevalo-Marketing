// "Código para que Google entienda tu negocio": el JSON-LD de schema.org (LocalBusiness) que el dueño pega en su
// página. Gratis (no llama a ninguna API): se arma con lo que ya sabe la app del negocio (Ajustes, Kit de marca,
// Perfil de Google, estudio, zonas de SEO, redes conectadas) y con lo que el dueño escribe aquí (horario, precios).
//
// Sin dependencias de servidor (solo tipos): el componente del cliente lo usa para rehacer el código en vivo.
//
// Sigue la guía de Google (developers.google.com/search/docs/appearance/structured-data/local-business, oct. 2026):
// - Obligatorios: name y address (PostalAddress, "incluye todas las propiedades que puedas").
// - Recomendados: telephone (con código de país), url, geo (al menos 5 decimales), openingHoursSpecification
//   (opens/closes "hh:mm", dayOfWeek en inglés sin URL), priceRange (menos de 100 letras), department, menu…
// - aggregateRating y review NO se ponen: Google dice que solo se recomiendan para sitios que reseñan a OTROS
//   negocios, y que si el negocio controla las reseñas sobre sí mismo (incluidos widgets de Google o Facebook) sus
//   páginas con LocalBusiness u Organization no pueden tener estrellas (review-snippet, "self-serving reviews").
// Nunca se inventa nada: lo que no se sabe no va, y sale en la lista de "lo que falta".
import type { Zone } from "@/lib/seo/dataforseo";

export type Bi = { es: string; en: string };

/** Días en el orden de la semana (como los pide schema.org). */
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export type Day = (typeof DAYS)[number];
export const DAY_NAMES: Record<Day, Bi> = {
  Monday: { es: "Lunes", en: "Monday" },
  Tuesday: { es: "Martes", en: "Tuesday" },
  Wednesday: { es: "Miércoles", en: "Wednesday" },
  Thursday: { es: "Jueves", en: "Thursday" },
  Friday: { es: "Viernes", en: "Friday" },
  Saturday: { es: "Sábado", en: "Saturday" },
  Sunday: { es: "Domingo", en: "Sunday" },
};

/** Un horario: "08:00" a "17:30". Si cierra antes de abrir, cierra al día siguiente (ej. 20:00 a 02:00). */
export type HoursRange = { opens: string; closes: string };
/** El horario de la semana. Un día que no está (o con lista vacía) = cerrado. */
export type WeekHours = Partial<Record<Day, HoursRange[]>>;

export type SchemaService = { name: string; description?: string };

/** Todo lo que se sabe del negocio. Lo que falta se deja vacío y no sale en el código. */
export type SchemaInput = {
  name: string;
  /** Idioma de los textos del código (nombre del catálogo de servicios). */
  lang?: "es" | "en";
  website?: string;
  phone?: string;
  /** La dirección en una línea, como la da Google ("Km 5 Carretera Norte, Managua 11001, Nicaragua"). */
  address?: string;
  /** El país de la zona de SEO principal (por si la dirección no dice el país). */
  countryHint?: string;
  lat?: number | null;
  lng?: number | null;
  /** Categoría principal del Perfil de Google (en español o inglés). */
  category?: string;
  additionalCategories?: string[];
  /** La descripción del Perfil de Google (la escribió el dueño). */
  description?: string;
  hours?: WeekHours | null;
  /** Redes sociales y otros perfiles del negocio (URLs completas). */
  sameAs?: string[];
  logo?: string;
  images?: string[];
  /** Zonas de SEO (readZones): salen como areaServed. */
  zones?: Pick<Zone, "name" | "type">[];
  /** Solo si el dueño lo escribió. */
  priceRange?: string;
  services?: SchemaService[];
  /** El negocio en Google Maps (mapsUrl(cid)). */
  mapUrl?: string;
};

export type MissingLevel = "required" | "recommended" | "optional";
/** Dónde se arregla: Ajustes del negocio, Identidad de la marca, Perfil de Google, Conexiones, Estudio, zonas de SEO o aquí mismo. */
export type FixPlace = "settings" | "brand" | "gbp" | "connections" | "study" | "zones" | "here";
export type MissingField = { id: string; level: MissingLevel; where: FixPlace } & Bi;

export type JsonLd = Record<string, unknown>;
export type SchemaResult = {
  schema: JsonLd;
  /** El tipo de schema.org elegido ("Locksmith", "LocalBusiness"…). */
  type: string;
  missing: MissingField[];
  /** Avisos que no son un dato que falte (ej. teléfono sin código de país). */
  tips: Bi[];
};

// ---------- Utilidades ----------

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const clean = (s: unknown, max = 300) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Una URL pública (http/https) completa, o "". "fameseg.com" → "https://fameseg.com/". */
export function absoluteUrl(raw: unknown): string {
  const s = clean(raw, 2000);
  if (!s) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (!u.hostname.includes(".") || /\s/.test(u.hostname)) return "";
    return u.href;
  } catch {
    return "";
  }
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

// ---------- Tipo de negocio ----------

/**
 * Categoría de Google → el tipo de schema.org más específico, solo cuando es obvio. El orden importa (lo más
 * específico primero). Se compara sin acentos ni mayúsculas, en español e inglés.
 */
const TYPE_RULES: [RegExp, string][] = [
  [/\b(locksmith|cerrajer)/, "Locksmith"],
  [/\b(roof|roofing|techador|techos?|techado|tejad)/, "RoofingContractor"],
  [/\b(insurance|seguros?|aseguradora)\b/, "InsuranceAgency"],
  [/\b(home goods|articulos (para el )?hogar|tienda de hogar)\b/, "HomeGoodsStore"],
  [/\b(hardware store|ferreteri)/, "HardwareStore"],
  [/\b(plumb|fontaner|plomer)/, "Plumber"],
  [/\b(electrician|electricista)\b/, "Electrician"],
  [/\b(hvac|air conditioning|aire acondicionado|climatizacion|calefaccion)\b/, "HVACBusiness"],
  [/\b(house painter|painting contractor|pintor)/, "HousePainter"],
  [/\b(general contractor|contratista general|construction company|empresa constructora|constructora)\b/, "GeneralContractor"],
  [/\b(moving company|movers|mudanza)/, "MovingCompany"],
  [/\b(dentist|dental|dentista|odontolog)/, "Dentist"],
  [/\b(veterinar)/, "VeterinaryCare"],
  [/\b(pharmacy|drugstore|farmacia)\b/, "Pharmacy"],
  [/\b(optician|optica|optometr)/, "Optician"],
  [/\b(medical clinic|clinica|clinic)\b/, "MedicalClinic"],
  [/\b(doctor|physician|medico)\b/, "Physician"],
  [/\b(law firm|lawyer|attorney|abogad|bufete)/, "Attorney"],
  [/\b(notary|notari)/, "Notary"],
  [/\b(accountant|accounting|contador|contabilidad)\b/, "AccountingService"],
  [/\b(real estate|bienes raices|inmobiliaria|realtor)\b/, "RealEstateAgent"],
  [/\b(travel agency|agencia de viajes)\b/, "TravelAgency"],
  [/\b(auto repair|car repair|mechanic|taller mecanico|taller automotriz|mecanica automotriz)\b/, "AutoRepair"],
  [/\b(car dealer|concesionario|agencia de autos)\b/, "AutoDealer"],
  [/\b(hair salon|peluqueri|barber|barberia)/, "HairSalon"],
  [/\b(beauty salon|salon de belleza)\b/, "BeautySalon"],
  [/\b(day spa|spa)\b/, "DaySpa"],
  [/\b(gym|gimnasio|fitness center)\b/, "ExerciseGym"],
  [/\b(hotel)\b/, "Hotel"],
  [/\b(bakery|panaderi|pasteleri)/, "Bakery"],
  [/\b(coffee shop|cafe|cafeteria)\b/, "CafeOrCoffeeShop"],
  [/\b(restaurant|restaurante)\b/, "Restaurant"],
  [/\b(florist|floristeri|floreria)/, "Florist"],
  [/\b(furniture store|muebleria|tienda de muebles)\b/, "FurnitureStore"],
  [/\b(electronics store|tienda de electronic)/, "ElectronicsStore"],
  [/\b(clothing store|tienda de ropa|boutique)\b/, "ClothingStore"],
  [/\b(self storage|mini bodegas?|autoalmacenaje)\b/, "SelfStorage"],
  [/\b(laundry|dry clean|lavanderia|tintoreria)\b/, "DryCleaningOrLaundry"],
  [/\b(child care|day care|guarderia)\b/, "ChildCare"],
];

/** El tipo de schema.org para una categoría de Google. Si no es obvio: "LocalBusiness". */
export function schemaTypeFor(category: string | null | undefined): string {
  const c = plain(category ?? "");
  if (!c) return "LocalBusiness";
  for (const [re, type] of TYPE_RULES) if (re.test(c)) return type;
  return "LocalBusiness";
}

// ---------- Dirección ----------

/** País (como lo escribe Google, en español o inglés, sin acentos) → código ISO de 2 letras. */
const COUNTRIES: Record<string, string> = {
  nicaragua: "NI", honduras: "HN", "el salvador": "SV", guatemala: "GT", "costa rica": "CR", panama: "PA", belice: "BZ", belize: "BZ",
  mexico: "MX", "estados unidos": "US", "united states": "US", usa: "US", "ee uu": "US", eeuu: "US", "estados unidos de america": "US",
  "united states of america": "US", "puerto rico": "PR", "republica dominicana": "DO", "dominican republic": "DO", cuba: "CU",
  colombia: "CO", venezuela: "VE", ecuador: "EC", peru: "PE", bolivia: "BO", chile: "CL", argentina: "AR", uruguay: "UY",
  paraguay: "PY", espana: "ES", spain: "ES", canada: "CA",
};

/** Código ISO de un país por su nombre ("Nicaragua" → "NI"). "" si no se conoce. */
export function countryCode(name: string | null | undefined): string {
  return COUNTRIES[plain(name ?? "")] ?? "";
}

export type PostalAddress = { streetAddress?: string; addressLocality?: string; addressRegion?: string; postalCode?: string; addressCountry?: string };

/**
 * Parte la dirección de una línea de Google en las piezas de PostalAddress. Solo separa lo que se reconoce con
 * seguridad (país conocido, código postal, estado de EE. UU.); lo demás queda como calle. Nunca agrega datos,
 * salvo el país de la zona de SEO cuando la dirección no lo dice.
 */
export function parseAddress(raw: string | null | undefined, countryHint?: string | null): PostalAddress | null {
  const parts = clean(raw, 400)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const out: PostalAddress = {};
  const last = parts[parts.length - 1];
  const code = countryCode(last);
  if (code) {
    out.addressCountry = code;
    parts.pop();
  } else {
    const hint = countryCode(countryHint);
    if (hint) out.addressCountry = hint;
  }
  if (parts.length >= 2) {
    const tail = parts[parts.length - 1];
    let m: RegExpMatchArray | null;
    if ((m = tail.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/))) {
      // "FL 33101" (EE. UU.): estado y código postal; la ciudad es la parte anterior.
      out.addressRegion = m[1];
      out.postalCode = m[2];
      parts.pop();
    } else if ((m = tail.match(/^\d{4,6}$/))) {
      out.postalCode = m[0];
      parts.pop();
    } else if ((m = tail.match(/^(\d{4,6})\s+(\D.+)$/))) {
      // "06600 Ciudad de México"
      out.postalCode = m[1];
      parts[parts.length - 1] = m[2].trim();
    } else if ((m = tail.match(/^(\D.+?)\s+(\d{4,6})$/))) {
      // "Managua 11001"
      out.postalCode = m[2];
      parts[parts.length - 1] = m[1].trim();
    }
  }
  if (parts.length >= 2) out.addressLocality = parts.pop();
  if (parts.length) out.streetAddress = parts.join(", ");
  return Object.keys(out).length ? out : null;
}

// ---------- Horario ----------

const TIME = /^([01]?\d|2[0-4]):([0-5]\d)(?::[0-5]\d)?$/;

/** "8:00" → "08:00". "" si no es una hora válida. "24:00" → "23:59" (Google: abierto todo el día = 00:00 a 23:59). */
export function normTime(v: unknown): string {
  const m = typeof v === "string" ? v.trim().match(TIME) : null;
  if (!m) return "";
  const h = Number(m[1]);
  if (h === 24) return m[2] === "00" ? "23:59" : "";
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** Lee un horario guardado (WeekHours) con cuidado. null si no hay ningún día abierto. */
export function readWeekHours(json: unknown): WeekHours | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const out: WeekHours = {};
  for (const d of DAYS) {
    const list = Array.isArray(o[d]) ? (o[d] as unknown[]) : [];
    const ranges = list.flatMap((r) => {
      const x = (r ?? {}) as Record<string, unknown>;
      const opens = normTime(x.opens);
      const closes = normTime(x.closes);
      return opens && closes && opens !== closes ? [{ opens, closes }] : [];
    });
    if (ranges.length) out[d] = ranges.slice(0, 3);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * El horario como lo da DataForSEO (my_business_info → work_time.work_hours.timetable):
 * { monday: [{ open: { hour: 8, minute: 0 }, close: { hour: 17, minute: 0 } }], sunday: null, … }.
 * null si no hay ningún día con horario.
 */
export function readDfsTimetable(json: unknown): WeekHours | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const hm = (v: unknown) => {
    const x = (v ?? {}) as Record<string, unknown>;
    const h = typeof x.hour === "number" ? x.hour : NaN;
    const m = typeof x.minute === "number" ? x.minute : 0;
    return Number.isInteger(h) && h >= 0 && h <= 24 && m >= 0 && m < 60 ? normTime(`${h}:${String(m).padStart(2, "0")}`) : "";
  };
  const week: Record<string, unknown> = {};
  for (const d of DAYS) {
    const list = o[d.toLowerCase()];
    week[d] = Array.isArray(list)
      ? list.map((r) => {
          const x = (r ?? {}) as Record<string, unknown>;
          return { opens: hm(x.open), closes: hm(x.close) };
        })
      : [];
  }
  return readWeekHours(week);
}

/** openingHoursSpecification: junta los días con el mismo horario. Los días cerrados no van. */
export function openingHours(hours: WeekHours | null | undefined): JsonLd[] {
  if (!hours) return [];
  const groups = new Map<string, { days: Day[]; range: HoursRange }>();
  for (const d of DAYS)
    for (const r of hours[d] ?? []) {
      const key = `${r.opens}-${r.closes}`;
      const g = groups.get(key);
      if (g) g.days.push(d);
      else groups.set(key, { days: [d], range: r });
    }
  return [...groups.values()].map((g) => ({
    "@type": "OpeningHoursSpecification",
    dayOfWeek: g.days.length === 1 ? g.days[0] : g.days,
    opens: g.range.opens,
    closes: g.range.closes,
  }));
}

// ---------- Armar el código ----------

const areaType = (type?: string) => {
  const t = (type ?? "").toLowerCase();
  if (t === "country") return "Country";
  if (t === "city" || t === "municipality") return "City";
  if (t === "state" || t === "region" || t === "province" || t === "department" || t === "county") return "State";
  return "Place";
};

/** "Managua,Managua,Nicaragua" → "Managua, Nicaragua" (sin repetir). */
function zoneName(name: string): string {
  const parts = name.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.filter((p, i) => i === 0 || p !== parts[i - 1]).join(", ");
}

const roundCoord = (n: number) => Math.round(n * 1e7) / 1e7;
const decimals = (n: number) => (String(n).split(".")[1] ?? "").length;

/** Arma el JSON-LD de LocalBusiness con lo que se sabe y la lista de lo que falta. Pura: no lee ni guarda nada. */
export function buildLocalBusinessSchema(input: SchemaInput): SchemaResult {
  const lang = input.lang === "en" ? "en" : "es";
  const missing: MissingField[] = [];
  const tips: Bi[] = [];
  const miss = (id: string, level: MissingLevel, where: FixPlace, es: string, en: string) => missing.push({ id, level, where, es, en });

  const category = clean(input.category, 120);
  const type = schemaTypeFor(category);
  const name = clean(input.name, 200);
  const url = absoluteUrl(input.website);
  const schema: JsonLd = { "@context": "https://schema.org", "@type": type };
  if (url) schema["@id"] = `${url.replace(/#.*$/, "")}#business`;
  schema.name = name;
  if (url) schema.url = url;
  else
    miss("url", "recommended", "settings", "La dirección de tu página web: agrégala en Ajustes del negocio.", "Your website address: add it in Business settings.");

  const description = clean(input.description, 1000);
  if (description) schema.description = description;

  // Teléfono: Google pide el código de país y de área.
  const phone = clean(input.phone, 40);
  if (phone) {
    schema.telephone = phone;
    if (!phone.startsWith("+"))
      tips.push({
        es: `Tu teléfono (${phone}) no tiene el código de país. Google lo pide: escríbelo con «+» y el código (ej. +505 para Nicaragua) en Identidad de la marca o en tu Perfil de Google.`,
        en: `Your phone (${phone}) has no country code. Google asks for it: write it with "+" and the code (e.g. +1 for the US) in Brand identity or in your Google Business Profile.`,
      });
  } else
    miss("telephone", "recommended", "brand", "Tu teléfono: agrégalo en Identidad de la marca (o en tu Perfil de Google y presiona «Actualizar perfil»).", "Your phone: add it in Brand identity (or in your Google Business Profile and press “Update profile”).");

  const address = parseAddress(input.address, input.countryHint);
  if (address) schema.address = { "@type": "PostalAddress", ...address };
  else
    miss(
      "address",
      "required",
      "gbp",
      "Tu dirección (Google la exige): sale de tu Perfil de Google. Revisa que tenga dirección y presiona «Actualizar perfil» en el panel Tu Perfil de Google.",
      "Your address (Google requires it): it comes from your Google Business Profile. Make sure it has an address and press “Update profile” in the Google Business Profile panel.",
    );
  if (address && !address.addressLocality)
    tips.push({
      es: "No pudimos separar la ciudad de tu dirección. Si la ves mal, corrígela a mano en el código antes de pegarlo.",
      en: "We couldn't tell the city apart in your address. If it looks wrong, fix it by hand in the code before pasting it.",
    });

  const lat = typeof input.lat === "number" && Number.isFinite(input.lat) && Math.abs(input.lat) <= 90 ? input.lat : null;
  const lng = typeof input.lng === "number" && Number.isFinite(input.lng) && Math.abs(input.lng) <= 180 ? input.lng : null;
  if (lat !== null && lng !== null && !(lat === 0 && lng === 0)) {
    schema.geo = { "@type": "GeoCoordinates", latitude: roundCoord(lat), longitude: roundCoord(lng) };
    if (decimals(lat) < 5 || decimals(lng) < 5)
      tips.push({
        es: "La ubicación tiene pocos decimales (Google pide al menos 5). Actualiza tu Perfil de Google para traerla exacta.",
        en: "The location has few decimals (Google asks for at least 5). Update your Google Business Profile to get the exact one.",
      });
  } else
    miss("geo", "recommended", "gbp", "Tu ubicación en el mapa: sale de tu Perfil de Google («Actualizar perfil») o del negocio que elegiste en el mapa de calor.", "Your map location: it comes from your Google Business Profile (“Update profile”) or the business you picked in the heat map.");

  if (input.mapUrl && absoluteUrl(input.mapUrl)) schema.hasMap = absoluteUrl(input.mapUrl);

  const hours = openingHours(input.hours);
  if (hours.length) schema.openingHoursSpecification = hours;
  else
    miss("hours", "recommended", "here", "Tu horario: escríbelo abajo en «Tu horario» y guárdalo.", "Your hours: enter them below in “Your hours” and save.");

  const logo = absoluteUrl(input.logo);
  const images = [...new Set((input.images ?? []).map(absoluteUrl).filter(Boolean))].slice(0, 3);
  if (logo) schema.logo = logo;
  if (images.length || logo) schema.image = images.length ? (images.length === 1 ? images[0] : images) : logo;
  if (!logo)
    miss("logo", "optional", "brand", "Tu logo: súbelo en Identidad de la marca (una dirección pública que empiece con https).", "Your logo: upload it in Brand identity (a public address starting with https).");

  const own = url ? hostOf(url) : "";
  const sameAs = [...new Set((input.sameAs ?? []).map(absoluteUrl).filter((u) => u && hostOf(u) !== own))].slice(0, 10);
  if (sameAs.length) schema.sameAs = sameAs;
  else
    miss("sameAs", "optional", "connections", "Tus redes sociales: conecta Facebook o Instagram en Conexiones para que Google sepa que son tuyas.", "Your social profiles: connect Facebook or Instagram in Connections so Google knows they're yours.");

  const areas = (input.zones ?? []).map((z) => ({ name: zoneName(clean(z.name, 200)), type: areaType(z.type) })).filter((z) => z.name);
  const uniqueAreas = areas.filter((z, i) => areas.findIndex((x) => x.name === z.name) === i).slice(0, 10);
  if (uniqueAreas.length) {
    const list = uniqueAreas.map((z) => ({ "@type": z.type, name: z.name }));
    schema.areaServed = list.length === 1 ? list[0] : list;
  } else
    miss("areaServed", "optional", "zones", "Las zonas donde trabajas: elígelas en la pestaña «⚙ Ajustes».", "The areas you serve: pick them in the “⚙ Settings” tab.");

  const price = clean(input.priceRange, 99);
  if (price) schema.priceRange = price;

  const services = (input.services ?? [])
    .map((s) => ({ name: clean(s.name, 150), description: clean(s.description, 500) }))
    .filter((s) => s.name);
  const uniqueServices = services.filter((s, i) => services.findIndex((x) => x.name.toLowerCase() === s.name.toLowerCase()) === i).slice(0, 20);
  if (uniqueServices.length)
    schema.hasOfferCatalog = {
      "@type": "OfferCatalog",
      name: lang === "en" ? "Services" : "Servicios",
      itemListElement: uniqueServices.map((s) => ({
        "@type": "Offer",
        itemOffered: { "@type": "Service", name: s.name, ...(s.description ? { description: s.description } : {}) },
      })),
    };
  else
    miss("services", "optional", "study", "Tus servicios: haz el Estudio del negocio para que aparezcan.", "Your services: run the Business study so they show up.");

  if (!price)
    miss("priceRange", "optional", "here", "Rango de precios (opcional): escríbelo abajo solo si quieres, ej. «$$» o «C$500 a C$5,000».", "Price range (optional): enter it below only if you want, e.g. “$$” or “$50 to $500”.");

  if (!name) miss("name", "required", "settings", "El nombre del negocio: escríbelo en Ajustes del negocio.", "The business name: enter it in Business settings.");

  const order: Record<MissingLevel, number> = { required: 0, recommended: 1, optional: 2 };
  missing.sort((a, b) => order[a.level] - order[b.level]);
  return { schema, type, missing, tips };
}

// ---------- Lo que escribe el dueño (horario y precios), guardado en SeoReport ----------

/** Kind de SeoReport con lo que el dueño escribe para el código de Google (src/app/actions-seo-schema.ts). */
export const SCHEMA_KIND = "schema";
/** Cuántas versiones se guardan (las demás se borran). */
export const SCHEMA_KEEP = 5;

export type SchemaExtras = { hours: WeekHours | null; priceRange: string; updatedAt: string };

/** Lee lo guardado con cuidado. null si no hay nada. */
export function readSchemaExtras(json: unknown): SchemaExtras | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  return { hours: readWeekHours(o.hours), priceRange: clean(o.priceRange, 99), updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : "" };
}

// ---------- Para pegar en la página ----------

/**
 * JSON listo para ir dentro de <script type="application/ld+json">: "<" se escribe \u003c (así un texto con
 * "</script>" no puede cerrar la etiqueta), y también los separadores de línea U+2028/U+2029. Sigue siendo JSON válido.
 */
export function serializeJsonLd(schema: unknown, pretty = true): string {
  return JSON.stringify(schema, null, pretty ? 2 : 0)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** El bloque completo para copiar y pegar en el <head>. */
export const schemaSnippet = (schema: unknown) => `<script type="application/ld+json">\n${serializeJsonLd(schema)}\n</script>`;

// ---------- ¿Tu página ya lo tiene? (según la última auditoría) ----------

export type SchemaStatus = "present" | "incomplete" | "missing" | "unknown";

/** Tipos que dicen "quién eres" pero no dónde estás ni a qué hora abres. */
const ORG_ONLY = new Set(["Organization", "Corporation", "NGO", "EducationalOrganization", "SportsOrganization", "WebSite", "WebPage"]);

/** ¿Es un tipo de negocio local (LocalBusiness o uno más específico)? */
export function isLocalType(t: string): boolean {
  if (ORG_ONLY.has(t)) return false;
  return t === "LocalBusiness" || t === "Store" || /\w(Business|Store|Service|Contractor|Agency|Shop|Salon|Clinic|Repair|Dealer)$/.test(t) || schemaTypeFor(t.replace(/([a-z])([A-Z])/g, "$1 $2")) === t;
}

type AuditLike = {
  site: { home: string; localBusinessSchema: boolean };
  pages: { url: string; finalUrl: string; schema: string[]; error?: string }[];
} | null;

/**
 * Lo que dijo la última auditoría de la página de inicio:
 * - present: ya tiene un tipo de negocio local (LocalBusiness o más específico).
 * - incomplete: solo dice "Organization" (sin dirección ni horario), o el negocio local está en otra página pero no en la de inicio.
 * - missing: no tiene nada que diga qué negocio es.
 * - unknown: todavía no hay auditoría.
 */
export function schemaStatus(audit: AuditLike): { status: SchemaStatus; types: string[] } {
  if (!audit) return { status: "unknown", types: [] };
  const norm = (u: string) => u.replace(/[#?].*$/, "").replace(/\/+$/, "");
  const home = audit.pages.find((p) => norm(p.finalUrl) === norm(audit.site.home) || norm(p.url) === norm(audit.site.home)) ?? audit.pages[0];
  const homeTypes = home?.schema ?? [];
  if (homeTypes.some(isLocalType)) return { status: "present", types: homeTypes };
  const elsewhere = audit.pages.some((p) => p !== home && p.schema.some(isLocalType));
  if (elsewhere || homeTypes.some((t) => ORG_ONLY.has(t) && t !== "WebSite" && t !== "WebPage")) return { status: "incomplete", types: homeTypes };
  // Reportes viejos sin tipos por página: se usa lo que dijo la auditoría del sitio.
  if (!audit.pages.length && audit.site.localBusinessSchema) return { status: "present", types: [] };
  return { status: "missing", types: homeTypes };
}
