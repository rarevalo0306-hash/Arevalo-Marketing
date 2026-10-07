// El contexto del negocio para las instrucciones a la IA de la página (prompt-core.ts): nombre, página, zona, lo que
// vende y, si el dueño conectó su sitio en «Sitio web / SEO» (Conexiones), el repositorio de GitHub. Solo lee la
// base de datos; lo que no se sabe queda vacío.
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { readZones, zoneLabel } from "@/lib/seo/dataforseo";
import type { PromptContext } from "@/lib/seo/prompt-core";
import { readStudy } from "@/lib/study-shape";

/** Recorta un texto largo en una frase completa (o en una palabra) cerca de `max` letras. */
export function clip(text: string, max = 400): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const dot = cut.lastIndexOf(". ");
  return dot > max * 0.5 ? cut.slice(0, dot + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

export async function loadPromptContext(businessId: string): Promise<PromptContext | null> {
  const [b, site] = await Promise.all([
    db.business.findUnique({
      where: { id: businessId },
      select: { name: true, website: true, aiProfile: true, study: true, seoLocations: true, seoLocationCode: true, seoLocationName: true },
    }),
    db.connection.findUnique({ where: { businessId_channel: { businessId, channel: "seo" } }, select: { secret: true } }).catch(() => null),
  ]);
  if (!b) return null;
  const study = readStudy(b.study);
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const places = study?.market.places.slice(0, 4) ?? [];
  const zoneNames = zones.map((z) => zoneLabel(z.name)).filter(Boolean);
  // Las ciudades del estudio y el país de la zona de Google ("Managua, Masaya… (Nicaragua)").
  const area = places.length
    ? `${places.join(", ")}${zoneNames.length && !places.some((p) => zoneNames.join(" ").includes(p)) ? ` (${zoneNames.join(", ")})` : ""}`
    : zoneNames.join(", ");
  let repo = "";
  let branch = "";
  if (site?.secret)
    try {
      const s = decryptJson<Record<string, unknown>>(site.secret);
      repo = typeof s.repo === "string" ? s.repo.trim() : "";
      branch = typeof s.branch === "string" ? s.branch.trim() : "";
    } catch {
      // Sin la clave para leerlo: se omite.
    }
  return {
    name: b.name,
    website: b.website.trim(),
    area,
    sells: (study?.services ?? []).slice(0, 6).map((s) => s.name.trim()).filter(Boolean),
    about: study?.services.length ? "" : clip(b.aiProfile, 400),
    repo,
    branch,
  };
}
