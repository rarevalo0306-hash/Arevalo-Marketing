// Qué se puede abrir sin haber entrado. Lo usa el middleware (src/middleware.ts) en todas las rutas.
// Sin sesión solo se pueden LEER (GET/HEAD) las páginas y archivos públicos. Enviar algo (POST y demás) sin sesión
// solo se permite a las rutas que revisan su propio permiso: entrar con la contraseña y la subida de fotos de los
// técnicos. Así ninguna acción del servidor (server action) se puede llamar sin sesión, ni desde la página de entrada.

/** Públicas para leer: entrar, «Entrar con Google», el publicador automático (su propia clave), la página y los
 *  archivos para los técnicos y las redes, y lo necesario para instalar la app. Terminadas en "/" = todo lo de adentro. */
const PUBLIC_READ = ["/login", "/api/auth/google/", "/api/cron", "/subir/", "/media/", "/manifest.webmanifest", "/icons/", "/icon", "/apple-icon", "/favicon.ico"];

/** Públicas para enviar: la contraseña y la subida de los técnicos (/api/subir/<link>/…, que revisa su link). */
const PUBLIC_WRITE = ["/api/auth/login", "/api/subir/"];

const matches = (path: string, rule: string) => (rule.endsWith("/") ? path.startsWith(rule) : path === rule);

export type Gate = "pass" | "login" | "deny";

/** pass = sigue · login = mandar a /login · deny = 401 (algo que no se puede enviar sin sesión). */
export function gate(path: string, method: string, hasSession: boolean): Gate {
  if (hasSession) return "pass";
  const read = method === "GET" || method === "HEAD";
  if (read) return PUBLIC_READ.some((r) => matches(path, r)) ? "pass" : "login";
  return PUBLIC_WRITE.some((r) => matches(path, r)) ? "pass" : "deny";
}
