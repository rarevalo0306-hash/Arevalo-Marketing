"use client";
import { useState } from "react";
import { useT } from "@/components/I18n";
import { INDUSTRIES } from "@/lib/agent/industry";
import { CHANNELS } from "@/lib/channels";
import type { Settings } from "@/lib/agent/schema";
import { DEFAULT_SETTINGS, type Snapshot } from "./types";
import s from "./AgentCenter.module.css";
export function AgentSettings({
  data,
  save,
  busy,
  saveError,
  saveNotice,
}: {
  data: Snapshot;
  save: (settings: Settings) => Promise<boolean>;
  busy: boolean;
  saveError: string;
  saveNotice: string;
}) {
  const { t } = useT();
  const [value, setValue] = useState<Settings>(
    data.settings ?? DEFAULT_SETTINGS,
  );
  const set = <K extends keyof Settings>(key: K, v: Settings[K]) =>
    setValue((old) => ({ ...old, [key]: v }));
  return (
    <form
      className={s.settings}
      onSubmit={async (e) => {
        e.preventDefault();
        await save(value);
      }}
    >
      <div className={s.sectionTitle}>
        <h2>{t("Cómo trabaja MATYA", "How MATYA works")}</h2>
        <p>
          {t(
            "Un objetivo claro y límites que se aplican a cada trabajo.",
            "A clear objective and limits applied to every task.",
          )}
        </p>
      </div>
      <label>
        {t("Objetivo del negocio", "Business objective")}
        <textarea
          value={value.objective}
          maxLength={1500}
          onChange={(e) => set("objective", e.target.value)}
          placeholder={t(
            "Qué quieres lograr y a qué público quieres llegar",
            "What you want to achieve and who you want to reach",
          )}
        />
      </label>
      <div className={s.formGrid}>
        <label>
          {t("Industria", "Industry")}
          <select
            value={value.industry}
            onChange={(e) =>
              set("industry", e.target.value as Settings["industry"])
            }
          >
            {Object.values(INDUSTRIES).map((i) => (
              <option key={i.key} value={i.key}>
                {i.name} · {i.geography}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Modo de trabajo", "Working mode")}
          <select
            value={value.mode}
            onChange={(e) => set("mode", e.target.value as Settings["mode"])}
          >
            <option value="auto">
              {t(
                "Automático dentro de mis límites",
                "Automatic within my limits",
              )}
            </option>
            <option value="approval">
              {t("Revisar antes de publicar", "Review before publishing")}
            </option>
          </select>
        </label>
      </div>
      <label>
        {t("Preferencias que debe recordar", "Preferences to remember")}
        <textarea
          value={value.memory}
          maxLength={6000}
          onChange={(e) => set("memory", e.target.value)}
          placeholder={t(
            "Servicios, tono, temas excluidos, decisiones…",
            "Services, tone, excluded topics, decisions…",
          )}
        />
      </label>
      <fieldset>
        <legend>{t("Canales autorizados", "Allowed channels")}</legend>
        <div className={s.checks}>
          {CHANNELS.map((c) => (
            <label key={c.id}>
              <input
                type="checkbox"
                checked={value.channels.includes(c.id)}
                onChange={(e) =>
                  set(
                    "channels",
                    e.target.checked
                      ? [...value.channels, c.id]
                      : value.channels.filter((x) => x !== c.id),
                  )
                }
              />
              {c.name}
              {!data.connections.includes(c.id) && (
                <small>{t("Sin conectar", "Not connected")}</small>
              )}
            </label>
          ))}
        </div>
        <p className={s.note}>
          {t(
            "Cada formato usa solo los canales compatibles. Las conexiones se verifican antes de programar.",
            "Each format uses compatible channels only. Connections are checked before scheduling.",
          )}
        </p>
      </fieldset>
      <div className={s.formGrid}>
        <label>
          {t("Límite diario de IA (USD)", "Daily AI limit (USD)")}
          <input
            type="number"
            min="0"
            max="1000"
            step="0.01"
            value={value.dailyBudgetCents / 100}
            onChange={(e) =>
              set("dailyBudgetCents", Math.round(Number(e.target.value) * 100))
            }
          />
        </label>
        <label>
          {t("Límite por encargo (USD)", "Limit per task (USD)")}
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={value.runBudgetCents / 100}
            onChange={(e) =>
              set("runBudgetCents", Math.round(Number(e.target.value) * 100))
            }
          />
        </label>
        <label>
          {t("Máximo de publicaciones al día", "Maximum posts per day")}
          <input
            type="number"
            min="1"
            max="12"
            value={value.maxPostsPerDay}
            onChange={(e) => set("maxPostsPerDay", Number(e.target.value))}
          />
        </label>
        <label>
          {t("Revisar noticias cada (horas)", "Check news every (hours)")}
          <input
            type="number"
            min="6"
            max="168"
            value={value.radarHours}
            onChange={(e) => set("radarHours", Number(e.target.value))}
          />
        </label>
      </div>
      <p className={s.note}>
        {t(
          "Estos topes cubren el texto y la reserva de render del agente. Los anuncios y las herramientas utilizadas por separado conservan sus límites propios. Un límite de cero desactiva las llamadas de pago.",
          "These caps cover agent text and video render reservations. Ads and separately used tools retain their own limits. A zero cap disables paid calls.",
        )}
      </p>
      <div className={s.checks}>
        <label>
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => set("enabled", e.target.checked)}
          />
          {t("Activar el agente", "Enable the agent")}
        </label>
        <label>
          <input
            type="checkbox"
            checked={value.allowPublish}
            onChange={(e) => set("allowPublish", e.target.checked)}
          />
          {t(
            "Permitir programar y publicar",
            "Allow scheduling and publishing",
          )}
        </label>
        <label>
          <input
            type="checkbox"
            checked={value.radarEnabled}
            onChange={(e) => set("radarEnabled", e.target.checked)}
          />
          {t("Activar radar periódico", "Enable periodic news radar")}
        </label>
      </div>
      <div className={s.sectionTitle}>
        <h2>{t("Fuentes de la industria", "Industry sources")}</h2>
        <p>
          {t(
            "RSS o Atom del sector y del territorio del negocio.",
            "RSS or Atom from the business’s industry and territory.",
          )}
        </p>
      </div>
      {value.sources.map((source, i) => (
        <div className={s.sourceForm} key={i}>
          <label>
            {t("Nombre", "Name")}
            <input
              required
              value={source.name}
              maxLength={100}
              onChange={(e) =>
                set(
                  "sources",
                  value.sources.map((x, j) =>
                    j === i ? { ...x, name: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <label>
            {t("Dirección del feed", "Feed address")}
            <input
              type="url"
              required
              value={source.url}
              onChange={(e) =>
                set(
                  "sources",
                  value.sources.map((x, j) =>
                    j === i ? { ...x, url: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <label>
            {t("Territorio", "Territory")}
            <input
              required
              value={source.geography}
              onChange={(e) =>
                set(
                  "sources",
                  value.sources.map((x, j) =>
                    j === i ? { ...x, geography: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <label className={s.inline}>
            <input
              type="checkbox"
              checked={source.primary}
              onChange={(e) =>
                set(
                  "sources",
                  value.sources.map((x, j) =>
                    j === i ? { ...x, primary: e.target.checked } : x,
                  ),
                )
              }
            />
            {t("Fuente primaria", "Primary source")}
          </label>
          <button
            type="button"
            className={s.textButton}
            onClick={() =>
              set(
                "sources",
                value.sources.filter((_, j) => i !== j),
              )
            }
          >
            {t("Quitar fuente", "Remove source")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn outline"
        disabled={value.sources.length >= 8}
        onClick={() =>
          set("sources", [
            ...value.sources,
            {
              name: "",
              url: "",
              primary: false,
              geography: INDUSTRIES[value.industry].geography,
            },
          ])
        }
      >
        {t("Agregar fuente", "Add source")}
      </button>
      <div className={s.sectionTitle}>
        <h2>{t("Hechos que puede utilizar", "Facts MATYA can use")}</h2>
        <p>
          {t(
            "Guarda cada hecho con su fuente y una fecha de revisión. Los vencidos quedan fuera de los nuevos encargos.",
            "Save each fact with its source and review date. Expired facts are excluded from new tasks.",
          )}
        </p>
      </div>
      {value.knowledge.map((k, i) => (
        <div className={s.sourceForm} key={i}>
          <label>
            {t("Hecho confirmado", "Confirmed fact")}
            <textarea
              required
              value={k.fact}
              maxLength={1000}
              onChange={(e) =>
                set(
                  "knowledge",
                  value.knowledge.map((x, j) =>
                    j === i ? { ...x, fact: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <label>
            {t("Fuente original", "Original source")}
            <input
              type="url"
              required
              value={k.url}
              onChange={(e) =>
                set(
                  "knowledge",
                  value.knowledge.map((x, j) =>
                    j === i ? { ...x, url: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <label>
            {t("Revisado el", "Reviewed on")}
            <input
              type="date"
              required
              value={k.checkedAt.slice(0, 10)}
              onChange={(e) => {
                if (e.target.value)
                  set(
                    "knowledge",
                    value.knowledge.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            checkedAt: new Date(e.target.value).toISOString(),
                          }
                        : x,
                    ),
                  );
              }}
            />
          </label>
          <label>
            {t("Volver a revisar el", "Review again on")}
            <input
              type="date"
              required
              value={k.expiresAt.slice(0, 10)}
              onChange={(e) => {
                if (e.target.value)
                  set(
                    "knowledge",
                    value.knowledge.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            expiresAt: new Date(e.target.value).toISOString(),
                          }
                        : x,
                    ),
                  );
              }}
            />
          </label>
          <button
            type="button"
            className={s.textButton}
            onClick={() =>
              set(
                "knowledge",
                value.knowledge.filter((_, j) => j !== i),
              )
            }
          >
            {t("Quitar hecho", "Remove fact")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn outline"
        disabled={value.knowledge.length >= 30}
        onClick={() =>
          set("knowledge", [
            ...value.knowledge,
            {
              fact: "",
              url: "",
              checkedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
              geography: INDUSTRIES[value.industry].geography,
            },
          ])
        }
      >
        {t("Agregar hecho con fuente", "Add sourced fact")}
      </button>
      {saveError && (
        <p className={s.saveFeedback} data-error="true" role="alert">
          {saveError}
        </p>
      )}
      {saveNotice && (
        <p className={s.saveFeedback} role="status">
          {saveNotice}
        </p>
      )}
      <button disabled={busy} className="btn on" type="submit">
        {busy
          ? t("Guardando…", "Saving…")
          : t("Guardar configuración", "Save settings")}
      </button>
    </form>
  );
}
