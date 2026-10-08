// «Directorios y reseñas»: qué directorios tocan según el país y el negocio, la comparación de nombre/dirección/
// teléfono (NAP) con formatos distintos, el link de reseñas, el pedido de reseñas (reglas de Google, permiso y
// límite) y el código QR (lo leemos con un decodificador propio, independiente del que lo dibuja).
import { describe, expect, it } from "vitest";
import {
  detectKind,
  detectPlace,
  directoriesFor,
  effectiveStatus,
  googleReviewLink,
  listingProgress,
  napIssues,
  normName,
  officialNap,
  phoneCountry,
  placeIdOf,
  readDescriptions,
  sameAddress,
  samePhone,
  templateDescriptions,
  type NapSource,
} from "@/lib/directories";
import { alignmentPositions, byteCapacity, encodeQr, formatBits, qrSvg, rsDivisor, rsRemainder } from "@/lib/qr";
import { defaultTemplate, fillTemplate, firstName, hasLink, incentiveIssues, pickRecipients, sentInLogs, type ReqContact } from "@/lib/reviews-request";

const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const LINK = `https://search.google.com/local/writereview?placeid=${PLACE_ID}`;

// ---------- País y tipo de negocio ----------

describe("país del negocio", () => {
  it("Fameseg (zona Nicaragua, ciudad del estudio) → Centroamérica", () => {
    const p = detectPlace({ country: "Nicaragua", city: "Managua", zones: ["Nicaragua"], website: "https://fameseg.com" });
    expect(p).toMatchObject({ region: "ca", country: "NI", florida: false, city: "Managua" });
  });
  it("una zona que es todo el país no se usa como ciudad", () => {
    expect(detectPlace({ zones: ["Nicaragua"] })).toMatchObject({ region: "ca", city: "" });
  });
  it("ajustador en Miami solo con el teléfono 305 → EE. UU., Florida, Miami", () => {
    const p = detectPlace({ phone: "305-394-8090", website: "https://ricardopa.com" });
    expect(p).toMatchObject({ region: "us", country: "US", florida: true, city: "Miami" });
  });
  it("por el lugar de Google Maps (código del país) y por el estado", () => {
    expect(detectPlace({ countryCode: "US", state: "Texas", city: "Houston" })).toMatchObject({ region: "us", florida: false, city: "Houston" });
    expect(detectPlace({ countryCode: "us", state: "Florida", city: "Tampa" })).toMatchObject({ region: "us", florida: true });
  });
  it("por el prefijo del teléfono, la terminación de la página o el texto", () => {
    expect(phoneCountry("+505 8888 8888")).toBe("NI");
    expect(phoneCountry("00506 2222 3333")).toBe("CR");
    expect(phoneCountry("(305) 394-8090")).toBe("US");
    expect(phoneCountry("+1 786 555 0100")).toBe("US");
    expect(phoneCountry("8888-8888")).toBe("");
    expect(detectPlace({ website: "https://negocio.com.ni" }).country).toBe("NI");
    expect(detectPlace({ website: "https://startup.io" }).region).toBe("other");
    expect(detectPlace({ text: "Atendemos en Managua y Masaya" })).toMatchObject({ region: "ca", country: "NI" });
    expect(detectPlace({})).toMatchObject({ region: "other", country: "" });
  });
  it("tipo de negocio por lo que vende", () => {
    expect(detectKind("Ricardo Public Adjusters: ayudamos con reclamos de seguro negados en Miami")).toBe("adjuster");
    expect(detectKind("Ajustador público licenciado")).toBe("adjuster");
    expect(detectKind("Cortinas metálicas y portones automáticos en Managua")).toBe("home");
    expect(detectKind("Panadería artesanal")).toBe("general");
  });
});

describe("directorios por país y negocio", () => {
  const ids = (l: { id: string }[]) => l.map((d) => d.id);
  it("ajustador público en Florida: Google primero, BBB y la licencia del DFS imprescindibles, asociaciones de ajustadores", () => {
    const l = directoriesFor({ region: "us", kind: "adjuster", florida: true, name: "Ricardo Public Adjusters", city: "Miami" });
    expect(l[0].id).toBe("google");
    expect(ids(l)).toEqual(expect.arrayContaining(["bing", "apple", "yelp", "bbb", "nextdoor", "linkedin", "yellowpages", "manta", "foursquare", "chamber", "napia", "fapia", "fl-dfs", "facebook"]));
    expect(ids(l)).not.toContain("paginas-amarillas");
    expect(ids(l)).not.toContain("whatsapp");
    const by = Object.fromEntries(l.map((d) => [d.id, d]));
    expect(by.bbb.priority).toBe(3);
    expect(by["fl-dfs"]).toMatchObject({ priority: 3, kind: "check" });
    expect(by.napia.cost).toBe("paid");
    // Del más importante al menos.
    expect(l.map((d) => d.priority)).toEqual([...l.map((d) => d.priority)].sort((a, b) => b - a));
  });
  it("ajustador fuera de Florida: sin FAPIA ni DFS; un negocio que no es ajustador no ve NAPIA", () => {
    const tx = directoriesFor({ region: "us", kind: "adjuster", florida: false, name: "X", city: "Houston" });
    expect(ids(tx)).not.toContain("fapia");
    expect(ids(tx)).not.toContain("fl-dfs");
    expect(ids(tx)).toContain("napia");
    const home = directoriesFor({ region: "us", kind: "home", name: "X", city: "Miami" });
    expect(ids(home)).not.toContain("napia");
    expect(ids(home)).toEqual(expect.arrayContaining(["angi", "thumbtack"]));
  });
  it("Nicaragua: redes y directorios de la región, sin los de EE. UU.", () => {
    const l = directoriesFor({ region: "ca", kind: "home", name: "Fameseg", city: "Managua" });
    expect(ids(l)).toEqual(expect.arrayContaining(["google", "bing", "apple", "facebook", "instagram", "whatsapp", "waze", "paginas-amarillas", "encuentra24", "foursquare", "cylex", "infobel"]));
    for (const us of ["yelp", "bbb", "nextdoor", "angi", "fl-dfs", "napia", "yellowpages", "manta"]) expect(ids(l)).not.toContain(us);
    const by = Object.fromEntries(l.map((d) => [d.id, d]));
    expect(by.facebook.priority).toBe(3);
    expect(by.instagram.priority).toBe(3);
  });
  it("los enlaces de búsqueda llevan el nombre y la ciudad", () => {
    const us = Object.fromEntries(directoriesFor({ region: "us", kind: "adjuster", florida: true, name: "Ricardo Public Adjusters", city: "Miami" }).map((d) => [d.id, d]));
    expect(us.yelp.searchUrl).toBe("https://www.yelp.com/search?find_desc=Ricardo%20Public%20Adjusters&find_loc=Miami");
    expect(us.google.searchUrl).toBe("https://www.google.com/maps/search/Ricardo%20Public%20Adjusters%20Miami");
    expect(us.bbb.searchUrl).toContain("find_text=Ricardo%20Public%20Adjusters");
    expect(us.google.signUpUrl).toBe("https://business.google.com/create");
    const ni = Object.fromEntries(directoriesFor({ region: "ca", kind: "home", name: "Fameseg", city: "Managua" }).map((d) => [d.id, d]));
    expect(decodeURIComponent(ni["paginas-amarillas"].searchUrl)).toContain('site:paginasamarillas.com.ni "Fameseg" Managua');
    expect(ni.whatsapp.searchUrl).toBe("");
  });
});

// ---------- NAP ----------

describe("mismo teléfono escrito distinto", () => {
  it.each([
    ["(305) 394-8090", "+1 305-394-8090", true],
    ["305.394.8090", "3053948090", true],
    ["+1 (305) 394 8090", "1-305-394-8090", true],
    ["+505 8888 8888", "8888-8888", true],
    ["00505 8888 8888", "+505 8888-8888", true],
    ["305-394-8090", "305-394-8091", false],
    ["305-394-8090", "786-394-8090", false],
    ["", "305-394-8090", false],
  ])("%s = %s → %s", (a, b, same) => {
    expect(samePhone(a, b)).toBe(same);
  });
});

describe("misma dirección escrita distinto", () => {
  it.each([
    ["123 SW 8th Street, Suite 200, Miami, Florida 33130-1234, United States", "123 S.W. 8th St Ste 200, Miami, FL 33130", true],
    ["123 Southwest 8th Street, Miami, FL 33130", "123 SW 8 St, Miami, FL 33130, USA", true],
    ["123 SW 8th St, Miami, FL 33130", "123 SW 8th St, Miami, FL", true],
    ["Km 5 Carretera Norte, Managua, Nicaragua", "Kilómetro 5 carretera norte, Managua", true],
    ["123 SW 8th St, Miami, FL 33130", "125 SW 8th St, Miami, FL 33130", false],
    ["Km 5 Carretera Norte, Managua", "Km 5 Carretera Norte, Masaya", false],
    ["123 SW 8th St, Miami, FL 33130", "Miami, FL", false],
  ])("%s ≈ %s → %s", (a, b, same) => {
    expect(sameAddress(a, b)).toBe(same);
  });
});

describe("diferencias de nombre, dirección y teléfono", () => {
  it("el nombre sin S.A., LLC ni signos", () => {
    expect(normName("Fameseg, S.A.")).toBe(normName("FAMESEG"));
    expect(normName("Ricardo Public Adjusters LLC")).toBe("ricardo public adjusters");
    expect(normName("Cortinas & Portones")).toBe("cortinas and portones");
  });
  it("Google con palabras de más en el nombre, otro teléfono y sin página web", () => {
    const sources: NapSource[] = [
      { id: "app", values: { name: "Fameseg", phone: "+505 8888 8888", website: "https://fameseg.com/" } },
      { id: "gbp", values: { name: "Fameseg Cortinas Metálicas Managua", phone: "+505 7777 7777", address: "Km 5 Carretera Norte, Managua, Nicaragua", website: "" } },
      { id: "maps", values: { name: "Fameseg", address: "Kilómetro 5 Carretera Norte, Managua" } },
    ];
    const issues = napIssues(sources);
    expect(issues.map((i) => `${i.source}:${i.field}:${i.kind}`)).toEqual(["gbp:name:extra-words", "gbp:phone:different", "gbp:website:missing"]);
    expect(officialNap(sources)).toEqual({ name: "Fameseg", phone: "+505 8888 8888", address: "Km 5 Carretera Norte, Managua, Nicaragua", website: "https://fameseg.com/" });
  });
  it("los mismos datos con otro formato no son diferencias", () => {
    const issues = napIssues([
      { id: "app", values: { name: "Ricardo Public Adjusters", phone: "305-394-8090", website: "https://ricardopa.com" } },
      { id: "gbp", values: { name: "Ricardo Public Adjusters, LLC", phone: "+1 305-394-8090", address: "123 SW 8th St, Miami, FL 33130, USA", website: "http://www.ricardopa.com/inicio" } },
      { id: "maps", values: { name: "Ricardo Public Adjusters", address: "123 Southwest 8th Street, Miami, Florida 33130" } },
    ]);
    expect(issues).toEqual([]);
  });
  it("otro nombre distinto (no solo palabras de más) y otra dirección en el mapa", () => {
    const issues = napIssues([
      { id: "app", values: { name: "Fameseg" } },
      { id: "gbp", values: { name: "Portones Managua", address: "Km 5 Carretera Norte, Managua" } },
      { id: "maps", values: { address: "Km 9 Carretera Masaya, Managua" } },
    ]);
    expect(issues.map((i) => `${i.source}:${i.field}:${i.kind}`)).toEqual(["gbp:name:different", "maps:address:different"]);
  });
});

// ---------- Link de reseñas y avance ----------

describe("link de reseñas de Google", () => {
  it("arma el link con el place_id", () => {
    expect(googleReviewLink(PLACE_ID)).toBe(LINK);
    expect(googleReviewLink("")).toBe("");
    expect(googleReviewLink("no válido <script>")).toBe("");
  });
  it("toma el primer place_id válido (perfil, luego mapa)", () => {
    expect(placeIdOf(null, "", "bad id", PLACE_ID, "ChIJotherotherother")).toBe(PLACE_ID);
    expect(placeIdOf(undefined)).toBe("");
  });
});

describe("avance en directorios", () => {
  const dirs = directoriesFor({ region: "us", kind: "adjuster", florida: true, name: "R", city: "Miami" });
  it("Google cuenta como listo si ya conocemos tu perfil; «no aplica» no cuenta", () => {
    expect(effectiveStatus("google", [], { googleKnown: true })).toBe("listed");
    expect(effectiveStatus("google", [{ directory: "google", status: "needs-fix" }], { googleKnown: true })).toBe("needs-fix");
    expect(effectiveStatus("yelp", [{ directory: "yelp", status: "bogus" }])).toBe("todo");
    const important = dirs.filter((d) => d.priority >= 2).length;
    const p0 = listingProgress(dirs, []);
    expect(p0).toEqual({ done: 0, total: important });
    const p1 = listingProgress(dirs, [{ directory: "bing", status: "claimed" }, { directory: "napia", status: "skip" }, { directory: "manta", status: "listed" }], { googleKnown: true });
    // google + bing (manta es «extra», no cuenta); napia sale del total.
    expect(p1).toEqual({ done: 2, total: important - 1 });
  });
});

describe("descripciones de respaldo (sin IA)", () => {
  it("cortas para directorios y largas hasta 750 letras, con la ciudad y palabras clave", () => {
    const d = templateDescriptions({ name: "Fameseg", services: ["Cortinas metálicas", "Portones automáticos"], city: "Managua", keywords: ["cortinas metálicas managua", "portones automáticos nicaragua"], phone: "+505 8888 8888" });
    expect(d.shortEs.length).toBeLessThanOrEqual(160);
    expect(d.shortEn.length).toBeLessThanOrEqual(160);
    expect(d.longEs.length).toBeLessThanOrEqual(750);
    expect(d.shortEs).toContain("Managua");
    expect(d.longEs).toContain("ofrece cortinas metálicas y portones automáticos en Managua");
    // Las búsquedas con la ciudad pegada no se meten en la frase.
    expect(d.longEs).not.toContain("cortinas metálicas managua");
    const kwOnly = templateDescriptions({ name: "Fameseg", services: [], city: "Managua", keywords: ["cortinas metálicas managua", "portones automáticos", "motores para portones"] });
    expect(kwOnly.longEs).toContain("Especialistas en portones automáticos y motores para portones.");
    expect(templateDescriptions({ name: "X", services: [], city: "St. (Pete)", keywords: ["a"] }).longEs).toContain("Especialistas en a.");
    expect(d.longEn).toContain("in Managua");
    expect(readDescriptions(d)).toEqual(d);
    expect(readDescriptions({ foo: 1 })).toBeNull();
  });
});

// ---------- Pedir reseñas ----------

describe("pedir reseñas", () => {
  it("las plantillas no ofrecen nada a cambio y llevan el link", () => {
    for (const lang of ["es", "en"] as const) {
      const tpl = defaultTemplate(lang, { name: "Fameseg", slogan: "Seguridad que se ve", signer: "Ricardo" });
      expect(incentiveIssues(`${tpl.subject} ${tpl.email} ${tpl.sms}`)).toEqual([]);
      expect(hasLink(tpl.email, LINK)).toBe(true);
      expect(hasLink(tpl.sms, LINK)).toBe(true);
      expect(fillTemplate(tpl.sms, { name: "Ana", link: LINK }).length).toBeLessThanOrEqual(320);
    }
  });
  it("llena el nombre de pila y el link; sin nombre, el saludo queda bien", () => {
    expect(fillTemplate("Hola {nombre}: deja tu reseña aquí {link}", { name: "ana maría lópez", link: LINK })).toBe(`Hola Ana: deja tu reseña aquí ${LINK}`);
    expect(fillTemplate("Hola {nombre}: gracias", { name: "", link: LINK })).toBe("Hola: gracias");
    expect(fillTemplate("Hi {name}, thanks! {LINK}", { name: "John", link: LINK })).toBe(`Hi John, thanks! ${LINK}`);
    expect(firstName("info@x.com")).toBe("");
  });
  it("detecta incentivos y pedir 5 estrellas (regla de Google)", () => {
    expect(incentiveIssues("Déjanos tu reseña y te damos 10% de descuento")).toEqual(["descuento / discount"]);
    expect(incentiveIssues("Leave 5 stars and enter our giveaway!")).toEqual(["sorteo / giveaway", "5 estrellas / 5 stars"]);
    expect(incentiveIssues("Te regalamos un cupón")).toEqual(["regalo / gift", "cupón / coupon"]);
    expect(incentiveIssues("Gracias por tu confianza. Cuéntanos tu experiencia, sea cual sea.")).toEqual([]);
  });
  it("solo a quienes dieron permiso, sin repetir en 90 días y con límite por día", () => {
    const c = (id: string, extra: Partial<ReqContact> = {}): ReqContact => ({ id, name: id, email: `${id}@x.com`, phone: "+15550000000", emailOptIn: true, smsOptIn: false, ...extra });
    const contacts = [c("a"), c("b", { emailOptIn: false }), c("c"), c("d"), c("e", { email: "" }), c("f", { smsOptIn: true })];
    const r = pickRecipients(contacts, ["a", "b", "c", "d", "e", "f"], "email", new Set(["c"]), 2);
    expect(r.send.map((x) => x.id)).toEqual(["a", "d"]);
    expect(r).toMatchObject({ noConsent: 2, recent: 1, overLimit: 1 });
    const sms = pickRecipients(contacts, ["a", "f"], "sms", new Set(), 10);
    expect(sms.send.map((x) => x.id)).toEqual(["f"]);
    expect(sms.noConsent).toBe(1);
  });
  it("cuenta lo enviado hoy desde el registro", () => {
    expect(
      sentInLogs([
        { kind: "review.request", detail: { channel: "email", sent: 5, failed: 1, contactIds: [] } },
        { kind: "review.request", detail: { channel: "sms", sent: 3 } },
        { kind: "post.published", detail: { sent: 99 } },
      ]),
    ).toBe(8);
  });
});

// ---------- Código QR ----------

// Decodificador independiente: tablas de la norma (bloques del nivel M y alineación de las versiones 1-10), lectura en
// zigzag, máscara, corrección Reed-Solomon (síndromes en cero) y modo byte.
const M_BLOCKS: Record<number, { ecc: number; groups: [number, number][] }> = {
  1: { ecc: 10, groups: [[1, 16]] },
  2: { ecc: 16, groups: [[1, 28]] },
  3: { ecc: 26, groups: [[1, 44]] },
  4: { ecc: 18, groups: [[2, 32]] },
  5: { ecc: 24, groups: [[2, 43]] },
  6: { ecc: 16, groups: [[4, 27]] },
  7: { ecc: 18, groups: [[4, 31]] },
  8: { ecc: 22, groups: [[2, 38], [2, 39]] },
  9: { ecc: 22, groups: [[3, 36], [2, 37]] },
  10: { ecc: 26, groups: [[4, 43], [1, 44]] },
};
const ALIGN: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
// Información de formato publicada en la norma (bit 14 primero) para el nivel M, máscaras 0 a 7.
const FORMAT_M = ["101010000010010", "101000100100101", "101111001111100", "101101101001011", "100010111111001", "100000011001110", "100111110010111", "100101010100000"];

const EXP: number[] = [];
const LOG: number[] = new Array(256).fill(0);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
const gmul = (a: number, b: number) => (a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0);

const MASKS = [
  (r: number, c: number) => (r + c) % 2 === 0,
  (r: number) => r % 2 === 0,
  (_r: number, c: number) => c % 3 === 0,
  (r: number, c: number) => (r + c) % 3 === 0,
  (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r: number, c: number) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r: number, c: number) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r: number, c: number) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function decodeQr(m: boolean[][]): { text: string; version: number; mask: number } {
  const size = m.length;
  const ver = (size - 17) / 4;
  expect(Number.isInteger(ver) && ver >= 1 && ver <= 10).toBe(true);
  const b = (r: number, c: number) => (m[r][c] ? 1 : 0);
  // Patrones de búsqueda (7×7 con el centro de 3×3) en las tres esquinas.
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]])
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 7; c++) {
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        expect(b(r0 + r, c0 + c)).toBe(ring === 2 ? 0 : 1);
      }
  for (let i = 8; i < size - 8; i++) {
    expect(b(6, i)).toBe(i % 2 === 0 ? 1 : 0);
    expect(b(i, 6)).toBe(i % 2 === 0 ? 1 : 0);
  }
  expect(b(size - 8, 8)).toBe(1); // módulo oscuro
  // Formato: las dos copias iguales.
  const f1: number[] = [];
  for (let i = 0; i <= 5; i++) f1[i] = b(i, 8);
  f1[6] = b(7, 8);
  f1[7] = b(8, 8);
  f1[8] = b(8, 7);
  for (let i = 9; i < 15; i++) f1[i] = b(8, 14 - i);
  const f2: number[] = [];
  for (let i = 0; i < 8; i++) f2[i] = b(8, size - 1 - i);
  for (let i = 8; i < 15; i++) f2[i] = b(size - 15 + i, 8);
  expect(f2).toEqual(f1);
  const fmt = f1.map((x, i) => x << i).reduce((a, x) => a | x, 0);
  const mask = FORMAT_M.findIndex((s) => parseInt(s, 2) === fmt);
  expect(mask).toBeGreaterThanOrEqual(0);

  // Módulos fijos (no llevan datos).
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (r0: number, c0: number, h: number, w: number) => {
    for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) if (r >= 0 && c >= 0 && r < size && c < size) fixed[r][c] = true;
  };
  mark(0, 0, 9, 9);
  mark(0, size - 8, 9, 8);
  mark(size - 8, 0, 8, 9);
  mark(6, 0, 1, size);
  mark(0, 6, size, 1);
  const al = ALIGN[ver];
  for (const r of al)
    for (const c of al) {
      if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (r === al[al.length - 1] && c === 6)) continue;
      mark(r - 2, c - 2, 5, 5);
    }
  if (ver >= 7) {
    mark(0, size - 11, 6, 3);
    mark(size - 11, 0, 3, 6);
  }
  // Zigzag de abajo a la derecha, de dos en dos columnas, saltando la columna 6.
  const bits: number[] = [];
  let up = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < size; k++) {
      const r = up ? size - 1 - k : k;
      for (const c of [right, right - 1]) if (!fixed[r][c]) bits.push(b(r, c) ^ (MASKS[mask](r, c) ? 1 : 0));
    }
    up = !up;
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((a, x) => (a << 1) | x, 0));
  const layout = M_BLOCKS[ver];
  const lens = layout.groups.flatMap(([n, len]) => new Array<number>(n).fill(len));
  const blocks = lens.map(() => [] as number[]);
  let k = 0;
  for (let i = 0; i < Math.max(...lens); i++) lens.forEach((len, j) => i < len && blocks[j].push(codewords[k++]));
  for (let i = 0; i < layout.ecc; i++) blocks.forEach((bl) => bl.push(codewords[k++]));
  // Reed-Solomon: el código de cada bloque evaluado en α^0…α^(ecc-1) da cero.
  for (const bl of blocks)
    for (let i = 0; i < layout.ecc; i++) {
      let s = 0;
      for (const cw of bl) s = gmul(s, EXP[i]) ^ cw;
      expect(s).toBe(0);
    }
  const data = blocks.flatMap((bl, j) => bl.slice(0, lens[j]));
  const dbits = data.flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (byte >> i) & 1));
  let p = 0;
  const read = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | dbits[p++];
    return v;
  };
  expect(read(4)).toBe(0b0100); // modo byte
  const count = read(ver < 10 ? 8 : 16);
  const bytes = Uint8Array.from({ length: count }, () => read(8));
  return { text: new TextDecoder().decode(bytes), version: ver, mask };
}

describe("código QR", () => {
  it("Reed-Solomon: el ejemplo de la norma (1-M, «HELLO WORLD»)", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, rsDivisor(10))).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
  it("formato, capacidad y alineación según las tablas de la norma", () => {
    FORMAT_M.forEach((s, mask) => expect(formatBits("M", mask)).toBe(parseInt(s, 2)));
    expect(formatBits("L", 0)).toBe(parseInt("111011111000100", 2));
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => byteCapacity(v, "M"))).toEqual([14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
    expect(byteCapacity(40, "M")).toBe(2331);
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
  });
  it.each([
    ["link de reseñas", LINK],
    ["texto con acentos y emojis", "¡Gracias por tu reseña! ñandú ✓ 😊"],
    ["corto", "A"],
    ["largo (versión 7+, con información de versión)", `${LINK}&utm_source=tarjeta&utm_medium=qr&utm_campaign=resenas-${"x".repeat(40)}`],
  ])("se lee de vuelta: %s", (_n, text) => {
    const qr = encodeQr(text);
    expect(qr.ecc).toBe("M");
    expect(qr.size).toBe(qr.version * 4 + 17);
    const out = decodeQr(qr.modules);
    expect(out.text).toBe(text);
    expect(out.mask).toBe(qr.mask);
    expect(out.version).toBe(qr.version);
  });
  it("todas las máscaras se leen igual", () => {
    for (let mask = 0; mask < 8; mask++) expect(decodeQr(encodeQr(LINK, { mask }).modules)).toMatchObject({ text: LINK, mask });
  });
  it("elige la versión más chica donde cabe", () => {
    expect(encodeQr("x".repeat(14)).version).toBe(1);
    expect(encodeQr("x".repeat(15)).version).toBe(2);
    expect(encodeQr(LINK).version).toBe(5);
    expect(() => encodeQr("x".repeat(3000))).toThrow();
  });
  it("el SVG es solo un rectángulo y un trazo (sin texto ni scripts) y limpia los colores", () => {
    const svg = qrSvg(LINK, { margin: 4, dark: "#123456", light: "red; fill:url(javascript:1)" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).not.toMatch(/script|javascript|<text/i);
    const dim = encodeQr(LINK).size + 8;
    expect(svg).toContain(`viewBox="0 0 ${dim} ${dim}"`);
  });
});
