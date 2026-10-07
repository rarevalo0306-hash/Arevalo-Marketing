// Kit de marca listo para usar: la lista de piezas (logos, foto de perfil, portadas, favicon, encabezado de email,
// tarjeta de presentación), dónde se usa cada una y cómo subirla. Sin servidor ni JSX: se usa en pantalla, en el
// servidor y en las pruebas.
//
// Medidas revisadas en octubre de 2026 (las redes muestran estas imágenes más chicas; se crean al doble para que
// se vean nítidas en pantallas de alta densidad):
// - Facebook: portada 820×312 en computadora (se sube a 1640×624); en el celular se ve un recorte de 16:9 al
//   centro, así que lo importante va en el centro. Foto de perfil 1:1, se ve en círculo.
//   https://www.facebook.com/help/125379114252045 · https://napoleoncat.com/blog/social-media-image-sizes/
// - LinkedIn página de empresa: portada 1128×191, logo 1:1 (300×300 o más). https://www.linkedin.com/help/linkedin/answer/a563309
// - X: encabezado 1500×500 (en el celular se recorta arriba y abajo; la foto de perfil tapa la esquina de abajo a la
//   izquierda). https://help.x.com/en/managing-your-account/common-issues-when-uploading-profile-photo
// - YouTube: banner 2560×1440; lo que se ve en todos los aparatos es el centro de 1546×423.
//   https://support.google.com/youtube/answer/2972003
// - Perfil de Negocio de Google: portada 16:9 (recomendado 1080×608), logo 1:1. https://support.google.com/business/answer/6103862
// - Open Graph (vista previa de enlaces en Facebook, WhatsApp, LinkedIn, X): 1200×630 (1.91:1). https://developers.facebook.com/docs/sharing/webmasters/images
// - Favicon: 32×32, apple-touch-icon 180×180 (sin transparencia: iOS pone fondo negro), Android 192 y 512.
// - Tarjeta de presentación EE. UU.: 3.5×2 in; a 300 dpi con 0.125 in de sangrado por lado: 1125×675.
// - Encabezado de email: 600 px de ancho visibles en el correo (se crea a 1200×400).
// Resúmenes consultados: https://socialbee.com/blog/social-media-image-sizes/ · https://www.stndigital.com/social-media-image-sizes/
import { contrast, mix } from "@/lib/design-shapes";

export type L = { es: string; en: string };
export type KitGroup = "logos" | "social" | "web" | "email" | "print";
export type KitPlace = { name: L; steps: { es: string[]; en: string[] } };
export type KitFormat = {
  /** Clave guardada en BrandAsset.format. */
  key: string;
  group: KitGroup;
  /** Tamaño de la imagen. Con `fit` es el tamaño máximo: el logo mantiene su forma dentro de ese recuadro. */
  w: number;
  h: number;
  fit?: boolean;
  transparent?: boolean;
  /** Lo que se ve siempre (centro), cuando la red recorta la imagen según el aparato. */
  safe?: { w: number; h: number };
  /** Piezas que se muestran juntas en una sola tarjeta (los íconos del sitio). */
  family?: "favicon";
  label: L;
  /** Dónde se usa, en palabras simples. */
  where: L;
  /** Nombre del archivo al descargar (sin ".png"). */
  file: L;
  places: KitPlace[];
};

export const KIT_GROUPS: { key: KitGroup; label: L; folder: L }[] = [
  { key: "logos", label: { es: "Logos", en: "Logos" }, folder: { es: "1 Logos", en: "1 Logos" } },
  { key: "social", label: { es: "Redes sociales", en: "Social media" }, folder: { es: "2 Redes sociales", en: "2 Social media" } },
  { key: "web", label: { es: "Sitio web", en: "Website" }, folder: { es: "3 Sitio web", en: "3 Website" } },
  { key: "email", label: { es: "Email", en: "Email" }, folder: { es: "4 Email", en: "4 Email" } },
  { key: "print", label: { es: "Impresos", en: "Print" }, folder: { es: "5 Impresos", en: "5 Print" } },
];

const LOGO_TIPS: KitPlace = {
  name: { es: "Documentos, sitio web, imprenta", en: "Documents, website, print shop" },
  steps: {
    es: ["Descárgalo y úsalo donde te pidan tu logo.", "No lo estires: si cambias el tamaño, mantén la proporción.", "Si tienes el archivo original (PDF, AI o SVG), dáselo también a la imprenta."],
    en: ["Download it and use it wherever you're asked for your logo.", "Don't stretch it: when resizing, keep the proportions.", "If you have the original file (PDF, AI or SVG), give it to the print shop too."],
  },
};

const p = (es: string, en: string, stepsEs: string[], stepsEn: string[]): KitPlace => ({ name: { es, en }, steps: { es: stepsEs, en: stepsEn } });

export const KIT_FORMATS: KitFormat[] = [
  // ---------- Logos ----------
  {
    key: "logo-color",
    group: "logos",
    w: 2000,
    h: 2000,
    fit: true,
    transparent: true,
    label: { es: "Logo a color", en: "Color logo" },
    where: { es: "Sobre fondos claros: documentos, facturas, sitio web, presentaciones.", en: "On light backgrounds: documents, invoices, website, presentations." },
    file: { es: "logo-a-color", en: "logo-color" },
    places: [LOGO_TIPS],
  },
  {
    key: "logo-white",
    group: "logos",
    w: 2000,
    h: 2000,
    fit: true,
    transparent: true,
    label: { es: "Logo blanco", en: "White logo" },
    where: { es: "Sobre fondos oscuros, fotos y el color de tu marca.", en: "On dark backgrounds, photos and your brand color." },
    file: { es: "logo-blanco", en: "logo-white" },
    places: [LOGO_TIPS],
  },
  {
    key: "logo-dark",
    group: "logos",
    w: 2000,
    h: 2000,
    fit: true,
    transparent: true,
    label: { es: "Logo de un solo color (oscuro)", en: "One-color logo (dark)" },
    where: { es: "Sellos, bordados, grabados, fotocopias e impresiones en blanco y negro.", en: "Stamps, embroidery, engraving, photocopies and black-and-white printing." },
    file: { es: "logo-un-color", en: "logo-one-color" },
    places: [LOGO_TIPS],
  },
  {
    key: "symbol",
    group: "logos",
    w: 1024,
    h: 1024,
    transparent: true,
    label: { es: "Símbolo cuadrado", en: "Square symbol" },
    where: { es: "Espacios chicos y cuadrados: íconos, sellos, la esquina de un video.", en: "Small square spaces: icons, stamps, the corner of a video." },
    file: { es: "simbolo", en: "symbol" },
    places: [LOGO_TIPS],
  },
  // ---------- Redes sociales ----------
  {
    key: "profile",
    group: "social",
    w: 1080,
    h: 1080,
    safe: { w: 760, h: 760 },
    label: { es: "Foto de perfil", en: "Profile picture" },
    where: { es: "La misma para todas: Facebook, Instagram, LinkedIn, X, TikTok, YouTube, WhatsApp Business y Google. Ya viene pensada para el círculo.", en: "The same one for all: Facebook, Instagram, LinkedIn, X, TikTok, YouTube, WhatsApp Business and Google. It's already made for the circle crop." },
    file: { es: "foto-de-perfil", en: "profile-picture" },
    places: [
      p("Facebook", "Facebook", ["Abre tu página y toca tu foto de perfil.", "Elige «Subir foto» y escoge la imagen.", "Toca «Guardar»."], ["Open your page and tap your profile picture.", "Choose “Upload photo” and pick the image.", "Tap “Save”."]),
      p("Instagram", "Instagram", ["En tu perfil toca «Editar perfil».", "Toca «Cambiar foto» → «Nueva foto de perfil» y elige la imagen."], ["On your profile tap “Edit profile”.", "Tap “Change picture” → “New profile picture” and pick the image."]),
      p("LinkedIn (página de empresa)", "LinkedIn (company page)", ["Entra a tu página de empresa y toca «Editar página».", "En «Logotipo» sube la imagen y guarda."], ["Go to your company page and tap “Edit page”.", "Under “Logo” upload the image and save."]),
      p("X (Twitter)", "X (Twitter)", ["En tu perfil toca «Editar perfil».", "Toca la foto, elige la imagen y toca «Guardar»."], ["On your profile tap “Edit profile”.", "Tap the photo, pick the image and tap “Save”."]),
      p("TikTok", "TikTok", ["En tu perfil toca «Editar perfil».", "Toca «Cambiar foto», elige la imagen y guarda."], ["On your profile tap “Edit profile”.", "Tap “Change photo”, pick the image and save."]),
      p("YouTube", "YouTube", ["Abre YouTube Studio → «Personalización» → «Marca».", "En «Imagen» toca «Cambiar», sube la imagen y toca «Publicar»."], ["Open YouTube Studio → “Customization” → “Branding”.", "Under “Picture” tap “Change”, upload the image and tap “Publish”."]),
      p("WhatsApp Business", "WhatsApp Business", ["Abre WhatsApp Business → «Herramientas para la empresa» → «Perfil de empresa».", "Toca la foto, elige la imagen y guarda."], ["Open WhatsApp Business → “Business tools” → “Business profile”.", "Tap the photo, pick the image and save."]),
      p("Google (Perfil de Negocio)", "Google (Business Profile)", ["Busca tu negocio en Google con tu sesión iniciada y toca «Editar perfil».", "Ve a «Fotos» → «Logotipo» y sube la imagen."], ["Search for your business on Google while signed in and tap “Edit profile”.", "Go to “Photos” → “Logo” and upload the image."]),
    ],
  },
  {
    key: "fb-cover",
    group: "social",
    w: 1640,
    h: 624,
    safe: { w: 1100, h: 520 },
    label: { es: "Portada de Facebook", en: "Facebook cover" },
    where: { es: "Arriba de tu página de Facebook. Lo importante va al centro, que es lo que se ve en el celular.", en: "At the top of your Facebook page. The key part is in the center, which is what phones show." },
    file: { es: "portada-facebook", en: "facebook-cover" },
    places: [p("Facebook", "Facebook", ["Abre tu página y toca «Editar» sobre la portada.", "Elige «Subir foto» y escoge la imagen.", "No la muevas (ya viene centrada) y toca «Guardar cambios»."], ["Open your page and tap “Edit” on the cover.", "Choose “Upload photo” and pick the image.", "Don't move it (it's already centered) and tap “Save changes”."])],
  },
  {
    key: "linkedin-cover",
    group: "social",
    w: 1128,
    h: 191,
    safe: { w: 860, h: 191 },
    label: { es: "Portada de LinkedIn", en: "LinkedIn cover" },
    where: { es: "Arriba de tu página de empresa en LinkedIn.", en: "At the top of your LinkedIn company page." },
    file: { es: "portada-linkedin", en: "linkedin-cover" },
    places: [p("LinkedIn", "LinkedIn", ["Entra a tu página de empresa y toca «Editar página».", "En «Imagen de portada» sube la imagen y guarda."], ["Go to your company page and tap “Edit page”.", "Under “Cover image” upload the image and save."])],
  },
  {
    key: "x-header",
    group: "social",
    w: 1500,
    h: 500,
    safe: { w: 1100, h: 380 },
    label: { es: "Encabezado de X (Twitter)", en: "X (Twitter) header" },
    where: { es: "La franja de arriba de tu perfil de X.", en: "The banner at the top of your X profile." },
    file: { es: "encabezado-x", en: "x-header" },
    places: [p("X (Twitter)", "X (Twitter)", ["En tu perfil toca «Editar perfil».", "Toca el encabezado, elige la imagen, toca «Aplicar» y luego «Guardar»."], ["On your profile tap “Edit profile”.", "Tap the header, pick the image, tap “Apply” and then “Save”."])],
  },
  {
    key: "yt-banner",
    group: "social",
    w: 2560,
    h: 1440,
    safe: { w: 1546, h: 423 },
    label: { es: "Banner de YouTube", en: "YouTube banner" },
    where: { es: "Arriba de tu canal de YouTube. En la tele se ve completo; en el celular, solo la franja del centro (ahí va todo lo importante).", en: "At the top of your YouTube channel. TVs show all of it; phones only the center strip (everything important is there)." },
    file: { es: "banner-youtube", en: "youtube-banner" },
    places: [p("YouTube", "YouTube", ["Abre YouTube Studio → «Personalización» → «Marca».", "En «Imagen del banner» toca «Cambiar» y sube la imagen.", "Toca «Listo» y luego «Publicar»."], ["Open YouTube Studio → “Customization” → “Branding”.", "Under “Banner image” tap “Change” and upload the image.", "Tap “Done” and then “Publish”."])],
  },
  {
    key: "gbp-cover",
    group: "social",
    w: 1080,
    h: 608,
    safe: { w: 900, h: 500 },
    label: { es: "Portada de Google (Perfil de Negocio)", en: "Google Business Profile cover" },
    where: { es: "La foto principal de tu negocio en Google y Google Maps.", en: "Your business's main photo on Google and Google Maps." },
    file: { es: "portada-google", en: "google-cover" },
    places: [p("Google (Perfil de Negocio)", "Google (Business Profile)", ["Busca tu negocio en Google con tu sesión iniciada y toca «Editar perfil» → «Fotos».", "Elige «Foto de portada» y sube la imagen.", "Google puede tardar unos días en mostrarla."], ["Search for your business on Google while signed in and tap “Edit profile” → “Photos”.", "Choose “Cover photo” and upload the image.", "Google may take a few days to show it."])],
  },
  // ---------- Sitio web ----------
  {
    key: "og",
    group: "web",
    w: 1200,
    h: 630,
    safe: { w: 1040, h: 500 },
    label: { es: "Imagen para compartir enlaces", en: "Link preview image" },
    where: { es: "La imagen que aparece cuando alguien comparte tu sitio web por WhatsApp, Facebook, LinkedIn o X.", en: "The image that shows up when someone shares your website on WhatsApp, Facebook, LinkedIn or X." },
    file: { es: "imagen-para-compartir", en: "link-preview" },
    places: [
      p("WordPress", "WordPress", ["Con Yoast o Rank Math: «Ajustes» → «Redes sociales» → «Imagen por defecto».", "Sube la imagen y guarda."], ["With Yoast or Rank Math: “Settings” → “Social” → “Default image”.", "Upload the image and save."]),
      p("Wix o Squarespace", "Wix or Squarespace", ["Abre «SEO» o «Compartir en redes» en los ajustes del sitio.", "Sube la imagen como «Imagen para compartir» y publica."], ["Open “SEO” or “Social sharing” in the site settings.", "Upload it as the “Social share image” and publish."]),
      p("Si te lo hace alguien", "If someone does it for you", ["Mándale la imagen y dile: «es la imagen para compartir (og:image)»."], ["Send them the image and say: “this is the share image (og:image)”."]),
    ],
  },
  {
    key: "favicon-32",
    group: "web",
    w: 32,
    h: 32,
    transparent: true,
    family: "favicon",
    label: { es: "Ícono del sitio (favicon) 32", en: "Site icon (favicon) 32" },
    where: { es: "La pestaña del navegador.", en: "The browser tab." },
    file: { es: "favicon-32", en: "favicon-32" },
    places: [],
  },
  {
    key: "favicon-180",
    group: "web",
    w: 180,
    h: 180,
    family: "favicon",
    label: { es: "Ícono para iPhone 180", en: "iPhone icon 180" },
    where: { es: "Cuando alguien guarda tu sitio en la pantalla del iPhone.", en: "When someone saves your site to their iPhone home screen." },
    file: { es: "icono-iphone-180", en: "apple-touch-icon-180" },
    places: [],
  },
  {
    key: "favicon-192",
    group: "web",
    w: 192,
    h: 192,
    family: "favicon",
    label: { es: "Ícono para Android 192", en: "Android icon 192" },
    where: { es: "Cuando alguien guarda tu sitio en un Android.", en: "When someone saves your site on Android." },
    file: { es: "icono-android-192", en: "android-icon-192" },
    places: [],
  },
  {
    key: "favicon-512",
    group: "web",
    w: 512,
    h: 512,
    family: "favicon",
    label: { es: "Ícono grande 512", en: "Large icon 512" },
    where: { es: "WordPress, Wix y Squarespace piden esta (y sacan los demás tamaños solos).", en: "WordPress, Wix and Squarespace ask for this one (and make the other sizes on their own)." },
    file: { es: "icono-512", en: "icon-512" },
    places: [
      p("WordPress", "WordPress", ["«Apariencia» → «Personalizar» → «Identidad del sitio» → «Icono del sitio».", "Sube el ícono de 512 y publica."], ["“Appearance” → “Customize” → “Site Identity” → “Site Icon”.", "Upload the 512 icon and publish."]),
      p("Wix o Squarespace", "Wix or Squarespace", ["Busca «Favicon» en los ajustes del sitio.", "Sube el ícono de 512 y publica."], ["Look for “Favicon” in the site settings.", "Upload the 512 icon and publish."]),
      p("Si te lo hace alguien", "If someone does it for you", ["Dale los cuatro íconos: ya tienen los tamaños que pide cada aparato."], ["Give them all four icons: they already have the sizes each device needs."]),
    ],
  },
  // ---------- Email ----------
  {
    key: "email-header",
    group: "email",
    w: 1200,
    h: 400,
    safe: { w: 1100, h: 340 },
    label: { es: "Encabezado de email", en: "Email header" },
    where: { es: "Arriba de los correos que mandas a tus clientes (boletines, promociones).", en: "At the top of the emails you send to your customers (newsletters, promotions)." },
    file: { es: "encabezado-email", en: "email-header" },
    places: [p("Brevo, Mailchimp u otro", "Brevo, Mailchimp or similar", ["Abre la plantilla de tu correo.", "Pon un bloque de imagen arriba del todo y sube el encabezado.", "Guarda la plantilla para usarla siempre."], ["Open your email template.", "Put an image block at the very top and upload the header.", "Save the template to reuse it every time."])],
  },
  {
    key: "email-logo",
    group: "email",
    w: 480,
    h: 160,
    fit: true,
    transparent: true,
    label: { es: "Logo para la firma", en: "Signature logo" },
    where: { es: "El logo chico que va en la firma de tus correos.", en: "The small logo in your email signature." },
    file: { es: "logo-firma-email", en: "email-signature-logo" },
    places: [
      p("Gmail", "Gmail", ["Toca ⚙ → «Ver todos los ajustes» → «Firma» → «Crear».", "Pega la firma (Ctrl+V o mantener presionado → Pegar).", "Baja al final de la página y toca «Guardar cambios»."], ["Tap ⚙ → “See all settings” → “Signature” → “Create new”.", "Paste the signature (Ctrl+V, or long-press → Paste).", "Scroll to the bottom and tap “Save changes”."]),
      p("Outlook", "Outlook", ["«Configuración» → «Cuentas» → «Firmas» → «Nueva firma».", "Pega la firma y guarda."], ["“Settings” → “Accounts” → “Signatures” → “New signature”.", "Paste the signature and save."]),
      p("iPhone (Mail)", "iPhone (Mail)", ["«Ajustes» → «Apps» → «Mail» → «Firma».", "Pega la firma."], ["“Settings” → “Apps” → “Mail” → “Signature”.", "Paste the signature."]),
    ],
  },
  // ---------- Impresos ----------
  {
    key: "card-front",
    group: "print",
    w: 1125,
    h: 675,
    safe: { w: 975, h: 525 },
    label: { es: "Tarjeta de presentación (frente)", en: "Business card (front)" },
    where: { es: "Tarjeta de 3.5 × 2 pulgadas (8.9 × 5.1 cm), lista para imprenta: 300 dpi con margen de corte.", en: "3.5 × 2 inch business card, print-ready: 300 dpi with bleed." },
    file: { es: "tarjeta-frente", en: "business-card-front" },
    places: [
      p("Imprenta", "Print shop", ["Manda el frente y el reverso juntos.", "Diles: «3.5 × 2 pulgadas, 300 dpi, ya trae 1/8 de pulgada de sangrado».", "Algunas imprentas piden PDF: casi todas convierten la imagen sin problema."], ["Send the front and back together.", "Tell them: “3.5 × 2 inches, 300 dpi, includes 1/8 inch bleed”.", "Some print shops ask for a PDF: most will convert the image without trouble."]),
    ],
  },
  {
    key: "card-back",
    group: "print",
    w: 1125,
    h: 675,
    safe: { w: 975, h: 525 },
    label: { es: "Tarjeta de presentación (reverso)", en: "Business card (back)" },
    where: { es: "El lado con tus datos: teléfono y sitio web.", en: "The side with your details: phone and website." },
    file: { es: "tarjeta-reverso", en: "business-card-back" },
    places: [],
  },
];

export const kitFormat = (key: string | undefined) => KIT_FORMATS.find((f) => f.key === key);
export const kitGroup = (key: string | undefined) => KIT_GROUPS.find((g) => g.key === key);

// ---------- Archivos para descargar ----------

const asciiName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 ._-]+/g, "")
    .trim();

/** Nombre del archivo al descargar una pieza: "fameseg-portada-facebook.png". */
export function kitFileName(format: string | undefined, business: string, lang: "es" | "en"): string {
  const f = kitFormat(format);
  const base = asciiName(business).toLowerCase().replace(/[\s._]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const name = f ? f.file[lang] : "imagen";
  return `${base ? `${base}-` : ""}${name}.png`;
}

/** Ruta dentro del ZIP: "2 Redes sociales/portada-facebook.png" (carpetas por grupo, sin repetir nombres). */
export function zipEntries<A extends { format?: string; group?: string }>(assets: A[], lang: "es" | "en"): { path: string; asset: A }[] {
  const used = new Set<string>();
  const out: { path: string; asset: A }[] = [];
  const order = (a: A) => KIT_FORMATS.findIndex((f) => f.key === a.format);
  for (const a of [...assets].sort((x, y) => order(x) - order(y))) {
    const f = kitFormat(a.format);
    const g = kitGroup(f?.group ?? a.group) ?? KIT_GROUPS[0];
    let path = `${g.folder[lang]}/${f ? f.file[lang] : "imagen"}.png`;
    for (let i = 2; used.has(path); i++) path = path.replace(/(-\d+)?\.png$/, `-${i}.png`);
    used.add(path);
    out.push({ path, asset: a });
  }
  return out;
}

// ---------- Frase de las portadas ----------

export type CoverLang = "es" | "en" | "both";
export type CoverText = { lang: CoverLang; es: string; en: string };
export const TAGLINE_MAX = 70;

/** Limpia la frase: sin comillas alrededor, sin espacios dobles, sin punto final y con un largo que quepa. */
export function cleanTagline(v: unknown): string {
  let s = typeof v === "string" ? v : "";
  s = s.replace(/\s+/g, " ").trim().replace(/^["“”'«»]+|["“”'«»]+$/g, "").trim();
  s = s.replace(/\.$/, "");
  if (s.length > TAGLINE_MAX) s = s.slice(0, TAGLINE_MAX).replace(/\s+\S*$/, "").replace(/[,;:\-–—]$/, "");
  return s;
}

export const asCoverLang = (v: unknown): CoverLang => (v === "en" || v === "both" ? v : "es");

/** Las líneas que llevan las portadas según el idioma elegido (la principal primero). */
export function coverLines(c: CoverText): string[] {
  const es = cleanTagline(c.es);
  const en = cleanTagline(c.en);
  if (c.lang === "en") return [en || es].filter(Boolean);
  if (c.lang === "both") return [es || en, es && en && es !== en ? en : ""].filter(Boolean);
  return [es || en].filter(Boolean);
}

/**
 * Frase de respaldo cuando no hay IA: la primera oración de la descripción del negocio si es corta
 * ("Fameseg es una empresa de puertas enrollables en Managua." → "Puertas enrollables en Managua"), si no una general.
 */
export function fallbackTagline(b: { name: string; aiProfile?: string }): { es: string; en: string } {
  const generic = { es: "Estamos para ayudarte", en: "We're here to help" };
  const first = (b.aiProfile ?? "").replace(/\s+/g, " ").trim();
  const name = b.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = name ? new RegExp(`^${name}[^\\s]*(?:\\s+\\S+\\.?)?\\s+(?:es|somos)\\s+(?:una?\\s+)?(.+)$`, "i").exec(first) : null;
  // Solo la primera oración ("Corp." u otra abreviatura antes de "es" ya quedó atrás).
  let rest = (m?.[1] ?? "").split(/[.!?](?:\s|$)/)[0].trim();
  // "empresa de puertas…" → "Puertas…": la palabra "empresa/firma/negocio" no dice nada en una portada.
  rest = rest.replace(/^(empresa|firma|compañía|negocio|tienda|agencia)\s+(de|que)\s+/i, "");
  if (rest.length >= 12 && rest.length <= TAGLINE_MAX) return { es: rest[0].toUpperCase() + rest.slice(1), en: generic.en };
  return generic;
}

// ---------- Logos: cuál va sobre cada fondo ----------

/** Color medio de lo visible de un logo (RGBA crudo). null si casi no tiene nada visible. */
export function averageInk(data: Uint8Array | Buffer, step = 4): string | null {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i + 3 < data.length; i += 4 * step) {
    const a = data[i + 3];
    if (a < 160) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (!n) return null;
  const h = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Qué versión del logo va sobre un fondo: la de color si se distingue bien; si no, la blanca sobre fondos oscuros
 * y la de un solo color oscuro sobre fondos claros.
 */
export function logoFor(bg: string, colorInk: string | null): "color" | "light" | "dark" {
  if (colorInk && contrast(colorInk, bg) >= 2.6) return "color";
  return isDark(bg) || contrast(bg, "#ffffff") >= contrast(bg, "#111111") ? "light" : "dark";
}

/** ¿Fondo oscuro? (el texto encima va en blanco). */
export function isDark(bg: string): boolean {
  return contrast(bg, "#ffffff") >= 3;
}

/** Color de fondo de las portadas: el principal; si es claro, una versión más oscura para que el blanco se lea bien. */
export function coverBackground(c1: string): string {
  let bg = c1;
  for (let i = 0; i < 12 && contrast(bg, "#ffffff") < 4.5; i++) bg = mix(bg, "#000000", 0.1);
  return bg;
}

// ---------- Medidas ----------

/** Tamaño de algo de proporción `aspect` (ancho/alto) dentro de un recuadro, sin estirarlo. */
export function fitInside(aspect: number, boxW: number, boxH: number): { w: number; h: number } {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  return boxW / boxH > a ? { w: Math.round(boxH * a), h: Math.round(boxH) } : { w: Math.round(boxW), h: Math.round(boxW / a) };
}

/** Tamaño de algo de proporción `aspect` dentro de un círculo de diámetro `d` (para la foto de perfil). */
export function fitInCircle(aspect: number, d: number, margin = 0.82): { w: number; h: number } {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  // Rectángulo inscrito: la diagonal mide lo mismo que el diámetro.
  const w = (d * a) / Math.sqrt(a * a + 1);
  return { w: Math.round(w * margin), h: Math.round((w / a) * margin) };
}

/** Iniciales para el monograma cuando no hay símbolo: "Ricardo Public Adjusters" → "RP"; "Fameseg" → "F". */
export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(de|del|la|las|el|los|y|and|the|of|corp|inc|llc|sa|s\.a)$/i.test(w));
  const s = (words[0]?.[0] ?? "?") + (words.length > 1 ? words[1][0] : "");
  return s.toUpperCase();
}

/** Dirección corta del sitio: "https://www.fameseg.com/" → "fameseg.com". */
export const hostOf = (url = "") => url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");

// ---------- Firma de email ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type SignatureData = {
  /** Nombre del negocio. */
  name: string;
  /** Nombre y cargo de quien firma (opcionales). */
  person?: string;
  role?: string;
  tagline?: string;
  phone?: string;
  website?: string;
  color: string;
  logoUrl?: string;
  logoW?: number;
  logoH?: number;
};

/** Firma de email en HTML con tablas y estilos en línea (lo único que respetan Gmail y Outlook). */
export function signatureHtml(d: SignatureData): string {
  const color = /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : "#126BBC";
  const site = hostOf(d.website);
  const href = d.website ? (/^https?:\/\//i.test(d.website) ? d.website : `https://${site}`) : "";
  const tel = (d.phone ?? "").replace(/[^\d+]/g, "");
  const person = d.person?.trim() ?? "";
  const lw = d.logoW && d.logoH ? Math.min(160, Math.round((d.logoW / d.logoH) * 56)) : 140;
  const lh = d.logoW && d.logoH ? Math.round((lw * d.logoH) / d.logoW) : 0;
  const logo = d.logoUrl
    ? `<td style="padding:0 16px 0 0;vertical-align:middle;border-right:3px solid ${color};"><img src="${esc(d.logoUrl)}" alt="${esc(d.name)}" width="${lw}"${lh ? ` height="${lh}"` : ""} style="display:block;width:${lw}px;${lh ? `height:${lh}px;` : ""}border:0;" /></td>`
    : "";
  const rows = [
    `<div style="font-size:16px;font-weight:bold;color:${color};margin:0 0 2px 0;">${esc(person || d.name)}</div>`,
    person ? `<div style="font-size:13px;color:#555555;margin:0 0 6px 0;">${esc([d.role?.trim(), d.name].filter(Boolean).join(" · "))}</div>` : "",
    !person && d.tagline ? `<div style="font-size:13px;color:#555555;margin:0 0 6px 0;">${esc(d.tagline)}</div>` : "",
    d.phone ? `<div style="font-size:13px;color:#333333;margin:0;">Tel. <a href="tel:${esc(tel)}" style="color:#333333;text-decoration:none;">${esc(d.phone)}</a></div>` : "",
    site ? `<div style="font-size:13px;margin:0;"><a href="${esc(href)}" style="color:${color};text-decoration:none;">${esc(site)}</a></div>` : "",
  ].join("");
  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;border-collapse:collapse;"><tr>${logo}<td style="padding:0 0 0 ${logo ? 16 : 0}px;vertical-align:middle;">${rows}</td></tr></table>`;
}

/** La misma firma en texto simple (para los programas que no aceptan HTML al pegar). */
export function signatureText(d: SignatureData): string {
  const person = d.person?.trim();
  const head = person ? [person, [d.role?.trim(), d.name].filter(Boolean).join(" · ")] : [d.name, d.tagline];
  return [...head, d.phone ? `Tel. ${d.phone}` : "", hostOf(d.website)].filter(Boolean).join("\n");
}

// ---------- Símbolo dentro de un logo horizontal o apilado ----------

export type Box = { left: number; top: number; width: number; height: number };

/** Tramos seguidos de `true` separados por huecos de al menos `gap` (inicio y fin incluidos). */
function runs(filled: boolean[], gap: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  let empty = 0;
  for (let i = 0; i < filled.length; i++) {
    if (filled[i]) {
      if (start < 0) start = i;
      else if (empty >= gap) {
        out.push([start, i - empty - 1]);
        start = i;
      }
      empty = 0;
    } else if (start >= 0) empty++;
  }
  if (start >= 0) out.push([start, filled.length - 1 - empty]);
  return out;
}

/**
 * Busca el símbolo de un logo (lo que va antes del nombre, separado por un espacio vacío): a la izquierda en un
 * logo horizontal o arriba en uno apilado. Recibe el canal alfa (ancho × alto). null si no hay uno claro.
 */
export function symbolBox(alpha: Uint8Array, w: number, h: number): Box | null {
  const on = (x: number, y: number) => alpha[y * w + x] > 40;
  const extentRows = (x0: number, x1: number): [number, number] => {
    let top = h, bottom = -1;
    for (let y = 0; y < h; y++) for (let x = x0; x <= x1; x++) if (on(x, y)) { if (y < top) top = y; bottom = y; break; }
    return [top, bottom];
  };
  const extentCols = (y0: number, y1: number): [number, number] => {
    let left = w, right = -1;
    for (let x = 0; x < w; x++) for (let y = y0; y <= y1; y++) if (on(x, y)) { if (x < left) left = x; right = x; break; }
    return [left, right];
  };
  const cols = Array.from({ length: w }, (_, x) => { for (let y = 0; y < h; y++) if (on(x, y)) return true; return false; });
  const cr = runs(cols, Math.max(3, Math.round(w * 0.02)));
  if (cr.length >= 2) {
    const [x0, x1] = cr[0];
    const [y0, y1] = extentRows(x0, x1);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const [, all1] = [0, cr[cr.length - 1][1]];
    if (bh > 0 && bw / bh >= 0.5 && bw / bh <= 1.8 && bh >= h * 0.5 && bw <= (all1 - cr[0][0]) * 0.45) return { left: x0, top: y0, width: bw, height: bh };
  }
  const rows = Array.from({ length: h }, (_, y) => { for (let x = 0; x < w; x++) if (on(x, y)) return true; return false; });
  const rr = runs(rows, Math.max(3, Math.round(h * 0.03)));
  if (rr.length >= 2) {
    const [y0, y1] = rr[0];
    const [x0, x1] = extentCols(y0, y1);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw > 0 && bw / bh >= 0.5 && bw / bh <= 1.8 && bh <= (rr[rr.length - 1][1] - rr[0][0]) * 0.75 && bh >= h * 0.3) return { left: x0, top: y0, width: bw, height: bh };
  }
  return null;
}

/**
 * Logo de un solo color "con tonos" para logos de varios colores: lo oscuro queda lleno, lo de color medio queda
 * más suave y lo casi blanco se vuelve transparente. Así un logo azul y verde en blanco no queda como una mancha.
 * Cambia `data` (RGBA crudo) en su lugar.
 */
export function toneInk(data: Uint8Array | Buffer, hex: string): void {
  const n = parseInt(hex.replace("#", ""), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lumas: number[] = [];
  const luma = (i: number) => (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  for (let i = 0; i < data.length; i += 16) if (data[i + 3] > 160) lumas.push(luma(i));
  lumas.sort((a, b) => a - b);
  const lo = Math.min(0.75, lumas[Math.floor(lumas.length * 0.05)] ?? 0);
  for (let i = 0; i < data.length; i += 4) {
    const y = luma(i);
    const t = Math.max(0, Math.min(1, (y - lo) / (0.88 - lo)));
    const k = y > 0.88 ? 0 : 1 - 0.55 * t;
    data[i + 3] = Math.round(data[i + 3] * k);
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
  }
}

/** ¿Tiene varios colores muy distintos? (RGBA crudo). Compara con el color más común, no con el promedio. */
export function isMultiColor(data: Uint8Array | Buffer): boolean {
  const count = new Map<number, number>();
  let all = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 160) continue;
    all++;
    const k = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  if (!all) return false;
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const c = [((top >> 8) & 15) * 16 + 8, ((top >> 4) & 15) * 16 + 8, (top & 15) * 16 + 8];
  let far = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 160) continue;
    if (Math.abs(data[i] - c[0]) + Math.abs(data[i + 1] - c[1]) + Math.abs(data[i + 2] - c[2]) > 120) far++;
  }
  return far / all > 0.12;
}

/** Corre `fn` sobre la lista con como mucho `limit` a la vez. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}
