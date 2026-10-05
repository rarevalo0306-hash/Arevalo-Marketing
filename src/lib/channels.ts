// Definición de canales y reglas compartidas entre el compositor (navegador) y el servidor.

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
      { key: "apiKey", label: "API key de Brevo (xkeysib-…) o de Resend (re_…)", secret: true },
      { key: "from", label: "Remitente", placeholder: "Tu Negocio <info@tunegocio.com>" },
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

export type Note = { text: string; blocking: boolean };

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

/** Avisos para un canal. Los `blocking` impiden publicar en ese canal. */
export function notesFor(channel: ChannelId, d: Draft): Note[] {
  const notes: Note[] = [];
  const len = d.text.length;
  const def = channelDef(channel)!;
  if (!d.text.trim()) notes.push({ text: "Escribe tu mensaje.", blocking: true });
  if (channel === "tiktok" && d.mediaType !== "video")
    notes.push({ text: "TikTok necesita un video para publicar.", blocking: true });
  if (channel === "instagram" && d.mediaType === "none")
    notes.push({ text: "Instagram necesita una foto o un video.", blocking: true });
  if (channel === "email" && !d.subject.trim())
    notes.push({ text: "Falta el asunto del email.", blocking: true });
  if (channel === "seo" && !d.seoTitle.trim())
    notes.push({ text: "Falta el título del artículo.", blocking: true });
  if (channel === "seo" && d.text.trim() && d.text.trim().length < 200)
    notes.push({ text: "Para un buen artículo en Google conviene escribir al menos un par de párrafos.", blocking: false });
  if (channel === "sms") {
    const parts = smsSegments(smsBody(d.text));
    if (parts > 1)
      notes.push({
        text: `Se enviará en ${parts} mensajes de texto por contacto. Acórtalo para que cueste menos.`,
        blocking: false,
      });
  }
  if (def.limit && channel !== "sms" && len > def.limit)
    notes.push({
      text: `Muy largo para ${def.name}: máximo ${def.limit.toLocaleString("es")} caracteres.`,
      blocking: true,
    });
  return notes;
}

export function isBlocked(channel: ChannelId, d: Draft): boolean {
  return notesFor(channel, d).some((n) => n.blocking);
}
