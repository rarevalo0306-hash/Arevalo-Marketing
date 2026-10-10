import { describe, expect, it } from "vitest";
import {
  canPublish,
  changesByPage,
  estimateCents,
  estimateForInstructions,
  fixBranchName,
  isOpen,
  newJob,
  outsideOutcome,
  prBody,
  previewState,
  readJob,
  STALE_PREPARING_MS,
  stepsFor,
  vercelUrlIn,
} from "@/lib/webfix-shape";

const source = { kind: "audit" as const, title: "Advertencias", issueIds: ["title-too-long"], urls: ["/es"] };

describe("branch name", () => {
  it("is matya/arreglos-YYYYMMDD-HHMM in the given time zone", () => {
    const at = new Date("2026-10-10T18:05:00Z");
    expect(fixBranchName(at, "UTC")).toBe("matya/arreglos-20261010-1805");
    expect(fixBranchName(at, "America/New_York")).toBe("matya/arreglos-20261010-1405");
  });
});

describe("cost estimate", () => {
  it("is a few cents, grows with the prompt and is never zero", () => {
    expect(estimateCents(0, 0)).toBe(1);
    const small = estimateForInstructions(3_000, 20_000);
    const big = estimateForInstructions(30_000, 240_000);
    expect(small).toBeGreaterThanOrEqual(1);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThan(15);
  });
});

describe("job record", () => {
  it("round-trips through readJob and tolerates junk", () => {
    const j = newJob(source, "o/r", "main", 4, new Date("2026-10-10T00:00:00Z"));
    const back = readJob(JSON.parse(JSON.stringify({ ...j, previewUrl: "javascript:alert(1)", status: "open" })));
    expect(back?.status).toBe("open");
    expect(back?.source).toEqual(source);
    expect(back?.previewUrl).toBe("");
    expect(readJob({ v: 2 })).toBeNull();
    expect(readJob(null)).toBeNull();
  });

  it("counts preparing jobs as open only until they go stale", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const j = newJob(source, "o/r", "main", 4, new Date(now.getTime() - 60_000));
    expect(isOpen(j, now)).toBe(true);
    expect(isOpen({ ...j, updatedAt: new Date(now.getTime() - STALE_PREPARING_MS - 1).toISOString() }, now)).toBe(false);
    expect(isOpen({ ...j, status: "open" }, now)).toBe(true);
    expect(isOpen({ ...j, status: "published" }, now)).toBe(false);
  });
});

describe("preview state", () => {
  const status = (state: "pending" | "success" | "failure", url = "https://site-git-matya-x.vercel.app") => ({ state, statuses: [{ context: "Vercel", state, targetUrl: url, description: "" }] });
  it("maps statuses and check runs to waiting / pending / success / failure", () => {
    expect(previewState(null, null).build).toBe("waiting");
    expect(previewState(status("pending"), []).build).toBe("pending");
    expect(previewState(status("success"), []).build).toBe("success");
    expect(previewState(status("success"), [{ name: "build", status: "completed", conclusion: "failure", detailsUrl: "", summary: "" }]).build).toBe("failure");
    expect(previewState(status("success"), [{ name: "build", status: "in_progress", conclusion: null, detailsUrl: "", summary: "" }]).build).toBe("pending");
    expect(previewState(null, [{ name: "Vercel", status: "completed", conclusion: "success", detailsUrl: "", summary: "" }]).build).toBe("success");
  });
  it("finds the Vercel preview URL in statuses, deployments or the bot comment", () => {
    expect(previewState(status("success"), []).previewUrl).toBe("https://site-git-matya-x.vercel.app/");
    expect(previewState(status("success", "https://vercel.com/team/site/abc"), [], ["https://site-abc.vercel.app"]).previewUrl).toBe("https://site-abc.vercel.app/");
    expect(previewState(null, null, [], [{ user: "vercel[bot]", body: "| Preview | [Visit](https://site-123-team.vercel.app) |" }]).previewUrl).toBe("https://site-123-team.vercel.app/");
    expect(vercelUrlIn("no url here")).toBe("");
  });
});

describe("publish rules", () => {
  const base = { status: "open" as const, build: "success" as const, mergeable: true, prNumber: 3, headSha: "abc" };
  it("only allows publishing an open, mergeable PR whose preview succeeded", () => {
    expect(canPublish(base)).toBe(true);
    expect(canPublish({ ...base, build: "pending" })).toBe(false);
    expect(canPublish({ ...base, build: "failure" })).toBe(false);
    expect(canPublish({ ...base, mergeable: null })).toBe(false);
    expect(canPublish({ ...base, mergeable: false })).toBe(false);
    expect(canPublish({ ...base, status: "published" })).toBe(false);
    expect(canPublish({ ...base, headSha: "" })).toBe(false);
  });
  it("detects PRs merged or closed outside Matya", () => {
    expect(outsideOutcome({ state: "closed", merged: true })).toBe("published");
    expect(outsideOutcome({ state: "closed", merged: false })).toBe("closed");
    expect(outsideOutcome({ state: "open", merged: false })).toBeNull();
  });
});

describe("steps and grouping", () => {
  it("marks the current step in plain words", () => {
    const s = stepsFor({ status: "open", step: "writing", build: "pending" });
    expect(s.map((x) => x.state)).toEqual(["done", "done", "done", "now", "todo"]);
    expect(stepsFor({ status: "open", step: "writing", build: "success" }).at(-1)?.state).toBe("now");
    expect(stepsFor({ status: "failed", step: "asking", build: "waiting" })[1].state).toBe("bad");
    expect(stepsFor({ status: "published", step: "writing", build: "success" }).every((x) => x.state === "done")).toBe(true);
  });
  it("groups changes by page, with site-wide ones last", () => {
    const c = (path: string, pages: string[]) => ({ path, pages, why: [], issueIds: [], diff: "", created: false });
    const g = changesByPage([c("app/sitemap.ts", []), c("lib/a.ts", ["/es"]), c("lib/b.ts", ["/es"])]);
    expect(g.map((x) => [x.page, x.changes.length])).toEqual([["/es", 2], ["", 1]]);
  });
  it("writes a PR body with each change, its reason and the skipped issues, without secrets", () => {
    const body = prBody(
      [{ path: "lib/a.ts", pages: ["/es"], why: [{ es: "Título más corto", en: "Shorter title" }], issueIds: [], diff: "", created: false }],
      [{ issue: "noindex", reason: { es: "La página de privacidad es noindex a propósito.", en: "" } }],
      [],
      { es: "Resumen", en: "Summary" },
    );
    expect(body).toContain("`lib/a.ts` (/es)");
    expect(body).toContain("Título más corto / Shorter title");
    expect(body).toContain("noindex: La página de privacidad");
    expect(body).not.toMatch(/github_pat_|ghp_/);
  });
});
