"use client";

import { useState, useTransition } from "react";
import { draftWebReplies, saveWebReply } from "@/app/actions-seo-web-reviews";
import { useT } from "@/components/I18n";
import type { WebReview } from "@/lib/seo/web-reviews";

const PAGE = 8;

const stars = (n: number | null) => (n === null ? "" : "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n)));

/** Las reseñas de otros sitios, con la respuesta de la IA para copiar y pegar en cada sitio. */
export function WebReviewsList({ businessId, reviews, aiReady }: { businessId: string; reviews: WebReview[]; aiReady: boolean }) {
  const { t, lang } = useT();
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(reviews.filter((r) => r.draft).map((r) => [r.id, r.draft as string])));
  const [copied, setCopied] = useState<Record<string, boolean>>(() => Object.fromEntries(reviews.filter((r) => r.copiedAt).map((r) => [r.id, true])));
  const [filter, setFilter] = useState<"todo" | "all">("todo");
  const [limit, setLimit] = useState(PAGE);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [pending, start] = useTransition();
  const date = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es", { dateStyle: "medium" });
  const list = reviews.filter((r) => filter === "all" || !r.ownerAnswer);
  const todo = reviews.filter((r) => !r.ownerAnswer && !drafts[r.id]).length;

  const write = (id: string) =>
    start(async () => {
      setBusy(id);
      setMsg(null);
      const r = await draftWebReplies(businessId, id);
      if (r.drafts) setDrafts((d) => ({ ...d, ...r.drafts }));
      setMsg({ ok: r.ok, text: r.message });
      setBusy("");
    });

  const copy = (r: WebReview) => {
    const text = drafts[r.id] ?? "";
    // Copiar y abrir la pestaña en el mismo clic (si no, el navegador bloquea la ventana nueva).
    const copying = navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error("no clipboard"));
    if (r.url) window.open(r.url, "_blank", "noopener,noreferrer");
    start(async () => {
      try {
        await copying;
      } catch {
        setMsg({ ok: false, text: t("No se pudo copiar. Selecciona el texto y cópialo a mano.", "Couldn't copy. Select the text and copy it by hand.") });
        return;
      }
      setCopied((c) => ({ ...c, [r.id]: true }));
      await saveWebReply(businessId, r.id, text, true);
    });
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className={`btn${filter === "todo" ? " on" : ""}`} onClick={() => setFilter("todo")}>
          {t("Sin contestar", "Unanswered")} <span className="small muted">({reviews.filter((r) => !r.ownerAnswer).length})</span>
        </button>
        <button type="button" className={`btn${filter === "all" ? " on" : ""}`} onClick={() => setFilter("all")}>
          {t("Todas", "All")} <span className="small muted">({reviews.length})</span>
        </button>
        {aiReady && todo > 0 && (
          <button type="button" className="btn ai" onClick={() => write("")} disabled={pending}>
            {pending && busy === "" ? t("Escribiendo…", "Writing…") : t(`Escribir respuestas con IA (${Math.min(10, todo)})`, `Write replies with AI (${Math.min(10, todo)})`)}
          </button>
        )}
      </div>
      {msg && (
        <p className={msg.ok ? "note ok" : "note error"} role="status">
          {msg.text}
        </p>
      )}
      {list.length === 0 && <p className="small muted">{t("No hay reseñas sin contestar. ¡Bien!", "No unanswered reviews. Nice!")}</p>}
      {list.slice(0, limit).map((r) => (
        <article key={r.id} className="web-review">
          <div className="web-review-head">
            <span className="pill draft">{r.sourceName}</span>
            <strong>{r.name || t("Cliente", "Customer")}</strong>
            <span className="web-review-stars" aria-label={r.rating !== null ? t(`${r.rating} de 5 estrellas`, `${r.rating} out of 5 stars`) : undefined}>
              {stars(r.rating)}
            </span>
            <span className="small muted">{r.timestamp ? date.format(new Date(r.timestamp)) : r.timeAgo}</span>
          </div>
          {r.text ? <p className="small" style={{ margin: 0 }}>{r.text}</p> : <p className="small muted" style={{ margin: 0 }}>{t("(solo estrellas, sin texto)", "(stars only, no text)")}</p>}
          {r.ownerAnswer ? (
            <p className="small web-review-answer">
              <strong>{t("Tu respuesta:", "Your reply:")}</strong> {r.ownerAnswer}
            </p>
          ) : drafts[r.id] !== undefined ? (
            <div className="stack" style={{ gap: 6 }}>
              <textarea
                className="field"
                rows={4}
                value={drafts[r.id]}
                maxLength={2000}
                onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                onBlur={() => void saveWebReply(businessId, r.id, drafts[r.id] ?? "", false)}
                aria-label={t("Respuesta", "Reply")}
              />
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn on" onClick={() => copy(r)} disabled={pending || !(drafts[r.id] ?? "").trim()}>
                  {r.url ? t(`Copiar y abrir en ${r.sourceName}`, `Copy and open on ${r.sourceName}`) : t("Copiar respuesta", "Copy reply")}
                </button>
                {copied[r.id] && <span className="small muted">{t("Copiada ✓ — pégala en el sitio y publícala ahí.", "Copied ✓ — paste it on the site and post it there.")}</span>}
              </div>
            </div>
          ) : aiReady ? (
            <button type="button" className="btn" onClick={() => write(r.id)} disabled={pending} style={{ alignSelf: "flex-start" }}>
              {pending && busy === r.id ? t("Escribiendo…", "Writing…") : t("Escribir respuesta con IA", "Write a reply with AI")}
            </button>
          ) : null}
        </article>
      ))}
      {list.length > limit && (
        <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE)}>
          {t(`Ver más (${list.length - limit})`, `See more (${list.length - limit})`)}
        </button>
      )}
    </div>
  );
}
