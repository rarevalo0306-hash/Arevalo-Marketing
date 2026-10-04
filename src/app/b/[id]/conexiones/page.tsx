import { deleteConnection, saveConnection, testConnection } from "@/app/actions";
import { ConnectionCard } from "@/components/ConnectionCard";
import { PageHead } from "@/components/PageHead";
import { CHANNELS } from "@/lib/channels";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";

export default async function ConexionesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
            />
          );
        })}
      </div>
    </>
  );
}
