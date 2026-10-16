"use client";
// La pestaña Hoy del Centro MATYA: avisos, el plan de hoy, lo que espera el sí del dueño y el tablero de piezas.
// Todo lo que viene del equipo o del dueño (temas, textos, problemas, notas) se pinta como texto: React lo escapa.
import { useId, useState } from "react";
import { useT } from "@/components/I18n";
import { OWNER_NOTE_MAX } from "@/lib/agent/plan";
import {
  BOARD_COLUMNS,
  boardColumn,
  boardState,
  needsYou,
  pieceInfo,
  type BoardColumn,
  type NeedItem,
  type NeedKind,
  type TeamAgentView,
  type TeamRunView,
  type TeamSnapshot,
} from "@/lib/agent/team-view";
import { localDay } from "@/lib/business-tz";
import { channelName } from "@/lib/channels";
import type { T } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/time";
import { Output, labels, stepLabel, usd } from "./shared";
import type { Snapshot } from "./types";
import s from "./Team.module.css";

/** The tick is the worker's once-a-minute call: past this age it is not running. */
const TICK_STALE_MS = 10 * 60_000;

const COLUMN_TITLES: Record<BoardColumn, [string, string]> = {
  investigacion: ["Investigación", "Research"],
  estrategia: ["Estrategia", "Strategy"],
  redaccion: ["Redacción", "Writing"],
  diseno: ["Diseño o video", "Design or video"],
  revision: ["Revisión", "Review"],
  programada: ["Programada", "Scheduled"],
  publicada: ["Publicada", "Published"],
};
const NEED_TAGS: Record<NeedKind, [string, string]> = {
  video: ["Video con costo", "Video with a cost"],
  articulo: ["Artículo", "Article"],
  revision: ["No pasó la revisión", "Did not pass review"],
  publicar: ["Lista para publicar", "Ready to publish"],
};
const FORMATS: Record<string, [string, string]> = {
  post: ["Publicación", "Post"],
  carrusel: ["Carrusel", "Carousel"],
  video: ["Video", "Video"],
  articulo: ["Artículo", "Article"],
};

/** The body `act` sends for "Rehacer": the owner's note goes only when it has text (an empty one is refused by the API). */
export function redoBody(runId: string, note: string): Record<string, unknown> {
  const text = note.trim();
  return text ? { action: "redo", runId, note: text } : { action: "redo", runId };
}

const asObject = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** What a team request is about: the goal its `plan` step wrote, or "". */
function goalOf(run: TeamRunView): string {
  const goal = asObject(run.steps.find((st) => st.name === "plan")?.output)?.goal;
  return typeof goal === "string" ? goal : "";
}

/** How many pieces the team request created (the output of its `dispatch` step), or null before it ran. */
function piecesOf(run: TeamRunView): number | null {
  const pieces = asObject(run.steps.find((st) => st.name === "dispatch")?.output)?.pieces;
  return Array.isArray(pieces) ? pieces.length : null;
}

/** The morning plan of the business's current day: the latest team request with origin "daily" created today. */
function dailyPlan(team: TeamSnapshot | null): TeamRunView | null {
  if (!team) return null;
  let latest: TeamRunView | null = null;
  for (const r of team.runs) {
    if (r.kind !== "team" || r.origin !== "daily" || localDay(new Date(r.createdAt), team.tz) !== team.today) continue;
    if (!latest || Date.parse(r.createdAt) >= Date.parse(latest.createdAt)) latest = r;
  }
  return latest;
}

export function TeamToday({
  data,
  busy,
  act,
  onSettings,
}: {
  data: Snapshot;
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<boolean>;
  /** Takes the owner to the settings tab (the tick warning's link). */
  onSettings: () => void;
}) {
  const { t, lang } = useT();
  const id = useId();
  const settings = data.settings;
  const team = data.team;
  const runs = team?.runs ?? [];
  const agents = team?.agents ?? [];
  const tz = team?.tz;
  const needs = needsYou(runs);
  const plan = dailyPlan(team);
  const planGoal = plan ? goalOf(plan) : "";
  const planPieces = plan ? piecesOf(plan) : null;
  // A missing, unreadable or old tick means the worker is not calling the engine every minute. Both times come from the server
  // (the tick and the moment the snapshot was taken), so the owner's own clock can neither hide nor fake the warning.
  const tickAge = settings?.tickAt ? Date.parse(data.capturedAt) - Date.parse(settings.tickAt) : Number.NaN;
  const tickStale = !(tickAge <= TICK_STALE_MS);
  const pausedSince = settings?.pausedAt ? fmtDateTime(settings.pausedAt, lang, tz) : "";

  return (
    <div className={s.today}>
      {(pausedSince || tickStale) && (
        <div className={s.notices}>
          {pausedSince && (
            <div className={s.notice} role="status" data-tone="pause">
              <p>{t(`MATYA está en pausa desde ${pausedSince}`, `MATYA has been paused since ${pausedSince}`)}</p>
              <button className="btn on" disabled={busy} onClick={() => void act({ action: "resume_all" })}>
                {t("Reanudar", "Resume")}
              </button>
            </div>
          )}
          {tickStale && (
            <div className={s.notice} role="status" data-tone="warn">
              <p>
                {t(
                  "El llamado de cada minuto no está activo: el equipo no avanza ni llega el plan de la mañana.",
                  "The every-minute call is not active: the team does not move forward and the morning plan does not arrive.",
                )}
              </p>
              <button type="button" className="btn link" onClick={onSettings}>
                {t("Ver configuración", "View settings")} →
              </button>
            </div>
          )}
        </div>
      )}
      <section className={s.block} aria-labelledby={`${id}-plan`}>
        <h2 id={`${id}-plan`}>{t("El plan de hoy", "Today's plan")}</h2>
        {plan ? (
          <div className={s.plan}>
            {planGoal ? (
              <p className={s.goal}>{planGoal}</p>
            ) : (
              <p className={s.goal}>{t(...(labels[plan.status] ?? [plan.status, plan.status]))}</p>
            )}
            {planPieces !== null && (
              <p className={s.meta}>
                {t(`${planPieces} ${planPieces === 1 ? "pieza" : "piezas"}`, `${planPieces} ${planPieces === 1 ? "piece" : "pieces"}`)}
              </p>
            )}
          </div>
        ) : (
          <p className={s.empty}>
            {t(`El plan de hoy llega a las ${settings?.dailyHour ?? 7}:00.`, `Today's plan arrives at ${settings?.dailyHour ?? 7}:00.`)}
          </p>
        )}
      </section>
      <section className={s.block} aria-labelledby={`${id}-needs`}>
        <h2 id={`${id}-needs`}>{t("Necesita tu sí", "Needs your OK")}</h2>
        {needs.length ? (
          <ul className={s.needs}>
            {needs.map((need) => (
              <NeedCard key={need.runId} need={need} busy={busy} act={act} />
            ))}
          </ul>
        ) : (
          <p className={s.empty}>{t("Nada espera tu aprobación.", "Nothing is waiting for your approval.")}</p>
        )}
      </section>
      <section className={s.block} aria-labelledby={`${id}-board`}>
        <h2 id={`${id}-board`}>{t("Tablero del equipo", "Team board")}</h2>
        {!runs.length && <p className={s.empty}>{t("Hoy todavía no hay piezas.", "There are no pieces yet today.")}</p>}
        <div className={s.board}>
          {BOARD_COLUMNS.map((column) => {
            const cards = runs.filter((r) => boardColumn(r) === column);
            return (
              <section
                key={column}
                className={s.column}
                data-column={column}
                data-empty={cards.length ? undefined : "true"}
                aria-labelledby={`${id}-${column}`}
              >
                <div className={s.columnHead}>
                  <h3 id={`${id}-${column}`}>{t(...COLUMN_TITLES[column])}</h3>
                  <span>{cards.length}</span>
                </div>
                {cards.length > 0 && (
                  <ul className={s.cards}>
                    {cards.map((run) => (
                      <li key={run.id}>
                        <BoardCard run={run} agents={agents} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function NeedCard({ need, busy, act }: { need: NeedItem; busy: boolean; act: (body: Record<string, unknown>) => Promise<boolean> }) {
  const { t } = useT();
  const noteId = useId();
  const [redoing, setRedoing] = useState(false);
  const [note, setNote] = useState("");
  return (
    <li className={s.need} data-kind={need.kind}>
      <span className={s.tag}>{t(...NEED_TAGS[need.kind])}</span>
      <strong className={s.topic}>{need.topic || t("Pieza sin tema", "Piece without a topic")}</strong>
      {need.text && <p className={s.text}>{need.text}</p>}
      {need.problems.length > 0 && (
        <ul className={s.problems}>
          {need.problems.map((p, i) => (
            <li key={i}>
              <b>{p.kind}</b> {p.detail}
            </li>
          ))}
        </ul>
      )}
      <div className={s.actions}>
        <button className="btn on" disabled={busy} onClick={() => void act({ action: "approve", runId: need.runId })}>
          {t("Aprobar", "Approve")}
        </button>
        {need.canRedo && (
          <button className="btn outline" disabled={busy} aria-expanded={redoing} onClick={() => setRedoing((open) => !open)}>
            {t("Rehacer", "Redo")}
          </button>
        )}
        <button className="btn outline" disabled={busy} onClick={() => void act({ action: "cancel", runId: need.runId })}>
          {t("Cancelar", "Cancel")}
        </button>
      </div>
      {redoing && (
        <form
          className={s.redo}
          onSubmit={(e) => {
            e.preventDefault();
            void act(redoBody(need.runId, note)).then((ok) => {
              if (!ok) return;
              setRedoing(false);
              setNote("");
            });
          }}
        >
          <label htmlFor={noteId}>{t("Qué quieres que cambie (opcional)", "What do you want changed (optional)")}</label>
          <textarea id={noteId} value={note} maxLength={OWNER_NOTE_MAX} rows={3} onChange={(e) => setNote(e.target.value)} />
          <button className="btn on" disabled={busy}>
            {t("Rehacer esta pieza", "Redo this piece")}
          </button>
        </form>
      )}
    </li>
  );
}

/** The name an agent key is shown with: its label, MATYA for the steps that are plain code, nothing for old runs. */
function agentName(key: string, agents: TeamAgentView[], t: T): string {
  if (!key) return "";
  if (key === "matya") return "MATYA";
  const label = agents.find((a) => a.key === key)?.label;
  return label ? t(label.es, label.en) : key;
}

function BoardCard({ run, agents }: { run: TeamRunView; agents: TeamAgentView[] }) {
  const { t, lang } = useT();
  const info = pieceInfo(run);
  const team = run.kind === "team";
  const topic = info?.topic || (team ? goalOf(run) || t("Plan del equipo", "Team plan") : t("Pieza sin tema", "Piece without a topic"));
  const format = info
    ? FORMATS[info.format]
      ? t(...FORMATS[info.format])
      : info.format
    : team
      ? run.origin === "daily"
        ? t("Plan de la mañana", "Morning plan")
        : t("Encargo del equipo", "Team request")
      : "";
  const channels = info?.channels.map((c) => channelName(c, lang)).join(", ") ?? "";
  return (
    <details className={s.card}>
      <summary>
        <span className={s.topic}>{topic}</span>
        <span className={s.meta}>{[format, channels].filter(Boolean).join(" · ")}</span>
        <span className={s.cardFoot}>
          <span className={s.state} data-state={boardState(run)}>
            {t(...(labels[run.status] ?? [run.status, run.status]))}
          </span>
          <span>{usd(run.chargedCents)}</span>
        </span>
        <span className={s.chevron} aria-hidden="true" />
      </summary>
      <ol className={s.steps}>
        {run.steps.map((st, i) => {
          const who = [agentName(st.agent, agents, t), st.model, usd(st.chargedCents)].filter(Boolean).join(" · ");
          return (
            <li key={`${st.name}-${i}`}>
              <div className={s.stepHead}>
                <strong>{stepLabel(st.name, t)}</strong>
                <span className={s.state} data-state={st.status}>
                  {t(...(labels[st.status] ?? [st.status, st.status]))}
                </span>
              </div>
              <p className={s.meta}>{who}</p>
              {st.error && <p className={s.error}>{st.error}</p>}
              <Output value={st.output} />
            </li>
          );
        })}
      </ol>
      {run.error && <p className={s.error}>{run.error}</p>}
    </details>
  );
}
