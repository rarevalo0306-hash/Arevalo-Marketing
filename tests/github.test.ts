import { describe, expect, it } from "vitest";
import { assertFixBranch, explainGitHub, GitHubError, httpGitHub, normalizeBranch, normalizeRepo, scrubSecrets } from "@/lib/github";

const TOKEN = "github_pat_11AAAAAAA0123456789_abcdefghijklmnopqrstuvwxyz";
const headers = (h: Record<string, string> = {}) => new Headers(h);

/** Un fetch de mentira: nunca se llama a GitHub de verdad en las pruebas. */
function fakeFetch(status: number, body: unknown, h: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 204 ? null : typeof body === "string" ? body : JSON.stringify(body), { status, headers: h });
  };
  return { fn, calls };
}

describe("validation", () => {
  it("normalizes owner/name and rejects junk", () => {
    expect(normalizeRepo("rarevalo0306-hash/RicardoPA-Web")).toBe("rarevalo0306-hash/RicardoPA-Web");
    expect(normalizeRepo(" https://github.com/rarevalo0306-hash/fameseg-web-claude.git ")).toBe("rarevalo0306-hash/fameseg-web-claude");
    for (const bad of ["", "owner", "owner/name/extra", "-x/y", "o/..", "o/.git", "o w/n"]) expect(normalizeRepo(bad), bad).toBe("");
    expect(normalizeBranch("main")).toBe("main");
    for (const bad of ["../x", "-x", "a b", "x/", "a..b"]) expect(normalizeBranch(bad), bad).toBe("");
  });
  it("only accepts Matya's own branches for writing", () => {
    expect(() => assertFixBranch("matya/arreglos-20261010-1805", "main")).not.toThrow();
    expect(() => assertFixBranch("main")).toThrow();
    expect(() => assertFixBranch("matya/arreglos-x", "matya/arreglos-x")).toThrow();
  });
});

describe("errors", () => {
  it("explains 401/403/404/409/422 in plain words", () => {
    expect(explainGitHub(401, "{}", headers()).message).toBe("La llave venció; crea una nueva en GitHub y pégala en Conexiones → Sitio web.");
    const perm = explainGitHub(403, '{"message":"Resource not accessible by personal access token"}', headers(), { need: "pulls" });
    expect(perm.message).toContain("Pull requests: Read and write");
    expect(perm.missing).toBe("pulls");
    expect(explainGitHub(403, "{}", headers({ "x-ratelimit-remaining": "0" })).message).toMatch(/esperar/);
    expect(explainGitHub(404, "{}", headers(), { branch: "main" }).message).toContain("«main»");
    expect(explainGitHub(409, "{}", headers()).message).toMatch(/cambió/);
    expect(explainGitHub(422, '{"message":"Validation Failed","errors":[{"message":"A pull request already exists"}]}', headers()).message).toContain("A pull request already exists");
  });
  it("never puts the key in an error message", () => {
    const e = explainGitHub(422, JSON.stringify({ message: `bad ${TOKEN}` }), headers(), {}, TOKEN);
    expect(e.message).not.toContain(TOKEN);
    expect(scrubSecrets(`token ${TOKEN} and ghp_abcdefghijklmnopqrstuvwxyz0123`)).not.toMatch(/github_pat_1|ghp_a/);
  });
});

describe("httpGitHub", () => {
  it("sends the key only in the Authorization header, with a timeout", async () => {
    const f = fakeFetch(200, { full_name: "o/r", default_branch: "main", private: true, permissions: { push: true } }, { "github-authentication-token-expiration": "2027-10-10 12:00:00 UTC" });
    const gh = httpGitHub({ token: TOKEN, repo: "o/r", fetchImpl: f.fn });
    const r = await gh.getRepo();
    expect(r.tokenExpires).toBe("2027-10-10 12:00:00 UTC");
    expect(f.calls[0].url).toBe("https://api.github.com/repos/o/r");
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(f.calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(f.calls[0].url).not.toContain(TOKEN);
  });
  it("turns a 401 into «La llave venció»", async () => {
    const gh = httpGitHub({ token: TOKEN, repo: "o/r", fetchImpl: fakeFetch(401, { message: "Bad credentials" }).fn });
    await expect(gh.getBranch("main")).rejects.toThrow("La llave venció");
  });
  it("turns a timeout into a plain message", async () => {
    const gh = httpGitHub({
      token: TOKEN,
      repo: "o/r",
      fetchImpl: async () => {
        throw Object.assign(new Error("t"), { name: "TimeoutError" });
      },
    });
    await expect(gh.getRepo()).rejects.toThrow("GitHub tardó demasiado");
  });
  it("squash-merges with the expected sha and refuses non-Matya branches", async () => {
    const f = fakeFetch(200, { merged: true, sha: "new" });
    const gh = httpGitHub({ token: TOKEN, repo: "o/r", fetchImpl: f.fn });
    await gh.mergePull(7, { sha: "abc", title: "t" });
    expect(f.calls[0].init.method).toBe("PUT");
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ merge_method: "squash", sha: "abc", commit_title: "t" });
    await expect(gh.createBranch("main", "abc")).rejects.toBeInstanceOf(GitHubError);
    await expect(gh.deleteBranch("main")).rejects.toBeInstanceOf(GitHubError);
    await expect(gh.createPull({ title: "t", body: "b", head: "main", base: "main" })).rejects.toBeInstanceOf(GitHubError);
    expect(f.calls).toHaveLength(1);
  });
  it("reads blobs as text and treats binaries as null", async () => {
    const text = httpGitHub({ token: TOKEN, repo: "o/r", fetchImpl: fakeFetch(200, { content: Buffer.from("hola ñ").toString("base64"), encoding: "base64" }).fn });
    expect(await text.getBlobText("s")).toBe("hola ñ");
    const bin = httpGitHub({ token: TOKEN, repo: "o/r", fetchImpl: fakeFetch(200, { content: Buffer.from([0x89, 0x50, 0, 1]).toString("base64"), encoding: "base64" }).fn });
    expect(await bin.getBlobText("s")).toBeNull();
  });
});

describe("merge refusals", () => {
  it("explains squash-disabled and protected branches instead of a generic conflict", () => {
    expect(explainGitHub(405, '{"message":"Squash merges are not allowed on this repository."}', headers()).message).toMatch(/squash/);
    expect(explainGitHub(405, '{"message":"At least 1 approving review is required by reviewers with write access."}', headers()).message).toMatch(/protegida/);
    expect(explainGitHub(405, '{"message":"Pull Request is not mergeable"}', headers()).message).toMatch(/cambió/);
  });
});
