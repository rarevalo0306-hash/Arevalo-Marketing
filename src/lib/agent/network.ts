import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import { AgentError } from "./access";

export function publicAddress(ip: string): boolean {
  if (isIP(ip) === 6)
    return /^[23][0-9a-f]{3}:/i.test(ip) && !/^(2001:(db8|0):|2002:)/i.test(ip);
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 168].includes(b)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && [18, 19, 51].includes(b)) ||
    (a === 203 && b === 0)
  );
}
export function sourceUrl(raw: string) {
  const u = new URL(raw);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    isIP(u.hostname) ||
    !u.hostname.includes(".") ||
    /\.(local|localhost|internal|test|invalid)$/i.test(u.hostname)
  )
    throw new AgentError("Las fuentes deben usar HTTPS y un dominio público.");
  u.hash = "";
  return u;
}
/** Pin DNS for the request, revalidate every redirect, cap time and bytes. */
export async function readSource(
  raw: string,
  allowedOrigins: string[],
  redirects = 0,
): Promise<string> {
  const u = sourceUrl(raw);
  if (!allowedOrigins.includes(u.origin) || redirects > 3)
    throw new AgentError(
      "La fuente redirige fuera de los dominios autorizados.",
    );
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(u.hostname, { all: true }),
    new Promise<never>((_, reject) => {
      dnsTimer = setTimeout(
        () =>
          reject(new AgentError("La consulta del dominio tardó demasiado.")),
        5000,
      );
    }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new AgentError("La fuente apunta a una dirección no pública.");
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    const request = https.get(
      u,
      {
        headers: {
          "User-Agent": "MATYA-News/1.0",
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html",
        },
        lookup: (_host, options, callback) => {
          if (typeof options === "object" && options.all)
            callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        if (
          [301, 302, 303, 307, 308].includes(response.statusCode ?? 0) &&
          response.headers.location
        ) {
          response.resume();
          readSource(
            new URL(response.headers.location, u).href,
            allowedOrigins,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (
          response.statusCode !== 200 ||
          !/(xml|html|text\/plain)/i.test(
            response.headers["content-type"] ?? "",
          )
        ) {
          response.resume();
          reject(
            new AgentError("La fuente no devuelve un documento compatible."),
          );
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1_000_000) {
            request.destroy(
              new AgentError("La fuente supera el tamaño permitido."),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve(Buffer.concat(chunks).toString("utf8")),
        );
        response.on("error", reject);
      },
    );
    const timer = setTimeout(
      () =>
        request.destroy(
          new AgentError("La fuente tardó demasiado en responder."),
        ),
      12000,
    );
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
  });
}
