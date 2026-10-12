/** Run only against the isolated local fixture, never a configured remote database. */
import { beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import { db } from "@/lib/db";
import {
  enqueue,
  saveSettings,
  claimRun,
  beginStep,
  finishStep,
  recoverExpired,
  changeRun,
} from "@/lib/agent/queue";
import { workOne, executeStep, analyzeResults } from "@/lib/agent/execution";
import { claimAgentPost } from "@/lib/agent/publication";
import { loadContext } from "@/lib/agent/context";
import { DEFAULT_SETTINGS } from "@/components/agent/types";
import { collectNews } from "@/lib/agent/news";
import { readSource } from "@/lib/agent/network";
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
} from "@/lib/video-jobs";
const url = process.env.MATYA_TEST_DATABASE_URL ?? "";
const safe =
  !!url &&
  process.env.DATABASE_URL === url &&
  /^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/matya_agent$/.test(url);
const A = "matya-it-a",
  B = "matya-it-b";
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
    vi.mocked(videoBlocker).mockReturnValue(null);
    process.env.MATYA_AGENT_ENABLED = "true";
    await db.business.deleteMany({ where: { id: { in: [A, B] } } });
    await db.business.createMany({
      data: [
        {
          id: A,
          name: "Ricardo PA · fixture",
          timezone: "America/New_York",
          aiProfile: "Solo propiedades Florida",
        },
        {
          id: B,
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
});
