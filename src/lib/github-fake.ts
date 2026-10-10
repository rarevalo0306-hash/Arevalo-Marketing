// GitHub de mentira, en memoria, para las pruebas de «Arréglalo por mí» (nunca se usa en producción ni se llama a
// GitHub de verdad). Imita lo que importa: ramas, árboles, blobs, commits, pull requests, estados y checks, el merge
// con sha esperado (409 si cambió) y los errores de permiso (403) o de rama inexistente (404).
import { createHash } from "crypto";
import {
  assertFixBranch,
  type BranchInfo,
  type CheckRun,
  type CombinedStatus,
  type GitHubClient,
  GitHubError,
  type IssueComment,
  type PullInfo,
  type RepoInfo,
  type TreeInfo,
} from "@/lib/github";

type Commit = { sha: string; tree: string; parent: string | null; message: string };

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

export class FakeGitHub implements GitHubClient {
  readonly repo: string;
  /** Árboles: sha → { ruta: contenido }. */
  trees = new Map<string, Record<string, string>>();
  blobs = new Map<string, string>();
  commits = new Map<string, Commit>();
  branches = new Map<string, string>();
  pulls = new Map<number, PullInfo & { title: string; body: string }>();
  statuses = new Map<string, CombinedStatus>();
  checks = new Map<string, CheckRun[]>();
  deployments = new Map<string, string[]>();
  comments = new Map<number, IssueComment[]>();
  /** Cada llamada que escribe (para comprobar que nunca se toca la rama principal). */
  writes: string[] = [];
  /** Permisos que «le faltan» a la llave: las llamadas que los piden responden 403. */
  missing = new Set<"pulls" | "contents" | "statuses" | "checks">();
  defaultBranch: string;
  private nextPull = 1;

  constructor(repo: string, files: Record<string, string>, branch = "main") {
    this.repo = repo;
    this.defaultBranch = branch;
    const tree = this.saveTree(files);
    const commit = this.saveCommit(tree, null, "init");
    this.branches.set(branch, commit);
  }

  private saveTree(files: Record<string, string>): string {
    const sha = sha1(`tree:${JSON.stringify(Object.entries(files).sort())}`);
    this.trees.set(sha, { ...files });
    for (const content of Object.values(files)) this.blobs.set(sha1(`blob:${content}`), content);
    return sha;
  }
  private saveCommit(tree: string, parent: string | null, message: string): string {
    const sha = sha1(`commit:${tree}:${parent}:${message}:${this.commits.size}`);
    this.commits.set(sha, { sha, tree, parent, message });
    return sha;
  }
  private need(p: "pulls" | "contents" | "statuses" | "checks") {
    if (this.missing.has(p)) throw new GitHubError(403, `Falta el permiso ${p}.`, `Missing the ${p} permission.`, p);
  }

  /** Los archivos de una rama (para las pruebas). */
  filesAt(branch: string): Record<string, string> {
    const c = this.commits.get(this.branches.get(branch) ?? "");
    return c ? { ...this.trees.get(c.tree)! } : {};
  }
  /** Simula otro commit en una rama (alguien cambió la web). */
  pushTo(branch: string, files: Record<string, string>) {
    const tree = this.saveTree({ ...this.filesAt(branch), ...files });
    this.branches.set(branch, this.saveCommit(tree, this.branches.get(branch) ?? null, "outside change"));
    for (const p of this.pulls.values()) if (p.headRef === branch && p.state === "open") p.headSha = this.branches.get(branch)!;
  }

  async getRepo(): Promise<RepoInfo> {
    return { fullName: this.repo, defaultBranch: this.defaultBranch, private: true, permissions: { push: !this.missing.has("contents"), pull: true } };
  }
  async getBranch(branch: string): Promise<BranchInfo> {
    const sha = this.branches.get(branch);
    if (!sha) throw new GitHubError(404, `No está la rama ${branch}.`, `No ${branch} branch.`);
    return { name: branch, commitSha: sha, treeSha: this.commits.get(sha)!.tree };
  }
  async getTree(treeSha: string): Promise<TreeInfo> {
    const files = this.trees.get(treeSha);
    if (!files) throw new GitHubError(404, "No está el árbol.", "No tree.");
    const dirs = new Set<string>();
    for (const p of Object.keys(files)) p.split("/").slice(0, -1).forEach((_, i, a) => dirs.add(a.slice(0, i + 1).join("/")));
    return {
      truncated: false,
      entries: [
        ...[...dirs].map((d) => ({ path: d, type: "tree" as const, sha: sha1(`dir:${d}`) })),
        ...Object.entries(files).map(([path, content]) => ({ path, type: "blob" as const, sha: sha1(`blob:${content}`), size: Buffer.byteLength(content) })),
      ],
    };
  }
  async getBlobText(sha: string): Promise<string | null> {
    const c = this.blobs.get(sha);
    if (c === undefined) throw new GitHubError(404, "No está el archivo.", "No blob.");
    return c.includes("\u0000") ? null : c;
  }
  async createBlob(content: string): Promise<string> {
    this.need("contents");
    this.writes.push("blob");
    const sha = sha1(`blob:${content}`);
    this.blobs.set(sha, content);
    return sha;
  }
  async createTree(baseTree: string, files: { path: string; sha: string }[]): Promise<string> {
    this.need("contents");
    this.writes.push("tree");
    const next = { ...(this.trees.get(baseTree) ?? {}) };
    for (const f of files) next[f.path] = this.blobs.get(f.sha)!;
    return this.saveTree(next);
  }
  async createCommit(message: string, tree: string, parent: string): Promise<string> {
    this.need("contents");
    this.writes.push("commit");
    return this.saveCommit(tree, parent, message);
  }
  async createBranch(name: string, sha: string): Promise<void> {
    assertFixBranch(name);
    this.need("contents");
    if (this.branches.has(name)) throw new GitHubError(422, "Reference already exists", "Reference already exists");
    this.writes.push(`branch:${name}`);
    this.branches.set(name, sha);
  }
  async deleteBranch(name: string): Promise<void> {
    assertFixBranch(name);
    this.need("contents");
    if (!this.branches.has(name)) throw new GitHubError(422, "Reference does not exist", "Reference does not exist");
    this.writes.push(`delete:${name}`);
    this.branches.delete(name);
  }
  async createPull(input: { title: string; body: string; head: string; base: string }): Promise<PullInfo> {
    assertFixBranch(input.head, input.base);
    this.need("pulls");
    this.writes.push(`pull:${input.head}->${input.base}`);
    const n = this.nextPull++;
    const p = {
      number: n,
      url: `https://github.com/${this.repo}/pull/${n}`,
      state: "open" as const,
      merged: false,
      mergeable: true,
      mergeableState: "clean",
      headSha: this.branches.get(input.head)!,
      headRef: input.head,
      baseRef: input.base,
      title: input.title,
      body: input.body,
    };
    this.pulls.set(n, p);
    return { ...p };
  }
  async getPull(n: number): Promise<PullInfo> {
    this.need("pulls");
    const p = this.pulls.get(n);
    if (!p) throw new GitHubError(404, "No está el PR.", "No PR.");
    return { ...p };
  }
  async listOpenPulls(): Promise<number> {
    this.need("pulls");
    return [...this.pulls.values()].filter((p) => p.state === "open").length;
  }
  async closePull(n: number): Promise<void> {
    this.need("pulls");
    const p = this.pulls.get(n);
    if (!p) throw new GitHubError(404, "No está el PR.", "No PR.");
    this.writes.push(`close:${n}`);
    p.state = "closed";
  }
  async mergePull(n: number, input: { sha: string; title: string }): Promise<{ merged: boolean; sha: string }> {
    this.need("pulls");
    const p = this.pulls.get(n);
    if (!p) throw new GitHubError(404, "No está el PR.", "No PR.");
    if (p.state !== "open") throw new GitHubError(405, "Pull Request is not mergeable", "Pull Request is not mergeable");
    if (p.headSha !== input.sha) throw new GitHubError(409, "Head branch was modified", "Head branch was modified");
    if (p.mergeable === false) throw new GitHubError(405, "Pull Request is not mergeable", "Pull Request is not mergeable");
    // Squash: un commit nuevo en la base con el árbol de la rama.
    const head = this.commits.get(p.headSha)!;
    const merged = this.saveCommit(head.tree, this.branches.get(p.baseRef)!, input.title);
    this.branches.set(p.baseRef, merged);
    this.writes.push(`merge:${n}->${p.baseRef}`);
    p.state = "closed";
    p.merged = true;
    return { merged: true, sha: merged };
  }
  async combinedStatus(sha: string): Promise<CombinedStatus> {
    this.need("statuses");
    return this.statuses.get(sha) ?? { state: "pending", statuses: [] };
  }
  async checkRuns(sha: string): Promise<CheckRun[]> {
    this.need("checks");
    return this.checks.get(sha) ?? [];
  }
  async deploymentUrls(sha: string): Promise<string[]> {
    return this.deployments.get(sha) ?? [];
  }
  async prComments(n: number): Promise<IssueComment[]> {
    this.need("pulls");
    return this.comments.get(n) ?? [];
  }
}
