import { describe, expect, it } from "vitest";
import { FakeGitHub } from "@/lib/github-fake";
import { type AskFn, checkAccess, discardFix, prepareFix, publishFix, refreshFix, targetsFor } from "@/lib/webfix-pipeline";
import { type AiEdits, type FixJob, newJob } from "@/lib/webfix-shape";
import { SITE_FILES } from "./fixtures/webfix-site";

const NOW = new Date("2026-10-10T18:05:00Z");
const source = { kind: "audit" as const, title: "Advertencias", issueIds: ["title-too-long"], urls: ["https://ricardopa.com/es/servicios/danos-por-agua"] };
const instructions = "Fix the long title on https://ricardopa.com/es/servicios/danos-por-agua";
const input = { source, instructions, base: "main", website: "https://ricardopa.com", now: NOW, timeZone: "UTC" };

const answer = (edits: AiEdits["edits"], skipped: AiEdits["skipped"] = []): AskFn => async () => ({ edits, skipped, summary: { es: "Acorté un título.", en: "Shortened a title." } });
const goodEdit = {
  path: "lib/preview-services.ts",
  find: 'seoTitle: "Reclamos por daños por agua en Miami"',
  replace: 'seoTitle: "Daños por agua en Miami"',
  why: { es: "El título era muy largo.", en: "The title was too long." },
  issueIds: ["title-too-long"],
};
const fresh = () => new FakeGitHub("rarevalo0306-hash/site", SITE_FILES);

async function openJob(gh: FakeGitHub) {
  const r = await prepareFix(gh, answer([goodEdit]), input);
  const job: FixJob = { ...newJob(source, gh.repo, "main", 3, NOW), ...r } as FixJob;
  return { r, job };
}

describe("targetsFor", () => {
  it("joins the button's URLs with the ones in the instructions, and flags site-wide issues", () => {
    const t = targetsFor({ ...source, issueIds: ["no-sitemap"], urls: ["/es"] }, "see https://ricardopa.com/services", "ricardopa.com");
    expect(t.targets.map((x) => x.url)).toEqual(["/es", "/services"]);
    expect(t.siteWide).toBe(true);
    expect(targetsFor({ ...source, urls: [] }, "no urls", "ricardopa.com").siteWide).toBe(true);
  });
});

describe("prepareFix", () => {
  it("writes only to a new matya/ branch and opens a PR against main", async () => {
    const gh = fresh();
    const mainBefore = gh.branches.get("main");
    const steps: string[] = [];
    const r = await prepareFix(gh, answer([goodEdit], [{ issue: "noindex", reason: { es: "Privacidad es noindex a propósito.", en: "Privacy is noindex on purpose." } }]), input, async (p) => {
      if (p.step) steps.push(p.step);
    });
    expect(r.status).toBe("open");
    expect(r.branch).toBe("matya/arreglos-20261010-1805");
    expect(steps).toEqual(["asking", "writing"]);
    expect(gh.branches.get("main")).toBe(mainBefore);
    expect(gh.filesAt("main")["lib/preview-services.ts"]).toContain("Reclamos por daños por agua en Miami");
    expect(gh.filesAt(r.branch!)["lib/preview-services.ts"]).toContain('seoTitle: "Daños por agua en Miami"');
    expect(gh.writes.some((w) => w === "branch:main" || w.startsWith("merge"))).toBe(false);
    const pr = gh.pulls.get(r.prNumber!)!;
    expect(pr.baseRef).toBe("main");
    expect(pr.headRef).toBe(r.branch);
    expect(pr.body).toContain("El título era muy largo.");
    expect(pr.body).toContain("Privacidad es noindex a propósito.");
    expect(r.changes?.[0].pages).toEqual(["/es/servicios/danos-por-agua"]);
    expect(r.costCents).toBeGreaterThanOrEqual(1);
  });

  it("writes nothing when every edit is invalid, and says so", async () => {
    const gh = fresh();
    const r = await prepareFix(gh, answer([{ ...goodEdit, path: "package.json" }, { ...goodEdit, find: "not in file" }]), input);
    expect(r.status).toBe("nothing");
    expect(r.dropped).toHaveLength(2);
    expect(r.summary?.en).toMatch(/none passed the safety check/);
    expect(gh.writes).toEqual([]);
  });

  it("stops before asking the AI when the key can't read pull requests", async () => {
    const gh = fresh();
    gh.missing.add("pulls");
    let asked = false;
    const r = await prepareFix(gh, async () => ((asked = true), { edits: [], skipped: [], summary: { es: "", en: "" } }), input);
    expect(asked).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.missing).toBe("pulls");
    expect(r.costCents).toBe(0);
  });

  it("uses another branch name if it already exists", async () => {
    const gh = fresh();
    gh.branches.set("matya/arreglos-20261010-1805", gh.branches.get("main")!);
    const r = await prepareFix(gh, answer([goodEdit]), input);
    expect(r.branch).toBe("matya/arreglos-20261010-1805-2");
  });

  it("fails cleanly (no AI cost lost, no PR) when the branch doesn't exist", async () => {
    const r = await prepareFix(fresh(), answer([goodEdit]), { ...input, base: "nope" });
    expect(r.status).toBe("failed");
    expect(r.error?.es).toBeTruthy();
  });
});

describe("refresh / publish / discard", () => {
  it("publishes only after the preview succeeded, with the reviewed sha (squash)", async () => {
    const gh = fresh();
    const { job } = await openJob(gh);
    expect((await publishFix(gh, job)).ok).toBe(false); // sin vista previa todavía
    gh.statuses.set(job.headSha, { state: "success", statuses: [{ context: "Vercel", state: "success", targetUrl: "https://site-git-x.vercel.app", description: "" }] });
    const ref = await refreshFix(gh, job, NOW);
    expect(ref.build).toBe("success");
    expect(ref.previewUrl).toBe("https://site-git-x.vercel.app/");
    const r = await publishFix(gh, { ...job, ...ref });
    expect(r.ok).toBe(true);
    expect(gh.filesAt("main")["lib/preview-services.ts"]).toContain('seoTitle: "Daños por agua en Miami"');
    expect(gh.branches.has(job.branch)).toBe(false);
  });

  it("refuses to publish if the branch changed after the review", async () => {
    const gh = fresh();
    const { job } = await openJob(gh);
    gh.statuses.set(job.headSha, { state: "success", statuses: [{ context: "Vercel", state: "success", targetUrl: "", description: "" }] });
    gh.pushTo(job.branch, { "content/articles.json": "[1]\n" });
    const r = await publishFix(gh, job);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.es).toBe("La web cambió o la vista previa falló; vuelve a preparar los arreglos.");
    expect(gh.writes.some((w) => w.startsWith("merge"))).toBe(false);
  });

  it("refuses to publish a failed preview or a PR with conflicts", async () => {
    const gh = fresh();
    const { job } = await openJob(gh);
    gh.statuses.set(job.headSha, { state: "failure", statuses: [{ context: "Vercel", state: "failure", targetUrl: "", description: "" }] });
    expect((await publishFix(gh, job)).ok).toBe(false);
    gh.statuses.set(job.headSha, { state: "success", statuses: [{ context: "Vercel", state: "success", targetUrl: "", description: "" }] });
    gh.pulls.get(job.prNumber)!.mergeable = false;
    expect((await publishFix(gh, job)).ok).toBe(false);
    expect(gh.writes.some((w) => w.startsWith("merge"))).toBe(false);
  });

  it("discards: closes the PR and deletes the branch", async () => {
    const gh = fresh();
    const { job } = await openJob(gh);
    expect((await discardFix(gh, job)).ok).toBe(true);
    expect(gh.pulls.get(job.prNumber)!.state).toBe("closed");
    expect(gh.branches.has(job.branch)).toBe(false);
    expect(gh.filesAt("main")["lib/preview-services.ts"]).toContain("Reclamos por daños por agua en Miami");
  });

  it("detects a PR merged or closed outside Matya", async () => {
    const gh = fresh();
    const { job } = await openJob(gh);
    gh.pulls.get(job.prNumber)!.state = "closed";
    expect((await refreshFix(gh, job, NOW)).status).toBe("closed");
    gh.pulls.get(job.prNumber)!.merged = true;
    expect((await refreshFix(gh, job, NOW)).status).toBe("published");
    const p = await publishFix(gh, job);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.outcome).toBe("published");
  });
});

describe("checkAccess", () => {
  it("is read-only and reports missing permissions in plain words", async () => {
    const gh = fresh();
    gh.missing.add("pulls");
    gh.missing.add("checks");
    const r = await checkAccess(gh, "main");
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["pulls", "checks"]);
    expect(r.lines.some((l) => !l.ok && l.text.es.includes("Pull requests: Read and write"))).toBe(true);
    expect(gh.writes).toEqual([]);
  });
  it("says when the branch is missing", async () => {
    const r = await checkAccess(fresh(), "produccion");
    expect(r.ok).toBe(false);
    expect(r.lines.at(-1)?.ok).toBe(false);
  });
});
