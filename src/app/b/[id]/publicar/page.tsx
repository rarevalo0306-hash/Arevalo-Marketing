import { createPost } from "@/app/actions";
import { Composer } from "@/components/Composer";
import { PageHead } from "@/components/PageHead";
import type { ChannelId } from "@/lib/channels";
import { db } from "@/lib/db";

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
      />
    </>
  );
}
