// Definición de canales y reglas compartidas entre el compositor (navegador) y el servidor.
// Los textos de CHANNELS están en español; channelText(def, lang) da la versión en el idioma de la app.

import { intlLocale, translator, type UiLang } from "@/lib/i18n";

export type ChannelId = "facebook" | "instagram" | "tiktok" | "google" | "seo" | "email" | "sms";
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
  /** Límite de caracteres del texto; 0 = sin límite. */
  limit: number;
  what: string;
  need: string;
  fields: CredentialField[];
};

export const SMS_FOOTER = "\nResponde STOP para no recibir más.";

export const CHANNELS: ChannelDef[] = [
  {
    id: "facebook",
    name: "Facebook",
    mono: "FB",
    kind: "Publicación",
    limit: 63206,
    what: "Publicaciones en la página del negocio",
    need: "La Página de Facebook del negocio y un token de página con permiso pages_manage_posts (desde developers.facebook.com).",
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
    limit: 2200,
    what: "Posts y Reels",
    need: "Cuenta profesional de Instagram vinculada a la Página de Facebook, y un token con permiso instagram_content_publish.",
    fields: [
      { key: "igUserId", label: "ID de la cuenta de Instagram", placeholder: "17841400000000000" },
      { key: "accessToken", label: "Token de acceso", secret: true },
    ],
  },
  {
    id: "tiktok",
    name: "TikTok",
    mono: "TT",
    kind: "Video",
    limit: 2200,
    what: "Videos",
    need: "Una app en developers.tiktok.com con Content Posting API (video.publish). TikTok solo acepta videos.",
    fields: [
      { key: "clientKey", label: "Client key" },
      { key: "clientSecret", label: "Client secret", secret: true },
      { key: "refreshToken", label: "Refresh token", secret: true },
    ],
  },
  {
    id: "google",
    name: "Google",
    mono: "G",
    kind: "Perfil de Negocio",
    limit: 1500,
    what: "Novedades en el Perfil de Negocio (Maps)",
    need: "Perfil de Negocio verificado. Presiona \"Conectar con Google\" y entra con la cuenta dueña del perfil.",
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
    name: "Sitio web / SEO",
    mono: "WEB",
    kind: "Artículo en tu sitio",
    limit: 0,
    what: "Un artículo nuevo en tu sitio, en español e inglés",
    need: "Tu sitio en GitHub (con Vercel) preparado para recibir artículos, y un token de GitHub con permiso para escribir en ese repositorio.",
    fields: [
      { key: "repo", label: "Repositorio en GitHub", placeholder: "rarevalo0306-hash/RicardoPA-Web" },
      { key: "branch", label: "Rama que publica Vercel", placeholder: "main" },
      { key: "siteUrl", label: "Dirección del sitio", placeholder: "https://ricardopa.com" },
      { key: "githubToken", label: "Token de GitHub (fine-grained, permiso Contents: escritura)", secret: true },
    ],
  },
  {
    id: "email",
    name: "Email",
    mono: "@",
    kind: "Boletín",
    limit: 0,
    what: "Email a los contactos que aceptaron recibirlos",
    need: "Una cuenta de Brevo (brevo.com, 300 correos al día gratis) o de Resend (resend.com) con tu dominio verificado, y su API key.",
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
    limit: 160,
    what: "Mensajes de texto a contactos que aceptaron recibirlos",
    need: "Una cuenta de Twilio con un número registrado para enviar SMS (en EE. UU. requiere registro A2P 10DLC).",
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
  need: string;
  /** Solo los campos con texto en español; los nombres técnicos (Client key, API key…) se quedan igual. */
  fields?: Record<string, { label?: string; help?: string; placeholder?: string }>;
};

/** Textos en inglés de cada canal (los ids, límites y campos no cambian). */
const CHANNELS_EN: Record<ChannelId, ChannelTextEn> = {
  facebook: {
    kind: "Post",
    what: "Posts on the business's Page",
    need: "The business's Facebook Page and a Page token with the pages_manage_posts permission (from developers.facebook.com).",
    fields: { pageId: { label: "Page ID" }, accessToken: { label: "Page access token" } },
  },
  instagram: {
    kind: "Post or Reel",
    what: "Posts and Reels",
    need: "An Instagram professional account linked to the Facebook Page, and a token with the instagram_content_publish permission.",
    fields: { igUserId: { label: "Instagram account ID" }, accessToken: { label: "Access token" } },
  },
  tiktok: {
    kind: "Video",
    what: "Videos",
    need: "An app on developers.tiktok.com with the Content Posting API (video.publish). TikTok only accepts videos.",
  },
  google: {
    kind: "Business Profile",
    what: "Updates on your Business Profile (Maps)",
    need: "A verified Business Profile. Click \"Connect with Google\" and sign in with the account that owns the profile.",
    fields: {
      accountId: { label: "Account ID", placeholder: "accounts/123… → just the number" },
      locationId: { label: "Location ID", placeholder: "just the number" },
    },
  },
  seo: {
    name: "Website / SEO",
    kind: "Article on your website",
    what: "A new article on your website, in Spanish and English",
    need: "Your website on GitHub (with Vercel) set up to receive articles, and a GitHub token with permission to write to that repository.",
    fields: {
      repo: { label: "GitHub repository" },
      branch: { label: "Branch that Vercel publishes" },
      siteUrl: { label: "Website address" },
      githubToken: { label: "GitHub token (fine-grained, Contents: write permission)" },
    },
  },
  email: {
    kind: "Newsletter",
    what: "Email to contacts who agreed to receive it",
    need: "A Brevo account (brevo.com, 300 free emails a day) or a Resend account (resend.com) with your domain verified, plus its API key.",
    fields: {
      from: { label: "Sender", placeholder: "Your Business <info@yourbusiness.com>" },
      apiKey: { label: "Brevo API key (xkeysib-…) or Resend API key (re_…)" },
    },
  },
  sms: {
    name: "Text (SMS)",
    kind: "Text message",
    what: "Text messages to contacts who agreed to receive them",
    need: "A Twilio account with a number registered to send SMS (in the US this requires A2P 10DLC registration).",
    fields: { from: { label: "Sending number" } },
  },
};

/** El canal con sus textos (nombre, tipo, qué publica, qué necesitas y campos) en el idioma de la app. */
export function channelText(def: ChannelDef, lang: UiLang): ChannelDef {
  if (lang !== "en") return def;
  const en = CHANNELS_EN[def.id];
  return {
    ...def,
    name: en.name ?? def.name,
    kind: en.kind,
    what: en.what,
    need: en.need,
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
