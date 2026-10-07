// Datos de la foto (EXIF, XMP e IPTC): el negocio como autor, el lugar, las palabras clave y la
// descripción. Se escriben directo en el archivo, sin volver a comprimir la imagen.
//
// Importante: NUNCA se borra ni se cambia lo que el proveedor de IA pone para decir que la imagen
// fue hecha con IA. Si el archivo trae credenciales de contenido (C2PA), no se toca nada (cualquier
// cambio las invalidaría). Y nunca se escribe que es una foto real: solo negocio, lugar y palabras.
import { crc32 } from "zlib";

export type PhotoMeta = {
  /** Autor y dueño de los derechos: el nombre del negocio. */
  creator: string;
  title?: string;
  /** Texto alternativo / descripción de la imagen. */
  description?: string;
  keywords?: string[];
  city?: string;
  state?: string;
  country?: string;
  countryCode?: string;
  /** Dirección o zona (sin datos privados de clientes). */
  location?: string;
  gps?: { lat: number; lng: number };
  website?: string;
  year?: number;
};

/** Lo que dice el archivo sobre su origen (para conservarlo en las copias). */
export type Provenance = { c2pa: boolean; digitalSourceType?: string; creatorTool?: string; credit?: string };

type Segment = { marker: number; data: Buffer };

const isJpeg = (b: Buffer) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (b: Buffer) => b.length > 8 && b.subarray(0, 8).equals(PNG_SIG);
const XMP_NS = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1");
const EXIF_NS = Buffer.from("Exif\0\0", "latin1");
const PS_NS = Buffer.from("Photoshop 3.0\0", "latin1");

/** Separa los segmentos de un JPEG hasta el comienzo de la imagen (SOS). */
function jpegSegments(b: Buffer): { segments: Segment[]; rest: Buffer } | null {
  if (!isJpeg(b)) return null;
  const segments: Segment[] = [];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xda) return { segments, rest: b.subarray(i) };
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) return null;
    segments.push({ marker, data: b.subarray(i + 4, i + 2 + len) });
    i += 2 + len;
  }
  return null;
}

/** PNG: lista de bloques (chunks). */
function pngChunks(b: Buffer): { type: string; data: Buffer }[] | null {
  if (!isPng(b)) return null;
  const out: { type: string; data: Buffer }[] = [];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    const type = b.toString("latin1", i + 4, i + 8);
    if (i + 12 + len > b.length) return null;
    out.push({ type, data: b.subarray(i + 8, i + 8 + len) });
    i += 12 + len;
    if (type === "IEND") break;
  }
  return out;
}

const hasC2paJpeg = (segs: Segment[]) => segs.some((s) => s.marker === 0xeb && (s.data.includes("jumb") || s.data.includes("c2pa")));

function xmpText(b: Buffer): string {
  const segs = jpegSegments(b);
  if (segs) {
    const x = segs.segments.find((s) => s.marker === 0xe1 && s.data.subarray(0, XMP_NS.length).equals(XMP_NS));
    return x ? x.data.subarray(XMP_NS.length).toString("utf8") : "";
  }
  const chunks = pngChunks(b);
  const x = chunks?.find((c) => c.type === "iTXt" && c.data.toString("latin1", 0, 17) === "XML:com.adobe.xmp");
  return x ? x.data.subarray(x.data.indexOf(0, 17) + 5).toString("utf8").replace(/^[^<]*/, "") : "";
}

/** Busca un valor en el XMP, ya sea como atributo (ns:Name="…") o como elemento (<ns:Name>…</ns:Name>). */
function xmpValue(xmp: string, name: string): string | undefined {
  const esc = name.replace(":", "\\:");
  const attr = new RegExp(`${esc}="([^"]*)"`).exec(xmp);
  if (attr) return unescapeXml(attr[1]);
  const el = new RegExp(`<${esc}>(?:\\s*<rdf:Alt>\\s*<rdf:li[^>]*>)?([^<]*)<`).exec(xmp);
  return el ? unescapeXml(el[1].trim()) || undefined : undefined;
}

/** Lo que el archivo dice sobre su origen: credenciales C2PA y si la IA lo marcó como generado. */
export function readProvenance(b: Buffer): Provenance {
  const segs = jpegSegments(b);
  const chunks = segs ? null : pngChunks(b);
  const c2pa = segs ? hasC2paJpeg(segs.segments) : Boolean(chunks?.some((c) => c.type === "caBX"));
  const xmp = xmpText(b);
  return {
    c2pa,
    digitalSourceType: xmpValue(xmp, "Iptc4xmpExt:DigitalSourceType"),
    creatorTool: xmpValue(xmp, "xmp:CreatorTool"),
    credit: xmpValue(xmp, "photoshop:Credit"),
  };
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unescapeXml = (s: string) => s.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
const clean = (s: string | undefined, max: number) => (s ?? "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Coordenada GPS en el formato de XMP: "25,46.5123N". */
function xmpGps(v: number, pos: string, neg: string): string {
  const a = Math.abs(v);
  const deg = Math.floor(a);
  return `${deg},${((a - deg) * 60).toFixed(4)}${v >= 0 ? pos : neg}`;
}

const copyrightOf = (m: PhotoMeta) => `© ${m.year ?? new Date().getFullYear()} ${clean(m.creator, 120)}`;

/** Paquete XMP con los datos del negocio (y lo que el archivo ya decía sobre su origen). */
export function buildXmp(m: PhotoMeta, keep: Omit<Provenance, "c2pa"> = {}): string {
  const attrs: [string, string | undefined][] = [
    ["photoshop:City", clean(m.city, 64)],
    ["photoshop:State", clean(m.state, 64)],
    ["photoshop:Country", clean(m.country, 64)],
    ["photoshop:Credit", keep.credit || clean(m.creator, 120)],
    ["Iptc4xmpCore:CountryCode", clean(m.countryCode, 3)],
    ["Iptc4xmpCore:Location", clean(m.location, 200)],
    ["xmp:CreatorTool", keep.creatorTool],
    ["Iptc4xmpExt:DigitalSourceType", keep.digitalSourceType],
    ["exif:GPSLatitude", m.gps ? xmpGps(m.gps.lat, "N", "S") : undefined],
    ["exif:GPSLongitude", m.gps ? xmpGps(m.gps.lng, "E", "W") : undefined],
    ["xmpRights:Marked", "True"],
  ];
  const alt = (v: string) => `<rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(v)}</rdf:li></rdf:Alt>`;
  const kws = (m.keywords ?? []).map((k) => clean(k, 64)).filter(Boolean);
  const els = [
    `<dc:creator><rdf:Seq><rdf:li>${escapeXml(clean(m.creator, 120))}</rdf:li></rdf:Seq></dc:creator>`,
    `<dc:rights>${alt(copyrightOf(m))}</dc:rights>`,
    m.title ? `<dc:title>${alt(clean(m.title, 200))}</dc:title>` : "",
    m.description ? `<dc:description>${alt(clean(m.description, 1000))}</dc:description>` : "",
    kws.length ? `<dc:subject><rdf:Bag>${kws.map((k) => `<rdf:li>${escapeXml(k)}</rdf:li>`).join("")}</rdf:Bag></dc:subject>` : "",
    m.website ? `<xmpRights:WebStatement>${escapeXml(clean(m.website, 300))}</xmpRights:WebStatement>` : "",
    m.description ? `<Iptc4xmpCore:AltTextAccessibility>${alt(clean(m.description, 1000))}</Iptc4xmpCore:AltTextAccessibility>` : "",
  ].join("");
  const a = attrs.filter(([, v]) => v).map(([k, v]) => ` ${k}="${escapeXml(v!)}"`).join("");
  return (
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/" xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmlns:exif="http://ns.adobe.com/exif/1.0/"${a}>` +
    els +
    `</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`
  );
}

// ---------- EXIF (solo si el archivo no trae EXIF propio, por ejemplo de la cámara) ----------

type Entry = { tag: number; type: number; count: number; data: Buffer };
const ascii = (tag: number, s: string): Entry => {
  const data = Buffer.from(s + "\0", "utf8");
  return { tag, type: 2, count: data.length, data };
};
/** Etiquetas de Windows (XPTitle, XPKeywords…): texto UCS-2. */
const ucs2 = (tag: number, s: string): Entry => {
  const data = Buffer.concat([Buffer.from(s, "utf16le"), Buffer.from([0, 0])]);
  return { tag, type: 1, count: data.length, data };
};
const rationals = (tag: number, vals: [number, number][]): Entry => {
  const data = Buffer.alloc(vals.length * 8);
  vals.forEach(([n, d], i) => {
    data.writeUInt32LE(n, i * 8);
    data.writeUInt32LE(d, i * 8 + 4);
  });
  return { tag, type: 5, count: vals.length, data };
};

/** Escribe un IFD (little endian) que empieza en `start` (desde el inicio del TIFF). */
function ifd(entries: Entry[], start: number, next = 0): Buffer {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  const head = Buffer.alloc(2 + sorted.length * 12 + 4);
  head.writeUInt16LE(sorted.length, 0);
  const extra: Buffer[] = [];
  let off = start + head.length;
  sorted.forEach((e, i) => {
    const p = 2 + i * 12;
    head.writeUInt16LE(e.tag, p);
    head.writeUInt16LE(e.type, p + 2);
    head.writeUInt32LE(e.count, p + 4);
    if (e.data.length <= 4) e.data.copy(head, p + 8);
    else {
      head.writeUInt32LE(off, p + 8);
      const padded = e.data.length % 2 ? Buffer.concat([e.data, Buffer.from([0])]) : e.data;
      extra.push(padded);
      off += padded.length;
    }
  });
  head.writeUInt32LE(next, 2 + sorted.length * 12);
  return Buffer.concat([head, ...extra]);
}

function dms(v: number): [number, number][] {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const mFull = (a - d) * 60;
  const m = Math.floor(mFull);
  const s = Math.round((mFull - m) * 60 * 1000);
  return [[d, 1], [m, 1], [s, 1000]];
}

export function buildExif(m: PhotoMeta): Buffer {
  const entries: Entry[] = [ascii(0x013b, clean(m.creator, 120)), ascii(0x8298, copyrightOf(m))];
  if (m.description || m.title) entries.push(ascii(0x010e, clean(m.description || m.title, 1000)));
  if (m.title) entries.push(ucs2(0x9c9b, clean(m.title, 200)));
  const kws = (m.keywords ?? []).map((k) => clean(k, 64)).filter(Boolean);
  if (kws.length) entries.push(ucs2(0x9c9e, kws.join(";")));
  const tiffHead = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
  if (!m.gps) return Buffer.concat([EXIF_NS, tiffHead, ifd(entries, 8)]);
  // El puntero al GPS ocupa 4 bytes: primero se calcula el tamaño del IFD0 para saber dónde va el GPS.
  const ptr: Entry = { tag: 0x8825, type: 4, count: 1, data: Buffer.alloc(4) };
  const ifd0Len = ifd([...entries, ptr], 8).length;
  ptr.data.writeUInt32LE(8 + ifd0Len, 0);
  const gps = ifd(
    [
      { tag: 0x0000, type: 1, count: 4, data: Buffer.from([2, 3, 0, 0]) },
      ascii(0x0001, m.gps.lat >= 0 ? "N" : "S"),
      rationals(0x0002, dms(m.gps.lat)),
      ascii(0x0003, m.gps.lng >= 0 ? "E" : "W"),
      rationals(0x0004, dms(m.gps.lng)),
    ],
    8 + ifd0Len,
  );
  return Buffer.concat([EXIF_NS, tiffHead, ifd([...entries, ptr], 8), gps]);
}

// ---------- IPTC (IIM), el formato clásico que todavía leen muchos programas ----------

function iimRecord(rec: number, ds: number, value: Buffer): Buffer {
  const head = Buffer.from([0x1c, rec, ds, 0, 0]);
  head.writeUInt16BE(value.length, 3);
  return Buffer.concat([head, value]);
}
/** Corta un texto a `max` bytes sin romper letras (UTF-8). */
function bytes(s: string, max: number): Buffer {
  let b = Buffer.from(s, "utf8");
  while (b.length > max) {
    s = s.slice(0, -1);
    b = Buffer.from(s, "utf8");
  }
  return b;
}
export function buildIptc(m: PhotoMeta): Buffer {
  const recs: Buffer[] = [iimRecord(1, 90, Buffer.from([0x1b, 0x25, 0x47])), iimRecord(2, 0, Buffer.from([0, 4]))];
  if (m.title) recs.push(iimRecord(2, 5, bytes(clean(m.title, 200), 64)));
  for (const k of (m.keywords ?? []).map((k) => clean(k, 64)).filter(Boolean).slice(0, 30)) recs.push(iimRecord(2, 25, bytes(k, 64)));
  recs.push(iimRecord(2, 80, bytes(clean(m.creator, 120), 32)));
  if (m.city) recs.push(iimRecord(2, 90, bytes(clean(m.city, 64), 32)));
  if (m.location) recs.push(iimRecord(2, 92, bytes(clean(m.location, 200), 32)));
  if (m.state) recs.push(iimRecord(2, 95, bytes(clean(m.state, 64), 32)));
  if (m.country) recs.push(iimRecord(2, 101, bytes(clean(m.country, 64), 64)));
  recs.push(iimRecord(2, 110, bytes(clean(m.creator, 120), 32)));
  recs.push(iimRecord(2, 116, bytes(copyrightOf(m), 128)));
  if (m.description) recs.push(iimRecord(2, 120, bytes(clean(m.description, 2000), 2000)));
  const data = Buffer.concat(recs);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length, 0);
  const block = Buffer.concat([Buffer.from("8BIM", "latin1"), Buffer.from([0x04, 0x04, 0, 0]), size, data, data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
  return Buffer.concat([PS_NS, block]);
}

const seg = (marker: number, data: Buffer) => {
  if (data.length + 2 > 0xffff) throw new Error("Segmento demasiado grande");
  const h = Buffer.from([0xff, marker, 0, 0]);
  h.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([h, data]);
};

/**
 * Escribe los datos del negocio en la foto (JPEG o PNG) y la devuelve. No vuelve a comprimir la imagen.
 * Conserva el EXIF de la cámara, las marcas de IA y los demás datos; si la foto trae credenciales C2PA,
 * la devuelve tal cual. `keep` agrega marcas de origen que venían en la foto original (por ejemplo,
 * al recortar una foto hecha con IA, la copia sigue diciendo que se hizo con IA).
 */
export function writePhotoMeta(file: Buffer, m: PhotoMeta, keep: Omit<Provenance, "c2pa"> = {}): Buffer {
  try {
    if (!clean(m.creator, 120)) return file;
    const prov = readProvenance(file);
    if (prov.c2pa) return file;
    const merged = {
      digitalSourceType: prov.digitalSourceType ?? keep.digitalSourceType,
      creatorTool: prov.creatorTool ?? keep.creatorTool,
      credit: prov.credit ?? keep.credit,
    };
    const xmp = Buffer.from(buildXmp(m, merged), "utf8");
    const parsed = jpegSegments(file);
    if (parsed) {
      const { segments, rest } = parsed;
      const isXmp = (s: Segment) => s.marker === 0xe1 && s.data.subarray(0, XMP_NS.length).equals(XMP_NS);
      const hasExif = segments.some((s) => s.marker === 0xe1 && s.data.subarray(0, EXIF_NS.length).equals(EXIF_NS));
      const hasIptc = segments.some((s) => s.marker === 0xed && s.data.subarray(0, PS_NS.length).equals(PS_NS));
      const lead = segments.filter((s) => s.marker === 0xe0);
      const others = segments.filter((s) => s.marker !== 0xe0 && !isXmp(s));
      const ours = [
        ...(hasExif ? [] : [seg(0xe1, buildExif(m))]),
        seg(0xe1, Buffer.concat([XMP_NS, xmp])),
        ...(hasIptc ? [] : [seg(0xed, buildIptc(m))]),
      ];
      return Buffer.concat([Buffer.from([0xff, 0xd8]), ...lead.map((s) => seg(s.marker, s.data)), ...ours, ...others.map((s) => seg(s.marker, s.data)), rest]);
    }
    const chunks = pngChunks(file);
    if (chunks) {
      const kept = chunks.filter((c) => !(c.type === "iTXt" && c.data.toString("latin1", 0, 17) === "XML:com.adobe.xmp"));
      const itxt = Buffer.concat([Buffer.from("XML:com.adobe.xmp\0\0\0\0\0", "latin1"), xmp]);
      const out: Buffer[] = [PNG_SIG];
      for (const c of kept) {
        if (c.type === "IDAT" && !out.includes(itxt)) out.push(itxt);
        out.push(pngChunk(c.type, c.data));
      }
      return Buffer.concat(out.map((b) => (b === itxt ? pngChunk("iTXt", itxt) : b)));
    }
    return file;
  } catch {
    // Si algo sale mal, la foto se usa sin los datos (nunca se pierde la foto).
    return file;
  }
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0, 0);
  return Buffer.concat([len, td, crc]);
}
