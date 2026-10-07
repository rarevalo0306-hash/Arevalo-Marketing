import { saveSchemaExtras } from "@/app/actions-seo-schema";
import { HowToRead } from "@/components/seo/HowToRead";
import { SchemaTools, type FixLinks } from "@/components/seo/SchemaTools";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { readAuditReport } from "@/lib/seo/audit";
import { readZones } from "@/lib/seo/dataforseo";
import { mapsUrl, readGbpReport } from "@/lib/seo/gbp";
import { readMapPlace } from "@/lib/seo/maprank";
import { latestReports } from "@/lib/seo/reports";
import { readDfsTimetable, readSchemaExtras, readWeekHours, SCHEMA_KIND, type SchemaInput, schemaStatus, type WeekHours } from "@/lib/seo/schema";
import { readStudy } from "@/lib/study-shape";
import { BUSINESS_TZ } from "@/lib/time";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const same = (a: string, b: string) => a.normalize("NFD").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase() === b.normalize("NFD").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();

/** Facebook e Instagram conectados → sus direcciones públicas (para "sameAs"). */
async function socialLinks(businessId: string): Promise<string[]> {
  const rows = await db.connection.findMany({ where: { businessId, channel: { in: ["facebook", "instagram"] } }, select: { channel: true, label: true, secret: true } });
  const out: string[] = [];
  for (const r of rows) {
    if (r.channel === "instagram") {
      // Conectado con "Conectar con Facebook" el nombre visible es "@usuario"; a mano es el ID (no sirve como enlace).
      const m = r.label.trim().match(/^@([A-Za-z0-9._]{1,30})$/);
      if (m) out.push(`https://www.instagram.com/${m[1]}/`);
    } else {
      let pageId = /^\d{5,}$/.test(r.label.trim()) ? r.label.trim() : "";
      if (!pageId)
        try {
          pageId = String(decryptJson(r.secret).pageId ?? "").trim();
        } catch {
          pageId = "";
        }
      if (/^\d{5,}$/.test(pageId)) out.push(`https://www.facebook.com/${pageId}`);
    }
  }
  return out;
}

/** "Código para que Google entienda tu negocio": el JSON-LD de LocalBusiness para pegar en la página. Gratis. */
export async function SchemaPanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, website: true, phone: true, logoUrl: true, seoLocations: true, seoLocationCode: true, seoLocationName: true, seoLanguage: true, study: true, seoMapPlace: true },
  });
  if (!b) return null;

  const [[gbpRow], [auditRow], [extrasRow], social] = await Promise.all([
    latestReports(businessId, "gbp", 1),
    latestReports(businessId, "audit", 1),
    db.seoReport.findMany({ where: { businessId, kind: SCHEMA_KIND }, orderBy: { createdAt: "desc" }, take: 1 }),
    socialLinks(businessId),
  ]);
  const gbp = gbpRow ? readGbpReport(gbpRow.data) : null;
  const profile = gbp?.profile ?? null;
  const place = readMapPlace(b.seoMapPlace);
  const audit = auditRow ? readAuditReport(auditRow.data) : null;
  const extras = extrasRow ? readSchemaExtras(extrasRow.data) : null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const study = readStudy(b.study);

  // Horario: el que guardó el dueño aquí; si no, el del Perfil de Google si el reporte lo trae (hoy solo guarda
  // cuántos días tiene horario, no las horas).
  const rawProfile = obj(obj(gbpRow?.data).profile);
  const gbpHours: WeekHours | null = readWeekHours(rawProfile.hours) ?? readDfsTimetable(rawProfile.timetable ?? rawProfile.hours);
  const hours = extras?.hours ?? gbpHours;
  const country = zones.find((z) => (z.type ?? "").toLowerCase() === "country")?.name ?? zones[0]?.name.split(",").pop()?.trim() ?? "";

  const base: SchemaInput = {
    name: b.name,
    lang: b.seoLanguage === "en" ? "en" : "es",
    website: b.website || profile?.url || "",
    // El de Google primero: así el código dice lo mismo que el perfil (y suele traer el código de país).
    phone: profile?.phone || b.phone,
    address: profile?.address || place?.address || "",
    countryHint: country,
    lat: profile?.lat ?? place?.lat ?? null,
    lng: profile?.lng ?? place?.lng ?? null,
    category: profile?.category ?? "",
    additionalCategories: profile?.additionalCategories ?? [],
    description: profile?.description ?? "",
    sameAs: social,
    logo: b.logoUrl || profile?.logo || "",
    images: profile?.mainImage ? [profile.mainImage] : [],
    zones: zones.map((z) => ({ name: z.name, type: z.type })),
    services: study?.services ?? [],
    mapUrl: mapsUrl(profile?.cid || place?.cid || ""),
  };

  const status = schemaStatus(audit);
  const found = status.types.length ? ` (${status.types.join(", ")})` : "";
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeZone: BUSINESS_TZ });
  const pill = {
    present: { cls: "pill sent", text: t("Ya está en tu página", "Already on your website") },
    incomplete: { cls: "pill partial", text: t("Incompleto en tu página", "Incomplete on your website") },
    missing: { cls: "pill failed", text: t("Falta en tu página", "Missing from your website") },
    unknown: { cls: "pill", text: t("Sin revisar", "Not checked yet") },
  }[status.status];
  const statusText = {
    present: t(
      `Según la auditoría del ${auditRow ? fmt.format(auditRow.createdAt) : ""}, tu página de inicio ya tiene este código${found}. Compáralo con el de abajo: si al tuyo le falta el horario, la ubicación o los servicios, cámbialo por este.`,
      `According to the audit from ${auditRow ? fmt.format(auditRow.createdAt) : ""}, your home page already has this code${found}. Compare it with the one below: if yours is missing hours, location or services, replace it with this one.`,
    ),
    incomplete: t(
      "Tu página dice quién eres, pero no como negocio local en tu página de inicio (sin dirección ni horario para Google). Pega este código en tu página de inicio.",
      "Your website says who you are, but not as a local business on your home page (no address or hours for Google). Paste this code on your home page.",
    ),
    missing: t(
      "La última auditoría no encontró este código en tu página de inicio. Pégalo para que Google sepa con seguridad quién eres, dónde estás y a qué hora abres.",
      "The last audit didn't find this code on your home page. Paste it so Google knows for sure who you are, where you are and when you're open.",
    ),
    unknown: t(
      "Todavía no revisamos tu página. Corre la Auditoría de tu página (arriba, en esta misma pestaña) para saber si ya lo tiene.",
      "We haven't checked your website yet. Run the Website audit (above, in this same tab) to find out if it already has it.",
    ),
  }[status.status];

  const links: FixLinks = {
    settings: `/b/${businessId}/negocio`,
    brand: `/b/${businessId}/marca`,
    gbp: "#perfil",
    connections: `/b/${businessId}/conexiones`,
    study: `/b/${businessId}/estudio`,
    zones: "#dataforseo",
    here: "#schema-hours",
  };
  const nameTip =
    profile?.title && !same(profile.title, b.name)
      ? t(
          `En Google tu negocio se llama «${profile.title}» y aquí «${b.name}». Usa el mismo nombre en los dos lados (cámbialo en el código si hace falta).`,
          `On Google your business is called “${profile.title}” and here “${b.name}”. Use the same name in both places (change it in the code if needed).`,
        )
      : "";

  return (
    <section className="card" id="codigo-google">
      <div className="stack" style={{ gap: 4 }}>
        <div className="row between">
          <h2>{t("Código para que Google entienda tu negocio", "Code so Google understands your business")}</h2>
          <span className={pill.cls}>{pill.text}</span>
        </div>
        <p className="small muted">
          {t(
            "Una etiqueta invisible que le dice a Google quién eres, dónde estás y a qué hora abres. Tus clientes no la ven; Google sí, y la usa para entender tu negocio y mostrar bien tus datos. Es gratis: solo la copias y la pegas una vez en tu página.",
            "An invisible tag that tells Google who you are, where you are and when you're open. Your customers don't see it; Google does, and uses it to understand your business and show your details correctly. It's free: you just copy it and paste it on your website once.",
          )}
        </p>
      </div>
      <p className={status.status === "present" ? "note ok" : status.status === "unknown" ? "small muted" : "note"}>{statusText}</p>
      {nameTip && <p className="note">{nameTip}</p>}

      <SchemaTools
        base={base}
        initialHours={hours}
        initialPrice={extras?.priceRange ?? ""}
        hoursFrom={extras?.hours ? "saved" : gbpHours ? "google" : "none"}
        links={links}
        save={saveSchemaExtras.bind(null, businessId)}
      />

      <HowToRead title={t("Cómo leer esto", "How to read this")}>
        <ul>
          <li>{t("Es «datos estructurados» (schema.org): el idioma que Google usa para leer los datos de un negocio. No cambia cómo se ve tu página.", "It's “structured data” (schema.org): the language Google uses to read a business's details. It doesn't change how your website looks.")}</li>
          <li>{t("Solo lleva lo que ya sabemos de ti (tus ajustes, tu Perfil de Google, tu estudio y tus redes). Lo que no sabemos no se inventa: sale en «Lo que falta».", "It only has what we already know about you (your settings, Google Business Profile, study and social profiles). What we don't know isn't made up: it shows in “What's missing”.")}</li>
          <li>{t("Lo más importante: nombre y dirección (Google los exige), teléfono, horario y ubicación. Que coincidan con tu Perfil de Google.", "Most important: name and address (Google requires them), phone, hours and location. Make sure they match your Google Business Profile.")}</li>
          <li>{t("No ponemos tus estrellas ni reseñas: Google no las muestra cuando el mismo negocio las pone en su página, y podría tomarlo como trampa.", "We don't add your stars or reviews: Google doesn't show them when a business puts its own reviews on its website, and could treat it as spam.")}</li>
          <li>{t("Pegarlo no te sube de posición de un día para otro: ayuda a que Google te entienda mejor y no confunda tus datos.", "Pasting it won't move you up overnight: it helps Google understand you better and not mix up your details.")}</li>
        </ul>
      </HowToRead>
    </section>
  );
}
