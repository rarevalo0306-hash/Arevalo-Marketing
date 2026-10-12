"use client";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18n";
import { AgentSettings } from "./AgentSettings";
import { useVoice } from "./useVoice";
import type { Snapshot, RunView, NewsView } from "./types";
import s from "./AgentCenter.module.css";

const labels: Record<string, [string, string]> = {
  queued: ["En cola", "Queued"],
  running: ["Trabajando", "Working"],
  waiting_approval: ["Listo para revisar", "Ready for review"],
  waiting_provider: ["Esperando al canal", "Waiting for channel"],
  completed: ["Completado", "Completed"],
  blocked: ["Necesita atención", "Needs attention"],
  uncertain: ["Resultado por comprobar", "Result to verify"],
  cancelled: ["Cancelado", "Cancelled"],
  succeeded: ["Listo", "Done"],
};
const stepNames: Record<string, [string, string]> = {
  research: ["Investigación y SEO", "Research & SEO"],
  copy: ["Redacción", "Copywriting"],
  design: ["Diseño", "Design"],
  prepare: ["Campaña preparada", "Campaign prepared"],
  schedule: ["Programación", "Scheduling"],
  verify: ["Resultado por canal", "Channel results"],
  briefing: ["Resumen del negocio", "Business briefing"],
  conversation: ["MATYA", "MATYA"],
  radar: ["Radar de noticias", "News radar"],
  optimize: ["Análisis de resultados", "Results analysis"],
  video: ["Render de video", "Video render"],
  video_wait: ["Comprobación del video", "Video status"],
  verify_news: ["Verificar fuente original", "Verify original source"],
  pause: ["Pausa de campaña", "Pause campaign"],
};
const usd = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    v / 100,
  );
const safeHref = (v: unknown) =>
  typeof v === "string" &&
  (/^https:\/\//.test(v) || /^\/b\//.test(v) || /^\/media\//.test(v))
    ? v
    : undefined;
function Icon({ type }: { type: "mic" | "send" | "stop" | "sound" | "arrow" }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {type === "mic" ? (
        <>
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-3 0h6" />
        </>
      ) : type === "send" ? (
        <path d="m4 4 17 8-17 8 3-8-3-8Zm3 8h14" />
      ) : type === "stop" ? (
        <rect x="5" y="5" width="14" height="14" rx="2" />
      ) : type === "sound" ? (
        <>
          <path d="m4 10 4 0 5-5v14l-5-5H4v-4Zm13-2a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
        </>
      ) : (
        <path d="M5 12h14m-5-5 5 5-5 5" />
      )}
    </svg>
  );
}

export function AgentCenter({
  businessId,
  initial,
  setupError,
}: {
  businessId: string;
  initial: Snapshot | null;
  setupError?: string;
}) {
  const { t, lang } = useT();
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState("activity");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(setupError ?? "");
  const [notice, setNotice] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const requestKey = useRef<string | null>(null);
  const sending = useRef(false);
  const spokenRun = useRef<string | null>(null);
  const autoSpeak = useRef(false);
  const voiceRun = useRef<string | null>(null);
  const reload = useCallback(async () => {
    const res = await fetch(`/api/agent/${businessId}`, { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "No se pudo actualizar.");
    if (mounted.current) setData(body);
  }, [businessId]);
  const mutate = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const res = await fetch(`/api/agent/${businessId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || "No se pudo completar.");
        if (result.runId && autoSpeak.current) voiceRun.current = result.runId;
        await reload();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo completar.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [businessId, reload],
  );
  const send = async (text: string, extra: Record<string, unknown> = {}) => {
    if (!text.trim() || sending.current) return;
    sending.current = true;
    requestKey.current ??= crypto.randomUUID();
    const ok = await mutate({
      action: "message",
      text,
      requestKey: requestKey.current,
      ...extra,
    });
    if (ok) {
      setDraft("");
      requestKey.current = null;
      setTab("activity");
    }
    sending.current = false;
  };
  const voice = useVoice((text) => {
    autoSpeak.current = true;
    setDraft(text);
    void send(text);
  }, lang);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const pending = !!data?.runs.some((r) =>
    ["queued", "running", "waiting_provider"].includes(r.status),
  );
  useEffect(() => {
    if (!pending) return;
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    const poll = async () => {
      if (!document.hidden)
        try {
          await reload();
        } catch {
          /* keep saved view; a visible refresh reports failures */
        }
      if (!disposed) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 3000);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [pending, reload]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [data?.messages.length]);
  useEffect(() => {
    const latest = data?.messages.find(
      (m) => m.role === "assistant" && m.runId === voiceRun.current,
    );
    const settled = data?.runs.some(
      (r) =>
        r.id === voiceRun.current &&
        [
          "completed",
          "waiting_approval",
          "blocked",
          "uncertain",
          "cancelled",
        ].includes(r.status),
    );
    if (
      autoSpeak.current &&
      settled &&
      latest &&
      latest.runId !== spokenRun.current
    ) {
      spokenRun.current = latest.runId;
      autoSpeak.current = false;
      voice.speak(latest.text);
    }
    // Speech follows a new response, never each polling render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.messages, data?.runs]);
  const status = (key: string) => t(...(labels[key] ?? [key, key]));
  if (!data)
    return (
      <section className={s.setup}>
        <h1>MATYA</h1>
        <h2>{t("Tu centro de marketing", "Your marketing workspace")}</h2>
        <p role="status">
          {error ||
            t(
              "El centro se está preparando en este entorno.",
              "The workspace is being prepared in this environment.",
            )}
        </p>
        <Link className="btn outline" href={`/b/${businessId}/inicio`}>
          {t("Volver a mis herramientas", "Back to my tools")}
        </Link>
      </section>
    );
  const active = data.runs.find((r) => r.status === "running");
  const exceptions = data.posts.filter((p) =>
    ["failed", "partial", "publishing"].includes(p.status),
  );
  return (
    <div className={s.root}>
      <header className={s.header}>
        <div className={s.title}>
          <div
            className={`${s.agent} ${active ? s.working : ""}`}
            aria-hidden="true"
          >
            <svg viewBox="0 0 72 72">
              <circle cx="36" cy="36" r="13" />
              <ellipse
                cx="36"
                cy="36"
                rx="31"
                ry="15"
                transform="rotate(-35 36 36)"
              />
              <ellipse
                cx="36"
                cy="36"
                rx="31"
                ry="15"
                transform="rotate(35 36 36)"
              />
              <circle cx="12" cy="20" r="3" />
            </svg>
          </div>
          <div>
            <h1>MATYA</h1>
            <p>
              {active
                ? t("Coordinando tu marketing", "Coordinating your marketing")
                : t(
                    "Tu equipo de marketing, en un solo lugar",
                    "Your marketing team, in one place",
                  )}
            </p>
          </div>
        </div>
        <div className={s.business}>
          <strong>{data.business.name}</strong>
          <span>{data.industry.name}</span>
        </div>
      </header>
      <nav className={s.tabs} aria-label={t("Centro MATYA", "MATYA workspace")}>
        {[
          ["activity", "Conversación", "Conversation"],
          ["knowledge", "Conocimiento", "Knowledge"],
          ["news", "Noticias", "News"],
          ["results", "Resultados", "Results"],
          ["settings", "Configuración", "Settings"],
        ].map(([key, es, en]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
          >
            {t(es, en)}
            {key === "news" && data.news.length > 0 && (
              <span>{data.news.length}</span>
            )}
          </button>
        ))}
      </nav>
      {error && tab !== "settings" && (
        <div className={s.alert} role="alert">
          {error}
          <button
            onClick={() => setError("")}
            aria-label={t("Cerrar aviso", "Dismiss notice")}
          >
            ×
          </button>
        </div>
      )}
      {notice && tab !== "settings" && (
        <p role="status" className={s.notice}>
          {notice}
        </p>
      )}
      {(!data.aiReady || !data.settings?.enabled) && (
        <div className={s.setupNote} role="status">
          <p>
            {t(
              "El resumen de actividad ya está disponible. Para crear contenido, MATYA necesita la conexión de IA y sus límites de trabajo.",
              "The activity briefing is available. To create content, MATYA needs its AI connection and working limits.",
            )}
          </p>
          <button className={s.textButton} onClick={() => setTab("settings")}>
            {t("Ver configuración", "View settings")} →
          </button>
        </div>
      )}
      {tab === "activity" && (
        <div className={s.workspace}>
          <section
            className={s.conversation}
            aria-label={t("Conversación con MATYA", "Conversation with MATYA")}
          >
            <div className={s.conversationHead}>
              <h2>{t("Qué hacemos hoy", "What shall we work on today")}</h2>
              <span className={s.state}>
                <i className={active ? s.live : ""} />
                {active
                  ? status(active.status)
                  : t(
                      "Lista para tu próximo encargo",
                      "Ready for your next task",
                    )}
              </span>
            </div>
            <div className={s.messages}>
              {!data.messages.length && (
                <div className={s.welcome}>
                  <h3>
                    {t("De la idea al resultado.", "From idea to result.")}
                  </h3>
                  <p>
                    {t(
                      "Cuéntame el objetivo. Coordino la investigación, los textos y el diseño, y sigo cada publicación hasta conocer su resultado.",
                      "Tell me the objective. I coordinate research, copy and design, and follow each post through to its outcome.",
                    )}
                  </p>
                  <div className={s.quick}>
                    {[
                      [t("Ponme al día", "Bring me up to date"), "briefing"],
                      [
                        t(
                          "Prepara una campaña con el objetivo de mi negocio",
                          "Prepare a campaign for my business objective",
                        ),
                        "campaign",
                      ],
                      [
                        t(
                          "Revisa las noticias de mi industria",
                          "Check my industry news",
                        ),
                        "radar",
                      ],
                    ].map(([text, kind]) => (
                      <button
                        key={kind}
                        disabled={busy}
                        onClick={() => void send(text, { kind })}
                      >
                        {kind === "briefing"
                          ? t("Ponme al día", "Brief me")
                          : kind === "campaign"
                            ? t("Preparar campaña", "Prepare campaign")
                            : t("Revisar noticias", "Check news")}
                        <Icon type="arrow" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {data.messages.map((m) => (
                <article
                  key={m.id}
                  className={`${s.message} ${m.role === "user" ? s.user : s.assistant}`}
                >
                  <strong>
                    {m.role === "user" ? t("Tú", "You") : "MATYA"}
                  </strong>
                  <p>{m.text}</p>
                  {m.role === "assistant" && (
                    <button
                      className={s.textButton}
                      onClick={() => voice.speak(m.text)}
                    >
                      <Icon type="sound" />
                      {t("Escuchar", "Listen")}
                    </button>
                  )}
                </article>
              ))}
              {active && (
                <div className={s.thinking} role="status">
                  {t("Trabajando en", "Working on")}:{" "}
                  {t(
                    ...(stepNames[
                      active.steps.at(-1)?.name ?? "conversation"
                    ] ?? ["Tu encargo", "Your task"]),
                  )}
                </div>
              )}
              <div ref={end} />
            </div>
            <form
              className={s.composer}
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
            >
              <label htmlFor="matya-message" className={s.srOnly}>
                {t("Escribe tu encargo", "Write your request")}
              </label>
              <textarea
                id="matya-message"
                value={draft}
                maxLength={4000}
                rows={3}
                placeholder={t(
                  "Dile a MATYA qué quieres lograr…",
                  "Tell MATYA what you want to achieve…",
                )}
                onChange={(e) => {
                  setDraft(e.target.value);
                  requestKey.current = null;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
              />
              <div className={s.composerFoot}>
                <div className={s.voiceControls}>
                  {voice.supported ? (
                    <button
                      type="button"
                      className={s.voiceButton}
                      disabled={busy}
                      aria-pressed={voice.listening}
                      onClick={voice.listen}
                    >
                      <Icon type={voice.listening ? "stop" : "mic"} />
                      {voice.listening
                        ? t("Escuchando · detener", "Listening · stop")
                        : t("Hablar", "Speak")}
                    </button>
                  ) : (
                    <span className={s.note}>
                      {t(
                        "Voz no disponible en este navegador",
                        "Voice unavailable in this browser",
                      )}
                    </span>
                  )}
                  {voice.speaking && (
                    <button
                      type="button"
                      className={s.voiceButton}
                      onClick={() => {
                        autoSpeak.current = false;
                        voice.silence();
                      }}
                    >
                      <Icon type="stop" />
                      {t("Silenciar", "Mute")}
                    </button>
                  )}
                </div>
                <button
                  className="btn on"
                  disabled={busy || !draft.trim()}
                  type="submit"
                >
                  <Icon type="send" />
                  {busy ? t("Enviando…", "Sending…") : t("Enviar", "Send")}
                </button>
              </div>
              <p className={s.note}>
                {voice.error ||
                  t(
                    "La voz usa el servicio del navegador. Silenciar detiene el audio; los trabajos se cancelan desde su ficha.",
                    "Voice uses the browser’s service. Muting stops audio; cancel work from its task details.",
                  )}
              </p>
            </form>
          </section>
          <aside className={s.work}>
            <div className={s.workHeading}>
              <h2>{t("En tu equipo", "Your team")}</h2>
              <button
                className={s.textButton}
                disabled={busy}
                onClick={() => void mutate({ action: "work" })}
              >
                {t("Actualizar", "Refresh")}
              </button>
            </div>
            <div className={s.specialists}>
              {[
                ["investigacion", "Investigación y SEO", "Research & SEO"],
                ["redaccion", "Redacción", "Copywriting"],
                ["diseno", "Diseño y video", "Design & video"],
              ].map(([key, es, en]) => (
                <div key={key}>
                  <span
                    className={`${s.dot} ${active?.steps.at(-1)?.specialist === key ? s.live : ""}`}
                  />
                  <strong>{t(es, en)}</strong>
                  <span>
                    {active?.steps.at(-1)?.specialist === key
                      ? t("En curso", "In progress")
                      : t("Disponible", "Available")}
                  </span>
                </div>
              ))}
            </div>
            <div className={s.workHeading}>
              <h2>{t("Trabajos recientes", "Recent work")}</h2>
              <span>{data.runs.length}</span>
            </div>
            {!data.runs.length ? (
              <p className={s.empty}>
                {t(
                  "Tu primer encargo aparecerá aquí con sus pasos y resultados.",
                  "Your first task will appear here with its steps and results.",
                )}
              </p>
            ) : (
              data.runs
                .slice(0, 8)
                .map((r) => (
                  <RunCard
                    key={r.id}
                    run={r}
                    businessId={businessId}
                    busy={busy}
                    act={(action) => mutate({ action, runId: r.id })}
                  />
                ))
            )}
            {exceptions.length > 0 && (
              <div className={s.attention}>
                <h3>{t("Publicaciones que revisar", "Posts to review")}</h3>
                <p>
                  {t(
                    `${exceptions.length} de las últimas publicaciones tienen un error o un envío pendiente.`,
                    `${exceptions.length} recent posts have an error or a pending delivery.`,
                  )}
                </p>
                <Link href={`/b/${businessId}/historial?ver=error`}>
                  {t("Ver historial", "View history")} →
                </Link>
              </div>
            )}
            <div className={s.budget}>
              <span>{t("IA utilizada hoy", "AI used today")}</span>
              <strong>
                {usd(data.budget?.chargedCents ?? 0)}{" "}
                <small>/ {usd(data.settings?.dailyBudgetCents ?? 0)}</small>
              </strong>
              <p>
                {t("Reservado", "Reserved")}:{" "}
                {usd(data.budget?.reservedCents ?? 0)}
              </p>
            </div>
          </aside>
        </div>
      )}
      {tab === "knowledge" && (
        <section className={s.knowledge}>
          <div className={s.sectionTitle}>
            <h2>{data.industry.name}</h2>
            <p>{data.industry.geography}</p>
          </div>
          <h3>{t("A quién ayudamos", "Who we help")}</h3>
          <p>{data.industry.audience}</p>
          <h3>{t("Lo que debe conocer", "What MATYA should know")}</h3>
          <ul>
            {data.industry.focus.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <h3>
            {t(
              "Objetivo y memoria del negocio",
              "Business objective and memory",
            )}
          </h3>
          <p>
            {data.settings?.objective ||
              t(
                "Aún no has definido un objetivo.",
                "No objective has been defined yet.",
              )}
          </p>
          <p className={s.pre}>
            {data.settings?.memory ||
              t(
                "Aquí se guardan tus preferencias y decisiones.",
                "Your preferences and decisions are saved here.",
              )}
          </p>
          <h3>{t("Conocimiento con fuentes", "Knowledge with sources")}</h3>
          {data.settings?.knowledge.map((k, i) => (
            <article className={s.source} key={i}>
              <p>{k.fact}</p>
              <a href={safeHref(k.url)} target="_blank" rel="noreferrer">
                {k.url}
              </a>
              <small>
                {t("Vigente hasta", "Valid until")} {k.expiresAt.slice(0, 10)}
              </small>
            </article>
          ))}
          <button className="btn outline" onClick={() => setTab("settings")}>
            {t("Editar conocimiento y fuentes", "Edit knowledge and sources")}
          </button>
          <h3>{t("Todas tus herramientas", "All your tools")}</h3>
          <div className={s.toolList}>
            {data.tools.map((tool) => (
              <Link href={tool.href} key={tool.href}>
                {tool.name}
                <Icon type="arrow" />
              </Link>
            ))}
          </div>
        </section>
      )}
      {tab === "news" && (
        <section className={s.news}>
          <div className={s.sectionTitle}>
            <h2>
              {t(
                "Lo que cambia en tu industria",
                "What’s changing in your industry",
              )}
            </h2>
            <p>
              {t(
                "Fuentes, fechas y relevancia antes de crear contenido.",
                "Sources, dates and relevance before creating content.",
              )}
            </p>
            <button
              className="btn on"
              disabled={busy}
              onClick={() =>
                void send(
                  t(
                    "Revisa las noticias de mi industria",
                    "Check my industry news",
                  ),
                  { kind: "radar" },
                )
              }
            >
              {t("Revisar ahora", "Check now")}
            </button>
          </div>
          {!data.news.length ? (
            <div className={s.empty}>
              <h3>
                {t(
                  "Tu radar comienza con las fuentes correctas",
                  "Your radar starts with the right sources",
                )}
              </h3>
              <p>
                {t(
                  "Añade fuentes de tu industria y tu territorio. MATYA conservará su origen y marcará las noticias que necesitan verificación.",
                  "Add sources for your industry and territory. MATYA will retain their origin and flag stories that need verification.",
                )}
              </p>
              <button
                className="btn outline"
                onClick={() => setTab("settings")}
              >
                {t("Configurar fuentes", "Set up sources")}
              </button>
            </div>
          ) : (
            data.news.map((n) => (
              <NewsItem
                key={n.id}
                news={n}
                busy={busy}
                mutate={mutate}
                verify={() =>
                  send(`Contrasta la fuente original: ${n.title}`, {
                    kind: "verify_news",
                    newsId: n.id,
                  })
                }
                create={() =>
                  send(`Prepara contenido original sobre: ${n.title}`, {
                    kind: "campaign",
                    newsId: n.id,
                  })
                }
              />
            ))
          )}
        </section>
      )}
      {tab === "results" && (
        <section className={s.results}>
          <div className={s.sectionTitle}>
            <h2>
              {t("Decisiones con evidencia", "Decisions backed by evidence")}
            </h2>
            <p>
              {t(
                "Resultados reales, hipótesis y lo que todavía falta medir.",
                "Actual results, hypotheses and what still needs measurement.",
              )}
            </p>
            <button
              className="btn on"
              disabled={busy}
              onClick={() =>
                void send(
                  t(
                    "Analiza los resultados de mis campañas",
                    "Analyze my campaign results",
                  ),
                  { kind: "optimize" },
                )
              }
            >
              {t("Analizar campañas", "Analyze campaigns")}
            </button>
          </div>
          {data.runs
            .filter((r) => r.kind === "optimize")
            .map((r) => (
              <RunCard
                key={r.id}
                run={r}
                businessId={businessId}
                busy={busy}
                act={(action) => mutate({ action, runId: r.id })}
              />
            ))}
          <div className={s.toolList}>
            <Link href={`/b/${businessId}/resultados`}>
              {t("Ver resultados completos", "View full results")}
              <Icon type="arrow" />
            </Link>
            <Link href={`/b/${businessId}/anuncios`}>
              {t("Anuncios y presupuesto", "Ads and budget")}
              <Icon type="arrow" />
            </Link>
          </div>
          <h3>{t("Campañas del negocio", "Business campaigns")}</h3>
          {data.campaigns.map((c) => (
            <div className={s.campaign} key={c.id}>
              <Link href={`/b/${businessId}/campanas/${c.id}`}>{c.name}</Link>
              <span>{c.status}</span>
              {c.status === "active" && (
                <button
                  className="btn outline"
                  disabled={busy}
                  onClick={() =>
                    void send(`Pausa la campaña ${c.name}`, {
                      kind: "pause",
                      campaignId: c.id,
                    })
                  }
                >
                  {t("Pausar", "Pause")}
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {tab === "settings" && (
        <AgentSettings
          key={data.settings?.revision ?? 0}
          data={data}
          busy={busy}
          saveError={error}
          saveNotice={notice}
          save={async (settings) => {
            const ok = await mutate({ action: "settings", settings });
            if (ok)
              setNotice(
                t(
                  "Configuración guardada. Se aplica a los próximos encargos.",
                  "Settings saved. They apply to new tasks.",
                ),
              );
            return ok;
          }}
        />
      )}
    </div>
  );
}
function RunCard({
  run,
  businessId,
  busy,
  act,
}: {
  run: RunView;
  businessId: string;
  busy: boolean;
  act: (action: string) => Promise<boolean>;
}) {
  const { t } = useT();
  return (
    <details className={s.run}>
      <summary>
        <span className={s.runTitle}>{run.prompt}</span>
        <span className={s.runStatus} data-status={run.status}>
          {t(...(labels[run.status] ?? [run.status, run.status]))}
        </span>
      </summary>
      <ol className={s.steps}>
        {run.steps.map((step) => (
          <li key={step.name}>
            <strong>
              {t(
                ...(stepNames[step.name.split(":")[0]] ?? [
                  step.name,
                  step.name,
                ]),
              )}
            </strong>
            <span>
              {t(...(labels[step.status] ?? [step.status, step.status]))}
            </span>
            {step.error && <p>{step.error}</p>}
            <Output value={step.output} />
          </li>
        ))}
      </ol>
      {run.error && <p className={s.inlineError}>{run.error}</p>}
      <p className={s.note}>
        {t("Consumo registrado", "Recorded usage")}: {usd(run.chargedCents)} ·{" "}
        {t("Reserva", "Reserved")}: {usd(run.reservedCents)}
      </p>
      <div className={s.runActions}>
        {run.status === "waiting_approval" && (
          <button
            className="btn on"
            disabled={busy}
            onClick={() => void act("approve")}
          >
            {t("Aprobar publicación", "Approve publishing")}
          </button>
        )}
        {!["completed", "cancelled", "blocked", "uncertain"].includes(
          run.status,
        ) && (
          <button
            className="btn outline"
            disabled={busy}
            onClick={() => void act("cancel")}
          >
            {t("Cancelar trabajo", "Cancel task")}
          </button>
        )}
        {["campaign", "video"].includes(run.kind) && (
          <Link href={`/b/${businessId}/campanas`}>
            {t("Ver campañas", "View campaigns")}
          </Link>
        )}
      </div>
    </details>
  );
}
function Output({ value }: { value: Record<string, unknown> | null }) {
  if (!value) return null;
  return (
    <div className={s.output}>
      {[
        "text",
        "summary",
        "angle",
        "audience",
        "title",
        "script",
        "videoStatus",
      ].map((key) =>
        typeof value[key] === "string" ? (
          <p key={key}>{value[key] as string}</p>
        ) : null,
      )}
      {Array.isArray(value.assets) && (
        <div className={s.assets}>
          {value.assets.map(
            (a: { url?: string; shape?: string; alt?: string }, i) =>
              safeHref(a.url) ? (
                <a
                  key={i}
                  href={safeHref(a.url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Image
                    unoptimized
                    loading="lazy"
                    src={safeHref(a.url)!}
                    alt={a.alt ?? a.shape ?? "Diseño"}
                    width="160"
                    height="160"
                  />
                  <span>{a.shape}</span>
                </a>
              ) : null,
          )}
        </div>
      )}
      {value.variants && typeof value.variants === "object"
        ? Object.entries(value.variants).map(([channel, text]) =>
            typeof text === "string" ? (
              <details key={channel}>
                <summary>{channel}</summary>
                <p>{text}</p>
              </details>
            ) : null,
          )
        : null}
      {safeHref(value.videoUrl) && (
        <a href={safeHref(value.videoUrl)} target="_blank" rel="noreferrer">
          Ver video
        </a>
      )}
      {Array.isArray(value.facts) &&
        value.facts.map((f: { text: string; source: string }, i) => (
          <p key={i}>
            {f.text}{" "}
            <a href={safeHref(f.source)} target="_blank" rel="noreferrer">
              Fuente
            </a>
          </p>
        ))}
      {Array.isArray(value.uncertainties) &&
        value.uncertainties.map((u: string, i) => (
          <p className={s.note} key={i}>
            {u}
          </p>
        ))}
      {Array.isArray(value.decisions) &&
        value.decisions.map(
          (
            d: {
              campaignId: string;
              name: string;
              decision: string;
              reason: string;
            },
            i,
          ) => (
            <p key={i}>
              <strong>{d.name}</strong>
              <br />
              {d.decision}
              <br />
              {d.reason}
            </p>
          ),
        )}
      {Array.isArray(value.channels) &&
        value.channels
          .filter((x) => typeof x === "object")
          .map((c: { channel: string; status: string; url?: string }, i) => (
            <p key={i}>
              {c.channel}: {c.status}{" "}
              {safeHref(c.url) && (
                <a href={safeHref(c.url)} target="_blank" rel="noreferrer">
                  Ver resultado
                </a>
              )}
            </p>
          ))}
    </div>
  );
}
function NewsItem({
  news,
  busy,
  mutate,
  create,
  verify,
}: {
  news: NewsView;
  busy: boolean;
  mutate: (body: Record<string, unknown>) => Promise<boolean>;
  create: () => Promise<void>;
  verify: () => Promise<void>;
}) {
  const { t } = useT();
  return (
    <article className={s.newsItem}>
      <div className={s.newsMeta}>
        <span>{news.source}</span>
        <time>
          {news.publishedAt?.slice(0, 10) ??
            t("Fecha sin confirmar", "Date unconfirmed")}
        </time>
        <span>
          {news.status === "verified"
            ? t("Contrastada", "Verified")
            : news.status === "changed"
              ? t("La fuente cambió", "Source changed")
              : news.status === "stale"
                ? t("Fecha por revisar", "Review date")
                : t("Por contrastar", "Needs verification")}
        </span>
      </div>
      <h3>
        <a href={safeHref(news.canonicalUrl)} target="_blank" rel="noreferrer">
          {news.title}
        </a>
      </h3>
      <p>{news.summary}</p>
      {news.status === "verified" ? (
        <button
          className="btn outline"
          disabled={busy}
          onClick={() => void create()}
        >
          {t("Crear contenido original", "Create original content")}
        </button>
      ) : (
        <>
          <button
            className="btn outline"
            disabled={busy || news.status === "stale"}
            onClick={() => void verify()}
          >
            {t("MATYA, contrasta esta noticia", "MATYA, verify this story")}
          </button>
          <details>
            <summary>
              {t(
                "Registrar verificación de la fuente",
                "Record source verification",
              )}
            </summary>
            <form
              className={s.verifyForm}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void mutate({
                  action: "verify_news",
                  newsId: news.id,
                  eventDate: f.get("date"),
                  factStatus: f.get("status"),
                  summary: f.get("summary"),
                });
              }}
            >
              <label>
                {t("Fecha del hecho", "Event date")}
                <input name="date" type="date" required />
              </label>
              <label>
                {t("Estado del hecho", "Event status")}
                <select name="status">
                  <option value="not_legal">
                    {t("Noticia sectorial", "Industry news")}
                  </option>
                  <option value="proposed">
                    {t("Propuesta de ley", "Proposed law")}
                  </option>
                  <option value="approved">
                    {t("Ley aprobada", "Approved law")}
                  </option>
                  <option value="effective">
                    {t("Norma vigente", "In effect")}
                  </option>
                </select>
              </label>
              <label>
                {t(
                  "Hechos comprobados en la fuente primaria",
                  "Facts checked against the primary source",
                )}
                <textarea
                  name="summary"
                  minLength={30}
                  maxLength={2000}
                  required
                />
              </label>
              <button className="btn outline" disabled={busy}>
                {t("Guardar verificación", "Save verification")}
              </button>
            </form>
          </details>
        </>
      )}
    </article>
  );
}
