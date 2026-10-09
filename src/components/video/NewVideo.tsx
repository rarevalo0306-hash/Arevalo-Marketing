"use client";

// «Nuevo video»: 1) de qué es (idea del plan, de las ideas o escrita) y la forma; 2) las fotos y clips reales.
// Luego la IA escribe el guion.
import { useEffect, useState, useTransition } from "react";
import { useT } from "@/components/I18n";
import { LibraryPicker } from "@/components/library/LibraryPicker";
import type { LibraryCard } from "@/lib/library-match";
import { fmtDuration } from "@/lib/library-match";
import { MAX_MEDIA_SCENES, type VideoFormat } from "@/lib/video-plan";
import type { VideoResult } from "@/app/actions-video";
import s from "./video.module.css";

export type IdeaOption = { id: string; label: string; idea: string; why: string; from: "plan" | "idea" };
export type PickItem = { id: string; kind: "photo" | "video"; thumb: string; desc: string; durationSec: number };

type Props = {
  ideas: IdeaOption[];
  library: PickItem[];
  libraryHref: string;
  suggest: (idea: string, format: VideoFormat) => Promise<string[]>;
  plan: (input: { idea: string; format: VideoFormat; mediaIds: string[] }) => Promise<VideoResult>;
  pickerLoad: () => Promise<LibraryCard[]>;
  onCreated: (r: Extract<VideoResult, { ok: true }>["video"]) => void;
  onCancel: () => void;
  initialIdea?: string;
};

export function NewVideo({ ideas, library, libraryHref, suggest, plan, pickerLoad, onCreated, onCancel, initialIdea = "" }: Props) {
  const { t } = useT();
  const [step, setStep] = useState<1 | 2>(1);
  const [format, setFormat] = useState<VideoFormat>("vertical");
  const [idea, setIdea] = useState(initialIdea);
  const [picked, setPicked] = useState<string[]>([]);
  const [extra, setExtra] = useState<PickItem[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, start] = useTransition();
  const items = [...library, ...extra.filter((x) => !library.some((l) => l.id === x.id))];

  // Al llegar a las fotos, la app elige las que mejor van con la idea (el dueño puede cambiarlas).
  useEffect(() => {
    if (step !== 2 || picked.length) return;
    let alive = true;
    setSuggesting(true);
    suggest(idea, format)
      .then((ids) => alive && setPicked(ids.filter((id) => items.some((x) => x.id === id)).slice(0, MAX_MEDIA_SCENES)))
      .finally(() => alive && setSuggesting(false));
    return () => {
      alive = false;
    };
    // Solo al entrar al paso 2.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_MEDIA_SCENES ? cur : [...cur, id]));

  function create() {
    setError("");
    start(async () => {
      const r = await plan({ idea, format, mediaIds: picked });
      if (r.ok) onCreated(r.video);
      else setError(r.error);
    });
  }

  if (pending)
    return (
      <div className={`card ${s.writing}`} role="status" aria-live="polite">
        <span className={s.spinner} aria-hidden="true" />
        <strong>{t("La IA está escribiendo el guion…", "The AI is writing the storyboard…")}</strong>
        <span className="small muted">{t("Elige el gancho, los textos de cada escena y los textos para cada red. Tarda unos segundos.", "It picks the hook, the text for each scene and the text for each network. It takes a few seconds.")}</span>
      </div>
    );

  return (
    <section className={`card ${s.newCard}`} aria-labelledby="nv-title">
      <div className="row between">
        <h2 id="nv-title">{t("Nuevo video", "New video")}</h2>
        <span className="small muted">{t(`Paso ${step} de 2`, `Step ${step} of 2`)}</span>
      </div>

      {step === 1 ? (
        <>
          <fieldset className={s.fieldset}>
            <legend className={s.legend}>{t("¿Dónde lo vas a publicar?", "Where will you post it?")}</legend>
            <div className={s.formats}>
              <label className={`chip ${format === "vertical" ? "on" : ""} ${s.formatChip}`}>
                <input type="radio" name="format" checked={format === "vertical"} onChange={() => setFormat("vertical")} />
                <span className={s.shapeV} aria-hidden="true" />
                <span className="stack" style={{ gap: 2 }}>
                  <strong>{t("Vertical", "Vertical")}</strong>
                  <span className="sub">{t("Reels, TikTok y YouTube Shorts · 15 a 30 s", "Reels, TikTok and YouTube Shorts · 15 to 30 s")}</span>
                </span>
              </label>
              <label className={`chip ${format === "horizontal" ? "on" : ""} ${s.formatChip}`}>
                <input type="radio" name="format" checked={format === "horizontal"} onChange={() => setFormat("horizontal")} />
                <span className={s.shapeH} aria-hidden="true" />
                <span className="stack" style={{ gap: 2 }}>
                  <strong>{t("Horizontal", "Horizontal")}</strong>
                  <span className="sub">{t("YouTube y Facebook · 20 a 60 s", "YouTube and Facebook · 20 to 60 s")}</span>
                </span>
              </label>
            </div>
          </fieldset>

          {ideas.length > 0 && (
            <div className="stack">
              <span className={s.legend}>{t("Ideas para ti", "Ideas for you")}</span>
              <div className={s.ideaList}>
                {ideas.map((x) => (
                  <button key={x.id} type="button" className={`${s.idea} ${idea === x.idea ? s.ideaOn : ""}`} onClick={() => setIdea(x.idea)} aria-pressed={idea === x.idea}>
                    <span className={s.ideaFrom}>{x.from === "plan" ? t("Del plan de acción", "From the action plan") : t("Idea", "Idea")}</span>
                    <strong>{x.label}</strong>
                    {x.why && <span className="small muted">{x.why}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="stack">
            <label htmlFor="nv-idea" className={s.legend}>
              {t("¿De qué es el video?", "What is the video about?")}
            </label>
            <textarea
              id="nv-idea"
              className="field"
              rows={3}
              maxLength={2000}
              placeholder={t("Ej.: mostrar la instalación de una cortina metálica en un local de Managua", "E.g., show the installation of a roll-up door at a store")}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
            />
          </div>
          <div className={s.actions}>
            <button type="button" className="btn" onClick={onCancel}>
              {t("Cancelar", "Cancel")}
            </button>
            <button type="button" className="btn on" disabled={!idea.trim()} onClick={() => setStep(2)}>
              {t("Siguiente: elegir fotos", "Next: pick photos")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {t(
              `Elige de 1 a ${MAX_MEDIA_SCENES} fotos o clips reales de tu trabajo, en el orden que quieras. La primera abre el video.`,
              `Pick 1 to ${MAX_MEDIA_SCENES} real photos or clips of your work, in the order you like. The first one opens the video.`,
            )}
          </p>
          {suggesting && (
            <p className="small muted" role="status" style={{ margin: 0 }}>
              {t("Buscando las fotos que mejor van con la idea…", "Finding the photos that best fit the idea…")}
            </p>
          )}
          {items.length === 0 ? (
            <div className="note">
              {t("Todavía no hay fotos listas para usar. ", "There are no photos ready to use yet. ")}
              <a href={libraryHref}>{t("Ir a Tus fotos", "Go to Your photos")}</a>
            </div>
          ) : (
            <ul className={s.pickGrid} aria-label={t("Tus fotos y clips", "Your photos and clips")}>
              {items.map((x) => {
                const n = picked.indexOf(x.id);
                return (
                  <li key={x.id}>
                    <button type="button" className={`${s.pick} ${n >= 0 ? s.pickOn : ""}`} onClick={() => toggle(x.id)} aria-pressed={n >= 0} title={x.desc}>
                      {x.thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element -- miniatura guardada
                        <img src={x.thumb} alt={x.desc} loading="lazy" />
                      ) : (
                        <span className={s.pickNo} aria-hidden="true">▶</span>
                      )}
                      {x.kind === "video" && <span className={s.pickBadge}>▶ {x.durationSec > 0 ? fmtDuration(x.durationSec) : t("Clip", "Clip")}</span>}
                      {n >= 0 && <span className={s.pickNum}>{n + 1}</span>}
                      <span className="sr-only">{n >= 0 ? t(` (elegida, número ${n + 1})`, ` (picked, number ${n + 1})`) : ""}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="row">
            <button type="button" className="btn small" onClick={() => setPickerOpen(true)}>
              {t("Buscar en tus fotos", "Search your photos")}
            </button>
            {picked.length > 0 && (
              <button type="button" className="btn small link" onClick={() => setPicked([])}>
                {t("Quitar todas", "Clear all")}
              </button>
            )}
            <span className="small muted">{t(`${picked.length} elegidas`, `${picked.length} picked`)}</span>
          </div>
          {pickerOpen && (
            <LibraryPicker
              onClose={() => setPickerOpen(false)}
              load={pickerLoad}
              manageHref={libraryHref}
              onPick={async (c) => {
                if (!items.some((x) => x.id === c.id)) setExtra((e) => [...e, { id: c.id, kind: c.kind, thumb: c.thumb, desc: c.description?.es ?? c.name, durationSec: c.durationSec }]);
                setPicked((cur) => (cur.includes(c.id) || cur.length >= MAX_MEDIA_SCENES ? cur : [...cur, c.id]));
                return "";
              }}
            />
          )}
          {error && (
            <p className="note error" role="alert">
              {error}
            </p>
          )}
          <div className={s.actions}>
            <button type="button" className="btn" onClick={() => setStep(1)}>
              {t("Atrás", "Back")}
            </button>
            <button type="button" className="btn ai" disabled={!picked.length} onClick={create}>
              ✦ {t("Escribir el guion con IA", "Write the storyboard with AI")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
