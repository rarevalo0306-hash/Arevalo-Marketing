// Sesión simple con una contraseña. Funciona en Node y en el middleware (Web Crypto).

export const SESSION_COOKIE = "am_session";

/** La cookie de la sesión: solo la lee el servidor, dura 30 días. La ponen la contraseña y «Entrar con Google». */
export const sessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
});

export async function sessionToken(): Promise<string> {
  const password = process.env.APP_PASSWORD ?? "";
  const secret = process.env.APP_SECRET ?? "";
  const bytes = new TextEncoder().encode(`arevalo-marketing:${password}:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Comparación en tiempo constante. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
