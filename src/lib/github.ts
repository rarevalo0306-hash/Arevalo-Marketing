// Cliente pequeño de GitHub para «Arréglalo por mí» (src/lib/webfix*.ts): leer el código de la página web, crear una
// rama aparte con los arreglos, abrir el pull request, leer la vista previa de Vercel y publicarlo (squash) solo cuando
// el dueño lo aprueba. Todo pasa por la interfaz GitHubClient: en producción httpGitHub (API REST con la llave del
// dueño); en las pruebas FakeGitHub (src/lib/github-fake.ts). Nunca escribe en la rama principal: solo crea ramas
// «matya/…» y el merge lo hace GitHub con el sha esperado.
//
// La llave nunca sale de aquí: no se registra, no va en los errores (scrubSecrets) y nunca se manda al navegador.
import { BiError } from "@/lib/i18n";

// ---------- Tipos ----------

export type RepoInfo = {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  /** Lo que GitHub dice que puede hacer la llave en el repositorio (si lo dice). */
  permissions?: { push?: boolean; pull?: boolean; admin?: boolean };
  /** Cuándo vence la llave (cabecera github-authentication-token-expiration), si GitHub lo dice. */
  tokenExpires?: string;
};

export type BranchInfo = { name: string; commitSha: string; treeSha: string };
export type TreeEntry = { path: string; type: "blob" | "tree" | "commit"; sha: string; size?: number; mode?: string };
export type TreeInfo = { entries: TreeEntry[]; truncated: boolean };

export type PullInfo = {
  number: number;
  url: string;
  state: "open" | "closed";
  merged: boolean;
  /** null mientras GitHub lo calcula. */
  mergeable: boolean | null;
  mergeableState: string;
  headSha: string;
  headRef: string;
  baseRef: string;
};

export type CommitStatus = { context: string; state: "pending" | "success" | "failure" | "error"; targetUrl: string; description: string };
export type CombinedStatus = { state: "pending" | "success" | "failure" | "error"; statuses: CommitStatus[] };
export type CheckRun = {
  name: string;
  status: "queued" | "in_progress" | "completed" | string;
  conclusion: string | null;
  detailsUrl: string;
  /** Algunas apps (Vercel) ponen la dirección de la vista previa en output.summary o en external_id. */
  summary: string;
};
export type IssueComment = { user: string; body: string };

export interface GitHubClient {
  readonly repo: string;
  getRepo(): Promise<RepoInfo>;
  getBranch(branch: string): Promise<BranchInfo>;
  getTree(treeSha: string): Promise<TreeInfo>;
  /** El texto de un archivo; null si es binario. */
  getBlobText(sha: string): Promise<string | null>;
  createBlob(content: string): Promise<string>;
  createTree(baseTree: string, files: { path: string; sha: string }[]): Promise<string>;
  createCommit(message: string, tree: string, parent: string): Promise<string>;
  /** Crea refs/heads/<name> en `sha`. Solo ramas «matya/…» (assertFixBranch). */
  createBranch(name: string, sha: string): Promise<void>;
  deleteBranch(name: string): Promise<void>;
  createPull(input: { title: string; body: string; head: string; base: string }): Promise<PullInfo>;
  getPull(n: number): Promise<PullInfo>;
  /** Una página de pull requests abiertos (solo para probar el permiso de lectura). */
  listOpenPulls(): Promise<number>;
  closePull(n: number): Promise<void>;
  /** Squash con el sha esperado: si la rama cambió, GitHub lo rechaza (409). */
  mergePull(n: number, input: { sha: string; title: string }): Promise<{ merged: boolean; sha: string }>;
  combinedStatus(sha: string): Promise<CombinedStatus>;
  checkRuns(sha: string): Promise<CheckRun[]>;
  /** Las direcciones de los despliegues de ese commit (necesita «Deployments: Read»; si no, lista vacía). */
  deploymentUrls(sha: string): Promise<string[]>;
  prComments(n: number): Promise<IssueComment[]>;
}

// ---------- Validación ----------

/** «owner/name»: letras, números y guiones en el dueño; además . y _ en el nombre. */
export const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/** Acepta «owner/name», «https://github.com/owner/name(.git)» o con espacios; "" si no es válido. */
export function normalizeRepo(input: string): string {
  const s = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  return REPO_RE.test(s) && !s.endsWith("/.") && !s.split("/")[1].startsWith(".") ? s : "";
}

/** Nombre de rama seguro (sin «..», sin espacios, sin empezar con / o -). "" si no es válido. */
export function normalizeBranch(input: string): string {
  const s = input.trim();
  if (!s) return "";
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(s) || s.includes("..") || s.startsWith("/") || s.startsWith("-") || s.endsWith("/") || s.endsWith(".lock")) return "";
  return s;
}

/** Las únicas ramas que Matya crea, cierra o borra. */
export const FIX_BRANCH_PREFIX = "matya/arreglos-";
export function assertFixBranch(name: string, base?: string): void {
  if (!name.startsWith(FIX_BRANCH_PREFIX) || !normalizeBranch(name) || (base && name === base))
    throw new GitHubError(0, "Matya solo trabaja en sus propias ramas «matya/arreglos-…».", "Matya only works on its own “matya/arreglos-…” branches.");
}

// ---------- Errores ----------

/** Quita llaves y cosas que parecen llaves de un texto (para errores y registros). */
export function scrubSecrets(text: string, token?: string): string {
  let s = text;
  if (token && token.length >= 8) s = s.split(token).join("[llave]");
  return s
    .replace(/github_pat_[A-Za-z0-9_]{10,}/g, "[llave]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[llave]")
    .replace(/(authorization|bearer|token)(["'\s:=]+)[A-Za-z0-9_.-]{16,}/gi, "$1$2[llave]");
}

/** Error de GitHub en palabras sencillas (los dos idiomas) con el código HTTP. */
export class GitHubError extends BiError {
  constructor(
    readonly status: number,
    es: string,
    en: string,
    /** Qué faltó (para dar los pasos exactos): "pulls" = permiso de pull requests. */
    readonly missing?: "pulls" | "contents" | "statuses" | "checks",
  ) {
    super(es, en);
  }
}

export type ErrorContext = {
  /** Qué se estaba haciendo, para explicar un 403: crear el PR pide «Pull requests», escribir pide «Contents». */
  need?: "pulls" | "contents" | "statuses" | "checks";
  /** Si 404 significa «no está la rama». */
  branch?: string;
};

const PERMISSION_NAME: Record<NonNullable<ErrorContext["need"]>, string> = {
  pulls: "Pull requests: Read and write",
  contents: "Contents: Read and write",
  statuses: "Commit statuses: Read",
  checks: "Checks: Read",
};

/** Traduce una respuesta de error de GitHub a un mensaje claro (sin la llave). */
export function explainGitHub(status: number, body: string, headers: { get(name: string): string | null }, ctx: ErrorContext = {}, token?: string): GitHubError {
  let message = "";
  try {
    const j = JSON.parse(body) as { message?: string; errors?: { message?: string; code?: string }[] };
    message = [j.message, ...(j.errors ?? []).map((e) => e.message || e.code)].filter(Boolean).join(" · ");
  } catch {
    message = body.slice(0, 200);
  }
  message = scrubSecrets(message, token).slice(0, 200);
  if (status === 401) return new GitHubError(401, "La llave venció; crea una nueva en GitHub y pégala en Conexiones → Sitio web.", "The key expired; create a new one on GitHub and paste it in Connections → Website.");
  if (status === 403 || status === 429) {
    if (headers.get("x-ratelimit-remaining") === "0" || status === 429 || /rate limit/i.test(message))
      return new GitHubError(status, "GitHub pidió esperar un rato (demasiadas consultas). Intenta de nuevo en unos minutos.", "GitHub asked us to wait a bit (too many requests). Try again in a few minutes.");
    if (ctx.need) {
      const p = PERMISSION_NAME[ctx.need];
      return new GitHubError(403, `A la llave le falta el permiso «${p}». Agrégalo en GitHub (los pasos están abajo) y vuelve a intentarlo.`, `The key is missing the “${p}” permission. Add it on GitHub (steps below) and try again.`, ctx.need);
    }
    return new GitHubError(403, "La llave no tiene permiso para esto. Revisa sus permisos en GitHub (los pasos están abajo).", "The key isn't allowed to do this. Check its permissions on GitHub (steps below).");
  }
  if (status === 404) {
    if (ctx.branch) return new GitHubError(404, `No encontramos la rama «${ctx.branch}» en tu repositorio.`, `We couldn't find the “${ctx.branch}” branch in your repository.`);
    return new GitHubError(404, "No encontramos el repositorio (o la llave no tiene acceso a él). Revisa el nombre «dueño/repositorio» y que la llave incluya ese repositorio.", "We couldn't find the repository (or the key can't access it). Check the “owner/repository” name and that the key includes that repository.");
  }
  if (status === 405 && /squash/i.test(message))
    return new GitHubError(405, "Tu repositorio no permite «squash merge». Actívalo en GitHub → Settings → General → Pull Requests → «Allow squash merging».", "Your repository doesn't allow squash merging. Turn it on in GitHub → Settings → General → Pull Requests → “Allow squash merging”.");
  if (status === 405 && /review|protected|status check/i.test(message))
    return new GitHubError(405, "La rama principal está protegida en GitHub (pide revisiones o checks): no se puede publicar desde Matya hasta que se cumplan.", "The main branch is protected on GitHub (it requires reviews or checks): it can't be published from Matya until they pass.");
  if (status === 409 || status === 405)
    return new GitHubError(status, "La web cambió mientras trabajábamos. Vuelve a preparar los arreglos.", "The website changed while we were working. Prepare the fixes again.");
  if (status === 422) return new GitHubError(422, `GitHub no aceptó el cambio${message ? ` (${message})` : ""}.`, `GitHub didn't accept the change${message ? ` (${message})` : ""}.`);
  if (status >= 500) return new GitHubError(status, "GitHub tiene problemas en este momento. Intenta más tarde.", "GitHub is having trouble right now. Try again later.");
  return new GitHubError(status, `GitHub respondió ${status}${message ? `: ${message}` : ""}.`, `GitHub responded ${status}${message ? `: ${message}` : ""}.`);
}

// ---------- Cliente real (API REST) ----------

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type HttpGitHubOptions = {
  token: string;
  repo: string;
  /** Para las pruebas (nunca se llama a GitHub de verdad en local). */
  fetchImpl?: FetchLike;
  /** Límite por llamada (por defecto 15 s; el árbol completo 25 s). */
  timeoutMs?: number;
};

const API = "https://api.github.com";

export function httpGitHub(opts: HttpGitHubOptions): GitHubClient {
  const repo = normalizeRepo(opts.repo);
  if (!repo) throw new GitHubError(0, "El repositorio debe escribirse como «dueño/nombre».", "The repository must be written as “owner/name”.");
  const token = opts.token.trim();
  if (!token) throw new GitHubError(0, "Falta la llave de GitHub en Conexiones → Sitio web.", "The GitHub key is missing in Connections → Website.");
  const doFetch: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const base = `${API}/repos/${repo}`;

  async function call<T>(method: string, path: string, body?: unknown, ctx: ErrorContext = {}, timeoutMs = opts.timeoutMs ?? 15_000): Promise<{ data: T; headers: Headers }> {
    let res: Response;
    try {
      res = await doFetch(path.startsWith("http") ? path : `${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Matya-WebFix",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "TimeoutError" || name === "AbortError")
        throw new GitHubError(0, "GitHub tardó demasiado en responder. Intenta de nuevo.", "GitHub took too long to respond. Try again.");
      throw new GitHubError(0, "No pudimos hablar con GitHub. Revisa tu internet e intenta de nuevo.", "We couldn't reach GitHub. Check the connection and try again.");
    }
    const text = res.status === 204 ? "" : await res.text();
    if (!res.ok) throw explainGitHub(res.status, text, res.headers, ctx, token);
    let data: T;
    try {
      data = (text ? JSON.parse(text) : {}) as T;
    } catch {
      throw new GitHubError(res.status, "GitHub mandó una respuesta que no se entiende.", "GitHub sent a response we couldn't read.");
    }
    return { data, headers: res.headers };
  }

  type RawPull = {
    number: number;
    html_url: string;
    state: "open" | "closed";
    merged?: boolean;
    merged_at?: string | null;
    mergeable?: boolean | null;
    mergeable_state?: string;
    head: { sha: string; ref: string };
    base: { ref: string };
  };
  const pull = (p: RawPull): PullInfo => ({
    number: p.number,
    url: p.html_url,
    state: p.state,
    merged: Boolean(p.merged || p.merged_at),
    mergeable: p.mergeable ?? null,
    mergeableState: p.mergeable_state ?? "unknown",
    headSha: p.head.sha,
    headRef: p.head.ref,
    baseRef: p.base.ref,
  });
  const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");

  return {
    repo,
    async getRepo() {
      const { data, headers } = await call<{ full_name: string; default_branch: string; private: boolean; permissions?: RepoInfo["permissions"] }>("GET", "");
      return {
        fullName: data.full_name,
        defaultBranch: data.default_branch,
        private: data.private,
        permissions: data.permissions,
        tokenExpires: headers.get("github-authentication-token-expiration") ?? undefined,
      };
    },
    async getBranch(branch) {
      const { data } = await call<{ name: string; commit: { sha: string; commit: { tree: { sha: string } } } }>("GET", `/branches/${enc(branch)}`, undefined, { branch });
      return { name: data.name, commitSha: data.commit.sha, treeSha: data.commit.commit.tree.sha };
    },
    async getTree(treeSha) {
      const { data } = await call<{ tree: TreeEntry[]; truncated: boolean }>("GET", `/git/trees/${encodeURIComponent(treeSha)}?recursive=1`, undefined, {}, opts.timeoutMs ?? 25_000);
      return { entries: data.tree.map((e) => ({ path: e.path, type: e.type, sha: e.sha, size: e.size, mode: e.mode })), truncated: Boolean(data.truncated) };
    },
    async getBlobText(sha) {
      const { data } = await call<{ content: string; encoding: string }>("GET", `/git/blobs/${encodeURIComponent(sha)}`);
      const buf = Buffer.from(data.content ?? "", data.encoding === "base64" ? "base64" : "utf8");
      if (buf.includes(0)) return null;
      const text = buf.toString("utf8");
      return text.includes("�") ? null : text;
    },
    async createBlob(content) {
      const { data } = await call<{ sha: string }>("POST", "/git/blobs", { content, encoding: "utf-8" }, { need: "contents" });
      return data.sha;
    },
    async createTree(baseTree, files) {
      const { data } = await call<{ sha: string }>("POST", "/git/trees", { base_tree: baseTree, tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", sha: f.sha })) }, { need: "contents" });
      return data.sha;
    },
    async createCommit(message, tree, parent) {
      const { data } = await call<{ sha: string }>("POST", "/git/commits", { message, tree, parents: [parent] }, { need: "contents" });
      return data.sha;
    },
    async createBranch(name, sha) {
      assertFixBranch(name);
      await call("POST", "/git/refs", { ref: `refs/heads/${name}`, sha }, { need: "contents" });
    },
    async deleteBranch(name) {
      assertFixBranch(name);
      await call("DELETE", `/git/refs/heads/${enc(name)}`, undefined, { need: "contents" });
    },
    async createPull(input) {
      assertFixBranch(input.head, input.base);
      const { data } = await call<RawPull>("POST", "/pulls", { title: input.title, body: input.body, head: input.head, base: input.base, maintainer_can_modify: false }, { need: "pulls" });
      return pull(data);
    },
    async getPull(n) {
      const { data } = await call<RawPull>("GET", `/pulls/${n}`, undefined, { need: "pulls" });
      return pull(data);
    },
    async listOpenPulls() {
      const { data } = await call<unknown[]>("GET", "/pulls?state=open&per_page=1", undefined, { need: "pulls" });
      return Array.isArray(data) ? data.length : 0;
    },
    async closePull(n) {
      await call("PATCH", `/pulls/${n}`, { state: "closed" }, { need: "pulls" });
    },
    async mergePull(n, input) {
      const { data } = await call<{ merged: boolean; sha: string }>("PUT", `/pulls/${n}/merge`, { merge_method: "squash", sha: input.sha, commit_title: input.title }, { need: "pulls" });
      return { merged: Boolean(data.merged), sha: data.sha };
    },
    async combinedStatus(sha) {
      const { data } = await call<{ state: CombinedStatus["state"]; statuses: { context: string; state: CommitStatus["state"]; target_url: string | null; description: string | null }[] }>(
        "GET",
        `/commits/${encodeURIComponent(sha)}/status`,
        undefined,
        { need: "statuses" },
      );
      return { state: data.state, statuses: (data.statuses ?? []).map((s) => ({ context: s.context, state: s.state, targetUrl: s.target_url ?? "", description: s.description ?? "" })) };
    },
    async checkRuns(sha) {
      const { data } = await call<{ check_runs: { name: string; status: string; conclusion: string | null; details_url: string | null; output?: { summary?: string | null } }[] }>(
        "GET",
        `/commits/${encodeURIComponent(sha)}/check-runs?per_page=50`,
        undefined,
        { need: "checks" },
      );
      return (data.check_runs ?? []).map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion, detailsUrl: c.details_url ?? "", summary: c.output?.summary ?? "" }));
    },
    async deploymentUrls(sha) {
      try {
        const { data } = await call<{ id: number }[]>("GET", `/deployments?sha=${encodeURIComponent(sha)}&per_page=5`);
        const urls: string[] = [];
        for (const d of data.slice(0, 3)) {
          const { data: st } = await call<{ state: string; environment_url?: string; target_url?: string }[]>("GET", `/deployments/${d.id}/statuses?per_page=5`);
          for (const s of st) if (s.state === "success" && (s.environment_url || s.target_url)) urls.push((s.environment_url || s.target_url)!);
        }
        return urls;
      } catch {
        return [];
      }
    },
    async prComments(n) {
      const { data } = await call<{ user?: { login?: string }; body?: string }[]>("GET", `/issues/${n}/comments?per_page=30`, undefined, { need: "pulls" });
      return data.map((c) => ({ user: c.user?.login ?? "", body: c.body ?? "" }));
    },
  };
}
