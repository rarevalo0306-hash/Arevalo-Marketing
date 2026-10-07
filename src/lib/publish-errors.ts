// Traduce los errores técnicos de cada canal (lo que guardamos en PostTarget.detail) a palabras sencillas
// y dice qué hacer. Lo usan el Historial, el reintento y Conexiones ("Necesita volver a conectarse").

import { channelName } from "@/lib/channels";
import type { UiLang } from "@/lib/i18n";

export type FailureKind =
  /** Facebook/Instagram quitaron el permiso o el token venció: hay que volver a conectar. */
  | "reconnect-meta"
  /** Otra conexión dejó de funcionar (clave vencida o borrada). */
  | "reconnect"
  /** A la conexión le faltan datos (se guardó a medias). */
  | "missing-fields"
  | "not-connected"
  | "no-email-contacts"
  | "no-sms-contacts"
  | "website-not-ready"
  | "website-no-write"
  | "needs-media"
  | "needs-video"
  | "media-rejected"
  | "ai-missing"
  | "temporary"
  | "unknown";

/** Errores que no se arreglan reintentando: el dueño tiene que hacer algo antes. */
const OWNER_MUST_ACT: FailureKind[] = [
  "reconnect-meta",
  "reconnect",
  "missing-fields",
  "not-connected",
  "no-email-contacts",
  "no-sms-contacts",
  "website-not-ready",
  "website-no-write",
  "needs-media",
  "needs-video",
  "ai-missing",
];

/** Errores que significan "esta conexión ya no sirve, vuelve a conectarla". */
const RECONNECT: FailureKind[] = ["reconnect-meta", "reconnect", "missing-fields"];

const META = new Set(["facebook", "instagram"]);

// Facebook: "Any of the pages_read_engagement, ... permission(s) must be granted before impersonating a user's page",
// "(#200) ...permission", "(#10) Application does not have permission", "Error validating access token: Session has expired/invalidated".
const META_AUTH =
  /impersonat|permission\(s\) must be granted|pages_(?:read_engagement|manage_posts|manage_metadata|show_list|read_user_content)|instagram_content_publish|\(#(?:10|190|200)\)|error validating access token|session has (?:expired|been invalidated)|has not authorized application|invalid oauth|access token .*(?:expired|invalid)|cannot parse access token|OAuthException/i;
// Google, Brevo/Resend, Twilio, GitHub, TikTok: claves vencidas o revocadas.
const GENERIC_AUTH =
  /^401\b|^403: (?:bad credentials|unauthorized|forbidden)|invalid_grant|token has been expired or revoked|invalid[_ ](?:api[_ ])?key|key not found|unauthorized|bad credentials|access_token_invalid|authenticat(?:e|ion) (?:failed|required)/i;
const TEMPORARY =
  /^5\d\d\b|fetch failed|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|timed? ?out|temporarily|try again later|rate limit|too many|\(#(?:1|2|4|17|32|341|368)\)|^429\b/i;

/** Clasifica el detalle técnico de un canal que falló o se saltó. */
export function classifyFailure(detail: string, channel = ""): FailureKind {
  const d = (detail || "").trim();
  if (!d) return "unknown";
  if (/no está conectado para este negocio/i.test(d)) return "not-connected";
  if (/contactos con email|contactos que hayan aceptado recibir correos/i.test(d)) return "no-email-contacts";
  if (/contactos con tel[eé]fono|contactos que hayan aceptado recibir textos/i.test(d)) return "no-sms-contacts";
  if (/sitio todav[ií]a no est[aá] preparado/i.test(d)) return "website-not-ready";
  if (/puede leer .* pero no escribir/i.test(d)) return "website-no-write";
  if (/Faltan datos de la conexi[oó]n/i.test(d)) return "missing-fields";
  if (/Falta una clave de IA/i.test(d)) return "ai-missing";
  if (/TikTok necesita un video/i.test(d)) return "needs-video";
  if (/necesita una foto o un video/i.test(d)) return "needs-media";
  if (/no pudo procesar el archivo|No se pudo descargar la foto|media (?:type|url).*(?:not supported|invalid)|aspect ratio|\(#(?:36003|9004|2207\d*)\)/i.test(d)) return "media-rejected";
  if (META.has(channel) || /graph\.facebook|impersonat/i.test(d)) {
    if (META_AUTH.test(d)) return "reconnect-meta";
  }
  if (GENERIC_AUTH.test(d)) return "reconnect";
  if (TEMPORARY.test(d)) return "temporary";
  return "unknown";
}

export const ownerMustAct = (kind: FailureKind) => OWNER_MUST_ACT.includes(kind);
export const isReconnectKind = (kind: FailureKind) => RECONNECT.includes(kind);

/** ¿Este detalle dice que hay que volver a conectar el canal? */
export function needsReconnect(detail: string, channel = ""): boolean {
  return isReconnectKind(classifyFailure(detail, channel));
}

export type Explained = {
  kind: FailureKind;
  /** Lo que pasó y qué hacer, en palabras sencillas. */
  message: string;
  /** Botón para arreglarlo (ruta dentro de la app). */
  action?: { label: string; href: string };
  /** true si reintentar no sirve hasta que el dueño haga algo. */
  ownerMustAct: boolean;
  /** El error original, para mostrarlo escondido en "Detalle técnico" cuando ayuda. */
  technical?: string;
};

/** Explica por qué un canal falló o se saltó, y qué hacer. */
export function explainFailure(channel: string, detail: string, lang: UiLang, businessId: string): Explained {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const name = channelName(channel, lang);
  const kind = classifyFailure(detail, channel);
  const conexiones = (c = channel) => `/b/${businessId}/conexiones#c-${c}`;
  const reconnectBtn = (c = channel) => ({ label: t(`Volver a conectar ${channelName(c, lang)}`, `Reconnect ${channelName(c, lang)}`), href: conexiones(c) });
  const base = { kind, ownerMustAct: ownerMustAct(kind) };
  switch (kind) {
    case "reconnect-meta":
      return {
        ...base,
        message:
          channel === "instagram"
            ? t(
                "Facebook quitó el permiso para publicar en tu Instagram. Vuelve a conectar Facebook en Conexiones (toma 1 minuto); Instagram se conecta junto con Facebook.",
                "Facebook removed the permission to post on your Instagram. Reconnect Facebook in Connections (takes 1 minute); Instagram reconnects along with it.",
              )
            : t(
                "Facebook quitó el permiso para publicar en tu página. Vuelve a conectar Facebook en Conexiones (toma 1 minuto).",
                "Facebook removed the permission to post on your Page. Reconnect Facebook in Connections (takes 1 minute).",
              ),
        action: reconnectBtn("facebook"),
        technical: detail,
      };
    case "reconnect":
      return {
        ...base,
        message: t(
          `La conexión con ${name} dejó de funcionar (la clave venció o se borró). Vuelve a conectar ${name} en Conexiones.`,
          `The ${name} connection stopped working (the key expired or was removed). Reconnect ${name} in Connections.`,
        ),
        action: reconnectBtn(),
        technical: detail,
      };
    case "missing-fields":
      return {
        ...base,
        message: t(`A la conexión de ${name} le faltan datos. Vuelve a conectarla en Conexiones.`, `The ${name} connection is missing some details. Reconnect it in Connections.`),
        action: reconnectBtn(),
        technical: detail,
      };
    case "not-connected":
      return {
        ...base,
        message: t(`${name} no está conectado, así que no se publicó ahí. Conéctalo en Conexiones o quítalo de los canales.`, `${name} isn't connected, so nothing was posted there. Connect it in Connections or remove it from the channels.`),
        action: { label: t(`Conectar ${name}`, `Connect ${name}`), href: conexiones() },
      };
    case "no-email-contacts":
      return {
        ...base,
        message: t(
          "No tienes contactos para correo (nadie ha aceptado recibir tus correos). Quita Email de los canales, o agrega contactos si quieres enviar correos.",
          "You have no email contacts (nobody has agreed to get your emails). Remove Email from the channels, or add contacts if you want to send emails.",
        ),
        action: { label: t("Ver contactos", "See contacts"), href: `/b/${businessId}/contactos` },
      };
    case "no-sms-contacts":
      return {
        ...base,
        message: t(
          "No tienes contactos para mensajes de texto (nadie ha aceptado recibirlos). Quita Texto (SMS) de los canales, o agrega contactos.",
          "You have no text-message contacts (nobody has agreed to get them). Remove Text (SMS) from the channels, or add contacts.",
        ),
        action: { label: t("Ver contactos", "See contacts"), href: `/b/${businessId}/contactos` },
      };
    case "website-not-ready":
      return {
        ...base,
        message: t(
          "Tu sitio web todavía no está preparado para recibir artículos desde aquí (le falta un archivo). Pide a quien hizo tu página que lo prepare, o quita «Sitio web» de los canales.",
          "Your website isn't set up yet to receive articles from here (a file is missing). Ask whoever built your site to set it up, or remove “Website” from the channels.",
        ),
        action: { label: t("Ver cómo prepararlo", "See how to set it up"), href: conexiones() },
        technical: detail,
      };
    case "website-no-write":
      return {
        ...base,
        message: t(
          "La conexión con tu sitio web solo puede leer, no puede agregar artículos. Vuelve a conectarla con permiso para escribir.",
          "The website connection can only read; it can't add articles. Reconnect it with permission to write.",
        ),
        action: reconnectBtn(),
        technical: detail,
      };
    case "needs-media":
      return {
        ...base,
        message: t(`${name} necesita una foto o un video. Haz una publicación nueva con foto, o quita ${name} de los canales.`, `${name} needs a photo or a video. Make a new post with a photo, or remove ${name} from the channels.`),
      };
    case "needs-video":
      return {
        ...base,
        message: t(`${name} solo acepta videos. Haz una publicación nueva con video, o quita ${name} de los canales.`, `${name} only takes videos. Make a new post with a video, or remove ${name} from the channels.`),
      };
    case "media-rejected":
      return {
        ...base,
        message: t(
          `${name} no aceptó la foto o el video. Prueba otra vez; si vuelve a fallar, usa otra foto (JPG) o un video más corto.`,
          `${name} didn't accept the photo or video. Try again; if it fails again, use a different photo (JPG) or a shorter video.`,
        ),
        technical: detail,
      };
    case "ai-missing":
      return {
        ...base,
        message: t(
          "La app no tiene la IA activada, y la necesita para escribir el artículo del sitio web. Pide a quien administra la app que agregue la clave de IA.",
          "The app doesn't have AI turned on, and it needs it to write the website article. Ask whoever manages the app to add the AI key.",
        ),
        technical: detail,
      };
    case "temporary":
      return {
        ...base,
        message: t(`${name} tuvo un problema pasajero. Vuelve a intentarlo en unos minutos.`, `${name} had a temporary problem. Try again in a few minutes.`),
        technical: detail,
      };
    default:
      return {
        ...base,
        message: detail
          ? t(`${name} no aceptó la publicación. Vuelve a intentarlo; si sigue fallando, revisa la conexión en Conexiones.`, `${name} didn't accept the post. Try again; if it keeps failing, check the connection in Connections.`)
          : t(`No se pudo publicar en ${name}. Vuelve a intentarlo.`, `Couldn't post on ${name}. Try again.`),
        action: detail ? { label: t("Revisar conexión", "Check connection"), href: conexiones() } : undefined,
        technical: detail || undefined,
      };
  }
}

/** Texto del enlace a la publicación ya hecha: "Ver en Facebook", "Ver el artículo"… */
export function viewLabel(channel: string, lang: UiLang): string {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  if (channel === "seo") return t("Ver el artículo", "See the article");
  return t(`Ver en ${channelName(channel, lang)}`, `See on ${channelName(channel, lang)}`);
}

/** Lo que salió bien en palabras sencillas (el detalle del canal ya viene en español). */
export function explainSent(channel: string, detail: string, lang: UiLang): string {
  const name = channelName(channel, lang);
  // El id interno de TikTok no le sirve al dueño.
  const clean = (detail || "").replace(/\.?\s*Id \S+\s*$/, "").trim();
  if (lang === "es") return clean || `Publicado en ${name}`;
  const n = clean.match(/a (\d+) contactos?/);
  if (channel === "email" && n) return `Email sent to ${n[1]} contact${n[1] === "1" ? "" : "s"}`;
  if (channel === "sms" && n) return `Text sent to ${n[1]} contact${n[1] === "1" ? "" : "s"}`;
  if (channel === "seo") return "Article sent to your website (in Spanish and English); it goes live in a few minutes";
  if (channel === "tiktok") return "Sent to TikTok; it will be ready in a few minutes";
  return `Posted on ${name}`;
}
