import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { Source, type Context } from "./schema";
import { readSource, sourceUrl } from "./network";
export function plain(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:amp|lt|gt|quot|apos);/g,
      (x) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
        })[x] ?? x,
    )
    .replace(/\s+/g, " ")
    .trim();
}
export function canonicalUrl(raw: string) {
  const u = sourceUrl(raw);
  for (const k of [...u.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/.test(k)) u.searchParams.delete(k);
  return u.href;
}
export function parseFeed(xml: string, base: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Feed con declaraciones no admitidas.");
  const blocks = [
    ...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi),
  ].slice(0, 30);
  return blocks.flatMap(([, , block]) => {
    const tag = (name: string) =>
      plain(
        new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i").exec(
          block,
        )?.[1] ?? "",
      );
    const title = tag("title").slice(0, 250);
    const href =
      tag("link") ||
      /<link\b[^>]*href=["']([^"']+)["']/i.exec(block)?.[1] ||
      "";
    const date = tag("pubDate") || tag("published") || tag("updated");
    const publishedAt =
      date && Number.isFinite(Date.parse(date)) ? new Date(date) : null;
    try {
      return title && href
        ? [
            {
              title,
              url: canonicalUrl(new URL(href, base).href),
              publishedAt,
              summary: (tag("description") || tag("summary")).slice(0, 1500),
            },
          ]
        : [];
    } catch {
      return [];
    }
  });
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function collectNews(businessId: string, c: Context) {
  const w = await db.agentWorkspace.findUniqueOrThrow({
    where: { businessId },
  });
  const sources = Source.array().parse(w.sources);
  let detected = 0;
  const errors: string[] = [];
  if (!sources.length)
    return {
      text: "Añade fuentes RSS o Atom autorizadas en Conocimiento para activar el radar.",
      detected: 0,
      errors: [],
    };
  for (const source of sources) {
    try {
      const origin = sourceUrl(source.url).origin;
      const items = parseFeed(
        await readSource(source.url, [origin]),
        source.url,
      );
      if (!items.length) {
        errors.push(`${source.name}: no se encontraron entradas RSS/Atom.`);
        continue;
      }
      for (const item of items) {
        const age = item.publishedAt
          ? Date.now() - item.publishedAt.getTime()
          : Infinity;
        const validDate = age >= -3600000 && age <= 14 * 86400000;
        const matchingGeo =
          source.geography.trim().toLowerCase() ===
          c.industry.geography.trim().toLowerCase();
        const sameOrigin = new URL(item.url).origin === origin;
        const fingerprint = hash(item.title + "\n" + item.summary);
        const prior = await db.agentNews.findUnique({
          where: {
            businessId_canonicalUrl: { businessId, canonicalUrl: item.url },
          },
        });
        const changed = prior && prior.contentHash !== fingerprint;
        const status = changed
          ? "changed"
          : validDate && source.primary && matchingGeo && sameOrigin
            ? "source_ready"
            : validDate
              ? "detected"
              : "stale";
        const data = {
          title: item.title,
          source: source.name,
          publishedAt: item.publishedAt,
          summary: item.summary,
          contentHash: fingerprint,
          retrievedAt: new Date(),
          status,
          evidence: [
            {
              url: item.url,
              primary: source.primary && sameOrigin,
              geography: source.geography,
              checkedAt: new Date().toISOString(),
              kind: "feed",
              verification:
                "Fuente identificada; el contenido requiere contrastar el hecho y su vigencia.",
            },
          ],
        };
        // An unchanged feed is not a new verification of the article. Preserve the
        // review date/evidence; changed or aged facts invalidate derived content.
        await db.agentNews.upsert({
          where: {
            businessId_canonicalUrl: { businessId, canonicalUrl: item.url },
          },
          create: {
            businessId,
            canonicalUrl: item.url,
            eventKey: hash(
              item.title
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase()
                .replace(/[^\p{L}\p{N}]/gu, ""),
            ),
            ...data,
          },
          update:
            prior?.status === "verified" && !changed && validDate
              ? {}
              : {
                  ...data,
                  revision: {
                    increment: changed || prior?.status === "verified" ? 1 : 0,
                  },
                },
        });
        if (!prior) detected++;
      }
    } catch {
      errors.push(`${source.name}: no se pudo consultar la fuente.`);
    }
  }
  return {
    text: `Radar actualizado: ${detected} noticias nuevas. Las fuentes y fechas están en la sección Noticias.`,
    detected,
    errors,
  };
}
