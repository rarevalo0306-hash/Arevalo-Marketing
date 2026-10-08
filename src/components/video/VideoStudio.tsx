"use client";

// Sección «Videos»: la lista de videos (con su estado) y «Nuevo video» → guion → crear → publicar.
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { useT } from "@/components/I18n";
import type { LibraryCard } from "@/lib/library-match";
import { intlLocale } from "@/lib/i18n";
import type { VideoFormat } from "@/lib/video-plan";
import type { VideoResult, VideoView } from "@/app/actions-video";
import { NewVideo, type IdeaOption, type PickItem } from "./NewVideo";
import { VideoEditor, type EditorActions } from "./VideoEditor";
import type { ChannelState } from "./PublishVideo";
import s from "./video.module.css";

type Props = {
  videos: VideoView[];
  ideas: IdeaOption[];
  library: PickItem[];
  channels: ChannelState[];
  blocker: "fal" | "storage" | null;
  maxCents: number;
  hrefs: { library: string; connect: string; history: string };
  initialOpen?: string;
  initialIdea?: string;
  suggest: (idea: string, format: VideoFormat) => Promise<string[]>;
  plan: (input: { idea: string; format: VideoFormat; mediaIds: string[] }) => Promise<VideoResult>;
  pickerLoad: () => Promise<LibraryCard[]>;
  remove: (id: string) => Promise<void>;
  actions: EditorActions;
};

export function VideoStudio(p: Props) {
  const { lang, t } = useT();
  const router = useRouter();
  const [list, setList] = useState<VideoView[]>(p.videos);
  const [mode, setMode] = useState<"list" | "new" | "edit">(p.initialOpen && p.videos.some((v) => v.id === p.initialOpen) ? "edit" : p.initialIdea ? "new" : "list");
  const [openId, setOpenId] = useState(p.initialOpen ?? "");
  const [pending, start] = useTransition();
  const open = list.find((v) => v.id === openId) ?? null;
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" });

  const update = useCallback((v: VideoView) => setList((cur) => (cur.some((x) => x.id === v.id) ? cur.map((x) => (x.id === v.id ? v : x)) : [v, ...cur])), []);

  const statusPill = (v: VideoView) => {
    const st = v.project.status;
    if (st === "ready") return <span className="pill done">{t("Listo para publicar", "Ready to post")}</span>;
    if (st === "rendering") return <span className="pill publishing">{t("Creándose…", "Being created…")}</span>;
    if (st === "failed") return <span className="pill failed">{t("No se pudo crear", "Couldn't create")}</span>;
    if (st === "published") return <span className="pill sent">{t("Publicado", "Posted")}</span>;
    return <span className="pill draft">{t("Guion", "Storyboard")}</span>;
  };

  if (mode === "new")
    return (
      <NewVideo
        ideas={p.ideas}
        library={p.library}
        libraryHref={p.hrefs.library}
        suggest={p.suggest}
        plan={p.plan}
        pickerLoad={p.pickerLoad}
        initialIdea={p.initialIdea}
        onCancel={() => setMode("list")}
        onCreated={(v) => {
          update(v);
          setOpenId(v.id);
          setMode("edit");
        }}
      />
    );

  if (mode === "edit" && open)
    return (
      <VideoEditor
        video={open}
        actions={p.actions}
        blocker={p.blocker}
        maxCents={p.maxCents}
        channels={p.channels}
        connectHref={p.hrefs.connect}
        historyHref={p.hrefs.history}
        onChange={update}
        onClose={() => {
          setMode("list");
          router.refresh();
        }}
      />
    );

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className={`card ${s.hero}`}>
        <div className="stack" style={{ gap: 6 }}>
          <h2 style={{ margin: 0 }}>{t("Videos con tus fotos reales", "Videos with your real photos")}</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {t(
              "Reels, TikTok y YouTube Shorts de 15 a 30 segundos (o videos para YouTube) con tus fotos y clips, tu logo, tu eslogan y música. La IA escribe los textos con tus palabras clave.",
              "15–30 second Reels, TikToks and YouTube Shorts (or YouTube videos) with your photos and clips, your logo, your slogan and music. The AI writes the text with your keywords.",
            )}
          </p>
        </div>
        <button type="button" className="primary" onClick={() => setMode("new")}>
          + {t("Nuevo video", "New video")}
        </button>
      </div>

      {p.blocker && (
        <p className="note info" style={{ margin: 0 }}>
          {p.blocker === "fal"
            ? t(
                "Todavía falta conectar el servicio que crea los videos (fal.ai). Igual puedes preparar el guion y ver la vista previa; cuando esté conectado, lo creas con un botón.",
                "The service that makes the videos (fal.ai) isn't set up yet. You can still prepare the storyboard and see the preview; once it's set up, you create it with one button.",
              )
            : t(
                "Para crear los videos hace falta el almacenamiento en la nube (Supabase). Igual puedes preparar el guion y ver la vista previa.",
                "Creating videos needs cloud storage (Supabase). You can still prepare the storyboard and see the preview.",
              )}
        </p>
      )}

      <section className="stack" aria-labelledby="mv-title" style={{ gap: 10 }}>
        <h2 id="mv-title" className={s.listTitle}>
          {t("Mis videos", "My videos")} ({list.length})
        </h2>
        {list.length === 0 ? (
          <div className="card empty">{t("Todavía no hay videos. Presiona «Nuevo video» para hacer el primero.", "No videos yet. Click \"New video\" to make the first one.")}</div>
        ) : (
          <ul className={s.list}>
            {list.map((v) => {
              const sb = v.project.storyboard;
              const first = sb.media.find((m) => m.id === sb.scenes[0]?.mediaId) ?? sb.media[0];
              const thumb = v.project.thumbUrl || first?.thumb || "";
              return (
                <li key={v.id} className={`card ${s.item}`}>
                  <div className={`${s.itemThumb} ${sb.format === "vertical" ? s.itemV : s.itemH}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- miniatura guardada */}
                    {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span aria-hidden="true">▶</span>}
                  </div>
                  <div className={s.itemBody}>
                    <div className="row" style={{ gap: 6 }}>
                      {statusPill(v)}
                      <span className="small muted">{sb.format === "vertical" ? t("Vertical", "Vertical") : t("Horizontal", "Horizontal")}</span>
                    </div>
                    <strong className={s.itemTitle}>{sb.texts.title || sb.idea}</strong>
                    <span className="small muted">
                      {fmt.format(new Date(v.createdAt))}
                      {v.project.costCents > 0 && ` · US$${(v.project.costCents / 100).toFixed(2)}`}
                    </span>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        type="button"
                        className="btn small on"
                        onClick={() => {
                          setOpenId(v.id);
                          setMode("edit");
                        }}
                      >
                        {v.project.status === "ready" ? t("Ver y publicar", "View and post") : t("Abrir", "Open")}
                      </button>
                      <button
                        type="button"
                        className="btn small danger"
                        disabled={pending || v.project.status === "rendering"}
                        onClick={() => {
                          if (!window.confirm(t("¿Borrar este video de la lista? Lo que ya se publicó no se borra de las redes.", "Delete this video from the list? Anything already posted stays on the networks."))) return;
                          start(async () => {
                            await p.remove(v.id);
                            setList((cur) => cur.filter((x) => x.id !== v.id));
                          });
                        }}
                      >
                        {t("Borrar", "Delete")}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
