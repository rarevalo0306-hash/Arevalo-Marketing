"use client";

import Link from "next/link";
import { useTransition } from "react";
import { ConsentLine } from "@/components/ConsentLine";
import { useT } from "@/components/I18n";
import { Ga4HowTo } from "@/components/seo/Ga4PanelHowTo";
import { whoConnects } from "@/lib/roles";
import s from "@/components/ConnectionCard.module.css";

type Props = {
  businessId: string;
  connected: boolean;
  /** La propiedad elegida ("" = falta elegirla). */
  property: string;
  /** Falta configurar el cliente de Google en el servidor. */
  enabled: boolean;
  redirectUri: string;
  /** El dueño quitó el acceso desde su cuenta de Google (en 3 días se borra la conexión y sus datos). */
  revoked?: boolean;
  disconnect: () => Promise<void>;
  /** Su papel le deja conectar, elegir la propiedad y desconectar (Administrador o «Puede conectar»). */
  canConnect: boolean;
};

/** Google Analytics 4: visitas reales de la página web (solo lectura, gratis). */
export function Ga4Card({ businessId, connected, property, enabled, redirectUri, revoked, disconnect, canConnect }: Props) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const panel = `/b/${businessId}/seo?tab=web#ga4`;
  const broken = connected && revoked;
  const choose = connected && !property && !broken;
  return (
    <article id="c-ga4" className={`card ${s.card}${broken ? ` ${s.broken}` : ""}`}>
      <div className={s.head}>
        <span className={`mono solid ${s.logo}`} aria-hidden="true">GA4</span>
        <div className={s.title}>
          <h2>Google Analytics</h2>
          <span className={s.account}>{connected && property ? property : t("Visitas a tu página", "Visits to your website")}</span>
        </div>
        <span className={broken ? "pill failed" : connected && !choose ? "pill connected" : choose ? "pill warn" : "pill"}>
          {broken ? t("Volver a conectar", "Reconnect") : choose ? t("Falta elegir", "Pick one") : connected ? t("Conectado", "Connected") : t("No conectado", "Not connected")}
        </span>
      </div>
      {broken && (
        <p className={`note error ${s.alert}`} role="status">
          <strong>{t("Necesita volver a conectarse.", "Needs to be reconnected.")}</strong>{" "}
          {t(
            "El acceso a Google se quitó desde tu cuenta de Google. Vuelve a conectarla en los próximos 3 días o Matya borrará esta conexión y los datos que trajo.",
            "Google access was removed from your Google account. Reconnect within 3 days, or Matya will delete this connection and the data it brought in.",
          )}
        </p>
      )}
      <p className={s.gain}>
        {t(
          "Mira cuántas personas visitan tu página, de dónde llegan y cuántas te llaman o te escriben. Gratis, y no publica nada.",
          "See how many people visit your website, where they come from and how many call or message you. Free, and it doesn't post anything.",
        )}
      </p>

      {!enabled ? (
        <p className="note">
          {t(
            "Falta configurar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el servidor (el mismo cliente de «Conectar con Google»).",
            "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET need to be set on the server (the same client as \"Connect with Google\").",
          )}
        </p>
      ) : (
        <div className={s.easy}>
          {!canConnect ? null : choose ? (
            <Link className="btn on" href={panel}>{t("Elegir la propiedad", "Pick the property")}</Link>
          ) : (
            <a className={connected && !broken ? "btn outline" : "btn on"} href={`/api/ga4/start?b=${businessId}`}>
              {connected ? t("Volver a conectar con Google", "Reconnect with Google") : t("Conectar Google Analytics", "Connect Google Analytics")}
            </a>
          )}
          <span className={s.easyNote}>
            {connected ? (
              <>
                {t("Ve tus visitas en ", "See your visits in ")}
                <Link href={panel}>{t("Diagnóstico › Tu página web", "Diagnosis › Your website")}</Link>.
              </>
            ) : canConnect ? (
              t("Entra con la cuenta de Google que ve las estadísticas de tu página.", "Sign in with the Google account that sees your website's stats.")
            ) : (
              whoConnects(true, t)
            )}
          </span>
          {canConnect ? <ConsentLine className={s.hint} /> : choose && <span className={s.hint}>{whoConnects(true, t)}</span>}
        </div>
      )}

      <Ga4HowTo t={t} redirectUri={redirectUri} />

      {connected && canConnect && (
        <div className={s.actions}>
          <button
            className="btn danger"
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm(t("¿Revocar Google Analytics y borrar sus reportes y las tareas del plan que salieron de ellos? Otras conexiones de Google podrían necesitar reconexión.", "Revoke Google Analytics and delete its reports and the plan tasks built from them? Other Google connections may need reconnection."))) start(() => disconnect());
            }}
          >
            {pending ? t("Desconectando…", "Disconnecting…") : t("Desconectar", "Disconnect")}
          </button>
        </div>
      )}
    </article>
  );
}
