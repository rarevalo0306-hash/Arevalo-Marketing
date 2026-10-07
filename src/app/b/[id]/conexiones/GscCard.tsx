"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useT } from "@/components/I18n";
import s from "@/components/ConnectionCard.module.css";

type Props = {
  businessId: string;
  connected: boolean;
  /** El sitio de Search Console conectado ("sc-domain:…" o una dirección). */
  site: string;
  /** Falta configurar el cliente de Google en el servidor. */
  enabled: boolean;
  hasWebsite: boolean;
  disconnect: () => Promise<void>;
};

function siteName(site: string) {
  return site.startsWith("sc-domain:") ? site.slice("sc-domain:".length) : site.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** Google Search Console: con qué búsquedas aparece tu página en Google (solo lectura, gratis). */
export function GscCard({ businessId, connected, site, enabled, hasWebsite, disconnect }: Props) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const url = `/api/gsc/start?b=${businessId}`;
  return (
    <article id="c-gsc" className={`card ${s.card}`}>
      <div className={s.head}>
        <span className={`mono solid ${s.logo}`} aria-hidden="true">GSC</span>
        <div className={s.title}>
          <h2>Google Search Console</h2>
          <span className={s.account}>{connected && site ? siteName(site) : t("Tus búsquedas en Google", "Your Google searches")}</span>
        </div>
        <span className={connected ? "pill connected" : "pill"}>{connected ? t("Conectado", "Connected") : t("No conectado", "Not connected")}</span>
      </div>
      <p className={s.gain}>
        {t(
          "Mira con qué búsquedas aparece tu página web en Google, cuántos te ven y cuántos hacen clic. Gratis, y no publica nada.",
          "See which searches your website shows up for on Google, how many people see it and how many click. Free, and it doesn't post anything.",
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
          <a className={connected ? "btn outline" : "btn on"} href={url}>
            {connected ? t("Volver a conectar con Google", "Reconnect with Google") : t("Conectar Search Console", "Connect Search Console")}
          </a>
          <span className={s.easyNote}>
            {connected ? (
              <>
                {t("Ve tus datos en ", "See your data in ")}
                <Link href={`/b/${businessId}/seo`}>SEO</Link>.
              </>
            ) : (
              t("Solo entra con la cuenta de Google donde tienes tu página en Search Console.", "Just sign in with the Google account where your website is in Search Console.")
            )}
          </span>
        </div>
      )}

      {!connected && !hasWebsite && (
        <p className="note">
          {t("Agrega tu página web en ", "Add your website in ")}
          <Link href={`/b/${businessId}/negocio`}>{t("Ajustes del negocio", "Business settings")}</Link>
          {t(" para que la app encuentre tu sitio sola.", " so the app finds your site on its own.")}
        </p>
      )}

      <details className={s.how}>
        <summary>{t("¿Cómo lo conecto?", "How do I connect it?")}</summary>
        <div className={s.howBody}>
          <ol className={s.steps}>
            <li>
              {t("Tu página web tiene que estar agregada y verificada en ", "Your website must be added and verified in ")}
              <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer">Search Console</a>
              {t(" con tu cuenta de Google.", " with your Google account.")}
            </li>
            <li>{t("Presiona «Conectar Search Console» y entra con esa misma cuenta.", "Click \"Connect Search Console\" and sign in with that same account.")}</li>
            <li>{t("Si tienes varios sitios, elige el de este negocio. ¡Listo!", "If you have several sites, pick this business's. Done!")}</li>
          </ol>
          <p className={s.subhead}>{t("Para quien configura la app (técnico):", "For whoever sets up the app (technical):")}</p>
          <ol className={s.steps}>
            <li>
              {t(
                "En Google Cloud, en el mismo proyecto de GOOGLE_CLIENT_ID, activa la «Google Search Console API».",
                "In Google Cloud, in the same project as GOOGLE_CLIENT_ID, turn on the \"Google Search Console API\".",
              )}
            </li>
            <li>
              {t(
                "Si la pantalla de permisos (OAuth consent screen) está en modo de prueba, agrega tu correo como usuario de prueba; en ese modo Google vence el permiso cada 7 días.",
                "If the OAuth consent screen is in testing mode, add your email as a test user; in that mode Google expires access every 7 days.",
              )}
            </li>
          </ol>
        </div>
      </details>

      {connected && (
        <div className={s.actions}>
          <button
            className="btn danger"
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm(t("¿Desconectar Search Console? Los reportes guardados se quedan.", "Disconnect Search Console? Saved reports stay."))) start(() => disconnect());
            }}
          >
            {pending ? t("Desconectando…", "Disconnecting…") : t("Desconectar", "Disconnect")}
          </button>
        </div>
      )}
    </article>
  );
}
