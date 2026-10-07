"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { draftAllReplies, draftReply, postReply, saveReplyDraft } from "@/app/actions-seo-gbp";
import { useT } from "@/components/I18n";
import { capClass } from "@/components/seo/Fold";
import { ShowMore } from "@/components/seo/ShowMore";
import { DRAFT_BATCH, type GbpReview } from "@/lib/seo/gbp-shared";

type Filter = "unanswered" | "low" | "all";

/** Cuántas reseñas se ven antes de «Ver todas». */
const REVIEWS_SHOWN = 5;

type Props = {
  businessId: string;
  reviews: GbpReview[];
  /** Hay conexión "google" con cuenta y ubicación: se puede intentar responder directo en Google. */
  canPost: boolean;
  /** Hay clave de alguna IA en el servidor. */
  aiReady: boolean;
  /** Enlace al perfil en Google Maps (cuando la reseña no trae el suyo). */
  mapsLink: string;
};

/** "★★★★☆" */
export function Stars({ value }: { value: number | null }) {
  const { t } = useT();
  if (value === null) return null;
  const n = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className="gbp-stars" role="img" aria-label={t(`${n} de 5 estrellas`, `${n} out of 5 stars`)}>
      {"★".repeat(n)}
      <span className="gbp-stars-off">{"★".repeat(5 - n)}</span>
    </span>
  );
}

async function copyText(text: string, area: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Navegadores viejos o sin permiso: se selecciona el texto y se copia.
    if (!area) return false;
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

function ReviewCard({
  businessId,
  review,
  initial,
  canPost,
  aiReady,
  mapsLink,
  className,
}: { businessId: string; review: GbpReview; initial: string; className?: string } & Omit<Props, "businessId" | "reviews">) {
  const { t } = useT();
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [open, setOpen] = useState(Boolean(initial));
  const [posted, setPosted] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [drafting, startDraft] = useTransition();
  const [posting, startPost] = useTransition();
  const area = useRef<HTMLTextAreaElement>(null);
  const answer = posted || review.ownerAnswer;
  const link = review.url || mapsLink;
  const busy = drafting || posting;

  const write = () =>
    startDraft(async () => {
      setMsg(null);
      setOpen(true);
      const r = await draftReply(businessId, review.id);
      if (r.ok && r.text) {
        setText(r.text);
        setSaved(r.text);
      } else setMsg({ ok: false, text: r.message });
    });

  const save = async () => {
    if (text === saved) return;
    const r = await saveReplyDraft(businessId, review.id, text);
    if (r.ok) setSaved(text);
    else setMsg({ ok: false, text: r.message });
  };

  const copy = async () => {
    const ok = await copyText(text, area.current);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2500);
    else setMsg({ ok: false, text: t("No se pudo copiar. Selecciona el texto y cópialo a mano.", "Couldn't copy. Select the text and copy it by hand.") });
    void save();
  };

  const post = () =>
    startPost(async () => {
      setMsg(null);
      const r = await postReply(businessId, review.id, text);
      if (r.ok) setPosted(r.text ?? text);
      else setSaved(text);
      setMsg({ ok: r.ok, text: r.message });
    });

  const shown = review.originalText && review.text ? review.text : review.originalText || review.text;

  return (
    <li className={`gbp-review${!answer && review.rating !== null && review.rating <= 3 ? " low" : ""}${className ? ` ${className}` : ""}`}>
      <div className="gbp-review-head">
        <Stars value={review.rating} />
        <strong className="gbp-name">{review.name || t("Cliente de Google", "Google customer")}</strong>
        {review.localGuide && <span className="tag">{t("Local Guide", "Local Guide")}</span>}
        {review.timeAgo && <span className="small muted">{review.timeAgo}</span>}
      </div>
      {shown ? <p className="gbp-text">{shown}</p> : <p className="small muted">{t("Solo dejó estrellas, sin texto.", "Only left stars, no text.")}</p>}
      {review.originalText && review.text && (
        <details className="small">
          <summary className="muted">{t("Ver el texto original", "See the original text")}</summary>
          <p className="gbp-text">{review.originalText}</p>
        </details>
      )}
      {answer ? (
        <div className="gbp-answer">
          <span className="small muted">{posted || review.postedAt ? t("Tu respuesta (publicada desde aquí)", "Your reply (posted from here)") : t("Tu respuesta", "Your reply")}</span>
          <p className="gbp-text">{answer}</p>
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {!open ? (
            <div className="gbp-actions">
              <button type="button" className="btn ai" onClick={write} disabled={busy || !aiReady} title={aiReady ? undefined : t("Falta la clave de la IA en Vercel.", "The AI key is missing in Vercel.")}>
                {t("Escribir respuesta con IA", "Write reply with AI")}
              </button>
              <button type="button" className="btn link" onClick={() => setOpen(true)} disabled={busy}>
                {t("Escribirla yo", "Write it myself")}
              </button>
            </div>
          ) : (
            <>
              <label className="sr-only" htmlFor={`reply-${review.id}`}>
                {t("Tu respuesta", "Your reply")}
              </label>
              <textarea
                id={`reply-${review.id}`}
                ref={area}
                className="field gbp-reply"
                value={drafting ? t("La IA está escribiendo…", "The AI is writing…") : text}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => void save()}
                disabled={busy}
                maxLength={2000}
                rows={5}
              />
              <div className="gbp-actions">
                <button type="button" className="btn on" onClick={() => void copy()} disabled={busy || text.trim().length < 2}>
                  {copied ? t("¡Copiada!", "Copied!") : t("Copiar", "Copy")}
                </button>
                {link && (
                  <a className="btn outline" href={link} target="_blank" rel="noopener noreferrer" onClick={() => void save()}>
                    {t("Abrir en Google", "Open on Google")}
                  </a>
                )}
                {canPost && (
                  <button type="button" className="btn outline" onClick={post} disabled={busy || text.trim().length < 2}>
                    {posting ? t("Publicando…", "Posting…") : t("Responder en Google", "Reply on Google")}
                  </button>
                )}
                <button type="button" className="btn link" onClick={write} disabled={busy || !aiReady}>
                  {drafting ? t("Escribiendo…", "Writing…") : t("Otra versión con IA", "Another AI version")}
                </button>
              </div>
              {!canPost && (
                <p className="small muted">
                  {t("Copia la respuesta, abre Google, busca esta reseña y pégala en «Responder».", "Copy the reply, open Google, find this review and paste it in “Reply”.")}
                </p>
              )}
            </>
          )}
        </div>
      )}
      {msg && (
        <p className={msg.ok ? "note ok" : "note error"} role="status">
          {msg.text}
        </p>
      )}
    </li>
  );
}

/** Las reseñas con filtros y respuestas escritas por la IA (copiar y pegar en Google, o publicar si hay conexión). */
export function GbpReviews({ businessId, reviews, canPost, aiReady, mapsLink }: Props) {
  const { t } = useT();
  const unanswered = reviews.filter((r) => !r.ownerAnswer.trim());
  const low = reviews.filter((r) => r.rating !== null && r.rating <= 3);
  const [filter, setFilter] = useState<Filter>(unanswered.length ? "unanswered" : "all");
  const [batch, setBatch] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const list = filter === "unanswered" ? unanswered : filter === "low" ? low : reviews;
  const needDraft = unanswered.filter((r) => !r.draft?.trim() && !batch[r.id]).length;

  const writeAll = () =>
    start(async () => {
      setMsg(null);
      const r = await draftAllReplies(businessId);
      setBatch((b) => ({ ...b, ...r.drafts }));
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) setFilter("unanswered");
    });

  const tabs: [Filter, string, number][] = [
    ["unanswered", t("Sin contestar", "Unanswered"), unanswered.length],
    ["low", t("3 estrellas o menos", "3 stars or less"), low.length],
    ["all", t("Todas", "All"), reviews.length],
  ];

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="gbp-filters" role="group" aria-label={t("Filtrar reseñas", "Filter reviews")}>
        {tabs.map(([id, label, n]) => (
          <button key={id} type="button" className={filter === id ? "btn on" : "btn"} aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label} ({n})
          </button>
        ))}
      </div>
      {needDraft > 0 && aiReady && (
        <div className="row">
          <button type="button" className="btn ai" onClick={writeAll} disabled={pending}>
            {pending
              ? t("La IA está escribiendo…", "The AI is writing…")
              : t(`Escribir todas las respuestas (${Math.min(needDraft, DRAFT_BATCH)})`, `Write all replies (${Math.min(needDraft, DRAFT_BATCH)})`)}
          </button>
          <span className="small muted">
            {pending
              ? t("Puede tardar un minuto. No cierres esta página.", "It can take a minute. Don't close this page.")
              : t(`Hasta ${DRAFT_BATCH} por vez, primero las de 3 estrellas o menos. Revísalas antes de publicarlas.`, `Up to ${DRAFT_BATCH} at a time, lowest stars first. Check them before posting.`)}
          </span>
        </div>
      )}
      {msg && (
        <p className={msg.ok ? "note ok" : "note error"} role="status">
          {msg.text}
        </p>
      )}
      {!canPost && unanswered.length > 0 && (
        <p className="small muted">
          {t("Responder directo desde aquí no está disponible: tu Perfil de Negocio no está conectado en ", "Replying directly from here isn't available: your Business Profile isn't connected in ")}
          <Link href={`/b/${businessId}/conexiones`}>{t("Conexiones", "Connections")}</Link>
          {t(
            " (y Google todavía tiene que aprobar el acceso de la app). Mientras tanto, usa «Copiar» y pega la respuesta en Google.",
            " (and Google still has to approve the app's access). Meanwhile, use “Copy” and paste the reply on Google.",
          )}
        </p>
      )}
      {list.length ? (
        <ShowMore hidden={list.length - REVIEWS_SHOWN} more={t(`Ver las ${list.length} reseñas`, `See all ${list.length} reviews`)}>
        <ul className="gbp-reviews">
          {list.map((r, i) => (
            <ReviewCard
              className={capClass(i, REVIEWS_SHOWN)}
              // Cuando "Escribir todas" trae un borrador nuevo, la tarjeta vuelve a empezar con él.
              key={`${r.id}${batch[r.id] ? ":ai" : ""}`}
              businessId={businessId}
              review={r}
              initial={batch[r.id] ?? r.draft ?? ""}
              canPost={canPost}
              aiReady={aiReady}
              mapsLink={mapsLink}
            />
          ))}
        </ul>
        </ShowMore>
      ) : (
        <p className="small muted">
          {filter === "unanswered"
            ? t("¡Todas tus reseñas están contestadas!", "All your reviews are answered!")
            : filter === "low"
              ? t("No tienes reseñas de 3 estrellas o menos entre las más nuevas.", "You have no reviews with 3 stars or less among the newest.")
              : t("No hay reseñas.", "No reviews.")}
        </p>
      )}
    </div>
  );
}
