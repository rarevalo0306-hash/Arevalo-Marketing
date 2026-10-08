"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { disconnectDrive, saveDriveFolder, syncDriveNow, type DriveResult } from "@/app/actions-drive";
import { useT } from "@/components/I18n";
import cs from "@/components/ConnectionCard.module.css";
import s from "./DriveCard.module.css";

export type DriveCounts = {
  photos: number;
  videos: number;
  ready: number;
  pending: number;
  errors: number;
  review: number;
};

type Props = {
  businessId: string;
  businessName: string;
  /** La cuenta de servicio está configurada en el servidor (GOOGLE_SERVICE_ACCOUNT_JSON). */
  configured: boolean;
  /** Correo de la cuenta de servicio, con el que se comparte la carpeta. */
  email: string;
  folderId: string;
  folderName: string;
  /** Última revisión ya escrita en la hora del negocio ("" si nunca). */
  lastCheck: string;
  /** Último error de Drive en palabras simples. */
  error: string;
  counts: DriveCounts;
  /** Hay clave de Gemini para que la IA mire las fotos. */
  aiReady: boolean;
};

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path
        d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"
        fill="currentColor"
        opacity="0.9"
      />
      <circle cx="9" cy="13.6" r="1.6" fill="var(--surface)" />
      <path d="M6.5 18l3.6-3.4 2.2 2 2.7-3 2.9 4.4z" fill="var(--surface)" />
    </svg>
  );
}

function CopyEmail({ email }: { email: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className={s.email}>
      <code className={s.emailText}>{email}</code>
      <button
        type="button"
        className="btn small"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(email);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            window.prompt(t("Copia este correo:", "Copy this email:"), email);
          }
        }}
      >
        {copied ? t("¡Copiado!", "Copied!") : t("Copiar", "Copy")}
      </button>
    </div>
  );
}

/** Pasos técnicos de una sola vez (para quien configura la app). Este es el texto exacto que ve el dueño. */
function SetupSteps() {
  const { t } = useT();
  return (
    <details className={cs.how}>
      <summary>{t("¿Cómo lo conecto?", "How do I connect it?")}</summary>
      <div className={cs.howBody}>
        <p className={cs.subhead}>{t("Una sola vez, para quien configura la app (técnico):", "One time only, for whoever sets up the app (technical):")}</p>
        <ol className={cs.steps}>
          <li>
            {t("Entra a ", "Go to ")}
            <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">
              Google Cloud
            </a>
            {t(
              " con la cuenta de Google de la empresa y crea un proyecto (o usa el mismo de «Conectar con Google»).",
              ' with the company\'s Google account and create a project (or use the same one as "Connect with Google").',
            )}
          </li>
          <li>
            {t(
              "En «APIs y servicios» → «Biblioteca», busca «Google Drive API» y presiona «Habilitar».",
              'In "APIs & Services" → "Library", search for "Google Drive API" and click "Enable".',
            )}
          </li>
          <li>
            {t(
              "En «IAM y administración» → «Cuentas de servicio», presiona «Crear cuenta de servicio» (por ejemplo «fotos-app»). No necesita roles.",
              'In "IAM & Admin" → "Service Accounts", click "Create service account" (for example "photos-app"). It doesn\'t need any roles.',
            )}
          </li>
          <li>
            {t(
              "Abre esa cuenta → pestaña «Claves» → «Agregar clave» → «Crear clave nueva» → JSON. Se descarga un archivo: guárdalo como una contraseña.",
              'Open that account → "Keys" tab → "Add key" → "Create new key" → JSON. A file downloads: keep it safe like a password.',
            )}
          </li>
          <li>
            {t(
              "En Vercel → tu proyecto → Settings → Environment Variables, crea GOOGLE_SERVICE_ACCOUNT_JSON y pega TODO el contenido del archivo JSON.",
              "In Vercel → your project → Settings → Environment Variables, create GOOGLE_SERVICE_ACCOUNT_JSON and paste the WHOLE content of the JSON file.",
            )}
          </li>
          <li>
            {t(
              "En Vercel → Deployments → los tres puntos del último → «Redeploy». Al volver aquí verás el correo con el que se comparte cada carpeta.",
              'In Vercel → Deployments → the three dots on the latest one → "Redeploy". When you come back here you\'ll see the email to share each folder with.',
            )}
          </li>
        </ol>
        <p className="small muted">
          {t(
            "Si Google no te deja crear la clave, la organización tiene activa la política «Disable service account key creation»: un administrador la puede desactivar para este proyecto.",
            'If Google won\'t let you create the key, the organization has the "Disable service account key creation" policy on: an admin can turn it off for this project.',
          )}
        </p>
      </div>
    </details>
  );
}

/** Carpeta de Google Drive con las fotos y videos reales del negocio, para que la IA los use en las publicaciones. */
export function DriveCard({ businessId, businessName, configured, email, folderId, folderName, lastCheck, error, counts, aiReady }: Props) {
  const { t } = useT();
  const connected = Boolean(folderId);
  const [connectState, connect, connecting] = useActionState<DriveResult | null, FormData>(
    async (_prev, form) => saveDriveFolder(businessId, String(form.get("link") ?? "")),
    null,
  );
  const [syncState, sync, syncing] = useActionState<DriveResult | null, FormData>(async () => syncDriveNow(businessId), null);
  const [leaving, startLeave] = useTransition();
  const [left, setLeft] = useState<DriveResult | null>(null);
  const example = `${businessName.trim() || t("Mi negocio", "My business")} – ${t("Fotos", "Photos")}`;
  const pill = !configured ? (
    <span className="pill">{t("Falta configurar", "Needs setup")}</span>
  ) : connected ? (
    <span className={error ? "pill bad" : "pill connected"}>{error ? t("Con un problema", "Has a problem") : t("Conectada", "Connected")}</span>
  ) : (
    <span className="pill">{t("No conectada", "Not connected")}</span>
  );

  return (
    <article id="c-drive" className={`card ${cs.card}`}>
      <div className={`${cs.head} ${s.head}`}>
        <span className={`${cs.logo} ${s.logo}`} aria-hidden="true">
          <FolderIcon />
        </span>
        <div className={`${cs.title} ${s.title}`}>
          <h2>{t("Carpeta de fotos (Google Drive)", "Photo folder (Google Drive)")}</h2>
          <span className={cs.account}>
            {connected && folderName ? folderName : t("Fotos y videos reales de tu trabajo", "Real photos and videos of your work")}
          </span>
        </div>
        {pill}
      </div>
      <p className={cs.gain}>
        {t(
          "Pon en una carpeta las fotos y videos de tus trabajos. La IA los mira uno por uno y, al crear publicaciones, usa primero una foto real tuya antes de inventar una.",
          "Put photos and videos of your jobs in a folder. The AI looks at each one and, when it creates posts, uses a real photo of yours first before making one up.",
        )}
      </p>

      {!configured && (
        <>
          <p className="note">
            {t(
              "Todavía no está activado en la app. Lo hace una sola vez quien configura la app; después cada negocio conecta su carpeta aquí.",
              "It isn't turned on in the app yet. Whoever sets up the app does it once; then each business connects its folder here.",
            )}
          </p>
          <SetupSteps />
        </>
      )}

      {configured && !connected && (
        <>
          <div className={cs.easy}>
            <ol className={`${cs.steps} ${s.steps}`}>
              <li>{t(`Crea una carpeta en Google Drive, por ejemplo «${example}».`, `Create a folder in Google Drive, for example "${example}".`)}</li>
              <li>
                {t("Toca «Compartir», pega este correo y elige «Lector»:", 'Tap "Share", paste this email and choose "Viewer":')}
                <CopyEmail email={email} />
              </li>
              <li>
                {t("Copia el link de la carpeta, pégalo aquí abajo y presiona «Conectar».", 'Copy the folder\'s link, paste it below and press "Connect".')}
              </li>
            </ol>
          </div>
          <form action={connect} className={s.form}>
            <label htmlFor={`drive-link-${businessId}`} className={cs.label}>
              {t("Pega el link de la carpeta", "Paste the folder link")}
            </label>
            <div className={s.formRow}>
              <input
                id={`drive-link-${businessId}`}
                name="link"
                className="field"
                inputMode="url"
                autoComplete="off"
                required
                placeholder="https://drive.google.com/drive/folders/…"
                disabled={connecting}
              />
              <button className="btn primary" type="submit" disabled={connecting}>
                {connecting ? t("Revisando…", "Checking…") : t("Conectar", "Connect")}
              </button>
            </div>
            {connectState && (
              <p className={connectState.ok ? "note ok" : "note error"} role={connectState.ok ? "status" : "alert"}>
                {connectState.message}
              </p>
            )}
          </form>
          <p className={s.phone}>
            {t(
              "Tus técnicos pueden subir fotos desde el celular con la app de Google Drive, directo a esa carpeta.",
              "Your technicians can upload photos from their phone with the Google Drive app, straight into that folder.",
            )}
          </p>
        </>
      )}

      {configured && connected && (
        <>
          <a className={s.open} href={`https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`} target="_blank" rel="noopener noreferrer">
            {t("Abrir la carpeta en Google Drive", "Open the folder in Google Drive")} ↗
          </a>
          <dl className={s.stats}>
            <div>
              <dt>{t("Fotos", "Photos")}</dt>
              <dd>{counts.photos}</dd>
            </div>
            <div>
              <dt>{t("Videos", "Videos")}</dt>
              <dd>{counts.videos}</dd>
            </div>
            <div>
              <dt>{t("Listas para usar", "Ready to use")}</dt>
              <dd>{counts.ready}</dd>
            </div>
            <div className={counts.review ? s.warn : undefined}>
              <dt>{t("Para que las mires", "For you to check")}</dt>
              <dd>{counts.review}</dd>
            </div>
          </dl>
          <p className={s.meta}>
            {lastCheck ? t(`Última revisión: ${lastCheck}.`, `Last check: ${lastCheck}.`) : t("Todavía no se ha revisado.", "Not checked yet.")}
            {counts.pending > 0 && t(` Faltan ${counts.pending} por revisar.`, ` ${counts.pending} still to review.`)}
            {counts.errors > 0 &&
              t(` ${counts.errors} con algún problema (los ves en tus fotos).`, ` ${counts.errors} with a problem (see them in your photos).`)}
          </p>
          {error && (
            <div className="note error" role="alert">
              <p className={s.errText}>{error}</p>
              {/compart|share/i.test(error) && email && <CopyEmail email={email} />}
            </div>
          )}
          {!aiReady && counts.pending > 0 && (
            <p className="note">
              {t(
                "Falta la clave de Gemini (GEMINI_API_KEY) para que la IA mire las fotos. Quedan guardadas para después.",
                "The Gemini key (GEMINI_API_KEY) is missing, so the AI can't look at the photos yet. They're saved for later.",
              )}
            </p>
          )}
          <form action={sync} className={s.syncRow}>
            <button className="btn primary" type="submit" disabled={syncing}>
              {syncing ? t("Revisando…", "Checking…") : t("Revisar ahora", "Check now")}
            </button>
            <Link className="btn outline" href={`/b/${businessId}/fotos`}>
              {t("Ver mis fotos", "See my photos")}
            </Link>
          </form>
          <div aria-live="polite">
            {syncing && (
              <p className={s.meta}>
                {t(
                  "Trayendo lo nuevo de la carpeta y la IA lo está mirando. Puede tardar un minuto…",
                  "Bringing in what's new in the folder while the AI looks at it. It can take a minute…",
                )}
              </p>
            )}
            {!syncing && syncState && <p className={syncState.ok ? "note ok" : "note error"}>{syncState.message}</p>}
          </div>
          <p className={s.phone}>
            {t(
              "Tus técnicos pueden subir fotos desde el celular con la app de Google Drive, directo a esta carpeta. La app la revisa sola una vez al día.",
              "Your technicians can upload photos from their phone with the Google Drive app, straight into this folder. The app checks it on its own once a day.",
            )}
          </p>
          <div className={cs.actions}>
            <button
              className="btn danger"
              type="button"
              disabled={leaving}
              onClick={() => {
                if (
                  confirm(
                    t(
                      "¿Desconectar la carpeta? Las fotos que ya se copiaron se quedan en tu biblioteca.",
                      "Disconnect the folder? Photos already copied stay in your library.",
                    ),
                  )
                )
                  startLeave(async () => setLeft(await disconnectDrive(businessId)));
              }}
            >
              {leaving ? t("Desconectando…", "Disconnecting…") : t("Desconectar", "Disconnect")}
            </button>
          </div>
        </>
      )}
      {left && !connected && (
        <p className="note ok" role="status">
          {left.message}
        </p>
      )}
    </article>
  );
}
