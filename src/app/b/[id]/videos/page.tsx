import { checkVideoRender, deleteVideo, planVideo, publishVideo, saveVideoEdits, startVideoRender, suggestVideoMedia, videoSceneStill } from "@/app/actions-video";
import { libraryForPicker } from "@/app/actions-library";
import { PageHead } from "@/components/PageHead";
import type { IdeaOption, PickItem } from "@/components/video/NewVideo";
import { VideoStudio } from "@/components/video/VideoStudio";
import { loadPlanTasks } from "@/lib/action-plan";
import { channelName } from "@/lib/channels";
import { loadContentIdeas } from "@/lib/content-ideas";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { usableLibrary } from "@/lib/library";
import { listProjects, maxCentsPerVideo, videoBlocker } from "@/lib/video-jobs";

// Dibujar y subir las escenas del video, y publicarlo, puede tardar.
export const maxDuration = 300;

export default async function VideosPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string; idea?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const { lang, t } = await getT();
  const b = await db.business.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, color: true, connections: { select: { channel: true } } } });
  const [projects, ideas, tasks, library] = await Promise.all([
    listProjects(id),
    loadContentIdeas(id, lang).catch(() => null),
    loadPlanTasks(id, lang, { status: "todo" }).catch(() => []),
    usableLibrary(id, 120).catch(() => []),
  ]);
  const connected = new Set(b.connections.map((c) => c.channel));
  const ideaOptions: IdeaOption[] = [
    // Del plan de acción: solo las tareas de contenido (las demás no son ideas para un video).
    ...tasks
      .filter((x) => x.area === "contenido")
      .slice(0, 1)
      .map((x) => ({ id: `plan-${x.id}`, label: x.title.slice(0, 90), idea: [x.title, x.detail].filter(Boolean).join(". ").slice(0, 600), why: "", from: "plan" as const })),
    ...(ideas?.ideas ?? []).slice(0, 4).map((x) => ({ id: `idea-${x.id}`, label: x.topic, idea: x.idea, why: x.why, from: "idea" as const })),
  ];
  const pick: PickItem[] = library.map((c) => ({ id: c.id, kind: c.kind, thumb: c.thumb, desc: (c.description ? c.description[lang] : "") || c.name, durationSec: c.durationSec }));
  const videos = projects.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), project: r.project }));

  return (
    <>
      <PageHead
        business={b}
        prefix={t("Videos de", "Videos for")}
        title={t("Videos", "Videos")}
        subtitle={t(
          "Reels, TikTok y YouTube con las fotos y videos reales de tu trabajo. Ves cómo queda gratis antes de crearlo, y siempre te decimos cuánto cuesta.",
          "Reels, TikToks and YouTube videos made from real photos and clips of your work. You see how it looks for free before making it, and we always tell you what it costs.",
        )}
      />
      <VideoStudio
        videos={videos}
        ideas={ideaOptions}
        library={pick}
        channels={["instagram", "tiktok", "youtube", "facebook"].map((c) => ({ id: c, name: channelName(c, lang), connected: connected.has(c) }))}
        blocker={videoBlocker()}
        maxCents={maxCentsPerVideo()}
        hrefs={{ library: `/b/${id}/fotos`, connect: `/b/${id}/conexiones`, history: `/b/${id}/historial` }}
        initialOpen={q.v}
        initialIdea={q.idea?.slice(0, 2000)}
        suggest={suggestVideoMedia.bind(null, id)}
        plan={planVideo.bind(null, id)}
        pickerLoad={libraryForPicker.bind(null, id)}
        remove={deleteVideo.bind(null, id)}
        actions={{
          save: saveVideoEdits.bind(null, id),
          still: videoSceneStill.bind(null, id),
          start: startVideoRender.bind(null, id),
          check: checkVideoRender.bind(null, id),
          publish: publishVideo.bind(null, id),
        }}
      />
    </>
  );
}
