import Link from "next/link";
import { cookies } from "next/headers";
import { chooseGoogleLocation } from "@/app/actions";
import { PageHead } from "@/components/PageHead";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { GOOGLE_COOKIE, type GoogleLocation } from "@/lib/google-oauth";

export default async function ElegirUbicacionGoogle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
      <PageHead business={b} prefix="Cuentas de" title="¿Qué perfil de Google es de este negocio?" subtitle="Tu cuenta de Google administra varios perfiles. Elige el que corresponde a este negocio." />
      {locations.length === 0 ? (
        <div className="card empty">
          La conexión venció. <Link href={`/b/${id}/conexiones`}>Vuelve a Conexiones</Link> y presiona otra vez &quot;Conectar con Google&quot;.
        </div>
      ) : (
        <div className="cards">
          {locations.map((l) => (
            <form key={l.locationId} action={chooseGoogleLocation.bind(null, id, l.locationId)} className="card" style={{ gap: 12 }}>
              <h2 style={{ fontSize: 18 }}>{l.title}</h2>
              {l.address && <p className="small muted">{l.address}</p>}
              <div><button className="btn on" type="submit">Usar este perfil</button></div>
            </form>
          ))}
        </div>
      )}
    </>
  );
}
