// La app vive en app.matya.app. matya.app queda para la página web pública (otro proyecto); mientras esa página no
// exista, quien abra matya.app (o un link viejo como matya.app/b/…) llega a la misma dirección en app.matya.app.

export const APP_HOST = "app.matya.app";

/** Direcciones viejas de la app que se mandan a APP_HOST (www.matya.app ya va a matya.app desde Vercel). */
export const OLD_APP_HOSTS = ["matya.app", "www.matya.app"] as const;

/**
 * Reglas para next.config: cualquier ruta y sus parámetros, igual en la dirección nueva. Temporal (307) y no
 * permanente: matya.app se reutiliza para la página web y el navegador no debe recordar el desvío.
 */
export function oldHostRedirects() {
  return OLD_APP_HOSTS.map((host) => ({
    source: "/:path*",
    has: [{ type: "host" as const, value: host }],
    destination: `https://${APP_HOST}/:path*`,
    permanent: false,
  }));
}
