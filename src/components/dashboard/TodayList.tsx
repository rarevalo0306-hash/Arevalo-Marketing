import Link from "next/link";
import { channelName } from "@/lib/channels";
import { loadIdeas, loadSeoBits, loadSocialBits } from "@/lib/dashboard";
import { getT } from "@/lib/i18n-server";
import { seoHref, topLines } from "@/lib/seo/plain-load";
import { DashIcon, type DashIconName } from "./DashIcon";
import s from "./Dashboard.module.css";

/** Cuántas tareas se muestran. */
export const MAX_TASKS = 6;

type Kind = "bad" | "warn" | "setup" | "idea";
export type Task = { id: string; kind: Kind; icon: DashIconName | string; text: string; href: string; button: string };

const ORDER: Record<Kind, number> = { bad: 0, warn: 1, setup: 2, idea: 3 };

/** Lo urgente primero; la idea del día siempre cabe al final (si hay). Máximo `max`. */
export function pickTasks(list: Task[], max = MAX_TASKS): Task[] {
  const sorted = list.map((x, i) => ({ x, i })).sort((a, b) => ORDER[a.x.kind] - ORDER[b.x.kind] || a.i - b.i).map((v) => v.x);
  const idea = sorted.find((x) => x.kind === "idea");
  const rest = sorted.filter((x) => x.kind !== "idea").slice(0, idea ? max - 1 : max);
  return idea ? [...rest, idea] : rest;
}

/**
 * "Qué hacer hoy": lo más urgente de todas las herramientas en una lista corta (máx. 6), cada cosa con un botón.
 * Junta: lo rojo/amarillo del resumen de SEO, las redes que hay que volver a conectar, lo que no se publicó esta
 * semana, las reseñas sin contestar y la idea de hoy. Sin datos: los primeros pasos para empezar.
 */
export async function TodayList({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const [seo, social, ideas] = await Promise.all([loadSeoBits(businessId), loadSocialBits(businessId), loadIdeas(businessId, lang)]);
  if (!seo) return null;
  const base = `/b/${businessId}`;
  const pick = (x: { es: string; en: string }) => (lang === "en" ? x.en : x.es);
  const tasks: Task[] = [];

  // Redes que dejaron de funcionar.
  const broken = Object.keys(social.reconnect);
  if (broken.length) {
    const names = broken.map((c) => channelName(c, lang)).join(", ");
    tasks.push({
      id: "reconnect",
      kind: "bad",
      icon: "plug",
      text: t(`${names} dejó de funcionar: vuelve a conectarlo para que tus publicaciones salgan.`, `${names} stopped working: reconnect it so your posts go out.`),
      href: `${base}/conexiones`,
      button: t("Volver a conectar", "Reconnect"),
    });
  }
  // Publicaciones que no salieron (últimos 7 días).
  if (social.failed || social.partial) {
    const total = social.failed + social.partial;
    tasks.push({
      id: "failed",
      kind: social.failed ? "bad" : "warn",
      icon: "alert",
      text:
        total === 1
          ? t("Una publicación de esta semana no salió en todas tus redes.", "One post this week didn't go out on all your networks.")
          : t(`${total} publicaciones de esta semana no salieron en todas tus redes.`, `${total} posts this week didn't go out on all your networks.`),
      href: `${base}/historial`,
      button: t("Ver qué pasó", "See what happened"),
    });
  }
  // Reseñas de Google sin contestar.
  if (seo.reviews?.unanswered) {
    const { unanswered: u, unansweredLow: low } = seo.reviews;
    tasks.push({
      id: "reviews",
      kind: low ? "bad" : "warn",
      icon: "star",
      text:
        (u === 1 ? t("Tienes 1 reseña de Google sin contestar", "You have 1 unanswered Google review") : t(`Tienes ${u} reseñas de Google sin contestar`, `You have ${u} unanswered Google reviews`)) +
        (low ? t(` (${low} con 3 estrellas o menos).`, ` (${low} with 3 stars or fewer).`) : ". ") +
        (low ? "" : t("La IA te escribe la respuesta.", "The AI drafts the reply.")),
      href: `${base}/seo#perfil`,
      button: t("Contestar", "Reply"),
    });
  }
  // Lo importante del resumen de SEO: lo rojo y lo amarillo (y una oportunidad con acción, si sobra lugar).
  const lines = seo.plain?.lines ?? [];
  for (const l of topLines(lines, lines.length)) {
    if (l.tone !== "bad" && l.tone !== "warn" && !(l.tone === "info" && l.action)) continue;
    const go = l.action ?? l.link;
    tasks.push({
      id: `seo-${l.id}-${tasks.length}`,
      kind: l.tone === "bad" ? "bad" : l.tone === "warn" ? "warn" : "setup",
      icon: l.icon,
      text: pick(l.text),
      href: seoHref(businessId, go.href),
      button: pick(go.label),
    });
  }

  // Primeros pasos (cuando falta algo básico). Van después de lo urgente.
  if (!seo.website.trim())
    tasks.push({ id: "website", kind: "setup", icon: "web", text: t("Agrega tu página web para revisar cómo te encuentran en Google.", "Add your website so we can check how people find you on Google."), href: `${base}/negocio`, button: t("Agregar mi página", "Add my website") });
  if (seo.canRank && seo.tracked.length === 0)
    tasks.push({ id: "keywords", kind: "setup", icon: "key", text: t("Elige las búsquedas por las que quieres salir en Google. Te proponemos unas.", "Pick the searches you want to show up for on Google. We suggest some."), href: `${base}/seo?tab=ajustes`, button: t("Elegir palabras clave", "Pick keywords") });
  else if (seo.canRank && seo.rank.now === null && !seo.rankLatest)
    tasks.push({ id: "rank", kind: "setup", icon: "seo", text: t("Revisa en qué lugar sales en Google con tus palabras clave.", "Check where you rank on Google for your keywords."), href: `${base}/seo#posiciones`, button: t("Revisar posiciones", "Check rankings") });
  if (seo.website.trim() && seo.audit.now === null)
    tasks.push({ id: "audit", kind: "setup", icon: "web", text: t("Revisa tu página web: te decimos qué arreglar para que Google la entienda.", "Check your website: we tell you what to fix so Google understands it."), href: `${base}/seo#auditoria`, button: t("Revisar mi página", "Check my website") });
  if (social.connected === 0)
    tasks.push({ id: "connect", kind: "setup", icon: "social", text: t("Conecta Facebook, Instagram u otra red para publicar desde aquí.", "Connect Facebook, Instagram or another network to post from here."), href: `${base}/conexiones`, button: t("Conectar redes", "Connect networks") });
  if (!seo.studyAt)
    tasks.push({ id: "study", kind: "setup", icon: "bulb", text: t("Haz el estudio de tu negocio: la IA aprende a quién venderle y qué publicar.", "Run your business study: the AI learns who to sell to and what to post."), href: `${base}/estudio`, button: t("Hacer el estudio", "Run the study") });

  // La idea de hoy.
  const idea = ideas.ideas[0];
  if (idea)
    tasks.push({
      id: "idea",
      kind: "idea",
      icon: "ia",
      text: t(`Idea de hoy: «${idea.topic}». ${idea.why}`, `Today's idea: “${idea.topic}”. ${idea.why}`),
      href: `${base}/publicar?${new URLSearchParams({ idea: idea.idea, magic: "1" })}`,
      button: t("Crear con IA", "Create with AI"),
    });

  const list = pickTasks(tasks);
  return (
    <section className={`card ${s.today}`} aria-labelledby="dash-today">
      <div className={s.sectionHead}>
        <h2 id="dash-today">{t("Qué hacer hoy", "What to do today")}</h2>
        <span className={s.sectionHint}>{t("Lo urgente primero", "Urgent first")}</span>
      </div>
      {list.length === 0 ? (
        <p className={s.allGood}>{t("Todo al día. Buen trabajo.", "All caught up. Nice work.")}</p>
      ) : (
        <ol className={s.tasks}>
          {list.map((x) => (
            <li key={x.id} className={`${s.task} ${s[x.kind]}`}>
              <span className={s.taskIcon} aria-hidden="true">
                {isIcon(x.icon) ? <DashIcon name={x.icon} size={17} /> : <span>{x.icon}</span>}
              </span>
              <span className={s.taskText}>{x.text}</span>
              <Link href={x.href} className={`btn ${x.kind === "bad" ? "on" : ""} ${s.taskBtn}`}>
                {x.button} →
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const ICONS = new Set(["search", "seo", "local", "ia", "comp", "content", "social", "reports", "ads", "alert", "plug", "star", "bulb", "check", "link", "web", "key"]);
const isIcon = (x: string): x is DashIconName => ICONS.has(x);

export async function TodayListSkeleton() {
  const { t } = await getT();
  return (
    <section className={`card ${s.today}`} aria-busy="true">
      <h2>{t("Qué hacer hoy", "What to do today")}</h2>
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className={`${s.skel} ${s.skelLine}`} />
      ))}
    </section>
  );
}
