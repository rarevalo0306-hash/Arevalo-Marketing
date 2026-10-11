import { describe, expect, it } from "vitest";
import { approvalTotal, buildApprovals, type ApprovalFacts } from "@/lib/approvals-shape";
import { readRankFixJob } from "@/lib/rankfix-shape";

const B = "biz1";
const empty: ApprovalFacts = { rankfix: null, webfix: null, proposals: { count: 0, title: null }, articles: [], campaign: { count: 0, campaignIds: [], name: "" } };

const job = (status: string, items: object[], fix: object = {}) =>
  readRankFixJob({ v: 1, status, items, fix: { id: "fix1", state: "started", outcome: "", ...fix }, createdAt: "", updatedAt: "", publishedAt: "", lease: "" })!;

describe("buildApprovals", () => {
  it("is empty when nothing waits", () => {
    expect(buildApprovals(B, empty)).toEqual([]);
    expect(approvalTotal([])).toBe(0);
  });

  it("summarises a ready rankfix job and skips its own articles and fix", () => {
    const j = job("ready", [
      { key: "a", action: "write", state: "ready", articleId: "art1" },
      { key: "b", action: "write", state: "ready", articleId: "art2" },
      { key: "c", action: "improve", state: "fix" },
    ]);
    const items = buildApprovals(B, {
      ...empty,
      rankfix: { id: "r1", job: j },
      webfix: { id: "fix1", status: "open", changes: 3 },
      articles: [
        { id: "art1", title: "Uno" },
        { id: "art3", title: "Tres" },
      ],
    });
    expect(items.map((x) => x.key)).toEqual(["rankfix", "articles"]);
    expect(items[0].summary.es).toBe("2 artículos y 1 página mejorada");
    expect(items[0].href).toBe("/b/biz1/seo?tab=google#posiciones");
    expect(items[1].count).toBe(1);
    expect(items[1].summary.es).toContain("«Tres»");
    expect(items[1].href).toBe("/b/biz1/seo/escribir?a=art3");
    expect(approvalTotal(items)).toBe(2);
  });

  it("ignores jobs still preparing and fixes that are not open", () => {
    const j = job("preparing", [{ key: "a", action: "write", state: "ready", articleId: "art1" }]);
    expect(buildApprovals(B, { ...empty, rankfix: { id: "r1", job: j }, webfix: { id: "w", status: "published", changes: 2 } })).toEqual([]);
  });

  it("counts proposals and campaign drafts", () => {
    const items = buildApprovals(B, {
      ...empty,
      webfix: { id: "w", status: "open", changes: 1 },
      proposals: { count: 1, title: { es: "Publicar a las 7 p. m.", en: "Post at 7 pm" } },
      campaign: { count: 3, campaignIds: ["c1"], name: "Verano" },
    });
    expect(items.map((x) => x.key)).toEqual(["webfix", "proposals", "campaign"]);
    expect(items[0].summary.en).toBe("1 change ready to review");
    expect(items[1].summary.es).toBe("Publicar a las 7 p. m.");
    expect(items[2].summary.es).toBe("3 publicaciones de «Verano»");
    expect(items[2].href).toBe("/b/biz1/campanas/c1");
    expect(approvalTotal(items)).toBe(5);
  });

  it("links to the campaigns list when drafts span several campaigns", () => {
    const [c] = buildApprovals(B, { ...empty, campaign: { count: 2, campaignIds: ["c1", "c2"], name: "Verano" } });
    expect(c.href).toBe("/b/biz1/campanas");
    expect(c.summary.en).toBe("2 posts to approve");
  });
});
