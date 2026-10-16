/** Run only against the isolated local fixture, never a configured remote database. */
import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { db } from "@/lib/db";
import {
  enqueue,
  saveSettings,
  claimRun,
  beginStep,
  finishStep,
  recoverExpired,
  changeRun,
  spawnPieces,
  stepsOf,
  planStepMeta,
  type StepResult,
} from "@/lib/agent/queue";
import { reworkSteps, stepsForPiece } from "@/lib/agent/plan";
import type { AgentRun } from "@prisma/client";
import { workOne, executeStep, analyzeResults } from "@/lib/agent/execution";
import { claimAgentPost } from "@/lib/agent/publication";
import { loadContext } from "@/lib/agent/context";
import { DEFAULT_SETTINGS } from "@/components/agent/types";
import { collectNews } from "@/lib/agent/news";
import { readSource } from "@/lib/agent/network";
import { storeDesign } from "@/lib/media-formats";
import { ensureStoredCopy } from "@/lib/library-files";
import { AGENTS } from "@/lib/agent/agents";
import { CALENDAR_LIMITS, toolsFor } from "@/lib/agent/tools";
import { BUILTIN_TEMPLATES } from "@/lib/design-shapes";
import type { VideoMedia } from "@/lib/video-plan";
vi.mock("@/lib/library-files", () => ({
  ensureStoredCopy: vi.fn().mockImplementation(async (id) =>
    `https://example.com/stored-${id}.mp4`,
  ),
}));
vi.mock("@/lib/media-formats", async (original) => ({
  ...(await original<typeof import("@/lib/media-formats")>()),
  storeDesign: vi.fn().mockImplementation(async (input) =>
    `https://example.com/fixture-${input.shape}.jpg`,
  ),
}));
vi.mock("@/lib/agent/network", async (original) => ({
  ...(await original<typeof import("@/lib/agent/network")>()),
  readSource: vi.fn(),
}));
vi.mock("@/lib/video-jobs", async (original) => ({
  ...(await original<typeof import("@/lib/video-jobs")>()),
  videoBlocker: vi.fn().mockReturnValue(null),
  startRender: vi.fn().mockResolvedValue({ status: "rendering" }),
  advanceRender: vi
    .fn()
    .mockResolvedValue({ status: "rendering", storyboard: { texts: {} } }),
}));
import {
  videoBlocker,
  startRender,
  advanceRender,
  loadProject,
  projectCost,
  suggestMedia,
  loadVideoMedia,
  maxCentsPerVideo,
} from "@/lib/video-jobs";
const url = process.env.MATYA_TEST_DATABASE_URL ?? "";
const safe =
  !!url &&
  process.env.DATABASE_URL === url &&
  /^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/matya_agent$/.test(url);
const A = "matya-it-a",
  B = "matya-it-b",
  ORG = "matya-it-org";
const settings = {
  ...DEFAULT_SETTINGS,
  enabled: true,
  industry: "public-adjusting-fl" as const,
  dailyBudgetCents: 100,
  runBudgetCents: 100,
  channels: ["facebook"],
  allowPublish: true,
  objective: "Contenido de prueba",
};
const key = (x: string) => `test-request-${x.padEnd(16, "0")}`;
const ask = (
  text = "Prepara una campaña",
  extra: Record<string, unknown> = {},
) => enqueue(A, { text, requestKey: key(crypto.randomUUID()), ...extra });
const research = {
  summary: "Objetivo",
  audience: "Propietarios",
  angle: "Preparación",
  keywords: ["propiedad"],
  facts: [],
  uncertainties: [],
};
const copy = {
  title: "Preparación",
  headline: "Cuida tu propiedad",
  summary: "Consejos",
  variants: {
    facebook: "Texto original del negocio.",
    instagram: "Texto original.",
    google: "Texto original.",
    linkedin: "Texto original.",
    x: "Texto original.",
    seo: "Texto original.",
  },
  script: "Guion original",
  alt: "Diseño con la marca",
};
async function prepared(mode = "auto") {
  await db.agentWorkspace.update({ where: { businessId: A }, data: { mode } });
  const r = await ask();
  for (let i = 0; i < 4; i++)
    await workOne(
      A,
      async (run, name) =>
        name === "research"
          ? { data: research }
          : name === "copy"
            ? { data: copy }
            : name === "design"
              ? {
                  data: {
                    assets: [
                      {
                        shape: "square",
                        url: "https://example.com/own-design.jpg",
                      },
                    ],
                  },
                }
              : executeStep(run, name),
      () => 0,
    );
  return r;
}
describe.skipIf(!safe)("MATYA isolated PostgreSQL integration", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(videoBlocker).mockReturnValue(null);
    process.env.MATYA_AGENT_ENABLED = "true";
    await db.business.deleteMany({ where: { id: { in: [A, B] } } });
    await db.organization.upsert({
      where: { id: ORG },
      create: { id: ORG, name: "MATYA fixture" },
      update: {},
    });
    await db.business.createMany({
      data: [
        {
          id: A,
          organizationId: ORG,
          name: "Ricardo PA · fixture",
          timezone: "America/New_York",
          aiProfile: "Solo propiedades Florida",
        },
        {
          id: B,
          organizationId: ORG,
          name: "Fameseg · fixture",
          timezone: "America/Managua",
          aiProfile: "Solo cortinas Nicaragua",
        },
      ],
    });
    await saveSettings(A, settings);
    await saveSettings(B, { ...settings, industry: "commercial-security-ni" });
    await db.connection.create({
      data: {
        businessId: A,
        channel: "facebook",
        secret: "synthetic-no-provider-access",
      },
    });
  });
  afterAll(async () => {
    await db.business.deleteMany({ where: { id: { in: [A, B] } } });
    await db.$disconnect();
  });
  it("isolates private context and rejects another business run/campaign", async () => {
    const r = await ask();
    expect((await loadContext(B)).messages).toHaveLength(0);
    expect((await loadContext(A)).industry.geography).toContain("Florida");
    expect((await loadContext(B)).industry.geography).toBe("Nicaragua");
    await expect(changeRun(B, r.id, "cancel")).rejects.toThrow("encontrado");
    const c = await db.campaign.create({
      data: { businessId: B, name: "B only" },
    });
    await expect(
      ask("Pausa", { kind: "pause", campaignId: c.id }),
    ).rejects.toThrow("encontrada");
  });
  async function visualRun(kind: "campaign" | "video") {
    const r = await ask("Prepara contenido sobre techos", { kind });
    await workOne(A, async () => ({ data: research }), () => 0);
    await workOne(A, async () => ({ data: { ...copy, title: "Techos", headline: "¿Cómo cuidas tu techo?" } }), () => 0);
    return r;
  }
  async function libraryItem(externalId: string, extra: Record<string, unknown> = {}) {
    return db.libraryItem.create({
      data: {
        businessId: A,
        source: "upload",
        externalId,
        kind: "photo",
        url: `https://example.com/${externalId}.jpg`,
        status: "ready",
        quality: 4,
        usable: true,
        tags: ["techos"],
        width: 1080,
        height: 1920,
        ...extra,
      },
    });
  }
  it("reuses a company's suitable photo in every format without image generation", async () => {
    const owned = await libraryItem("owned", {
      enhancedUrl: "https://example.com/enhanced-owned.jpg",
      useEnhanced: true,
    });
    await libraryItem("other-company", { businessId: B, quality: 5 });
    await libraryItem("private", { privacy: ["faces"], quality: 5 });
    await libraryItem("skipped", { choice: "skip", quality: 5 });
    await libraryItem("poor", { quality: 1 });
    await libraryItem("unreviewed", { status: "new" });
    await libraryItem("unrelated", { tags: ["automóviles"], quality: 5 });
    const r = await visualRun("campaign");
    await workOne(A, executeStep, () => 0);
    expect(storeDesign).toHaveBeenCalledTimes(3);
    for (const [input, businessId] of vi.mocked(storeDesign).mock.calls) {
      expect(businessId).toBe(A);
      expect(input.photoUrl).toBe(owned.enhancedUrl);
      // Even question headlines must actually use the selected image.
      expect(input.template.layout).not.toBe("color-solido");
    }
    const step = await db.agentStep.findUniqueOrThrow({ where: { runId_name: { runId: r.id, name: "design" } } });
    expect(step.output).toMatchObject({
      mediaSelection: { source: "library", libraryItems: [{ id: owned.id, kind: "photo" }], generatedFromScratch: false },
    });
    expect(step.chargedCents).toBe(0);
    expect(await db.libraryItem.findUnique({ where: { id: owned.id } })).toMatchObject({ usedCount: 1 });
    expect(await db.libraryItem.count({ where: { businessId: B, usedCount: { gt: 0 } } })).toBe(0);
  });
  it("uses a brand-only fallback when the library has no suitable allowed photos", async () => {
    await libraryItem("unrelated", { tags: ["automóviles"] });
    await libraryItem("private", { privacy: ["document"] });
    await libraryItem("skipped", { choice: "skip" });
    const r = await visualRun("campaign");
    await workOne(A, executeStep, () => 0);
    expect(storeDesign).toHaveBeenCalledTimes(3);
    for (const [input] of vi.mocked(storeDesign).mock.calls) {
      expect(input.photoUrl).toBeUndefined();
      expect(input.template.layout).toBe("color-solido");
    }
    const step = await db.agentStep.findUniqueOrThrow({ where: { runId_name: { runId: r.id, name: "design" } } });
    expect(step.output).toMatchObject({
      mediaSelection: { source: "brand_template", libraryItems: [], generatedFromScratch: false },
    });
    expect(step.chargedCents).toBe(0);
  });
  it("rechecks current library permission and still accepts a photo explicitly allowed by the owner", async () => {
    const owned = await libraryItem("approved", { privacy: ["faces"], choice: "use" });
    const ids = await suggestMedia(A, "techos", "vertical", [], 6, { minRelevance: 3 });
    expect(ids).toEqual([owned.id]);
    expect(await loadVideoMedia(A, ids, "es")).toHaveLength(1);
    expect(await loadVideoMedia(B, ids, "es")).toEqual([]);
    await db.libraryItem.update({ where: { id: owned.id }, data: { choice: "skip" } });
    expect(await loadVideoMedia(A, ids, "es")).toEqual([]);
  });
  it("builds videos from suitable company photos and clips instead of generated designs", async () => {
    const photo = await libraryItem("photo");
    const clip = await libraryItem("clip", { source: "drive", kind: "video", url: "", durationSec: 8 });
    await libraryItem("other-company-clip", { businessId: B, kind: "video", durationSec: 8, quality: 5 });
    await libraryItem("private-clip", { kind: "video", privacy: ["child"], durationSec: 8, quality: 5 });
    const r = await visualRun("video");
    await workOne(A, executeStep, () => 0);
    await workOne(A, executeStep, (name) => name === "video" ? 50 : 0);
    expect(startRender).toHaveBeenCalledTimes(1);
    const args = vi.mocked(startRender).mock.calls[0];
    const storyboard = (await loadProject(A, args[1])).project.storyboard;
    expect(storyboard.media.map((m) => m.id).sort()).toEqual([photo.id, clip.id].sort());
    expect(storyboard.media.some((m) => m.kind === "video")).toBe(true);
    expect(ensureStoredCopy).toHaveBeenCalledExactlyOnceWith(clip.id);
    expect(storyboard.media.find((m) => m.id === clip.id)?.url).toBe(`https://example.com/stored-${clip.id}.mp4`);
    expect(storyboard.media.some((m) => m.id.startsWith("design-"))).toBe(false);
    expect(storyboard.music.on).toBe(false);
    expect(args[2]).toBe(projectCost(storyboard));
    const step = await db.agentStep.findUniqueOrThrow({ where: { runId_name: { runId: r.id, name: "video" } } });
    expect(step.output).toMatchObject({ mediaSelection: { source: "library", generatedFromScratch: false } });
    expect(await db.libraryItem.findUnique({ where: { id: clip.id } })).toMatchObject({ usedCount: 1 });
  });
  it("keeps a photo another post used today out of the video", async () => {
    const usedElsewhere = await libraryItem("used-today", { usedCount: 1, lastUsedAt: new Date() });
    const clip = await libraryItem("clip", { kind: "video", durationSec: 8 });
    const r = await visualRun("video");
    await workOne(A, executeStep, () => 0);
    await workOne(A, executeStep, (name) => name === "video" ? 50 : 0);
    expect(startRender).toHaveBeenCalledTimes(1);
    const storyboard = (await loadProject(A, vi.mocked(startRender).mock.calls[0][1])).project.storyboard;
    expect(storyboard.media.map((m) => m.id)).toEqual([clip.id]);
    const design = await db.agentStep.findUniqueOrThrow({ where: { runId_name: { runId: r.id, name: "design" } } });
    expect(design.output).toMatchObject({ mediaSelection: { source: "brand_template", libraryItems: [] } });
    expect(await db.libraryItem.findUnique({ where: { id: usedElsewhere.id } })).toMatchObject({ usedCount: 1 });
  });
  it("excludes facts from a previous territory after the industry changes", async () => {
    const fact = {
      fact: "Hecho confirmado de Florida",
      url: "https://example.com/florida",
      checkedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      geography: "Florida, Estados Unidos",
    };
    await saveSettings(A, { ...settings, knowledge: [fact] });
    expect((await loadContext(A)).knowledge).toHaveLength(1);
    await saveSettings(A, {
      ...settings,
      industry: "commercial-security-ni",
      knowledge: [fact],
    });
    expect((await loadContext(A)).knowledge).toHaveLength(0);
  });
  it("stores the team settings and leaves the new columns at their old-behavior defaults", async () => {
    const models = { director: { provider: "gemini", model: "gemini-2.5-flash" } };
    const prices = { "gemini:gemini-2.5-flash": { input: 0.3, output: 2.5 } };
    await saveSettings(A, {
      ...settings,
      teamMode: true,
      dailyHour: 6,
      agentModels: models,
      modelPrices: prices,
      allowSocial: false,
    });
    expect(
      await db.agentWorkspace.findUnique({ where: { businessId: A } }),
    ).toMatchObject({
      teamMode: true,
      dailyHour: 6,
      agentModels: models,
      modelPrices: prices,
      allowSocial: false,
      allowWebArticles: true,
      pausedAt: null,
    });
    // B keeps the defaults saved in beforeEach: teamMode off means the pre-team behavior.
    expect(
      await db.agentWorkspace.findUnique({ where: { businessId: B } }),
    ).toMatchObject({
      teamMode: false,
      dailyHour: 7,
      agentModels: {},
      modelPrices: {},
      allowSocial: true,
      allowWebArticles: true,
      pausedAt: null,
    });
    const r = await ask();
    expect(r).toMatchObject({ plan: null, parentRunId: null, origin: "owner" });
    const step = await db.agentStep.create({
      data: { runId: r.id, name: "x", specialist: "matya", budgetDay: "2026-10-16" },
    });
    expect(step).toMatchObject({ agent: "", model: "", attempt: 0 });
    await db.agentBudget.create({ data: { businessId: A, day: "2026-10-16" } });
    expect(
      await db.agentBudget.findUniqueOrThrow({
        where: { businessId_day: { businessId: A, day: "2026-10-16" } },
      }),
    ).toMatchObject({ alerts: 0 });
  });
  it("blocks unconfigured video before reserving or charging any render", async () => {
    const r = await ask("Crea un video", { kind: "video" });
    await db.agentRun.update({ where: { id: r.id }, data: { stage: 3 } });
    vi.mocked(videoBlocker).mockReturnValue("fal");
    const executor = vi.fn();
    await workOne(A, executor);
    expect(executor).not.toHaveBeenCalled();
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: r.id } }))
      .toMatchObject({ status: "blocked", chargedCents: 0, reservedCents: 0 });
    expect(await db.agentStep.count({ where: { runId: r.id } })).toBe(0);
  });
  it("deduplicates concurrent submissions and claims once", async () => {
    const input = { text: "Ponme al día", requestKey: key("same") };
    const runs = await Promise.all([enqueue(A, input), enqueue(A, input)]);
    expect(runs[0].id).toBe(runs[1].id);
    const claims = await Promise.all([claimRun(A), claimRun(A)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await db.agentMessage.count({ where: { businessId: A } })).toBe(1);
  });
  it("reserves a shared daily cap atomically across simultaneous tasks", async () => {
    await ask();
    await ask();
    const a = await claimRun(A),
      b = await claimRun(A);
    const results = await Promise.allSettled([
      beginStep(a!.id, a!.leaseToken, "research", 60),
      beginStep(b!.id, b!.leaseToken, "research", 60),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const budget = await db.agentBudget.findFirstOrThrow({
      where: { businessId: A },
    });
    expect(budget.reservedCents).toBe(60);
  });
  it("settles actual usage, resumes from the next step and refuses repeats", async () => {
    const r = await ask();
    const claim = await claimRun(A);
    await beginStep(r.id, claim!.leaseToken, "research", 40);
    await finishStep(r.id, claim!.leaseToken, "research", {
      data: research,
      cents: 12,
    });
    const row = await db.agentRun.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({
      stage: 1,
      status: "queued",
      chargedCents: 12,
      reservedCents: 0,
    });
    const next = await claimRun(A);
    await expect(
      beginStep(r.id, next!.leaseToken, "research", 40),
    ).rejects.toThrow("registro");
  });
  it("holds uncertain charges after a crash and never repeats the external step", async () => {
    const r = await ask();
    const c = await claimRun(A);
    await beginStep(r.id, c!.leaseToken, "research", 50);
    await db.agentRun.update({
      where: { id: r.id },
      data: { leaseUntil: new Date(0) },
    });
    await recoverExpired();
    await recoverExpired();
    expect(await claimRun(A)).toBeNull();
    expect(await db.agentRun.findUnique({ where: { id: r.id } })).toMatchObject(
      { status: "uncertain", chargedCents: 50, reservedCents: 0 },
    );
    expect(
      await db.agentBudget.findFirst({ where: { businessId: A } }),
    ).toMatchObject({ chargedCents: 50, reservedCents: 0 });
  });
  it("stops before a model call when policy changes or funds are zero", async () => {
    const r = await ask();
    await saveSettings(A, {
      ...settings,
      dailyBudgetCents: 0,
      runBudgetCents: 0,
    });
    const execute = vi.fn();
    await workOne(A, execute, () => 2);
    expect(execute).not.toHaveBeenCalled();
    expect(await db.agentRun.findUnique({ where: { id: r.id } })).toMatchObject(
      { status: "blocked" },
    );
    const second = await ask();
    await workOne(A, execute, () => 2);
    expect(execute).not.toHaveBeenCalled();
    expect(
      await db.agentRun.findUnique({ where: { id: second.id } }),
    ).toMatchObject({ status: "blocked" });
  });
  it("executes a campaign through real preparation/scheduling and per-channel verification", async () => {
    const r = await prepared();
    await workOne(A, executeStep, () => 0);
    expect(
      await db.post.findUnique({ where: { id: `agent-${r.id}` } }),
    ).toMatchObject({ status: "scheduled" });
    expect(await claimAgentPost(`agent-${r.id}`)).toEqual({ count: 1 });
    expect(await claimAgentPost(`agent-${r.id}`)).toEqual({ count: 0 });
    await db.postTarget.updateMany({
      where: { postId: `agent-${r.id}` },
      data: {
        status: "sent",
        externalId: "fixture-confirmation",
        externalUrl: "https://example.com/result",
      },
    });
    await db.post.update({
      where: { id: `agent-${r.id}` },
      data: { status: "done" },
    });
    await workOne(A, executeStep, () => 0);
    const done = await db.agentRun.findUniqueOrThrow({ where: { id: r.id } });
    expect(done.status).toBe("completed");
    expect(JSON.stringify(done.result)).toContain("fixture-confirmation");
  });
  it("waits for optional approval and records it on the same run", async () => {
    const r = await prepared("approval");
    await workOne(A, executeStep, () => 0);
    expect(await db.agentRun.findUnique({ where: { id: r.id } })).toMatchObject(
      { status: "waiting_approval", stage: 4 },
    );
    await changeRun(A, r.id, "approve");
    await workOne(A, executeStep, () => 0);
    expect(
      await db.post.findUnique({ where: { id: `agent-${r.id}` } }),
    ).toMatchObject({ status: "scheduled" });
  });
  it("cancellation unschedules only an unclaimed post", async () => {
    const r = await prepared();
    await workOne(A, executeStep, () => 0);
    await changeRun(A, r.id, "cancel");
    expect(
      await db.post.findUnique({ where: { id: `agent-${r.id}` } }),
    ).toMatchObject({ status: "draft" });
    expect(await claimAgentPost(`agent-${r.id}`)).toEqual({ count: 0 });
  });
  it("legacy publishing cannot bypass disabled or revised agent policy", async () => {
    const r = await prepared();
    await workOne(A, executeStep, () => 0);
    await saveSettings(A, { ...settings, allowPublish: false });
    expect(await claimAgentPost(`agent-${r.id}`)).toEqual({ count: 0 });
    expect(
      await db.post.findUnique({ where: { id: `agent-${r.id}` } }),
    ).toMatchObject({ status: "draft" });
  });
  it("refuses old/unverified news and invalidates changed source content", async () => {
    const n = await db.agentNews.create({
      data: {
        businessId: A,
        canonicalUrl: "https://example.com/a",
        eventKey: "event-a",
        title: "Test",
        source: "Official",
        status: "verified",
        summary: "Verified summary",
        contentHash: "old",
        eventDate: new Date(Date.now() - 15 * 86400000),
      },
    });
    await expect(ask("Crea contenido", { newsId: n.id })).rejects.toThrow(
      "vigencia",
    );
    await db.agentWorkspace.update({
      where: { businessId: A },
      data: {
        sources: [
          {
            name: "Official",
            url: "https://example.com/rss",
            primary: true,
            geography: "Florida, Estados Unidos",
          },
        ],
      },
    });
    vi.mocked(readSource).mockResolvedValue(
      `<rss><item><title>Test</title><link>https://example.com/a</link><pubDate>${new Date().toISOString()}</pubDate><description>Changed</description></item></rss>`,
    );
    await collectNews(A, await loadContext(A));
    expect(
      await db.agentNews.findUnique({ where: { id: n.id } }),
    ).toMatchObject({ status: "changed", revision: 2 });
  });
  it("keeps verified source evidence on an unchanged feed", async () => {
    await db.agentWorkspace.update({
      where: { businessId: A },
      data: {
        sources: [
          {
            name: "Official",
            url: "https://example.com/rss",
            primary: true,
            geography: "Florida, Estados Unidos",
          },
        ],
      },
    });
    vi.mocked(readSource).mockResolvedValue(
      `<rss><item><title>Test</title><link>https://example.com/a</link><pubDate>${new Date().toISOString()}</pubDate><description>Same</description></item></rss>`,
    );
    await collectNews(A, await loadContext(A));
    const n = await db.agentNews.findFirstOrThrow({ where: { businessId: A } });
    await db.agentNews.update({
      where: { id: n.id },
      data: {
        status: "verified",
        summary: "Checked primary article",
        evidence: [{ reviewed: true }],
      },
    });
    await collectNews(A, await loadContext(A));
    expect(
      await db.agentNews.findUnique({ where: { id: n.id } }),
    ).toMatchObject({
      status: "verified",
      summary: "Checked primary article",
      evidence: [{ reviewed: true }],
    });
  });
  it("does not treat three channels on one post as three measured posts", async () => {
    const c = await db.campaign.create({
      data: {
        businessId: A,
        name: "Not enough",
        createdAt: new Date(Date.now() - 10 * 86400000),
      },
    });
    const p = await db.post.create({
      data: {
        businessId: A,
        campaignId: c.id,
        text: "x",
        status: "done",
        targets: {
          create: ["facebook", "instagram", "linkedin"].map((channel) => ({
            channel,
            status: "sent",
            metrics: { create: { businessId: A, channel, impressions: 1000 } },
          })),
        },
      },
    });
    const out = await analyzeResults(A);
    expect(JSON.stringify(out.data)).toContain('"confidence":"insuficiente"');
    expect(p).toBeTruthy();
  });
  it("confirms the exact render quote and journals bounded video polling without a second render", async () => {
    const r = await ask("Prepara un video", { kind: "video" });
    for (let i = 0; i < 3; i++)
      await workOne(
        A,
        async (_run, name) => ({
          data:
            name === "research"
              ? research
              : name === "copy"
                ? copy
                : {
                    assets: [
                      { shape: "square", url: "https://example.com/owned.jpg" },
                    ],
                  },
        }),
        () => 0,
      );
    await workOne(A, executeStep, (name) => (name === "video" ? 50 : 0));
    expect(startRender).toHaveBeenCalledTimes(1);
    const args = vi.mocked(startRender).mock.calls[0];
    const quote = args[2];
    expect(quote).toBe(
      projectCost((await loadProject(A, args[1])).project.storyboard),
    );
    expect(quote).toBeLessThanOrEqual(50);
    await workOne(A, executeStep, () => 0);
    expect(await db.agentRun.findUnique({ where: { id: r.id } })).toMatchObject(
      { status: "waiting_provider", stage: 4, chargedCents: 50 },
    );
    await changeRun(A, r.id, "refresh");
    await workOne(A, executeStep, () => 0);
    expect(startRender).toHaveBeenCalledTimes(1);
    expect(advanceRender).toHaveBeenCalledTimes(2);
    expect(
      await db.agentStep.count({
        where: { runId: r.id, name: { startsWith: "video_wait:" } },
      }),
    ).toBe(2);
  });
  it("never gives an agent video a YouTube target, even when YouTube is allowed and connected", async () => {
    await saveSettings(A, { ...settings, channels: ["facebook", "youtube"] });
    await db.connection.create({ data: { businessId: A, channel: "youtube", secret: "synthetic-no-provider-access" } });
    const texts = { title: "Techos #Shorts", description: "Descripción", tags: ["techos"], instagram: "IG", tiktok: "TT", facebook: "Texto del video para Facebook." };
    vi.mocked(advanceRender).mockResolvedValue({ status: "ready", videoUrl: "https://example.com/agent-video.mp4", storyboard: { texts } } as never);
    const r = await ask("Prepara un video", { kind: "video" });
    for (let i = 0; i < 3; i++)
      await workOne(A, async (_run, name) => ({ data: name === "research" ? research : name === "copy" ? copy : { assets: [{ shape: "square", url: "https://example.com/owned.jpg" }] } }), () => 0);
    for (let i = 0; i < 6 && !(await db.post.findUnique({ where: { id: `agent-${r.id}` } })); i++)
      await workOne(A, executeStep, (name) => (name === "video" ? 50 : 0));
    const post = await db.post.findUniqueOrThrow({ where: { id: `agent-${r.id}` }, include: { targets: true } });
    expect(post.kind).toBe("video");
    expect(post.targets.map((t) => t.channel)).toEqual(["facebook"]);
    const prepare = await db.agentStep.findUniqueOrThrow({ where: { runId_name: { runId: r.id, name: "prepare" } } });
    expect(prepare.output).toMatchObject({ blockedChannels: ["youtube"] });
  });
  it("caps actual delivery on the sending day, including delayed scheduled work", async () => {
    const r = await prepared();
    await workOne(A, executeStep, () => 0);
    await db.agentBudget.updateMany({
      where: { businessId: A },
      data: { deliveries: 3 },
    });
    expect(await claimAgentPost(`agent-${r.id}`)).toEqual({ count: 0 });
    expect(
      await db.post.findUnique({ where: { id: `agent-${r.id}` } }),
    ).toMatchObject({ status: "draft" });
  });
  it("keeps a proposed law proposed and refuses contradictory primary-source verification", async () => {
    vi.stubEnv("MATYA_AGENT_PROVIDER", "openai");
    vi.stubEnv("MATYA_AGENT_MODEL", "fixture");
    vi.stubEnv("MATYA_AGENT_INPUT_USD_PER_MILLION", "1");
    vi.stubEnv("MATYA_AGENT_OUTPUT_USD_PER_MILLION", "4");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
    const article =
      "El proyecto fue presentado para su discusión. Todavía no ha sido aprobado ni ha entrado en vigor. Este es un texto sintético de prueba local.";
    vi.mocked(readSource).mockResolvedValue(article);
    const n = await db.agentNews.create({
      data: {
        businessId: A,
        canonicalUrl: "https://example.com/proposal",
        eventKey: "proposal",
        title: "Proyecto de ley",
        source: "Official fixture",
        status: "source_ready",
        contentHash: "new",
        evidence: [{ primary: true, geography: "Florida, Estados Unidos" }],
      },
    });
    const value = {
      relevant: true,
      eventDate: new Date().toISOString().slice(0, 10),
      status: "proposed",
      effectiveDate: "",
      summary: "Propuesta para discusión; no es una norma vigente.",
      quotes: ["El proyecto fue presentado para su discusión."],
      contradiction: false,
    };
    const response = (v: unknown) =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(v) } }],
          usage: { prompt_tokens: 500, completion_tokens: 100 },
        }),
      );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(value))
        .mockResolvedValueOnce(
          response({
            ...value,
            status: "effective",
            effectiveDate: "",
            contradiction: true,
          }),
        ),
    );
    try {
      await ask("Contrasta noticia", { kind: "verify_news", newsId: n.id });
      await workOne(A);
      const verified = await db.agentNews.findUniqueOrThrow({
        where: { id: n.id },
      });
      expect(verified.status).toBe("verified");
      expect(JSON.stringify(verified.evidence)).toContain("proposed");
      await db.agentNews.update({
        where: { id: n.id },
        data: { status: "changed" },
      });
      await ask("Contrasta cambio", { kind: "verify_news", newsId: n.id });
      await workOne(A);
      expect(
        await db.agentNews.findUnique({ where: { id: n.id } }),
      ).toMatchObject({ status: "needs_review" });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
  it("enforces RLS with no anon or authenticated table grants", async () => {
    const tables = await db.$queryRaw<
      { name: string; rls: boolean; anon: boolean; authed: boolean }[]
    >`SELECT c.relname as name,c.relrowsecurity as rls,has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as authed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('AgentWorkspace','AgentRun','AgentStep','AgentMessage','AgentBudget','AgentNews')`;
    expect(tables).toHaveLength(6);
    for (const t of tables)
      expect(t).toMatchObject({ rls: true, anon: false, authed: false });
  });
  // Team mode: runs whose steps come from a stored plan.
  const roof = {
    id: "p1",
    topic: "Techos",
    channels: ["facebook"],
    format: "post" as const,
    objective: "",
    keyword: "",
  };
  const POST = ["copy", "design", "review", "prepare", "schedule", "verify"];
  async function teamParent() {
    await saveSettings(A, { ...settings, teamMode: true });
    const parent = await enqueue(A, {
      text: "x",
      kind: "team",
      requestKey: key(crypto.randomUUID()),
    });
    // Pieces are spawned by the parent's own `dispatch` step: it holds the lease meanwhile.
    expect((await claimRun(A))?.id).toBe(parent.id);
    return parent;
  }
  async function pieceRun() {
    const [child] = await spawnPieces(await teamParent(), [roof]);
    return child;
  }
  const runner =
    (byName: Record<string, StepResult> = {}, ran: string[] = []) =>
    async (_run: AgentRun, name: string): Promise<StepResult> => {
      ran.push(name);
      return byName[name] ?? { data: {} };
    };
  const row = (id: string) => db.agentRun.findUniqueOrThrow({ where: { id } });
  it("refuses direct piece requests, team requests without team mode and a spoofed origin", async () => {
    await expect(ask("x", { kind: "piece" })).rejects.toThrow("directamente");
    await expect(ask("x", { kind: "team" })).rejects.toThrow("modo equipo");
    expect(await db.agentRun.count({ where: { businessId: A } })).toBe(0);
    const r = await ask("Ponme al día", { origin: "daily" });
    expect(r).toMatchObject({ kind: "briefing", origin: "owner", plan: null });
    await saveSettings(A, { ...settings, teamMode: true });
    await expect(ask("x", { kind: "piece" })).rejects.toThrow("directamente");
    const team = await ask("x", { kind: "team" });
    expect(team).toMatchObject({ kind: "team", plan: { kind: "team" } });
    expect(stepsOf(team)).toEqual(["plan", "research", "strategy", "dispatch"]);
  });
  it("a piece follows its plan and completes at the end of its template", async () => {
    const parent = await teamParent();
    expect(parent.origin).toBe("owner");
    const [child] = await spawnPieces(parent, [roof]);
    expect(child).toMatchObject({
      kind: "piece",
      status: "queued",
      parentRunId: parent.id,
      requestKey: `${parent.requestKey}:p1`,
      origin: parent.origin,
      plan: { kind: "piece", piece: roof, steps: stepsForPiece("post") },
      context: { piece: roof, revision: (parent.context as { revision: number }).revision },
    });
    expect(stepsOf(child)).toEqual(stepsForPiece("post").map((s) => s.id));
    const ran: string[] = [];
    for (let i = 0; i < 6; i++) await workOne(A, runner({}, ran), () => 0);
    expect(ran).toEqual(POST);
    expect(await row(child.id)).toMatchObject({ status: "completed", stage: 6 });
    // The parent keeps its own lease; it is not run by the piece's ticks.
    expect(await row(parent.id)).toMatchObject({ status: "running", stage: 0 });
    const steps = await db.agentStep.findMany({
      where: { runId: child.id },
      orderBy: { createdAt: "asc" },
    });
    expect(steps.map((s) => [s.name, s.agent, s.specialist, s.attempt])).toEqual([
      ["copy", "copy", "copy", 0],
      ["design", "design", "design", 0],
      ["review", "review", "review", 0],
      ["prepare", "matya", "matya", 0],
      ["schedule", "matya", "matya", 0],
      ["verify", "matya", "matya", 0],
    ]);
  });
  it("records each step's agent, model and attempt; old callers keep their specialist", async () => {
    const r = await ask();
    const c = await claimRun(A);
    expect(
      await beginStep(r.id, c!.leaseToken, "research", 0, {
        agent: "seo",
        model: "gemini:gemini-2.5-flash",
        attempt: 2,
      }),
    ).toMatchObject({ specialist: "seo", agent: "seo", model: "gemini:gemini-2.5-flash", attempt: 2 });
    await finishStep(r.id, c!.leaseToken, "research", { data: research });
    const next = await claimRun(A);
    expect(await beginStep(r.id, next!.leaseToken, "copy", 0)).toMatchObject({
      specialist: "redaccion",
      agent: "",
      model: "",
      attempt: 0,
    });
  });
  it("insertSteps adds the round right after the current step", async () => {
    const child = await pieceRun();
    const ran: string[] = [];
    const exec = runner(
      {
        review: {
          data: { approved: false, problems: [] },
          insertSteps: reworkSteps(
            [{ kind: "canal", detail: "Falta el texto", sendBackTo: "copy" }],
            0,
          ),
        },
      },
      ran,
    );
    for (let i = 0; i < 3; i++) await workOne(A, exec, () => 0);
    const after = await row(child.id);
    expect(after).toMatchObject({ status: "queued", stage: 3 });
    expect(stepsOf(after)).toEqual([
      "copy",
      "design",
      "review",
      "copy-r1",
      "design-r1",
      "review-r1",
      "prepare",
      "schedule",
      "verify",
    ]);
    await workOne(A, exec, () => 0);
    expect(ran).toEqual(["copy", "design", "review", "copy-r1"]);
    expect(
      await db.agentStep.findUniqueOrThrow({
        where: { runId_name: { runId: child.id, name: "copy-r1" } },
      }),
    ).toMatchObject({ agent: "copy", attempt: 1, status: "succeeded" });
    // The run ends at the end of the longer plan, not the template's six steps.
    for (let i = 0; i < 5; i++) await workOne(A, exec, () => 0);
    expect(ran.slice(4)).toEqual(["design-r1", "review-r1", "prepare", "schedule", "verify"]);
    expect(await row(child.id)).toMatchObject({ status: "completed", stage: 9 });
  });
  it("ignores insertSteps outside pieces and never repeats a step id", async () => {
    const r = await ask();
    await workOne(
      A,
      async () => ({
        data: research,
        insertSteps: [{ id: "copy-r1", agent: "copy", attempt: 1 }],
      }),
      () => 0,
    );
    expect(await row(r.id)).toMatchObject({ status: "queued", stage: 1, plan: null });
    expect(stepsOf(await row(r.id))).toHaveLength(6);
    await changeRun(A, r.id, "cancel");
    const child = await pieceRun();
    await workOne(
      A,
      runner({
        copy: {
          data: {},
          insertSteps: [
            { id: "review", agent: "review", attempt: 0 },
            { id: "design-r1", agent: "design", attempt: 1 },
            { id: "design-r1", agent: "design", attempt: 1 },
          ],
        },
      }),
      () => 0,
    );
    expect(stepsOf(await row(child.id))).toEqual([
      "copy",
      "design-r1",
      "design",
      "review",
      "prepare",
      "schedule",
      "verify",
    ]);
  });
  it("redo on waiting_approval inserts a round before the waiting step", async () => {
    const child = await pieceRun();
    const ran: string[] = [];
    // e.g. approval mode: the review passed and the piece waits for the owner.
    const passed: StepResult = {
      data: { approved: true, problems: [] },
      state: "waiting_approval",
    };
    for (let i = 0; i < 3; i++) await workOne(A, runner({ review: passed }, ran), () => 0);
    expect(await row(child.id)).toMatchObject({ status: "waiting_approval", stage: 3 });
    expect(stepsOf(child)[3]).toBe("prepare");
    await db.agentRun.update({ where: { id: child.id }, data: { approvedAt: new Date() } });
    await changeRun(A, child.id, "redo");
    let now = await row(child.id);
    // The redone piece needs a new approval.
    expect(now).toMatchObject({ status: "queued", stage: 3, approvedAt: null });
    expect(stepsOf(now)).toEqual([
      "copy",
      "design",
      "review",
      "copy-r1",
      "design-r1",
      "review-r1",
      "prepare",
      "schedule",
      "verify",
    ]);
    // The re-review only finds an image problem: the second redo only redoes the design.
    const failed: StepResult = {
      data: {
        approved: false,
        problems: [{ kind: "falta-imagen", detail: "Sin imagen", sendBackTo: "design" }],
      },
      state: "waiting_approval",
    };
    for (let i = 0; i < 3; i++)
      await workOne(A, runner({ "review-r1": failed }, ran), () => 0);
    expect(ran).toEqual(["copy", "design", "review", "copy-r1", "design-r1", "review-r1"]);
    expect(await row(child.id)).toMatchObject({ status: "waiting_approval", stage: 6 });
    await changeRun(A, child.id, "redo");
    now = await row(child.id);
    expect(stepsOf(now)).toEqual([
      "copy",
      "design",
      "review",
      "copy-r1",
      "design-r1",
      "review-r1",
      "design-r2",
      "review-r2",
      "prepare",
      "schedule",
      "verify",
    ]);
    expect((now.plan as { steps: unknown[] }).steps.slice(6, 8)).toEqual([
      { id: "design-r2", agent: "design", attempt: 2 },
      { id: "review-r2", agent: "review", attempt: 2 },
    ]);
    await workOne(A, runner({}, ran), () => 0);
    expect(ran.at(-1)).toBe("design-r2");
    expect(
      await db.agentStep.findUniqueOrThrow({
        where: { runId_name: { runId: child.id, name: "design-r2" } },
      }),
    ).toMatchObject({ agent: "design", attempt: 2 });
  });
  it("refuses redo unless a piece waits right after its review, and two clicks add one round", async () => {
    const r = await prepared("approval");
    await workOne(A, executeStep, () => 0);
    expect(await row(r.id)).toMatchObject({ status: "waiting_approval", stage: 4 });
    await expect(changeRun(A, r.id, "redo")).rejects.toThrow("rehacer");
    expect(await row(r.id)).toMatchObject({ status: "waiting_approval", plan: null });
    await changeRun(A, r.id, "cancel");
    const child = await pieceRun();
    await expect(changeRun(A, child.id, "redo")).rejects.toThrow("rehacer");
    // Waiting at `schedule`: the previous step is `prepare`, not a review.
    await db.agentRun.update({
      where: { id: child.id },
      data: { status: "waiting_approval", stage: 4 },
    });
    await expect(changeRun(A, child.id, "redo")).rejects.toThrow("rehacer");
    expect(await row(child.id)).toMatchObject({ status: "waiting_approval", stage: 4 });
    expect(stepsOf(await row(child.id))).toEqual(POST);
    await db.agentRun.update({ where: { id: child.id }, data: { stage: 3 } });
    const both = await Promise.allSettled([
      changeRun(A, child.id, "redo"),
      changeRun(A, child.id, "redo"),
    ]);
    expect(both.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(stepsOf(await row(child.id))).toHaveLength(9);
  });
  it("claims the owner's requests before the daily ones", async () => {
    const daily = await enqueue(
      A,
      { text: "Plan del día", requestKey: key("daily-plan") },
      { origin: "daily", extraContext: { signals: { emptyDays: 2 }, business: { id: B } } },
    );
    const owner = await ask("Ponme al día");
    expect(daily).toMatchObject({ origin: "daily" });
    expect(owner).toMatchObject({ origin: "owner" });
    // Extra context is added, but never replaces the business it was loaded for.
    expect(daily.context).toMatchObject({ signals: { emptyDays: 2 }, business: { id: A } });
    expect((await claimRun(A))?.id).toBe(owner.id);
    expect((await claimRun(A))?.id).toBe(daily.id);
  });
  it("spawnPieces never repeats a piece, even at the same time", async () => {
    const parent = await teamParent();
    const [first] = await spawnPieces(parent, [roof]);
    const again = await Promise.all([
      spawnPieces(parent, [roof]),
      spawnPieces(parent, [roof]),
    ]);
    expect(again.map(([c]) => c.id)).toEqual([first.id, first.id]);
    expect(await db.agentRun.count({ where: { parentRunId: parent.id } })).toBe(1);
  });
  it("pieces count toward the open-work cap, spawnPieces ignores it, and a cancelled parent spawns nothing", async () => {
    const parent = await teamParent();
    const open = () =>
      db.agentRun.count({
        where: {
          businessId: A,
          status: { in: ["queued", "running", "waiting_approval", "waiting_provider"] },
        },
      });
    const pieces = Array.from({ length: 8 }, (_, i) => ({
      ...roof,
      id: `p${i + 1}`,
      topic: `Tema ${i + 1}`,
    }));
    // From 1 open to 9: dispatch is bounded by the daily post cap, not by this one.
    const kids = await spawnPieces(parent, pieces);
    expect(kids.map((k) => k.requestKey)).toEqual(
      pieces.map((p) => `${parent.requestKey}:${p.id}`),
    );
    expect(await open()).toBe(9);
    await expect(ask("Ponme al día")).rejects.toThrow("ocho trabajos abiertos");
    expect(
      await spawnPieces(parent, [{ ...roof, id: "p9", topic: "Otro tema" }]),
    ).toHaveLength(1);
    expect(await open()).toBe(10);
    // Cancelling while `dispatch` runs only flags the parent; no new piece is created.
    await changeRun(A, parent.id, "cancel");
    expect(
      await spawnPieces(parent, [{ ...roof, id: "p10", topic: "Tema diez" }]),
    ).toEqual([]);
    expect(await db.agentRun.count({ where: { parentRunId: parent.id } })).toBe(9);
  });
  it("a piece row with a team or broken plan never throws when its step settles", async () => {
    const child = await pieceRun();
    await db.agentRun.update({
      where: { id: child.id },
      data: { plan: { kind: "team" } },
    });
    const bad = await row(child.id);
    expect(planStepMeta(bad)).toBeUndefined();
    expect(stepsOf(bad)).toEqual(["plan", "research", "strategy", "dispatch"]);
    const c = await claimRun(A);
    expect(c?.id).toBe(child.id);
    await beginStep(child.id, c!.leaseToken, "plan", 0);
    await expect(
      finishStep(child.id, c!.leaseToken, "plan", {
        data: {},
        insertSteps: [{ id: "copy-r1", agent: "copy", attempt: 1 }],
      }),
    ).resolves.toBeUndefined();
    expect(await row(child.id)).toMatchObject({
      status: "queued",
      stage: 1,
      plan: { kind: "team" },
    });
    expect(
      await db.agentStep.findUniqueOrThrow({
        where: { runId_name: { runId: child.id, name: "plan" } },
      }),
    ).toMatchObject({ status: "succeeded" });
  });
  it("ignores insertSteps returned by a team run", async () => {
    await saveSettings(A, { ...settings, teamMode: true });
    const team = await ask("x", { kind: "team" });
    await workOne(
      A,
      async () => ({
        data: {},
        insertSteps: [{ id: "copy-r1", agent: "copy", attempt: 1 }],
      }),
      () => 0,
    );
    const after = await row(team.id);
    expect(after).toMatchObject({ status: "queued", stage: 1, plan: { kind: "team" } });
    expect(stepsOf(after)).toEqual(["plan", "research", "strategy", "dispatch"]);
  });
  it("extra context cannot carry a campaign, news or a piece past enqueue's checks", async () => {
    const other = await db.campaign.create({ data: { businessId: B, name: "B only" } });
    const extraContext = {
      signals: { emptyDays: 1 },
      campaignId: other.id,
      news: { id: "fake", title: "Sin contrastar" },
      piece: roof,
      revision: 999,
    };
    // The pause guard still needs a campaign checked against this business.
    await expect(
      enqueue(A, { text: "Pausa", kind: "pause", requestKey: key("extra-pause") }, { extraContext }),
    ).rejects.toThrow("Selecciona la campaña");
    const r = await enqueue(
      A,
      { text: "Ponme al día", requestKey: key("extra-brief") },
      { extraContext },
    );
    const ctx = r.context as Record<string, unknown>;
    expect(ctx.signals).toEqual({ emptyDays: 1 });
    expect(ctx).not.toHaveProperty("campaignId");
    expect(ctx).not.toHaveProperty("news");
    expect(ctx).not.toHaveProperty("piece");
    expect(ctx.revision).toBe((await loadContext(A)).revision);
  });
  it("redo on an article piece sends everything back to the writer", async () => {
    const parent = await teamParent();
    const [child] = await spawnPieces(parent, [
      { ...roof, format: "articulo", channels: ["seo"] },
    ]);
    expect(stepsOf(child)).toEqual(["article", "review", "article_publish"]);
    const failed = (name: string): Record<string, StepResult> => ({
      [name]: {
        data: {
          approved: false,
          problems: [{ kind: "falta-imagen", detail: "Sin imagen", sendBackTo: "design" }],
        },
        state: "waiting_approval",
      },
    });
    const ran: string[] = [];
    for (let i = 0; i < 2; i++) await workOne(A, runner(failed("review"), ran), () => 0);
    expect(await row(child.id)).toMatchObject({ status: "waiting_approval", stage: 2 });
    await changeRun(A, child.id, "redo");
    expect(stepsOf(await row(child.id))).toEqual([
      "article",
      "review",
      "article-r1",
      "review-r1",
      "article_publish",
    ]);
    for (let i = 0; i < 2; i++) await workOne(A, runner(failed("review-r1"), ran), () => 0);
    expect(ran).toEqual(["article", "review", "article-r1", "review-r1"]);
    await changeRun(A, child.id, "redo");
    const now = await row(child.id);
    expect(stepsOf(now)).toEqual([
      "article",
      "review",
      "article-r1",
      "review-r1",
      "article-r2",
      "review-r2",
      "article_publish",
    ]);
    expect((now.plan as { steps: unknown[] }).steps.slice(4, 6)).toEqual([
      { id: "article-r2", agent: "copy", attempt: 2 },
      { id: "review-r2", agent: "review", attempt: 2 },
    ]);
  });
  it("refuses redo while MATYA is disabled and changes nothing", async () => {
    const child = await pieceRun();
    const passed: StepResult = {
      data: { approved: true, problems: [] },
      state: "waiting_approval",
    };
    for (let i = 0; i < 3; i++) await workOne(A, runner({ review: passed }), () => 0);
    const before = await row(child.id);
    expect(before).toMatchObject({ status: "waiting_approval", stage: 3 });
    await saveSettings(A, { ...settings, teamMode: true, enabled: false });
    await expect(changeRun(A, child.id, "redo")).rejects.toThrow("Activa MATYA");
    const after = await row(child.id);
    expect(after).toMatchObject({ status: "waiting_approval", stage: 3 });
    expect(after.plan).toEqual(before.plan);
  });

  describe("the team's agents and their closed toolboxes", () => {
    const DAY = 86400000;
    const modelEnv = {
      MATYA_AGENT_PROVIDER: "gemini",
      MATYA_AGENT_MODEL: "gemini-x",
      MATYA_AGENT_INPUT_USD_PER_MILLION: "0.3",
      MATYA_AGENT_OUTPUT_USD_PER_MILLION: "2.5",
      GEMINI_API_KEY: "synthetic-no-provider-access",
    };
    const stubModel = (on: boolean) => {
      for (const [k, v] of Object.entries(modelEnv))
        vi.stubEnv(k, on ? v : "");
    };
    afterEach(() => vi.unstubAllEnvs());
    const stepRow = (
      runId: string,
      name: string,
      output: unknown,
      status = "succeeded",
    ) =>
      db.agentStep.create({
        data: {
          runId,
          name,
          specialist: "matya",
          budgetDay: "2026-10-16",
          status,
          output: output as never,
        },
      });

    it("routes a team run's first step to the director, who is not available yet", async () => {
      stubModel(true);
      await saveSettings(A, { ...settings, teamMode: true });
      const team = await ask("x", { kind: "team" });
      await workOne(A, executeStep, () => 0);
      // The team kind reached its agent (and not the old `Paso desconocido.`); nothing was charged.
      expect(await row(team.id)).toMatchObject({
        status: "uncertain",
        stage: 0,
        error: "Agente no disponible.",
        chargedCents: 0,
        reservedCents: 0,
      });
      expect(
        await db.agentStep.findUniqueOrThrow({
          where: { runId_name: { runId: team.id, name: "plan" } },
        }),
      ).toMatchObject({ status: "uncertain", chargedCents: 0, reservedCents: 0 });
    });

    it("routes a piece's steps to the agent of its plan", async () => {
      stubModel(true);
      const child = await pieceRun();
      await workOne(A, executeStep, () => 0);
      expect(await row(child.id)).toMatchObject({
        status: "uncertain",
        error: "Agente no disponible.",
        chargedCents: 0,
      });
      expect(
        await db.agentStep.findUniqueOrThrow({
          where: { runId_name: { runId: child.id, name: "copy" } },
        }),
      ).toMatchObject({ agent: "copy", status: "uncertain" });
    });

    it("stops on the model's own setup error before the agent runs", async () => {
      stubModel(false);
      await saveSettings(A, { ...settings, teamMode: true });
      const team = await ask("x", { kind: "team" });
      const run = vi.spyOn(AGENTS.director, "run");
      await workOne(A, executeStep, () => 0);
      expect(run).not.toHaveBeenCalled();
      run.mockRestore();
      const after = await row(team.id);
      expect(after.error).toBe(
        "Falta configurar el modelo y sus tarifas verificadas para MATYA. El resumen de actividad sigue disponible.",
      );
      expect(after.chargedCents).toBe(0);
    });

    it("keeps the old kinds on their old route", async () => {
      const r = await ask("Ponme al día", { kind: "briefing" });
      await workOne(A, executeStep, () => 0);
      expect(await row(r.id)).toMatchObject({ status: "completed", error: "" });
    });

    it("readStepOutput returns the output of the highest succeeded round of the run's own step", async () => {
      const r = await ask();
      const other = await ask("Otro encargo");
      await stepRow(r.id, "copy", { v: 0 });
      await stepRow(r.id, "copy-r1", { v: 1 });
      await stepRow(r.id, "copy-r2", { v: 2 }, "uncertain");
      await stepRow(r.id, "copy-r10", { v: 10 });
      await stepRow(r.id, "copyright", { v: "no" });
      await stepRow(r.id, "design-r1", { v: "d1" });
      await stepRow(other.id, "research", { v: "other run" });
      const use = toolsFor(AGENTS.strategy, r).use("readStepOutput");
      expect(await use("copy")).toEqual({ v: 10 });
      expect(await use("design")).toEqual({ v: "d1" });
      expect(await use("research")).toBeNull();
      expect(await use("review")).toBeNull();
      // Only the round that succeeded counts, and a run cannot read another business through its own id.
      await db.agentStep.deleteMany({ where: { runId: r.id, name: "copy-r10" } });
      expect(await use("copy")).toEqual({ v: 1 });
      const spoofed = toolsFor(AGENTS.strategy, { ...r, businessId: B }).use(
        "readStepOutput",
      );
      expect(await spoofed("copy")).toBeNull();
    });

    const calendarPost = (id: string, scheduledAt: Date, extra: Record<string, unknown> = {}) => ({
      id,
      businessId: A,
      text: `Texto ${id}`,
      status: "scheduled",
      createdAt: scheduledAt,
      scheduledAt,
      ...extra,
    });
    const calendarCampaign = (id: string, startsAt: Date, extra: Record<string, unknown> = {}) => ({
      id,
      businessId: A,
      name: id,
      startsAt,
      createdAt: startsAt,
      ...extra,
    });
    const ago = (days: number) => new Date(Date.now() - days * DAY);

    it("readCalendar lists this business's posts scheduled in the window and nothing else", async () => {
      const post = (id: string, scheduledAt: Date, extra: Record<string, unknown> = {}) =>
        db.post.create({
          data: { ...calendarPost(id, scheduledAt, extra), targets: { create: [{ channel: "facebook" }] } } as never,
        });
      await post("cal-recent", ago(10));
      await post("cal-next", ago(-3), { createdAt: ago(40) });
      await post("cal-old", ago(40));
      // Created today but scheduled beyond the window: not listed, and `to` says why.
      await post("cal-far", ago(-20), { createdAt: new Date() });
      await db.post.create({ data: calendarPost("cal-b", ago(1), { businessId: B }) as never });
      const calendar = await toolsFor(AGENTS.director, await ask()).use("readCalendar")();
      expect(calendar.posts.map((p) => p.id)).toEqual(["cal-recent", "cal-next"]);
      expect(calendar.posts[1]).toMatchObject({
        status: "scheduled",
        channels: ["facebook"],
        text: "Texto cal-next",
        campaignId: null,
      });
      expect(calendar.truncated).toEqual({ past: false, upcoming: false, campaigns: false });
      expect(Date.parse(calendar.to) - Date.parse(calendar.from)).toBe(37 * DAY);
    });

    it("readCalendar lists the campaigns that overlap the window, running and evergreen ones included", async () => {
      const campaign = (id: string, startsAt: Date, extra: Record<string, unknown> = {}) =>
        db.campaign.create({ data: calendarCampaign(id, startsAt, extra) as never });
      await campaign("camp-running", ago(90), { status: "active", endsAt: ago(-30) });
      await campaign("camp-ended-recent", ago(60), { status: "ended", endsAt: ago(5) });
      await campaign("camp-evergreen", ago(40));
      await campaign("camp-now", new Date());
      await campaign("camp-soon", ago(-3));
      await campaign("camp-ended-old", ago(90), { status: "ended", endsAt: ago(60) });
      await campaign("camp-closed", ago(50), { status: "stopped" });
      await campaign("camp-future", ago(-20));
      await db.campaign.create({ data: calendarCampaign("camp-b", ago(1), { businessId: B }) as never });
      const calendar = await toolsFor(AGENTS.director, await ask()).use("readCalendar")();
      expect(calendar.campaigns.map((c) => c.id)).toEqual([
        "camp-running",
        "camp-ended-recent",
        "camp-evergreen",
        "camp-now",
        "camp-soon",
      ]);
      expect(calendar.campaigns[0]).toMatchObject({ status: "active", endsAt: expect.any(String) });
      expect(calendar.campaigns[2]).toMatchObject({ status: "draft", endsAt: null });
    });

    it("readCalendar keeps the upcoming posts when the past is busy and says it cut", async () => {
      const { past } = CALENDAR_LIMITS;
      const hour = 3600000;
      await db.post.createMany({
        data: [
          ...Array.from({ length: past + 25 }, (_, i) =>
            calendarPost(`busy-past-${i}`, new Date(Date.now() - (i + 1) * hour)),
          ),
          ...[1, 2, 3].map((d) => calendarPost(`busy-next-${d}`, ago(-d))),
        ] as never,
      });
      const calendar = await toolsFor(AGENTS.director, await ask()).use("readCalendar")();
      const ids = calendar.posts.map((p) => p.id);
      // The most recent of the past, oldest first, then everything that is coming.
      expect(ids).toEqual([
        ...Array.from({ length: past }, (_, i) => `busy-past-${past - 1 - i}`),
        "busy-next-1",
        "busy-next-2",
        "busy-next-3",
      ]);
      expect(calendar.truncated).toEqual({ past: true, upcoming: false, campaigns: false });
    });

    it("readCalendar keeps the soonest upcoming posts and the latest campaigns when they overflow", async () => {
      const { upcoming, campaigns } = CALENDAR_LIMITS;
      const hour = 3600000;
      await db.post.createMany({
        data: Array.from({ length: upcoming + 5 }, (_, i) =>
          calendarPost(`soon-${i}`, new Date(Date.now() + (i + 1) * 2 * hour)),
        ) as never,
      });
      await db.campaign.createMany({
        data: Array.from({ length: campaigns + 2 }, (_, i) =>
          calendarCampaign(`many-${i}`, new Date(Date.now() - (i + 1) * hour)),
        ) as never,
      });
      const calendar = await toolsFor(AGENTS.director, await ask()).use("readCalendar")();
      expect(calendar.posts.map((p) => p.id)).toEqual(
        Array.from({ length: upcoming }, (_, i) => `soon-${i}`),
      );
      expect(calendar.campaigns.map((c) => c.id)).toEqual(
        Array.from({ length: campaigns }, (_, i) => `many-${campaigns - 1 - i}`),
      );
      expect(calendar.truncated).toEqual({ past: false, upcoming: true, campaigns: true });
    });

    it("readSeoReports reads only this business's latest reports of a kind", async () => {
      for (const [businessId, n] of [[A, 1], [A, 2], [A, 3], [B, 9]] as const)
        await db.seoReport.create({ data: { businessId, kind: "keywords", data: { n } } });
      await db.seoReport.create({ data: { businessId: A, kind: "audit", data: { n: 7 } } });
      const use = toolsFor(AGENTS.seo, await ask()).use("readSeoReports");
      expect((await use("keywords")).map((r) => r.data)).toEqual([{ n: 3 }]);
      expect((await use("keywords", 2)).map((r) => r.data)).toEqual([{ n: 3 }, { n: 2 }]);
      expect((await use("keywords", 500)).map((r) => r.businessId)).toEqual([A, A, A]);
      expect((await use("audit")).map((r) => r.data)).toEqual([{ n: 7 }]);
    });

    it("readContext loads this business's context", async () => {
      const context = await toolsFor(AGENTS.director, await ask()).use("readContext")();
      expect(context.business.id).toBe(A);
      expect(context.industry.geography).toContain("Florida");
    });

    it("brandKit gives the business's brand and its own templates, or the factory ones", async () => {
      const r = await ask();
      const use = toolsFor(AGENTS.design, r).use("brandKit");
      const factory = await use();
      expect(factory.brand).toMatchObject({ name: "Ricardo PA · fixture" });
      expect(factory.brand.style).toBeTruthy();
      expect(factory.templates).toEqual(BUILTIN_TEMPLATES);
      const mine = { ...BUILTIN_TEMPLATES[1], name: "Mía" };
      await db.template.create({ data: { businessId: A, name: "Mía", spec: mine } });
      await db.template.create({
        data: { businessId: B, name: "De B", spec: { ...BUILTIN_TEMPLATES[2], name: "De B" } },
      });
      await db.template.create({ data: { businessId: A, name: "Rota", spec: { nope: true } } });
      expect((await use()).templates).toEqual([mine]);
    });

    it("listLibrary offers only this business's library photos", async () => {
      const owned = await libraryItem("lib-owned");
      await libraryItem("lib-other", { businessId: B });
      const use = toolsFor(AGENTS.design, await ask()).use("listLibrary");
      expect((await use("techos")).map((m) => m.id)).toEqual([owned.id]);
      expect((await use("techos", { kind: "photo", language: "en" })).map((m) => m.id)).toEqual([owned.id]);
      expect(await use("automóviles")).toEqual([]);
      await db.libraryItem.update({ where: { id: owned.id }, data: { usedCount: 1, lastUsedAt: new Date() } });
      expect(await use("techos")).toEqual([]);
      expect((await use("techos", { reuse: [owned.id] })).map((m) => m.id)).toEqual([owned.id]);
    });

    it("renderDesign always stores under the run's own business", async () => {
      const input = {
        brand: { name: "Marca", color: "#123456" },
        headline: "Titular",
        template: BUILTIN_TEMPLATES[4],
        shape: "square" as const,
      };
      const url = await toolsFor(AGENTS.design, await ask()).use("renderDesign")(input);
      expect(url).toBe("https://example.com/fixture-square.jpg");
      expect(storeDesign).toHaveBeenCalledWith(input, A, undefined);
    });

    const photo: VideoMedia = {
      id: "m1",
      kind: "photo",
      url: "https://example.com/m1.jpg",
      thumb: "https://example.com/m1.jpg",
      focus: null,
      width: 1080,
      height: 1920,
      durationSec: 0,
      about: "techos",
    };

    it("videoQuote prices a storyboard without music and starts nothing", async () => {
      const quote = await toolsFor(AGENTS.video, await ask()).use("videoQuote")("Cuida tu techo", [photo]);
      expect(quote.storyboard.music.on).toBe(false);
      expect(quote.cents).toBe(projectCost(quote.storyboard));
      expect(quote.maxCents).toBe(maxCentsPerVideo());
      expect(quote.storyboard.scenes.length).toBeGreaterThan(1);
      expect(startRender).not.toHaveBeenCalled();
      expect(await db.seoReport.count({ where: { businessId: A, kind: "video" } })).toBe(0);
    });

    it("startVideo saves the project and starts the render for the run's own business", async () => {
      const r = await ask();
      const { storyboard, cents } = await toolsFor(AGENTS.video, r).use("videoQuote")("Cuida tu techo", [photo]);
      const tools = toolsFor({ key: "video", tools: ["startVideo"] }, r);
      const started = await tools.use("startVideo")(storyboard, cents);
      expect(started.status).toBe("rendering");
      const saved = await db.seoReport.findUniqueOrThrow({ where: { id: started.projectId } });
      expect(saved).toMatchObject({ businessId: A, kind: "video" });
      expect(startRender).toHaveBeenCalledWith(A, started.projectId, cents, "auto");
      await tools.use("startVideo")(storyboard, cents, "approved");
      expect(vi.mocked(startRender).mock.calls[1][3]).toBe("approved");
      expect(await db.seoReport.count({ where: { businessId: B } })).toBe(0);
    });
  });
});
