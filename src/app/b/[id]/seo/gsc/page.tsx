import Link from "next/link";
import { cookies } from "next/headers";
import { chooseGscSite } from "@/app/actions-seo-gsc";
import { PageHead } from "@/components/PageHead";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { GSC_COOKIE, siteLabel, type GscPending } from "@/lib/seo/gsc";

export default async function ElegirSitioSearchConsole({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getT();
  const b = await db.business.findUniqueOrThrow({ where: { id } });
  const raw = (await cookies()).get(GSC_COOKIE)?.value;
  let sites: string[] = [];
  try {
    const saved = raw ? decryptJson<GscPending>(raw) : null;
    if (saved?.businessId === id && Array.isArray(saved.sites)) sites = saved.sites;
  } catch {
    sites = [];
  }
  return (
    <>
      <PageHead
        business={b}
        prefix={t("SEO de", "SEO for")}
        title={t("¿Qué sitio de Search Console es de este negocio?", "Which Search Console site belongs to this business?")}
        subtitle={
          b.website.trim()
            ? t(
                `Ninguno de tus sitios en Search Console coincide con la página del negocio (${b.website}). Elige el que corresponde.`,
                `None of your Search Console sites matches the business website (${b.website}). Pick the right one.`,
              )
            : t("Tu cuenta de Google tiene varios sitios en Search Console. Elige el de este negocio.", "Your Google account has several sites in Search Console. Pick the one for this business.")
        }
      />
      {sites.length === 0 ? (
        <div className="card empty">
          {t("La conexión venció.", "The connection expired.")} <Link href={`/b/${id}/seo`}>{t("Vuelve a SEO", "Go back to SEO")}</Link>{" "}
          {t("y presiona otra vez \"Conectar Search Console\".", "and click \"Connect Search Console\" again.")}
        </div>
      ) : (
        <div className="cards">
          {sites.map((s) => (
            <form key={s} action={chooseGscSite.bind(null, id, s)} className="card" style={{ gap: 12 }}>
              <h2 style={{ fontSize: 18, overflowWrap: "anywhere" }}>{siteLabel(s, t)}</h2>
              <p className="small muted">
                {s.startsWith("sc-domain:")
                  ? t("Propiedad de dominio: incluye http, https, www y subdominios.", "Domain property: includes http, https, www and subdomains.")
                  : t("Propiedad de prefijo de URL: solo esta dirección exacta.", "URL-prefix property: only this exact address.")}
              </p>
              <div><button className="btn on" type="submit">{t("Usar este sitio", "Use this site")}</button></div>
            </form>
          ))}
        </div>
      )}
    </>
  );
}
