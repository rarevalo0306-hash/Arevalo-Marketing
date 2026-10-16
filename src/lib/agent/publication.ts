import { businessTz, localDay } from "@/lib/business-tz";
import { db } from "@/lib/db";
import { locked } from "./queue";
import type { Context } from "./schema";
import { newsFresh } from "./freshness";

/** Every scheduler uses this claim for agent posts. Policy changes and cancellation
 * share the business lock, so they cannot race the publishing claim. Once claimed,
 * a provider request already in flight cannot be undone. */
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
    let allowed =
      process.env.MATYA_AGENT_ENABLED === "true" &&
      !!run &&
      !!settings?.enabled &&
      !settings.pausedAt &&
      settings.allowPublish &&
      settings.revision === context?.revision &&
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
    allowed = allowed && budget.deliveries < (settings?.maxPostsPerDay ?? 0);
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
            error:
              "La configuración, la fuente o los permisos cambiaron. La publicación se conservó como borrador.",
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
