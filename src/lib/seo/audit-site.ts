// Revisiones de todo el sitio que no dependen de una sola página: direcciones viejas de WordPress (autor, categoría,
// archivo por mes…), enlaces a wp.com, y cómo están enlazadas las páginas entre sí (clics desde el inicio, páginas sin
// enlaces, páginas con un solo enlace). Puro: se prueba con listas de ejemplo.

/** Direcciones típicas de un WordPress viejo que no deberían seguir abiertas ni en el sitemap. */
const JUNK_PATH = [
  /\/author\/[^/]+/i,
  /\/category\/[^/]+/i,
  /\/tag\/[^/]+/i,
  /\/uncategori[sz]ed(\/|$)/i,
  /\/sin-categoria(\/|$)/i,
  /\/(19|20)\d{2}\/(0[1-9]|1[0-2])(\/|$)/,
  /\/feed\/?$/i,
  /\/comments\/feed/i,
  /\/attachment\//i,
];
/** ?p=123, ?page_id=, ?attachment_id=, ?cat=, ?author=, ?m=202406 en la raíz (o index.php). */
const JUNK_QUERY = /(^|&)(p|page_id|attachment_id|cat|author|m)=\d+(&|$)/i;

/** ¿Es una dirección de las que deja WordPress (autor, categoría, etiqueta, mes, ?p=, feed, adjunto)? */
export function isJunkWpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (JUNK_PATH.some((re) => re.test(u.pathname))) return true;
    const q = u.search.replace(/^\?/, "");
    if (!q) return false;
    return (/^\/(index\.php)?$/i.test(u.pathname) && JUNK_QUERY.test(q)) || /(^|&)attachment_id=\d+/i.test(q);
  } catch {
    return false;
  }
}

/** Direcciones clásicas que se prueban aunque nadie las enlace (si responden 200, siguen abiertas). */
export const WP_PROBES = ["/author/admin/", "/category/uncategorized/", "/feed/", "/?p=1"];

const WP_HOST = /(^|\.)(wp\.com|wordpress\.com)$/i;
export const isWpComHost = (host: string) => WP_HOST.test(host.replace(/^www\./, ""));

export type LinkGraph = {
  /** Clics desde el inicio (solo las páginas a las que se llega siguiendo enlaces). */
  depth: Map<string, number>;
  /** Cuántas páginas distintas (de las leídas) enlazan a cada página. */
  inlinks: Map<string, number>;
};

/**
 * Arma el mapa de enlaces entre las páginas leídas. `edges` = para cada página leída, las direcciones a las que enlaza.
 * `alias` lleva una dirección a la página final (después de redirecciones), para contar bien.
 */
export function linkGraph(home: string, edges: Map<string, string[]>, alias: (u: string) => string = (u) => u): LinkGraph {
  const out = new Map<string, Set<string>>();
  const inlinks = new Map<string, Set<string>>();
  for (const [from, targets] of edges) {
    const f = alias(from);
    const set = out.get(f) ?? new Set<string>();
    for (const t of targets) {
      const to = alias(t);
      if (to === f) continue;
      set.add(to);
      const s = inlinks.get(to) ?? new Set<string>();
      s.add(f);
      inlinks.set(to, s);
    }
    out.set(f, set);
  }
  const depth = new Map<string, number>();
  const start = alias(home);
  depth.set(start, 0);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    for (const next of out.get(cur) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, d + 1);
      queue.push(next);
    }
  }
  return { depth, inlinks: new Map([...inlinks].map(([k, v]) => [k, v.size])) };
}

/** Un número corto para comparar textos (FNV-1a de 32 bits, en hexadecimal). */
export function textHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
