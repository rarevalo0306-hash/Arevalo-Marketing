import Link from "next/link";
import { cookies } from "next/headers";
import { chooseMetaPage } from "@/app/actions";
import { PageHead } from "@/components/PageHead";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { listPages, META_COOKIE } from "@/lib/meta-oauth";

export default async function ElegirPaginaMeta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getT();
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
      <PageHead business={b} prefix={t("Cuentas de", "Accounts for")}
        title={t("¿Qué página es de este negocio?", "Which Page belongs to this business?")}
        subtitle={t("Tu Facebook administra varias páginas. Elige la que corresponde a este negocio.", "Your Facebook manages several Pages. Pick the one for this business.")}
      />
      {pages.length === 0 ? (
        <div className="card empty">
          {t("La conexión venció.", "The connection expired.")} <Link href={`/b/${id}/conexiones`}>{t("Vuelve a Conexiones", "Go back to Connections")}</Link>{" "}
          {t("y presiona otra vez \"Conectar con Facebook\".", "and click \"Connect with Facebook\" again.")}
        </div>
      ) : (
        <div className="cards">
          {pages.map((p) => (
            <form key={p.id} action={chooseMetaPage.bind(null, id, p.id)} className="card" style={{ gap: 12 }}>
              <h2 style={{ fontSize: 18 }}>{p.name}</h2>
              <p className="small muted">
                {p.instagram_business_account ? `${t("Instagram vinculado", "Linked Instagram")}: @${p.instagram_business_account.username ?? p.instagram_business_account.id}` : t("Sin cuenta de Instagram vinculada", "No linked Instagram account")}
              </p>
              <div><button className="btn on" type="submit">{t("Usar esta página", "Use this Page")}</button></div>
            </form>
          ))}
        </div>
      )}
    </>
  );
}
