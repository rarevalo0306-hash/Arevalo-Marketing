// «Pedir reseñas»: mensajes cortos por email o SMS con el link de reseñas de Google. PURO (sin base de datos ni red):
// plantillas en español e inglés, a quién se le puede mandar (solo con permiso), límite por día y la regla de Google
// de no ofrecer nada a cambio. Quien envía es src/app/actions-directories.ts.

export type ReqChannel = "email" | "sms";
export type ReqLang = "es" | "en";

/** Máximo de personas por día (email + SMS juntos): pocas a la vez se ve natural y no cansa a tus clientes. */
export const REVIEW_DAILY_MAX = 30;
/** A la misma persona no se le vuelve a pedir antes de estos días. */
export const REVIEW_COOLDOWN_DAYS = 90;
/** El plan de acción avisa si hace más de estos días que no compartes tu link de reseñas. */
export const REVIEW_SHARE_DAYS = 30;
/** Tipos de registro (AiAction.kind) de esta pantalla. */
export const REVIEW_REQUEST_KIND = "review.request";
export const REVIEW_LINK_KIND = "review.link";
export const NAP_DESCRIPTION_KIND = "directory.description";

export type ReqTemplate = { subject: string; email: string; sms: string };

/** Plantillas por defecto: cortas, amables y sin ofrecer nada a cambio. {nombre}/{name} y {link} se llenan solos. */
export function defaultTemplate(lang: ReqLang, business: { name: string; slogan?: string; signer?: string }): ReqTemplate {
  const sign = [business.signer?.trim(), business.name.trim()].filter(Boolean).join(" · ");
  if (lang === "en")
    return {
      subject: `How did we do? ${business.name}`.slice(0, 120),
      email: [
        "Hi {name},",
        "",
        `Thank you for trusting ${business.name}. If you have a minute, would you tell other people about your experience on Google? It helps neighbors find honest help, and it helps us a lot.`,
        "",
        "Leave your review here: {link}",
        "",
        "Whatever your experience was, we'd love to hear it.",
        "",
        `Thanks,\n${sign}${business.slogan ? `\n${business.slogan}` : ""}`,
      ].join("\n"),
      sms: `Hi {name}, thanks for choosing ${business.name}! Would you share your experience on Google? It takes 1 minute: {link}`,
    };
  return {
    subject: `¿Cómo te atendimos? ${business.name}`.slice(0, 120),
    email: [
      "Hola {nombre}:",
      "",
      `Gracias por confiar en ${business.name}. Si tienes un minuto, ¿nos ayudas contando tu experiencia en Google? Le sirve a otras personas para encontrar ayuda confiable y a nosotros nos ayuda mucho.`,
      "",
      "Deja tu reseña aquí: {link}",
      "",
      "Sea cual sea tu experiencia, nos encantaría leerla.",
      "",
      `Gracias,\n${sign}${business.slogan ? `\n${business.slogan}` : ""}`,
    ].join("\n"),
    sms: `Hola {nombre}, ¡gracias por elegir ${business.name}! ¿Nos cuentas tu experiencia en Google? Toma 1 minuto: {link}`,
  };
}

/** El nombre de pila (para el saludo): «Ana María López» → «Ana». */
export function firstName(full: string): string {
  const w = full.trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}'-]{2,30}$/u.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : "";
}

/** Llena {nombre}/{name} y {link}. Sin nombre: «Hola {nombre}:» → «Hola:», «Hi {name},» → «Hi,». */
export function fillTemplate(text: string, v: { name: string; link: string }): string {
  const n = firstName(v.name);
  return text
    .replace(/\s*\{(nombre|name)\}/gi, n ? ` ${n}` : "")
    .replace(/^\s+/, "")
    .replace(/\{(link|enlace)\}/gi, v.link);
}

/** ¿El texto trae el link (o la marca {link})? Sin link el mensaje no sirve. */
export const hasLink = (text: string, link: string) => /\{(link|enlace)\}/i.test(text) || (!!link && text.includes(link));

// Google prohíbe ofrecer algo a cambio de reseñas y pedir solo reseñas buenas (o una calificación en particular).
const INCENTIVE: [RegExp, string][] = [
  [/descuento|discount|% ?off\b/i, "descuento / discount"],
  [/regal|gift|obsequi/i, "regalo / gift"],
  [/cup[oó]n|coupon|voucher/i, "cupón / coupon"],
  [/sorteo|rifa|raffle|giveaway|concurso|contest/i, "sorteo / giveaway"],
  [/premio|prize|reward|recompensa|incentiv/i, "premio / reward"],
  [/reembolso|cash ?back|te pagamos|we(?:'ll)? pay|a cambio|in exchange/i, "a cambio / in exchange"],
  [/\b(5|cinco|five)\s*(estrellas|stars?)\b/i, "5 estrellas / 5 stars"],
  [/solo si (quedaste|est[aá]s) (contento|satisfecho|feliz)|only if you (were|are) (happy|satisfied)/i, "solo si quedaste contento / only if happy"],
];

/** Palabras que Google no permite al pedir reseñas (descuentos, regalos, sorteos, pedir 5 estrellas…). */
export function incentiveIssues(text: string): string[] {
  return INCENTIVE.filter(([re]) => re.test(text)).map(([, label]) => label);
}

export type ReqContact = { id: string; name: string; email: string; phone: string; emailOptIn: boolean; smsOptIn: boolean };

/** ¿Se le puede mandar por este canal? (con permiso y con email o teléfono). */
export function reachable(c: ReqContact, channel: ReqChannel): boolean {
  return channel === "email" ? c.emailOptIn && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim()) : c.smsOptIn && c.phone.replace(/\D/g, "").length >= 7;
}

/**
 * Quiénes reciben el pedido: los elegidos que dieron permiso por ese canal y a los que no se les pidió en los últimos
 * REVIEW_COOLDOWN_DAYS días, hasta lo que queda del día.
 */
export function pickRecipients(
  contacts: ReqContact[],
  chosenIds: string[],
  channel: ReqChannel,
  recentlyAsked: Set<string>,
  remaining: number,
): { send: ReqContact[]; noConsent: number; recent: number; overLimit: number } {
  const chosen = new Set(chosenIds);
  const send: ReqContact[] = [];
  let noConsent = 0;
  let recent = 0;
  let overLimit = 0;
  for (const c of contacts) {
    if (!chosen.has(c.id)) continue;
    if (!reachable(c, channel)) noConsent++;
    else if (recentlyAsked.has(c.id)) recent++;
    else if (send.length >= Math.max(0, remaining)) overLimit++;
    else send.push(c);
  }
  return { send, noConsent, recent, overLimit };
}

/** Lo que se guarda de cada envío (AiAction.detail con kind review.request). */
export type RequestLogDetail = { channel: ReqChannel; sent: number; failed: number; contactIds: string[]; lang: ReqLang };

export function readRequestLog(v: unknown): RequestLogDetail | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const ids = Array.isArray(o.contactIds) ? o.contactIds.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.round(x)) : 0);
  return { channel: o.channel === "sms" ? "sms" : "email", sent: n(o.sent), failed: n(o.failed), contactIds: ids, lang: o.lang === "en" ? "en" : "es" };
}

/** Personas a las que se les pidió hoy (para el límite diario), de los registros de las últimas 24 horas. */
export function sentInLogs(logs: { kind: string; detail: unknown }[]): number {
  return logs.filter((l) => l.kind === REVIEW_REQUEST_KIND).reduce((sum, l) => sum + (readRequestLog(l.detail)?.sent ?? 0), 0);
}
