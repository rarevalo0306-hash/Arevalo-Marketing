import { AiPromptButton } from "@/components/seo/AiPromptButton";
import styles from "@/components/seo/AuditPanel.module.css";
import { Fold } from "@/components/seo/Fold";
import { translator, type UiLang } from "@/lib/i18n";
import { CATEGORY_LABEL, ISSUE_CATEGORIES, ISSUE_META, ISSUE_TEXT, type AuditReport, type Issue, type IssueCategory, type IssueItem, type Severity } from "@/lib/seo/audit";
import type { AuditCompare } from "@/lib/seo/audit-compare";
import { auditGroupPrompt, issueCountLabel } from "@/lib/seo/audit-prompt";
import type { PromptContext } from "@/lib/seo/prompt-core";

const PILL: Record<Severity, string> = { error: "failed", warning: "partial", notice: "scheduled" };
const SEVERITIES: Severity[] = ["error", "warning", "notice"];

/** La dirección corta para mostrar: solo la ruta si es del mismo sitio. */
export function shortUrl(url: string, home: string): string {
  try {
    const u = new URL(url);
    const h = new URL(home);
    return u.host === h.host ? `${u.pathname}${u.search}` || "/" : url.replace(/^https?:\/\//, "");
  } catch {
    return url;
  }
}

type Props = { report: AuditReport; compare: AuditCompare | null; ctx: PromptContext | null; lang: UiLang };

/** «Qué arreglar»: los problemas agrupados por gravedad y, dentro, por tema, con cómo arreglarlos y las páginas. */
export function AuditIssues({ report, compare, ctx, lang }: Props) {
  const t = translator(lang);
  const home = report.site.home;
  const sevTitle: Record<Severity, string> = {
    error: t("Errores: arréglalos primero", "Errors: fix these first"),
    warning: t("Advertencias", "Warnings"),
    notice: t("Sugerencias: detalles que suman", "Notices: details that add up"),
  };
  const sevName: Record<Severity, string> = { error: t("Los errores", "Errors"), warning: t("Las advertencias", "Warnings"), notice: t("Las sugerencias", "Notices") };
  const sevLabel: Record<Severity, string> = { error: t("Error", "Error"), warning: t("Advertencia", "Warning"), notice: t("Sugerencia", "Notice") };

  /** «Ver la página», «Ver los 3 enlaces»… */
  const seeLabel = (unit: string, n: number) => {
    const one = n === 1;
    switch (unit) {
      case "links":
        return one ? t("Ver el enlace", "See the link") : t(`Ver los ${n} enlaces`, `See the ${n} links`);
      case "images":
        return one ? t("Ver la foto", "See the image") : t(`Ver las ${n} fotos`, `See the ${n} images`);
      case "urls":
        return one ? t("Ver la dirección", "See the address") : t(`Ver las ${n} direcciones`, `See the ${n} addresses`);
      default:
        return one ? t("Ver la página", "See the page") : t(`Ver las ${n} páginas`, `See the ${n} pages`);
    }
  };

  const groups = (sev: Severity) => {
    const list = report.issues.filter((i) => i.severity === sev);
    return ISSUE_CATEGORIES.map((c) => ({ category: c, issues: list.filter((i) => (i.category ?? ISSUE_META[i.id].category) === c) })).filter((g) => g.issues.length);
  };

  const card = (i: Issue) => {
    const copy = ISSUE_TEXT[i.id][lang];
    const diff = compare?.issues[i.id];
    const broken = i.id === "broken-links" ? report.site.brokenLinks : [];
    const items: IssueItem[] = broken.length
      ? broken.map((b) => ({ url: b.url, detail: { es: `Responde ${b.status}${b.from.length ? ` · está en ${b.from.map((f) => shortUrl(f, home)).join(", ")}` : ""}`, en: `Returns ${b.status}${b.from.length ? ` · found on ${b.from.map((f) => shortUrl(f, home)).join(", ")}` : ""}` } }))
      : i.items?.length
        ? i.items
        : i.pages.map((url) => ({ url }));
    const site = ISSUE_META[i.id].unit === "site";
    const more = i.count - items.length;
    return (
      <li key={i.id} className={`seo-issue ${styles.issue}`} data-issue={i.id}>
        <div className={styles.issueHead}>
          <span className={`pill ${PILL[i.severity]}`}>{sevLabel[i.severity]}</span>
          <strong className={styles.issueTitle}>{copy.title}</strong>
          <span className={styles.issueCount}>{issueCountLabel(i, lang)}</span>
        </div>
        {diff && (
          <div className={styles.chips}>
            {diff.newCheck ? (
              <span className={`${styles.chip} ${styles.chipInfo}`}>{t("Revisión nueva", "New check")}</span>
            ) : diff.fixed === 0 && diff.added === 0 ? (
              <span className={styles.chip}>{t("Igual que la vez anterior", "Same as last time")}</span>
            ) : (
              <>
                <span className={`${styles.chip} ${diff.fixed ? styles.chipOk : ""}`}>{t(`Arregladas: ${diff.fixed}`, `Fixed: ${diff.fixed}`)}</span>
                <span className={`${styles.chip} ${diff.added ? styles.chipBad : ""}`}>{t(`Nuevas: ${diff.added}`, `New: ${diff.added}`)}</span>
              </>
            )}
          </div>
        )}
        <p className={styles.fix}>
          <strong>{t("Cómo arreglarlo: ", "How to fix it: ")}</strong>
          {copy.fix}
        </p>
        {items.length > 0 && (!site || items.some((x) => x.value || x.detail)) && (
          <Fold inline summary={site ? t("Ver el detalle", "See the details") : seeLabel(ISSUE_META[i.id].unit, i.count)}>
            <ul className={styles.urls}>
              {items.map((x) => (
                <li key={x.url}>
                  <a href={x.url} target="_blank" rel="noopener noreferrer">{shortUrl(x.url, home)}</a>
                  {/* El valor exacto, salvo que la nota ya lo diga (ej. «404» y «Responde 404»). */}
                  {x.value && !x.detail?.[lang].includes(x.value) && <span className={styles.value}>«{x.value}»</span>}
                  {x.detail && <span className={styles.detail}>{x.detail[lang]}</span>}
                </li>
              ))}
              {more > 0 && <li className="muted">{t(`y ${more} más`, `and ${more} more`)}</li>}
            </ul>
          </Fold>
        )}
      </li>
    );
  };

  const section = (sev: Severity) => {
    const gs = groups(sev);
    if (!gs.length) return null;
    const n = gs.reduce((s, g) => s + g.issues.length, 0);
    const sevIssues = gs.flatMap((g) => g.issues);
    const prompt = ctx ? auditGroupPrompt(ctx, report, sevIssues, lang, sevName[sev]) : "";
    const body = (
      <>
        {gs.map((g) => (
          <div key={g.category} className={styles.group}>
            <h4 className={styles.groupTitle}>
              {CATEGORY_LABEL[g.category as IssueCategory][lang]} <span className={styles.groupCount}>{g.issues.length}</span>
            </h4>
            <ul className="seo-issues">{g.issues.map(card)}</ul>
          </div>
        ))}
        {prompt && (
          <AiPromptButton
            text={prompt}
            label={t("Prompt para la IA que maneja tu web", "Prompt for the AI that runs your website")}
            hint={t(`Solo ${sevName[sev].toLowerCase()}, con cada página y cómo arreglarlo.`, `Only the ${sevName[sev].toLowerCase()}, with each page and how to fix it.`)}
          />
        )}
      </>
    );
    const title = (
      <span className={styles.sevTitle}>
        <span className={`pill ${PILL[sev]}`}>{n}</span> {sevTitle[sev]}
      </span>
    );
    return sev === "notice" ? (
      <Fold key={sev} summary={title} note={t("Detalles que conviene arreglar cuando tengas tiempo.", "Details worth fixing when you have time.")}>
        {body}
      </Fold>
    ) : (
      <section key={sev} className={styles.sev} aria-label={sevTitle[sev]}>
        <h3 className={styles.sevHead}>{title}</h3>
        {body}
      </section>
    );
  };

  return <div className="stack" style={{ gap: 14 }}>{SEVERITIES.map(section)}</div>;
}
