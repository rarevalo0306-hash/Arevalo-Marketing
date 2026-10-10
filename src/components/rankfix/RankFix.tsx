"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { authorizeRankFixAction, closeRankFixAction, pollRankFixAction, publishRankFixAction, removeRankFixItemAction, stockPhotoRankFixAction } from "@/app/actions-rankfix";
import { useT } from "@/components/I18n";
import { useWebFix } from "@/components/webfix/WebFixContext";
import type { PlanData } from "@/lib/rankfix";
import { hasWorkToPublish, jobPhase, MAX_NEW_ARTICLES, planTotals, progress, usd, type Bi, type JobItem, type PlanRow, type RankFixView } from "@/lib/rankfix-shape";
import { canPublish, type FixView } from "@/lib/webfix-shape";
import styles from "./RankFix.module.css";

type Props = {
  businessId: string;
  plan: PlanData | null;
  initialJob: RankFixView | null;
  initialFix: FixView | null;
  /** El panel de revisión de los arreglos de la web («Tu página web»). */
  fixHref: string;
};

type Tr = (es: string, en: string) => string;

const PREPARING_MS = 5_000;
const WAITING_MS = 15_000;

const writerHref = (businessId: string, articleId: string) => `/b/${businessId}/seo/escribir?a=${encodeURIComponent(articleId)}`;

/** «No sales (top 20)» / «15° en Google», y el mapa si sale entre los 3. */
function where(position: number | null, map: number | null, t: Tr): string {
  const organic = position === null ? t("No sales (top 20)", "Not in top 20") : t(`${position}° en Google`, `#${position} on Google`);
  return map !== null && map >= 1 && map <= 3 ? `${organic} · 📍 ${t(`${map}° en el mapa`, `#${map} on the map`)}` : organic;
}

const ACTION: Record<PlanRow["action"], { icon: string; es: string; en: string }> = {
  improve: { icon: "🛠", es: "Mejorar una página que ya existe", en: "Improve a page you already have" },
  write: { icon: "✍️", es: "Escribir un artículo nuevo", en: "Write a new article" },
  onway: { icon: "⏳", es: "Ya está en camino", en: "Already on its way" },
  wait: { icon: "✋", es: "Mejorar una página (en espera)", en: "Improve a page (on hold)" },
};

/**
 * «✨ Que la IA mejore mis posiciones»: el plan gratis (qué hará con cada búsqueda y cuánto cuesta), un clic para
 * autorizar el gasto de PREPARAR, el avance mientras trabaja, la revisión y un clic final: «Publicar todo».
 */
export function RankFix({ businessId, plan, initialJob, initialFix, fixHref }: Props) {
  const { t, lang } = useT();
  const L = (b: Bi | null | undefined) => (b ? (lang === "en" ? b.en || b.es : b.es) : "");
  const router = useRouter();
  const ctx = useWebFix();
  const [job, setJob] = useState<RankFixView | null>(initialJob);
  const [localFix, setFix] = useState<FixView | null>(initialFix);
  const [showPlan, setShowPlan] = useState(false);
  const [keys, setKeys] = useState<string[]>(plan?.defaults ?? []);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState("");

  // El arreglo de la web: el panel «Tu página web» lo mantiene al día (lo comparte por el contexto); si no, lo nuestro.
  const fix = ctx?.job && localFix && ctx.job.id === localFix.id && ctx.job.updatedAt >= localFix.updatedAt ? ctx.job : localFix;
  const jobId = job?.id;
  const status = job?.status;
  const fixWaiting = Boolean(job?.items.some((x) => x.state === "fix")) && (fix?.status === "preparing" || fix?.status === "open");
  useEffect(() => {
    if (!jobId || (status !== "preparing" && !fixWaiting)) return;
    let alive = true;
    const tick = async () => {
      const r = await pollRankFixAction(businessId, jobId);
      if (!alive) return;
      if (r.job) setJob(r.job);
      if (r.fix) setFix(r.fix);
    };
    const timer = setInterval(tick, status === "preparing" ? PREPARING_MS : WAITING_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [businessId, jobId, status, fixWaiting]);

  const totals = useMemo(() => (plan ? planTotals(plan.rows, keys, plan.prices, plan.improveChars) : null), [plan, keys]);

  // ---------- Sin ronda abierta: el botón y el plan ----------
  const phase = job ? jobPhase(job) : null;
  if (!job || (phase === "done" && showPlan)) {
    if (!plan || !totals) return null;
    const rows = plan.rows;
    const writesOn = rows.filter((r) => r.action === "write" && keys.includes(r.key)).length;
    const toggle = (key: string) => setKeys((k) => (k.includes(key) ? k.filter((x) => x !== key) : [...k, key]));
    const authorize = () =>
      start(async () => {
        const r = await authorizeRankFixAction(businessId, keys, totals.totalCents);
        setMessage({ ok: r.ok, text: r.message });
        if (r.job) {
          setJob(r.job);
          setShowPlan(false);
        }
        if (r.fix) {
          setFix(r.fix);
          ctx?.setJob(r.fix);
        }
        // Si algo cambió (otra ronda, otro costo), se vuelve a leer lo último.
        if (!r.ok) router.refresh();
      });
    const p = plan.prices;
    const nothing = totals.totalCents <= 0 && totals.articles + totals.improves === 0;

    if (!showPlan)
      return (
        <div id="ia-posiciones" className={styles.box}>
          <div className={styles.top}>
            <button type="button" className="btn ai" onClick={() => setShowPlan(true)}>
              ✨ {t("Que la IA mejore mis posiciones", "Let the AI improve my rankings")}
            </button>
            <span className={styles.hint}>
              {t(
                "La IA mira cada búsqueda donde no sales o sales lejos y te dice qué va a hacer y cuánto cuesta. Ver el plan es gratis.",
                "The AI looks at each search where you don't show up or rank far down, and tells you what it will do and what it costs. Seeing the plan is free.",
              )}
            </span>
          </div>
          {phase === "done" && <p className="small muted">{t("Tu ronda anterior ya se publicó.", "Your previous round was already published.")}</p>}
        </div>
      );

    return (
      <div id="ia-posiciones" className={styles.box} role="group" aria-label={t("El plan de la IA", "The AI's plan")}>
        <div className="stack" style={{ gap: 4 }}>
          <h3 className={styles.title}>✨ {t("El plan de la IA", "The AI's plan")}</h3>
          <p className="small muted">
            {t(
              "Ver el plan es gratis: todavía no se gasta nada. Quita la marca de lo que no quieras.",
              "Seeing the plan is free: nothing is spent yet. Untick anything you don't want.",
            )}
          </p>
        </div>
        <ul className={styles.list}>
          {rows.map((r) => {
            const can = r.action === "write" || r.action === "improve";
            const on = keys.includes(r.key);
            const capped = r.action === "write" && !on && writesOn >= MAX_NEW_ARTICLES;
            const a = ACTION[r.action];
            const cents = on ? totals.perRow[r.key] ?? 0 : 0;
            return (
              <li key={r.key} className={`${styles.row} ${!can || !on ? styles.off : ""}`}>
                <span className={styles.pick}>
                  {can ? (
                    <input type="checkbox" checked={on} disabled={capped || pending} onChange={() => toggle(r.key)} aria-label={t(`Incluir «${r.keyword}»`, `Include “${r.keyword}”`)} />
                  ) : (
                    <span aria-hidden="true" className={styles.dash}>–</span>
                  )}
                </span>
                <div className={styles.body}>
                  <div className={styles.head}>
                    <strong className={styles.kw}>{r.keyword}</strong>
                    <span className="pill neutral plain">{where(r.position, r.mapPosition, t)}</span>
                  </div>
                  <span className={styles.what}>
                    <span aria-hidden="true">{a.icon}</span> {lang === "en" ? a.en : a.es}
                    {capped && <span className={styles.later}> · {t("para la próxima vez", "for next time")}</span>}
                  </span>
                  <span className={styles.why}>
                    {L(r.why)}
                    {r.href && (
                      <>
                        {" "}
                        <a href={r.href} target={r.href.startsWith("http") ? "_blank" : undefined} rel={r.href.startsWith("http") ? "noopener noreferrer" : undefined}>
                          {r.action === "wait" || (r.action === "onway" && r.href.includes("#arreglos")) ? t("Ver los arreglos", "See the fixes") : r.href.startsWith("http") ? t("Ver en tu web", "See it on your site") : t("Ver el artículo", "See the article")}
                        </a>
                      </>
                    )}
                    {r.action === "improve" && r.targetUrl && <span className={styles.url}>{r.targetUrl.replace(/^https?:\/\/(www\.)?/, "")}</span>}
                  </span>
                </div>
                <span className={styles.cost}>
                  {!can ? t("Sin costo", "No cost") : on ? (r.action === "improve" ? `≈ ${usd(cents)}` : `${t("hasta", "up to")} ${usd(cents)}`) : "—"}
                </span>
              </li>
            );
          })}
        </ul>

        <div className={styles.totals}>
          {totals.articles > 0 && (
            <div className={styles.line}>
              <span>
                {t(
                  `${totals.articles} ${totals.articles === 1 ? "artículo nuevo" : "artículos nuevos"}: búsqueda en Google (${usd(p.serpCents)}), escritura con IA (hasta ${usd(p.writeCents)}) y traducción (~${usd(p.textCents)}) cada uno`,
                  `${totals.articles} new ${totals.articles === 1 ? "article" : "articles"}: Google search (${usd(p.serpCents)}), AI writing (up to ${usd(p.writeCents)}) and translation (~${usd(p.textCents)}) each`,
                )}
              </span>
              <strong>{usd(totals.articleCents)}</strong>
            </div>
          )}
          {totals.photos > 0 && (
            <div className={styles.line}>
              <span>
                {t(
                  `Hasta ${totals.photos} ${totals.photos === 1 ? "foto" : "fotos"} con IA (${usd(p.imageCents)} c/u), solo donde ninguna foto de tu biblioteca va con el tema`,
                  `Up to ${totals.photos} AI ${totals.photos === 1 ? "photo" : "photos"} (${usd(p.imageCents)} each), only where no photo in your library fits the topic`,
                )}
              </span>
              <strong>{usd(totals.photoCents)}</strong>
            </div>
          )}
          {totals.improves > 0 && (
            <div className={styles.line}>
              <span>
                {t(
                  `Mejorar ${totals.improves} ${totals.improves === 1 ? "página" : "páginas"}, todo en un solo arreglo de tu web`,
                  `Improve ${totals.improves} ${totals.improves === 1 ? "page" : "pages"}, all in one website fix`,
                )}
              </span>
              <strong>{usd(totals.fixCents)}</strong>
            </div>
          )}
          <div className={`${styles.line} ${styles.total}`}>
            <span>{t("Total", "Total")}</span>
            <strong>
              {t("hasta", "up to")} {usd(totals.totalCents)}
            </strong>
          </div>
          {totals.left > 0 && (
            <p className={styles.left}>
              {t(`Quedan ${totals.left} ${totals.left === 1 ? "búsqueda" : "búsquedas"} sin marcar: quedan para la próxima vez.`, `${totals.left} ${totals.left === 1 ? "search is" : "searches are"} unticked: left for next time.`)}
            </p>
          )}
        </div>

        <p className={styles.promise}>
          {t(
            "Autorizar solo aprueba este gasto para PREPARAR todo. Nada se publica hasta que lo revises y presiones «Publicar todo».",
            "Approving only covers the cost to PREPARE everything. Nothing is published until you review it and press “Publish all”.",
          )}
        </p>
        {!pending ? (
          <div className="row">
            <button type="button" className="btn on" disabled={nothing} onClick={authorize}>
              {t(`Autorizar · hasta ${usd(totals.totalCents)}`, `Approve · up to ${usd(totals.totalCents)}`)}
            </button>
            <button type="button" className="btn" onClick={() => setShowPlan(false)}>
              {t("Cancelar", "Cancel")}
            </button>
            {nothing && <span className="small muted">{t("No hay nada nuevo que hacer ahora.", "There's nothing new to do right now.")}</span>}
          </div>
        ) : (
          <p className="small muted" aria-live="polite">{t("Empezando…", "Starting…")}</p>
        )}
        {message && !message.ok && (
          <p className="note error" role="status">
            {message.text}
          </p>
        )}
      </div>
    );
  }

  // ---------- La ronda: avance, revisión, publicar ----------
  const prog = progress(job);
  const writes = job.items.filter((x) => x.action === "write");
  const current = job.status === "preparing" ? writes.find((x) => x.state === "queued") : undefined;
  const canPublishAll = (phase === "ready" || phase === "stopped" || phase === "partial") && hasWorkToPublish(job);
  const publishing = job.status === "publishing" || busy === "publish";

  const act = (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    start(async () => {
      await fn();
      setBusy("");
    });
  };
  const publishAll = () =>
    act("publish", async () => {
      const r = await publishRankFixAction(businessId, job.id);
      setMessage({ ok: r.ok, text: r.message });
      if (r.job) setJob(r.job);
      if (r.fix) {
        setFix(r.fix);
        ctx?.setJob(r.fix);
      }
    });
  const remove = (key: string) =>
    act(`remove:${key}`, async () => {
      const next = await removeRankFixItemAction(businessId, job.id, key);
      if (next) setJob(next);
    });
  const stock = (key: string) =>
    act(`stock:${key}`, async () => {
      const r = await stockPhotoRankFixAction(businessId, job.id, key);
      if (r.job) setJob(r.job);
      if (!r.ok) setMessage({ ok: false, text: r.message });
    });
  const close = () =>
    act("close", async () => {
      if (await closeRankFixAction(businessId, job.id)) router.refresh();
    });

  const postHref = (x: JobItem) => {
    const idea = t(
      `Escribe una publicación para promocionar el artículo "${x.title}" que ya está en mi página: ${x.url}\n\n${x.social}`,
      `Write a post promoting the article "${x.title}" that is now on my website: ${x.url}\n\n${x.social}`,
    ).slice(0, 2000);
    return `/b/${businessId}/publicar?${new URLSearchParams({ idea, magic: "1" })}`;
  };

  return (
    <div id="ia-posiciones" className={styles.box} aria-live="polite">
      <div className="stack" style={{ gap: 4 }}>
        <h3 className={styles.title}>
          ✨{" "}
          {phase === "preparing"
            ? job.status === "publishing"
              ? t("Publicando…", "Publishing…")
              : t("La IA está preparando todo", "The AI is preparing everything")
            : phase === "done"
              ? t("Listo: tus mejoras ya están en tu web", "Done: your improvements are on your website")
              : phase === "partial"
                ? t("Publicado en parte", "Partly published")
                : t("Todo listo para que lo revises", "Everything is ready for your review")}
        </h3>
        <p className="small muted">
          {phase === "preparing" && job.status === "preparing"
            ? t(
                `${prog.ready} de ${prog.total} ${prog.total === 1 ? "artículo listo" : "artículos listos"}. Cada artículo tarda unos minutos; si sales de esta página, sigue donde quedó cuando vuelvas. Nada se publica sin ti.`,
                `${prog.ready} of ${prog.total} ${prog.total === 1 ? "article" : "articles"} ready. Each article takes a few minutes; if you leave this page, it picks up where it left off when you come back. Nothing is published without you.`,
              )
            : phase === "done"
              ? t("Lo que preparó la IA, búsqueda por búsqueda:", "What the AI prepared, search by search:")
              : t("Revisa lo que preparó la IA. Puedes quitar un artículo si no te gusta.", "Check what the AI prepared. You can remove an article if you don't like it.")}{" "}
          {t(`Gastado: ${usd(job.spentCents)} de ${usd(job.authorizedCents)} autorizados.`, `Spent: ${usd(job.spentCents)} of ${usd(job.authorizedCents)} approved.`)}
        </p>
      </div>
      {job.stop && phase !== "done" && <p className="note">{L(job.stop)}</p>}

      <ul className={styles.list}>
        {job.items.map((x) => (
          <Item
            key={x.key}
            x={x}
            fix={fix}
            fixHref={fixHref}
            businessId={businessId}
            current={current?.key === x.key}
            L={L}
            t={t}
            busy={busy}
            canEdit={!publishing && job.status !== "done"}
            onRemove={() => remove(x.key)}
            onStock={() => stock(x.key)}
          />
        ))}
      </ul>

      {message && (
        <p className={message.ok ? "note ok" : "note error"} role="status">
          {message.text}
        </p>
      )}

      {phase === "done" && (
        <div className="stack" style={{ gap: 10 }}>
          {!message && <p className="note ok">{t("Listo. Google tarda unos días en notarlo; vuelve a revisar tus posiciones en 1–2 semanas.", "Done. Google takes a few days to notice; check your rankings again in 1–2 weeks.")}</p>}
          {writes.filter((x) => x.state === "published" && x.url).length > 0 && (
            <div className={styles.posts}>
              <span className="small muted">{t("Avisa en tus redes que tus artículos ya están en tu web:", "Tell your followers your articles are on your website:")}</span>
              {writes
                .filter((x) => x.state === "published" && x.url)
                .map((x) => (
                  <Link key={x.key} href={postHref(x)} className="btn on">
                    {t("Hacer un post", "Make a post")}: {x.title.length > 40 ? `${x.title.slice(0, 40)}…` : x.title}
                  </Link>
                ))}
            </div>
          )}
          {plan && plan.rows.some((r) => r.action === "write" || r.action === "improve") && (
            <div className="row">
              <button type="button" className="btn" onClick={() => setShowPlan(true)}>
                ✨ {t("Preparar otra ronda", "Prepare another round")}
              </button>
            </div>
          )}
        </div>
      )}

      {phase !== "done" && job.fix.note && job.fix.outcome === "waiting" && (
        <p className="note info">
          {L(job.fix.note)} <a href={fixHref}>{t("Ver los cambios", "See the changes")}</a>
        </p>
      )}

      {phase === "partial" && writes.some((x) => x.state === "published" && x.url) && (
        <div className={styles.posts}>
          {writes
            .filter((x) => x.state === "published" && x.url)
            .map((x) => (
              <Link key={x.key} href={postHref(x)} className="btn">
                {t("Hacer un post", "Make a post")}: {x.title.length > 40 ? `${x.title.slice(0, 40)}…` : x.title}
              </Link>
            ))}
        </div>
      )}

      {(phase === "ready" || phase === "stopped" || phase === "partial" || job.status === "publishing") && (
        <div className="stack" style={{ gap: 8 }}>
          {publishing ? (
            <p className="small muted" aria-live="polite">{t("Publicando uno por uno… no cierres esta página.", "Publishing one by one… don't close this page.")}</p>
          ) : (
            <>
              <div className="row">
                <button type="button" className="btn on" disabled={!canPublishAll || pending} onClick={publishAll}>
                  🚀 {phase === "partial" ? t("Publicar lo que falta", "Publish what's left") : t("Publicar todo", "Publish all")}
                </button>
                <button type="button" className="btn link" disabled={pending} onClick={close}>
                  {t("Cerrar esta lista", "Close this list")}
                </button>
              </div>
              <span className="small muted">
                {t(
                  "«Publicar todo» sube los artículos listos a tu web y publica las mejoras de tus páginas si su vista previa salió bien. Publicar no cuesta nada. Si cierras la lista, los artículos quedan guardados en «Escribir artículo».",
                  "“Publish all” puts the ready articles on your website and publishes your page improvements if their preview went well. Publishing costs nothing. If you close the list, the articles stay saved in “Write article”.",
                )}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

type ItemProps = {
  x: JobItem;
  fix: FixView | null;
  fixHref: string;
  businessId: string;
  current: boolean;
  L: (b: Bi | null | undefined) => string;
  t: Tr;
  busy: string;
  canEdit: boolean;
  onRemove: () => void;
  onStock: () => void;
};

/** Una búsqueda de la ronda con su resultado en palabras sencillas. */
function Item({ x, fix, fixHref, businessId, current, L, t, busy, canEdit, onRemove, onStock }: ItemProps) {
  let pill = "neutral";
  let label = "";
  let note = "";
  const links: { href: string; text: string; external?: boolean }[] = [];
  if (x.action === "write") {
    const STEP = { write: t("Escribiendo el artículo…", "Writing the article…"), site: t("Preparando la versión para tu web…", "Preparing the version for your website…"), photo: t("Eligiendo la foto…", "Choosing the photo…"), done: "" };
    if (x.state === "queued") [pill, label] = current ? ["info", STEP[x.next]] : ["neutral", t("En cola", "Queued")];
    else if (x.state === "ready") [pill, label] = ["done", t("Artículo listo", "Article ready")];
    else if (x.state === "published") [pill, label] = ["done", t("Publicado en tu web", "Published on your website")];
    else if (x.state === "removed") [pill, label] = ["neutral", t("Quitado (no se publica)", "Removed (won't be published)")];
    else if (x.state === "stopped") [pill, label] = ["partial", t("En pausa", "Paused")];
    else if (x.state === "publish_failed") [pill, label] = ["failed", t("No se pudo publicar", "Couldn't publish")];
    else [pill, label] = ["failed", t("No se pudo preparar", "Couldn't prepare it")];
    note = x.state === "failed" || x.state === "stopped" || x.state === "publish_failed" ? L(x.error) : "";
    if (x.articleId && x.state !== "queued") links.push({ href: writerHref(businessId, x.articleId), text: t("Ver el artículo completo", "See the full article") });
    if (x.url) links.push({ href: x.url, text: t("Verlo en tu web", "See it on your website"), external: true });
  } else {
    if (x.state === "published") [pill, label] = ["done", t("Página mejorada y publicada", "Page improved and published")];
    else if (x.state === "fix_blocked") [pill, label] = ["partial", t("Primero revisa los arreglos que ya están esperando", "First review the fixes that are already waiting")];
    else if (x.state === "fix_failed") {
      [pill, label] = ["failed", t("No se pudo mejorar", "Couldn't improve it")];
      note = L(x.error);
    } else if (!fix || fix.status === "preparing") [pill, label] = ["info", t("Preparando las mejoras de la página…", "Preparing the page improvements…")];
    else if (fix.status === "open") {
      const ok = canPublish(fix);
      [pill, label] = ok ? ["done", t("Página mejorada · lista para publicar", "Page improved · ready to publish")] : fix.build === "failure" ? ["failed", t("Página mejorada · la vista previa falló", "Page improved · the preview failed")] : ["info", t("Página mejorada · armando la vista previa", "Page improved · building the preview")];
      if (fix.previewUrl) links.push({ href: fix.previewUrl, text: t("Ver cómo queda", "See how it looks"), external: true });
    } else if (fix.status === "published") [pill, label] = ["done", t("Página mejorada y publicada", "Page improved and published")];
    else {
      [pill, label] = ["failed", t("No se pudo mejorar", "Couldn't improve it")];
      note = L(fix.error) || L(fix.summary);
    }
    links.push({ href: fixHref, text: x.state === "fix_blocked" ? t("Ver los arreglos", "See the fixes") : t("Ver los cambios", "See the changes") });
  }
  const ready = x.action === "write" && x.state === "ready";
  return (
    <li className={`${styles.row} ${styles.rowJob}`}>
      {x.action === "write" &&
        (x.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.thumb} src={x.thumb} alt="" loading="lazy" />
        ) : (
          <span className={styles.thumbEmpty} aria-hidden="true">{x.state === "queued" ? "⏳" : "📝"}</span>
        ))}
      {x.action === "improve" && <span className={styles.thumbEmpty} aria-hidden="true">🛠</span>}
      <div className={styles.body}>
        <div className={styles.head}>
          <strong className={styles.kw}>{x.keyword}</strong>
          <span className="pill neutral plain">{where(x.position, null, t)}</span>
        </div>
        <span className={styles.what}>
          <span className={`pill ${pill}`}>{label}</span>
        </span>
        {x.title && x.action === "write" && <span className={styles.articleTitle}>{x.title}</span>}
        {x.action === "improve" && x.targetUrl && <span className={styles.url}>{x.targetUrl.replace(/^https?:\/\/(www\.)?/, "")}</span>}
        {note && <span className={styles.why}>{note}</span>}
        {(links.length > 0 || (canEdit && (ready || x.state === "stopped" || x.state === "failed" || x.state === "publish_failed"))) && (
          <span className={styles.links}>
            {links.map((l) =>
              l.external ? (
                <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">
                  {l.text} ↗
                </a>
              ) : (
                <Link key={l.href} href={l.href}>
                  {l.text}
                </Link>
              ),
            )}
            {canEdit && x.state === "stopped" && x.next === "photo" && (
              <button type="button" className="btn link" disabled={Boolean(busy)} onClick={onStock}>
                {busy === `stock:${x.key}` ? t("Cambiando…", "Changing…") : t("Usar la foto de tu web (gratis)", "Use your website's photo (free)")}
              </button>
            )}
            {canEdit && x.action === "write" && ["ready", "stopped", "failed", "publish_failed"].includes(x.state) && (
              <button type="button" className={`btn link ${styles.remove}`} disabled={Boolean(busy)} onClick={onRemove}>
                {busy === `remove:${x.key}` ? t("Quitando…", "Removing…") : t("Quitar", "Remove")}
              </button>
            )}
          </span>
        )}
      </div>
    </li>
  );
}
