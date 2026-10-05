import Link from "next/link";
import { cookies } from "next/headers";
import { chooseMetaPage } from "@/app/actions";
import { PageHead } from "@/components/PageHead";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { listPages, META_COOKIE } from "@/lib/meta-oauth";

export default async function ElegirPaginaMeta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await db.business.findUniqueOrThrow({ where: { id } });
  const raw = (await cookies()).get(META_COOKIE)?.value;
  let pages: Awaited<ReturnType<typeof listPages>> = [];
  try {
    const saved = raw ? decryptJson<{ userToken: string; businessId: string }>(raw) : null;
    if (saved?.businessId === id) pages = await listPages(saved.userToken);
  } catch {
    pages = [];
  }
  return (
    <>
      <PageHead business={b} prefix="Cuentas de" title="¿Qué página es de este negocio?" subtitle="Tu Facebook administra varias páginas. Elige la que corresponde a este negocio." />
      {pages.length === 0 ? (
        <div className="card empty">
          La conexión venció. <Link href={`/b/${id}/conexiones`}>Vuelve a Conexiones</Link> y presiona otra vez &quot;Conectar con Facebook&quot;.
        </div>
      ) : (
        <div className="cards">
          {pages.map((p) => (
            <form key={p.id} action={chooseMetaPage.bind(null, id, p.id)} className="card" style={{ gap: 12 }}>
              <h2 style={{ fontSize: 18 }}>{p.name}</h2>
              <p className="small muted">
                {p.instagram_business_account ? `Instagram vinculado: @${p.instagram_business_account.username ?? p.instagram_business_account.id}` : "Sin cuenta de Instagram vinculada"}
              </p>
              <div><button className="btn on" type="submit">Usar esta página</button></div>
            </form>
          ))}
        </div>
      )}
    </>
  );
}
