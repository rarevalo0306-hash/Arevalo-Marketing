// Directorios y reseñas: en qué directorios conviene que salga el negocio (según su país y lo que vende), cómo
// buscar si ya está, cómo registrarse, y la revisión de que el nombre, la dirección y el teléfono (NAP) sean iguales
// en todos lados. PURO: sin base de datos ni red (se usa en el navegador, en el plan de acción y en las pruebas).
// La lectura de la base de datos está en src/lib/directories-data.ts.

export type Bi = { es: string; en: string };

/** EE. UU., Centroamérica, o el resto (lista general). */
export type Region = "us" | "ca" | "other";
/** Ajustador público (seguros), servicios para la casa o negocio local en general. */
export type BizKind = "adjuster" | "home" | "general";

export const LISTING_STATUSES = ["todo", "listed", "claimed", "needs-fix", "skip"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];
export const isListingStatus = (v: unknown): v is ListingStatus => typeof v === "string" && (LISTING_STATUSES as readonly string[]).includes(v);

/** 3 = imprescindible · 2 = importante · 1 = extra. */
export type DirPriority = 1 | 2 | 3;
export type DirCost = "free" | "paid" | "free-paid";

export type Directory = {
  id: string;
  name: string;
  /** Dominio (para reconocerlo en los resultados de Google del negocio). */
  domain: string;
  why: Bi;
  /** Qué datos llenar. */
  data: Bi;
  priority: DirPriority;
  cost: DirCost;
  /** Dónde registrarse o reclamar la ficha. */
  signUpUrl: string;
  /** "listing" = ficha del negocio; "check" = solo revisar (ej. licencia del estado). */
  kind: "listing" | "check";
};

type Ctx = { name: string; city: string };
type DirDef = Omit<Directory, "priority" | "signUpUrl"> & {
  regions: Region[];
  /** Prioridad por región y tipo de negocio; 0 = no se muestra. */
  rank: (r: Region, k: BizKind, s: { florida: boolean }) => 0 | DirPriority;
  signUp: (c: Ctx, r: Region) => string;
  search?: (c: Ctx) => string;
};

const bi = (es: string, en: string): Bi => ({ es, en });
const enc = encodeURIComponent;
const q = (c: Ctx) => [c.name, c.city].filter(Boolean).join(" ");
/** Búsqueda de Google dentro de un sitio: lo más seguro para saber si ya hay una ficha con tu nombre. */
const siteSearch = (domain: string) => (c: Ctx) => `https://www.google.com/search?q=${enc(`site:${domain} "${c.name}"${c.city ? ` ${c.city}` : ""}`)}`;
const googleFor = (text: string) => `https://www.google.com/search?q=${enc(text)}`;

const NAP_DATA = bi(
  "Nombre, dirección y teléfono exactamente como en la tarjeta de arriba, tu página web, horario, categoría, descripción, logo y 5 a 10 fotos reales.",
  "Name, address and phone exactly as in the card above, your website, hours, category, description, logo and 5 to 10 real photos.",
);

const DEFS: DirDef[] = [
  {
    id: "google",
    name: "Google Business Profile",
    domain: "google.com",
    kind: "listing",
    regions: ["us", "ca", "other"],
    why: bi(
      "Es lo primero que ve la gente al buscarte en Google y en Google Maps: llamadas, cómo llegar y reseñas. El más importante de todos.",
      "It's the first thing people see when they search for you on Google and Google Maps: calls, directions and reviews. The most important one.",
    ),
    data: NAP_DATA,
    cost: "free",
    rank: () => 3,
    signUp: () => "https://business.google.com/create",
    search: (c) => `https://www.google.com/maps/search/${enc(q(c))}`,
  },
  {
    id: "bing",
    name: "Bing Places",
    domain: "bing.com",
    kind: "listing",
    regions: ["us", "ca", "other"],
    why: bi(
      "Bing alimenta las búsquedas de Windows, Copilot, ChatGPT y Alexa. Se puede copiar tu Perfil de Google en un clic.",
      "Bing powers searches on Windows, Copilot, ChatGPT and Alexa. You can import your Google profile in one click.",
    ),
    data: bi("Usa «Importar desde Google» y revisa que el nombre, la dirección y el teléfono queden iguales.", "Use “Import from Google” and check the name, address and phone stay identical."),
    cost: "free",
    rank: (r) => (r === "us" ? 3 : 2),
    signUp: () => "https://www.bingplaces.com/",
    search: (c) => `https://www.bing.com/maps?q=${enc(q(c))}`,
  },
  {
    id: "apple",
    name: "Apple Business Connect",
    domain: "apple.com",
    kind: "listing",
    regions: ["us", "ca", "other"],
    why: bi(
      "Es el mapa de los iPhone (Apple Maps y Siri). Mucha gente con iPhone te busca ahí sin abrir Google.",
      "It's the iPhone map (Apple Maps and Siri). Many iPhone users look you up there without opening Google.",
    ),
    data: NAP_DATA,
    cost: "free",
    rank: (r) => (r === "us" ? 3 : 2),
    signUp: () => "https://businessconnect.apple.com/",
    search: (c) => `https://maps.apple.com/?q=${enc(q(c))}`,
  },
  {
    id: "facebook",
    name: "Facebook (página del negocio)",
    domain: "facebook.com",
    kind: "listing",
    regions: ["us", "ca", "other"],
    why: bi(
      "Muchos clientes revisan tu página de Facebook antes de llamar: reseñas, fotos y si contestas rápido.",
      "Many customers check your Facebook page before calling: reviews, photos and whether you answer quickly.",
    ),
    data: bi("En «Información»: categoría, dirección, teléfono, horario, página web y la misma descripción.", "In “About”: category, address, phone, hours, website and the same description."),
    cost: "free",
    rank: (r) => (r === "us" ? 2 : 3),
    signUp: () => "https://www.facebook.com/pages/create",
    search: (c) => `https://www.facebook.com/search/pages/?q=${enc(c.name)}`,
  },
  {
    id: "instagram",
    name: "Instagram (cuenta de empresa)",
    domain: "instagram.com",
    kind: "listing",
    regions: ["us", "ca", "other"],
    why: bi(
      "Con cuenta de empresa salen tu dirección, teléfono y botones de contacto. En Centroamérica muchos buscan negocios aquí.",
      "With a business account your address, phone and contact buttons show up. In Central America many people look for businesses here.",
    ),
    data: bi("Cambia a «cuenta profesional» y llena categoría, dirección, teléfono, WhatsApp y el enlace a tu página.", "Switch to a “professional account” and fill in category, address, phone, WhatsApp and your website link."),
    cost: "free",
    rank: (r) => (r === "ca" ? 3 : r === "other" ? 2 : 1),
    signUp: () => "https://business.instagram.com/getting-started",
    search: siteSearch("instagram.com"),
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    domain: "whatsapp.com",
    kind: "listing",
    regions: ["ca", "other"],
    why: bi(
      "Es por donde más escriben los clientes en Centroamérica. El perfil de empresa muestra dirección, horario y catálogo.",
      "It's how most customers reach businesses in Central America. The business profile shows address, hours and a catalog.",
    ),
    data: bi("En el perfil de empresa: nombre, categoría, dirección, horario, correo, página web y la descripción corta.", "In the business profile: name, category, address, hours, email, website and the short description."),
    cost: "free",
    rank: (r) => (r === "ca" ? 3 : 2),
    signUp: () => "https://business.whatsapp.com/",
  },
  {
    id: "yelp",
    name: "Yelp",
    domain: "yelp.com",
    kind: "listing",
    regions: ["us"],
    why: bi(
      "Muy usado en EE. UU. para revisar reseñas, y Apple Maps y Siri muestran datos de Yelp.",
      "Widely used in the U.S. to check reviews, and Apple Maps and Siri show Yelp data.",
    ),
    data: NAP_DATA,
    cost: "free-paid",
    rank: () => 2,
    signUp: () => "https://biz.yelp.com/",
    search: (c) => `https://www.yelp.com/search?find_desc=${enc(c.name)}&find_loc=${enc(c.city)}`,
  },
  {
    id: "bbb",
    name: "Better Business Bureau (BBB)",
    domain: "bbb.org",
    kind: "listing",
    regions: ["us"],
    why: bi(
      "Da confianza: mucha gente revisa el BBB antes de contratar a alguien que maneja su dinero o su casa.",
      "It builds trust: many people check the BBB before hiring someone who handles their money or their home.",
    ),
    data: bi("Ficha gratis con tus datos; la acreditación (sello) se paga aparte y es opcional.", "Free listing with your details; accreditation (the seal) is paid separately and optional."),
    cost: "free-paid",
    rank: (_r, k) => (k === "adjuster" ? 3 : 2),
    signUp: () => "https://www.bbb.org/get-listed",
    search: (c) => `https://www.bbb.org/search?find_text=${enc(c.name)}&find_loc=${enc(c.city)}`,
  },
  {
    id: "nextdoor",
    name: "Nextdoor",
    domain: "nextdoor.com",
    kind: "listing",
    regions: ["us"],
    why: bi(
      "Los vecinos se recomiendan negocios entre ellos. Ideal para servicios en casa y después de tormentas.",
      "Neighbors recommend businesses to each other. Great for home services and after storms.",
    ),
    data: NAP_DATA,
    cost: "free",
    rank: (_r, k) => (k === "general" ? 1 : 2),
    signUp: () => "https://business.nextdoor.com/",
    search: siteSearch("nextdoor.com"),
  },
  {
    id: "linkedin",
    name: "LinkedIn (página de empresa)",
    domain: "linkedin.com",
    kind: "listing",
    regions: ["us", "ca", "other"],
    why: bi(
      "Sirve para que te encuentren otros negocios, abogados, administradores de propiedades y gente que busca trabajo.",
      "Helps other businesses, attorneys, property managers and job seekers find you.",
    ),
    data: bi("Logo, página web, industria, tamaño, dirección y la descripción larga.", "Logo, website, industry, size, address and the long description."),
    cost: "free",
    rank: (r, k) => (k === "adjuster" ? 2 : r === "us" ? 1 : 1),
    signUp: () => "https://www.linkedin.com/company/setup/new/",
    search: (c) => `https://www.linkedin.com/search/results/companies/?keywords=${enc(c.name)}`,
  },
  {
    id: "angi",
    name: "Angi",
    domain: "angi.com",
    kind: "listing",
    regions: ["us"],
    why: bi(
      "Sitio de servicios para la casa: los clientes piden presupuestos ahí. Los contactos (leads) se pagan.",
      "Home-services site: customers request quotes there. Leads are paid.",
    ),
    data: NAP_DATA,
    cost: "free-paid",
    rank: (_r, k) => (k === "home" ? 2 : k === "adjuster" ? 1 : 0),
    signUp: () => "https://www.angi.com/pro/",
    search: siteSearch("angi.com"),
  },
  {
    id: "thumbtack",
    name: "Thumbtack",
    domain: "thumbtack.com",
    kind: "listing",
    regions: ["us"],
    why: bi("Clientes que buscan quién les haga un trabajo en casa. Ficha gratis; pagas por cada contacto.", "Customers looking for someone to do a job at home. Free profile; you pay per lead."),
    data: NAP_DATA,
    cost: "free-paid",
    rank: (_r, k) => (k === "home" ? 1 : 0),
    signUp: () => "https://www.thumbtack.com/pro/",
    search: siteSearch("thumbtack.com"),
  },
  {
    id: "yellowpages",
    name: "Yellow Pages (YP.com)",
    domain: "yellowpages.com",
    kind: "listing",
    regions: ["us"],
    why: bi("Directorio viejo pero que Google todavía muestra arriba; ayuda a que tus datos coincidan en todos lados.", "An old directory that Google still ranks high; helps your details match everywhere."),
    data: NAP_DATA,
    cost: "free-paid",
    rank: () => 1,
    signUp: () => "https://www.yellowpages.com/",
    search: (c) => `https://www.yellowpages.com/search?search_terms=${enc(c.name)}&geo_location_terms=${enc(c.city)}`,
  },
  {
    id: "manta",
    name: "Manta",
    domain: "manta.com",
    kind: "listing",
    regions: ["us"],
    why: bi("Directorio de pequeños negocios de EE. UU.; un enlace más a tu página con tus datos correctos.", "U.S. small-business directory; one more link to your website with your correct details."),
    data: NAP_DATA,
    cost: "free",
    rank: () => 1,
    signUp: () => "https://www.manta.com/",
    search: siteSearch("manta.com"),
  },
  {
    id: "foursquare",
    name: "Foursquare",
    domain: "foursquare.com",
    kind: "listing",
    regions: ["us", "ca", "other"],
    why: bi(
      "Sus datos los usan otras apps y mapas (Uber, Snapchat, algunos autos). Corregir aquí corrige en muchos lados.",
      "Its data feeds other apps and maps (Uber, Snapchat, some cars). Fixing it here fixes it in many places.",
    ),
    data: NAP_DATA,
    cost: "free",
    rank: (r) => (r === "us" ? 2 : 1),
    signUp: () => "https://foursquare.com/",
    search: siteSearch("foursquare.com"),
  },
  {
    id: "chamber",
    name: "Cámara de Comercio local",
    domain: "chamber",
    kind: "listing",
    regions: ["us", "ca", "other"],
    why: bi(
      "Ser socio da confianza, contactos con otros negocios y un enlace desde un sitio con mucha autoridad.",
      "Membership builds trust, gives you contacts with other businesses and a link from a high-authority site.",
    ),
    data: bi("Datos del negocio, logo, descripción y una persona de contacto. La membresía se paga.", "Business details, logo, description and a contact person. Membership is paid."),
    cost: "paid",
    rank: (r, k) => (k === "adjuster" && r === "us" ? 2 : 1),
    signUp: (c, r) => googleFor(`${r === "us" ? "chamber of commerce" : "cámara de comercio"} ${c.city || ""}`.trim()),
    search: siteSearch("chamberofcommerce.com"),
  },
  {
    id: "napia",
    name: "NAPIA (asociación nacional de ajustadores públicos)",
    domain: "napia.com",
    kind: "listing",
    regions: ["us"],
    why: bi(
      "Directorio de ajustadores públicos de todo EE. UU. Ser miembro muestra que sigues un código de ética.",
      "Nationwide directory of public adjusters. Membership shows you follow a code of ethics.",
    ),
    data: bi("Licencia, estados donde trabajas, datos del negocio y tu página web. Membresía pagada.", "License, states you work in, business details and website. Paid membership."),
    cost: "paid",
    rank: (_r, k) => (k === "adjuster" ? 2 : 0),
    signUp: () => "https://www.napia.com/",
    search: siteSearch("napia.com"),
  },
  {
    id: "fapia",
    name: "FAPIA (ajustadores públicos de Florida)",
    domain: "fapia.org",
    kind: "listing",
    regions: ["us"],
    why: bi(
      "La asociación de ajustadores públicos de Florida: su directorio lo revisan dueños de casa y abogados.",
      "The Florida public adjusters association: homeowners and attorneys check its directory.",
    ),
    data: bi("Licencia de Florida, condados donde trabajas, datos del negocio y tu página web. Membresía pagada.", "Florida license, counties you serve, business details and website. Paid membership."),
    cost: "paid",
    rank: (_r, k, s) => (k === "adjuster" && s.florida ? 2 : 0),
    signUp: () => "https://www.fapia.org/",
    search: siteSearch("fapia.org"),
  },
  {
    id: "fl-dfs",
    name: "Licencia en Florida (DFS)",
    domain: "fldfs.com",
    kind: "check",
    regions: ["us"],
    why: bi(
      "Los clientes y las aseguradoras revisan tu licencia aquí. El nombre debe coincidir con el de tu negocio, y conviene poner el enlace en tu página.",
      "Customers and insurers check your license here. The name should match your business name, and it's worth linking to it from your website.",
    ),
    data: bi("Busca tu licencia, revisa que esté activa y que el nombre sea igual al de tu negocio. Copia el enlace a tu página web.", "Look up your license, check it's active and the name matches your business. Copy the link to your website."),
    cost: "free",
    rank: (_r, k, s) => (k === "adjuster" && s.florida ? 3 : 0),
    signUp: () => "https://licenseesearch.fldfs.com/",
    search: () => "https://licenseesearch.fldfs.com/",
  },
  {
    id: "waze",
    name: "Waze",
    domain: "waze.com",
    kind: "listing",
    regions: ["ca", "other"],
    why: bi(
      "En Centroamérica mucha gente maneja con Waze: si tu negocio no está como lugar, no te pueden poner como destino.",
      "In Central America many people drive with Waze: if your business isn't a place there, they can't set you as a destination.",
    ),
    data: bi("En la app: Reportar → Lugar, en la puerta del negocio. Nombre, categoría, teléfono, horario y página web.", "In the app: Report → Place, at your door. Name, category, phone, hours and website."),
    cost: "free",
    rank: (r) => (r === "ca" ? 2 : 1),
    signUp: () => "https://www.waze.com/live-map",
    search: () => "https://www.waze.com/live-map",
  },
  {
    id: "paginas-amarillas",
    name: "Páginas Amarillas Nicaragua",
    domain: "paginasamarillas.com.ni",
    kind: "listing",
    regions: ["ca"],
    why: bi(
      "Google lo muestra arriba en muchas búsquedas de negocios en Nicaragua. Tener tu ficha con los mismos datos ayuda.",
      "Google shows it near the top for many business searches in Nicaragua. Having a listing with the same details helps.",
    ),
    data: NAP_DATA,
    cost: "free-paid",
    rank: (r) => (r === "ca" ? 2 : 0),
    signUp: () => googleFor("Páginas Amarillas Nicaragua registrar negocio"),
    search: siteSearch("paginasamarillas.com.ni"),
  },
  {
    id: "encuentra24",
    name: "Encuentra24",
    domain: "encuentra24.com",
    kind: "listing",
    regions: ["ca"],
    why: bi(
      "El sitio de clasificados más usado de Centroamérica: la gente busca servicios ahí y Google lo muestra arriba.",
      "Central America's most used classifieds site: people look for services there and Google ranks it high.",
    ),
    data: bi("Un anuncio de tu servicio con fotos reales, la descripción larga, teléfono y WhatsApp.", "An ad for your service with real photos, the long description, phone and WhatsApp."),
    cost: "free-paid",
    rank: (r) => (r === "ca" ? 2 : 0),
    signUp: () => "https://www.encuentra24.com/",
    search: siteSearch("encuentra24.com"),
  },
  {
    id: "cylex",
    name: "Cylex",
    domain: "cylex.net",
    kind: "listing",
    regions: ["ca", "other"],
    why: bi("Directorio internacional de negocios; un enlace más con tus datos iguales.", "International business directory; one more link with matching details."),
    data: NAP_DATA,
    cost: "free",
    rank: () => 1,
    signUp: () => googleFor("Cylex agregar empresa"),
    search: (c) => googleFor(`cylex "${c.name}"`),
  },
  {
    id: "infobel",
    name: "Infobel",
    domain: "infobel.com",
    kind: "listing",
    regions: ["ca", "other"],
    why: bi("Directorio internacional que otros sitios copian; mejor que tus datos estén correctos ahí.", "International directory other sites copy from; better to have your details right there."),
    data: NAP_DATA,
    cost: "free",
    rank: () => 1,
    signUp: () => "https://www.infobel.com/",
    search: siteSearch("infobel.com"),
  },
];

export const ALL_DIRECTORY_IDS = DEFS.map((d) => d.id);

/** Los directorios para un negocio: del más importante al menos, con sus enlaces ya armados con el nombre y la ciudad. */
export function directoriesFor(input: { region: Region; kind: BizKind; florida?: boolean; name: string; city?: string }): (Directory & { searchUrl: string })[] {
  const c: Ctx = { name: input.name.trim(), city: (input.city ?? "").trim() };
  const s = { florida: !!input.florida };
  const out: (Directory & { searchUrl: string; order: number })[] = [];
  DEFS.forEach((d, order) => {
    if (!d.regions.includes(input.region)) return;
    const priority = d.rank(input.region, input.kind, s);
    if (!priority) return;
    const { regions, rank, signUp, search, ...rest } = d;
    void regions;
    void rank;
    out.push({ ...rest, priority, signUpUrl: signUp(c, input.region), searchUrl: search ? search(c) : "", order });
  });
  out.sort((a, b) => b.priority - a.priority || a.order - b.order);
  return out.map(({ order, ...d }) => {
    void order;
    return d;
  });
}

/** El directorio de una clave (para mostrar su nombre en el plan). */
export const directoryName = (id: string) => DEFS.find((d) => d.id === id)?.name ?? id;

// ---------- País y tipo de negocio ----------

const CENTRAL_AMERICA = new Set(["NI", "CR", "HN", "GT", "SV", "PA", "BZ"]);
const PHONE_PREFIX: [string, string][] = [
  ["505", "NI"],
  ["506", "CR"],
  ["504", "HN"],
  ["502", "GT"],
  ["503", "SV"],
  ["507", "PA"],
  ["501", "BZ"],
];
const COUNTRY_WORDS: [RegExp, string][] = [
  [/\bnicaragua\b|\bmanagua\b|\bmasaya\b|\bgranada\b|\ble[oó]n\b|\bestel[ií]\b|\bchinandega\b/i, "NI"],
  [/\bcosta rica\b|\bsan jos[eé]\b/i, "CR"],
  [/\bhonduras\b|\btegucigalpa\b/i, "HN"],
  [/\bguatemala\b/i, "GT"],
  [/\bel salvador\b/i, "SV"],
  [/\bpanam[aá]\b/i, "PA"],
  [/\bunited states\b|\bestados unidos\b|\busa\b|\bflorida\b|\bmiami\b|\btexas\b|\bcalifornia\b|\bnew york\b/i, "US"],
];
/** Códigos de área de Florida (para saber si un ajustador necesita la licencia de Florida). */
const FL_AREA = new Set(["239", "305", "321", "324", "352", "386", "407", "448", "561", "645", "656", "689", "727", "754", "772", "786", "813", "850", "863", "904", "941", "954"]);
const AREA_CITY: Record<string, string> = { "305": "Miami", "786": "Miami", "954": "Fort Lauderdale", "754": "Fort Lauderdale", "561": "West Palm Beach", "407": "Orlando", "813": "Tampa" };

/** Terminaciones de 2 letras que se usan sin importar el país. */
const GENERIC_TLD = new Set(["co", "io", "ai", "me", "tv", "ly", "fm", "so", "to", "cc", "ws", "gg", "app"]);

const digitsOf = (s: string) => s.replace(/\D/g, "");

/** País (ISO de 2 letras) por el teléfono: +505… → NI; 10 dígitos o +1 → US. "" si no se sabe. */
export function phoneCountry(phone: string): string {
  const raw = phone.trim();
  let d = digitsOf(raw);
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  const intl = raw.startsWith("+") || raw.startsWith("00");
  if (intl || d.length > 10) {
    for (const [p, c] of PHONE_PREFIX) if (d.startsWith(p)) return c;
    if (d.startsWith("1") && d.length === 11) return "US";
    return "";
  }
  if (d.length === 10) return "US";
  if (d.length === 8 && !intl) return "";
  return "";
}

export type PlaceInput = {
  /** Del lugar en Google Maps o de la zona (businessPlace en media-formats.ts). */
  countryCode?: string;
  country?: string;
  state?: string;
  city?: string;
  /** Nombres de las zonas de SEO. */
  zones?: string[];
  phone?: string;
  website?: string;
  /** Perfil del negocio, estudio… (texto libre). */
  text?: string;
};

export type BizPlace = { region: Region; country: string; florida: boolean; city: string };

/** De qué país es el negocio (y si está en Florida), con lo que se sepa: mapa, zonas, teléfono, página, estudio. */
export function detectPlace(p: PlaceInput): BizPlace {
  const zones = (p.zones ?? []).join(" | ");
  const tld = (p.website ?? "").toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0].split(".").pop() ?? "";
  const fromWords = (s: string) => COUNTRY_WORDS.find(([re]) => re.test(s))?.[1] ?? "";
  const country =
    (p.countryCode ?? "").toUpperCase() ||
    fromWords(p.country ?? "") ||
    fromWords(zones) ||
    phoneCountry(p.phone ?? "") ||
    (tld === "us" ? "US" : tld.length === 2 && !GENERIC_TLD.has(tld) ? tld.toUpperCase() : "") ||
    fromWords(p.text ?? "");
  const region: Region = country === "US" ? "us" : CENTRAL_AMERICA.has(country) ? "ca" : "other";
  const area = (() => {
    const d = digitsOf(p.phone ?? "");
    const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d.length === 10 ? d : "";
    return ten.slice(0, 3);
  })();
  const flText = `${p.state ?? ""} | ${zones} | ${p.city ?? ""} | ${p.text ?? ""}`;
  const florida = region === "us" && (/\bflorida\b|\bFL\b|\bmiami\b|\bbroward\b|\bpalm beach\b|\borlando\b|\btampa\b/i.test(flText) || FL_AREA.has(area));
  const city = (p.city ?? "").trim() || (zones ? (p.zones ?? [])[0].split(",")[0].trim() : "") || (region === "us" ? (AREA_CITY[area] ?? "") : "");
  // Una zona que es todo el país no sirve como ciudad.
  const cleanCity = /^(nicaragua|united states|estados unidos|costa rica|honduras|guatemala|el salvador|panam[aá])$/i.test(city) ? "" : city;
  return { region, country, florida, city: cleanCity };
}

const ADJUSTER_RE = /public (insurance )?adjust|ajustador|adjuster|reclamos? (de|a la|al) segur|insurance claim|claims? (help|denied|negad)/i;
const HOME_RE =
  /roof|techo|puerta|port[oó]n|cortina|door|gate|plomer|plumb|electric|hvac|aire acondicionado|contractor|contratista|remodel|instalaci|reparaci|limpieza|cleaning|pest|fumig|landscap|jard[ií]n|pintur|painting|cerrajer|locksmith|construc|soldadura|weld|ventana|window|piso|floor/i;

/** Qué tipo de negocio es (por su perfil, estudio y palabras clave). */
export function detectKind(text: string): BizKind {
  if (ADJUSTER_RE.test(text)) return "adjuster";
  if (HOME_RE.test(text)) return "home";
  return "general";
}

// ---------- NAP: nombre, dirección y teléfono iguales en todos lados ----------

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

const LEGAL = new Set(["llc", "inc", "corp", "corporation", "co", "ltd", "sa", "srl", "pa", "pllc", "lp", "llp", "company", "cia", "the"]);

/** Nombre comparable: minúsculas, sin acentos ni signos, sin «LLC», «Inc.», «S.A.»… */
export function normName(s: string): string {
  return stripAccents(s.toLowerCase())
    .replace(/&/g, " and ")
    .replace(/\b([a-z])\.(?=[a-z]\.)/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !LEGAL.has(w))
    .join(" ");
}

/** Solo los dígitos del teléfono (sin el 00 internacional). */
export function phoneDigits(s: string): string {
  const d = digitsOf(s);
  return d.startsWith("00") ? d.slice(2) : d;
}

/** El mismo teléfono escrito distinto: (305) 394-8090 = +1 305-394-8090 = 3053948090; 8888-8888 = +505 8888 8888. */
export function samePhone(a: string, b: string): boolean {
  const x = phoneDigits(a);
  const y = phoneDigits(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 7 && long.endsWith(short) && long.length - short.length <= 3;
}

const ABBR: Record<string, string> = {
  street: "st", str: "st", avenue: "ave", av: "ave", avenida: "ave", boulevard: "blvd", bulevar: "blvd", drive: "dr", road: "rd", lane: "ln", court: "ct", place: "pl",
  highway: "hwy", parkway: "pkwy", terrace: "ter", circle: "cir", square: "sq", suite: "ste", apartment: "apt", building: "bldg", floor: "fl", north: "n", south: "s", east: "e",
  west: "w", northwest: "nw", northeast: "ne", southwest: "sw", southeast: "se", kilometro: "km", carretera: "carr", calle: "c", edificio: "edif", numero: "no",
};
const US_STATE_ABBR: Record<string, string> = {
  florida: "fl", texas: "tx", california: "ca", georgia: "ga", "new york": "ny", "new jersey": "nj", "north carolina": "nc", "south carolina": "sc", louisiana: "la", alabama: "al",
};
/** Palabras que se pueden omitir sin cambiar la dirección (país, «suite», «de»…). */
const SOFT = new Set([
  "usa", "us", "united", "states", "america", "eeuu", "estados", "unidos", "nicaragua", "costa", "rica", "honduras", "guatemala", "salvador", "panama", "el", "la", "de", "del", "los", "las",
  "ste", "apt", "unit", "no", "y", "and", "frente", "a",
]);

/** Dirección comparable: minúsculas, sin acentos, abreviaturas iguales (Street → st, Suite → ste), código postal de 5. */
export function normAddress(s: string): string[] {
  let t = stripAccents(s.toLowerCase());
  for (const [full, ab] of Object.entries(US_STATE_ABBR)) t = t.replace(new RegExp(`\\b${full}\\b`, "g"), ab);
  t = t
    .replace(/\b([nsew])\.\s?([nsew])\.?(?=\s|,|$)/g, "$1$2")
    .replace(/\b(\d{5})-\d{4}\b/g, "$1")
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1")
    .replace(/[^a-z0-9]+/g, " ");
  return t
    .split(" ")
    .filter(Boolean)
    .map((w) => ABBR[w] ?? w);
}

/** La misma dirección escrita distinto (una puede omitir el país, el código postal o «Suite»). */
export function sameAddress(a: string, b: string): boolean {
  const x = normAddress(a);
  const y = normAddress(b);
  if (!x.length || !y.length) return false;
  const hard = (l: string[]) => l.filter((w) => !SOFT.has(w));
  const hx = hard(x);
  const hy = hard(y);
  const sx = new Set(hx);
  const sy = new Set(hy);
  if (hx.length === hy.length && hx.every((w) => sy.has(w))) return true;
  const [small, big] = sx.size <= sy.size ? [sx, sy] : [sy, sx];
  if (![...small].every((w) => big.has(w))) return false;
  // Lo que sobra solo puede ser el código postal o el estado (no la calle ni el número).
  const extra = [...big].filter((w) => !small.has(w));
  return small.size >= 3 && extra.every((w) => /^\d{5}$/.test(w) || Object.values(US_STATE_ABBR).includes(w));
}

/** Dominio comparable: sin https, www ni rutas. */
export function normDomain(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\d*\./, "")
    .split(/[/?#]/)[0]
    .replace(/\.$/, "");
}

export type NapField = "name" | "phone" | "address" | "website";
export type NapSourceId = "app" | "gbp" | "maps";
export type NapValues = Partial<Record<NapField, string>>;
export type NapSource = { id: NapSourceId; values: NapValues };

export const NAP_SOURCE_LABEL: Record<NapSourceId, Bi> = {
  app: bi("tus datos en la app", "your details in the app"),
  gbp: bi("tu Perfil de Google", "your Google profile"),
  maps: bi("tu lugar en Google Maps (elegido para el mapa de calor)", "your Google Maps place (picked for the heatmap)"),
};
export const NAP_FIELD_LABEL: Record<NapField, Bi> = {
  name: bi("Nombre", "Name"),
  phone: bi("Teléfono", "Phone"),
  address: bi("Dirección", "Address"),
  website: bi("Página web", "Website"),
};

export type NapIssue = {
  field: NapField;
  /** different = no coinciden · extra-words = Google tiene palabras de más en el nombre · missing = falta en Google. */
  kind: "different" | "extra-words" | "missing";
  official: string;
  other: string;
  source: NapSourceId;
};

/** Los datos oficiales del negocio: los de la app primero; lo que falte, de Google. */
export function officialNap(sources: NapSource[]): Required<NapValues> {
  const pick = (f: NapField) => sources.map((s) => (s.values[f] ?? "").trim()).find(Boolean) ?? "";
  return { name: pick("name"), phone: pick("phone"), address: pick("address"), website: pick("website") };
}

/** Diferencias entre los datos oficiales y los de cada fuente (lo que la app puede saber, sin buscar en internet). */
export function napIssues(sources: NapSource[]): NapIssue[] {
  const official = officialNap(sources);
  const out: NapIssue[] = [];
  const seen = new Set<string>();
  const add = (i: NapIssue) => {
    const key = `${i.field}|${i.kind}|${i.other}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(i);
  };
  for (const s of sources) {
    for (const field of ["name", "phone", "address", "website"] as NapField[]) {
      const off = official[field];
      const v = (s.values[field] ?? "").trim();
      if (!off) continue;
      if (!v) {
        if (s.id === "gbp" && (field === "phone" || field === "website")) add({ field, kind: "missing", official: off, other: "", source: s.id });
        continue;
      }
      if (v === off) continue;
      if (field === "name") {
        const a = normName(off);
        const b = normName(v);
        if (a === b) continue;
        const aw = a.split(" ");
        const bw = new Set(b.split(" "));
        add({ field, kind: aw.every((w) => bw.has(w)) && bw.size > aw.length ? "extra-words" : "different", official: off, other: v, source: s.id });
      } else if (field === "phone") {
        if (!samePhone(off, v)) add({ field, kind: "different", official: off, other: v, source: s.id });
      } else if (field === "address") {
        if (!sameAddress(off, v)) add({ field, kind: "different", official: off, other: v, source: s.id });
      } else if (normDomain(off) !== normDomain(v)) add({ field, kind: "different", official: off, other: v, source: s.id });
    }
  }
  return out;
}

/** Una frase por diferencia (para la tarjeta y el plan de acción). */
export function napIssueText(i: NapIssue): Bi {
  const src = NAP_SOURCE_LABEL[i.source];
  const f = NAP_FIELD_LABEL[i.field];
  if (i.kind === "missing")
    return bi(`${f.es}: falta en ${src.es} (debería decir «${i.official}»).`, `${f.en}: missing on ${src.en} (it should say “${i.official}”).`);
  if (i.kind === "extra-words")
    return bi(
      `${f.es}: en ${src.es} dice «${i.other}», con palabras de más. Google pide usar solo el nombre real («${i.official}»); poner palabras clave en el nombre puede hacer que te suspendan.`,
      `${f.en}: ${src.en} says “${i.other}”, with extra words. Google asks you to use only your real name (“${i.official}”); stuffing keywords in the name can get you suspended.`,
    );
  return bi(`${f.es}: en ${src.es} dice «${i.other}», pero el oficial es «${i.official}».`, `${f.en}: ${src.en} says “${i.other}”, but the official one is “${i.official}”.`);
}

// ---------- Link de reseñas de Google ----------

/** El ID del lugar de Google (place_id): del Perfil de Google guardado o del lugar elegido en el mapa. */
export function placeIdOf(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const v = (c ?? "").trim();
    if (/^[A-Za-z0-9_-]{10,300}$/.test(v)) return v;
  }
  return "";
}

/** El link que abre directo la ventana para dejar una reseña en Google. "" si no hay place_id. */
export function googleReviewLink(placeId: string): string {
  const id = placeIdOf(placeId);
  return id ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(id)}` : "";
}

// ---------- Avance ----------

export type ListingLike = { directory: string; status: string; napOk?: boolean | null };

/** Estado de cada directorio: lo guardado o, para Google, "listed" si ya sabemos de tu perfil. */
export function effectiveStatus(dirId: string, listings: ListingLike[], opts: { googleKnown?: boolean } = {}): ListingStatus {
  const row = listings.find((l) => l.directory === dirId);
  if (row && isListingStatus(row.status) && (row.status !== "todo" || dirId !== "google" || !opts.googleKnown)) return row.status;
  if (dirId === "google" && opts.googleKnown) return "listed";
  return "todo";
}

/** «X de Y directorios importantes» (prioridad 2 o 3; los que el dueño marcó «no aplica» no cuentan). */
export function listingProgress(dirs: Pick<Directory, "id" | "priority">[], listings: ListingLike[], opts: { googleKnown?: boolean } = {}): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const d of dirs) {
    if (d.priority < 2) continue;
    const st = effectiveStatus(d.id, listings, opts);
    if (st === "skip") continue;
    total++;
    if (st === "listed" || st === "claimed") done++;
  }
  return { done, total };
}

// ---------- Descripción (sin IA) ----------

export type NapDescriptions = { shortEs: string; shortEn: string; longEs: string; longEn: string };

const cut = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const c = t.slice(0, max);
  const dot = Math.max(c.lastIndexOf(". "), c.lastIndexOf("."));
  return (dot > max * 0.6 ? c.slice(0, dot + 1) : c.slice(0, c.lastIndexOf(" ")) + "…").trim();
};

/** Descripciones de respaldo (cuando la IA no está o falla): con los servicios, la zona y las palabras clave. */
export function templateDescriptions(input: { name: string; services: string[]; city: string; keywords: string[]; phone?: string }): NapDescriptions {
  const svc = input.services.filter(Boolean).slice(0, 4);
  const kw = input.keywords.filter(Boolean).slice(0, 4);
  const where = input.city ? ` en ${input.city}` : "";
  const whereEn = input.city ? ` in ${input.city}` : "";
  const list = (l: string[], and: string) => (l.length <= 1 ? (l[0] ?? "") : `${l.slice(0, -1).join(", ")} ${and} ${l[l.length - 1]}`);
  const svcEs = svc.length ? list(svc, "y").toLowerCase() : "servicios para tu negocio y tu casa";
  const svcEn = svc.length ? list(svc, "and").toLowerCase() : "services for your home and business";
  // Las búsquedas tal como se escriben («cortinas metálicas managua») suenan raro en una frase: solo se usan las que
  // no repiten la ciudad ni el país, y solo si no hay servicios del estudio.
  const place = new RegExp(`\\b(${[input.city, "nicaragua", "miami", "florida"].filter(Boolean).map((x) => x.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
  const natural = svc.length ? [] : kw.filter((k) => !place.test(k)).slice(0, 3);
  const kwEs = natural.length ? ` Especialistas en ${list(natural, "y")}.` : "";
  const kwEn = natural.length ? ` Specialists in ${list(natural, "and")}.` : "";
  const shortEs = cut(`${input.name}: ${svcEs}${where}. Llámanos para una cotización.`, 160);
  const shortEn = cut(`${input.name}: ${svcEn}${whereEn}. Call us for a quote.`, 160);
  const longEs = cut(
    `${input.name} ofrece ${svcEs}${where}.${kwEs} Atención personal, trabajo garantizado y respuesta rápida.${input.phone ? ` Llámanos al ${input.phone}.` : " Escríbenos o llámanos para una cotización."}`,
    750,
  );
  const longEn = cut(
    `${input.name} offers ${svcEn}${whereEn}.${kwEn} Personal service, quality work and a fast response.${input.phone ? ` Call us at ${input.phone}.` : " Message or call us for a quote."}`,
    750,
  );
  return { shortEs, shortEn, longEs, longEn };
}

/** Lee descripciones guardadas sin confiar en su forma. null si no sirven. */
export function readDescriptions(v: unknown): NapDescriptions | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const s = (k: string, max: number) => (typeof o[k] === "string" ? (o[k] as string).trim().slice(0, max) : "");
  const d = { shortEs: s("shortEs", 300), shortEn: s("shortEn", 300), longEs: s("longEs", 1000), longEn: s("longEn", 1000) };
  return d.shortEs || d.longEs || d.shortEn || d.longEn ? d : null;
}
