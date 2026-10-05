import { deleteConnection, saveConnection, testConnection } from "@/app/actions";
import { ConnectionCard } from "@/components/ConnectionCard";
import { PageHead } from "@/components/PageHead";
import { CHANNELS } from "@/lib/channels";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { metaEnabled } from "@/lib/meta-oauth";

export default async function ConexionesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ meta?: string; msg?: string; page?: string; ig?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const metaUrl = metaEnabled() ? `/api/meta/start?b=${id}` : null;
  const b = await db.business.findUniqueOrThrow({ where: { id }, include: { connections: true } });
  const connected = b.connections.length;
  return (
    <>
      <PageHead
        business={b}
        prefix="Cuentas de"
        title="Conecta tus cuentas"
        subtitle="Cada negocio tiene sus propias cuentas. Conéctalas una sola vez y todo lo que publiques desde este negocio sale a estos lugares. Tus claves se guardan cifradas."
      />
      {q.meta === "ok" && (
        <p className="note ok" role="status">
          Listo: Facebook quedó conectado con la página &quot;{q.page}&quot;.{" "}
          {q.ig ? `Instagram también quedó conectado (@${q.ig}).` : "Esa página no tiene una cuenta de Instagram profesional vinculada, así que Instagram no se conectó."}
        </p>
      )}
      {q.meta === "error" && <p className="note error" role="alert">{q.msg || "No se pudo conectar con Facebook."}</p>}
      <div className="card" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 16, padding: "18px 22px" }}>
        <div style={{ fontFamily: "var(--display)", fontSize: 28, fontWeight: 700 }}>{connected} de {CHANNELS.length}</div>
        <div className="stack" style={{ flex: "1 1 240px" }}>
          <div className="small muted">canales conectados para {b.name}</div>
          <div style={{ height: 8, borderRadius: 4, background: "var(--line)" }}>
            <div style={{ width: `${(connected / CHANNELS.length) * 100}%`, height: 8, borderRadius: 4, background: "var(--teal)" }} />
          </div>
        </div>
      </div>
      <div className="cards">
        {CHANNELS.map((c) => {
          const conn = b.connections.find((x) => x.channel === c.id);
          const values = conn ? decryptJson(conn.secret) : {};
          // Nunca mandamos los secretos al navegador: solo si están puestos o no.
          const publicValues = Object.fromEntries(c.fields.map((f) => [f.key, f.secret ? "" : values[f.key] ?? ""]));
          const secretSet = Object.fromEntries(c.fields.filter((f) => f.secret).map((f) => [f.key, Boolean(values[f.key])]));
          return (
            <ConnectionCard
              key={c.id}
              channel={c}
              connected={Boolean(conn)}
              values={publicValues}
              secretSet={secretSet}
              save={saveConnection.bind(null, id, c.id)}
              remove={deleteConnection.bind(null, id, c.id)}
              test={testConnection.bind(null, id, c.id)}
              oauthUrl={c.id === "facebook" || c.id === "instagram" ? metaUrl : null}
            />
          );
        })}
      </div>
    </>
  );
}
