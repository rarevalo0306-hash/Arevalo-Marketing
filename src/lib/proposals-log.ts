// «Lo que hizo la IA» (/b/<id>/registro): filtros del registro AiAction, a qué grupo pertenece cada tipo,
// días en la zona del negocio y el CSV. Sin base de datos (solo arma el filtro de Prisma).

import type { Prisma } from "@prisma/client";
import type { UiLang } from "@/lib/i18n";

export type Bi = { es: string; en: string };

export const LOG_TYPES = ["publicaciones", "anuncios", "disenos", "fotos", "propuestas", "alertas"] as const;
export type LogType = (typeof LOG_TYPES)[number];

/** Prefijos de AiAction.kind de cada grupo. */
export const TYPE_PREFIXES: Record<LogType, string[]> = {
  publicaciones: ["post.", "video."],
  anuncios: ["ad."],
  disenos: ["design.", "template."],
  fotos: ["media.", "photo.", "enhance.", "image."],
  propuestas: ["proposal."],
  alertas: ["alert.", "limit.", "campaign."],
};

export const TYPE_LABEL: Record<LogType, Bi> = {
  publicaciones: { es: "Publicaciones", en: "Posts" },
  anuncios: { es: "Anuncios", en: "Ads" },
  disenos: { es: "Diseños", en: "Designs" },
  fotos: { es: "Fotos", en: "Photos" },
  propuestas: { es: "Propuestas", en: "Proposals" },
  alertas: { es: "Alertas y límites", en: "Alerts and limits" },
};

export const WHO = ["todo", "sola", "aprobadas", "tu"] as const;
export type Who = (typeof WHO)[number];
export const WHO_ACTOR: Record<Exclude<Who, "todo">, string> = { sola: "auto", aprobadas: "approved", tu: "owner" };

export const ACTOR_LABEL: Record<string, Bi> = {
  auto: { es: "La IA sola", en: "AI on its own" },
  approved: { es: "Aprobado por ti", en: "Approved by you" },
  owner: { es: "Lo hiciste tú", en: "You did it" },
};

export function typeOfKind(kind: string): LogType | null {
  for (const t of LOG_TYPES) if (TYPE_PREFIXES[t].some((p) => kind.startsWith(p))) return t;
  return null;
}

export type LogFilters = { from: string; to: string; campaign: string; type: LogType | ""; who: Who };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Lee los filtros de la dirección (?desde=&hasta=&campana=&tipo=&quien=). Por defecto, los últimos 30 días. */
export function readFilters(q: Record<string, string | string[] | undefined>, today: string, addDays: (day: string, n: number) => string): LogFilters {
  let from = first(q.desde);
  let to = first(q.hasta);
  if (!DAY_RE.test(to)) to = today;
  if (!DAY_RE.test(from)) from = addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  // Como mucho un año de una vez.
  if (from < addDays(to, -366)) from = addDays(to, -366);
  const type = first(q.tipo);
  const who = first(q.quien);
  return {
    from,
    to,
    campaign: first(q.campana).slice(0, 40),
    type: (LOG_TYPES as readonly string[]).includes(type) ? (type as LogType) : "",
    who: (WHO as readonly string[]).includes(who) ? (who as Who) : "todo",
  };
}

/** La dirección con los filtros (para enlaces y el CSV). */
export function filterQuery(f: LogFilters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  p.set("desde", f.from);
  p.set("hasta", f.to);
  if (f.campaign) p.set("campana", f.campaign);
  if (f.type) p.set("tipo", f.type);
  if (f.who !== "todo") p.set("quien", f.who);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

/** El filtro de Prisma. `range` = inicio y fin (UTC) de los días elegidos en la zona del negocio. */
export function logWhere(businessId: string, f: LogFilters, range: { gte: Date; lt: Date }): Prisma.AiActionWhereInput {
  return {
    businessId,
    createdAt: range,
    ...(f.campaign ? { campaignId: f.campaign } : {}),
    ...(f.type ? { OR: TYPE_PREFIXES[f.type].map((p) => ({ kind: { startsWith: p } })) } : {}),
    ...(f.who !== "todo" ? { actor: WHO_ACTOR[f.who] } : {}),
  };
}

export type LogRow = {
  createdAt: Date;
  kind: string;
  actor: string;
  costCents: number;
  summary: unknown;
  campaignName: string;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export function summaryText(v: unknown, lang: UiLang): string {
  const o = obj(v);
  const es = typeof o.es === "string" ? o.es : "";
  const en = typeof o.en === "string" ? o.en : "";
  return (lang === "en" ? en || es : es || en) || "—";
}

const csvCell = (v: string) => (/[",\n\r;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV del registro (con BOM para que Excel lea los acentos). `when` da fecha y hora en la zona del negocio. */
export function logCsv(rows: LogRow[], lang: UiLang, when: (d: Date) => { day: string; time: string }): string {
  const t = (es: string, en: string) => (lang === "en" ? en : es);
  const head = [t("Fecha", "Date"), t("Hora", "Time"), t("Tipo", "Type"), t("Quién", "Who"), t("Campaña", "Campaign"), t("Qué hizo", "What it did"), t("Costo (US$)", "Cost (US$)")];
  const lines = rows.map((r) => {
    const w = when(r.createdAt);
    const type = typeOfKind(r.kind);
    return [
      w.day,
      w.time,
      type ? TYPE_LABEL[type][lang] : r.kind,
      (ACTOR_LABEL[r.actor] ?? ACTOR_LABEL.auto)[lang],
      r.campaignName,
      summaryText(r.summary, lang),
      (Math.max(0, r.costCents) / 100).toFixed(2),
    ]
      .map((c) => csvCell(String(c)))
      .join(",");
  });
  return `﻿${[head.map(csvCell).join(","), ...lines].join("\r\n")}\r\n`;
}
