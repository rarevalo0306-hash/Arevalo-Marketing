import { aiDesign, aiImage, aiVideoCheck, aiVideoStart, aiWrite, createPost, getUploadUrl } from "@/app/actions";
import { Composer } from "@/components/Composer";
import { PageHead } from "@/components/PageHead";
import type { ChannelId } from "@/lib/channels";
import { aiEnabled } from "@/lib/ai";
import { db } from "@/lib/db";
import { BUILTIN_TEMPLATES, needsPhoto, TemplateSpec } from "@/lib/design-shapes";
import { falEnabled } from "@/lib/fal";
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
  const b = await db.business.findUniqueOrThrow({ where: { id }, include: { connections: { select: { channel: true } }, templates: { orderBy: { createdAt: "asc" } } } });
  const specs = b.templates.map((t) => TemplateSpec.safeParse(t.spec)).filter((r) => r.success).map((r) => r.data!);
  const templates = (specs.length ? specs : BUILTIN_TEMPLATES).map((t) => ({ name: t.name, list: t.layout === "lista", photo: needsPhoto(t) }));
  const [email, sms] = await Promise.all([
    db.contact.count({ where: { businessId: id, emailOptIn: true, NOT: { email: "" } } }),
    db.contact.count({ where: { businessId: id, smsOptIn: true, NOT: { phone: "" } } }),
  ]);
  return (
    <>
      <PageHead
        business={b}
        prefix="Publicando como"
        title="Nueva publicación"
        subtitle="Escríbelo una vez. Lo adaptamos y lo enviamos a cada canal que elijas."
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
