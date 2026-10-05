import { aiWrite, createPost, getUploadUrl } from "@/app/actions";
import { Composer } from "@/components/Composer";
import { PageHead } from "@/components/PageHead";
import type { ChannelId } from "@/lib/channels";
import { aiEnabled } from "@/lib/ai";
import { db } from "@/lib/db";
import { usesSupabaseStorage } from "@/lib/media";

// Publicar en varios canales (y esperar a que Instagram procese un video) puede tardar.
export const maxDuration = 300;

export default async function PublicarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await db.business.findUniqueOrThrow({ where: { id }, include: { connections: { select: { channel: true } } } });
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
      />
    </>
  );
}
