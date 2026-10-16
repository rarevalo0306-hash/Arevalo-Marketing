import { businessTz, localDay } from "@/lib/business-tz";
import { db } from "@/lib/db";
import { refusalOf } from "./guard";
import { Piece } from "./plan";
import { locked } from "./queue";
import type { Context } from "./schema";
import { newsFresh } from "./freshness";

const CHANGED =
  "La configuración, la fuente o los permisos cambiaron. La publicación se conservó como borrador.";
const DAY_LIMIT = "Se alcanzó el límite diario de publicaciones de MATYA. La publicación quedó como borrador.";

/** Every scheduler uses this claim for agent posts. Policy changes and cancellation
 * share the business lock, so they cannot race the publishing claim. Once claimed,
 * a provider request already in flight cannot be undone.
 * A campaign's post needs the settings revision it was made with. A team piece's post (its run is `kind: "piece"`) may wait
 * for its posting window for hours, so an unrelated save must not stop it (R46): instead the switches and permissions are
 * checked as they are now with the guard's own rules (`refusalOf`: paused, team mode, MATYA, publishing, social posts, and
 * each channel still allowed and connected), and a refusal is told with the guard's reason. The day's cap of deliveries holds
 * for both. */
export async function claimAgentPost(
  postId: string,
): Promise<{ count: number }> {
  const p = await db.post.findUnique({
    where: { id: postId },
    select: { businessId: true },
  });
  if (!p) return { count: 0 };
  return locked(p.businessId, async (tx) => {
    const post = await tx.post.findUniqueOrThrow({
      where: { id: postId },
      include: { campaign: true, targets: true },
    });
    if (post.status !== "scheduled" || !post.campaign?.agentRunId)
      return { count: 0 };
    const run = await tx.agentRun.findFirst({
      where: { id: post.campaign.agentRunId, businessId: post.businessId },
    });
    const settings = await tx.agentWorkspace.findUnique({
      where: { businessId: post.businessId },
    });
    const context = run?.context as unknown as Context | undefined;
    const connections = await tx.connection.findMany({
      where: { businessId: post.businessId },
      select: { channel: true },
    });
    const piece = run?.kind === "piece";
    // A piece's post: the switches and permissions as they are now (the approval is checked below, as for a campaign).
    const refusal =
      piece && settings
        ? refusalOf({
            ws: settings,
            format: Piece.safeParse((context as { piece?: unknown } | undefined)?.piece).data?.format ?? null,
            approved: true,
            channels: post.targets.map((t) => t.channel),
            connected: connections.map((c) => c.channel),
            braked: [],
            posts: 0,
          })
        : null;
    let allowed =
      process.env.MATYA_AGENT_ENABLED === "true" &&
      !!run &&
      !!settings?.enabled &&
      !settings.pausedAt &&
      settings.allowPublish &&
      (piece ? refusal === null : settings.revision === context?.revision) &&
      !run.cancelRequested &&
      ["queued", "running", "waiting_provider"].includes(run.status) &&
      (settings.mode === "auto" || !!run.approvedAt) &&
      post.campaign.status === "active";
    allowed =
      allowed &&
      post.targets.length > 0 &&
      post.targets.every(
        (t) =>
          settings!.channels.includes(t.channel) &&
          connections.some((c) => c.channel === t.channel),
      );
    if (context?.news) {
      const news = await tx.agentNews.findFirst({
        where: { id: context.news.id, businessId: post.businessId },
      });
      allowed =
        allowed &&
        !!news &&
        newsFresh(news) &&
        news.revision === context.news.revision;
    }
    const business = await tx.business.findUniqueOrThrow({
      where: { id: post.businessId },
      select: { timezone: true },
    });
    const day = localDay(new Date(), businessTz(business));
    const budget = await tx.agentBudget.upsert({
      where: { businessId_day: { businessId: post.businessId, day } },
      create: { businessId: post.businessId, day },
      update: {},
    });
    // Whether everything but the day's cap allowed it: only then is the cap the reason a piece is told.
    const allowedBeforeCap = allowed;
    const capped = budget.deliveries >= (settings?.maxPostsPerDay ?? 0);
    allowed = allowed && !capped;
    if (!allowed) {
      await tx.post.update({
        where: { id: post.id },
        data: { status: "draft" },
      });
      if (run && !["cancelled", "completed"].includes(run.status))
        await tx.agentRun.update({
          where: { id: run.id },
          data: {
            status: "blocked",
            // A piece is told why: the guard's words, the day's cap when that is the only reason, else the change; a campaign
            // keeps its message.
            error: piece ? (refusal ?? (allowedBeforeCap && capped ? DAY_LIMIT : CHANGED)) : CHANGED,
          },
        });
      return { count: 0 };
    }
    await tx.agentBudget.update({
      where: { id: budget.id },
      data: { deliveries: { increment: 1 } },
    });
    return tx.post.updateMany({
      where: { id: postId, status: "scheduled" },
      data: { status: "publishing" },
    });
  });
}
