"use client";

// «Pedir reseñas»: elegir contactos con permiso, revisar el mensaje (vista previa) y mandarlo por email o SMS.
import { useActionState, useMemo, useState, useTransition } from "react";
import { sendReviewRequests, writeReviewTemplate, type DirResult } from "@/app/actions-directories";
import { useT } from "@/components/I18n";
import { listLabel } from "@/lib/contacts";
import { fmtDateTime } from "@/lib/time";
import { fillTemplate, hasLink, incentiveIssues, reachable, type ReqChannel, type ReqTemplate } from "@/lib/reviews-request";
import s from "./Directories.module.css";

export type ReqContactItem = { id: string; name: string; email: string; phone: string; emailOptIn: boolean; smsOptIn: boolean; lists: string[] };

export type ReviewRequestProps = {
  businessId: string;
  link: string;
  contacts: ReqContactItem[];
  recentlyAsked: string[];
  sentToday: number;
  dailyMax: number;
  cooldownDays: number;
  templates: { es: ReqTemplate; en: ReqTemplate };
  connected: { email: boolean; sms: boolean };
  history: { at: string; channel: ReqChannel; sent: number; failed: number }[];
};

const ALL = "__all";

export function ReviewRequest(p: ReviewRequestProps) {
  const { lang, t } = useT();
  const [channel, setChannel] = useState<ReqChannel>("email");
  const [msgLang, setMsgLang] = useState<"es" | "en">(lang);
  const [subject, setSubject] = useState(p.templates[lang].subject);
  const [emailBody, setEmailBody] = useState(p.templates[lang].email);
  const [smsBody, setSmsBody] = useState(p.templates[lang].sms);
  const [list, setList] = useState(ALL);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [aiMsg, setAiMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [aiPending, startAi] = useTransition();
  const [state, action, isPending] = useActionState<DirResult, FormData>(sendReviewRequests.bind(null, p.businessId), null);

  const asked = useMemo(() => new Set(p.recentlyAsked), [p.recentlyAsked]);
  const remaining = Math.max(0, p.dailyMax - p.sentToday);
  const body = channel === "email" ? emailBody : smsBody;
  const issues = incentiveIssues(`${channel === "email" ? subject : ""} ${body}`);
  const linkOk = hasLink(body, p.link);
  const lists = useMemo(() => [...new Set(p.contacts.flatMap((c) => c.lists))], [p.contacts]);
  const canSend = (c: ReqContactItem) => reachable(c, channel) && !asked.has(c.id);
  const visible = p.contacts.filter((c) => {
    if (list !== ALL && !c.lists.includes(list)) return false;
    const q = query.trim().toLowerCase();
    return !q || `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(q);
  });
  const selected = p.contacts.filter((c) => chosen.includes(c.id) && canSend(c));
  const willSend = Math.min(selected.length, remaining);
  const first = selected[0] ?? p.contacts.find((c) => canSend(c)) ?? { name: "Ana" };
  const reachableCount = p.contacts.filter((c) => reachable(c, channel)).length;

  const loadTemplate = (l: "es" | "en") => {
    setMsgLang(l);
    setSubject(p.templates[l].subject);
    setEmailBody(p.templates[l].email);
    setSmsBody(p.templates[l].sms);
    setAiMsg(null);
  };
  const toggle = (id: string) => setChosen((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const pickAll = () => setChosen(visible.filter(canSend).slice(0, remaining).map((c) => c.id));
  const why = (c: ReqContactItem) =>
    !reachable(c, channel)
      ? channel === "email"
        ? c.email
          ? t("No aceptó correos", "Didn't accept email")
          : t("Sin email", "No email")
        : c.phone
          ? t("No aceptó textos", "Didn't accept texts")
          : t("Sin teléfono", "No phone")
      : asked.has(c.id)
        ? t(`Ya se le pidió (últimos ${p.cooldownDays} días)`, `Already asked (last ${p.cooldownDays} days)`)
        : "";

  return (
    <div className="stack">
      <p className="note info">
        {t(
          "Regla de Google: pide a todos tus clientes por igual una reseña honesta. Nunca ofrezcas descuentos, regalos ni nada a cambio, y no pidas 5 estrellas: Google puede borrar esas reseñas o suspender tu perfil.",
          "Google's rule: ask all your customers equally for an honest review. Never offer discounts, gifts or anything in return, and don't ask for 5 stars: Google may remove those reviews or suspend your profile.",
        )}
      </p>

      <div className={s.reqTop}>
        <div className="theme-pick" role="group" aria-label={t("Cómo enviarlo", "How to send it")}>
          {(["email", "sms"] as const).map((c) => (
            <button key={c} type="button" className={channel === c ? "on" : ""} aria-pressed={channel === c} onClick={() => setChannel(c)}>
              {c === "email" ? t("Email", "Email") : t("SMS (texto)", "SMS (text)")}
            </button>
          ))}
        </div>
        <div className="theme-pick" role="group" aria-label={t("Idioma del mensaje", "Message language")}>
          {(["es", "en"] as const).map((l) => (
            <button key={l} type="button" className={msgLang === l ? "on" : ""} aria-pressed={msgLang === l} onClick={() => loadTemplate(l)}>
              {l === "es" ? "Español" : "English"}
            </button>
          ))}
        </div>
      </div>

      {!p.connected[channel] && (
        <p className="note">
          {channel === "email"
            ? t("Para mandar correos, primero conecta tu email (Brevo o Resend) en ", "To send emails, first connect your email (Brevo or Resend) in ")
            : t("Para mandar textos, primero conecta Twilio en ", "To send texts, first connect Twilio in ")}
          <a href={`/b/${p.businessId}/conexiones`}>{t("Conexiones", "Connections")}</a>.
        </p>
      )}

      <div className={s.reqGrid}>
        <div className="stack">
          {channel === "email" && (
            <label className={s.label}>
              {t("Asunto", "Subject")}
              <input className="field" value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} />
            </label>
          )}
          <label className={s.label}>
            {t("Mensaje", "Message")}
            <textarea
              className="field"
              rows={channel === "email" ? 10 : 4}
              maxLength={channel === "email" ? 2000 : 320}
              value={body}
              onChange={(e) => (channel === "email" ? setEmailBody(e.target.value) : setSmsBody(e.target.value))}
            />
          </label>
          <p className="small muted">
            {t(
              "{nombre} se cambia por el nombre de cada persona y {link} por tu link de reseñas.",
              "{name} becomes each person's first name and {link} your review link.",
            )}
            {channel === "sms" && ` ${t(`${body.length} de 320 letras. Se agrega «Responde STOP para no recibir más».`, `${body.length} of 320 characters. “Reply STOP to opt out” is added.`)}`}
          </p>
          {!linkOk && <p className="note error">{t("El mensaje necesita {link}: ahí va tu link de reseñas.", "The message needs {link}: that's where your review link goes.")}</p>}
          {issues.length > 0 && (
            <p className="note error" role="alert">
              {t(`Quita esto: ${issues.join(", ")}. Google no lo permite al pedir reseñas.`, `Remove this: ${issues.join(", ")}. Google doesn't allow it when asking for reviews.`)}
            </p>
          )}
          <div className="row">
            <button
              type="button"
              className={`btn outline ${s.wrapBtn}`}
              disabled={aiPending}
              onClick={() =>
                startAi(async () => {
                  const r = await writeReviewTemplate(p.businessId, msgLang);
                  setSubject(r.template.subject);
                  setEmailBody(r.template.email);
                  setSmsBody(r.template.sms);
                  setAiMsg({ ok: r.ok, message: r.message });
                })
              }
            >
              {aiPending ? t("La IA está escribiendo…", "The AI is writing…") : t("Que la IA lo escriba con la voz de mi marca", "Have the AI write it in my brand voice")}
            </button>
            <button type="button" className="btn link" onClick={() => loadTemplate(msgLang)}>
              {t("Volver a la plantilla", "Back to the template")}
            </button>
          </div>
          {aiMsg && <p className={`note ${aiMsg.ok ? "ok" : "error"}`}>{aiMsg.message}</p>}
        </div>

        <div className={s.preview} aria-label={t("Vista previa", "Preview")}>
          <span className={s.previewTag}>{t("Vista previa", "Preview")}</span>
          {channel === "email" && <strong className={s.previewSubject}>{fillTemplate(subject, { name: first.name, link: p.link })}</strong>}
          <div className={channel === "sms" ? s.bubble : s.previewBody}>{fillTemplate(body, { name: first.name, link: p.link })}</div>
        </div>
      </div>

      <div className={s.pickHead}>
        <strong>{t("¿A quién se lo pides?", "Who are you asking?")}</strong>
        <span className="small muted">
          {t(
            `${reachableCount} de ${p.contacts.length} contactos aceptaron ${channel === "email" ? "correos" : "textos"} · hoy te quedan ${remaining} de ${p.dailyMax}`,
            `${reachableCount} of ${p.contacts.length} contacts accepted ${channel === "email" ? "email" : "texts"} · ${remaining} of ${p.dailyMax} left today`,
          )}
        </span>
      </div>
      {p.contacts.length === 0 ? (
        <p className="small muted">
          {t("Todavía no tienes contactos. ", "You don't have contacts yet. ")}
          <a href={`/b/${p.businessId}/contactos`}>{t("Agrega tus clientes en Contactos", "Add your customers in Contacts")}</a>.
        </p>
      ) : (
        <>
          <div className={s.pickTools}>
            {lists.length > 0 && (
              <select className="field" value={list} onChange={(e) => setList(e.target.value)} aria-label={t("Lista", "List")}>
                <option value={ALL}>{t("Todas las listas", "All lists")}</option>
                {lists.map((l) => (
                  <option key={l} value={l}>
                    {listLabel(l, lang)}
                  </option>
                ))}
              </select>
            )}
            <input className="field" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Buscar por nombre, email o teléfono", "Search by name, email or phone")} aria-label={t("Buscar contacto", "Search contact")} />
            <button type="button" className="btn" onClick={pickAll} disabled={!remaining}>
              {t("Elegir todos los que se puede", "Select everyone allowed")}
            </button>
            {chosen.length > 0 && (
              <button type="button" className="btn link" onClick={() => setChosen([])}>
                {t("Quitar todos", "Clear all")}
              </button>
            )}
          </div>
          <ul className={s.people}>
            {visible.slice(0, 200).map((c) => {
              const reason = why(c);
              return (
                <li key={c.id}>
                  <label className={`${s.person} ${reason ? s.personOff : ""}`}>
                    <input type="checkbox" checked={chosen.includes(c.id) && !reason} disabled={!!reason} onChange={() => toggle(c.id)} />
                    <span className={s.personWho}>
                      <strong>{c.name || t("Sin nombre", "No name")}</strong>
                      <span className="small muted">{channel === "email" ? c.email || "—" : c.phone || "—"}</span>
                    </span>
                    {reason && <span className="small muted">{reason}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
          {visible.length > 200 && <p className="small muted">{t("Mostramos 200; usa el buscador o la lista para ver los demás.", "Showing 200; use search or the list to see the rest.")}</p>}
        </>
      )}

      {isPending && (
        <p className="small muted" role="status">
          {t("Enviando… no cierres esta página.", "Sending… don't close this page.")}
        </p>
      )}
      <form action={action} className={s.sendForm} style={isPending ? { display: "none" } : undefined}>
        <input type="hidden" name="channel" value={channel} />
        <input type="hidden" name="lang" value={msgLang} />
        <input type="hidden" name="subject" value={subject} />
        <input type="hidden" name="body" value={body} />
        {selected.slice(0, remaining).map((c) => (
          <input key={c.id} type="hidden" name="contact" value={c.id} />
        ))}
        <label className="check">
          <input type="checkbox" name="confirm" required />
          <span>
            {t(
              `Sí, pedir reseña a ${willSend} ${willSend === 1 ? "persona" : "personas"} por ${channel === "email" ? "email" : "mensaje de texto"}.`,
              `Yes, ask ${willSend} ${willSend === 1 ? "person" : "people"} for a review by ${channel === "email" ? "email" : "text message"}.`,
            )}
            {selected.length > remaining && ` ${t(`${selected.length - remaining} quedan para mañana (límite de ${p.dailyMax} al día).`, `${selected.length - remaining} left for tomorrow (limit of ${p.dailyMax} a day).`)}`}
          </span>
        </label>
        <button type="submit" className="btn primary" disabled={!willSend || !linkOk || issues.length > 0 || !p.connected[channel]}>
          {t("Enviar pedido de reseña", "Send review request")}
        </button>
      </form>
      {state?.message && !isPending && (
        <p className={`note ${state.ok ? "ok" : "error"}`} role={state.ok ? "status" : "alert"}>
          {state.message}
        </p>
      )}
      {p.history.length > 0 && (
        <details className={s.more}>
          <summary>{t("Envíos anteriores", "Previous sends")}</summary>
          <ul className={s.history}>
            {p.history.map((h, i) => (
              <li key={i} className="small">
                {fmtDateTime(h.at, lang)} ·{" "}
                {h.channel === "email" ? "Email" : "SMS"} · {t(`${h.sent} enviados`, `${h.sent} sent`)}
                {h.failed ? ` · ${t(`${h.failed} fallaron`, `${h.failed} failed`)}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
