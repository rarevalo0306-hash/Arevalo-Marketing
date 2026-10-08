// Cloudflare R2 (compatible con S3): donde se guardan las fotos y videos que suben los técnicos con el link de subida.
// Sin librerías nuevas: las peticiones se firman con AWS Signature V4 (crypto de Node). Región "auto", servicio "s3".
// Configuración (Vercel): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET y R2_PUBLIC_URL
// (la dirección pública del bucket, por ejemplo https://pub-xxxx.r2.dev). Sin ellas, la subida por link queda apagada.
import { createHash, createHmac, randomBytes } from "crypto";
import { bi } from "@/lib/i18n";

// ---------- Firma AWS Signature V4 (sin red, para las pruebas) ----------

export const sha256Hex = (data: string | Buffer | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** Lo que pide S3 para la carga cuando no se firma el contenido (las subidas directas desde el navegador). */
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
/** sha256 de un cuerpo vacío (HEAD, DELETE). */
export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** Codificación RFC 3986 que pide SigV4 (encodeURIComponent deja ! ' ( ) * sin codificar). */
export const uriEncode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** La ruta del objeto codificada por partes (S3 no codifica dos veces y deja las "/"). */
export const encodePath = (path: string) => path.split("/").map(uriEncode).join("/");

/** 20130524T000000Z */
export const amzDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export type SigV4Creds = { accessKeyId: string; secretAccessKey: string; region: string; service: string };

/** La llave de firma del día: HMAC encadenado de fecha, región, servicio y "aws4_request". */
export function signingKey(secret: string, date8: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date8), region), service), "aws4_request");
}

function canonicalQuery(query: [string, string][]): string {
  return query
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

type SignInput = {
  method: string;
  host: string;
  /** Ruta ya codificada (ej. "/bucket/library/x.jpg"). */
  path: string;
  query: [string, string][];
  /** Cabeceras que se firman (además de host); los nombres se pasan a minúsculas. */
  headers: Record<string, string>;
  payloadHash: string;
  when: Date;
};

/** Calcula la firma. Devuelve la firma, las cabeceras firmadas y el "scope" del día. */
export function sigV4(input: SignInput, creds: SigV4Creds) {
  const stamp = amzDate(input.when);
  const date8 = stamp.slice(0, 8);
  const scope = `${date8}/${creds.region}/${creds.service}/aws4_request`;
  const all: Record<string, string> = { host: input.host };
  for (const [k, v] of Object.entries(input.headers)) all[k.toLowerCase()] = v;
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(all[n]).trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [input.method, input.path, canonicalQuery(input.query), canonicalHeaders, signedHeaders, input.payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(creds.secretAccessKey, date8, creds.region, creds.service)).update(stringToSign, "utf8").digest("hex");
  return { signature, signedHeaders, scope, stamp, canonicalRequest, stringToSign };
}

/**
 * Firma en las cabeceras (Authorization). `headers` debe traer x-amz-date y x-amz-content-sha256 si se quieren firmar
 * (S3 los pide); si no vienen, se agregan.
 */
export function signHeaders(
  req: { method: string; host: string; path: string; query?: [string, string][]; headers?: Record<string, string>; payloadHash: string; when: Date },
  creds: SigV4Creds,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = v;
  headers["x-amz-date"] ??= amzDate(req.when);
  headers["x-amz-content-sha256"] ??= req.payloadHash;
  const sig = sigV4({ method: req.method, host: req.host, path: req.path, query: req.query ?? [], headers, payloadHash: req.payloadHash, when: req.when }, creds);
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${sig.scope}, SignedHeaders=${sig.signedHeaders}, Signature=${sig.signature}`,
  };
}

/** Dirección prefirmada (la firma va en la dirección): quien la tenga puede hacer esa petición hasta que venza. */
export function presignUrl(
  req: { method: string; protocol?: string; host: string; path: string; headers?: Record<string, string>; when: Date; expiresSec: number; payloadHash?: string },
  creds: SigV4Creds,
): string {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = v;
  const signed = ["host", ...Object.keys(headers)].sort().join(";");
  const stamp = amzDate(req.when);
  const query: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${creds.accessKeyId}/${stamp.slice(0, 8)}/${creds.region}/${creds.service}/aws4_request`],
    ["X-Amz-Date", stamp],
    ["X-Amz-Expires", String(Math.round(req.expiresSec))],
    ["X-Amz-SignedHeaders", signed],
  ];
  const sig = sigV4({ method: req.method, host: req.host, path: req.path, query, headers, payloadHash: req.payloadHash ?? UNSIGNED_PAYLOAD, when: req.when }, creds);
  return `${req.protocol ?? "https"}://${req.host}${req.path}?${canonicalQuery(query)}&X-Amz-Signature=${sig.signature}`;
}

// ---------- R2 ----------

export type R2Config = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; publicUrl: string };

export function r2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim() ?? "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() ?? "";
  const bucket = process.env.R2_BUCKET?.trim() ?? "";
  const publicUrl = (process.env.R2_PUBLIC_URL?.trim() ?? "").replace(/\/+$/, "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !/^https:\/\//i.test(publicUrl)) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl };
}

/** ¿Está configurado R2 en el servidor (las 5 variables)? */
export const r2Enabled = () => r2Config() !== null;

function need(): R2Config {
  const c = r2Config();
  if (!c)
    throw bi(
      "Falta configurar el almacenamiento de fotos (Cloudflare R2) en el servidor.",
      "The photo storage (Cloudflare R2) isn't set up on the server yet.",
    );
  return c;
}

const credsOf = (c: R2Config): SigV4Creds => ({ accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, region: "auto", service: "s3" });
const hostOf = (c: R2Config) => `${c.accountId}.r2.cloudflarestorage.com`;
const pathOf = (c: R2Config, key: string) => `/${uriEncode(c.bucket)}/${encodePath(key)}`;

/** Dirección pública (lectura) de un archivo guardado en R2. */
export function publicUrl(key: string): string {
  const c = need();
  return `${c.publicUrl}/${encodePath(key)}`;
}

/** La llave de un archivo si la dirección es de este bucket de R2 (null si no). */
export function keyFromPublicUrl(url: string): string | null {
  const c = r2Config();
  if (!c || !url.startsWith(`${c.publicUrl}/`)) return null;
  try {
    return decodeURIComponent(url.slice(c.publicUrl.length + 1));
  } catch {
    return null;
  }
}

/**
 * Dirección para que el navegador suba un archivo directo a R2 con PUT (sin pasar por el servidor, que en Vercel
 * acepta como mucho 4.5 MB). El tipo de archivo va firmado: el navegador debe mandar exactamente esa Content-Type.
 */
export function presignPut(key: string, contentType: string, expiresSec = 3600, when = new Date()): string {
  const c = need();
  return presignUrl({ method: "PUT", host: hostOf(c), path: pathOf(c, key), headers: { "content-type": contentType }, when, expiresSec }, credsOf(c));
}

async function call(method: string, key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const c = need();
  const payloadHash = body ? sha256Hex(body) : EMPTY_SHA256;
  const headers = signHeaders(
    { method, host: hostOf(c), path: pathOf(c, key), headers: contentType ? { "content-type": contentType } : {}, payloadHash, when: new Date() },
    credsOf(c),
  );
  return fetch(`https://${hostOf(c)}${pathOf(c, key)}`, { method, headers, body: body ? new Uint8Array(body) : undefined });
}

/** Guarda un archivo desde el servidor (copias procesadas, miniaturas). Devuelve su dirección pública. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<string> {
  const res = await call("PUT", key, body, contentType);
  if (!res.ok) {
    const why = (await res.text().catch(() => "")).slice(0, 200);
    throw bi(`No se pudo guardar el archivo en Cloudflare R2 (${res.status}). ${why}`, `Couldn't save the file to Cloudflare R2 (${res.status}). ${why}`);
  }
  return publicUrl(key);
}

/** Tamaño y tipo de un archivo guardado, o null si no existe. */
export async function headObject(key: string): Promise<{ size: number; contentType: string } | null> {
  const res = await call("HEAD", key);
  if (res.status === 404) return null;
  if (!res.ok) throw bi(`Cloudflare R2 no contestó bien (${res.status}).`, `Cloudflare R2 didn't answer properly (${res.status}).`);
  return { size: Number(res.headers.get("content-length") ?? 0) || 0, contentType: (res.headers.get("content-type") ?? "").split(";")[0].trim() };
}

/** Borra un archivo (si no existe, no pasa nada). */
export async function deleteObject(key: string): Promise<void> {
  const res = await call("DELETE", key);
  if (!res.ok && res.status !== 404) throw bi(`No se pudo borrar el archivo en Cloudflare R2 (${res.status}).`, `Couldn't delete the file in Cloudflare R2 (${res.status}).`);
}

// ---------- Llaves ----------

/** library/<negocio>/<aaaa-mm>/<24 letras hex>.<ext> */
export function newKey(businessId: string, ext: string, when = new Date()): string {
  const month = when.toISOString().slice(0, 7);
  return `library/${businessId}/${month}/${randomBytes(12).toString("hex")}.${ext}`;
}

/** ¿La llave es de la biblioteca de este negocio (y con una extensión permitida)? */
export function isLibraryKey(key: string, businessId: string, exts: readonly string[]): boolean {
  const m = /^library\/([A-Za-z0-9_-]{1,64})\/\d{4}-\d{2}\/[a-f0-9]{24}\.([a-z0-9]{2,5})$/.exec(key);
  return Boolean(m && m[1] === businessId && exts.includes(m[2]));
}
