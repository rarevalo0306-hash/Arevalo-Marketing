// «Listo para tu aprobación» (Inicio) y el numerito de «Inicio» en el menú: lo que la IA dejó preparado y espera un
// clic del dueño. Lo puro (cómo se cuenta y qué dice cada tarjeta) está aquí; la lectura de la base, en approvals.ts.
import { hasWorkToPublish, toPublish, type RankFixJob } from "@/lib/rankfix-shape";

export type Bi = { es: string; en: string };

export type ApprovalKey = "rankfix" | "webfix" | "proposals" | "articles" | "campaign";

export type ApprovalItem = {
  key: ApprovalKey;
  /** Cuántas cosas esperan (un trabajo de posiciones cuenta como 1: se publica con un solo clic). */
  count: number;
  /** De dónde viene («Posiciones en Google»…). */
  source: Bi;
  /** Una línea con lo que está listo. */
  summary: Bi;
  /** El enlace («Revisar y publicar →»). */
  cta: Bi;
  href: string;
};

/** Lo que se leyó de la base (solo campos pequeños). */
export type ApprovalFacts = {
  rankfix: { id: string; job: RankFixJob } | null;
  webfix: { id: string; status: string; changes: number } | null;
  proposals: { count: number; title: Bi | null };
  /** Artículos con la versión web preparada y sin publicar (id del reporte y su título). */
  articles: { id: string; title: string }[];
  /** Borradores de campañas que esperan aprobación. */
  campaign: { count: number; campaignIds: string[]; name: string };
};

const plural = (n: number, one: Bi, many: (n: number) => Bi): Bi => (n === 1 ? one : many(n));
const join = (parts: Bi[]): Bi => {
  const j = (xs: string[], and: string) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}`);
  return { es: j(parts.map((p) => p.es), "y"), en: j(parts.map((p) => p.en), "and") };
};

/** Arma las tarjetas, en el orden en que se muestran. Sin nada que aprobar: lista vacía. */
export function buildApprovals(businessId: string, f: ApprovalFacts): ApprovalItem[] {
  const base = `/b/${businessId}`;
  const out: ApprovalItem[] = [];
  const inJob = new Set<string>();

  // 1) «Que la IA mejore mis posiciones»: artículos listos y páginas mejoradas, se publica todo con un clic.
  const job = f.rankfix?.job;
  if (job && job.status === "ready" && hasWorkToPublish(job)) {
    const articles = toPublish(job);
    for (const a of articles) inJob.add(a.articleId);
    const pages = job.fix.state === "started" && job.fix.outcome !== "published" ? job.items.filter((x) => x.state === "fix").length : 0;
    const parts: Bi[] = [];
    if (articles.length) parts.push(plural(articles.length, { es: "1 artículo", en: "1 article" }, (n) => ({ es: `${n} artículos`, en: `${n} articles` })));
    if (pages) parts.push(plural(pages, { es: "1 página mejorada", en: "1 improved page" }, (n) => ({ es: `${n} páginas mejoradas`, en: `${n} improved pages` })));
    out.push({
      key: "rankfix",
      count: 1,
      source: { es: "Posiciones en Google", en: "Google rankings" },
      summary: parts.length ? join(parts) : { es: "Mejoras listas para publicar", en: "Improvements ready to publish" },
      cta: { es: "Revisar y publicar →", en: "Review and publish →" },
      href: `${base}/seo?tab=google#posiciones`,
    });
  }

  // 2) Un arreglo de la web esperando revisión (si no es el mismo del trabajo de posiciones).
  const fix = f.webfix;
  if (fix && fix.status === "open" && fix.id !== job?.fix.id) {
    out.push({
      key: "webfix",
      count: 1,
      source: { es: "Arreglos de tu web", en: "Website fixes" },
      summary: fix.changes
        ? plural(fix.changes, { es: "1 cambio listo para revisar", en: "1 change ready to review" }, (n) => ({ es: `${n} cambios listos para revisar`, en: `${n} changes ready to review` }))
        : { es: "Arreglos listos para revisar", en: "Fixes ready to review" },
      cta: { es: "Ver cómo queda →", en: "See how it looks →" },
      href: `${base}/seo?tab=web#arreglos`,
    });
  }

  // 3) Propuestas de la IA sin decidir.
  if (f.proposals.count > 0) {
    out.push({
      key: "proposals",
      count: f.proposals.count,
      source: { es: "Propuestas de la IA", en: "AI proposals" },
      summary:
        f.proposals.count === 1 && f.proposals.title
          ? f.proposals.title
          : plural(f.proposals.count, { es: "1 propuesta para mejorar tus resultados", en: "1 proposal to improve your results" }, (n) => ({
              es: `${n} propuestas para mejorar tus resultados`,
              en: `${n} proposals to improve your results`,
            })),
      cta: { es: "Aceptar o rechazar →", en: "Accept or reject →" },
      href: `${base}/propuestas`,
    });
  }

  // 4) Artículos preparados para la web y sin publicar (los del trabajo de posiciones ya van en su tarjeta).
  const articles = f.articles.filter((a) => !inJob.has(a.id));
  if (articles.length) {
    const first = articles[0];
    out.push({
      key: "articles",
      count: articles.length,
      source: { es: "Artículos para tu web", en: "Articles for your website" },
      summary:
        articles.length === 1 && first.title
          ? { es: `«${first.title}» está listo para publicar`, en: `“${first.title}” is ready to publish` }
          : plural(articles.length, { es: "1 artículo listo para publicar", en: "1 article ready to publish" }, (n) => ({ es: `${n} artículos listos para publicar`, en: `${n} articles ready to publish` })),
      cta: { es: "Revisar y publicar →", en: "Review and publish →" },
      href: `${base}/seo/escribir?a=${encodeURIComponent(first.id)}`,
    });
  }

  // 5) Publicaciones de campañas que esperan aprobación.
  const c = f.campaign;
  if (c.count > 0) {
    const one = c.campaignIds.length === 1;
    out.push({
      key: "campaign",
      count: c.count,
      source: { es: "Campañas", en: "Campaigns" },
      summary: plural(
        c.count,
        one && c.name ? { es: `1 publicación de «${c.name}»`, en: `1 post from “${c.name}”` } : { es: "1 publicación por aprobar", en: "1 post to approve" },
        (n) => (one && c.name ? { es: `${n} publicaciones de «${c.name}»`, en: `${n} posts from “${c.name}”` } : { es: `${n} publicaciones por aprobar`, en: `${n} posts to approve` }),
      ),
      cta: { es: "Aprobar →", en: "Approve →" },
      href: one ? `${base}/campanas/${c.campaignIds[0]}` : `${base}/campanas`,
    });
  }

  return out;
}

/** El número del menú y del saludo: todo lo que espera un clic. */
export const approvalTotal = (items: Pick<ApprovalItem, "count">[]) => items.reduce((n, x) => n + x.count, 0);
