// Qué se puede abrir sin haber entrado. Lo usa el middleware (src/middleware.ts) en todas las rutas.
// Sin sesión solo se pueden LEER (GET/HEAD) las páginas y archivos públicos. Enviar algo (POST y demás) sin sesión
// solo se permite a las rutas que revisan su propio permiso: entrar con la contraseña y la subida de fotos de los
// técnicos. Así ninguna acción del servidor (server action) se puede llamar sin sesión, ni desde la página de entrada.

/** Públicas para leer: entrar, «Entrar con Google», el publicador automático (su propia clave), la página y los
 *  archivos para los técnicos y las redes, y lo necesario para instalar la app. Terminadas en "/" = todo lo de adentro. */
const PUBLIC_READ = ["/login", "/api/auth/google/", "/api/cron", "/subir/", "/media/", "/manifest.webmanifest", "/icons/", "/icon", "/apple-icon", "/favicon.ico"];

/** Públicas para enviar: la contraseña y los dos pasos de la subida de los técnicos (revisan su propio link). */
const PUBLIC_WRITE: (string | RegExp)[] = ["/api/auth/login", /^\/api\/subir\/[^/]+\/(firmar|listo)$/];

const matches = (path: string, rule: string | RegExp) =>
  typeof rule !== "string" ? rule.test(path) : rule.endsWith("/") ? path.startsWith(rule) : path === rule;

export type Gate = "pass" | "login" | "deny";

/** pass = sigue · login = mandar a /login · deny = no se envía (el middleware responde 401 o manda a /login). */
export function gate(path: string, method: string, hasSession: boolean): Gate {
  if (hasSession) return "pass";
  const read = method === "GET" || method === "HEAD";
  if (read) return PUBLIC_READ.some((r) => matches(path, r)) ? "pass" : "login";
  return PUBLIC_WRITE.some((r) => matches(path, r)) ? "pass" : "deny";
}

type HeaderBag = { get(name: string): string | null };

/**
 * ¿Un envío que viene de otra página web? El navegador siempre dice de dónde viene un POST (Origin / Sec-Fetch-Site).
 * Sirve para que otra web no gaste los intentos de entrar de alguien (y lo deje bloqueado 15 minutos).
 */
export function fromOtherSite(h: HeaderBag, host: string): boolean {
  if (h.get("sec-fetch-site") === "cross-site") return true;
  const origin = h.get("origin");
  if (origin === null) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}
