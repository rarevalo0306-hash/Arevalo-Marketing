// Cajas de herramientas cerradas: cada agente solo puede usar las suyas, y todas trabajan con el negocio del encargo.
// Una herramienta es un envoltorio pequeño de una función que ya existe; ninguna recibe un id de negocio de fuera.
import type { AgentRun } from "@prisma/client";
import { db } from "@/lib/db";
import { notesFor, type ChannelId, type Draft, type Note } from "@/lib/channels";
import { BUILTIN_TEMPLATES, StoredTemplate } from "@/lib/design-shapes";
import { designStyleOf } from "@/lib/design-style";
import type { Brand, DesignInput } from "@/lib/design";
import { storeDesign } from "@/lib/media-formats";
import type { PhotoMeta } from "@/lib/photo-meta";
import { BiError } from "@/lib/i18n";
import { latestReports, type SeoKind } from "@/lib/seo/reports";
import { approveCostCents, type SitePhoto } from "@/lib/seo/site-article";
import { approveForSite, prepareForSite, sitePhotoCents } from "@/lib/seo/site-article-run";
import type { WriterLang } from "@/lib/seo/writer";
import { createArticleReport } from "@/lib/seo/writer-run";
import {
  createProject,
  maxCentsPerVideo,
  planContext,
  projectCost,
  startRender,
  videoBusiness,
} from "@/lib/video-jobs";
import {
  templateStoryboard,
  type Storyboard,
  type VideoMedia,
} from "@/lib/video-plan";
import { AgentError } from "../access";
import { loadContext } from "../context";
import { libraryMedia } from "../library";
import { paidCall } from "../spend";
import type { AgentKey } from "../plan";
import type { Context } from "../schema";

export type ToolName =
  | "readContext"
  | "readSeoReports"
  | "readCalendar"
  | "readSignals"
  | "readStepOutput"
  | "brandKit"
  | "listLibrary"
  | "renderDesign"
  | "channelRules"
  | "videoQuote"
  | "startVideo"
  | "writeArticle"
  | "publishArticle";

/** How many rows `readCalendar` returns at most from each part (it asks one more to know it cut). */
export const CALENDAR_LIMITS = { past: 40, upcoming: 40, campaigns: 30 } as const;
/**
 * The business's calendar. The window is `[from, to]` = the last 30 days up to the next 7, in ISO.
 * - `posts`: those whose `scheduledAt` is in the window (a draft counts from when it was made),
 *   oldest first. A post scheduled further ahead than `to` is not listed.
 * - `campaigns`: those that overlap the window (`startsAt <= to` and no end or `endsAt >= from`),
 *   so a campaign that started earlier and still runs is listed. One closed without an end date
 *   (`stopped`, `ended`) is not. Oldest start first.
 * - `truncated`: a part had more rows than `CALENDAR_LIMITS`. Past posts keep the most recent and
 *   upcoming posts the soonest; campaigns keep the most recently started. Past and upcoming
 *   posts are capped apart, so a busy month never hides what is about to go out.
 */
export type Calendar = {
  from: string;
  to: string;
  truncated: { past: boolean; upcoming: boolean; campaigns: boolean };
  posts: {
    id: string;
    status: string;
    kind: string;
    subject: string;
    text: string;
    scheduledAt: string;
    createdAt: string;
    campaignId: string | null;
    channels: string[];
  }[];
  campaigns: {
    id: string;
    name: string;
    status: string;
    mode: string;
    startsAt: string;
    endsAt: string | null;
    channels: string[];
    perWeek: number;
  }[];
};
export type BrandKit = { brand: Brand; templates: StoredTemplate[] };
export type LibraryOptions = {
  language?: "es" | "en";
  /** `photo`: only the single best photo. Without it, up to six photos and clips. */
  kind?: "photo";
  /** Library ids this same piece already uses (they may come out again today). */
  reuse?: string[];
};
export type VideoQuote = { storyboard: Storyboard; cents: number; maxCents: number };
/** A written article: its saved report (`SeoReport` kind `article`), the score, what Google cost (USD), the pages read and the AI. */
export type ArticleMade = { id: string; score: number; cost: number; pagesRead: number; provider: string };
/**
 * What `publishArticle` did. `published: false`: the article is prepared for the website but its photo is an extra cost (an AI
 * image to create, or one already created that the owner has not seen yet): nothing was generated or published, and
 * `photoCents` is what authorizing it will cost. `published: true`: it is on the website.
 */
export type ArticlePublish =
  | { published: false; photo: SitePhoto["kind"]; photoCents: number; title: string; urlEs: string; urlEn: string }
  | { published: true; url: string; urlEn: string; costCents: number; photoFailed: boolean; already: boolean };

/**
 * How `publishArticle` goes about it. The default: prepares the preview (the translation, a few cents) and publishes it with
 * `approveForSite` when its photo costs nothing extra; an AI photo waits (`published: false`). `{ approved: true, expectedCents }`:
 * the owner approved that photo's cost, so it authorizes the already prepared preview, and `approveForSite` refuses it if the
 * price is no longer `expectedCents` (what the step reserved). `beforePublish` runs right before the article is authorized (never
 * for a preview that waits), so the caller can take its place in the day's posts under the business lock.
 */
export type PublishOptions = { beforePublish?: () => Promise<void> } & (
  | { approved?: false }
  | { approved: true; expectedCents: number }
);

/** What each tool is, once it is bound to a run. The types of the later tasks' tools are refined by them. */
export type ToolImpl = {
  readContext: () => Promise<Context>;
  readSeoReports: (
    kind: SeoKind,
    take?: number,
  ) => ReturnType<typeof latestReports>;
  readCalendar: () => Promise<Calendar>;
  readSignals: () => Promise<unknown>;
  /** The output of the run's succeeded step `base`, or of its latest rework (`base-r<n>`); a piece falls back to its team run's step. Null if none. */
  readStepOutput: (base: string) => Promise<unknown>;
  brandKit: () => Promise<BrandKit>;
  /**
   * Not a pure read: a Drive clip that was picked is copied into storage so the storyboard has
   * a URL (a write; it can throw for an oversized or unsupported clip). Photos are only read.
   */
  listLibrary: (idea: string, options?: LibraryOptions) => Promise<VideoMedia[]>;
  renderDesign: (input: DesignInput, meta?: PhotoMeta) => Promise<string>;
  channelRules: (channel: ChannelId, draft: Draft) => Note[];
  videoQuote: (
    idea: string,
    media: VideoMedia[],
    language?: "es" | "en",
  ) => Promise<VideoQuote>;
  startVideo: (
    storyboard: Storyboard,
    cents: number,
    actor?: "auto" | "approved",
  ) => Promise<{ projectId: string; status: string }>;
  /**
   * One paid draft (Google, then the AI): `createArticleReport` for the run's business. The language is the one the
   * business's customers search in unless given. The caller must have reserved and been allowed to spend: this reserves nothing.
   */
  writeArticle: (keyword: string, language?: WriterLang) => Promise<ArticleMade>;
  publishArticle: (reportId: string, options?: PublishOptions) => Promise<ArticlePublish>;
};
export type Tools = { use<T extends ToolName>(name: T): ToolImpl[T] };

const DAY = 86400000;

/** A run as `readStepOutput` needs it: a piece also carries the team run it belongs to (`parentRunId`). */
type StepReader = Pick<AgentRun, "id" | "businessId"> & {
  parentRunId?: string | null;
};

/** The output of the succeeded step `base` (or its highest rework `base-r<n>`) of one run of the business; null if it has none. */
async function stepOutput(
  runId: string,
  businessId: string,
  base: string,
): Promise<{ output: unknown } | null> {
  const rows = await db.agentStep.findMany({
    where: {
      runId,
      run: { businessId },
      status: "succeeded",
      name: { startsWith: base },
    },
    select: { name: true, output: true },
  });
  let best: { round: number; output: unknown } | null = null;
  for (const row of rows) {
    const rest = row.name.slice(base.length);
    const round = rest === "" ? 0 : Number(/^-r(\d+)$/.exec(rest)?.[1] ?? NaN);
    if (Number.isNaN(round)) continue;
    if (!best || round > best.round) best = { round, output: row.output };
  }
  return best;
}

/**
 * The output of the run's succeeded step `base`, or of its latest rework (`base-r<n>`); null if none.
 * A piece that has no such step of its own reads the one of its team run (`parentRunId`), which is where the team's
 * `research` and `plan` are; the run's own step always wins. Always scoped to the run's business: neither its own steps nor
 * its parent's are read through another business. The `readStepOutput` tool wraps this, and the engine's own steps
 * (`dispatch`) call it directly.
 */
export async function readStepOutput(
  run: StepReader,
  base: string,
): Promise<unknown> {
  const own = await stepOutput(run.id, run.businessId, base);
  if (own) return own.output;
  if (!run.parentRunId) return null;
  return (await stepOutput(run.parentRunId, run.businessId, base))?.output ?? null;
}

const later = async (): Promise<never> => {
  throw new AgentError("Herramienta no disponible todavía.");
};

/** The error of the website article's functions (bilingual) as an `AgentError` in Spanish, the run's language of errors. */
export const agentErrorOf = (e: unknown): unknown =>
  e instanceof BiError ? new AgentError(e.message) : e;

/** The language an article is written in: the one the business's customers search in (as the writer's form defaults to). */
async function articleLanguage(businessId: string): Promise<WriterLang> {
  const b = await db.business.findUnique({ where: { id: businessId }, select: { seoLanguage: true } });
  return b?.seoLanguage === "en" ? "en" : "es";
}

/** What `publishArticle` reports of a published article: where it is and what it cost. */
const publishedOf = (p: Awaited<ReturnType<typeof approveForSite>>): ArticlePublish => ({
  published: true,
  url: p.url,
  urlEn: p.urlEn,
  costCents: p.costCents,
  photoFailed: p.photoFailed,
  already: p.already,
});

/** A photo that is an extra cost to authorize: one the AI has to create, or one it created that the owner has not approved. */
export const photoNeedsApproval = (photo: SitePhoto) => photo.kind === "generate" || photo.kind === "generated";

const IMPLS: { [K in ToolName]: (run: AgentRun) => ToolImpl[K] } = {
  readContext: (run) => () => loadContext(run.businessId),

  readSeoReports: (run) => (kind, take = 1) =>
    latestReports(run.businessId, kind, Math.min(Math.max(Math.trunc(take) || 1, 1), 10)),

  readCalendar: (run) => async () => {
    const nowMs = Date.now();
    const now = new Date(nowMs);
    const from = new Date(nowMs - 30 * DAY);
    const to = new Date(nowMs + 7 * DAY);
    const postSelect = {
      id: true,
      status: true,
      kind: true,
      subject: true,
      text: true,
      scheduledAt: true,
      createdAt: true,
      campaignId: true,
      targets: { select: { channel: true } },
    } as const;
    const [past, upcoming, campaigns] = await Promise.all([
      db.post.findMany({
        where: { businessId: run.businessId, scheduledAt: { gte: from, lt: now } },
        orderBy: { scheduledAt: "desc" },
        take: CALENDAR_LIMITS.past + 1,
        select: postSelect,
      }),
      db.post.findMany({
        where: { businessId: run.businessId, scheduledAt: { gte: now, lte: to } },
        orderBy: { scheduledAt: "asc" },
        take: CALENDAR_LIMITS.upcoming + 1,
        select: postSelect,
      }),
      db.campaign.findMany({
        where: {
          businessId: run.businessId,
          startsAt: { lte: to },
          OR: [
            { endsAt: { gte: from } },
            { endsAt: null, status: { notIn: ["stopped", "ended"] } },
          ],
        },
        orderBy: { startsAt: "desc" },
        take: CALENDAR_LIMITS.campaigns + 1,
        select: {
          id: true,
          name: true,
          status: true,
          mode: true,
          startsAt: true,
          endsAt: true,
          channels: true,
          perWeek: true,
        },
      }),
    ]);
    const keepPast = past.slice(0, CALENDAR_LIMITS.past).reverse();
    const keepUpcoming = upcoming.slice(0, CALENDAR_LIMITS.upcoming);
    const keepCampaigns = campaigns.slice(0, CALENDAR_LIMITS.campaigns).reverse();
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      truncated: {
        past: past.length > CALENDAR_LIMITS.past,
        upcoming: upcoming.length > CALENDAR_LIMITS.upcoming,
        campaigns: campaigns.length > CALENDAR_LIMITS.campaigns,
      },
      posts: [...keepPast, ...keepUpcoming].map(
        ({ targets, text, scheduledAt, createdAt, ...p }) => ({
          ...p,
          text: text.slice(0, 300),
          scheduledAt: scheduledAt.toISOString(),
          createdAt: createdAt.toISOString(),
          channels: targets.map((t) => t.channel),
        }),
      ),
      campaigns: keepCampaigns.map(({ startsAt, endsAt, ...c }) => ({
        ...c,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt?.toISOString() ?? null,
      })),
    };
  },

  readSignals: () => later,

  readStepOutput: (run) => (base) => readStepOutput(run, base),

  // As the current `design` step reads it: the business's own templates, or the factory ones.
  brandKit: (run) => async () => {
    const [b, rows] = await Promise.all([
      db.business.findUniqueOrThrow({ where: { id: run.businessId } }),
      db.template.findMany({ where: { businessId: run.businessId }, take: 20 }),
    ]);
    const own = rows.flatMap((r) => {
      const parsed = StoredTemplate.safeParse(r.spec);
      return parsed.success ? [parsed.data] : [];
    });
    return {
      brand: {
        name: b.name,
        color: b.color,
        color2: b.color2,
        color3: b.color3,
        logoUrl: b.logoUrl,
        logoLightUrl: b.logoLightUrl,
        phone: b.phone,
        website: b.website,
        fontHeading: b.fontHeading,
        fontBody: b.fontBody,
        style: designStyleOf(b).style,
      },
      templates: own.length ? own : BUILTIN_TEMPLATES,
    };
  },

  listLibrary: (run) => (idea, options = {}) =>
    libraryMedia(
      run.businessId,
      idea,
      options.language ?? "es",
      options.kind,
      options.reuse,
    ),

  // The folder is the business: a design is always stored under the run's own business.
  renderDesign: (run) => (input, meta) => storeDesign(input, run.businessId, meta),

  channelRules: () => (channel, draft) => notesFor(channel, draft),

  // The same quote the current `video` step makes: no music, and the price of that storyboard.
  videoQuote: (run) => async (idea, media, language = "es") => {
    const context = planContext(await videoBusiness(run.businessId), {
      idea,
      format: "vertical",
      media,
      lang: language,
    });
    context.music = null;
    const storyboard = templateStoryboard(context);
    storyboard.music.on = false;
    storyboard.source = "ai";
    return { storyboard, cents: projectCost(storyboard), maxCents: maxCentsPerVideo() };
  },

  // `startRender` itself refuses a price that changed, a video over the cap and an unconfigured render.
  // The three tools that pay someone count as a step's paid call (`paidCall`): a team agent's model step may make only one.
  startVideo: (run) => async (storyboard, cents, actor = "auto") => {
    paidCall();
    const row = await createProject(run.businessId, storyboard);
    const project = await startRender(run.businessId, row.id, cents, actor);
    return { projectId: row.id, status: project.status };
  },

  // The same function the writer's form calls. Google and the AI are paid: only a step that reserved the cost calls this.
  writeArticle: (run) => async (keyword, language) => {
    paidCall();
    try {
      return await createArticleReport(run.businessId, keyword, language ?? (await articleLanguage(run.businessId)));
    } catch (e) {
      throw agentErrorOf(e);
    }
  },

  // Prepare, then authorize at the price the photo has: an AI photo is created only by the second call, after the owner's click.
  publishArticle: (run) => async (reportId, options = {}) => {
    paidCall();
    try {
      const businessId = run.businessId;
      if (options.approved) {
        await options.beforePublish?.();
        return publishedOf(await approveForSite(businessId, reportId, options.expectedCents));
      }
      const prepared = await prepareForSite(businessId, reportId);
      if (photoNeedsApproval(prepared.photo))
        return {
          published: false,
          photo: prepared.photo.kind,
          photoCents: approveCostCents(prepared.photo, await sitePhotoCents(businessId)),
          title: prepared.es.title,
          urlEs: prepared.urlEs,
          urlEn: prepared.urlEn,
        };
      await options.beforePublish?.();
      return publishedOf(await approveForSite(businessId, reportId, approveCostCents(prepared.photo, 0)));
    } catch (e) {
      throw agentErrorOf(e);
    }
  },
};

/** The tools one agent may use for one run. Asking for any other tool is an error. */
export function toolsFor(
  agent: { key: AgentKey; tools: readonly ToolName[] },
  run: AgentRun,
): Tools {
  return {
    use(name) {
      if (!agent.tools.includes(name))
        throw new AgentError(
          `La herramienta ${name} no está permitida para ${agent.key}.`,
        );
      return IMPLS[name](run);
    },
  };
}
