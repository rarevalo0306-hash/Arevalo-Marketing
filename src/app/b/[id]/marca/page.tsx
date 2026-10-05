import { brandFromAi, brandFromBook, deleteTemplate, generateTemplates, getBrandBookUploadUrl, getUploadUrl, updateBrandKit } from "@/app/actions";
import { BrandKitForm } from "@/components/BrandKitForm";
import { PageHead } from "@/components/PageHead";
import { TemplatesButton } from "@/components/TemplatesButton";
import { aiEnabled } from "@/lib/ai";
import { db } from "@/lib/db";
import { BUILTIN_TEMPLATES, LAYOUTS } from "@/lib/design-shapes";
import { usesSupabaseStorage } from "@/lib/media";

// La IA puede tardar en diseñar las plantillas.
export const maxDuration = 120;

const LAYOUT_LABEL: Record<(typeof LAYOUTS)[number], string> = {
  "foto-completa": "Foto completa",
  "franja-arriba": "Franja arriba",
  "franja-abajo": "Franja abajo",
  "mitad-izquierda": "Mitad y mitad",
  "color-solido": "Color, sin foto",
  lista: "Lista de pasos",
};

export default async function MarcaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await db.business.findUniqueOrThrow({ where: { id }, include: { templates: { orderBy: { createdAt: "asc" } } } });
  const own = b.templates.map((t) => ({ key: t.id, name: t.name, layout: (t.spec as { layout?: (typeof LAYOUTS)[number] }).layout, own: true }));
  const shown = own.length ? own : BUILTIN_TEMPLATES.map((t, i) => ({ key: `builtin-${i}`, name: t.name, layout: t.layout, own: false }));
  const v = b.createdAt.getTime().toString(36) + (b.templates.at(-1)?.createdAt.getTime().toString(36) ?? "");
  return (
    <>
      <PageHead business={b} prefix="Marca de" title="Identidad de la marca" subtitle="Logos, colores, letras, voz y plantillas. Todo lo que diseña y escribe la IA para este negocio sale con esta identidad." />
      <BrandKitForm
        kit={{ name: b.name, logoUrl: b.logoUrl, logoLightUrl: b.logoLightUrl, color: b.color, color2: b.color2, color3: b.color3, fontHeading: b.fontHeading, fontBody: b.fontBody, brandVoice: b.brandVoice, hashtags: b.hashtags, phone: b.phone, brandImages: b.brandImages }}
        save={updateBrandKit.bind(null, id)}
        upload={usesSupabaseStorage() ? getUploadUrl.bind(null, id) : null}
        brandBook={{
          url: b.brandBookUrl,
          upload: usesSupabaseStorage() ? getBrandBookUploadUrl.bind(null, id) : null,
          read: brandFromBook.bind(null, id),
          suggest: aiEnabled() ? brandFromAi.bind(null, id) : null,
        }}
      />

      <section className="card">
        <div className="row between">
          <div className="stack" style={{ gap: 4 }}>
            <h2>Plantillas de diseño</h2>
            <p className="small muted">
              {own.length ? "Tus plantillas, diseñadas por la IA con tu marca. La IA elige la mejor para cada post, o la eliges tú." : "Estas son las plantillas de fábrica. Pídele a la IA que diseñe las tuyas con tu marca."}
            </p>
          </div>
          {aiEnabled() && <TemplatesButton action={generateTemplates.bind(null, id)} has={own.length > 0} />}
        </div>
        <div className="tpl-grid">
          {shown.map((t) => (
            <figure key={t.key} className="tpl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/plantilla?b=${id}&t=${t.key}&v=${v}-${b.color}${b.fontHeading}`} alt={`Plantilla ${t.name}`} loading="lazy" />
              <figcaption>
                <span className="stack" style={{ gap: 0 }}>
                  <strong>{t.name}</strong>
                  <span className="small muted">{t.layout ? LAYOUT_LABEL[t.layout] : ""}{t.own ? "" : " · de fábrica"}</span>
                </span>
                {t.own && (
                  <form action={deleteTemplate.bind(null, id, t.key)}>
                    <button type="submit" className="btn link" style={{ color: "var(--err-text)" }}>Borrar</button>
                  </form>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </>
  );
}
