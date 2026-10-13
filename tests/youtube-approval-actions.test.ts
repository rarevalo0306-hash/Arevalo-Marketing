import { beforeEach, describe, expect, it, vi } from "vitest";

// Las acciones que guardan la aprobación de YouTube (Nueva publicación, Videos, Plan y Campañas), sin base de datos
// ni red: la base es falsa y publishPost no hace nada.
const mem = vi.hoisted(() => ({ draft: null as Record<string, unknown> | null, project: null as Record<string, unknown> | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, delete: vi.fn(), set: vi.fn() }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw Object.assign(new Error(`redirect:${to}`), { to }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireBusiness: vi.fn(async () => ({ user: { id: "user1", email: "a@b.com", name: "Ana", memberships: [] }, role: "admin" })),
  hasBusiness: vi.fn(async () => true),
  deniedText: vi.fn(async () => "no"),
  newBusinessOrganizationId: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const post = { create: vi.fn(async () => ({ id: "p1" })), update: vi.fn(async () => ({})), findFirst: vi.fn(async () => mem.draft) };
  const aiAction = { create: vi.fn(async () => ({})) };
  return {
    db: {
      business: { findUnique: async () => ({ id: "biz1", name: "Portones" }) },
      campaign: { findFirst: async () => ({ name: "Otoño", status: "active" }) },
      post,
      aiAction,
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ post, aiAction })),
    },
  };
});
vi.mock("@/lib/i18n-server", () => ({ getT: async () => ({ lang: "es", t: (es: string) => es }) }));
vi.mock("@/lib/publish", () => ({ publishPost: vi.fn(), retryPost: vi.fn() }));
vi.mock("@/lib/ai-actions", () => ({ logAiAction: vi.fn() }));
vi.mock("@/lib/video-render", () => ({ sceneStill: vi.fn() }));
vi.mock("@/lib/video-jobs", () => ({
  loadProject: vi.fn(async () => ({ id: "v1", createdAt: new Date(), project: mem.project })),
  saveProject: vi.fn(),
  advanceRender: vi.fn(),
  businessKeywords: () => [],
  contentLang: () => "es",
  createProject: vi.fn(),
  loadVideoMedia: vi.fn(),
  planContext: vi.fn(),
  startRender: vi.fn(),
  suggestMedia: vi.fn(),
  videoBusiness: vi.fn(),
  writeStoryboard: vi.fn(),
}));
vi.mock("dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.215.14", family: 4 }]) }));

import { approveDraft, approveDraftChecked, approvePlanDraft, createPost } from "@/app/actions";
import { approveCampaignDraft } from "@/app/actions-campaign";
import { publishVideo } from "@/app/actions-video";
import { logAiAction } from "@/lib/ai-actions";
import { db } from "@/lib/db";
import { publishPost } from "@/lib/publish";
import { saveProject } from "@/lib/video-jobs";
import { YT_KEY, type YoutubeApproval } from "@/lib/youtube-options";

const VIDEO = "https://cdn.example.com/reel.mp4";
const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const ytFields = { yt_title: "Portones nuevos <en> Miami", yt_tags: "portones, Miami, portones", yt_privacy: "unlisted", yt_kids: "no" };
type CreateArgs = { data: { variants?: Record<string, unknown>; seoTitle?: string } };
type UpdateArgs = { where: { id: string }; data: { variants: Record<string, unknown>; status: string } };
const created = () => (vi.mocked(db.post.create).mock.calls[0] as unknown as [CreateArgs])[0].data;
const updated = () => (vi.mocked(db.post.update).mock.calls.at(-1) as unknown as [UpdateArgs])[0].data;
const logged = () => (vi.mocked(db.aiAction.create).mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;

beforeEach(() => {
  vi.clearAllMocks();
  mem.draft = null;
  mem.project = null;
});

describe("Nueva publicación: un video para YouTube solo con lo que la persona eligió", () => {
  const base = { text: "Portones a tu medida", channels: ["youtube", "facebook"], mediaType: "video", mediaLink: VIDEO, kind: "post" };

  it("sin privacidad ni «para niños» no guarda nada ni publica", async () => {
    await expect(createPost("biz1", form(base))).rejects.toThrow("Elige quién puede ver el video en YouTube");
    await expect(createPost("biz1", form({ ...base, yt_title: "T", yt_privacy: "public" }))).rejects.toThrow("Indica si el video es para niños");
    expect(db.post.create).not.toHaveBeenCalled();
    expect(publishPost).not.toHaveBeenCalled();
  });

  it("con los campos: guarda la aprobación (y su constancia) junto a la publicación", async () => {
    await expect(createPost("biz1", form({ ...base, ...ytFields, variants: JSON.stringify({ youtube: "Texto de YouTube" }) }))).rejects.toThrow("redirect:");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const a = created().variants?.[YT_KEY] as YoutubeApproval;
    expect(a).toMatchObject({ title: "Portones nuevos en Miami", description: "Texto de YouTube", tags: ["portones", "Miami"], privacy: "unlisted", madeForKids: false, mediaUrl: VIDEO, approvedBy: "user1" });
    expect(Date.parse(a.approvedAt)).not.toBeNaN();
    expect(logged()).toMatchObject({ kind: "post.youtube_approved", actor: "owner", postId: "p1", businessId: "biz1", detail: a });
    expect(publishPost).toHaveBeenCalledWith("p1");
  });

  it("la descripción es el texto que se publica cuando no hay uno solo para YouTube", async () => {
    await expect(createPost("biz1", form({ ...base, ...ytFields }))).rejects.toThrow("redirect:");
    expect((created().variants?.[YT_KEY] as YoutubeApproval).description).toBe("Portones a tu medida");
  });

  it("una aprobación que manda el navegador en las variantes nunca se guarda", async () => {
    const forged = JSON.stringify({ facebook: "Hola", [YT_KEY]: { privacy: "public", madeForKids: false, approvedBy: "x", mediaUrl: VIDEO, title: "x" } });
    await expect(createPost("biz1", form({ ...base, channels: ["facebook"], variants: forged }))).rejects.toThrow("redirect:");
    expect(created().variants).toEqual({ facebook: "Hola" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("una foto con YouTube marcado no pide los campos (YouTube dirá que necesita un video)", async () => {
    await expect(createPost("biz1", form({ ...base, mediaType: "photo", mediaLink: "https://cdn.example.com/a.jpg" }))).rejects.toThrow("redirect:");
    expect(created().variants).toBeUndefined();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("Aprobar un borrador (Plan y Campañas)", () => {
  const draft = (over: Record<string, unknown> = {}) => ({
    id: "d1",
    businessId: "biz1",
    campaignId: "c1",
    status: "draft",
    kind: "video",
    mediaType: "video",
    mediaUrl: VIDEO,
    text: "Texto",
    subject: "",
    scheduledAt: new Date(Date.now() + 86400000),
    variants: { facebook: "Para Facebook", youtube: "Para YouTube" },
    targets: [{ channel: "facebook" }, { channel: "youtube" }],
    ...over,
  });

  it("los borradores del agente no se aprueban aquí", async () => {
    mem.draft = draft({ id: "agent-r1" });
    expect(await approveDraft("biz1", "agent-r1", form({}))).toBe(false);
    expect(db.post.findFirst).not.toHaveBeenCalled();
    expect(db.post.update).not.toHaveBeenCalled();
  });

  it("un video que todavía se está creando no se aprueba", async () => {
    mem.draft = draft({ mediaUrl: "", mediaType: "none" });
    expect(await approveDraft("biz1", "d1", form(ytFields))).toBe(false);
    expect(db.post.update).not.toHaveBeenCalled();
  });

  it("un video para YouTube sin los campos (el «Aprobar» de un clic) no se aprueba", async () => {
    mem.draft = draft();
    expect(await approveDraft("biz1", "d1", form({}))).toBe(false);
    expect(await approveDraft("biz1", "d1", form({ ...ytFields, yt_privacy: "" }))).toBe(false);
    expect(db.post.update).not.toHaveBeenCalled();
    expect(db.aiAction.create).not.toHaveBeenCalled();
  });

  it("con los campos: queda programado con la aprobación y su constancia, en una transacción", async () => {
    mem.draft = draft();
    expect(await approveDraft("biz1", "d1", form({ ...ytFields, v_youtube: "Descripción revisada", v_facebook: "FB" }))).toBe(true);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const data = updated();
    expect(data.status).toBe("scheduled");
    expect(data.variants.youtube).toBe("Descripción revisada");
    expect(data.variants.facebook).toBe("FB");
    expect(data.variants[YT_KEY]).toMatchObject({ title: "Portones nuevos en Miami", description: "Descripción revisada", privacy: "unlisted", madeForKids: false, mediaUrl: VIDEO, approvedBy: "user1" });
    expect(logged()).toMatchObject({ kind: "post.youtube_approved", actor: "owner", postId: "d1", campaignId: "c1" });
  });

  it("una aprobación vieja nunca se copia: solo vale la que se envía ahora", async () => {
    mem.draft = draft({ kind: "post", mediaType: "photo", mediaUrl: "https://cdn.example.com/a.jpg", variants: { facebook: "x", [YT_KEY]: { privacy: "public" } } });
    expect(await approveDraft("biz1", "d1", form({}))).toBe(true);
    expect(updated().variants).not.toHaveProperty(YT_KEY);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("Campañas solo anota «aprobado» si de verdad se aprobó; si no, vuelve a la campaña con el motivo junto al borrador", async () => {
    mem.draft = draft();
    await expect(approveCampaignDraft("biz1", "c1", "d1", form({}))).rejects.toThrow(
      /^redirect:\/b\/biz1\/campanas\/c1\?draft=d1&msg=Elige\+qui.*#draft-d1$/,
    );
    expect(logAiAction).not.toHaveBeenCalled();
    await approveCampaignDraft("biz1", "c1", "d1", form(ytFields));
    expect(logAiAction).toHaveBeenCalledWith(expect.objectContaining({ kind: "post.approved", actor: "owner", postId: "d1" }));
  });
});

describe("Aprobar: el motivo cuando no se aprueba, y la hora", () => {
  const draft = (extra: Record<string, unknown> = {}) => ({
    id: "d1", businessId: "biz1", status: "draft", kind: "video", mediaType: "video", mediaUrl: VIDEO, text: "Texto", subject: "", campaignId: "c1",
    variants: { youtube: "Desc", facebook: "FB" }, scheduledAt: new Date(Date.now() - 3600_000), targets: [{ channel: "youtube" }, { channel: "facebook" }], ...extra,
  });
  beforeEach(() => vi.clearAllMocks());
  it("el Plan vuelve con el motivo junto a ese borrador (por ejemplo, un título solo con espacios)", async () => {
    mem.draft = draft();
    await expect(approvePlanDraft("biz1", "d1", form({ yt_title: "   ", yt_privacy: "unlisted", yt_kids: "no" }))).rejects.toThrow(
      /^redirect:\/b\/biz1\/plan\?draft=d1&msg=Escribe\+el\+t%C3%ADtulo.*#draft-d1$/,
    );
    expect(db.post.update).not.toHaveBeenCalled();
  });
  it("si su hora ya pasó, pasa a la próxima hora en el mismo guardado de la aprobación (nunca antes)", async () => {
    mem.draft = draft({ kind: "post", mediaType: "none", mediaUrl: "", targets: [{ channel: "facebook" }] });
    const r = await approveDraftChecked("biz1", "d1", form({ v_facebook: "FB" }), true);
    expect(r).toEqual({ ok: true });
    const data = (vi.mocked(db.post.update).mock.calls[0] as unknown as [{ data: { status: string; scheduledAt?: Date } }])[0].data;
    expect(data.status).toBe("scheduled");
    expect(data.scheduledAt!.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
    expect(await approveDraftChecked("biz1", "agent-1", form({}))).toMatchObject({ ok: false, error: { en: "This draft belongs to MATYA: approve it in MATYA." } });
  });
});

describe("Videos: publicar con YouTube", () => {
  const project = () => ({
    status: "ready",
    videoUrl: VIDEO,
    storyboard: {
      format: "vertical",
      keyword: "portones",
      city: "Miami",
      lang: "es",
      outro: { name: "Portones" },
      scenes: [],
      music: { on: false },
      texts: { title: "Portones en Miami #Shorts", description: "Desc", tags: ["viejo"], instagram: "IG", tiktok: "TT", facebook: "FB" },
    },
  });

  it("sin privacidad no crea nada", async () => {
    mem.project = project();
    const r = await publishVideo("biz1", "v1", form({ channels: ["youtube", "facebook"], yt_title: "T", yt_kids: "no", v_youtube: "D" }));
    expect(r).toEqual({ ok: false, error: "Elige quién puede ver el video en YouTube: público, no listado o privado." });
    expect(db.post.create).not.toHaveBeenCalled();
    expect(publishPost).not.toHaveBeenCalled();
  });

  it("con los campos: el título va tal cual, las etiquetas editadas se mandan y quedan en el guion", async () => {
    mem.project = project();
    const r = await publishVideo("biz1", "v1", form({ channels: ["youtube", "facebook"], ...ytFields, yt_title: "Mi título", v_youtube: "Desc nueva", facebook: "FB" }));
    expect(r.ok).toBe(true);
    const data = created();
    const a = data.variants?.[YT_KEY] as YoutubeApproval;
    // Sin palabra clave, ciudad ni #Shorts agregados después de enviar.
    expect(a).toMatchObject({ title: "Mi título", description: "Desc nueva", tags: ["portones", "Miami"], privacy: "unlisted", madeForKids: false, mediaUrl: VIDEO, approvedBy: "user1" });
    expect(data.seoTitle).toBe("Mi título");
    expect(data.variants?.youtube).toBe("Desc nueva");
    expect(logged()).toMatchObject({ kind: "post.youtube_approved", postId: "p1" });
    const saved = vi.mocked(saveProject).mock.calls[0][2] as unknown as { storyboard: { texts: { title: string; tags: string[] } } };
    expect(saved.storyboard.texts.tags).toEqual(["portones", "Miami"]);
    expect(saved.storyboard.texts.title).toBe("Mi título");
    expect(publishPost).toHaveBeenCalledWith("p1");
  });

  it("sin YouTube no pide nada de YouTube", async () => {
    mem.project = project();
    const r = await publishVideo("biz1", "v1", form({ channels: ["facebook"], facebook: "FB" }));
    expect(r.ok).toBe(true);
    expect(created().variants).not.toHaveProperty(YT_KEY);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
