"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { refreshPlanAction, setTaskStatus, type TaskStatusResult } from "@/app/actions-plan";
import { useT } from "@/components/I18n";
import { AREA_LABEL, TASK_AREAS, type TaskArea } from "@/lib/action-plan-shape";
import type { PlanTask } from "@/lib/action-plan";
import s from "./Plan.module.css";

type Status = PlanTask["status"];
type Filter = "open" | "urgent" | "done" | "dismissed" | `area:${TaskArea}`;

/** Cuántas tareas abiertas se ven antes de «Ver más». */
const FIRST = 8;
const WEEK = 7 * 24 * 3600 * 1000;
const WEEKS = 8;

const IMPACT = {
  3: { pill: "bad", es: "Urgente", en: "Urgent" },
  2: { pill: "warn", es: "Importante", en: "Important" },
  1: { pill: "info", es: "Mejora", en: "Nice to have" },
} as const;
const EFFORT = {
  1: { es: "Fácil", en: "Easy" },
  2: { es: "Media", en: "Medium" },
  3: { es: "Difícil", en: "Hard" },
} as const;

function Chevron() {
  return (
    <svg className={s.chev} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M7.5 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** El detalle: párrafos separados por una línea en blanco; el último dice de qué reporte salió. */
function Detail({ text }: { text: string }) {
  const parts = text.split(/\n{2,}/).filter(Boolean);
  return (
    <div className={s.detail}>
      {parts.map((p, i) => (
        <p key={i} className={i === parts.length - 1 && parts.length > 1 ? s.source : undefined}>
          {p}
        </p>
      ))}
    </div>
  );
}

type Props = {
  businessId: string;
  tasks: PlanTask[];
  /** «6 oct 2026, 2:35 a.m.»: cuándo se armó el plan. */
  updated: string | null;
  /** Fecha corta de cada tarea hecha (por id), en la hora del negocio. */
  doneLabels: Record<string, string>;
};

/** El plan: resumen, avance, filtros y la lista de tareas con «✓ Hecha», «No aplica» y «Deshacer». */
export function PlanBoard({ businessId, tasks, updated, doneLabels }: Props) {
  const { t, lang } = useT();
  const L = (b: { es: string; en: string }) => (lang === "en" ? b.en : b.es);
  const [overrides, setOverrides] = useState<Record<string, { status: Status; doneAt: string | null }>>({});
  const [filter, setFilter] = useState<Filter>("open");
  const [showAll, setShowAll] = useState(false);
  const [result, run, pending] = useActionState<TaskStatusResult, FormData>(setTaskStatus.bind(null, businessId), null);
  const [refresh, runRefresh, refreshing] = useActionState(refreshPlanAction.bind(null, businessId), null);
  const [toast, setToast] = useState<NonNullable<TaskStatusResult> | null>(null);

  // Lo que llega del servidor ya trae los cambios: se olvidan los cambios optimistas.
  useEffect(() => setOverrides({}), [tasks]);
  useEffect(() => {
    if (!result) return;
    if (!result.ok) {
      setOverrides({});
      setToast(result);
      return;
    }
    setToast(result);
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [result]);

  const list = useMemo(() => tasks.map((x) => ({ ...x, ...(overrides[x.id] ?? {}) })), [tasks, overrides]);
  const open = list.filter((x) => x.status === "todo");
  const done = list.filter((x) => x.status === "done");
  const dismissed = list.filter((x) => x.status === "dismissed");
  const urgent = open.filter((x) => x.impact === 3);
  // «Esta semana» se cuenta desde que se abrió la página.
  const [now] = useState(() => Date.now());
  const doneWeek = done.filter((x) => x.doneAt && now - Date.parse(x.doneAt) < WEEK).length;
  const weeks = Array.from({ length: WEEKS }, (_, i) => done.filter((x) => x.doneAt && Math.max(0, Math.floor((now - Date.parse(x.doneAt)) / WEEK)) === WEEKS - 1 - i).length);
  const maxWeek = Math.max(1, ...weeks);
  const total = open.length + done.length;
  const pct = total ? Math.round((done.length / total) * 100) : 0;

  const areas = TASK_AREAS.filter((a) => open.some((x) => x.area === a));
  const shown =
    filter === "open"
      ? open
      : filter === "urgent"
        ? urgent
        : filter === "done"
          ? [...done].sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""))
          : filter === "dismissed"
            ? dismissed
            : open.filter((x) => `area:${x.area}` === filter);
  const visible = showAll || filter === "done" || filter === "dismissed" ? shown : shown.slice(0, FIRST);

  const act = (f: FormData) => {
    const id = String(f.get("id"));
    const status = String(f.get("status")) as Status;
    setOverrides((o) => ({ ...o, [id]: { status, doneAt: status === "done" ? String(f.get("doneAt") || new Date().toISOString()) : null } }));
    run(f);
  };

  const chips: { id: Filter; label: string; n: number }[] = [
    { id: "open", label: t("Por hacer", "To do"), n: open.length },
    { id: "urgent", label: t("Urgentes", "Urgent"), n: urgent.length },
    ...areas.map((a) => ({ id: `area:${a}` as Filter, label: L(AREA_LABEL[a]), n: open.filter((x) => x.area === a).length })),
    { id: "done", label: t("Hechas", "Done"), n: done.length },
    { id: "dismissed", label: t("Descartadas", "Dismissed"), n: dismissed.length },
  ];
  const toastTask = toast?.id ? list.find((x) => x.id === toast.id) : null;

  return (
    <>
      <div className={s.head}>
        <div>
          <h2>{t("Tu plan de acción", "Your action plan")}</h2>
          <p className={s.summary}>
            <b>{open.length === 1 ? t("1 tarea", "1 task") : t(`${open.length} tareas`, `${open.length} tasks`)}</b>
            {" · "}
            {urgent.length === 1 ? t("1 urgente", "1 urgent") : t(`${urgent.length} urgentes`, `${urgent.length} urgent`)}
            {" · "}
            {doneWeek === 1 ? t("1 hecha esta semana", "1 done this week") : t(`${doneWeek} hechas esta semana`, `${doneWeek} done this week`)}
          </p>
        </div>
        <form action={runRefresh} className={s.refresh}>
          <button type="submit" className="btn" disabled={refreshing}>
            {refreshing ? t("Actualizando…", "Updating…") : t("Actualizar plan", "Update plan")}
          </button>
          <span className={s.updated} aria-live="polite">
            {refresh?.message ?? (updated ? t(`Armado el ${updated} · gratis`, `Built ${updated} · free`) : t("Gratis: solo usa tus reportes guardados", "Free: it only uses your saved reports"))}
          </span>
        </form>
      </div>

      {total > 0 && (
        <div className={s.progress}>
          <div className={s.barWrap}>
            <span className={s.barLabel}>
              <b>{t(`${done.length} de ${total}`, `${done.length} of ${total}`)}</b> {t(`tareas hechas (${pct} %)`, `tasks done (${pct}%)`)}
            </span>
            <div className={s.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("Avance del plan", "Plan progress")}>
              <div className={s.barFill} style={{ width: `${pct}%` }} />
            </div>
          </div>
          {done.length > 0 && (
            <div className={s.weeks} title={t("Tareas hechas por semana (las últimas 8)", "Tasks done per week (last 8)")}>
              <div className={s.weeksBars} aria-hidden="true">
                {weeks.map((n, i) => (
                  <span key={i} className={n ? undefined : s.zero} style={{ height: `${n ? Math.max(15, (n / maxWeek) * 100) : 7}%` }} />
                ))}
              </div>
              <span className={s.weeksLabel}>{t("Hechas por semana", "Done per week")}</span>
            </div>
          )}
        </div>
      )}

      <div className={s.filters} role="group" aria-label={t("Filtrar tareas", "Filter tasks")}>
        {chips
          .filter((c) => c.n > 0 || c.id === "open")
          .map((c) => (
            <button key={c.id} type="button" className={s.filter} aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}>
              {c.label} <span className={s.count}>{c.n}</span>
            </button>
          ))}
      </div>

      {shown.length === 0 ? (
        <p className={s.allDone}>
          {filter === "open" || filter === "urgent"
            ? t("¡Todo al día! No tienes tareas pendientes aquí.", "All caught up! No pending tasks here.")
            : t("No hay tareas aquí.", "No tasks here.")}
        </p>
      ) : (
        <ul className={s.list}>
          {visible.map((x) => {
            const closed = x.status !== "todo";
            return (
              <li key={x.id} className={`${s.task} ${x.impact === 3 && !closed ? s.urgent : ""} ${closed ? s.closed : ""}`}>
                <div className={s.main}>
                  <div className={s.meta}>
                    <span className={`pill ${IMPACT[x.impact].pill}`}>{L(IMPACT[x.impact])}</span>
                    <span>{L(EFFORT[x.effort])}</span>
                    <span className={s.area}>{L(AREA_LABEL[x.area] ?? AREA_LABEL.web)}</span>
                  </div>
                  <details className={s.fold}>
                    <summary>
                      <Chevron />
                      <span className={s.title}>{x.title}</span>
                    </summary>
                    {x.detail && <Detail text={x.detail} />}
                  </details>
                </div>
                <div className={s.actions}>
                  {x.href && !closed && (
                    <Link href={x.href} className="btn outline">
                      {t("Ir", "Go")} →
                    </Link>
                  )}
                  {x.status === "todo" ? (
                    <>
                      <form action={act}>
                        <input type="hidden" name="id" value={x.id} />
                        <input type="hidden" name="status" value="done" />
                        <button type="submit" className={`btn ${s.done}`} disabled={pending}>
                          ✓ {t("Hecha", "Done")}
                        </button>
                      </form>
                      <form action={act}>
                        <input type="hidden" name="id" value={x.id} />
                        <input type="hidden" name="status" value="dismissed" />
                        <button type="submit" className="btn" disabled={pending}>
                          {t("No aplica", "Not relevant")}
                        </button>
                      </form>
                    </>
                  ) : (
                    <>
                      <span className={s.when}>
                        {x.status === "done"
                          ? `✓ ${t("Hecha", "Done")} ${doneLabels[x.id] && !overrides[x.id] ? t(`el ${doneLabels[x.id]}`, `on ${doneLabels[x.id]}`) : t("hoy", "today")}`
                          : t("No aplica", "Not relevant")}
                      </span>
                      <form action={act}>
                        <input type="hidden" name="id" value={x.id} />
                        <input type="hidden" name="status" value="todo" />
                        <button type="submit" className="btn" disabled={pending}>
                          {t("Volver a abrir", "Reopen")}
                        </button>
                      </form>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {visible.length < shown.length && (
        <button type="button" className={`btn ${s.more}`} onClick={() => setShowAll(true)}>
          {t(`Ver ${shown.length - visible.length} más`, `Show ${shown.length - visible.length} more`)}
        </button>
      )}

      {toast && (
        <div className={s.toast} role="status" aria-live="polite">
          <span>{toast.message}</span>
          {toast.ok && toast.prev && toast.status !== "todo" && toastTask && (
            <form
              action={(f) => {
                setToast(null);
                act(f);
              }}
            >
              <input type="hidden" name="id" value={toast.id} />
              <input type="hidden" name="status" value={toast.prev} />
              <input type="hidden" name="doneAt" value={toast.prevDoneAt ?? ""} />
              <button type="submit">{t("Deshacer", "Undo")}</button>
            </form>
          )}
          {!toast.ok && (
            <button type="button" onClick={() => setToast(null)}>
              {t("Cerrar", "Close")}
            </button>
          )}
        </div>
      )}
    </>
  );
}
