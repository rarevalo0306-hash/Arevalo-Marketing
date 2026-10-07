import Link from "next/link";
import { moreIdeas } from "@/app/actions-ideas";
import { aiEnabled } from "@/lib/ai";
import { channelName } from "@/lib/channels";
import { loadIdeas, loadSocialBits } from "@/lib/dashboard";
import type { UiLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { when } from "./fmt";
import { QuickPost } from "./QuickPost";
import s from "./Dashboard.module.css";

const STATUS: Record<UiLang, Record<string, string>> = {
  es: { draft: "Borrador", scheduled: "Programado", publishing: "Publicando", done: "Publicado", partial: "En parte", failed: "No salió" },
  en: { draft: "Draft", scheduled: "Scheduled", publishing: "Publishing", done: "Published", partial: "Partly published", failed: "Didn't go out" },
};

/** Tarjeta "¿Qué quieres publicar?" (compacta) con las ideas de hoy. */
export async function QuickPostCard({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const ideas = await loadIdeas(businessId, lang);
  const ai = aiEnabled();
  return (
    <section className={`card ${s.quick}`} aria-labelledby="dash-quick">
      <div className={s.sectionHead}>
        <h2 id="dash-quick">{t("¿Qué quieres publicar?", "What do you want to post?")}</h2>
        <Link href={`/b/${businessId}/plan`} className="small">
          {t("Plan de la semana →", "Weekly plan →")}
        </Link>
      </div>
      <p className="small muted" style={{ marginTop: -6 }}>
        {t("La IA escribe para cada red y crea la foto con tu marca. Tú solo apruebas.", "The AI writes for each network and makes the photo with your brand. You just approve.")}
      </p>
      <QuickPost businessId={businessId} ideas={ideas.ideas.slice(0, 4)} basis={ideas.basis} enabled={ai} more={ai ? moreIdeas.bind(null, businessId) : null} />
    </section>
  );
}

/** "Lo más reciente": las últimas 4 publicaciones, en chico. */
export async function RecentPosts({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const social = await loadSocialBits(businessId);
  const recent = social.recent;
  return (
    <section className={`card ${s.recentCard}`} aria-labelledby="dash-recent">
      <div className={s.sectionHead}>
        <h2 id="dash-recent">{t("Lo más reciente", "Latest")}</h2>
        <Link href={`/b/${businessId}/historial`} className="small">
          {t("Ver todo", "See all")}
        </Link>
      </div>
      {recent.length === 0 ? (
        <p className="small muted">{t("Todavía no hay publicaciones. Empieza con una idea de hoy ✦", "No posts yet. Start with one of today's ideas ✦")}</p>
      ) : (
        <div className="recent">
          {recent.map((p) => (
            <Link key={p.id} href={`/b/${businessId}/historial`} className="recent-item">
              {p.mediaType === "photo" && p.mediaUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.mediaUrl} alt="" className="thumb" />
              ) : (
                <span className="thumb thumb-empty">{p.mediaType === "video" ? "▶" : "Aa"}</span>
              )}
              <span className="recent-text">
                <span className="recent-title">{p.text.slice(0, 90)}</span>
                <span className="small muted">
                  {[p.targets.map((x) => channelName(x.channel, lang)).join(" · "), when(p.status === "scheduled" ? p.scheduledAt : p.createdAt, lang)].filter(Boolean).join(" — ")}
                </span>
              </span>
              <span className={`pill ${p.status}`}>{STATUS[lang][p.status] ?? p.status}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
