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

// Ordenado por las fases del trabajo con cada negocio: 1 Negocio → 2 Diagnóstico (la IA conoce el negocio) → 3 Marca →
// 4 Campañas y publicación → 5 Resultados. Inicio arriba, con lo urgente de hoy.
export const NAV_GROUPS: NavGroup[] = [
  {
    key: "tablero",
    icon: "tablero",
    label: ["Inicio", "Home"],
    items: [{ key: "inicio", label: ["Inicio", "Home"], path: "inicio" }],
  },
  {
    key: "negocio",
    icon: "negocio",
    label: ["Negocio", "Business"],
    items: [
      { key: "negocio", label: ["Datos del negocio", "Business details"], path: "negocio" },
      { key: "conexiones", label: ["Conexiones", "Connections"], path: "conexiones" },
    ],
  },
  {
    key: "diagnostico",
    icon: "seo",
    label: ["Diagnóstico", "Diagnosis"],
    items: [
      { key: "diagnostico-inicial", label: ["Diagnóstico guiado", "Guided diagnosis"], path: "diagnostico" },
      { key: "seo-resumen", label: ["Resumen y plan", "Summary & plan"], path: "seo", tab: "resumen" },
      { key: "estudio", label: ["Estudio del negocio", "Business study"], path: "estudio" },
      { key: "seo-google", label: ["Posiciones en Google", "Google rankings"], path: "seo", tab: "google" },
      { key: "seo-palabras", label: ["Palabras clave", "Keywords"], path: "seo", tab: "google", hash: "palabras" },
      { key: "seo-web", label: ["Tu página web", "Your website"], path: "seo", tab: "web", also: ["seo/gsc"] },
      { key: "seo-competencia", label: ["Competencia y tráfico", "Competitors & traffic"], path: "seo", tab: "competencia" },
      { key: "seo-enlaces", label: ["Enlaces", "Backlinks"], path: "seo", tab: "competencia", hash: "enlaces" },
      { key: "local-mapa", label: ["Google Maps", "Google Maps"], path: "seo", tab: "local" },
      { key: "local-perfil", label: ["Perfil de Google", "Google profile"], path: "seo", tab: "local", hash: "perfil" },
      { key: "seo-ia", label: ["Visibilidad en IA", "AI visibility"], path: "seo", tab: "ia" },
      { key: "seo-ajustes", label: ["Ajustes del diagnóstico", "Diagnosis settings"], path: "seo", tab: "ajustes" },
    ],
  },
  {
    key: "marca",
    icon: "marca",
    label: ["Marca", "Brand"],
    items: [
      { key: "marca", label: ["Identidad y kit", "Identity & kit"], path: "marca" },
      { key: "plantillas", label: ["Plantillas", "Templates"], path: "marca", hash: "plantillas" },
      // Las fotos y videos reales del negocio (Drive y link de subida) que la IA usa en las publicaciones.
      { key: "fotos", label: ["Tus fotos y videos", "Your photos & videos"], path: "fotos" },
    ],
  },
  {
    key: "campanas",
    icon: "redes",
    label: ["Campañas y publicación", "Campaigns & publishing"],
    items: [
      { key: "campanas", label: ["Campañas", "Campaigns"], path: "campanas" },
      { key: "publicar", label: ["Posts (fotos y diseños)", "Posts (photos & designs)"], path: "publicar" },
      { key: "videos", label: ["Videos", "Videos"], path: "videos" },
      { key: "plan", label: ["Ideas y plan con IA", "Ideas & AI plan"], path: "plan" },
      { key: "anuncios", label: ["Anuncios pagados", "Paid ads"], path: "anuncios" },
      { key: "directorios", label: ["Directorios y reseñas", "Directories & reviews"], path: "directorios" },
      { key: "escribir", label: ["Artículo para la web", "Website article"], path: "seo/escribir" },
      { key: "historial", label: ["Historial", "History"], path: "historial" },
      { key: "contactos", label: ["Contactos (email)", "Contacts (email)"], path: "contactos" },
    ],
  },
  {
    key: "resultados",
    icon: "reportes",
    label: ["Resultados", "Results"],
    items: [
      { key: "resultados", label: ["Resumen de resultados", "Results overview"], path: "resultados" },
      { key: "reportes", label: ["Reporte diario y por fechas", "Daily & date-range report"], path: "reportes" },
      { key: "propuestas", label: ["Propuestas de la IA", "AI proposals"], path: "propuestas" },
      { key: "registro", label: ["Lo que hizo la IA", "What the AI did"], path: "registro" },
      { key: "enlaces-daninos", label: ["Enlaces dañinos", "Toxic links"], path: "enlaces" },
      { key: "seo-reportes", label: ["Reporte SEO mensual y avisos", "Monthly SEO report & alerts"], path: "seo", tab: "reportes", also: ["seo/reporte"] },
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
    label: ["Inicio", "Home"],
    icon: "tablero",
    path: "inicio",
    on: (h, b) => under(h.pathname, `${b}inicio`),
  },
  {
    key: "diagnostico",
    label: ["Diagnóstico", "Diagnosis"],
    icon: "seo",
    path: "seo",
    // Toda la página de SEO (menos «Artículo para la web», que va con Publicar) y el estudio del negocio.
    on: (h, b) => (under(h.pathname, `${b}seo`) && !under(h.pathname, `${b}seo/escribir`)) || under(h.pathname, `${b}estudio`),
  },
  {
    key: "publicar",
    label: ["Publicar", "Publish"],
    icon: "redes",
    path: "publicar",
    on: (h, b) => ["publicar", "campanas", "videos", "plan", "anuncios", "directorios", "seo/escribir", "historial"].some((p) => under(h.pathname, b + p)),
  },
  {
    key: "marca",
    label: ["Marca", "Brand"],
    icon: "marca",
    path: "marca",
    on: (h, b) => ["marca", "fotos"].some((p) => under(h.pathname, b + p)),
  },
];
