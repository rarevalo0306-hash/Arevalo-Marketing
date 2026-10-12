// La sesión: una cookie firmada que dice qué persona entró. Funciona en Node y en el middleware (Web Crypto).
// Forma: v3.<id de la persona>.<versión>.<vence (segundos)>.<firma HMAC-SHA256>. La firma usa APP_PASSWORD y APP_SECRET:
// cambiar APP_PASSWORD saca a todos (nunca cambies APP_SECRET: cifra las conexiones). Para sacar a una sola persona:
// «Quitar acceso» en Equipo, que sube su User.sessionVersion (lo revisa src/lib/auth.ts, que sí ve la base).
// v3 llegó con los permisos por empresa (etapa 2): si se vuelve a una versión anterior de la app, que no los conoce,
// nadie queda adentro con una sesión de esta versión.

export const SESSION_COOKIE = "am_session";
export const SESSION_DAYS = 30;

/** La cookie de la sesión: solo la lee el servidor, dura 30 días. La ponen la contraseña y «Entrar con Google». */
export const sessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * SESSION_DAYS,
});

export type Session = { userId: string; version: number; exp: number };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const enc = new TextEncoder();

async function signingKey(): Promise<CryptoKey | null> {
  const password = process.env.APP_PASSWORD ?? "";
  const secret = process.env.APP_SECRET ?? "";
  if (!password || !secret) return null;
  return crypto.subtle.importKey("raw", enc.encode(`matya-session:v3:${password}:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(payload: string, key: CryptoKey): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** La cookie para esta persona. Falla si falta APP_PASSWORD o APP_SECRET. */
export async function createSession(userId: string, version: number, now = nowSec()): Promise<string> {
  const key = await signingKey();
  if (!key) throw new Error("APP_PASSWORD and APP_SECRET are required for sessions");
  if (!ID.test(userId) || !Number.isSafeInteger(version) || version < 0) throw new Error("Invalid session data");
  const payload = `v3.${userId}.${version}.${now + 60 * 60 * 24 * SESSION_DAYS}`;
  return `${payload}.${await sign(payload, key)}`;
}

/** Quién dice la cookie que es, solo si la firma es nuestra y no venció. No revisa la base. */
export async function readSession(cookie: string | undefined, now = nowSec()): Promise<Session | null> {
  const parts = (cookie ?? "").split(".");
  if (parts.length !== 5 || parts[0] !== "v3") return null;
  const [, userId, version, exp, signature] = parts;
  if (!ID.test(userId) || !/^\d{1,9}$/.test(version) || !/^\d{1,12}$/.test(exp)) return null;
  const key = await signingKey();
  if (!key || !safeEqual(signature, await sign(parts.slice(0, 4).join("."), key))) return null;
  if (Number(exp) <= now) return null;
  return { userId, version: Number(version), exp: Number(exp) };
}

/** Comparación en tiempo constante. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
