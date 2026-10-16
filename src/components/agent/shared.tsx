import Image from "next/image";
import type { T } from "@/lib/i18n";
import s from "./AgentCenter.module.css";

export const labels: Record<string, [string, string]> = {
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
export const stepNames: Record<string, [string, string]> = {
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
  plan: ["Plan del Director", "Director's plan"],
  strategy: ["Estrategia", "Strategy"],
  dispatch: ["Piezas creadas", "Pieces created"],
  review: ["Revisión editorial", "Editorial review"],
  render: ["Generación del video", "Video render"],
  article: ["Artículo", "Article"],
  article_publish: ["Publicación en la web", "Website publishing"],
};
export const usd = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    v / 100,
  );
export const safeHref = (v: unknown) =>
  typeof v === "string" &&
  (/^https:\/\//.test(v) || /^\/b\//.test(v) || /^\/media\//.test(v))
    ? v
    : undefined;

/**
 * The name of a step as the owner reads it. A step of the team keeps its base name when it is a round (`copy-r1`, shown as
 * "Redacción (vuelta 1)") or a wait/publication pass (`video_wait:3`, `article_publish:2`); a name nobody knows is shown as is.
 */
export function stepLabel(name: string, t: T): string {
  const round = /-r(\d+)$/.exec(name);
  const base = name.replace(/-r\d+$/, "").split(":")[0];
  const [es, en] = stepNames[base] ?? [name, name];
  return round ? `${t(es, en)} ${t(`(vuelta ${round[1]})`, `(round ${round[1]})`)}` : t(es, en);
}

export function Output({ value }: { value: Record<string, unknown> | null }) {
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
