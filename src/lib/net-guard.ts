// Antes de que el servidor descargue una dirección que escribió una persona (logo, foto para el texto alternativo):
// solo https y solo a direcciones públicas de internet. Nunca a la red interna, a la propia máquina ni a los servicios
// de metadatos de la nube (169.254.169.254), aunque el nombre apunte ahí por DNS.
import { lookup } from "dns/promises";
import { isIP } from "net";

/** ¿Es una IP privada, local o reservada (v4 o v6)? */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
  }
  return true;
}

/** ¿Se puede descargar esta dirección desde el servidor? https, sin usuario/clave, puerto normal y solo IPs públicas. */
export async function isPublicHttpsUrl(raw: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return !isPrivateIp(host);
  if (!host.includes(".") || /\.(local|internal|localhost)$/i.test(host)) return false;
  try {
    const addrs = await lookup(host, { all: true, verbatim: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}
