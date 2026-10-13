// Antes de que el servidor descargue una dirección que escribió una persona (logo, foto para el texto alternativo):
// solo https y solo a direcciones públicas de internet. Nunca a la red interna, a la propia máquina ni a los servicios
// de metadatos de la nube (169.254.169.254), aunque el nombre apunte ahí por DNS.
import { lookup } from "dns/promises";
import { BlockList, isIP } from "net";
import { bi } from "@/lib/i18n";

// Rangos privados, locales o reservados. BlockList compara las IPv6 que llevan una IPv4 (::ffff:7f00:1) con las
// reglas IPv4; por eso ::ffff:0:0/96 no va como regla: bloquearía todas las IPv4.
const BLOCKED = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) BLOCKED.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 128], ["::1", 128],
  ["::", 96], // IPv4 compatible (::127.0.0.1)
  ["64:ff9b::", 96], ["64:ff9b:1::", 48], // NAT64: llevan una IPv4 adentro
  ["2002::", 16], // 6to4: también lleva una IPv4; no se decodifica, se bloquea
  ["2001::", 32], // Teredo
  ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) BLOCKED.addSubnet(net, bits, "ipv6");

/** ¿Es una IP privada, local o reservada (v4 o v6)? Lo que no es una IP cuenta como privada. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (!v) return true;
  try {
    return BLOCKED.check(ip, v === 4 ? "ipv4" : "ipv6");
  } catch {
    return true;
  }
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

/**
 * fetch para una dirección que escribió una persona: sigue las redirecciones a mano (como mucho 3) y revisa con
 * isPublicHttpsUrl cada salto antes de pedirlo. Si alguno no es público, falla sin pedirlo. Devuelve la última
 * respuesta, aunque no sea ok (eso lo revisa quien llama).
 */
export async function fetchPublic(url: string, init?: RequestInit): Promise<Response> {
  let current = url;
  for (let hops = 0; ; hops++) {
    if (!(await isPublicHttpsUrl(current))) throw bi("El archivo no está en una dirección pública de internet.", "The file isn't at a public web address.");
    const res = await fetch(current, { ...init, redirect: "manual" });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) return res;
    res.body?.cancel().catch(() => undefined);
    if (hops >= 3) throw bi("No se pudo descargar el archivo: redirige demasiadas veces.", "Couldn't download the file: too many redirects.");
    // Location relativa: contra la dirección actual. Si no se entiende, "" no pasa la revisión.
    current = URL.canParse(next, current) ? new URL(next, current).href : "";
  }
}
