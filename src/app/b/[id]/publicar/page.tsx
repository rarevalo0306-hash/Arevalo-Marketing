import { aiDesign, aiImage, aiVideoCheck, aiVideoStart, aiWrite, createPost, getUploadUrl } from "@/app/actions";
import { moreIdeas } from "@/app/actions-ideas";
import { libraryForPicker, libraryMedia, libraryPhotoFor } from "@/app/actions-library";
import { Composer } from "@/components/Composer";
import { PageHead } from "@/components/PageHead";
import { aiEnabled } from "@/lib/ai";
import { isBilingual } from "@/lib/bilingual";
import { CHANNEL_IDS, type ChannelId } from "@/lib/channels";
import { loadContentIdeas } from "@/lib/content-ideas";
import { db } from "@/lib/db";
import { BUILTIN_TEMPLATES, builtinTemplateName, needsPhoto, TemplateSpec } from "@/lib/design-shapes";
import { videoEnabled } from "@/lib/fal";
import { getT } from "@/lib/i18n-server";
import { imagesEnabled } from "@/lib/imagegen";
import { readDescription } from "@/lib/library-shape";
import { usesSupabaseStorage } from "@/lib/media";

// Publicar en varios canales (y esperar a que Instagram procese un video) puede tardar.
export const maxDuration = 300;

export default async function PublicarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ idea?: string; magic?: string; foto?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const { lang, t } = await getT();
  const b = await db.business.findUniqueOrThrow({ where: { id }, include: { connections: { where: { channel: { in: CHANNEL_IDS } }, select: { channel: true } }, templates: { orderBy: { createdAt: "asc" } } } });
  const specs = b.templates.map((t) => TemplateSpec.safeParse(t.spec)).filter((r) => r.success).map((r) => r.data!);
  // Las plantillas de fábrica se muestran en el idioma de la app; el compositor las manda por número, no por nombre.
  const templates = specs.length
    ? specs.map((x) => ({ name: x.name, list: x.layout === "lista", photo: needsPhoto(x) }))
    : BUILTIN_TEMPLATES.map((x) => ({ name: builtinTemplateName(x.name, lang), list: x.layout === "lista", photo: needsPhoto(x) }));
  const ai = aiEnabled();
  // «Crear publicación con esta foto» desde «Tus fotos»: la foto ya puesta y, como idea, lo que muestra.
  let initialMedia: { url: string; type: "photo" | "video" } | { error: string } | null = null;
  let photoIdea = "";
  const foto = q.foto ? await db.libraryItem.findFirst({ where: { id: q.foto, businessId: id }, select: { id: true, description: true } }) : null;
  if (foto) {
    const r = await libraryMedia(id, foto.id);
    initialMedia = r.ok ? { url: r.url, type: r.type } : { error: r.error };
    photoIdea = readDescription(foto.description)?.[lang] ?? "";
  }
  const [email, sms, ideas] = await Promise.all([
    db.contact.count({ where: { businessId: id, emailOptIn: true, NOT: { email: "" } } }),
    db.contact.count({ where: { businessId: id, smsOptIn: true, NOT: { phone: "" } } }),
    // Ideas de hoy según el SEO guardado (solo la base de datos).
    ai ? loadContentIdeas(id, lang) : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHead
        business={b}
        prefix={t("Publicando como", "Publishing as")}
        title={t("Nueva publicación", "New post")}
        subtitle={t("Elige una idea, revisa y publica. La IA lo adapta a cada canal que elijas.", "Pick an idea, review it and publish. AI adapts it to each channel you choose.")}
      />
      <Composer
        key={id}
        businessId={id}
        businessName={b.name}
        color={b.color}
        connected={b.connections.map((c) => c.channel as ChannelId)}
        contactCounts={{ email, sms }}
        action={createPost.bind(null, id)}
        upload={usesSupabaseStorage() ? getUploadUrl.bind(null, id) : null}
        aiWrite={ai ? aiWrite.bind(null, id) : null}
        ideas={ideas?.ideas ?? []}
        ideasBasis={ideas?.basis ?? "season"}
        moreIdeas={ai ? moreIdeas.bind(null, id) : null}
        bilingual={isBilingual(b.aiProfile, b.brandVoice)}
        initialIdea={(q.idea ?? photoIdea).slice(0, 2000)}
        autoMagic={q.magic === "1"}
        initialMedia={initialMedia}
        library={{ list: libraryForPicker.bind(null, id), media: libraryMedia.bind(null, id), photoFor: libraryPhotoFor.bind(null, id), manageHref: `/b/${id}/fotos` }}
        aiMedia={imagesEnabled() ? { image: aiImage.bind(null, id), video: videoEnabled(), videoStart: aiVideoStart.bind(null, id), videoCheck: aiVideoCheck.bind(null, id), design: aiDesign.bind(null, id), autoBrand: b.brandImages, templates } : null}
      />
    </>
  );
}
