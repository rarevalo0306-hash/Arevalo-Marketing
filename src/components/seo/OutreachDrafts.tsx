"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";
import { draftOutreach, draftTopOutreach, saveOutreachEdit } from "@/app/actions-seo-outreach";
import { useT } from "@/components/I18n";
import { HowToRead } from "@/components/seo/HowToRead";
import styles from "@/components/seo/OutreachDrafts.module.css";
import type { LinkHint } from "@/lib/seo/backlinks";
import type { OutreachDraft } from "@/lib/seo/outreach";

// "Pedir enlace" en cada sitio de "Dónde conseguir enlaces" y "Preparar los 5 primeros" arriba de la lista.
// Los borradores viven en un contexto para que el botón de arriba llene las filas sin recargar.

type Ctx = {
  businessId: string;
  aiReady: boolean;
  drafts: Record<string, OutreachDraft>;
  put: (list: OutreachDraft[]) => void;
  /** Sitios recién preparados con el botón de arriba (se abren solos). */
  fresh: Set<string>;
};

const OutreachCtx = createContext<Ctx | null>(null);

function useOutreach(): Ctx {
  const c = useContext(OutreachCtx);
  if (!c) throw new Error("OutreachRow y OutreachTop van dentro de OutreachProvider");
  return c;
}

/** Envuelve la lista de "Dónde conseguir enlaces" con los borradores guardados. */
export function OutreachProvider({ businessId, aiReady, initial, children }: { businessId: string; aiReady: boolean; initial: Record<string, OutreachDraft>; children: React.ReactNode }) {
  const [drafts, setDrafts] = useState(initial);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const put = (list: OutreachDraft[]) => {
    setDrafts((d) => ({ ...d, ...Object.fromEntries(list.map((x) => [x.domain, x])) }));
    if (list.length > 1) setFresh((f) => new Set([...f, ...list.map((x) => x.domain)]));
  };
  return <OutreachCtx.Provider value={{ businessId, aiReady, drafts, put, fresh }}>{children}</OutreachCtx.Provider>;
}

/** Segundos desde que empezó a trabajar (0 si no está trabajando). */
function useElapsed(pending: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!pending) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  return pending ? seconds : 0;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

async function copyText(text: string, area: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!area) return false;
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

/** Botón "Preparar los 5 primeros" y la explicación corta. */
export function OutreachTop({ pendingCount }: { pendingCount: number }) {
  const { t } = useT();
  const { businessId, put } = useOutreach();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const seconds = useElapsed(pending);

  const run = () =>
    start(async () => {
      setMsg(null);
      const r = await draftTopOutreach(businessId);
      if (r.drafts) put(Object.values(r.drafts));
      setMsg({ ok: r.ok, text: r.message });
    });

  return (
    <div className={styles.top}>
      <HowToRead title={t("¿Cómo pido un enlace?", "How do I ask for a link?")}>
        <p>
          {t(
            "Un enlace es cuando otra página pone un link a la tuya; Google lo ve como una recomendación.",
            "A link is when another website puts a link to yours; Google sees it as a recommendation.",
          )}
        </p>
        <ul>
          <li>
            {t(
              "«Pedir enlace» te prepara qué hacer con cada sitio: en directorios y redes, los pasos para registrarte; en noticias y blogs, un correo corto que puedes cambiar.",
              "“Ask for a link” prepares what to do with each site: for directories and social networks, the steps to sign up; for news and blogs, a short email you can change.",
            )}
          </li>
          <li>
            {t(
              "Buscamos el correo en la página de ese sitio. Si no aparece, no lo inventamos: usa su formulario de contacto o sus redes.",
              "We look for the email on that site's pages. If it isn't there, we don't make one up: use their contact form or social media.",
            )}
          </li>
          <li>
            {t(
              "Nada se envía solo: tú lo revisas y lo mandas desde tu correo. Nunca pagues por un enlace; Google lo castiga.",
              "Nothing is sent automatically: you check it and send it from your own email. Never pay for a link; Google penalizes it.",
            )}
          </li>
        </ul>
      </HowToRead>
      {pendingCount > 0 && (
        <div className={styles.actions}>
          <button type="button" className="btn ai" onClick={run} disabled={pending}>
            {pending ? t("Preparando…", "Preparing…") : t(`Preparar los ${Math.min(5, pendingCount)} primeros`, `Prepare the top ${Math.min(5, pendingCount)}`)}
          </button>
          <span className="small muted" aria-live="polite">
            {pending
              ? `${clock(seconds)} · ${t("Revisamos sus páginas y escribimos los correos. Suele tardar menos de un minuto.", "We check their pages and write the emails. It usually takes less than a minute.")}`
              : t("Usa la IA de la app, no DataForSEO.", "Uses the app's AI, not DataForSEO.")}
          </span>
        </div>
      )}
      {msg && !pending && (
        <p className={msg.ok ? "note ok" : "note error"} role="status">
          {msg.text}
        </p>
      )}
    </div>
  );
}

const TYPE_LABEL = (t: (es: string, en: string) => string, d: OutreachDraft) =>
  d.type === "email" ? t("Correo para pedir el enlace", "Email to ask for the link") : d.type === "profile" ? t("Crea o completa tu perfil", "Create or complete your profile") : t("Regístrate", "Sign up");

/** El botón "Pedir enlace" de un sitio y lo que se preparó. */
export function OutreachRow({ domain, hint }: { domain: string; hint: LinkHint }) {
  const { t, lang } = useT();
  const { businessId, aiReady, drafts, put, fresh } = useOutreach();
  const draft = drafts[domain];
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [saved, setSaved] = useState({ subject: draft?.subject ?? "", body: draft?.body ?? "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<"" | "body" | "subject">("");
  const [pending, start] = useTransition();
  const seconds = useElapsed(pending);
  const area = useRef<HTMLTextAreaElement>(null);
  const shownAt = useRef(draft?.createdAt ?? "");
  const email = hint === "news" || hint === "blog" || hint === "forum" || hint === "other";

  // Si el botón de arriba trajo un borrador nuevo, se muestra.
  useEffect(() => {
    if (!draft || draft.createdAt === shownAt.current) return;
    shownAt.current = draft.createdAt;
    setSubject(draft.subject ?? "");
    setBody(draft.body ?? "");
    setSaved({ subject: draft.subject ?? "", body: draft.body ?? "" });
    if (fresh.has(domain)) setOpen(true);
  }, [draft, fresh, domain]);

  const make = () =>
    start(async () => {
      setMsg(null);
      setOpen(true);
      const r = await draftOutreach(businessId, domain);
      if (r.ok && r.draft) {
        shownAt.current = r.draft.createdAt;
        setSubject(r.draft.subject ?? "");
        setBody(r.draft.body ?? "");
        setSaved({ subject: r.draft.subject ?? "", body: r.draft.body ?? "" });
        put([r.draft]);
      } else if (!drafts[domain]) setOpen(false);
      setMsg({ ok: r.ok, text: r.message });
    });

  const save = async () => {
    if (!draft || draft.type !== "email" || (subject === saved.subject && body === saved.body)) return;
    const r = await saveOutreachEdit(businessId, domain, subject, body);
    if (r.ok) setSaved({ subject, body });
    else setMsg({ ok: false, text: r.message });
  };

  const copy = async (what: "body" | "subject") => {
    const ok = await copyText(what === "body" ? body : subject, what === "body" ? area.current : null);
    setCopied(ok ? what : "");
    if (ok) setTimeout(() => setCopied(""), 2500);
    else setMsg({ ok: false, text: t("No se pudo copiar. Selecciona el texto y cópialo a mano.", "Couldn't copy. Select the text and copy it by hand.") });
    void save();
  };

  const mailto = draft?.contactEmail ? `mailto:${draft.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : "";
  const needsAi = email && !aiReady;

  return (
    <div className={styles.row}>
      {!open ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={draft ? "btn outline" : "btn"}
            onClick={draft ? () => setOpen(true) : make}
            disabled={pending || (!draft && needsAi)}
            title={!draft && needsAi ? t("Falta la clave de la IA en Vercel.", "The AI key is missing in Vercel.") : undefined}
          >
            {draft ? t("Ver cómo pedirlo", "See how to ask") : t("Pedir enlace", "Ask for a link")}
          </button>
          {draft && <span className="small muted">{t("Ya preparado", "Already prepared")}</span>}
        </div>
      ) : (
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <strong>{draft ? TYPE_LABEL(t, draft) : t("Preparando…", "Preparing…")}</strong>
            <button type="button" className="btn link" onClick={() => setOpen(false)} disabled={pending}>
              {t("Cerrar", "Close")}
            </button>
          </div>

          {pending && (
            <p className="small muted" aria-live="polite">
              {clock(seconds)} ·{" "}
              {email
                ? t("Buscamos su correo en su página y la IA escribe el mensaje…", "We look for their email on their site and the AI writes the message…")
                : t("Buscamos dónde registrarte en su página…", "We look for where to sign up on their site…")}
            </p>
          )}

          {draft && !pending && (
            <>
              {draft.type === "email" && (
                <>
                  <p className={styles.meta}>
                    {draft.contactEmail ? (
                      <>
                        {t("Para:", "To:")} <strong>{draft.contactEmail}</strong>
                      </>
                    ) : draft.contactUrl ? (
                      <>
                        {t("No encontramos su correo. Usa su página de contacto: ", "We didn't find their email. Use their contact page: ")}
                        <a href={draft.contactUrl} target="_blank" rel="noopener noreferrer">{draft.contactUrl}</a>
                      </>
                    ) : (
                      t("No encontramos un correo en su página (no lo adivinamos). Búscalo en «Contacto» o escríbeles por sus redes.", "We didn't find an email on their site (we don't guess it). Look under “Contact” or message them on social media.")
                    )}
                  </p>
                  <label className="lbl" htmlFor={`os-${domain}`}>{t("Asunto", "Subject")}</label>
                  <input id={`os-${domain}`} className="field" value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={() => void save()} maxLength={200} />
                  <label className="lbl" htmlFor={`ob-${domain}`}>{t("Mensaje", "Message")}</label>
                  <textarea
                    id={`ob-${domain}`}
                    ref={area}
                    className={`field ${styles.body}`}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    onBlur={() => void save()}
                    maxLength={5000}
                    rows={10}
                    lang={draft.lang}
                  />
                  <div className={styles.actions}>
                    <button type="button" className="btn on" onClick={() => void copy("body")} disabled={body.trim().length < 2}>
                      {copied === "body" ? t("¡Copiado!", "Copied!") : t("Copiar correo", "Copy email")}
                    </button>
                    <button type="button" className="btn" onClick={() => void copy("subject")} disabled={subject.trim().length < 2}>
                      {copied === "subject" ? t("¡Copiado!", "Copied!") : t("Copiar asunto", "Copy subject")}
                    </button>
                    {mailto && (
                      <a className="btn outline" href={mailto} onClick={() => void save()}>
                        {t("Abrir en mi correo", "Open in my email")}
                      </a>
                    )}
                    {aiReady && (
                      <button type="button" className="btn link" onClick={make}>
                        {t("Otra versión con IA", "Another AI version")}
                      </button>
                    )}
                  </div>
                </>
              )}

              {draft.type !== "email" && (
                <div className={styles.actions}>
                  {draft.signupUrl && (
                    <a className="btn outline" href={draft.signupUrl} target="_blank" rel="noopener noreferrer">
                      {draft.type === "profile" ? t("Abrir el sitio", "Open the site") : t("Ir a registrarme", "Go sign up")}
                    </a>
                  )}
                  {draft.contactEmail && (
                    <a className="btn" href={`mailto:${draft.contactEmail}`}>
                      {draft.contactEmail}
                    </a>
                  )}
                </div>
              )}

              {draft.steps.length > 0 && (
                <div className="stack" style={{ gap: 6 }}>
                  <span className="lbl">{draft.type === "email" ? t("Qué hacer", "What to do") : t("Pasos", "Steps")}</span>
                  <ol className={styles.steps}>
                    {draft.steps.map((s, i) => (
                      <li key={i}>{lang === "en" ? s.en : s.es}</li>
                    ))}
                  </ol>
                </div>
              )}
              {draft.type !== "email" && (
                <button type="button" className="btn link" onClick={make} style={{ alignSelf: "flex-start" }}>
                  {t("Buscar de nuevo en su página", "Check their site again")}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {msg && !pending && (
        <p className={msg.ok ? "note ok" : "note error"} role="status">
          {msg.text}
        </p>
      )}
    </div>
  );
}
