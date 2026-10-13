import { beforeEach, describe, expect, it, vi } from "vitest";

// publishPost con una base de datos falsa y publicadores falsos: nada sale a la red.
const mem = vi.hoisted(() => ({
  post: null as Record<string, unknown> | null,
  targets: new Map<string, { status: string; detail: string }>(),
  final: "",
}));
vi.mock("@/lib/db", () => ({
  db: {
    post: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async () => mem.post),
      update: vi.fn(async ({ data }: { data: { status: string } }) => {
        mem.final = data.status;
        return {};
      }),
    },
    postTarget: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { status: string; detail: string } }) => {
        mem.targets.set(where.id, { status: data.status, detail: data.detail });
        return {};
      }),
      findMany: vi.fn(async () => [...mem.targets.entries()].map(([id, t]) => ({ id, ...t }))),
    },
  },
}));
vi.mock("@/lib/publishers", () => ({
  PUBLISHERS: {
    youtube: { publish: vi.fn(async () => ({ detail: "Subido a YouTube como no listado; YouTube lo procesa en unos minutos. Id v1", url: "https://youtu.be/v1", id: "v1" })) },
    instagram: { publish: vi.fn(async () => ({ detail: "Publicado", url: "https://instagram.com/p/1", id: "ig1" })) },
  },
}));
vi.mock("@/lib/crypto", () => ({ decryptJson: () => ({}) }));
vi.mock("@/lib/media", () => ({ publicMediaUrl: (u: string) => u }));
vi.mock("@/lib/media-formats", () => ({ mediaForChannel: async (p: { mediaUrl: string }) => p.mediaUrl }));
vi.mock("@/lib/agent/publication", () => ({ claimAgentPost: vi.fn(async () => ({ count: 0 })) }));

import { publishPost } from "@/lib/publish";
import { PUBLISHERS } from "@/lib/publishers";
import { YOUTUBE_NEEDS_APPROVAL, YT_KEY, type YoutubeApproval } from "@/lib/youtube-options";

const VIDEO = "https://x.supabase.co/storage/v1/object/public/media/b/reel.mp4";
const approval: YoutubeApproval = {
  title: "Portones en Miami",
  description: "La descripción aprobada",
  tags: ["portones"],
  privacy: "unlisted",
  madeForKids: false,
  mediaUrl: VIDEO,
  approvedBy: "user1",
  approvedAt: "2026-10-13T12:00:00.000Z",
};

function seed(over: Record<string, unknown> = {}) {
  mem.targets.clear();
  mem.final = "";
  mem.post = {
    id: "p1",
    businessId: "biz1",
    text: "Texto base",
    subject: "",
    seoTitle: "",
    mediaUrl: VIDEO,
    mediaType: "video",
    kind: "video",
    media: null,
    altText: "",
    variants: { youtube: "Descripción de YouTube", instagram: "Para Instagram" },
    targets: [
      { id: "t-yt", channel: "youtube", status: "pending", detail: "" },
      { id: "t-ig", channel: "instagram", status: "pending", detail: "" },
    ],
    business: { name: "Portones", study: null, contacts: [], connections: [{ channel: "youtube", secret: "s" }, { channel: "instagram", secret: "s" }] },
    ...over,
  };
}

const yt = vi.mocked(PUBLISHERS.youtube.publish);
const ig = vi.mocked(PUBLISHERS.instagram.publish);

beforeEach(() => {
  yt.mockClear();
  ig.mockClear();
});

describe("YouTube solo sube lo que aprobó una persona (cron, reintentos, campañas, agente)", () => {
  it("sin aprobación: YouTube se salta (sin subir nada) y las otras redes salen igual", async () => {
    seed();
    await publishPost("p1");
    expect(yt).not.toHaveBeenCalled();
    expect(mem.targets.get("t-yt")).toEqual({ status: "skipped", detail: YOUTUBE_NEEDS_APPROVAL });
    expect(ig).toHaveBeenCalledTimes(1);
    expect(mem.targets.get("t-ig")?.status).toBe("sent");
    expect(mem.final).toBe("partial");
  });

  it("con la aprobación de este video: sube exactamente lo aprobado", async () => {
    seed({ variants: { youtube: "Descripción de YouTube", [YT_KEY]: approval } });
    await publishPost("p1");
    expect(yt).toHaveBeenCalledTimes(1);
    const [input] = yt.mock.calls[0] as unknown as [{ youtube?: YoutubeApproval; text: string }];
    expect(input.youtube).toEqual(approval);
    expect(mem.targets.get("t-yt")?.status).toBe("sent");
    // Instagram nunca recibe la aprobación de YouTube.
    expect((ig.mock.calls[0] as unknown as [{ youtube?: unknown }])[0].youtube).toBeUndefined();
    expect(mem.final).toBe("done");
  });

  it("si la publicación cambió de video, la aprobación de antes no sirve", async () => {
    seed({ mediaUrl: "https://x.supabase.co/storage/v1/object/public/media/b/otro.mp4", variants: { [YT_KEY]: approval } });
    await publishPost("p1");
    expect(yt).not.toHaveBeenCalled();
    expect(mem.targets.get("t-yt")).toEqual({ status: "skipped", detail: YOUTUBE_NEEDS_APPROVAL });
  });

  it("una aprobación a medias (sin privacidad o sin quién aprobó) tampoco", async () => {
    for (const bad of [{ ...approval, privacy: undefined }, { ...approval, approvedBy: "" }, { ...approval, madeForKids: "no" }]) {
      seed({ variants: { [YT_KEY]: bad } });
      await publishPost("p1");
      expect(yt).not.toHaveBeenCalled();
      expect(mem.targets.get("t-yt")?.detail).toBe(YOUTUBE_NEEDS_APPROVAL);
    }
  });

  it("una foto con YouTube sigue diciendo que YouTube necesita un video", async () => {
    seed({ mediaType: "photo", kind: "post", mediaUrl: "https://x.supabase.co/a.jpg" });
    await publishPost("p1");
    expect(yt).not.toHaveBeenCalled();
    expect(mem.targets.get("t-yt")).toEqual({ status: "failed", detail: "YouTube necesita un video para publicar." });
  });

  it("solo YouTube y sin aprobación: no se sube nada", async () => {
    seed({ targets: [{ id: "t-yt", channel: "youtube", status: "pending", detail: "" }] });
    await publishPost("p1");
    expect(yt).not.toHaveBeenCalled();
    expect(mem.final).toBe("failed");
  });
});
