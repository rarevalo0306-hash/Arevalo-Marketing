"use client";

import { useEffect, useState, useTransition } from "react";
import { type AccessResult, checkWebFixAccessAction, discardWebFixAction, getWebFixAction, publishWebFixAction, refreshWebFixAction } from "@/app/actions-webfix";
import { useT } from "@/components/I18n";
import { useWebFix } from "@/components/webfix/WebFixContext";
import { WebFixKeyHelp } from "@/components/webfix/WebFixKeyHelp";
import { canPublish, changesByPage, type FixView, isOpen, stepsFor } from "@/lib/webfix-shape";
import styles from "./WebFix.module.css";

/** Cada cuánto se mira el avance: mientras se prepara (solo la base de datos) y mientras se arma la vista previa (GitHub). */
const PREPARING_MS = 4_000;
const BUILDING_MS = 15_000;
const READY_MS = 60_000;

/** El diff pequeño de un cambio, con colores para lo quitado y lo nuevo. */
function Diff({ text }: { text: string }) {
  return (
    <pre className={styles.diff}>
      {text.split("\n").map((l, i) => (
        <span key={i} className={l.startsWith("+ ") ? styles.add : l.startsWith("- ") ? styles.del : undefined}>
          {l}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

/** «Revisar la llave»: solo lectura. Dice qué puede hacer la llave de GitHub y, si le falta un permiso, cómo agregarlo. */
function AccessCheck({ businessId }: { businessId: string }) {
  const { t, lang } = useT();
  const [result, setResult] = useState<AccessResult | null>(null);
  const [pending, start] = useTransition();
  const expires = result?.expires ? new Date(result.expires.replace(" UTC", "Z").replace(" ", "T")) : null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <button type="button" className="btn" disabled={pending} onClick={() => start(async () => setResult(await checkWebFixAccessAction(businessId)))}>
          {pending ? t("Revisando…", "Checking…") : t("Revisar la llave", "Check the key")}
        </button>
        <span className="small muted">{t("Solo mira; no cambia nada en tu web.", "It only looks; it doesn't change anything on your site.")}</span>
      </div>
      {result && (
        <ul className={styles.checks}>
          {result.lines.map((l, i) => (
            <li key={i} className={l.ok ? styles.checkOk : styles.checkBad}>
              <span aria-hidden="true">{l.ok ? "✓" : "✗"}</span> {l.text}
            </li>
          ))}
          {expires && !Number.isNaN(expires.getTime()) && (
            <li className={styles.checkOk}>
              <span aria-hidden="true">📅</span> {t("La llave vence el ", "The key expires on ")}
              {expires.toLocaleDateString(lang === "en" ? "en-US" : "es", { dateStyle: "long" })}.
            </li>
          )}
        </ul>
      )}
      {result?.missingPulls && <WebFixKeyHelp businessId={businessId} fixing open />}
    </div>
  );
}

/**
 * «Arreglos de tu web»: el avance en palabras sencillas, los cambios por página (con el diff si se quiere ver), lo que
 * no se hizo, la vista previa y los botones «Publicar en mi web» y «Descartar». Se actualiza solo.
 */
export function WebFixReview() {
  const { t, lang } = useT();
  const fix = useWebFix();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const job = fix?.job ?? null;
  const businessId = fix?.businessId ?? "";
  const setJob = fix?.setJob;

  // Mientras se prepara: leer lo guardado. Con el PR abierto: preguntar a GitHub (vista previa, conflictos, fuera de Matya).
  const status = job?.status;
  const build = job?.build;
  const mergeable = job?.mergeable;
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId || !setJob || (status !== "preparing" && status !== "open")) return;
    let alive = true;
    const tick = async () => {
      const next: FixView | null = status === "preparing" ? await getWebFixAction(businessId) : await refreshWebFixAction(businessId, jobId);
      if (alive && next && next.id === jobId) setJob(next);
    };
    if (status === "open") void tick();
    const ms = status === "preparing" ? PREPARING_MS : build === "success" && mergeable === true ? READY_MS : BUILDING_MS;
    const timer = setInterval(tick, ms);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [jobId, status, build, mergeable, businessId, setJob]);

  if (!fix?.connected && !job) return null;
  const L = (b: { es: string; en: string }) => b[lang] || b.es;

  const header = (
    <div className="stack" style={{ gap: 4 }}>
      <h2>{t("Arreglos de tu web", "Your website fixes")}</h2>
      <p className="small muted">
        {t(
          "Con «Arréglalo por mí», Matya cambia tu web por ti en una copia aparte. Tú ves cómo queda y lo publicas con un clic. Nada cambia sin tu aprobación.",
          "With “Fix it for me”, Matya changes your website for you in a separate copy. You see how it looks and publish it with one click. Nothing changes without your approval.",
        )}
      </p>
    </div>
  );

  if (!job)
    return (
      <section className="card" id="arreglos">
        {header}
        <p className="small muted">
          {t("Todavía no hay arreglos. Busca el botón «🛠 Arréglalo por mí» junto a las instrucciones para la IA de tu web (por ejemplo, en la ", "No fixes yet. Look for the “🛠 Fix it for me” button next to the instructions for your website's AI (for example, in the ")}
          <a href="#auditoria">{t("auditoría del sitio", "site audit")}</a>).
        </p>
        <AccessCheck businessId={businessId} />
        <WebFixKeyHelp businessId={businessId} />
      </section>
    );

  const steps = stepsFor(job);
  const groups = changesByPage(job.changes);
  const ready = canPublish(job);
  const act = (fn: () => Promise<{ ok: boolean; message: string; job: FixView | null }>) =>
    start(async () => {
      const r = await fn();
      setMessage({ ok: r.ok, text: r.message });
      if (r.job) setJob?.(r.job);
    });
  const fileCount = job.changes.length;

  return (
    <section className="card" id="arreglos" aria-live="polite">
      {header}
      <p className="small muted">
        {job.source.title ? <>{t("Pedido: ", "Request: ")}<strong>{job.source.title}</strong> · </> : null}
        {t("Repositorio: ", "Repository: ")}
        {job.repo} ({job.base})
      </p>

      {(job.status === "preparing" || job.status === "open" || (job.status === "failed" && job.step !== "reading")) && (
        <ul className="magic-steps">
          {steps.map((s) => (
            <li key={s.id} className={s.state === "done" ? "done" : s.state === "now" ? "now" : s.state === "bad" ? styles.badStep : ""}>
              {L(s.label)}
            </li>
          ))}
        </ul>
      )}

      {job.status === "preparing" && (
        <p className="small muted">{t("Suele tardar de 1 a 3 minutos. Puedes seguir usando Matya; esto se actualiza solo.", "It usually takes 1 to 3 minutes. You can keep using Matya; this updates on its own.")}</p>
      )}

      {job.status === "failed" && job.error && (
        <p className="note error" role="alert">
          {L(job.error)}
        </p>
      )}
      {job.missing === "pulls" || job.missing === "contents" ? <WebFixKeyHelp businessId={businessId} fixing open /> : null}
      {job.status === "failed" && <AccessCheck businessId={businessId} />}

      {job.summary.es && job.status !== "preparing" && <p className={styles.summary}>{L(job.summary)}</p>}

      {job.status === "open" && (
        <div className={styles.preview}>
          {job.build === "success" ? (
            <p className="note ok">{t("La vista previa está lista. Mírala antes de publicar.", "The preview is ready. Take a look before publishing.")}</p>
          ) : job.build === "failure" ? (
            <p className="note error">{t("La vista previa falló: estos cambios no se pueden publicar. Descártalos y vuelve a preparar los arreglos.", "The preview failed: these changes can't be published. Discard them and prepare the fixes again.")}</p>
          ) : (
            <p className="small muted">{t("Armando la vista previa de tu web con los cambios (de 1 a 5 minutos)…", "Building a preview of your website with the changes (1 to 5 minutes)…")}</p>
          )}
          {job.build === "success" && job.mergeable === false && (
            <p className="note error">{t("La web cambió o la vista previa falló; vuelve a preparar los arreglos.", "The website changed or the preview failed; prepare the fixes again.")}</p>
          )}
          {(job.missing === "statuses" || job.missing === "checks") && (
            <p className="small muted">{t("Para ver la vista previa, la llave necesita «Commit statuses: Read» y «Checks: Read».", "To see the preview, the key needs “Commit statuses: Read” and “Checks: Read”.")}</p>
          )}
          {job.error && <p className="small muted">{L(job.error)}</p>}
          <div className="row">
            {job.previewUrl && (
              <a className="btn outline" href={job.previewUrl} target="_blank" rel="noopener noreferrer">
                👀 {t("Ver cómo queda", "See how it looks")}
              </a>
            )}
            {!pending ? (
              <>
                <button type="button" className="btn on" disabled={!ready} onClick={() => act(() => publishWebFixAction(businessId, job.id))}>
                  {t("Publicar en mi web", "Publish on my website")}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    if (confirm(t("¿Descartar estos arreglos? Tu web no cambia.", "Discard these fixes? Your website won't change."))) act(() => discardWebFixAction(businessId, job.id));
                  }}
                >
                  {t("Descartar", "Discard")}
                </button>
              </>
            ) : (
              <span className="small muted">{t("Un momento…", "One moment…")}</span>
            )}
          </div>
          {!ready && job.build !== "failure" && <p className="small muted">{t("«Publicar» se activa cuando la vista previa está lista.", "“Publish” turns on when the preview is ready.")}</p>}
        </div>
      )}

      {message && <p className={message.ok ? "note ok" : "note error"} role="status">{message.text}</p>}

      {job.status === "published" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="note ok">
            {job.outside
              ? t("Estos arreglos se publicaron desde GitHub. ", "These fixes were published from GitHub. ")
              : t("¡Publicado! ", "Published! ")}
            {t("Tu web se actualiza en unos minutos.", "Your website updates in a few minutes.")}
          </p>
          <p className="small">
            {t("Cuando ya se vea en tu web, ", "Once it shows on your website, ")}
            <a href="#auditoria">{t("vuelve a revisar tu página", "check your website again")}</a>
            {t(" para ver cuánto mejoró la nota.", " to see how much the score improved.")}
          </p>
        </div>
      )}
      {job.status === "discarded" && <p className="note">{t("Descartaste estos arreglos. Tu web no cambió.", "You discarded these fixes. Your website didn't change.")}</p>}
      {job.status === "closed" && <p className="note">{t("Estos arreglos se cerraron desde GitHub sin publicarse. Tu web no cambió.", "These fixes were closed on GitHub without being published. Your website didn't change.")}</p>}
      {job.status === "nothing" && <p className="note">{t("No se escribió nada en tu web.", "Nothing was written to your website.")}</p>}

      {fileCount > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          <span className="lbl">{t(`Qué cambia (${fileCount} ${fileCount === 1 ? "archivo" : "archivos"})`, `What changes (${fileCount} ${fileCount === 1 ? "file" : "files"})`)}</span>
          {groups.map((g) => (
            <div key={g.page || "site"} className={styles.group}>
              <h3 className={styles.page}>{g.page || t("Todo el sitio", "The whole site")}</h3>
              <ul className={styles.changes}>
                {g.changes.map((c) => (
                  <li key={c.path}>
                    {c.why.length ? c.why.map((w, i) => <p key={i} className={styles.why}>{L(w)}</p>) : <p className={styles.why}>{t("Ajuste para arreglar los avisos.", "Adjustment to fix the warnings.")}</p>}
                    <details className={styles.diffBox}>
                      <summary>{t("Ver el cambio exacto", "See the exact change")}</summary>
                      <p className={styles.path}>{c.path}{c.created ? t(" (archivo nuevo)", " (new file)") : ""}</p>
                      <Diff text={c.diff} />
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {job.skipped.length > 0 && (
        <details className={styles.help}>
          <summary>{t(`Lo que no se cambió (${job.skipped.length})`, `What wasn't changed (${job.skipped.length})`)}</summary>
          <ul className={styles.skipped}>
            {job.skipped.map((s, i) => (
              <li key={i}>
                <strong>{s.issue}</strong>: {L(s.reason)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {job.dropped.length > 0 && (
        <details className={styles.help}>
          <summary>{t(`Descartado por la revisión de seguridad (${job.dropped.length})`, `Dropped by the safety check (${job.dropped.length})`)}</summary>
          <ul className={styles.skipped}>
            {job.dropped.map((d, i) => (
              <li key={i}>
                <span className={styles.path}>{d.path}</span> {L(d.reason)}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="small muted">
        {job.costCents > 0 && t(`Costo de la IA: ${job.costCents} ${job.costCents === 1 ? "centavo" : "centavos"} de dólar (estimado). `, `AI cost: ${job.costCents} US ${job.costCents === 1 ? "cent" : "cents"} (estimated). `)}
        {job.prUrl && (
          <a href={job.prUrl} target="_blank" rel="noopener noreferrer">
            {t("Ver en GitHub", "See on GitHub")}
          </a>
        )}
      </p>
      {!isOpen(job, new Date()) && job.status !== "published" && (
        <p className="small muted">{t("Para intentarlo otra vez, usa «Arréglalo por mí» en cualquier lista de instrucciones.", "To try again, use “Fix it for me” on any list of instructions.")}</p>
      )}
    </section>
  );
}
