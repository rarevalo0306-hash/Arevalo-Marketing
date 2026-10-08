"use client";

// «Link de subida para tus técnicos»: un link privado por negocio para que suban fotos y videos desde el celular, sin
// cuenta. Va en «Tus fotos» y en Conexiones. Sin Cloudflare R2 configurado, explica cómo prepararlo.
import { useActionState, useState, useTransition } from "react";
import { createUploadLink, removeUploadLink, reviewUploadsNow, rotateUploadLink, type UploadLinkResult } from "@/app/actions-upload";
import { useT } from "@/components/I18n";
import cs from "@/components/ConnectionCard.module.css";
import s from "./UploadLinkCard.module.css";

type Props = {
  businessId: string;
  businessName: string;
  /** Las 5 variables de Cloudflare R2 están en el servidor. */
  configured: boolean;
  /** El link actual ("" = sin link). */
  token: string;
  /** Dirección de la app (https://…), para armar el link y la regla CORS. */
  origin: string;
  /** Cuántos llegaron por el link y cuántos faltan por revisar. */
  total: number;
  pending: number;
  /** id para saltar aquí desde otra página. */
  anchor?: string;
};

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M12 15V8" />
      <path d="m9 10.5 3-3 3 3" />
      <path d="M10.5 18.5h3" />
    </svg>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt(t("Copia esto:", "Copy this:"), text);
        }
      }}
    >
      {copied ? t("¡Copiado!", "Copied!") : label}
    </button>
  );
}

/** Pasos de una sola vez para quien configura la app (técnico). Este es el texto exacto que ve el dueño. */
function SetupSteps({ origin }: { origin: string }) {
  const { t } = useT();
  const cors = JSON.stringify(
    [{ AllowedOrigins: [origin || "https://tu-app.vercel.app"], AllowedMethods: ["PUT", "GET", "HEAD"], AllowedHeaders: ["content-type"], MaxAgeSeconds: 3600 }],
    null,
    2,
  );
  return (
    <details className={cs.how}>
      <summary>{t("¿Cómo lo preparo?", "How do I set it up?")}</summary>
      <div className={cs.howBody}>
        <p className={cs.subhead}>{t("Una sola vez, para quien configura la app (técnico):", "One time only, for whoever sets up the app (technical):")}</p>
        <ol className={cs.steps}>
          <li>
            {t("Entra a ", "Go to ")}
            <a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">
              Cloudflare
            </a>
            {t(
              " con la cuenta de la empresa y abre «R2 Object Storage» (la primera vez pide activarlo; incluye 10 GB gratis al mes).",
              ' with the company account and open "R2 Object Storage" (the first time it asks you to turn it on; it includes 10 GB free per month).',
            )}
          </li>
          <li>{t("Presiona «Create bucket», ponle de nombre arevalo-media y créalo.", 'Click "Create bucket", name it arevalo-media and create it.')}</li>
          <li>
            {t(
              "Dentro del bucket → «Settings» → «Public Development URL» (r2.dev) → «Enable». Copia la dirección que aparece (https://pub-….r2.dev).",
              'Inside the bucket → "Settings" → "Public Development URL" (r2.dev) → "Enable". Copy the address it shows (https://pub-….r2.dev).',
            )}
          </li>
          <li>
            {t("En el mismo «Settings» → «CORS Policy» → «Add CORS policy», pega esto y guarda:", 'In the same "Settings" → "CORS Policy" → "Add CORS policy", paste this and save:')}
            <pre className={s.code}>{cors}</pre>
            <CopyButton text={cors} label={t("Copiar la regla", "Copy the rule")} />
          </li>
          <li>
            {t(
              "Vuelve a R2 → «Manage API tokens» → «Create API token»: permiso «Object Read & Write», solo para el bucket arevalo-media. Copia el «Access Key ID» y el «Secret Access Key» (el secreto se ve una sola vez). El «Account ID» está en la página principal de R2.",
              'Go back to R2 → "Manage API tokens" → "Create API token": permission "Object Read & Write", only for the arevalo-media bucket. Copy the "Access Key ID" and the "Secret Access Key" (the secret is shown only once). The "Account ID" is on the R2 main page.',
            )}
          </li>
          <li>
            {t("En Vercel → tu proyecto → Settings → Environment Variables, crea estas 5:", "In Vercel → your project → Settings → Environment Variables, create these 5:")}
            <ul className={s.vars}>
              <li>
                <code>R2_ACCOUNT_ID</code> — {t("el Account ID", "the Account ID")}
              </li>
              <li>
                <code>R2_BUCKET</code> — arevalo-media
              </li>
              <li>
                <code>R2_PUBLIC_URL</code> — {t("la dirección https://pub-….r2.dev", "the https://pub-….r2.dev address")}
              </li>
              <li>
                <code>R2_ACCESS_KEY_ID</code> — {t("el Access Key ID", "the Access Key ID")}
              </li>
              <li>
                <code>R2_SECRET_ACCESS_KEY</code> — {t("el Secret Access Key", "the Secret Access Key")}
              </li>
            </ul>
          </li>
          <li>
            {t(
              "En Vercel → Deployments → los tres puntos del último → «Redeploy». Al volver aquí verás el botón «Crear link».",
              'In Vercel → Deployments → the three dots on the latest one → "Redeploy". When you come back here you\'ll see the "Create link" button.',
            )}
          </li>
        </ol>
      </div>
    </details>
  );
}

export function UploadLinkCard({ businessId, businessName, configured, token, origin, total, pending, anchor }: Props) {
  const { t } = useT();
  const [pendingAction, start] = useTransition();
  const [result, setResult] = useState<UploadLinkResult | null>(null);
  const [review, reviewAction, reviewing] = useActionState<UploadLinkResult | null, FormData>(reviewUploadsNow.bind(null, businessId), null);
  const link = token ? `${origin}/subir/${token}` : "";
  const run = (fn: (id: string) => Promise<UploadLinkResult>, ask?: string) => {
    if (ask && !confirm(ask)) return;
    start(async () => setResult(await fn(businessId)));
  };
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(
    t(
      `Hola 👋 Por este link puedes subir las fotos y videos de los trabajos de ${businessName}. No necesitas cuenta: ábrelo en tu celular y toca «Subir fotos y videos».\n${link}`,
      `Hi 👋 With this link you can upload the photos and videos of ${businessName}'s jobs. No account needed: open it on your phone and tap "Upload photos and videos".\n${link}`,
    ),
  )}`;
  const pill = !configured ? (
    <span className="pill">{t("Falta configurar", "Needs setup")}</span>
  ) : token ? (
    <span className="pill connected">{t("Activo", "Active")}</span>
  ) : (
    <span className="pill">{t("Sin link", "No link")}</span>
  );

  return (
    <article id={anchor} className={`card ${cs.card} ${s.card}`}>
      <div className={`${cs.head} ${s.head}`}>
        <span className={`${cs.logo} ${s.logo}`} aria-hidden="true">
          <PhoneIcon />
        </span>
        <div className={`${cs.title} ${s.title}`}>
          <h2>{t("Link de subida para tus técnicos", "Upload link for your technicians")}</h2>
          <span className={cs.account}>{t("Fotos y videos desde el celular, sin cuenta", "Photos and videos from the phone, no account")}</span>
        </div>
        {pill}
      </div>

      {!configured ? (
        <>
          <p className={s.text}>
            {t(
              "Todavía no está activado: falta preparar el lugar donde se guardan los videos (Cloudflare R2). Lo hace una sola vez quien configura la app.",
              "It isn't turned on yet: the place where videos are stored (Cloudflare R2) still needs to be set up. Whoever sets up the app does it once.",
            )}
          </p>
          <SetupSteps origin={origin} />
        </>
      ) : !token ? (
        <>
          <p className={s.text}>
            {t(
              "Crea un link y mándaselo a tus técnicos por WhatsApp. Lo abren en el celular, suben las fotos y videos del trabajo, y la IA los revisa igual que los de Drive.",
              "Create a link and send it to your technicians by WhatsApp. They open it on their phone, upload the job's photos and videos, and the AI reviews them just like the Drive ones.",
            )}
          </p>
          <div className={s.row} style={pendingAction ? { display: "none" } : undefined}>
            <button type="button" className="btn primary" onClick={() => run(createUploadLink)}>
              {t("Crear link", "Create link")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={s.text}>
            {t(
              "Mándales este link a tus técnicos. No necesitan cuenta: lo abren en el celular y suben fotos y videos. Llegan a «Tus fotos» y la IA los revisa.",
              "Send this link to your technicians. They don't need an account: they open it on their phone and upload photos and videos. They land in «Your photos» and the AI reviews them.",
            )}
          </p>
          <div className={s.linkBox}>
            <code className={s.link}>{link}</code>
          </div>
          <div className={s.row} style={pendingAction ? { display: "none" } : undefined}>
            <CopyButton text={link} label={t("Copiar", "Copy")} />
            <a className={`btn ${s.wa}`} href={whatsapp} target="_blank" rel="noopener noreferrer">
              {t("Mandar por WhatsApp", "Send by WhatsApp")}
            </a>
            <a className="btn outline" href={link} target="_blank" rel="noopener noreferrer">
              {t("Abrir", "Open")} ↗
            </a>
          </div>
          <p className={s.meta}>
            {total
              ? t(`${total} ${total === 1 ? "archivo subido" : "archivos subidos"} por el link.`, `${total} ${total === 1 ? "file" : "files"} uploaded with the link.`)
              : t("Todavía no han subido nada.", "Nothing uploaded yet.")}
            {pending > 0 &&
              t(
                ` ${pending === 1 ? "Falta 1" : `Faltan ${pending}`} por revisar (la IA los mira sola en un rato).`,
                ` ${pending} still to review (the AI looks at them on its own soon).`,
              )}
          </p>
          {pending > 0 && (
            <form action={reviewAction} className={s.row}>
              <button type="submit" className="btn outline" disabled={reviewing}>
                {reviewing ? t("Revisando…", "Checking…") : t("Revisar ahora", "Check now")}
              </button>
            </form>
          )}
          {review && !reviewing && (
            <p className={review.ok ? "note ok" : "note error"} role={review.ok ? "status" : "alert"}>
              {review.message}
            </p>
          )}
          <div className={`${cs.actions} ${s.manage}`} style={pendingAction ? { display: "none" } : undefined}>
            <button
              type="button"
              className="btn link"
              onClick={() =>
                run(
                  rotateUploadLink,
                  t(
                    "¿Cambiar el link? El link actual deja de servir al instante y tendrás que mandarles el nuevo a tus técnicos.",
                    "Change the link? The current link stops working right away and you'll have to send the new one to your technicians.",
                  ),
                )
              }
            >
              {t("Cambiar link", "Change link")}
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() =>
                run(
                  removeUploadLink,
                  t(
                    "¿Quitar el link? Ya nadie podrá subir con él. Las fotos que ya subieron se quedan.",
                    "Remove the link? Nobody will be able to upload with it. Photos already uploaded stay.",
                  ),
                )
              }
            >
              {t("Quitar link", "Remove link")}
            </button>
          </div>
        </>
      )}
      {pendingAction && (
        <p className={s.meta} role="status">
          {t("Un momento…", "One moment…")}
        </p>
      )}
      {result && !pendingAction && (
        <p className={result.ok ? "note ok" : "note error"} role={result.ok ? "status" : "alert"}>
          {result.message}
        </p>
      )}
    </article>
  );
}
