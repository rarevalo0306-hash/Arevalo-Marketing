import { connectBrevo, deleteConnection, saveConnection, testConnection } from "@/app/actions";
import { ConnectionCard } from "@/components/ConnectionCard";
import { PageHead } from "@/components/PageHead";
import { brevoDomains, brevoEnvKey } from "@/lib/brevo";
import { CHANNELS } from "@/lib/channels";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { googleEnabled } from "@/lib/google-oauth";
import { metaEnabled } from "@/lib/meta-oauth";

export default async function ConexionesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ meta?: string; google?: string; place?: string; msg?: string; page?: string; ig?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const { t } = await getT();
  const metaUrl = metaEnabled() ? `/api/meta/start?b=${id}` : null;
  const googleUrl = googleEnabled() ? `/api/google/start?b=${id}` : null;
  const b = await db.business.findUniqueOrThrow({ where: { id }, include: { connections: true } });
  const connected = b.connections.length;
  const brevo = brevoEnvKey() ? { domains: await brevoDomains(), defaultName: b.name, connect: connectBrevo.bind(null, id) } : null;
  return (
    <>
      <PageHead
        business={b}
        prefix={t("Cuentas de", "Accounts for")}
        title={t("Conecta tus cuentas", "Connect your accounts")}
        subtitle={t(
          "Cada negocio tiene sus propias cuentas. Conéctalas una sola vez y todo lo que publiques desde este negocio sale a estos lugares. Tus claves se guardan cifradas.",
          "Each business has its own accounts. Connect them once, and everything you publish from this business goes out to these places. Your keys are stored encrypted.",
        )}
      />
      {q.meta === "ok" && (
        <p className="note ok" role="status">
          {t(`Listo: Facebook quedó conectado con la página "${q.page}".`, `Done: Facebook is now connected to the Page "${q.page}".`)}{" "}
          {q.ig
            ? t(`Instagram también quedó conectado (@${q.ig}).`, `Instagram is connected too (@${q.ig}).`)
            : t(
                "Esa página no tiene una cuenta de Instagram profesional vinculada, así que Instagram no se conectó.",
                "That Page doesn't have a linked Instagram professional account, so Instagram wasn't connected.",
              )}
        </p>
      )}
      {q.google === "ok" && <p className="note ok" role="status">{t(`Listo: Google quedó conectado con el perfil "${q.place}".`, `Done: Google is now connected to the profile "${q.place}".`)}</p>}
      {q.google === "error" && <p className="note error" role="alert">{q.msg || t("No se pudo conectar con Google.", "Couldn't connect to Google.")}</p>}
      {q.meta === "error" && <p className="note error" role="alert">{q.msg || t("No se pudo conectar con Facebook.", "Couldn't connect to Facebook.")}</p>}
      <div className="card" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 16, padding: "18px 22px" }}>
        <div style={{ fontFamily: "var(--display)", fontSize: 28, fontWeight: 700 }}>{t(`${connected} de ${CHANNELS.length}`, `${connected} of ${CHANNELS.length}`)}</div>
        <div className="stack" style={{ flex: "1 1 240px" }}>
          <div className="small muted">{t("canales conectados para", "channels connected for")} {b.name}</div>
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
              oauthUrl={c.id === "facebook" || c.id === "instagram" ? metaUrl : c.id === "google" ? googleUrl : null}
              oauthName={c.id === "google" ? "Google" : "Facebook"}
              brevo={c.id === "email" ? brevo : null}
            />
          );
        })}
      </div>
    </>
  );
}
