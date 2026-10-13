// Contraseñas propias de cada persona y enlaces de un solo uso (invitaciones, contraseña nueva).
// La contraseña se guarda con scrypt (sal propia, nunca el texto). Los enlaces llevan 32 bytes al azar y en la base solo
// queda su huella SHA-256: quien lea la base no puede usarlos.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "crypto";

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

/** ¿Sirve como contraseña? Devuelve el problema o null. */
export function passwordProblem(password: string, repeat?: string): "short" | "long" | "mismatch" | null {
  if (password.length < PASSWORD_MIN) return "short";
  if (password.length > PASSWORD_MAX) return "long";
  if (repeat !== undefined && password !== repeat) return "mismatch";
  return null;
}

/** Forma guardada: scrypt$N$r$p$<sal base64url>$<huella base64url>. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

// Para no delatar con el tiempo de respuesta si un correo tiene contraseña: sin huella se compara contra esta.
const DUMMY = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86);

/** ¿La contraseña coincide con la huella guardada? Con huella vacía o rota, siempre false (y tarda lo mismo). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = (stored || DUMMY).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (n !== N || r !== R || p !== P) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (expected.length !== KEYLEN) return false;
  const key = await scrypt(password.slice(0, PASSWORD_MAX), salt, KEYLEN, { N, r: R, p: P });
  return timingSafeEqual(key, expected) && Boolean(stored);
}

/** Un enlace nuevo: el token va en el enlace y la huella en la base. */
export function newLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: tokenHash(token) };
}

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** ¿Tiene forma de token de enlace? (43 caracteres base64url). */
export const looksLikeToken = (token: unknown): token is string => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
