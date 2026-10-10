import { describe, expect, it } from "vitest";
import {
  applyFixOutcome,
  beginStep,
  buildPlan,
  canAfford,
  checkSelection,
  coversSearch,
  defaultSelection,
  endStep,
  failItem,
  finishPublish,
  hasWorkToPublish,
  improvePrompt,
  jobOpen,
  jobPhase,
  LEASE_MS,
  leaseActive,
  markPublished,
  markPublishFailed,
  MAX_NEW_ARTICLES,
  MAX_SEARCHES,
  newRankFixJob,
  nextWork,
  normUrl,
  planTotals,
  progress,
  readRankFixJob,
  removeItem,
  resumeJob,
  settle,
  stepCents,
  stockPhoto,
  stopForBudget,
  takeLease,
  toPublish,
  usd,
  writeAiCents,
  type PlanContext,
  type PlanRow,
  type Prices,
  type RankFixJob,
  type SearchFacts,
  type WriteStep,
} from "@/lib/rankfix-shape";
import type { PromptContext } from "@/lib/seo/prompt-core";
import { estimateForInstructions } from "@/lib/webfix-shape";

const NOW = new Date("2026-10-10T15:00:00Z");
const prices: Prices = { serpCents: 0.2, writeCents: 4, textCents: 1, imageCents: 4, fileBudget: 240_000 };

const fact = (keyword: string, over: Partial<SearchFacts> = {}): SearchFacts => ({
  keyword,
  position: null,
  mapPosition: null,
  mismatch: false,
  rankingUrl: null,
  rankingIsHome: false,
  rankingLabel: "",
  sitePage: null,
  article: null,
  photoFits: false,
  ...over,
});

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  fixOpen: false,
  fixUrls: [],
  fixHref: "/b/x/seo?tab=web#arreglos",
  fixReady: true,
  writerHref: (id) => `/b/x/seo/escribir?a=${id}`,
  now: NOW,
  ...over,
});

const promptCtx: PromptContext = { name: "Fameseg", website: "https://fameseg.com", area: "Managua", sells: ["cortinas metálicas"], about: "", repo: "", branch: "" };

describe("which searches enter the plan", () => {
  it("uses the same rule as the rank prompt", () => {
    expect(coversSearch("none", false)).toBe(true);
    expect(coversSearch("far", false)).toBe(true);
    expect(coversSearch("close", false)).toBe(true);
    expect(coversSearch("map", false)).toBe(true);
    expect(coversSearch("good", true)).toBe(true);
    expect(coversSearch("good", false)).toBe(false);
    expect(coversSearch("excellent", false)).toBe(false);
  });
});

describe("prices", () => {
  it("estimates the AI writing per provider, unknown counts as the dearest", () => {
    expect(writeAiCents("gemini")).toBe(4);
    expect(writeAiCents("openai")).toBe(3);
    expect(writeAiCents("claude")).toBe(32);
    expect(writeAiCents(null)).toBe(writeAiCents("claude"));
  });
  it("formats rounding up to the cent", () => {
    expect(usd(0)).toBe("US$0.00");
    expect(usd(4)).toBe("US$0.04");
    expect(usd(4.2)).toBe("US$0.05");
    expect(usd(132)).toBe("US$1.32");
    expect(usd(0.2)).toBe("US$0.002");
  });
});

describe("plan rules", () => {
  it("writes a new article when no page covers the search", () => {
    const [r] = buildPlan([fact("portones automáticos nicaragua")], ctx());
    expect(r.action).toBe("write");
    expect(r.why.es).toMatch(/Ninguna página/);
    expect(r.photo).toBe(true);
  });
  it("does not count an AI photo when a library photo fits", () => {
    const [r] = buildPlan([fact("portones automáticos", { photoFits: true })], ctx());
    expect(r.photo).toBe(false);
  });
  it("improves the page Google already shows when it is about the topic", () => {
    const [r] = buildPlan([fact("cortinas metálicas managua", { position: 14, rankingUrl: "https://fameseg.com/cortinas", rankingLabel: "Cortinas metálicas" })], ctx());
    expect(r.action).toBe("improve");
    expect(r.targetUrl).toBe("https://fameseg.com/cortinas");
  });
  it("writes when the ranking page is about something else or is the home page", () => {
    const rows = buildPlan(
      [
        fact("cortinas tubulares", { position: 4, rankingUrl: "https://fameseg.com/blog/epp", mismatch: true, rankingLabel: "EPP" }),
        fact("portones tipo americano", { position: 15, rankingUrl: "https://fameseg.com/", rankingIsHome: true, rankingLabel: "Fameseg" }),
      ],
      ctx(),
    );
    expect(rows.map((r) => r.action)).toEqual(["write", "write"]);
    expect(rows[0].why.es).toMatch(/trata de otra cosa/);
    expect(rows[1].why.es).toMatch(/página de inicio/);
  });
  it("improves a known site page that covers the topic (even if Google shows the home page)", () => {
    const [r] = buildPlan([fact("mantenimiento de cortinas", { rankingUrl: "https://fameseg.com/", rankingIsHome: true, sitePage: { url: "https://fameseg.com/mantenimiento", label: "Mantenimiento" } })], ctx());
    expect(r.action).toBe("improve");
    expect(r.targetUrl).toBe("https://fameseg.com/mantenimiento");
  });
  it("marks articles on their way: unpublished, or published recently", () => {
    const rows = buildPlan(
      [
        fact("a uno", { article: { id: "art1", title: "Uno", publishedUrl: "", publishedAt: "" } }),
        fact("a dos", { article: { id: "art2", title: "Dos", publishedUrl: "https://fameseg.com/blog/dos", publishedAt: "2026-10-01T00:00:00Z" } }),
      ],
      ctx(),
    );
    expect(rows.map((r) => r.action)).toEqual(["onway", "onway"]);
    expect(rows[0].href).toBe("/b/x/seo/escribir?a=art1");
    expect(rows[1].why.es).toMatch(/hace 9 días/);
  });
  it("improves an article published long ago", () => {
    const [r] = buildPlan([fact("a tres", { article: { id: "art3", title: "Tres", publishedUrl: "https://fameseg.com/blog/tres", publishedAt: "2026-06-01T00:00:00Z" } })], ctx());
    expect(r.action).toBe("improve");
    expect(r.targetUrl).toBe("https://fameseg.com/blog/tres");
  });
  it("waits when other fixes are open, unless that fix already covers the page", () => {
    const f = fact("cortinas", { position: 12, rankingUrl: "https://www.fameseg.com/cortinas/", rankingLabel: "Cortinas" });
    expect(buildPlan([f], ctx({ fixOpen: true, fixUrls: ["https://fameseg.com/otra"] }))[0]).toMatchObject({ action: "wait", href: "/b/x/seo?tab=web#arreglos" });
    expect(buildPlan([f], ctx({ fixOpen: true, fixUrls: ["https://fameseg.com/cortinas"] }))[0].action).toBe("onway");
    expect(buildPlan([f], ctx({ fixReady: false }))[0].action).toBe("wait");
  });
  it("never plans two articles for the same topic, nor repeats a search", () => {
    const rows = buildPlan([fact("Portón corredizo"), fact("porton corredizo"), fact("portón corredizo ")], ctx());
    expect(rows.length).toBe(2);
    expect(rows[1].action).toBe("onway");
    const custom = buildPlan([fact("portones corredizos managua"), fact("portón corredizo")], ctx({ sameTopic: () => true }));
    expect(custom[1].action).toBe("onway");
  });
  it("covers at most MAX_SEARCHES searches", () => {
    const rows = buildPlan(Array.from({ length: 20 }, (_, i) => fact(`búsqueda ${i}`)), ctx({ sameTopic: () => false }));
    expect(rows.length).toBe(MAX_SEARCHES);
  });
  it("compares addresses without https, www or the final slash", () => {
    expect(normUrl("https://www.Fameseg.com/a/")).toBe(normUrl("fameseg.com/a"));
  });
});

const sixWrites = buildPlan(
  [...Array.from({ length: 6 }, (_, i) => fact(`tema ${i}`, { photoFits: i % 2 === 0 })), fact("cortinas", { position: 12, rankingUrl: "https://fameseg.com/cortinas", rankingLabel: "Cortinas" })],
  ctx({ sameTopic: () => false }),
);

describe("selection and totals", () => {
  it("ticks every improvement and the first 5 articles", () => {
    const keys = defaultSelection(sixWrites);
    expect(keys.length).toBe(MAX_NEW_ARTICLES + 1);
    expect(keys).toContain("cortinas");
    expect(keys).not.toContain("tema 5");
  });
  it("refuses more than 5 articles, unknown rows and empty selections", () => {
    expect(checkSelection(sixWrites, sixWrites.map((r) => r.key)).ok).toBe(false);
    expect(checkSelection(sixWrites, ["nope"]).ok).toBe(false);
    expect(checkSelection(sixWrites, []).ok).toBe(false);
    const ok = checkSelection(sixWrites, ["tema 0", "tema 0", "cortinas"]);
    expect(ok.ok && ok.keys).toEqual(["tema 0", "cortinas"]);
  });
  it("adds Google, writing, translation, photos only where needed and one fix estimate", () => {
    const keys = defaultSelection(sixWrites);
    const chars = { cortinas: 900 };
    const tot = planTotals(sixWrites, keys, prices, chars);
    expect(tot.articles).toBe(5);
    expect(tot.photos).toBe(2); // tema 1 y tema 3 (sin foto de biblioteca)
    expect(tot.articleCents).toBeCloseTo(5 * 5.2);
    expect(tot.photoCents).toBe(8);
    expect(tot.fixCents).toBe(estimateForInstructions(900, prices.fileBudget));
    expect(tot.totalCents).toBe(Math.ceil(26 + 8 + tot.fixCents));
    expect(tot.perRow["tema 1"]).toBeCloseTo(9.2);
    expect(tot.perRow["tema 0"]).toBeCloseTo(5.2);
    expect(tot.left).toBe(1);
  });
  it("counts no AI photos when there is no image AI", () => {
    const tot = planTotals(sixWrites, defaultSelection(sixWrites), { ...prices, imageCents: 0 }, {});
    expect(tot.photos).toBe(0);
    expect(tot.photoCents).toBe(0);
  });
});

describe("the fix instructions", () => {
  it("lists only the selected pages with their full address", () => {
    const text = improvePrompt(promptCtx, [{ keyword: "cortinas metálicas", position: 14, url: "/cortinas" }], "es");
    expect(text).toContain("Mejorar la página para «cortinas metálicas»");
    expect(text).toContain("https://fameseg.com/cortinas");
    expect(text).toContain("sale en el lugar 14");
    expect(improvePrompt(promptCtx, [], "es")).toBe("");
  });
});

const keysOf = (rows: PlanRow[]) => defaultSelection(rows);
function freshJob(rows = sixWrites): RankFixJob {
  const keys = keysOf(rows);
  const totals = planTotals(rows, keys, prices, { cortinas: 900 });
  return newRankFixJob({ rows, keys, prices, totals, lang: "es", now: NOW });
}

/** Corre todos los pasos como lo haría el servidor (la foto con IA solo donde `needsAi`). */
function runAll(job: RankFixJob, needsAi: (key: string) => boolean): RankFixJob {
  let j = job;
  for (let guard = 0; guard < 100; guard++) {
    const w = nextWork(j);
    if (!w) return settle(j, NOW);
    const item = j.items[w.index];
    const cents = stepCents(w.step, prices, w.step === "photo" && needsAi(item.key));
    if (!canAfford(j, cents)) return stopForBudget(j, w.index, NOW);
    j = beginStep(j, w.index, w.step, cents, NOW);
    j = endStep(j, w.index, w.step, w.step === "write" ? { articleId: `a-${item.key}`, title: item.keyword } : {}, NOW, { reserved: cents, actual: cents });
  }
  return j;
}

describe("job", () => {
  it("starts preparing with the selected rows and the authorized total", () => {
    const job = freshJob();
    expect(job.status).toBe("preparing");
    expect(job.items.map((x) => x.state)).toEqual(["queued", "queued", "queued", "queued", "queued", "fix"]);
    expect(job.authorizedCents).toBe(planTotals(sixWrites, keysOf(sixWrites), prices, { cortinas: 900 }).totalCents);
    expect(jobOpen(job)).toBe(true);
  });
  it("goes write → site → photo for each article in order", () => {
    let j = freshJob();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const w = nextWork(j) as { index: number; step: WriteStep };
      seen.push(`${j.items[w.index].key}:${w.step}`);
      j = endStep(j, w.index, w.step, {}, NOW);
    }
    expect(seen).toEqual(["tema 0:write", "tema 0:site", "tema 0:photo", "tema 1:write", "tema 1:site", "tema 1:photo"]);
    expect(j.items[0].state).toBe("ready");
  });
  it("never spends more than authorized when everything goes as planned", () => {
    let j = freshJob();
    j = { ...j, spentCents: j.spentCents + estimateForInstructions(900, prices.fileBudget) }; // el arreglo de la web
    const done = runAll(j, (k) => k === "tema 1" || k === "tema 3");
    expect(done.status).toBe("ready");
    expect(done.stop).toBeNull();
    expect(done.items.filter((x) => x.state === "ready").length).toBe(5);
    expect(done.spentCents).toBeLessThanOrEqual(done.authorizedCents);
  });
  it("stops before going over (a photo nobody counted) and leaves the rest for next time", () => {
    const done = runAll({ ...freshJob(), authorizedCents: 30 }, () => true);
    expect(done.stop?.es).toMatch(/no pasar de los US\$0\.30/);
    expect(done.spentCents).toBeLessThanOrEqual(30);
    const states = done.items.filter((x) => x.action === "write").map((x) => x.state);
    expect(states).toContain("stopped");
    expect(states.filter((s) => s === "queued")).toEqual([]);
    expect(jobPhase(done)).toBe("stopped");
    expect(nextWork(done)).toBeNull();
  });
  it("corrects the reservation with the real cost", () => {
    let j = freshJob();
    j = beginStep(j, 0, "write", 4.2, NOW);
    expect(j.spentCents).toBeCloseTo(4.2);
    expect(j.items[0].pending).toBe("write");
    j = endStep(j, 0, "write", { articleId: "a" }, NOW, { reserved: 4.2, actual: 4.15 });
    expect(j.spentCents).toBeCloseTo(4.15);
    expect(j.items[0]).toMatchObject({ pending: "", next: "site", articleId: "a" });
  });
  it("resumes a cut step without forgetting what it reserved", () => {
    let j = takeLease(freshJob(), NOW);
    j = beginStep(j, 0, "write", 4.2, NOW);
    expect(resumeJob(j, NOW).interrupted).toEqual([]); // el trabajador sigue vivo
    expect(leaseActive(j, NOW)).toBe(true);
    const later = new Date(NOW.getTime() + LEASE_MS + 1000);
    const r = resumeJob(j, later);
    expect(r.interrupted).toEqual([{ index: 0, step: "write" }]);
    expect(r.job.items[0].pending).toBe("");
    expect(r.job.spentCents).toBeCloseTo(4.2);
    expect(nextWork(r.job)).toEqual({ index: 0, step: "write" });
  });
  it("marks a failed step without refunding it", () => {
    let j = beginStep(freshJob(), 0, "write", 4.2, NOW);
    j = failItem(j, 0, { es: "x", en: "x" }, NOW);
    expect(j.items[0].state).toBe("failed");
    expect(j.spentCents).toBeCloseTo(4.2);
    expect(nextWork(j)?.index).toBe(1);
  });
  it("lets the owner remove an article, also while it is being prepared", () => {
    let j = beginStep(freshJob(), 0, "write", 4.2, NOW);
    j = removeItem(j, "tema 0", NOW);
    j = endStep(j, 0, "write", { articleId: "a" }, NOW);
    expect(j.items[0].state).toBe("removed");
    expect(nextWork(j)?.index).toBe(1);
    expect(removeItem(j, "cortinas", NOW)).toBe(j); // las mejoras no se quitan aquí
  });
  it("uses the website's photo for free after a stop before the AI photo", () => {
    let j = freshJob();
    j = endStep(j, 0, "write", { articleId: "a" }, NOW);
    j = endStep(j, 0, "site", {}, NOW);
    j = stopForBudget(j, 0, NOW);
    expect(j.items[0]).toMatchObject({ state: "stopped", next: "photo" });
    j = stockPhoto(j, "tema 0", NOW);
    expect(j.items[0]).toMatchObject({ state: "ready", next: "done", photoKind: "stock", error: null });
  });
});

describe("publishing", () => {
  const ready = (): RankFixJob => {
    const j = runAll({ ...freshJob(), spentCents: estimateForInstructions(900, prices.fileBudget) }, () => false);
    return { ...j, fix: { ...j.fix, id: "fix1", state: "started" as const } };
  };
  it("publishes only ready articles that have an article", () => {
    const j = ready();
    expect(toPublish(j).map((x) => x.key)).toEqual(["tema 0", "tema 1", "tema 2", "tema 3", "tema 4"]);
    expect(hasWorkToPublish(j)).toBe(true);
    expect(toPublish(removeItem(j, "tema 2", NOW)).length).toBe(4);
  });
  it("is done when everything went out", () => {
    let j = ready();
    for (const x of toPublish(j)) j = markPublished(j, x.key, `https://fameseg.com/blog/${x.key}`, NOW);
    j = applyFixOutcome(j, "published", null, NOW);
    j = finishPublish(j, NOW);
    expect(j.status).toBe("done");
    expect(jobPhase(j)).toBe("done");
    expect(jobOpen(j)).toBe(false);
    expect(progress(j)).toEqual({ ready: 5, total: 5 });
  });
  it("is partly published when the page changes wait for their preview or an article failed", () => {
    let j = ready();
    j = markPublished(j, "tema 0", "https://fameseg.com/blog/0", NOW);
    j = markPublishFailed(j, "tema 1", { es: "No", en: "No" }, NOW);
    j = applyFixOutcome(j, "waiting", { es: "Esperan la vista previa", en: "Waiting" }, NOW);
    j = finishPublish(j, NOW);
    expect(j.status).toBe("ready");
    expect(jobPhase(j)).toBe("partial");
    expect(j.items.find((x) => x.key === "cortinas")?.state).toBe("fix");
    expect(toPublish(j).map((x) => x.key)).toContain("tema 1");
    expect(toPublish(j).map((x) => x.key)).not.toContain("tema 0");
  });
  it("marks the page changes as failed when the fix couldn't be made", () => {
    const j = applyFixOutcome(ready(), "failed", { es: "Nada seguro", en: "Nothing safe" }, NOW);
    expect(j.items.find((x) => x.key === "cortinas")).toMatchObject({ state: "fix_failed" });
  });
});

describe("saved job", () => {
  it("reads back what it saved and drops unsafe links", () => {
    const j = { ...freshJob(), items: freshJob().items.map((x, i) => (i === 0 ? { ...x, url: "javascript:alert(1)", thumb: "https://cdn.x/a.webp" } : x)) };
    const back = readRankFixJob(JSON.parse(JSON.stringify(j)));
    expect(back?.items[0].url).toBe("");
    expect(back?.items[0].thumb).toBe("https://cdn.x/a.webp");
    expect(back?.items.length).toBe(j.items.length);
    expect(back?.authorizedCents).toBe(j.authorizedCents);
  });
  it("rejects junk", () => {
    expect(readRankFixJob(null)).toBeNull();
    expect(readRankFixJob({ v: 2, items: [] })).toBeNull();
    expect(readRankFixJob({ v: 1 })).toBeNull();
  });
});
