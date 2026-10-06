import { aiDesign, aiImage, aiVideoCheck, aiVideoStart, aiWrite, createPost, getUploadUrl } from "@/app/actions";
import { Composer } from "@/components/Composer";
import { PageHead } from "@/components/PageHead";
import type { ChannelId } from "@/lib/channels";
import { aiEnabled } from "@/lib/ai";
import { db } from "@/lib/db";
import { BUILTIN_TEMPLATES, builtinTemplateName, needsPhoto, TemplateSpec } from "@/lib/design-shapes";
import { falEnabled } from "@/lib/fal";
import { getT } from "@/lib/i18n-server";
import { imagesEnabled } from "@/lib/imagegen";
import { usesSupabaseStorage } from "@/lib/media";

// Publicar en varios canales (y esperar a que Instagram procese un video) puede tardar.
export const maxDuration = 300;

export default async function PublicarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ idea?: string; magic?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const { lang, t } = await getT();
  const b = await db.business.findUniqueOrThrow({ where: { id }, include: { connections: { select: { channel: true } }, templates: { orderBy: { createdAt: "asc" } } } });
  const specs = b.templates.map((t) => TemplateSpec.safeParse(t.spec)).filter((r) => r.success).map((r) => r.data!);
  // Las plantillas de fábrica se muestran en el idioma de la app; el compositor las manda por número, no por nombre.
  const templates = specs.length
    ? specs.map((x) => ({ name: x.name, list: x.layout === "lista", photo: needsPhoto(x) }))
    : BUILTIN_TEMPLATES.map((x) => ({ name: builtinTemplateName(x.name, lang), list: x.layout === "lista", photo: needsPhoto(x) }));
  const [email, sms] = await Promise.all([
    db.contact.count({ where: { businessId: id, emailOptIn: true, NOT: { email: "" } } }),
    db.contact.count({ where: { businessId: id, smsOptIn: true, NOT: { phone: "" } } }),
  ]);
  return (
    <>
      <PageHead
        business={b}
        prefix={t("Publicando como", "Publishing as")}
        title={t("Nueva publicación", "New post")}
        subtitle={t("Escríbelo una vez. Lo adaptamos y lo enviamos a cada canal que elijas.", "Write it once. We adapt it and send it to each channel you choose.")}
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
        aiWrite={aiEnabled() ? aiWrite.bind(null, id) : null}
        initialIdea={(q.idea ?? "").slice(0, 2000)}
        autoMagic={q.magic === "1"}
        aiMedia={imagesEnabled() ? { image: aiImage.bind(null, id), video: falEnabled(), videoStart: aiVideoStart.bind(null, id), videoCheck: aiVideoCheck.bind(null, id), design: aiDesign.bind(null, id), autoBrand: b.brandImages, templates } : null}
      />
    </>
  );
}
