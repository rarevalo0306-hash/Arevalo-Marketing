"use client";
// La pestaña Equipo del Centro MATYA: una fila por agente con su IA, si está listo, sus pasos de hoy y su gasto.
// Los modelos y los problemas vienen del servidor: se pintan solo como texto (React los escapa).
import { useId } from "react";
import { useT } from "@/components/I18n";
import type { TeamAgentView } from "@/lib/agent/team-view";
import { usd } from "./shared";
import type { Snapshot } from "./types";
import s from "./Team.module.css";

function AgentRow({ agent }: { agent: TeamAgentView }) {
  const { t } = useT();
  const ready = agent.ready && !agent.problem;
  return (
    <li className={s.agentRow}>
      <strong className={s.agentName}>{t(agent.label.es, agent.label.en)}</strong>
      <div className={s.agentAi}>
        {agent.usesModel ? (
          <>
            {agent.model && <span className={s.model}>{agent.model}</span>}
            {!agent.own && <span className={s.note}>{t("Usa el modelo por defecto", "Uses the default model")}</span>}
          </>
        ) : (
          <span className={s.model}>{t("Sin IA (biblioteca y plantillas)", "No AI (library and templates)")}</span>
        )}
      </div>
      <div className={s.agentStatus}>
        {ready ? (
          <span className={s.state} data-state="done">
            {t("Listo", "Ready")}
          </span>
        ) : (
          <>
            <span className={s.state} data-state="attention">
              {t("Aviso", "Warning")}
            </span>
            <p className={s.error}>{agent.problem || t("No está listo.", "Not ready.")}</p>
          </>
        )}
      </div>
      <div className={s.agentSpend}>
        <strong>{usd(agent.cents)}</strong>
        <span className={s.note}>
          {agent.steps === 1 ? t("1 paso hoy", "1 step today") : t(`${agent.steps} pasos hoy`, `${agent.steps} steps today`)}
        </span>
      </div>
    </li>
  );
}

export function TeamRoster({ data }: { data: Snapshot }) {
  const { t } = useT();
  const id = useId();
  const agents = data.team?.agents ?? [];
  const total = agents.reduce((sum, a) => sum + a.cents, 0);
  // The daily budget counts the whole day (the conversation spends too), so the agents' own total can be lower than what was charged.
  const charged = data.budget?.chargedCents ?? 0;
  return (
    <section className={s.roster} aria-labelledby={`${id}-team`}>
      <h2 id={`${id}-team`}>{t("El equipo", "The team")}</h2>
      {agents.length ? (
        <>
          <ul className={s.agents}>
            {agents.map((agent) => (
              <AgentRow key={agent.key} agent={agent} />
            ))}
          </ul>
          <div className={s.total}>
            <p className={s.totalLine}>
              <span>{t("Total del equipo hoy", "Team total today")}</span>
              <strong>{usd(total)}</strong>
              <span className={s.note}>
                {t(`de ${usd(data.settings?.dailyBudgetCents ?? 0)} al día`, `of ${usd(data.settings?.dailyBudgetCents ?? 0)} a day`)}
              </span>
            </p>
            {charged > total && (
              <p className={s.meta}>
                {t(
                  `Con la conversación y lo demás, MATYA gastó ${usd(charged)} hoy.`,
                  `Counting the conversation and the rest, MATYA spent ${usd(charged)} today.`,
                )}
              </p>
            )}
          </div>
        </>
      ) : (
        <p className={s.empty}>{t("Todavía no hay datos del equipo.", "There is no team data yet.")}</p>
      )}
    </section>
  );
}
