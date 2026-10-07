import Link from "next/link";
import { CHANNELS } from "@/lib/channels";
import { loadSeoBits, loadSocialBits } from "@/lib/dashboard";
import { getT } from "@/lib/i18n-server";
import { siteDomain } from "@/lib/seo/rank";
import { pctText } from "@/lib/seo/sov";
import { compact, n, when } from "./fmt";
import { DashIcon, type DashIconName } from "./DashIcon";
import s from "./Dashboard.module.css";

type Num = { value: React.ReactNode; label: string };
type Kit = {
  key: string;
  cls: string;
  icon: DashIconName;
  name: string;
  purpose: string;
  href: string;
  nums: Num[];
  /** Una línea extra debajo de los números. */
  extra?: string;
  /** Sin números: una línea de qué hacer. */
  empty?: string;
  at?: Date | null;
  /** Cómo se dice la fecha ("Revisado", "Última publicación"…) y qué decir sin fecha. */
  whenLabel?: { es: string; en: string; none: { es: string; en: string } };
  button?: { label: string; href: string; primary?: boolean; download?: boolean };
  soon?: boolean;
};

/**
 * Una tarjeta por herramienta (en el mismo orden que el menú): para qué sirve, sus números guardados, cuándo se revisó
 * (hora de Miami) y un botón con lo principal. Solo lee lo guardado.
 */
/** El dominio sin "www." para mostrar (los nombres que no son dominios quedan igual). */
const shortDomain = (d: string) => (d.includes(".") && !/\s/.test(d) ? siteDomain(d) || d : d);

export async function ToolkitGrid({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const [seo, social] = await Promise.all([loadSeoBits(businessId), loadSocialBits(businessId)]);
  if (!seo) return null;
  const base = `/b/${businessId}`;
  const seoUrl = `${base}/seo`;
  const rank = seo.rankLatest;
  const market = seo.plain?.market;

  // Competencia: el que más se lleva de tus búsquedas.
  const leader = market?.organic?.leader?.label ?? seo.competitors?.report.competitors[0]?.domain ?? null;
  const compCount = seo.competitors?.report.competitors.length ?? 0;
  const ownTraffic = seo.traffic?.report.domains.find((d) => d.isYou)?.now?.etv ?? seo.competitors?.report.you.traffic ?? null;

  const kits: Kit[] = [
    {
      key: "seo",
      cls: s.seo,
      icon: "seo",
      name: t("SEO: posiciones en Google", "SEO: Google rankings"),
      purpose: t("En qué lugar sales cuando te buscan.", "Where you show up when people search."),
      href: `${seoUrl}#posiciones`,
      nums: rank
        ? [
            ...(rank.report.avgPosition !== null ? [{ value: <>#{n(rank.report.avgPosition, lang)}</>, label: t("lugar promedio", "average spot") }] : []),
            { value: <>{rank.report.inTop10}<small> / {rank.ok}</small></>, label: t("en la primera página", "on page one") },
          ]
        : [],
      empty: seo.tracked.length
        ? t(`Sigues ${seo.tracked.length} palabras clave. Revisa en qué lugar sales.`, `You track ${seo.tracked.length} keywords. Check where you rank.`)
        : t("Elige las búsquedas por las que quieres salir.", "Pick the searches you want to show up for."),
      at: rank?.at,
      button: seo.tracked.length
        ? { label: t("Revisar posiciones", "Check rankings"), href: `${seoUrl}#posiciones` }
        : { label: t("Elegir palabras clave", "Pick keywords"), href: `${seoUrl}?tab=ajustes` },
    },
    {
      key: "local",
      cls: s.local,
      icon: "local",
      name: t("Local: mapa y Perfil de Google", "Local: map and Google profile"),
      purpose: t("Si sales arriba en Google Maps y tus reseñas.", "Whether you show up on top in Google Maps, and your reviews."),
      href: `${seoUrl}#mapa`,
      nums: [
        ...(seo.map.share !== null ? [{ value: pctText(seo.map.share), label: t("del mapa en el top 3", "of the map in the top 3") }] : []),
        ...(seo.reviews?.rating != null
          ? [{ value: <>{n(seo.reviews.rating, lang)}★<small> ({seo.reviews.total ?? "—"})</small></>, label: t("tus reseñas", "your reviews") }]
          : seo.gbp
            ? [{ value: <>{seo.gbp.score}<small>/100</small></>, label: t("tu Perfil de Google", "your Google profile") }]
            : []),
      ],
      empty: seo.map.hasPlace
        ? t("Mira en qué partes de tu zona sales arriba en el mapa.", "See which parts of your area show you on top of the map.")
        : t("Busca tu negocio en Google Maps para revisar el mapa y tus reseñas.", "Find your business on Google Maps to check the map and your reviews."),
      at: [seo.map.at, seo.reviews?.at, seo.gbp?.at].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
      button: { label: t("Ver mapa", "See map"), href: `${seoUrl}#mapa` },
    },
    {
      key: "ia",
      cls: s.ia,
      icon: "ia",
      name: t("Visibilidad en IA", "AI visibility"),
      purpose: t("Si ChatGPT, Gemini y Claude te recomiendan.", "Whether ChatGPT, Gemini and Claude recommend you."),
      href: `${seoUrl}#ia`,
      nums:
        seo.ai.now !== null
          ? [
              { value: `${Math.round(seo.ai.now)}%`, label: t("de las respuestas te nombran", "of answers name you") },
              ...(market?.ai ? [{ value: pctText(market.ai.you), label: t("de los negocios que nombran", "of the businesses they name") }] : []),
            ]
          : [],
      empty: t("Pregúntales a las IAs por tu servicio y mira si te nombran.", "Ask the AIs about your service and see if they name you."),
      at: seo.ai.at,
      button: { label: seo.ai.now !== null ? t("Ver qué dicen", "See what they say") : t("Preguntar a las IAs", "Ask the AIs"), href: `${seoUrl}#ia` },
    },
    {
      key: "comp",
      cls: s.comp,
      icon: "comp",
      name: t("Competencia y tráfico", "Competitors and traffic"),
      purpose: t("Quién te gana en Google y cuántas visitas tiene.", "Who beats you on Google and how many visits they get."),
      href: `${seoUrl}#competencia`,
      nums: [
        ...(market?.organic ? [{ value: pctText(market.organic.you), label: t("de los clics de tus búsquedas", "of the clicks on your searches") }] : []),
        ...(compCount ? [{ value: compCount, label: t("competidores encontrados", "competitors found") }] : []),
        ...(ownTraffic !== null && !market?.organic ? [{ value: compact(ownTraffic, lang), label: t("visitas al mes desde Google", "monthly visits from Google") }] : []),
      ].slice(0, 2),
      extra: leader ? t(`El que más se lleva: ${shortDomain(leader)}`, `Biggest share: ${shortDomain(leader)}`) : undefined,
      empty: t("Descubre quién sale antes que tú en Google.", "Find out who shows up before you on Google."),
      at: seo.competitors?.at ?? seo.traffic?.at ?? null,
      button: { label: t("Ver competencia", "See competitors"), href: `${seoUrl}?tab=competencia#competencia` },
    },
    {
      key: "content",
      cls: s.content,
      icon: "content",
      name: t("Contenido", "Content"),
      purpose: t("Artículos para tu página que Google quiere mostrar.", "Articles for your website that Google wants to show."),
      href: `${seoUrl}/escribir`,
      nums: [
        ...(seo.articles.count ? [{ value: seo.articles.count, label: seo.articles.count === 1 ? t("artículo escrito", "article written") : t("artículos escritos", "articles written") }] : []),
        ...(seo.audit.now !== null ? [{ value: <>{seo.audit.now}<small>/100</small></>, label: t("salud de tu página", "website health") }] : []),
      ],
      empty: t("La IA escribe un artículo que compite con los primeros de Google.", "The AI writes an article that competes with Google's top results."),
      at: seo.articles.at ?? seo.audit.at,
      button: { label: t("Escribir artículo", "Write article"), href: `${seoUrl}/escribir` },
    },
    {
      key: "social",
      cls: s.social,
      icon: "social",
      name: t("Redes sociales", "Social media"),
      purpose: t("Publica en todas tus redes desde un solo lugar.", "Post to all your networks from one place."),
      href: `${base}/publicar`,
      nums: [
        { value: <>{social.connected}<small> / {CHANNELS.length}</small></>, label: t("canales conectados", "channels connected") },
        { value: social.thisWeek, label: t("publicadas esta semana", "posted this week") },
      ],
      at: social.recent[0]?.createdAt ?? null,
      whenLabel: { es: "Última publicación", en: "Last post", none: { es: "Todavía no publicas", en: "No posts yet" } },
      button: { label: t("Publicar ahora", "Post now"), href: `${base}/publicar`, primary: true },
    },
    {
      key: "reports",
      cls: s.reports,
      icon: "reports",
      name: t("Reportes", "Reports"),
      purpose: t("Tu reporte del mes en PDF y los avisos por email.", "Your monthly PDF report and email alerts."),
      href: `${seoUrl}#reporte`,
      nums: [
        { value: seo.report.monthly ? t("Sí", "On") : t("No", "Off"), label: t("reporte cada mes por email", "monthly report by email") },
        { value: seo.report.weekly ? t("Sí", "On") : t("No", "Off"), label: t("resumen cada lunes", "Monday summary") },
      ],
      at: seo.report.monthlyAt ?? seo.report.weeklyAt,
      whenLabel: { es: "Último envío", en: "Last sent", none: { es: "Todavía no se envía ninguno", en: "None sent yet" } },
      button: { label: t("Descargar PDF", "Download PDF"), href: `${seoUrl}/reporte?periodo=este-mes&lang=${lang}`, download: true },
    },
    {
      key: "ads",
      cls: s.ads,
      icon: "ads",
      name: t("Anuncios", "Ads"),
      purpose: t("Campañas en Google y Facebook con tu presupuesto.", "Google and Facebook campaigns on your budget."),
      href: `${base}/estudio`,
      nums: [],
      empty: seo.studyAt
        ? t("Muy pronto. Tu estudio ya sugiere a quién anunciar y con qué palabras.", "Coming soon. Your study already suggests who to target and which keywords.")
        : t("Muy pronto. Mientras tanto, el estudio de tu negocio te dice a quién anunciar.", "Coming soon. Meanwhile, your business study tells you who to target."),
      soon: true,
      button: seo.studyAt ? { label: t("Ver el estudio", "See the study"), href: `${base}/estudio` } : undefined,
    },
  ];

  return (
    <div className={s.kits}>
      {kits.map((k) => (
        <section key={k.key} className={`${s.kit} ${k.cls} ${k.soon ? s.soon : ""}`} aria-labelledby={`kit-${k.key}`}>
          <div className={s.kitHead}>
            <span className={s.kitIcon}>
              <DashIcon name={k.icon} />
            </span>
            <h3 className={s.kitName} id={`kit-${k.key}`}>
              {k.soon ? k.name : <Link href={k.href} className={s.kitLink}>{k.name}</Link>}
            </h3>
            {k.soon && <span className="pill">{t("Pronto", "Soon")}</span>}
          </div>
          <p className={s.kitPurpose}>{k.purpose}</p>
          {k.nums.length ? (
            <div className={s.kitNums}>
              {k.nums.map((x) => (
                <div key={x.label} className={s.kitNum}>
                  <span className={s.kitNumValue}>{x.value}</span>
                  <span className={s.kitNumLabel}>{x.label}</span>
                </div>
              ))}
            </div>
          ) : (
            k.empty && <p className={s.kitEmpty}>{k.empty}</p>
          )}
          {k.nums.length > 0 && k.extra && <p className={s.kitPurpose}>{k.extra}</p>}
          <div className={s.kitFoot}>
            <span className={s.kitWhen}>
              {k.soon
                ? ""
                : k.at
                  ? `${k.whenLabel ? (lang === "en" ? k.whenLabel.en : k.whenLabel.es) : t("Revisado", "Checked")}: ${when(k.at, lang)}`
                  : k.whenLabel
                    ? lang === "en" ? k.whenLabel.none.en : k.whenLabel.none.es
                    : t("Sin revisar todavía", "Not checked yet")}
            </span>
            {k.button &&
              (k.button.download ? (
                // Descarga directa (no es una página): <a> normal.
                <a href={k.button.href} className={`btn ${s.kitBtn}`} download>
                  {k.button.label}
                </a>
              ) : (
                <Link href={k.button.href} className={`btn ${k.button.primary ? "on" : ""} ${s.kitBtn}`}>
                  {k.button.label}
                </Link>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export async function ToolkitGridSkeleton() {
  return (
    <div className={s.kits} aria-busy="true">
      {Array.from({ length: 8 }, (_, i) => (
        <span key={i} className={`${s.skel} ${s.skelKit}`} />
      ))}
    </div>
  );
}
