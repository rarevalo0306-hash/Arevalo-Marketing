import Link from "next/link";
import { Fragment } from "react";
import { connectBrevo, deleteConnection, saveConnection, testConnection } from "@/app/actions";
import { disconnectGscFromConnections } from "@/app/actions-connections";
import { disconnectGa4 } from "@/app/actions-ga4";
import { ConnectionCard } from "@/components/ConnectionCard";
import { PageHead } from "@/components/PageHead";
import { UploadLinkCard } from "@/components/library/UploadLinkCard";
import { appOrigin } from "@/lib/app-origin";
import { brevoDomains, brevoEnvKey } from "@/lib/brevo";
import { CHANNEL_IDS, CHANNELS, channelName, type ChannelGroup } from "@/lib/channels";
import { decryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { GA4_CHANNEL } from "@/lib/ga4-shape";
import { googleEnabled, googleRedirectUri } from "@/lib/google-oauth";
import { metaEnabled } from "@/lib/meta-oauth";
import { connectionsNeedingReconnect } from "@/lib/connection-health";
import { GSC_CHANNEL } from "@/lib/seo/gsc";
import { serviceAccountEmail } from "@/lib/google-sa";
import { libraryCounts } from "@/lib/library-sync";
import { r2Enabled } from "@/lib/r2";
import { uploadStats } from "@/lib/upload";
import { businessTzLabel, fmtWhen } from "@/lib/time";
import { DriveCard } from "./DriveCard";
import { Ga4Card } from "./Ga4Card";
import { GscCard } from "./GscCard";
import s from "./conexiones.module.css";

const GROUPS: ChannelGroup[] = ["social", "google", "messages"];
// «Revisar ahora» en la carpeta de Google Drive puede tardar un minuto.
export const maxDuration = 120;

export default async function ConexionesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ meta?: string; google?: string; place?: string; msg?: string; page?: string; ig?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const { lang, t } = await getT();
  const metaUrl = metaEnabled() ? `/api/meta/start?b=${id}` : null;
  const googleUrl = googleEnabled() ? `/api/google/start?b=${id}` : null;
  const [b, gsc, ga4, health, library, uploads, origin] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id }, include: { connections: { where: { channel: { in: CHANNEL_IDS } } } } }),
    db.connection.findUnique({ where: { businessId_channel: { businessId: id, channel: GSC_CHANNEL } }, select: { label: true } }),
    db.connection.findUnique({ where: { businessId_channel: { businessId: id, channel: GA4_CHANNEL } }, select: { label: true } }),
    connectionsNeedingReconnect(id),
    libraryCounts(id),
    uploadStats(id),
    appOrigin(),
  ]);
  // Canales cuya última publicación falló por permisos o clave vencida (y no se han vuelto a conectar).
  const broken = new Set(Object.keys(health).filter((ch) => CHANNEL_IDS.includes(ch as (typeof CHANNEL_IDS)[number])));
  const connected = b.connections.length;
  const isOn = (ch: string) => b.connections.some((x) => x.channel === ch);
  const metaMissing = !isOn("facebook") || !isOn("instagram");
  const googleMissing = !isOn("google");
  const groupTitle: Record<ChannelGroup, string> = {
    social: t("Redes sociales", "Social networks"),
    google: t("Google y tu web", "Google and your website"),
    messages: t("Mensajes", "Messages"),
  };
  const groupHelp: Record<ChannelGroup, React.ReactNode> = {
    social: t("Donde publicas fotos, videos y novedades de tu negocio.", "Where you post photos, videos and news about your business."),
    google: t("Para que te encuentren cuando buscan en Google y Google Maps.", "So people find you when they search on Google and Google Maps."),
    messages: (
      <>
        {t("Correos y textos a tus clientes que aceptaron recibirlos. Los agregas en ", "Emails and texts to customers who agreed to receive them. You add them in ")}
        <Link href={`/b/${id}/contactos`}>{t("Contactos", "Contacts")}</Link>.
      </>
    ),
  };
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
      <div className={`card ${s.summary}`}>
        <div className={s.summaryTop}>
          <div className={s.count}>{t(`${connected} de ${CHANNELS.length}`, `${connected} of ${CHANNELS.length}`)}</div>
          <div className={s.bar}>
            <div className={s.label}>{t("canales conectados para", "channels connected for")} {b.name}</div>
            <div className={s.track}>
              <div className={s.fill} style={{ width: `${(connected / CHANNELS.length) * 100}%` }} />
            </div>
          </div>
        </div>
        {metaMissing || googleMissing ? (
          <p className={s.tip}>
            <strong>{t("¿Por dónde empiezo? ", "Where do I start? ")}</strong>
            {metaMissing && googleMissing
              ? t("Conecta primero ", "Start with ")
              : t("Te falta conectar ", "You still need to connect ")}
            {metaMissing && (
              <>
                <a href="#c-facebook">Facebook</a> {t("e", "and")} <a href="#c-instagram">Instagram</a>
                {metaUrl ? t(" (se conectan juntos con un solo botón)", " (they connect together with one button)") : ""}
              </>
            )}
            {metaMissing && googleMissing ? t(" y luego ", ", then ") : ""}
            {googleMissing && (
              <>
                <a href="#c-google">Google</a>
                {t(", para salir en Google Maps", ", so you show up on Google Maps")}
              </>
            )}
            {t(". Es donde más te buscan tus clientes; lo demás lo puedes dejar para después.", ". That's where your customers look for you most; the rest can wait.")}
          </p>
        ) : (
          <p className={s.tip}>
            {t("Ya tienes conectado lo más importante (Facebook, Instagram y Google). Lo demás es opcional.", "You've connected the most important ones (Facebook, Instagram and Google). The rest is optional.")}
          </p>
        )}
        {broken.size > 0 && (
          <p className="note error" role="alert">
            {t("Necesita volver a conectarse: ", "Needs to be reconnected: ")}
            {[...broken].map((ch, i) => (
              <span key={ch}>
                {i > 0 && ", "}
                <a href={`#c-${ch}`}>{channelName(ch, lang)}</a>
              </span>
            ))}
            .
          </p>
        )}
        <nav className={s.index} aria-label={t("Todas las cuentas", "All accounts")}>
          {GROUPS.map((g) => (
            <Fragment key={g}>
              <div className={s.indexGroup}>
                <span className={s.indexTitle}>{groupTitle[g]}</span>
                <ul>
                  {CHANNELS.filter((c) => c.group === g).map((c) => {
                    const on = isOn(c.id);
                    const bad = broken.has(c.id);
                    return (
                      <li key={c.id}>
                        <a href={`#c-${c.id}`} className={bad ? s.bad : on ? s.on : undefined}>
                          <span className={s.dot} aria-hidden="true" />
                          {channelName(c.id, lang)}
                          <span className="sr-only">{bad ? t(" (volver a conectar)", " (reconnect)") : on ? t(" (conectado)", " (connected)") : t(" (no conectado)", " (not connected)")}</span>
                        </a>
                      </li>
                    );
                  })}
                  {g === "google" && (
                    <li>
                      <a href="#c-gsc" className={gsc ? s.on : undefined}>
                        <span className={s.dot} aria-hidden="true" />
                        Search Console
                        <span className="sr-only">{gsc ? t(" (conectado)", " (connected)") : t(" (no conectado)", " (not connected)")}</span>
                      </a>
                    </li>
                  )}
                  {g === "google" && (
                    <li>
                      <a href="#c-ga4" className={ga4?.label ? s.on : undefined}>
                        <span className={s.dot} aria-hidden="true" />
                        Google Analytics
                        <span className="sr-only">{ga4?.label ? t(" (conectado)", " (connected)") : t(" (no conectado)", " (not connected)")}</span>
                      </a>
                    </li>
                  )}
                </ul>
              </div>
              {g === "social" && (
                <div className={s.indexGroup}>
                  <span className={s.indexTitle}>{t("Tus fotos", "Your photos")}</span>
                  <ul>
                    <li>
                      <a href="#c-drive" className={b.driveFolderId ? (b.driveError ? s.bad : s.on) : undefined}>
                        <span className={s.dot} aria-hidden="true" />
                        Google Drive
                        <span className="sr-only">{b.driveFolderId ? t(" (conectada)", " (connected)") : t(" (no conectada)", " (not connected)")}</span>
                      </a>
                    </li>
                    <li>
                      <a href="#c-subir" className={b.uploadToken && r2Enabled() ? s.on : undefined}>
                        <span className={s.dot} aria-hidden="true" />
                        {t("Link de subida", "Upload link")}
                        <span className="sr-only">{b.uploadToken && r2Enabled() ? t(" (activo)", " (active)") : t(" (sin link)", " (no link)")}</span>
                      </a>
                    </li>
                  </ul>
                </div>
              )}
            </Fragment>
          ))}
        </nav>
      </div>
      {GROUPS.map((g) => {
        const list = CHANNELS.filter((c) => c.group === g);
        return (
          <Fragment key={g}>
            <section className={s.group} aria-labelledby={`g-${g}`}>
              <div className={s.groupHead}>
                <h2 id={`g-${g}`}>{groupTitle[g]}</h2>
                <p className="small muted">{groupHelp[g]}</p>
              </div>
              <div className={`cards ${s.grid}`}>
                {list.map((c) => {
                  const conn = b.connections.find((x) => x.channel === c.id);
                  const values = conn ? decryptJson(conn.secret) : {};
                  // Nunca mandamos los secretos al navegador: solo si están puestos o no.
                  const publicValues = Object.fromEntries(c.fields.map((f) => [f.key, f.secret ? "" : values[f.key] ?? ""]));
                  const secretSet = Object.fromEntries(c.fields.filter((f) => f.secret).map((f) => [f.key, Boolean(values[f.key])]));
                  const label = conn?.label.trim() ?? "";
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
                      needsReconnect={broken.has(c.id)}
                      account={label && !/^\d+$/.test(label) ? label : undefined}
                    />
                  );
                })}
                {g === "google" && (
                  <GscCard
                    businessId={id}
                    connected={Boolean(gsc)}
                    site={gsc?.label ?? ""}
                    enabled={googleEnabled()}
                    hasWebsite={Boolean(b.website.trim())}
                    disconnect={disconnectGscFromConnections.bind(null, id)}
                  />
                )}
                {g === "google" && (
                  <Ga4Card
                    businessId={id}
                    connected={Boolean(ga4)}
                    property={ga4?.label ?? ""}
                    enabled={googleEnabled()}
                    redirectUri={googleRedirectUri()}
                    disconnect={disconnectGa4.bind(null, id)}
                  />
                )}
              </div>
            </section>
            {g === "social" && (
              <section className={s.group} aria-labelledby="g-photos">
                <div className={s.groupHead}>
                  <h2 id="g-photos">{t("Tus fotos y videos", "Your photos and videos")}</h2>
                  <p className="small muted">{t("Fotos reales de tu trabajo para que la IA las use en tus publicaciones.", "Real photos of your work for the AI to use in your posts.")}</p>
                </div>
                <div className={`cards ${s.grid}`}>
                  <DriveCard
                    businessId={id}
                    businessName={b.name}
                    configured={Boolean(serviceAccountEmail())}
                    email={serviceAccountEmail()}
                    folderId={b.driveFolderId}
                    folderName={b.driveFolderName}
                    lastCheck={b.driveSyncedAt ? `${fmtWhen(b.driveSyncedAt, lang)} (${businessTzLabel(lang)})` : ""}
                    error={b.driveError}
                    counts={library}
                    aiReady={Boolean(process.env.GEMINI_API_KEY)}
                  />
                  <UploadLinkCard
                    businessId={id}
                    businessName={b.name}
                    configured={r2Enabled()}
                    token={b.uploadToken}
                    origin={origin}
                    total={uploads.total}
                    pending={uploads.pending}
                    anchor="c-subir"
                  />
                </div>
              </section>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
