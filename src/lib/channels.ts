// Definición de canales y reglas compartidas entre el compositor (navegador) y el servidor.
// Los textos de CHANNELS están en español; channelText(def, lang) da la versión en el idioma de la app.

import { intlLocale, translator, type UiLang } from "@/lib/i18n";

export type ChannelId = "facebook" | "instagram" | "tiktok" | "youtube" | "google" | "seo" | "linkedin" | "x" | "email" | "sms";
/** Grupo en la pantalla de Conexiones: redes sociales, Google y tu web, mensajes. */
export type ChannelGroup = "social" | "google" | "messages";
export type MediaType = "none" | "photo" | "video";

export type CredentialField = {
  key: string;
  label: string;
  help?: string;
  secret?: boolean;
  placeholder?: string;
};

export type ChannelDef = {
  id: ChannelId;
  name: string;
  mono: string;
  kind: string;
  group: ChannelGroup;
  /** Límite de caracteres del texto; 0 = sin límite. */
  limit: number;
  what: string;
  /** Lo que gana el dueño al conectarlo, en palabras sencillas (lo primero que ve en la tarjeta). */
  gain: string;
  /** Pasos cuando hay botón de un clic (Facebook/Instagram/Google con OAuth, Email con Brevo de la app). */
  easy?: string[];
  /** Pasos para conectarlo a mano, con los nombres técnicos necesarios (tokens, permisos…). */
  steps: string[];
  /** Aviso claro si la red cobra o pide aprobar tu app (se muestra en «¿Cómo lo conecto?»). */
  cost?: string;
  fields: CredentialField[];
};

export const SMS_FOOTER = "\nResponde STOP para no recibir más.";

export const CHANNELS: ChannelDef[] = [
  {
    id: "facebook",
    name: "Facebook",
    mono: "FB",
    kind: "Publicación",
    group: "social",
    limit: 63206,
    what: "Publicaciones en la página del negocio",
    gain: "Publica en la página de Facebook de tu negocio desde aquí, sin tener que entrar a Facebook.",
    easy: [
      "Presiona «Conectar con Facebook».",
      "Entra con tu cuenta de Facebook (la que administra la página del negocio).",
      "Elige la página de tu negocio. ¡Listo!",
    ],
    steps: [
      "Entra a developers.facebook.com y crea una app de tipo «Negocio».",
      "Genera un token de página con el permiso pages_manage_posts para la página de tu negocio.",
      "Copia el ID de la página (aparece en la sección «Información» de tu página).",
      "Pega aquí el ID y el token, y presiona «Guardar y probar».",
    ],
    fields: [
      { key: "pageId", label: "ID de la página", placeholder: "1234567890" },
      { key: "accessToken", label: "Token de acceso de la página", secret: true },
    ],
  },
  {
    id: "instagram",
    name: "Instagram",
    mono: "IG",
    kind: "Post o Reel",
    group: "social",
    limit: 2200,
    what: "Posts y Reels",
    gain: "Publica fotos y Reels en el Instagram de tu negocio.",
    easy: [
      "Tu Instagram debe ser una cuenta profesional (de empresa o de creador) vinculada a la página de Facebook del negocio.",
      "Presiona «Conectar con Facebook» y entra con tu cuenta de Facebook.",
      "Elige la página del negocio: Instagram se conecta junto con ella.",
    ],
    steps: [
      "Cambia tu Instagram a cuenta profesional y vincúlalo a la página de Facebook del negocio.",
      "En developers.facebook.com genera un token con el permiso instagram_content_publish.",
      "Busca el ID de tu cuenta de Instagram (es un número que empieza con 1784…).",
      "Pega aquí el ID y el token, y presiona «Guardar y probar».",
    ],
    fields: [
      { key: "igUserId", label: "ID de la cuenta de Instagram", placeholder: "17841400000000000" },
      { key: "accessToken", label: "Token de acceso", secret: true },
    ],
  },
  {
    id: "google",
    name: "Google",
    mono: "G",
    kind: "Perfil de Negocio",
    group: "google",
    limit: 1500,
    what: "Novedades en el Perfil de Negocio (Maps)",
    gain: "Sal en Google Maps y en las búsquedas de Google con novedades y ofertas de tu negocio.",
    easy: [
      "Necesitas tu Perfil de Negocio de Google ya verificado.",
      "Presiona «Conectar con Google» y entra con la cuenta de Google dueña del perfil.",
      "Si administras varios perfiles, elige el de este negocio. ¡Listo!",
    ],
    steps: [
      "Necesitas tu Perfil de Negocio de Google ya verificado.",
      "En console.cloud.google.com crea un OAuth client ID con acceso a la Business Profile API.",
      "Genera un Refresh token y busca el ID de la cuenta y el ID de la ubicación (solo los números).",
      "Pega los datos aquí y presiona «Guardar y probar».",
    ],
    fields: [
      { key: "accountId", label: "ID de la cuenta", placeholder: "accounts/123… → solo el número" },
      { key: "locationId", label: "ID de la ubicación", placeholder: "solo el número" },
      { key: "clientId", label: "OAuth client ID" },
      { key: "clientSecret", label: "OAuth client secret", secret: true },
      { key: "refreshToken", label: "Refresh token", secret: true },
    ],
  },
  {
    id: "seo",
    name: "Sitio web",
    mono: "WEB",
    kind: "Artículo en tu sitio",
    group: "google",
    limit: 0,
    what: "Un artículo nuevo en tu sitio, en español e inglés",
    gain: "Publica artículos en tu página web para que más gente te encuentre en Google.",
    steps: [
      "Tu sitio web debe estar en GitHub, publicarse con Vercel y estar preparado para recibir artículos (pídele ayuda a quien hizo tu web).",
      "En github.com → tu foto → Settings → Developer settings → Personal access tokens → Fine-grained tokens, crea un token solo para el repositorio de tu web, con vencimiento de 1 año y estos permisos: Contents: Read and write, Pull requests: Read and write, Commit statuses: Read, Checks: Read (si aparece) y Metadata: Read.",
      "Pull requests, Commit statuses y Checks son para «Arréglalo por mí» (Matya arregla tu web y tú apruebas cada cambio). Si ya tenías el token, edítalo en GitHub y agrégale esos permisos: sigue siendo el mismo y no hay que volver a pegarlo.",
      "Escribe el repositorio, la rama que publica Vercel (casi siempre main) y la dirección de tu sitio.",
      "Pega el token y presiona «Guardar y probar».",
    ],
    fields: [
      { key: "repo", label: "Repositorio en GitHub", placeholder: "rarevalo0306-hash/RicardoPA-Web" },
      { key: "branch", label: "Rama que publica Vercel", placeholder: "main" },
      { key: "siteUrl", label: "Dirección del sitio", placeholder: "https://ricardopa.com" },
      { key: "githubToken", label: "Token de GitHub (fine-grained: Contents y Pull requests de escritura)", secret: true },
    ],
  },
  {
    id: "tiktok",
    name: "TikTok",
    mono: "TT",
    kind: "Video",
    group: "social",
    limit: 2200,
    what: "Videos",
    gain: "Sube videos a la cuenta de TikTok de tu negocio (TikTok solo acepta videos).",
    steps: [
      "Entra a developers.tiktok.com y crea una app.",
      "Activa la Content Posting API con el permiso video.publish.",
      "Copia el Client key, el Client secret y un Refresh token de tu cuenta.",
      "Pega los tres aquí y presiona «Guardar y probar».",
    ],
    cost: "Gratis. Pero hasta que TikTok revise y apruebe tu app (auditoría), los videos se publican en privado: solo tú los ves.",
    fields: [
      { key: "clientKey", label: "Client key" },
      { key: "clientSecret", label: "Client secret", secret: true },
      { key: "refreshToken", label: "Refresh token", secret: true },
    ],
  },
  {
    id: "youtube",
    name: "YouTube",
    mono: "YT",
    kind: "Video o Short",
    group: "social",
    limit: 5000,
    what: "Videos y Shorts en el canal del negocio",
    gain: "Sube tus videos a YouTube con títulos y etiquetas que Google entiende, para que te encuentren al buscar lo que vendes.",
    easy: [
      "Necesitas un canal de YouTube para tu negocio (se crea gratis en youtube.com con tu cuenta de Google).",
      "Presiona «Conectar con Google» y entra con la cuenta de Google dueña del canal.",
      "Acepta el permiso para subir videos. ¡Listo!",
    ],
    steps: [
      "En console.cloud.google.com activa la «YouTube Data API v3» en el mismo proyecto de la app.",
      "Crea (o usa) un OAuth client ID de tipo «Aplicación web».",
      "Genera un Refresh token con el permiso https://www.googleapis.com/auth/youtube.upload para la cuenta dueña del canal.",
      "Pega los tres datos aquí y presiona «Guardar y probar».",
    ],
    cost: "Gratis. YouTube permite unas 100 subidas al día por app. Si la app de Google todavía está «en pruebas», agrega la cuenta dueña del canal como usuario de prueba (Google Cloud → Pantalla de consentimiento de OAuth).",
    fields: [
      { key: "clientId", label: "OAuth client ID" },
      { key: "clientSecret", label: "OAuth client secret", secret: true },
      { key: "refreshToken", label: "Refresh token", secret: true },
    ],
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    mono: "in",
    kind: "Publicación",
    group: "social",
    limit: 3000,
    what: "Publicaciones en tu perfil o en la página de tu empresa",
    gain: "Publica en LinkedIn para que otros negocios y profesionales conozcan tu empresa.",
    steps: [
      "Entra a linkedin.com/developers y crea una app (te pide la página de LinkedIn de tu empresa).",
      "En la pestaña «Products» agrega «Share on LinkedIn» y «Sign In with LinkedIn using OpenID Connect». Son gratis y se activan al momento.",
      "Abre el generador de tokens (linkedin.com/developers/tools/oauth/token-generator), elige tu app, marca los permisos openid, profile y w_member_social, y genera el token.",
      "Pega el token aquí. Deja «Publicar como» vacío para publicar en tu perfil personal. Presiona «Guardar y probar».",
      "El token dura 60 días. Cuando venza, genera otro y pégalo aquí.",
    ],
    cost: "Gratis para publicar en tu perfil personal. Para publicar como la página de tu empresa, LinkedIn tiene que aprobar tu app (producto «Community Management API», permiso w_organization_social): lo pides en la pestaña «Products» y la revisión puede tardar semanas.",
    fields: [
      { key: "accessToken", label: "Token de acceso", secret: true },
      { key: "author", label: "Publicar como (opcional)", placeholder: "Vacío = tu perfil · urn:li:organization:12345 = tu empresa" },
    ],
  },
  {
    id: "x",
    name: "X (Twitter)",
    mono: "X",
    kind: "Post",
    group: "social",
    limit: 280,
    what: "Posts cortos (hasta 280 caracteres)",
    gain: "Publica mensajes cortos, con foto o video, en la cuenta de X de tu negocio.",
    steps: [
      "Entra a console.x.com con la cuenta de X de tu negocio y crea una app.",
      "En la app, abre «User authentication settings» y elige los permisos «Read and write».",
      "En «Keys and tokens» copia la API Key y la API Key Secret. Después genera el Access Token y el Access Token Secret (genéralos después de poner «Read and write»).",
      "Carga créditos en tu cuenta de desarrollador (X cobra por uso).",
      "Pega las 4 claves aquí y presiona «Guardar y probar».",
    ],
    cost: "X cobra por usar su API: unos US$0.015 por cada publicación y US$0.20 si lleva un enlace. Tienes que cargar créditos con tarjeta en console.x.com antes de publicar.",
    fields: [
      { key: "apiKey", label: "API Key", secret: true },
      { key: "apiSecret", label: "API Key Secret", secret: true },
      { key: "accessToken", label: "Access Token", secret: true },
      { key: "accessSecret", label: "Access Token Secret", secret: true },
    ],
  },
  {
    id: "email",
    name: "Email",
    mono: "@",
    kind: "Boletín",
    group: "messages",
    limit: 0,
    what: "Email a los contactos que aceptaron recibirlos",
    gain: "Manda correos a tus clientes que aceptaron recibirlos.",
    easy: [
      "Escribe el nombre que verán tus clientes (por ejemplo, el nombre de tu negocio).",
      "Escribe el email desde el que se envían los correos.",
      "Presiona «Conectar Email». ¡Listo!",
    ],
    steps: [
      "Crea una cuenta en Brevo (brevo.com, 300 correos al día gratis) o en Resend (resend.com).",
      "Verifica tu dominio en esa cuenta (la parte de tu email después de la @, por ejemplo tunegocio.com).",
      "Copia la API key (la de Brevo empieza con xkeysib-, la de Resend con re_).",
      "Pega aquí el remitente y la API key, y presiona «Guardar y probar».",
    ],
    fields: [
      { key: "from", label: "Remitente", placeholder: "Tu Negocio <info@tunegocio.com>" },
      { key: "apiKey", label: "API key de Brevo (xkeysib-…) o de Resend (re_…)", secret: true },
    ],
  },
  {
    id: "sms",
    name: "Texto (SMS)",
    mono: "SMS",
    kind: "Mensaje de texto",
    group: "messages",
    limit: 160,
    what: "Mensajes de texto a contactos que aceptaron recibirlos",
    gain: "Manda mensajes de texto al celular de clientes que aceptaron recibirlos.",
    steps: [
      "Crea una cuenta en Twilio (twilio.com) y consigue un número que pueda enviar SMS.",
      "Si envías a EE. UU., registra ese número (registro A2P 10DLC).",
      "Copia el Account SID y el Auth token desde tu panel de Twilio.",
      "Pégalos aquí junto con el número que envía y presiona «Guardar y probar».",
    ],
    fields: [
      { key: "accountSid", label: "Account SID" },
      { key: "authToken", label: "Auth token", secret: true },
      { key: "from", label: "Número que envía", placeholder: "+15551234567" },
    ],
  },
];

type ChannelTextEn = {
  name?: string;
  kind: string;
  what: string;
  gain: string;
  easy?: string[];
  steps: string[];
  cost?: string;
  /** Solo los campos con texto en español; los nombres técnicos (Client key, API key…) se quedan igual. */
  fields?: Record<string, { label?: string; help?: string; placeholder?: string }>;
};

/** Textos en inglés de cada canal (los ids, límites y campos no cambian). */
const CHANNELS_EN: Record<ChannelId, ChannelTextEn> = {
  facebook: {
    kind: "Post",
    what: "Posts on the business's Page",
    gain: "Post to your business's Facebook Page from here, without having to open Facebook.",
    easy: [
      "Click \"Connect with Facebook\".",
      "Sign in with your Facebook account (the one that manages the business's Page).",
      "Pick your business's Page. Done!",
    ],
    steps: [
      "Go to developers.facebook.com and create an app of type \"Business\".",
      "Generate a Page token with the pages_manage_posts permission for your business's Page.",
      "Copy the Page ID (it's in the \"About\" section of your Page).",
      "Paste the ID and the token here, then click \"Save and test\".",
    ],
    fields: { pageId: { label: "Page ID" }, accessToken: { label: "Page access token" } },
  },
  instagram: {
    kind: "Post or Reel",
    what: "Posts and Reels",
    gain: "Post photos and Reels to your business's Instagram.",
    easy: [
      "Your Instagram must be a professional account (business or creator) linked to the business's Facebook Page.",
      "Click \"Connect with Facebook\" and sign in with your Facebook account.",
      "Pick the business's Page: Instagram connects along with it.",
    ],
    steps: [
      "Switch your Instagram to a professional account and link it to the business's Facebook Page.",
      "On developers.facebook.com, generate a token with the instagram_content_publish permission.",
      "Find your Instagram account ID (a number that starts with 1784…).",
      "Paste the ID and the token here, then click \"Save and test\".",
    ],
    fields: { igUserId: { label: "Instagram account ID" }, accessToken: { label: "Access token" } },
  },
  tiktok: {
    kind: "Video",
    what: "Videos",
    gain: "Upload videos to your business's TikTok account (TikTok only accepts videos).",
    steps: [
      "Go to developers.tiktok.com and create an app.",
      "Turn on the Content Posting API with the video.publish permission.",
      "Copy the Client key, the Client secret and a Refresh token for your account.",
      "Paste all three here and click \"Save and test\".",
    ],
    cost: "Free. But until TikTok reviews and approves your app (audit), videos are posted as private: only you can see them.",
  },
  youtube: {
    kind: "Video or Short",
    what: "Videos and Shorts on the business's channel",
    gain: "Upload your videos to YouTube with titles and tags Google understands, so people find you when they search for what you sell.",
    easy: [
      "You need a YouTube channel for your business (create one for free at youtube.com with your Google account).",
      "Click \"Connect with Google\" and sign in with the Google account that owns the channel.",
      "Accept the permission to upload videos. Done!",
    ],
    steps: [
      "On console.cloud.google.com, turn on the \"YouTube Data API v3\" in the same project as the app.",
      "Create (or reuse) an OAuth client ID of type \"Web application\".",
      "Generate a Refresh token with the https://www.googleapis.com/auth/youtube.upload permission for the account that owns the channel.",
      "Paste the three details here and click \"Save and test\".",
    ],
    cost: "Free. YouTube allows about 100 uploads a day per app. If the Google app is still \"in testing\", add the account that owns the channel as a test user (Google Cloud → OAuth consent screen).",
  },
  linkedin: {
    kind: "Post",
    what: "Posts on your profile or your company Page",
    gain: "Post on LinkedIn so other businesses and professionals get to know your company.",
    steps: [
      "Go to linkedin.com/developers and create an app (it asks for your company's LinkedIn Page).",
      "In the \"Products\" tab, add \"Share on LinkedIn\" and \"Sign In with LinkedIn using OpenID Connect\". They're free and turn on right away.",
      "Open the token generator (linkedin.com/developers/tools/oauth/token-generator), pick your app, check the openid, profile and w_member_social permissions, and generate the token.",
      "Paste the token here. Leave \"Post as\" empty to post on your personal profile. Click \"Save and test\".",
      "The token lasts 60 days. When it expires, generate a new one and paste it here.",
    ],
    cost: "Free to post on your personal profile. To post as your company Page, LinkedIn has to approve your app (\"Community Management API\" product, w_organization_social permission): you request it in the \"Products\" tab and the review can take weeks.",
    fields: {
      accessToken: { label: "Access token" },
      author: { label: "Post as (optional)", placeholder: "Empty = your profile · urn:li:organization:12345 = your company" },
    },
  },
  x: {
    kind: "Post",
    what: "Short posts (up to 280 characters)",
    gain: "Post short messages, with a photo or video, to your business's X account.",
    steps: [
      "Go to console.x.com with your business's X account and create an app.",
      "In the app, open \"User authentication settings\" and choose \"Read and write\" permissions.",
      "In \"Keys and tokens\", copy the API Key and API Key Secret. Then generate the Access Token and Access Token Secret (generate them after setting \"Read and write\").",
      "Add credits to your developer account (X charges per use).",
      "Paste the 4 keys here and click \"Save and test\".",
    ],
    cost: "X charges for its API: about US$0.015 per post and US$0.20 if it has a link. You have to add credits with a card at console.x.com before posting.",
  },
  google: {
    kind: "Business Profile",
    what: "Updates on your Business Profile (Maps)",
    gain: "Show up on Google Maps and Google Search with your business's news and offers.",
    easy: [
      "You need your Google Business Profile already verified.",
      "Click \"Connect with Google\" and sign in with the Google account that owns the profile.",
      "If you manage several profiles, pick this business's. Done!",
    ],
    steps: [
      "You need your Google Business Profile already verified.",
      "On console.cloud.google.com, create an OAuth client ID with access to the Business Profile API.",
      "Generate a Refresh token and find the account ID and the location ID (just the numbers).",
      "Paste the details here and click \"Save and test\".",
    ],
    fields: {
      accountId: { label: "Account ID", placeholder: "accounts/123… → just the number" },
      locationId: { label: "Location ID", placeholder: "just the number" },
    },
  },
  seo: {
    name: "Website",
    kind: "Article on your website",
    what: "A new article on your website, in Spanish and English",
    gain: "Publish articles on your website so more people find you on Google.",
    steps: [
      "Your website must be on GitHub, published with Vercel and set up to receive articles (ask whoever built your site for help).",
      "On github.com → your photo → Settings → Developer settings → Personal access tokens → Fine-grained tokens, create a token for your website's repository only, expiring in 1 year, with these permissions: Contents: Read and write, Pull requests: Read and write, Commit statuses: Read, Checks: Read (if offered) and Metadata: Read.",
      "Pull requests, Commit statuses and Checks are for \"Fix it for me\" (Matya fixes your website and you approve every change). If you already had the token, edit it on GitHub and add those permissions: it stays the same and you don't need to paste it again.",
      "Enter the repository, the branch Vercel publishes (almost always main) and your website address.",
      "Paste the token and click \"Save and test\".",
    ],
    fields: {
      repo: { label: "GitHub repository" },
      branch: { label: "Branch that Vercel publishes" },
      siteUrl: { label: "Website address" },
      githubToken: { label: "GitHub token (fine-grained: Contents and Pull requests write)" },
    },
  },
  email: {
    kind: "Newsletter",
    what: "Email to contacts who agreed to receive it",
    gain: "Send emails to customers who agreed to receive them.",
    easy: [
      "Enter the name your customers will see (for example, your business name).",
      "Enter the email address the emails are sent from.",
      "Click \"Connect Email\". Done!",
    ],
    steps: [
      "Create an account on Brevo (brevo.com, 300 free emails a day) or Resend (resend.com).",
      "Verify your domain in that account (the part of your email after the @, for example yourbusiness.com).",
      "Copy the API key (Brevo's starts with xkeysib-, Resend's with re_).",
      "Paste the sender and the API key here, then click \"Save and test\".",
    ],
    fields: {
      from: { label: "Sender", placeholder: "Your Business <info@yourbusiness.com>" },
      apiKey: { label: "Brevo API key (xkeysib-…) or Resend API key (re_…)" },
    },
  },
  sms: {
    name: "Text (SMS)",
    kind: "Text message",
    what: "Text messages to contacts who agreed to receive them",
    gain: "Send text messages to the phones of customers who agreed to receive them.",
    steps: [
      "Create a Twilio account (twilio.com) and get a number that can send SMS.",
      "If you send to the US, register that number (A2P 10DLC registration).",
      "Copy the Account SID and the Auth token from your Twilio console.",
      "Paste them here along with the sending number, then click \"Save and test\".",
    ],
    fields: { from: { label: "Sending number" } },
  },
};

/** El canal con sus textos (nombre, tipo, qué publica, qué ganas, pasos y campos) en el idioma de la app. */
export function channelText(def: ChannelDef, lang: UiLang): ChannelDef {
  if (lang !== "en") return def;
  const en = CHANNELS_EN[def.id];
  return {
    ...def,
    name: en.name ?? def.name,
    kind: en.kind,
    what: en.what,
    gain: en.gain,
    easy: en.easy,
    steps: en.steps,
    cost: en.cost,
    fields: def.fields.map((f) => ({ ...f, ...en.fields?.[f.key] })),
  };
}

/** Nombre visible de un canal en el idioma de la app (o el id si no existe). */
export function channelName(id: string, lang: UiLang = "es"): string {
  const def = CHANNELS.find((c) => c.id === id);
  return def ? channelText(def, lang).name : id;
}

export const CHANNEL_IDS = CHANNELS.map((c) => c.id);

export function channelDef(id: string): ChannelDef | undefined {
  return CHANNELS.find((c) => c.id === id);
}

export type Draft = {
  text: string;
  subject: string;
  seoTitle: string;
  mediaType: MediaType;
};

export type NoteId = "empty" | "needsVideo" | "needsMedia" | "noSubject" | "noTitle" | "shortArticle" | "smsParts" | "tooLong";
/** `id` identifica el aviso sin depender del idioma del texto. */
export type Note = { id: NoteId; text: string; blocking: boolean };

/** Segmentos de SMS (GSM-7: 160 en uno, 153 por parte si son varios; Unicode: 70/67). */
export function smsSegments(body: string): number {
  const gsm = /^[\x0A\x0D\x20-\x7E¡£¤¥§¿ÄÅÆÇÉÑÖØÜßàäåæèéìñòöøùü]*$/.test(body);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  if (body.length <= single) return 1;
  return Math.ceil(body.length / multi);
}

export function smsBody(text: string): string {
  return text.trim() + SMS_FOOTER;
}

/** Avisos para un canal, en el idioma pedido (español por defecto). Los `blocking` impiden publicar en ese canal. */
export function notesFor(channel: ChannelId, d: Draft, lang: UiLang = "es"): Note[] {
  const t = translator(lang);
  const notes: Note[] = [];
  const len = d.text.length;
  const def = channelDef(channel)!;
  if (!d.text.trim()) notes.push({ id: "empty", text: t("Escribe tu mensaje.", "Write your message."), blocking: true });
  if (channel === "tiktok" && d.mediaType !== "video")
    notes.push({ id: "needsVideo", text: t("TikTok necesita un video para publicar.", "TikTok needs a video to post."), blocking: true });
  if (channel === "youtube" && d.mediaType !== "video")
    notes.push({ id: "needsVideo", text: t("YouTube necesita un video para publicar.", "YouTube needs a video to post."), blocking: true });
  if (channel === "instagram" && d.mediaType === "none")
    notes.push({ id: "needsMedia", text: t("Instagram necesita una foto o un video.", "Instagram needs a photo or a video."), blocking: true });
  if (channel === "email" && !d.subject.trim())
    notes.push({ id: "noSubject", text: t("Falta el asunto del email.", "The email subject is missing."), blocking: true });
  if (channel === "seo" && !d.seoTitle.trim())
    notes.push({ id: "noTitle", text: t("Falta el título del artículo.", "The article title is missing."), blocking: true });
  if (channel === "seo" && d.text.trim() && d.text.trim().length < 200)
    notes.push({
      id: "shortArticle",
      text: t(
        "Para un buen artículo en Google conviene escribir al menos un par de párrafos.",
        "For a good article on Google, it's best to write at least a couple of paragraphs.",
      ),
      blocking: false,
    });
  if (channel === "sms") {
    const parts = smsSegments(smsBody(d.text));
    if (parts > 1)
      notes.push({
        id: "smsParts",
        text: t(
          `Se enviará en ${parts} mensajes de texto por contacto. Acórtalo para que cueste menos.`,
          `This will go out as ${parts} text messages per contact. Shorten it so it costs less.`,
        ),
        blocking: false,
      });
  }
  if (def.limit && channel !== "sms" && len > def.limit) {
    const max = def.limit.toLocaleString(intlLocale(lang));
    notes.push({
      id: "tooLong",
      text: t(`Muy largo para ${def.name}: máximo ${max} caracteres.`, `Too long for ${channelText(def, lang).name}: ${max} characters max.`),
      blocking: true,
    });
  }
  return notes;
}

export function isBlocked(channel: ChannelId, d: Draft): boolean {
  return notesFor(channel, d).some((n) => n.blocking);
}
