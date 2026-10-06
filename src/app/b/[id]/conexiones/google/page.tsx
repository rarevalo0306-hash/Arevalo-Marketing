import Link from "next/link";
import { cookies } from "next/headers";
import { chooseGoogleLocation } from "@/app/actions";
import { PageHead } from "@/components/PageHead";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { GOOGLE_COOKIE, type GoogleLocation } from "@/lib/google-oauth";

export default async function ElegirUbicacionGoogle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getT();
  const b = await db.business.findUniqueOrThrow({ where: { id } });
  const raw = (await cookies()).get(GOOGLE_COOKIE)?.value;
  let locations: GoogleLocation[] = [];
  try {
    const saved = raw ? decryptJson<{ businessId: string; locations: GoogleLocation[] }>(raw) : null;
    if (saved?.businessId === id) locations = saved.locations;
  } catch {
    locations = [];
  }
  return (
    <>
      <PageHead business={b} prefix={t("Cuentas de", "Accounts for")}
        title={t("¿Qué perfil de Google es de este negocio?", "Which Google profile belongs to this business?")}
        subtitle={t("Tu cuenta de Google administra varios perfiles. Elige el que corresponde a este negocio.", "Your Google account manages several profiles. Pick the one for this business.")}
      />
      {locations.length === 0 ? (
        <div className="card empty">
          {t("La conexión venció.", "The connection expired.")} <Link href={`/b/${id}/conexiones`}>{t("Vuelve a Conexiones", "Go back to Connections")}</Link>{" "}
          {t("y presiona otra vez \"Conectar con Google\".", "and click \"Connect with Google\" again.")}
        </div>
      ) : (
        <div className="cards">
          {locations.map((l) => (
            <form key={l.locationId} action={chooseGoogleLocation.bind(null, id, l.locationId)} className="card" style={{ gap: 12 }}>
              <h2 style={{ fontSize: 18 }}>{l.title}</h2>
              {l.address && <p className="small muted">{l.address}</p>}
              <div><button className="btn on" type="submit">{t("Usar este perfil", "Use this profile")}</button></div>
            </form>
          ))}
        </div>
      )}
    </>
  );
}
