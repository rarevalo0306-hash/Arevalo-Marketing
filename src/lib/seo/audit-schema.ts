// Revisión de los datos estructurados (JSON-LD) de una página: JSON mal escrito, propiedades en el tipo equivocado
// (el error clásico: availableLanguage directo en LocalBusiness), negocio sin nombre/dirección/teléfono/web, horario mal
// escrito y Organization/WebSite incompletos. Sin dependencias: se recorre el JSON con funciones simples.

export type SchemaFindingKind = "invalid-json" | "wrong-property" | "business-incomplete" | "opening-hours" | "org-incomplete";

/** Un hallazgo con el valor exacto (ej. «LocalBusiness.availableLanguage → contactPoint (ContactPoint)»). */
export type SchemaFinding = { kind: SchemaFindingKind; value: string };

export type JsonLdResult = { found: boolean; types: string[]; findings: SchemaFinding[] };

const LD_RE = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;

/** Tipos que son un negocio local (LocalBusiness o un subtipo). */
const LOCAL_TYPES = new Set([
  "LocalBusiness", "ProfessionalService", "HomeAndConstructionBusiness", "Store", "Restaurant", "FoodEstablishment", "MedicalBusiness",
  "MedicalClinic", "Dentist", "Physician", "LegalService", "Attorney", "AutomotiveBusiness", "AutoRepair", "FinancialService",
  "InsuranceAgency", "RealEstateAgent", "HealthAndBeautyBusiness", "BeautySalon", "HairSalon", "DaySpa", "Plumber", "Electrician",
  "RoofingContractor", "GeneralContractor", "HVACBusiness", "Locksmith", "MovingCompany", "HousePainter", "AccountingService",
  "ChildCare", "EmergencyService", "EntertainmentBusiness", "LodgingBusiness", "Hotel", "Motel", "Hostel", "Resort",
  "BedAndBreakfast", "Campground", "VacationRental", "SportsActivityLocation", "TravelAgency", "EmploymentAgency", "Notary",
  "SelfStorage", "DryCleaningOrLaundry", "VeterinaryCare", "Pharmacy", "Optician", "AnimalShelter", "Library", "RecyclingCenter",
  "ShoppingCenter", "TouristInformationCenter", "GovernmentOffice", "InternetCafe", "RadioStation", "TelevisionStation", "CafeOrCoffeeShop",
  "Bakery", "BarOrPub", "FastFoodRestaurant", "AutoDealer", "AutoBodyShop", "ClothingStore", "HardwareStore", "HomeGoodsStore",
  "FurnitureStore", "ElectronicsStore", "Florist", "GardenStore", "JewelryStore", "PetStore", "TireShop", "Winery", "Brewery",
]);
const ORG_ONLY = new Set(["Organization", "Corporation", "NGO", "EducationalOrganization", "SportsOrganization", "OnlineBusiness", "NewsMediaOrganization", "MedicalOrganization", "GovernmentOrganization"]);
/** Tipos donde availableLanguage sí existe (hoteles y atracciones). */
const LANGUAGE_OK = new Set(["LodgingBusiness", "Hotel", "Motel", "Hostel", "Resort", "BedAndBreakfast", "Campground", "VacationRental", "TouristAttraction"]);

const isLocal = (types: string[]) => types.some((t) => LOCAL_TYPES.has(t) || (/(Business|Store|Contractor|Agency)$/.test(t) && !ORG_ONLY.has(t)));
const isOrg = (types: string[]) => !isLocal(types) && types.some((t) => ORG_ONLY.has(t));

/** Propiedades que la gente pone directo en el negocio pero van en otro tipo, y dónde van. */
const MISPLACED: Record<string, string> = {
  availableLanguage: "contactPoint (ContactPoint)",
  hoursAvailable: "contactPoint (ContactPoint)",
  contactType: "contactPoint (ContactPoint)",
  contactOption: "contactPoint (ContactPoint)",
  streetAddress: "address (PostalAddress)",
  addressLocality: "address (PostalAddress)",
  addressRegion: "address (PostalAddress)",
  postalCode: "address (PostalAddress)",
  addressCountry: "address (PostalAddress)",
  dayOfWeek: "openingHoursSpecification",
  opens: "openingHoursSpecification",
  closes: "openingHoursSpecification",
  ratingValue: "aggregateRating (AggregateRating)",
  reviewCount: "aggregateRating (AggregateRating)",
  ratingCount: "aggregateRating (AggregateRating)",
  bestRating: "aggregateRating (AggregateRating)",
  serviceType: "Service (makesOffer / hasOfferCatalog)",
  price: "Offer (makesOffer)",
  priceCurrency: "Offer (makesOffer)",
};

const DAY_ABBR = "(?:Mo|Tu|We|Th|Fr|Sa|Su)";
/** «Mo-Fr 09:00-18:00», «Mo,We,Fr 09:00-17:00», «Sa 10:00-14:00», «Mo-Su». */
const OPENING_HOURS_RE = new RegExp(`^${DAY_ABBR}(?:\\s*[-,]\\s*${DAY_ABBR})*(?:\\s+\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}(?:\\s*,\\s*\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2})*)?$`);
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?([+-]\d{2}:?\d{2}|Z)?$/;
const DAYS = new Set(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "PublicHolidays"]);

const typeList = (o: Record<string, unknown>): string[] => {
  const t = o["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string").map((x) => x.replace(/^https?:\/\/schema\.org\//, "").trim());
};

const present = (v: unknown) => v !== undefined && v !== null && !(typeof v === "string" && !v.trim()) && !(Array.isArray(v) && !v.length);

/** Solo una referencia a otro nodo ({"@type": "LocalBusiness", "@id": "…#negocio"}): no se le piden datos. */
const isReference = (o: Record<string, unknown>) => typeof o["@id"] === "string" && Object.keys(o).filter((k) => !k.startsWith("@")).length === 0;

const label = (types: string[]) => types.find((t) => t === "LocalBusiness") ?? types.find((t) => LOCAL_TYPES.has(t) || ORG_ONLY.has(t)) ?? types[0] ?? "Thing";

/** Revisa el horario de un nodo; devuelve los valores mal escritos. */
function badHours(o: Record<string, unknown>): string[] {
  const bad: string[] = [];
  const oh = o.openingHours;
  for (const v of Array.isArray(oh) ? oh : oh === undefined ? [] : [oh]) {
    if (typeof v !== "string") {
      bad.push(`openingHours: ${JSON.stringify(v).slice(0, 60)}`);
      continue;
    }
    // Algunos ponen varios horarios en un solo texto separados por «;» o salto de línea.
    for (const part of v.split(/[;\n]/).map((x) => x.trim()).filter(Boolean)) if (!OPENING_HOURS_RE.test(part)) bad.push(`openingHours: "${part.slice(0, 60)}"`);
  }
  const spec = o.openingHoursSpecification;
  for (const s of Array.isArray(spec) ? spec : spec ? [spec] : []) {
    if (!s || typeof s !== "object") continue;
    const x = s as Record<string, unknown>;
    for (const k of ["opens", "closes"] as const) {
      const v = x[k];
      if (v !== undefined && !(typeof v === "string" && TIME_RE.test(v.trim()))) bad.push(`${k}: ${JSON.stringify(v).slice(0, 40)}`);
    }
    const days = x.dayOfWeek;
    for (const d of Array.isArray(days) ? days : days === undefined ? [] : [days]) {
      const name = typeof d === "string" ? d.replace(/^https?:\/\/schema\.org\//, "").trim() : "";
      if (!DAYS.has(name)) bad.push(`dayOfWeek: ${JSON.stringify(d).slice(0, 40)}`);
    }
  }
  return bad;
}

/** Revisa los nodos ya leídos de un bloque JSON-LD. */
export function checkNodes(root: unknown): { types: string[]; findings: SchemaFinding[] } {
  const types = new Set<string>();
  const findings: SchemaFinding[] = [];
  // top = nodo principal (la raíz, una lista en la raíz o @graph); los anidados (publisher, author…) no se exigen completos.
  const walk = (v: unknown, depth: number, top: boolean) => {
    if (depth > 10 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1, top));
    const o = v as Record<string, unknown>;
    const ts = typeList(o);
    ts.forEach((t) => types.add(t));
    if (ts.length && !isReference(o)) {
      const name = label(ts);
      if (isLocal(ts) || isOrg(ts)) {
        for (const prop of Object.keys(o)) {
          const where = MISPLACED[prop];
          if (!where) continue;
          if (prop === "availableLanguage" && ts.some((t) => LANGUAGE_OK.has(t))) continue;
          findings.push({ kind: "wrong-property", value: `${name}.${prop} → ${where}` });
        }
        for (const h of badHours(o)) findings.push({ kind: "opening-hours", value: `${name} ${h}` });
      }
      if (!top) {
        /* anidado: no se le piden todos los datos */
      } else if (isLocal(ts)) {
        const missing = ["name", "address", "telephone", "url"].filter((k) => !present(o[k]));
        if (missing.length) findings.push({ kind: "business-incomplete", value: `${name}: ${missing.join(", ")}` });
      } else if (isOrg(ts)) {
        const missing = ["name", "url", "logo"].filter((k) => !present(o[k]));
        if (missing.length) findings.push({ kind: "org-incomplete", value: `${name}: ${missing.join(", ")}` });
      } else if (ts.includes("WebSite")) {
        const missing = ["name", "url"].filter((k) => !present(o[k]));
        if (missing.length) findings.push({ kind: "org-incomplete", value: `WebSite: ${missing.join(", ")}` });
      }
    }
    for (const k of Object.keys(o)) if (k !== "@type" && k !== "@context") walk(o[k], depth + 1, top && k === "@graph");
  };
  walk(root, 0, true);
  return { types: [...types], findings };
}

/** Lee y revisa todos los bloques JSON-LD de una página (el HTML sin comentarios). */
export function checkJsonLd(html: string): JsonLdResult {
  const types = new Set<string>();
  const findings: SchemaFinding[] = [];
  let found = false;
  for (const m of html.matchAll(LD_RE)) {
    const raw = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/^<!--|-->$/g, "").trim();
    if (!raw) continue;
    found = true;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      findings.push({ kind: "invalid-json", value: (e instanceof Error ? e.message : String(e)).slice(0, 120) });
      // Aunque esté roto, se intenta saber qué tipos quería decir.
      for (const t of raw.matchAll(/"@type"\s*:\s*"([^"]+)"/g)) types.add(t[1].replace(/^https?:\/\/schema\.org\//, ""));
      continue;
    }
    const r = checkNodes(data);
    r.types.forEach((t) => types.add(t));
    findings.push(...r.findings);
  }
  // Sin repetidos (el mismo error en dos bloques de la misma página cuenta una vez).
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const k = `${f.kind}|${f.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { found, types: [...types].slice(0, 20), findings: unique.slice(0, 12) };
}
