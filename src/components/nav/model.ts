// Menú por «herramientas» (grupos): el mismo orden en la barra de la izquierda (computadora) y en «Más» (celular).
// Sin "use client": lo usan también la página de SEO (servidor) y las pruebas.

/** Pestañas de la página de SEO, en orden. `?tab=` acepta estas. */
export const SEO_TAB_IDS = ["resumen", "google", "local", "web", "competencia", "ia", "reportes", "ajustes"] as const;
export type SeoTabId = (typeof SEO_TAB_IDS)[number];

/** La pestaña que abre /seo con esos parámetros (sin `tab`, `?mapa=` abre «Local»). */
export function seoTabFrom(tab: string | null | undefined, mapa?: string | null): SeoTabId {
  return SEO_TAB_IDS.find((x) => x === tab) ?? (mapa ? "local" : "resumen");
}

export type Label = readonly [es: string, en: string];

export type NavItem = {
  key: string;
  label: Label;
  /** Ruta dentro del negocio, sin barra al inicio ("seo", "seo/escribir", "publicar"). Vacío = no lleva a ningún lado (pronto). */
  path: string;
  /** Solo para la página de SEO: la pestaña que abre. */
  tab?: SeoTabId;
  /** Sección dentro de la pestaña (#palabras). Los enlaces con # nunca se marcan como «estás aquí»: lo hace el de su pestaña. */
  hash?: string;
  /** Otras rutas que también cuentan como «estás aquí». */
  also?: string[];
  soon?: boolean;
};

export type NavGroup = {
  key: string;
  label: Label;
  icon: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "tablero",
    icon: "tablero",
    label: ["Tablero", "Dashboard"],
    items: [{ key: "inicio", label: ["Tablero", "Dashboard"], path: "inicio" }],
  },
  {
    key: "seo",
    icon: "seo",
    label: ["SEO", "SEO"],
    items: [
      {
        key: "seo-resumen",
        label: ["Resumen", "Overview"],
        path: "seo",
        tab: "resumen",
      },
      {
        key: "seo-google",
        label: ["Posiciones en Google", "Google rankings"],
        path: "seo",
        tab: "google",
      },
      {
        key: "seo-palabras",
        label: ["Palabras clave", "Keywords"],
        path: "seo",
        tab: "google",
        hash: "palabras",
      },
      {
        key: "seo-web",
        label: ["Tu página web", "Your website"],
        path: "seo",
        tab: "web",
        also: ["seo/gsc"],
      },
      {
        key: "seo-enlaces",
        label: ["Enlaces", "Backlinks"],
        path: "seo",
        tab: "competencia",
        hash: "enlaces",
      },
    ],
  },
  {
    key: "local",
    icon: "local",
    label: ["Local", "Local"],
    items: [
      {
        key: "local-mapa",
        label: ["Mapa de calor", "Map heatmap"],
        path: "seo",
        tab: "local",
      },
      {
        key: "local-perfil",
        label: ["Perfil de Google", "Google profile"],
        path: "seo",
        tab: "local",
        hash: "perfil",
      },
    ],
  },
  {
    key: "ia",
    icon: "ia",
    label: ["Visibilidad en IA", "AI visibility"],
    items: [
      {
        key: "seo-ia",
        label: ["Visibilidad en IA", "AI visibility"],
        path: "seo",
        tab: "ia",
      },
    ],
  },
  {
    key: "competencia",
    icon: "competencia",
    label: ["Competencia y tráfico", "Competitors & traffic"],
    items: [
      {
        key: "seo-competencia",
        label: ["Competencia y tráfico", "Competitors & traffic"],
        path: "seo",
        tab: "competencia",
      },
    ],
  },
  {
    key: "contenido",
    icon: "contenido",
    label: ["Contenido", "Content"],
    items: [
      {
        key: "estudio",
        label: ["Estudio del negocio", "Business study"],
        path: "estudio",
      },
      {
        key: "plan",
        label: ["Ideas y Plan IA", "Ideas & AI plan"],
        path: "plan",
      },
      {
        key: "escribir",
        label: ["Escribir artículo", "Write an article"],
        path: "seo/escribir",
      },
    ],
  },
  {
    key: "redes",
    icon: "redes",
    label: ["Redes sociales", "Social media"],
    items: [
      { key: "publicar", label: ["Publicar", "Publish"], path: "publicar" },
      { key: "historial", label: ["Historial", "History"], path: "historial" },
      { key: "contactos", label: ["Contactos", "Contacts"], path: "contactos" },
    ],
  },
  {
    key: "reportes",
    icon: "reportes",
    label: ["Reportes", "Reports"],
    items: [
      {
        key: "seo-reportes",
        label: ["Reportes", "Reports"],
        path: "seo",
        tab: "reportes",
        also: ["seo/reporte"],
      },
    ],
  },
  {
    key: "anuncios",
    icon: "anuncios",
    label: ["Anuncios", "Ads"],
    items: [{ key: "anuncios", label: ["Anuncios", "Ads"], path: "", soon: true }],
  },
  {
    key: "config",
    icon: "config",
    label: ["Configuración", "Settings"],
    items: [
      { key: "marca", label: ["Marca", "Brand"], path: "marca" },
      {
        key: "conexiones",
        label: ["Conexiones", "Connections"],
        path: "conexiones",
      },
      {
        key: "negocio",
        label: ["Ajustes del negocio", "Business settings"],
        path: "negocio",
      },
      {
        key: "seo-ajustes",
        label: ["Ajustes de SEO", "SEO settings"],
        path: "seo",
        tab: "ajustes",
      },
    ],
  },
];

/** Dirección completa del enlace. */
export function itemHref(businessId: string, item: NavItem): string {
  if (!item.path) return "";
  return `/b/${businessId}/${item.path}${item.tab ? `?tab=${item.tab}` : ""}${item.hash ? `#${item.hash}` : ""}`;
}

/** Dónde está la persona: la ruta y, en la página de SEO, la pestaña abierta. */
export type NavHere = {
  pathname: string;
  tab: string | null;
  mapa: string | null;
};

/** ¿Este enlace es la página (y pestaña) donde está la persona? */
export function isItemOn(businessId: string, item: NavItem, here: NavHere): boolean {
  if (!item.path || item.hash) return false;
  const base = `/b/${businessId}/`;
  const path = here.pathname.replace(/\/+$/, "");
  if (item.tab) {
    if (path === base + item.path) return seoTabFrom(here.tab, here.mapa) === item.tab;
  } else if (path === base + item.path || path.startsWith(`${base + item.path}/`)) {
    return true;
  }
  return (item.also ?? []).some((p) => path === base + p || path.startsWith(`${base + p}/`));
}

export const isGroupOn = (businessId: string, g: NavGroup, here: NavHere) => g.items.some((x) => isItemOn(businessId, x, here));

/** Barra de abajo del celular: 4 accesos directos + «Más» (que tiene todo). */
export type MobileTab = {
  key: string;
  label: Label;
  icon: string;
  path: string;
  on: (here: NavHere, base: string) => boolean;
};

const under = (path: string, p: string) => path === p || path.startsWith(`${p}/`);

export const MOBILE_TABS: MobileTab[] = [
  {
    key: "tablero",
    label: ["Tablero", "Dashboard"],
    icon: "tablero",
    path: "inicio",
    on: (h, b) => under(h.pathname, `${b}inicio`),
  },
  {
    key: "seo",
    label: ["SEO", "SEO"],
    icon: "seo",
    path: "seo",
    // Toda la página de SEO menos «Escribir artículo» (que va con Contenido).
    on: (h, b) => under(h.pathname, `${b}seo`) && !under(h.pathname, `${b}seo/escribir`),
  },
  {
    key: "publicar",
    label: ["Publicar", "Publish"],
    icon: "redes",
    path: "publicar",
    on: (h, b) => under(h.pathname, `${b}publicar`),
  },
  {
    key: "contenido",
    label: ["Contenido", "Content"],
    icon: "contenido",
    path: "estudio",
    on: (h, b) => ["estudio", "plan", "seo/escribir"].some((p) => under(h.pathname, b + p)),
  },
];
