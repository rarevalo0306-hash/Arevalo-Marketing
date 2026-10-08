// «¿Cómo lo conecto?» de Google Analytics: los pasos del dueño y, aparte, los técnicos (Google Cloud). Sin hooks:
// sirve en el panel (servidor) y en la tarjeta de Conexiones (cliente); cada uno pasa su `t`.
import c from "@/components/ConnectionCard.module.css";
import s from "./Ga4Panel.module.css";

type Tr = (es: string, en: string) => string;

export function Ga4HowTo({ t, redirectUri }: { t: Tr; redirectUri: string }) {
  return (
    <details className={c.how}>
      <summary>{t("¿Cómo lo conecto?", "How do I connect it?")}</summary>
      <div className={c.howBody}>
        <ol className={c.steps}>
          <li>
            {t(
              "Tu página tiene que tener Google Analytics 4 instalado (el código empieza con «G-»). Si no sabes, pregúntale a quien hizo tu página.",
              "Your website needs Google Analytics 4 installed (the code starts with \"G-\"). If you're not sure, ask whoever built your website.",
            )}
          </li>
          <li>
            {t(
              "Usa una cuenta de Google que pueda ver esas estadísticas. Si no la tienes, pide que te agreguen en Analytics › Administrar › Acceso a la propiedad (con «Lector» basta).",
              "Use a Google account that can see those stats. If you don't have one, ask to be added in Analytics › Admin › Property access management (\"Viewer\" is enough).",
            )}
          </li>
          <li>
            {t(
              "Presiona «Conectar Google Analytics», entra con esa cuenta y acepta el permiso. Si tienes varias propiedades, elige la de este negocio. ¡Listo!",
              "Click \"Connect Google Analytics\", sign in with that account and accept the permission. If you have several properties, pick this business's. Done!",
            )}
          </li>
        </ol>
        <p className={c.subhead}>{t("Para quien configura la app (una sola vez):", "For whoever sets up the app (just once):")}</p>
        <ol className={c.steps}>
          <li>
            {t("Entra a ", "Go to ")}
            <a href="https://console.cloud.google.com/apis/library" target="_blank" rel="noopener noreferrer">Google Cloud › APIs</a>
            {t(
              ", en el mismo proyecto de GOOGLE_CLIENT_ID, y activa estas dos: «Google Analytics Data API» y «Google Analytics Admin API».",
              ", in the same project as GOOGLE_CLIENT_ID, and turn on these two: \"Google Analytics Data API\" and \"Google Analytics Admin API\".",
            )}
          </li>
          <li>
            {t(
              "En la pantalla de permisos (OAuth consent screen › Acceso a datos), presiona «Agregar permisos» y agrega:",
              "On the OAuth consent screen (Data access), click \"Add or remove scopes\" and add:",
            )}{" "}
            <code className={s.code}>https://www.googleapis.com/auth/analytics.readonly</code>
          </li>
          <li>
            {t(
              "La dirección de regreso autorizada (Credenciales › tu cliente OAuth) es la misma de Search Console:",
              "The authorized redirect URI (Credentials › your OAuth client) is the same as Search Console's:",
            )}{" "}
            <code className={s.code}>{redirectUri}</code>
          </li>
          <li>
            {t(
              "Si la app está en modo de prueba, agrega tu correo como usuario de prueba; en ese modo Google vence el permiso cada 7 días.",
              "If the app is in testing mode, add your email as a test user; in that mode Google expires access every 7 days.",
            )}
          </li>
        </ol>
      </div>
    </details>
  );
}
