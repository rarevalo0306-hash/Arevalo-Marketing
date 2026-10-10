// «Arréglalo por mí», el trabajo de verdad sin base de datos: leer la web en GitHub, elegir los archivos, pedir los
// cambios a la IA, revisarlos (webfix-edits.ts), escribirlos SOLO en una rama nueva «matya/arreglos-…» y abrir el
// pull request; leer la vista previa; publicar (squash con el sha esperado) o descartar. GitHub y la IA llegan de
// afuera (GitHubClient y AskFn) para probarlo todo con FakeGitHub (tests/webfix-pipeline.test.ts).
import { type GitHubClient, GitHubError } from "@/lib/github";
import { BiError } from "@/lib/i18n";
import { isSiteLevel } from "@/lib/seo/audit-ids";
import { applyEdits } from "@/lib/webfix-edits";
import { type Picked, pickFiles, PICK_DEFAULTS, siteUrlsIn, type Target } from "@/lib/webfix-routes";
import {
  type AiEdits,
  type Bi,
  estimateCents,
  FIX_SYSTEM,
  fixBranchName,
  type FixJob,
  type FixSource,
  fixUserPrompt,
  outsideOutcome,
  prBody,
  previewState,
  prTitle,
  toFixChanges,
} from "@/lib/webfix-shape";

export type AskFn = (system: string, user: string) => Promise<AiEdits>;

export type PrepareInput = {
  source: FixSource;
  /** El mismo texto que copia el botón de instrucciones. */
  instructions: string;
  base: string;
  website: string;
  now: Date;
  timeZone?: string;
};

export type PrepareResult = Partial<FixJob> & { status: "open" | "nothing" | "failed" };

const B = (es: string, en: string): Bi => ({ es, en });
const errBi = (e: unknown): Bi => (e instanceof BiError ? { es: e.message, en: e.en } : B("Algo falló al preparar los arreglos. Intenta de nuevo.", "Something went wrong preparing the fixes. Try again."));
const missingOf = (e: unknown): FixJob["missing"] => (e instanceof GitHubError && e.missing ? e.missing : "");

/** Las direcciones y avisos a revisar: las del botón y las que vienen escritas en las instrucciones. */
export function targetsFor(source: FixSource, instructions: string, website: string): { targets: Target[]; siteWide: boolean } {
  const urls = new Set<string>();
  for (const u of source.urls) {
    const path = u.startsWith("/") ? u : siteUrlsIn(u, website)[0];
    if (path) urls.add(path);
  }
  for (const u of siteUrlsIn(instructions, website)) urls.add(u);
  const siteWide = source.issueIds.some(isSiteLevel) || urls.size === 0;
  return { targets: [...urls].slice(0, 40).map((url) => ({ url, refs: source.issueIds })), siteWide };
}

/** Cuánto cuesta (estimado) la respuesta de la IA: el prompt y lo que respondió, más lo que «piensa». */
const callCents = (promptChars: number, answer: AiEdits) => estimateCents(promptChars, Math.ceil(JSON.stringify(answer).length / 4) + 8_000);

/**
 * Prepara los arreglos y abre el PR. Nunca escribe en `base`: crea blobs, un árbol y un commit cuyo padre es la
 * cabeza de `base`, y solo después la rama «matya/arreglos-…». `onStep` guarda el avance (leer, IA, escribir).
 */
export async function prepareFix(gh: GitHubClient, ask: AskFn, input: PrepareInput, onStep: (patch: Partial<FixJob>) => Promise<void> = async () => {}): Promise<PrepareResult> {
  let costCents = 0;
  let branchCreated = "";
  try {
    // 1) Permisos (solo lectura) antes de gastar en la IA: escribir y pull requests.
    const repo = await gh.getRepo();
    if (repo.permissions && repo.permissions.push === false)
      throw new GitHubError(403, "La llave solo puede leer tu web: le falta el permiso «Contents: Read and write».", "The key can only read your site: it's missing the “Contents: Read and write” permission.", "contents");
    await gh.listOpenPulls();

    // 2) Leer la cabeza de la rama y el árbol completo.
    const head = await gh.getBranch(input.base);
    const tree = await gh.getTree(head.treeSha);
    const blobs = new Map(tree.entries.filter((e) => e.type === "blob").map((e) => [e.path, e]));
    const files = [...blobs.values()].map((e) => ({ path: e.path, size: e.size ?? 0 }));
    const { targets, siteWide } = targetsFor(input.source, input.instructions, input.website);
    const picked: Picked[] = await pickFiles(files, targets, (p) => gh.getBlobText(blobs.get(p)!.sha), { ...PICK_DEFAULTS, hints: input.instructions, siteWide });
    await onStep({ step: "asking", baseSha: head.commitSha, read: picked.map((p) => p.path) });
    if (!picked.length)
      return {
        status: "nothing",
        baseSha: head.commitSha,
        summary: B("No encontramos en tu repositorio los archivos de esas páginas, así que no cambiamos nada.", "We couldn't find those pages' files in your repository, so nothing was changed."),
      };

    // 3) La IA propone; Matya revisa cada cambio.
    const user = fixUserPrompt(input.instructions, picked);
    const answer = await ask(FIX_SYSTEM, user);
    costCents = callCents(FIX_SYSTEM.length + user.length, answer);
    const contents = new Map(picked.map((p) => [p.path, p.content]));
    const { changes, dropped } = applyEdits(answer.edits, contents, new Set(blobs.keys()));
    const pagesOf = new Map(picked.map((p) => [p.path, p.pages]));
    const fixChanges = toFixChanges(changes, pagesOf);
    const skipped = answer.skipped.slice(0, 60).map((s) => ({ issue: s.issue.slice(0, 200), reason: { es: s.reason.es.slice(0, 400), en: s.reason.en.slice(0, 400) } }));
    const summary = { es: answer.summary.es.slice(0, 600), en: answer.summary.en.slice(0, 600) };
    if (!changes.length)
      return {
        status: "nothing",
        baseSha: head.commitSha,
        costCents,
        skipped,
        dropped,
        summary: dropped.length
          ? B("La IA propuso cambios, pero ninguno pasó la revisión de seguridad. No se escribió nada en tu web.", "The AI proposed changes, but none passed the safety check. Nothing was written to your site.")
          : B("La IA no encontró cambios seguros para hacer en el código. No se escribió nada en tu web.", "The AI found no safe changes to make in the code. Nothing was written to your site."),
      };

    // 4) Escribir solo en una rama nueva (blobs → árbol → commit → rama).
    await onStep({ step: "writing", costCents, changes: fixChanges, skipped, dropped, summary });
    const entries = [];
    for (const c of changes) entries.push({ path: c.path, sha: await gh.createBlob(c.after) });
    const treeSha = await gh.createTree(head.treeSha, entries);
    const commit = await gh.createCommit(`Matya: arreglos de SEO (${changes.length} ${changes.length === 1 ? "archivo" : "archivos"})\n\n${summary.es}`.slice(0, 2000), treeSha, head.commitSha);
    let branch = fixBranchName(input.now, input.timeZone);
    for (let i = 2; ; i++) {
      try {
        await gh.createBranch(branch, commit);
        branchCreated = branch;
        break;
      } catch (e) {
        if (!(e instanceof GitHubError && e.status === 422) || i > 6) throw e;
        branch = `${fixBranchName(input.now, input.timeZone)}-${i}`;
      }
    }
    const pr = await gh.createPull({ title: prTitle(input.source, changes.length), body: prBody(fixChanges, skipped, dropped, summary), head: branch, base: input.base });
    return {
      status: "open",
      baseSha: head.commitSha,
      branch,
      prNumber: pr.number,
      prUrl: pr.url,
      headSha: pr.headSha || commit,
      costCents,
      changes: fixChanges,
      skipped,
      dropped,
      summary,
      build: "waiting",
      mergeable: pr.mergeable,
    };
  } catch (e) {
    // Si la rama se alcanzó a crear pero el PR no, se borra (nunca queda basura a medias).
    if (branchCreated) await gh.deleteBranch(branchCreated).catch(() => {});
    return { status: "failed", costCents, error: errBi(e), missing: missingOf(e) };
  }
}

export type RefreshResult = Partial<FixJob>;

/** Lee el PR y su vista previa. Si se publicó o se cerró fuera de Matya, lo dice (outside). */
export async function refreshFix(gh: GitHubClient, job: FixJob, now: Date): Promise<RefreshResult> {
  const checkedAt = now.toISOString();
  try {
    const pr = await gh.getPull(job.prNumber);
    const out = outsideOutcome(pr);
    if (out) return { status: out, outside: true, checkedAt, ...(out === "published" ? { publishedAt: checkedAt } : {}) };
    let missing: FixJob["missing"] = "";
    const status = await gh.combinedStatus(pr.headSha).catch((e) => {
      if (e instanceof GitHubError && e.status === 403) missing = "statuses";
      return null;
    });
    const checks = await gh.checkRuns(pr.headSha).catch((e) => {
      if (e instanceof GitHubError && e.status === 403 && !missing) missing = "checks";
      return null;
    });
    const deployments = await gh.deploymentUrls(pr.headSha).catch(() => []);
    const preview = previewState(status, checks, deployments);
    let previewUrl = preview.previewUrl;
    if (!previewUrl && preview.build !== "waiting") previewUrl = previewState(null, null, [], await gh.prComments(pr.number).catch(() => [])).previewUrl;
    return { headSha: pr.headSha, build: preview.build, previewUrl: previewUrl || job.previewUrl, mergeable: pr.mergeable, checkedAt, missing, error: null };
  } catch (e) {
    return { checkedAt, error: errBi(e), missing: missingOf(e) };
  }
}

const CHANGED = B("La web cambió o la vista previa falló; vuelve a preparar los arreglos.", "The website changed or the preview failed; prepare the fixes again.");

export type PublishResult = { ok: true; sha: string } | { ok: false; error: Bi; outcome?: "published" | "closed"; missing?: FixJob["missing"] };

/**
 * «Publicar en mi web»: vuelve a revisar todo en GitHub (PR abierto, mismo sha que revisó el dueño, vista previa
 * lista, sin conflictos) y hace squash merge con ese sha. Si algo no cuadra, no publica.
 */
export async function publishFix(gh: GitHubClient, job: FixJob): Promise<PublishResult> {
  try {
    if (!job.prNumber || !job.headSha) return { ok: false, error: CHANGED };
    const pr = await gh.getPull(job.prNumber);
    const out = outsideOutcome(pr);
    if (out) return { ok: false, outcome: out, error: out === "published" ? B("Estos arreglos ya se publicaron desde GitHub.", "These fixes were already published from GitHub.") : B("El arreglo se cerró desde GitHub.", "The fix was closed from GitHub.") };
    if (pr.headSha !== job.headSha || pr.baseRef !== job.base) return { ok: false, error: CHANGED };
    if (pr.mergeable === null) return { ok: false, error: B("GitHub todavía está revisando los cambios. Intenta en un momento.", "GitHub is still checking the changes. Try again in a moment.") };
    const preview = previewState(await gh.combinedStatus(pr.headSha).catch(() => null), await gh.checkRuns(pr.headSha).catch(() => null));
    if (pr.mergeable !== true || preview.build !== "success") return { ok: false, error: CHANGED };
    const r = await gh.mergePull(pr.number, { sha: job.headSha, title: `Matya: arreglos de SEO (#${pr.number})` });
    if (!r.merged) return { ok: false, error: CHANGED };
    await gh.deleteBranch(job.branch).catch(() => {});
    return { ok: true, sha: r.sha };
  } catch (e) {
    if (e instanceof GitHubError && e.status === 405 && /squash|protegida/.test(e.message)) return { ok: false, error: errBi(e) };
    if (e instanceof GitHubError && [405, 409, 422].includes(e.status)) return { ok: false, error: CHANGED };
    return { ok: false, error: errBi(e), missing: missingOf(e) };
  }
}

/** «Descartar»: cierra el PR y borra la rama de Matya (si ya no estaban, no pasa nada). */
export async function discardFix(gh: GitHubClient, job: FixJob): Promise<{ ok: true; outcome?: "published" } | { ok: false; error: Bi }> {
  try {
    if (job.prNumber) {
      const pr = await gh.getPull(job.prNumber);
      if (pr.merged) return { ok: true, outcome: "published" };
      if (pr.state === "open") await gh.closePull(pr.number);
    }
    if (job.branch)
      await gh.deleteBranch(job.branch).catch((e) => {
        if (!(e instanceof GitHubError && (e.status === 404 || e.status === 422))) throw e;
      });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errBi(e) };
  }
}

export type AccessCheck = { ok: boolean; lines: { ok: boolean; text: Bi }[]; missing: NonNullable<FixJob["missing"]>[]; expires: string };

/**
 * «Revisar la llave»: solo lectura (no escribe nada). Repositorio, rama, permiso de escritura, pull requests, estados
 * y checks (para la vista previa) y cuándo vence la llave.
 */
export async function checkAccess(gh: GitHubClient, branch: string): Promise<AccessCheck> {
  const lines: AccessCheck["lines"] = [];
  const missing: AccessCheck["missing"] = [];
  let expires = "";
  try {
    const repo = await gh.getRepo();
    expires = repo.tokenExpires ?? "";
    lines.push({ ok: true, text: B(`La llave puede ver el repositorio ${repo.fullName}.`, `The key can see the ${repo.fullName} repository.`) });
    if (repo.permissions && repo.permissions.push === false) {
      missing.push("contents");
      lines.push({ ok: false, text: B("Le falta «Contents: Read and write» (solo puede leer).", "It's missing “Contents: Read and write” (it can only read).") });
    }
    const head = await gh.getBranch(branch);
    lines.push({ ok: true, text: B(`La rama «${head.name}» existe.`, `The “${head.name}” branch exists.`) });
    const probes: [AccessCheck["missing"][number], () => Promise<unknown>, Bi, Bi][] = [
      ["pulls", () => gh.listOpenPulls(), B("Puede ver los pull requests.", "It can see pull requests."), B("Le falta «Pull requests: Read and write»: sin eso Matya no puede preparar los arreglos.", "It's missing “Pull requests: Read and write”: without it Matya can't prepare the fixes.")],
      ["statuses", () => gh.combinedStatus(head.commitSha), B("Puede ver el estado de la vista previa.", "It can see the preview status."), B("Le falta «Commit statuses: Read» (para saber si la vista previa salió bien).", "It's missing “Commit statuses: Read” (to know if the preview worked).")],
      ["checks", () => gh.checkRuns(head.commitSha), B("Puede ver los checks.", "It can see checks."), B("Le falta «Checks: Read» (opcional, ayuda con la vista previa).", "It's missing “Checks: Read” (optional, helps with the preview).")],
    ];
    for (const [id, probe, ok, bad] of probes) {
      try {
        await probe();
        lines.push({ ok: true, text: ok });
      } catch (e) {
        if (!(e instanceof GitHubError && (e.status === 403 || e.status === 404))) throw e;
        missing.push(id);
        lines.push({ ok: false, text: bad });
      }
    }
    lines.push({ ok: true, text: B("Para escribir, Matya solo crea ramas nuevas «matya/arreglos-…»; el permiso de crear pull requests se confirma al preparar el primer arreglo.", "To write, Matya only creates new “matya/arreglos-…” branches; the permission to open pull requests is confirmed when preparing the first fix.") });
  } catch (e) {
    lines.push({ ok: false, text: errBi(e) });
    return { ok: false, lines, missing, expires };
  }
  return { ok: !missing.some((m) => m === "pulls" || m === "contents"), lines, missing, expires };
}
