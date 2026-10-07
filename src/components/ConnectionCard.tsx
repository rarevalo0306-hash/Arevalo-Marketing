"use client";

import { useState, useTransition } from "react";
import type { TestResult } from "@/app/actions";
import { useT } from "@/components/I18n";
import { channelText, type ChannelDef } from "@/lib/channels";
import s from "./ConnectionCard.module.css";

type Props = {
  channel: ChannelDef;
  connected: boolean;
  values: Record<string, string>;
  secretSet: Record<string, boolean>;
  save: (f: FormData) => Promise<void>;
  remove: () => Promise<void>;
  test: () => Promise<TestResult>;
  /** Si existe, el canal se conecta iniciando sesión (Facebook/Instagram o Google). */
  oauthUrl?: string | null;
  /** Nombre del botón: "Conectar con Facebook" o "Conectar con Google". */
  oauthName?: string;
  /** Email con la clave de Brevo de la app: solo nombre y email del remitente. */
  brevo?: { domains: string[]; defaultName: string; connect: (f: FormData) => Promise<TestResult> } | null;
  /** La última publicación falló por permisos o token vencido: hay que volver a conectar. */
  needsReconnect?: boolean;
  /** Nombre de la cuenta conectada (página, perfil o remitente), si se conoce. */
  account?: string;
};

export function ConnectionCard({ channel: def, connected, values, secretSet, save, remove, test, oauthUrl, oauthName = "Facebook", brevo, needsReconnect, account }: Props) {
  const { lang, t } = useT();
  const channel = channelText(def, lang);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<TestResult>(null);
  const [pending, start] = useTransition();
  // Hay un camino fácil (entrar con tu cuenta, o Email con la cuenta de la app): los pasos técnicos quedan como alternativa.
  const easySteps = (oauthUrl || brevo) && channel.easy?.length ? channel.easy : null;

  const broken = connected && needsReconnect;

  return (
    <article id={`c-${channel.id}`} className={`card ${s.card}${broken ? ` ${s.broken}` : ""}`}>
      <div className={s.head}>
        <span className={`mono solid ${s.logo}`} aria-hidden="true">{channel.mono}</span>
        <div className={s.title}>
          <h2>{channel.name}</h2>
          {connected && account ? <span className={s.account}>{account}</span> : <span className={s.account}>{channel.kind}</span>}
        </div>
        <span className={broken ? "pill failed" : connected ? "pill connected" : "pill"}>
          {broken ? t("Volver a conectar", "Reconnect") : connected ? t("Conectado", "Connected") : t("No conectado", "Not connected")}
        </span>
      </div>
      {broken && (
        <p className={`note error ${s.alert}`} role="status">
          <strong>{t("Necesita volver a conectarse.", "Needs to be reconnected.")}</strong>{" "}
          {t(
            `La última publicación en ${channel.name} falló porque la cuenta ya no da permiso (la conexión venció o se quitó el permiso). Vuelve a conectarla y luego reintenta la publicación desde el Historial.`,
            `The last post to ${channel.name} failed because the account no longer gives permission (the connection expired or the permission was removed). Reconnect it, then retry the post from History.`,
          )}
        </p>
      )}
      <p className={s.gain}>{channel.gain}</p>

      {oauthUrl && !open && (
        <div className={s.easy}>
          <a className={connected && !broken ? "btn outline" : "btn on"} href={oauthUrl}>
            {connected ? t(`Volver a conectar con ${oauthName}`, `Reconnect with ${oauthName}`) : t(`Conectar con ${oauthName}`, `Connect with ${oauthName}`)}
          </a>
          <span className={s.easyNote}>
            {connected
              ? t("Úsalo si cambiaste de página o la conexión dejó de funcionar.", "Use it if you switched Pages or the connection stopped working.")
              : t(`Solo entra con tu cuenta de ${oauthName}. No tienes que copiar ningún código.`, `Just sign in with your ${oauthName} account. You don't have to copy any codes.`)}
          </span>
        </div>
      )}

      {brevo && !open && (
        <form action={(f) => start(async () => setResult(await brevo.connect(f)))} className={`stack ${s.sendBox}`}>
          <div className={s.label} style={{ fontSize: 14 }}>{connected ? t("Cambiar el remitente", "Change the sender") : t("Conectar en un paso", "Connect in one step")}</div>
          <div className="stack" style={{ gap: 4 }}>
            <label className={s.label} htmlFor={`${channel.id}-bname`}>{t("Nombre que ven tus clientes", "Name your customers see")}</label>
            <input id={`${channel.id}-bname`} name="name" className="field" defaultValue={brevo.defaultName} />
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <label className={s.label} htmlFor={`${channel.id}-bemail`}>{t("Email que envía", "Sending email")}</label>
            <input id={`${channel.id}-bemail`} name="email" type="email" className="field" placeholder={brevo.domains[0] ? `info@${brevo.domains[0]}` : t("info@tunegocio.com", "info@yourbusiness.com")} required />
            {brevo.domains.length > 0 && <span className={s.hint}>{t("Puede ser cualquier email de: ", "It can be any email at: ")}{brevo.domains.join(", ")}</span>}
          </div>
          <div><button className="btn on" type="submit" disabled={pending}>{pending ? t("Conectando…", "Connecting…") : t("Conectar Email", "Connect Email")}</button></div>
        </form>
      )}

      {result && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}

      {/* Al abrir el formulario a mano, los pasos se muestran abiertos (la key vuelve a montar el <details>). */}
      <details key={open ? "open" : "closed"} className={s.how} open={open || undefined}>
        <summary>{t("¿Cómo lo conecto?", "How do I connect it?")}</summary>
        <div className={s.howBody}>
          {channel.cost && (
            <p className={s.cost}>
              <strong>{t("Antes de empezar: ", "Before you start: ")}</strong>
              {channel.cost}
            </p>
          )}
          {easySteps ? (
            <>
              <p className={s.subhead}>{t("Lo fácil:", "The easy way:")}</p>
              <ol className={s.steps}>{easySteps.map((step) => <li key={step}>{step}</li>)}</ol>
              <p className={s.subhead}>{t("¿Prefieres pegar los datos a mano? (más técnico)", "Prefer to paste the details by hand? (more technical)")}</p>
              <ol className={s.steps}>{channel.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            </>
          ) : (
            <ol className={s.steps}>{channel.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          )}
          {!open && (oauthUrl || brevo) && (
            <button className={`btn link ${s.manual}`} type="button" onClick={() => setOpen(true)}>
              {oauthUrl ? t("Pegar datos a mano", "Enter details manually") : t("Usar otra cuenta (pegar clave)", "Use another account (paste key)")}
            </button>
          )}
        </div>
      </details>

      {open && (
        <form
          action={(f) =>
            start(async () => {
              await save(f);
              setResult(await test());
            })
          }
          className="stack"
          style={{ gap: 12 }}
        >
          {channel.fields.map((f) => (
            <div key={f.key} className="stack" style={{ gap: 4 }}>
              <label className={s.label} htmlFor={`${channel.id}-${f.key}`}>{f.label}</label>
              <input
                id={`${channel.id}-${f.key}`}
                name={f.key}
                className="field"
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                defaultValue={values[f.key]}
                placeholder={f.secret && secretSet[f.key] ? t("•••••••• (guardado; déjalo vacío para no cambiarlo)", "•••••••• (saved; leave it blank to keep it)") : f.placeholder}
              />
            </div>
          ))}
          <div className="row">
            <button className="btn on" type="submit" disabled={pending}>{pending ? t("Guardando y probando…", "Saving and testing…") : t("Guardar y probar", "Save and test")}</button>
            <button className="btn" type="button" onClick={() => setOpen(false)}>{t("Cerrar", "Close")}</button>
          </div>
        </form>
      )}

      {!open && (connected || (!oauthUrl && !brevo)) && (
        <div className={s.actions}>
          {connected && (
            <>
              <button className="btn" type="button" disabled={pending} onClick={() => start(async () => setResult(await test()))}>
                {pending ? t("Probando…", "Testing…") : t("Probar conexión", "Test connection")}
              </button>
              <button
                className="btn danger"
                type="button"
                disabled={pending}
                onClick={() => {
                  if (confirm(t(`¿Desconectar ${channel.name}?`, `Disconnect ${channel.name}?`))) start(async () => { await remove(); setResult(null); });
                }}
              >
                {t("Desconectar", "Disconnect")}
              </button>
            </>
          )}
          {!oauthUrl && !brevo && (
            <button className="btn outline" type="button" onClick={() => setOpen(true)}>
              {broken ? t("Pegar datos nuevos", "Paste new details") : connected ? t("Editar datos", "Edit details") : t(`Conectar ${channel.name}`, `Connect ${channel.name}`)}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
