"use client";

// El guion de un video: vista previa animada, escenas (texto, movimiento, orden), música, textos de cada red,
// «Crear video (~US$X)» con confirmación, avance y, al final, el video y «Publicar».
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useT } from "@/components/I18n";
import { VideoProgress } from "@/components/VideoProgress";
import type { PublishVideoResult, VideoResult, VideoView } from "@/app/actions-video";
import {
  applyEdits,
  CAPTION_WORDS,
  estimateCostCents,
  MIN_MEDIA_SCENES,
  MOTIONS,
  tagsLength,
  totalSec,
  usd,
  type Motion,
  type SceneEdit,
  type VideoTexts,
} from "@/lib/video-plan";
import { PublishVideo, type ChannelState } from "./PublishVideo";
import { VideoPreview } from "./VideoPreview";
import s from "./video.module.css";

export type EditorActions = {
  save: (id: string, edits: { scenes: SceneEdit[]; texts?: Partial<VideoTexts>; music?: boolean }) => Promise<VideoResult>;
  still: (id: string, sceneId: string) => Promise<{ ok: true; src: string } | { ok: false; error: string }>;
  start: (id: string, cents: number) => Promise<VideoResult>;
  check: (id: string) => Promise<VideoResult>;
  publish: (id: string, f: FormData) => Promise<PublishVideoResult>;
};

type Props = {
  video: VideoView;
  actions: EditorActions;
  /** "fal" = falta la clave de fal.ai; "storage" = falta el almacenamiento; null = se puede crear. */
  blocker: "fal" | "storage" | null;
  maxCents: number;
  channels: ChannelState[];
  connectHref: string;
  historyHref: string;
  onChange: (v: VideoView) => void;
  onClose: () => void;
};

const MOTION_LABEL: Record<Motion, { es: string; en: string }> = {
  "zoom-in": { es: "Acercar", en: "Zoom in" },
  "zoom-out": { es: "Alejar", en: "Zoom out" },
  "pan-left": { es: "Mover a la izquierda", en: "Pan left" },
  "pan-right": { es: "Mover a la derecha", en: "Pan right" },
  still: { es: "Quieta", en: "Still" },
};

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const editsOf = (v: VideoView): SceneEdit[] => v.project.storyboard.scenes.map((sc) => ({ id: sc.id, caption: sc.caption, motion: sc.motion, mediaId: sc.mediaId }));

export function VideoEditor({ video, actions, blocker, maxCents, channels, connectHref, historyHref, onChange, onClose }: Props) {
  const { lang, t } = useT();
  const p = video.project;
  const [scenes, setScenes] = useState<SceneEdit[]>(() => editsOf(video));
  const [texts, setTexts] = useState<VideoTexts>(p.storyboard.texts);
  const [music, setMusic] = useState(p.storyboard.music.on);
  const [tagsRaw, setTagsRaw] = useState(p.storyboard.texts.tags.join(", "));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [stills, setStills] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const savedRef = useRef(JSON.stringify({ s: editsOf(video), t: p.storyboard.texts, m: p.storyboard.music.on }));

  // Al cambiar de video (o al volver del servidor), se parte de lo guardado.
  useEffect(() => {
    setScenes(editsOf(video));
    setTexts(video.project.storyboard.texts);
    setMusic(video.project.storyboard.music.on);
    setTagsRaw(video.project.storyboard.texts.tags.join(", "));
    savedRef.current = JSON.stringify({ s: editsOf(video), t: video.project.storyboard.texts, m: video.project.storyboard.music.on });
  }, [video]);

  const parsedTags = tagsRaw.split(",").map((x) => x.trim()).filter(Boolean);
  const allTexts: VideoTexts = { ...texts, tags: parsedTags };
  const dirty = JSON.stringify({ s: scenes, t: allTexts, m: music }) !== savedRef.current;
  // Vista previa con los cambios (las mismas reglas que el servidor).
  const preview = useMemo(() => ({ ...applyEdits(p.storyboard, scenes), music: { ...p.storyboard.music, on: music } }), [p.storyboard, scenes, music]);
  const cost = estimateCostCents({ totalSec: totalSec(preview.scenes), music });
  const rendering = p.status === "rendering";

  // Mientras se crea, se pregunta cada 5 segundos.
  useEffect(() => {
    if (!rendering) return;
    let alive = true;
    const id = setInterval(async () => {
      const r = await actions.check(video.id);
      if (!alive) return;
      if (r.ok) {
        if (r.video.project.status !== "rendering" || r.video.project.job?.stage !== p.job?.stage) onChange(r.video);
      } else setError(r.error);
    }, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [rendering, video.id, actions, onChange, p.job?.stage]);

  const mediaOf = (id: string) => p.storyboard.media.find((m) => m.id === id);
  const outroId = p.storyboard.scenes.find((x) => x.role === "outro")?.id ?? "";
  const bodyCount = scenes.filter((x) => x.id !== outroId).length;

  function move(i: number, d: -1 | 1) {
    setScenes((cur) => {
      const j = i + d;
      if (j < 0 || j >= cur.length || cur[j].id === outroId || cur[i].id === outroId) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  const setScene = (id: string, patch: Partial<SceneEdit>) => setScenes((cur) => cur.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  async function save(): Promise<VideoView | null> {
    const r = await actions.save(video.id, { scenes, texts: allTexts, music });
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    onChange(r.video);
    return r.video;
  }

  function onSave() {
    setError("");
    start(async () => {
      await save();
    });
  }

  function onCreate() {
    setError("");
    start(async () => {
      const v = dirty ? await save() : video;
      if (!v) return;
      const r = await actions.start(v.id, estimateCostCents({ totalSec: totalSec(v.project.storyboard.scenes), music: v.project.storyboard.music.on }));
      setConfirming(false);
      if (r.ok) onChange(r.video);
      else setError(r.error);
    });
  }

  function showStill(sceneId: string) {
    setError("");
    start(async () => {
      if (dirty && !(await save())) return;
      const r = await actions.still(video.id, sceneId);
      if (r.ok) setStills((m) => ({ ...m, [sceneId]: r.src }));
      else setError(r.error);
    });
  }

  const statusPill =
    p.status === "ready" ? <span className="pill done">{t("Listo", "Ready")}</span> :
    p.status === "rendering" ? <span className="pill publishing">{t("Creando…", "Creating…")}</span> :
    p.status === "failed" ? <span className="pill failed">{t("No se pudo crear", "Couldn't create")}</span> :
    p.status === "published" ? <span className="pill sent">{t("Publicado", "Posted")}</span> :
    <span className="pill draft">{t("Guion", "Storyboard")}</span>;

  return (
    <section className={`card ${s.editor}`} aria-labelledby="ve-title">
      <div className={s.editorHead}>
        <button type="button" className="btn small" onClick={onClose}>
          ← {t("Mis videos", "My videos")}
        </button>
        {statusPill}
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <h2 id="ve-title" className={s.editorTitle}>{texts.title || p.storyboard.idea}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          {p.storyboard.format === "vertical" ? t("Vertical 9:16 · Reels, TikTok y Shorts", "Vertical 9:16 · Reels, TikTok and Shorts") : t("Horizontal 16:9 · YouTube", "Horizontal 16:9 · YouTube")}
          {" · "}
          {t(`${totalSec(preview.scenes)} segundos`, `${totalSec(preview.scenes)} seconds`)}
          {p.storyboard.keyword && (
            <>
              {" · "}
              {t("Palabra clave: ", "Keyword: ")}
              <strong>{p.storyboard.keyword}</strong>
            </>
          )}
          {p.storyboard.source === "template" && t(" · Guion básico (la IA no respondió)", " · Basic storyboard (the AI didn't respond)")}
        </p>
      </div>

      <div className={s.editorGrid}>
        <div className={s.editorPreview}>
          {(p.status === "ready" || p.status === "published") && p.videoUrl && !dirty ? (
            <div className={s.previewWrap}>
              <video className={`${s.final} ${p.storyboard.format === "vertical" ? s.screenV : s.screenH}`} src={p.videoUrl} poster={p.thumbUrl || undefined} controls playsInline />
              <a className="btn small" href={p.videoUrl} download>
                {t("Descargar el video", "Download the video")}
              </a>
            </div>
          ) : (
            <VideoPreview sb={preview} />
          )}
          {!(p.status === "ready" || p.status === "published") && (
            <p className="small muted" style={{ margin: 0, textAlign: "center" }}>
              {t("Vista previa en tu navegador (gratis). El video final se ve casi igual.", "Preview in your browser (free). The final video looks almost the same.")}
            </p>
          )}
        </div>

        <div className={s.editorSide}>
          {rendering ? (
            <div className={`stack ${s.box}`}>
              <strong>{p.job?.stage === "music" ? t("Creando la música…", "Creating the music…") : t("Uniendo las escenas…", "Putting the scenes together…")}</strong>
              <VideoProgress startedAt={p.job?.startedAt ?? Date.now()} etaSec={p.job?.etaSec ?? 90} />
              <span className="small muted">{t("Puedes salir de esta página: el video sigue creándose y lo verás en «Mis videos».", "You can leave this page: the video keeps being made and you'll see it in \"My videos\".")}</span>
            </div>
          ) : (
            <>
              <ol className={s.scenes} aria-label={t("Escenas", "Scenes")}>
                {scenes.map((sc, i) => {
                  const isOutro = sc.id === outroId;
                  const m = mediaOf(sc.mediaId ?? "");
                  const n = words(sc.caption);
                  const role = i === 0 ? t("Gancho (primeros 2 s)", "Hook (first 2 s)") : isOutro ? t("Cierre con tu marca", "Brand closing") : t(`Escena ${i + 1}`, `Scene ${i + 1}`);
                  const dur = preview.scenes.find((x) => x.id === sc.id)?.durationSec;
                  return (
                    <li key={sc.id} className={`${s.scene} ${isOutro ? s.sceneOutro : ""}`}>
                      <div className={s.sceneThumb}>
                        {isOutro ? (
                          <span className={s.sceneBrand} style={{ background: p.storyboard.outro.color }} aria-hidden="true">
                            {p.storyboard.outro.name.slice(0, 2).toUpperCase()}
                          </span>
                        ) : m?.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element -- miniatura de la foto real
                          <img src={m.thumb} alt="" />
                        ) : (
                          <span className={s.sceneBrand} aria-hidden="true">▶</span>
                        )}
                      </div>
                      <div className={s.sceneBody}>
                        <div className={s.sceneTop}>
                          <strong>{role}</strong>
                          {dur !== undefined && <span className="small muted">{dur} s</span>}
                        </div>
                        <label className="sr-only" htmlFor={`cap-${sc.id}`}>
                          {t("Texto de la escena", "Scene text")}
                        </label>
                        <input
                          id={`cap-${sc.id}`}
                          className="field"
                          value={sc.caption}
                          maxLength={80}
                          onChange={(e) => setScene(sc.id, { caption: e.target.value })}
                          placeholder={t("Texto corto (opcional)", "Short text (optional)")}
                        />
                        <span className={`small ${n > CAPTION_WORDS ? s.over : "muted"}`}>
                          {n > CAPTION_WORDS
                            ? t(`${n} palabras: se dejan las primeras ${CAPTION_WORDS}.`, `${n} words: only the first ${CAPTION_WORDS} are kept.`)
                            : t(`${n} de ${CAPTION_WORDS} palabras`, `${n} of ${CAPTION_WORDS} words`)}
                          {m?.kind === "video" && t(" · En los clips el texto no va encima (solo en las fotos).", " · On clips the text isn't placed on top (only on photos).")}
                        </span>
                        {!isOutro && (
                          <div className={s.sceneTools}>
                            {m?.kind !== "video" && (
                              <>
                                <label className="sr-only" htmlFor={`mo-${sc.id}`}>
                                  {t("Movimiento", "Movement")}
                                </label>
                                <select id={`mo-${sc.id}`} className={`field ${s.motion}`} value={sc.motion} onChange={(e) => setScene(sc.id, { motion: e.target.value as Motion })}>
                                  {MOTIONS.map((mo) => (
                                    <option key={mo} value={mo}>
                                      {MOTION_LABEL[mo][lang]}
                                    </option>
                                  ))}
                                </select>
                              </>
                            )}
                            <button type="button" className="btn small" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("Subir escena", "Move scene up")}>
                              ↑
                            </button>
                            <button type="button" className="btn small" onClick={() => move(i, 1)} disabled={i >= scenes.length - 2} aria-label={t("Bajar escena", "Move scene down")}>
                              ↓
                            </button>
                            <button
                              type="button"
                              className="btn small danger"
                              disabled={bodyCount <= MIN_MEDIA_SCENES}
                              title={bodyCount <= MIN_MEDIA_SCENES ? t(`El video necesita al menos ${MIN_MEDIA_SCENES} escenas`, `The video needs at least ${MIN_MEDIA_SCENES} scenes`) : undefined}
                              onClick={() => setScenes((cur) => cur.filter((x) => x.id !== sc.id))}
                            >
                              {t("Quitar", "Remove")}
                            </button>
                          </div>
                        )}
                        {(m?.kind !== "video" || isOutro) && (
                          stills[sc.id] ? (
                            <figure className={s.still}>
                              {/* eslint-disable-next-line @next/next/no-img-element -- cuadro dibujado por el servidor */}
                              <img src={stills[sc.id]} alt={t("Cuadro real de la escena", "Real frame of the scene")} />
                              <button type="button" className={`btn small link ${s.linkStart}`} onClick={() => setStills((x) => ({ ...x, [sc.id]: "" }))}>
                                {t("Ocultar", "Hide")}
                              </button>
                            </figure>
                          ) : (
                            <button type="button" className={`btn small link ${s.linkStart}`} disabled={pending} onClick={() => showStill(sc.id)}>
                              {t("Ver cómo queda (cuadro real)", "See how it looks (real frame)")}
                            </button>
                          )
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>

              <label className={`check ${s.music}`}>
                <input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} />
                <span className="stack" style={{ gap: 2 }}>
                  <strong>♪ {t("Música de fondo", "Background music")}{p.storyboard.music.mood ? ` · ${p.storyboard.music.mood}` : ""}{p.storyboard.music.bpm ? ` · ${p.storyboard.music.bpm} BPM` : ""}</strong>
                  <span className="small muted">{t("Instrumental, creada por IA y libre de derechos (según tu identidad de marca).", "Instrumental, AI-made and royalty-free (from your brand identity).")}</span>
                </span>
              </label>

              <details className={s.texts}>
                <summary>
                  <strong>{t("Textos para cada red", "Text for each network")}</strong>
                  <span className="small muted">{t(" · con tus palabras clave y tu ciudad", " · with your keywords and your city")}</span>
                </summary>
                <div className="stack" style={{ gap: 12, marginTop: 12 }}>
                  <TextField id="tx-title" label={t("Título de YouTube", "YouTube title")} value={texts.title} max={100} onChange={(v) => setTexts({ ...texts, title: v })} />
                  <TextField id="tx-desc" label={t("Descripción de YouTube", "YouTube description")} value={texts.description} max={5000} rows={5} onChange={(v) => setTexts({ ...texts, description: v })} />
                  <TextField
                    id="tx-tags"
                    label={t("Etiquetas de YouTube (separadas por comas)", "YouTube tags (comma separated)")}
                    value={tagsRaw}
                    max={500}
                    count={tagsLength(parsedTags)}
                    onChange={setTagsRaw}
                  />
                  {p.storyboard.format === "vertical" && <TextField id="tx-ig" label={t("Reel de Instagram", "Instagram Reel")} value={texts.instagram} max={2200} rows={4} onChange={(v) => setTexts({ ...texts, instagram: v })} />}
                  {p.storyboard.format === "vertical" && <TextField id="tx-tt" label="TikTok" value={texts.tiktok} max={2200} rows={4} onChange={(v) => setTexts({ ...texts, tiktok: v })} />}
                  <TextField id="tx-fb" label="Facebook" value={texts.facebook} max={5000} rows={4} onChange={(v) => setTexts({ ...texts, facebook: v })} />
                </div>
              </details>

              {dirty && (
                <button type="button" className="btn" disabled={pending} onClick={onSave}>
                  {pending ? t("Guardando…", "Saving…") : t("Guardar cambios", "Save changes")}
                </button>
              )}

              {p.status === "failed" && p.error && (
                <p className="note error" role="alert">
                  {t("No se pudo crear el video: ", "Couldn't create the video: ")}
                  {p.error}
                </p>
              )}

              {p.status !== "published" && (p.status !== "ready" || dirty) && (
                <div className={`stack ${s.box}`}>
                  {blocker ? (
                    <p className="note" style={{ margin: 0 }}>
                      {blocker === "fal"
                        ? t(
                            "Para crear el video falta conectar el servicio de videos (fal.ai) en la configuración. Puedes preparar el guion y ver la vista previa igual.",
                            "To create the video, the video service (fal.ai) needs to be set up first. You can still prepare the storyboard and see the preview.",
                          )
                        : t(
                            "Para crear el video hace falta el almacenamiento en la nube (Supabase). Puedes preparar el guion y ver la vista previa igual.",
                            "Creating the video needs cloud storage (Supabase). You can still prepare the storyboard and see the preview.",
                          )}
                    </p>
                  ) : cost > maxCents ? (
                    <p className="note" style={{ margin: 0 }}>
                      {t(`Este video costaría ${usd(cost)} y tu tope es ${usd(maxCents)}. Hazlo más corto o quita la música.`, `This video would cost ${usd(cost)} and your limit is ${usd(maxCents)}. Make it shorter or turn off the music.`)}
                    </p>
                  ) : confirming ? (
                    <div className="stack" role="group" aria-label={t("Confirmar el costo", "Confirm the cost")}>
                      <p style={{ margin: 0 }}>
                        <strong>{t(`Crear este video cuesta unos ${usd(cost)}`, `Creating this video costs about ${usd(cost)}`)}</strong>{" "}
                        {t("(se cobra en tu cuenta de fal.ai). Tarda 1 o 2 minutos.", "(charged to your fal.ai account). It takes 1 or 2 minutes.")}
                      </p>
                      <div className="row">
                        <button type="button" className="btn on" disabled={pending} onClick={onCreate}>
                          {pending ? t("Preparando las escenas…", "Preparing the scenes…") : t("Sí, crear el video", "Yes, create the video")}
                        </button>
                        <button type="button" className="btn" disabled={pending} onClick={() => setConfirming(false)}>
                          {t("Cancelar", "Cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="primary" disabled={pending} onClick={() => setConfirming(true)}>
                      {p.status === "failed" ? t(`Intentar de nuevo (~${usd(cost)})`, `Try again (~${usd(cost)})`) : t(`Crear video (~${usd(cost)})`, `Create video (~${usd(cost)})`)}
                    </button>
                  )}
                </div>
              )}
              {error && (
                <p className="note error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {(p.status === "ready" || p.status === "published") && p.videoUrl && !dirty && (
        <PublishVideo
          video={video}
          texts={allTexts}
          channels={channels}
          connectHref={connectHref}
          historyHref={historyHref}
          publish={(f) => actions.publish(video.id, f)}
        />
      )}
    </section>
  );
}

function TextField({ id, label, value, max, rows, count, onChange }: { id: string; label: string; value: string; max: number; rows?: number; count?: number; onChange: (v: string) => void }) {
  const n = count ?? value.length;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row between">
        <label htmlFor={id} className={s.legend}>
          {label}
        </label>
        <span className={`small ${n > max ? s.over : "muted"}`}>
          {n}/{max}
        </span>
      </div>
      {rows ? (
        <textarea id={id} className="field" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
