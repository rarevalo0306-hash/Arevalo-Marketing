import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { acceptProposal, loadPostStats, loadRulesInput } from "@/lib/proposals";
import { detectProposals, statsFromPosts } from "@/lib/proposals-rules";
import { canAutoApply } from "@/lib/proposals-shape";
import { json } from "./queue";

/** Reuse the existing reversible optimizer. Each campaign gets its own data;
 * aggregate performance from another campaign is never evidence for this one. */
export async function optimizeEligible(
  businessId: string,
  eligible: string[],
  revision: number,
) {
  if (!eligible.length) return [];
  const now = new Date();
  const { input } = await loadRulesInput(businessId, now);
  const posts = await loadPostStats(businessId, input.from, input.to);
  const changes: {
    id: string;
    campaignId: string;
    title: string;
    applied: boolean;
  }[] = [];
  for (const campaign of input.campaigns.filter((c) =>
    eligible.includes(c.id),
  )) {
    const rules = {
      ...input,
      campaigns: [campaign],
      stats: statsFromPosts(
        posts.filter((p) => p.campaignId === campaign.id),
        input.tz,
      ),
    };
    const drafts = detectProposals(rules).filter(
      (d) =>
        d.campaignId === campaign.id &&
        ["timing", "format"].includes(d.kind) &&
        d.action?.type === "campaign.update",
    );
    for (const draft of drafts) {
      const key = createHash("sha256")
        .update(
          `${businessId}:${draft.evidence.key}:${Math.floor(now.getTime() / (7 * 86400000))}`,
        )
        .digest("hex")
        .slice(0, 32);
      const row = await db.aiProposal.upsert({
        where: { id: `agent-opt-${key}` },
        create: {
          id: `agent-opt-${key}`,
          businessId,
          campaignId: campaign.id,
          kind: draft.kind,
          title: json(draft.title),
          detail: json(draft.detail),
          impact: draft.impact,
          action: draft.action ? json(draft.action) : Prisma.JsonNull,
          evidence: json(draft.evidence),
        },
        update: {},
      });
      const policy = await db.agentWorkspace.findUniqueOrThrow({
        where: { businessId },
      });
      let applied = row.status === "applied";
      if (
        row.status === "proposed" &&
        policy.enabled &&
        policy.mode === "auto" &&
        policy.revision === revision &&
        canAutoApply(draft.kind, draft.action, campaign)
      ) {
        applied = (
          await acceptProposal(row.id, { businessId, actor: "auto", now })
        ).ok;
      }
      changes.push({
        id: row.id,
        campaignId: campaign.id,
        title: draft.title.es,
        applied,
      });
    }
  }
  return changes;
}
