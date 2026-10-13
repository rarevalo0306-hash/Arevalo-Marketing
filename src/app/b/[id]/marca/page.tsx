import { brandFromAi, brandFromBook, deleteTemplate, getBrandBookUploadUrl, getUploadUrl, proposeTemplates, updateBrandKit } from "@/app/actions";
import { saveBrandBook } from "@/app/actions-brand-book";
import { saveVoicePrefs } from "@/app/actions-brand-identity";
import { detectMainLogoType, saveBrandLogo, saveLogoSlot, saveMainLogoType, uploadSvgLogo } from "@/app/actions-brand";
import { BrandKitForm } from "@/components/BrandKitForm";
import { BookAssetsSection } from "@/components/brand/BookAssetsSection";
import { IdentitySection } from "@/components/brand/IdentitySection";
import { BrandKitSection } from "@/components/brand/BrandKitSection";
import { DesignAiSection } from "@/components/brand/DesignAiSection";
import { saveCustomTemplate } from "@/app/actions-media";
import { PlacementsPanel, type PlacementGroup } from "@/components/brand/PlacementsPanel";
import { PageHead } from "@/components/PageHead";
import { SizesInfo } from "@/components/SizesInfo";
import { TemplateUpload } from "@/components/TemplateUpload";
import { TemplatesAuto } from "@/components/TemplatesAuto";
import { aiEnabled } from "@/lib/ai";
import { pageBusiness } from "@/lib/auth";
import { readBrandAssets } from "@/lib/brand-assets";
import { readBrandIdentity } from "@/lib/brand-identity-shape";
import { db } from "@/lib/db";
import { BUILTIN_TEMPLATES, builtinTemplateName, LAYOUTS } from "@/lib/design-shapes";
import type { UiLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { logoTypeEnabled } from "@/lib/logo-type";
import { usesSupabaseStorage } from "@/lib/media";
import { EVIDENCE_LABEL, PLAN_LABEL, placementGroups, placementPlan, previewSize, sizeText } from "@/lib/placements";
import s from "./marca.module.css";

// La IA puede tardar en diseñar las plantillas.
export const maxDuration = 120;

const LAYOUT_LABEL: Record<UiLang, Record<(typeof LAYOUTS)[number], string>> = {
  es: {
    "foto-completa": "Foto completa",
    "franja-arriba": "Franja arriba",
    "franja-abajo": "Franja abajo",
    "mitad-izquierda": "Mitad y mitad",
    "color-solido": "Color, sin foto",
    lista: "Lista de pasos",
  },
  en: {
    "foto-completa": "Full photo",
    "franja-arriba": "Band on top",
    "franja-abajo": "Band at bottom",
    "mitad-izquierda": "Half and half",
    "color-solido": "Color, no photo",
    lista: "Step list",
  },
};

export default async function MarcaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await pageBusiness(id);
  const { lang, t } = await getT();
  const b = await db.business.findUniqueOrThrow({ where: { id }, include: { templates: { orderBy: { createdAt: "asc" } } } });
  const own = b.templates.map((x) => ({ key: x.id, name: x.name, layout: (x.spec as { layout?: (typeof LAYOUTS)[number] }).layout, own: true, master: (x.spec as { custom?: { source?: string } }).custom?.source ?? "" }));
  const shown = own.length ? own : BUILTIN_TEMPLATES.map((x, i) => ({ key: `builtin-${i}`, name: builtinTemplateName(x.name, lang), layout: x.layout, own: false, master: "" }));
  const assets = readBrandAssets(b.brandAssets);
  // Al usar una propuesta de identidad cambian colores y letras en el servidor: el formulario se vuelve a pintar con ellos.
  const identity = readBrandIdentity(b.brandIdentity);
  const appliedAt = identity.appliedAt;
  const v = b.createdAt.getTime().toString(36) + (b.templates.at(-1)?.createdAt.getTime().toString(36) ?? "");
  // Los formatos de cada red (src/data/formatos.json), ya listos para la pantalla (sin mandar el catálogo entero).
  const placements: PlacementGroup[] = placementGroups().map((g) => ({
    platform: g.platform,
    label: g.label,
    items: g.items.map((p) => {
      const plan = placementPlan(p);
      return { id: p.id, label: p.label, size: sizeText(p), ...previewSize(p, 360), plan, planLabel: PLAN_LABEL[plan], evidence: EVIDENCE_LABEL[p.evidence.status], experimental: Boolean(p.experimental) };
    }),
  }));
  return (
    <>
      <PageHead
        business={b}
        prefix={t("Marca de", "Brand for")}
        title={t("Identidad de la marca", "Brand identity")}
        subtitle={t("Logos, colores, letras, voz y plantillas. Todo lo que diseña y escribe la IA para este negocio sale con esta identidad.", "Logos, colors, fonts, voice, and templates. Everything the AI designs and writes for this business uses this identity.")}
      />
      <BrandKitForm
        key={appliedAt || "kit"}
        kit={{ name: b.name, logoUrl: b.logoUrl, logoLightUrl: b.logoLightUrl, color: b.color, color2: b.color2, color3: b.color3, fontHeading: b.fontHeading, fontBody: b.fontBody, brandVoice: b.brandVoice, hashtags: b.hashtags, phone: b.phone, brandImages: b.brandImages, website: b.website }}
        save={updateBrandKit.bind(null, id)}
        saveLogo={saveBrandLogo.bind(null, id)}
        upload={usesSupabaseStorage() ? getUploadUrl.bind(null, id) : null}
        brandBook={{
          url: b.brandBookUrl,
          name: assets.bookName ?? "",
          upload: usesSupabaseStorage() ? getBrandBookUploadUrl.bind(null, id) : null,
          save: saveBrandBook.bind(null, id),
          read: brandFromBook.bind(null, id),
          suggest: aiEnabled() ? brandFromAi.bind(null, id) : null,
          canRead: Boolean(process.env.GEMINI_API_KEY),
          voice: aiEnabled() ? { address: identity.address, tones: identity.tones, save: saveVoicePrefs.bind(null, id) } : undefined,
        }}
        hasKit={assets.items.some((a) => a.kind === "kit")}
        logos={assets.logos}
        saveSlot={saveLogoSlot.bind(null, id)}
        saveMainType={saveMainLogoType.bind(null, id)}
        detectLogoType={logoTypeEnabled() ? detectMainLogoType.bind(null, id) : undefined}
        uploadSvg={uploadSvgLogo.bind(null, id)}
      >
        <BookAssetsSection businessId={id} />
      </BrandKitForm>

      <IdentitySection businessId={id} />

      <BrandKitSection businessId={id} />

      <section className="card" id="plantillas">
        <div className="row between">
          <div className="stack" style={{ gap: 4 }}>
            <h2>{t("4. Plantillas de diseño", "4. Design templates")}</h2>
            <p className="small muted">
              {own.length
                ? t("Tus plantillas, propuestas por la IA con tu marca (se renuevan solas cuando cambias colores, letras o logo). La IA elige la mejor para cada post, o la eliges tú.", "Your templates, suggested by the AI with your brand (they renew themselves when you change colors, fonts or logo). The AI picks the best one for each post, or you pick it.")
                : t("Estas son las plantillas de fábrica. Cuando guardes tu marca, la IA te propone las tuyas con ella.", "These are the built-in templates. When you save your brand, the AI suggests your own with it.")}
            </p>
          </div>
          {aiEnabled() && <TemplatesAuto businessId={id} propose={proposeTemplates.bind(null, id)} has={own.length > 0} />}
        </div>
        <DesignAiSection businessId={id} />
        <TemplateUpload save={saveCustomTemplate.bind(null, id)} upload={usesSupabaseStorage() ? getUploadUrl.bind(null, id) : null} color={b.color} />
        <SizesInfo />
        <div className={`tpl-grid ${s.tplGrid}`}>
          {shown.map((x) => (
            <figure key={x.key} className="tpl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/plantilla?b=${id}&t=${x.key}&v=${v}-${b.color}${b.fontHeading}`} alt={t(`Plantilla ${x.name}`, `${x.name} template`)} loading="lazy" />
              <figcaption>
                <span className="stack" style={{ gap: 0 }}>
                  <strong>{x.name}</strong>
                  <span className="small muted">{x.master === "ai-master" ? t("Diseño maestro con IA · se usa primero", "AI master design · used first") : x.master === "book" ? t("De tu manual · se usa primero", "From your brand book · used first") : x.layout ? LAYOUT_LABEL[lang][x.layout] : ""}{x.own ? "" : t(" · de fábrica", " · built-in")}</span>
                </span>
                {x.own && (
                  <form action={deleteTemplate.bind(null, id, x.key)}>
                    <button type="submit" className="btn link" style={{ color: "var(--err-text)" }}>{t("Borrar", "Delete")}</button>
                  </form>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="card" id="plantillas-redes" aria-labelledby="plantillas-redes-title">
        <div className="stack" style={{ gap: 4 }}>
          <h2 id="plantillas-redes-title">{t("5. Tus plantillas en cada red", "5. Your templates on every network")}</h2>
          <p className="small muted">
            {t(
              "Cada formato de cada red con tu plantilla, en su medida: el diseño se reacomoda (no se estira). Se hace una sola vez porque tu marca es la misma en todos lados. Las medidas vienen de tu catálogo de formatos; los que todavía no se hacen con plantillas lo dicen.",
              "Every format of every network with your template, at its size: the design is rearranged (not stretched). It's done once because your brand is the same everywhere. Sizes come from your format catalog; the ones not made with templates yet say so.",
            )}
          </p>
        </div>
        <PlacementsPanel businessId={id} templates={shown.map((x) => ({ key: x.key, name: x.name }))} groups={placements} version={`${v}-${b.color}${b.fontHeading}`} />
      </section>
    </>
  );
}
