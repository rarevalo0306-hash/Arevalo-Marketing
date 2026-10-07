import Link from "next/link";
import { deleteStudy, generateStudy, prefillStudy, restoreStudy, saveStudyProfile, studyInterview } from "@/app/actions-study";
import { PageHead } from "@/components/PageHead";
import { StudyForm } from "@/components/StudyForm";
import { aiEnabled, researchProvider, TEXT_PROVIDERS } from "@/lib/ai";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { readZones, zoneLabel } from "@/lib/seo/dataforseo";
import { readKeywordsReport, reportLookup, volumeFormat, zoneTotal, zoneVolumes } from "@/lib/seo/keywords";
import { latestReports } from "@/lib/seo/reports";
import { latestByZone } from "@/lib/seo/zones";
import { audiencesByPriority, campaignIdea, EMPTY_INPUT, keywordScore, readDeleted, readInput, readStudy, type Study } from "@/lib/study-shape";
import { BUSINESS_TZ } from "@/lib/time";
import k from "./estudio.module.css";

// La IA investiga en internet y luego escribe el estudio: puede tardar.
export const maxDuration = 300;

// En palabras simples. [estilo de la etiqueta, español, inglés]. Verde = bueno para ti, amarillo = regular, rojo = difícil, gris = poca gente.
type Kw = Study["keywords"][number];
const INTENT: Record<Kw["intent"], [string, string, string]> = {
  local: ["done", "Busca un negocio cerca", "Looking for one nearby"],
  comercial: ["done", "Listo para contratar", "Ready to hire"],
  informativa: ["draft", "Quiere aprender", "Wants to learn"],
};
const VOLUME: Record<Kw["volume"], [string, string, string]> = {
  alto: ["done", "Mucha gente", "Lots of people"],
  medio: ["partial", "Algo de gente", "Some people"],
  bajo: ["", "Poca gente", "Few people"],
};
const DIFFICULTY: Record<Kw["difficulty"], [string, string, string]> = {
  baja: ["done", "Fácil salir primero", "Easy to rank"],
  media: ["partial", "Se puede con constancia", "Doable with effort"],
  alta: ["failed", "Difícil: mucha competencia", "Hard: lots of competition"],
};
const PRIORITY: Record<string, [string, string, string]> = {
  alta: ["done", "Prioridad alta", "High priority"],
  media: ["partial", "Prioridad media", "Medium priority"],
  baja: ["", "Prioridad baja", "Low priority"],
};

export default async function EstudioPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ leer?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const b = await db.business.findUniqueOrThrow({ where: { id } });
  const { lang, t } = await getT();
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeZone: BUSINESS_TZ });
  const pick = ([, es, en]: [string, string, string]) => t(es, en);
  const study = readStudy(b.study);
  const saved = readInput(b.studyInput);
  const input = saved ?? EMPTY_INPUT;
  const deleted = study ? null : readDeleted(b.study);
  // La IA lee la web sola cuando el negocio es nuevo o todavía no hay respuestas guardadas.
  const autoRead = q.leer === "1" || (!saved && !study && !deleted && !!(b.website.trim() || b.aiProfile.trim()));
  const researcher = researchProvider(b.aiText);
  const create = (idea: string) => `/b/${id}/publicar?${new URLSearchParams({ idea: idea.slice(0, 2000), magic: "1" })}`;
  // Volúmenes reales de Google Ads (DataForSEO), si ya se trajeron en SEO y visibilidad.
  // Un reporte por zona: se muestra el de la zona principal y, si hay más zonas con datos, el total en el título.
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const kwReports = study ? (await latestReports(id, "keywords", 20)).map((r) => readKeywordsReport(r.data)) : [];
  const byZone = latestByZone(kwReports, zones);
  const kwReport = (zones[0] && byZone.get(zones[0].code)) || [...byZone.values()][0] || (zones.length ? null : (kwReports.find(Boolean) ?? null));
  const realVolume = reportLookup(kwReport);
  const volume = volumeFormat(lang);
  const hasReal = study ? study.keywords.some((k) => realVolume.get(k.keyword.trim().toLowerCase())?.volume != null) : false;
  const keywords = study ? [...study.keywords].sort((a, b) => keywordScore(b) - keywordScore(a)) : [];
  const form = (has: boolean) => (
    <StudyForm
      generate={generateStudy.bind(null, id)}
      interview={studyInterview.bind(null, id)}
      prefill={prefillStudy.bind(null, id)}
      input={input}
      researcher={researcher && TEXT_PROVIDERS.find((p) => p.id === researcher)!.name}
      has={has}
      website={b.website.trim()}
      hasProfile={!!b.aiProfile.trim()}
      autoRead={!has && autoRead}
      settingsHref={`/b/${id}/negocio`}
    />
  );

  return (
    <>
      <PageHead
        business={b}
        prefix={t("Estudio de", "Study of")}
        title={t("Estudio del negocio", "Business study")}
        subtitle={t(
          "La IA estudia tu negocio y tu mercado local: a quién venderle, qué busca la gente en Google y qué anunciar. Todo lo que escribe y diseña después (textos, fotos, videos y campañas) sale de aquí.",
          "The AI studies your business and your local market: who to sell to, what people search for on Google and what to advertise. Everything it writes and designs afterwards (posts, photos, videos and campaigns) comes from here.",
        )}
      />
      {!aiEnabled() ? (
        <div className="card empty">{t("Falta la clave de la IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en Vercel.", "The AI key (GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY) is missing in Vercel.")}</div>
      ) : (
        <div className="stack" style={{ gap: 22 }}>
          {deleted && (
            <form action={restoreStudy.bind(null, id)} className={`card ${k.restore}`}>
              <span className="stack" style={{ gap: 2 }}>
                <strong>{t("Borraste tu estudio", "You deleted your study")}{deleted.studyAt ? ` ${t("del", "from")} ${fmt.format(new Date(deleted.studyAt))}` : ""}</strong>
                <span className="small muted">{t("¿Fue sin querer? Puedes recuperarlo con tus respuestas, tal como estaba.", "Was it a mistake? You can get it back with your answers, just as it was.")}</span>
              </span>
              <button type="submit" className="btn on">{t("Recuperar mi estudio", "Restore my study")}</button>
            </form>
          )}
          {study ? (
            <details className="card" style={{ gap: 0 }}>
              <summary className="row between" style={{ cursor: "pointer" }}>
                <span className="stack" style={{ gap: 2 }}>
                  <strong>{t("Estudio del", "Study from")} {b.studyAt ? fmt.format(b.studyAt) : "—"}</strong>
                  <span className="small muted">
                    {study.researched
                      ? t(`Con investigación en internet (${study.sources.length} fuentes)`, `With web research (${study.sources.length} sources)`)
                      : t("Sin investigación en internet", "No web research")}
                    . {t("Tócalo para revisar tus datos y actualizarlo.", "Tap it to check your details and update it.")}
                  </span>
                </span>
                <span className="btn">{t("Actualizar", "Update")}</span>
              </summary>
              <div style={{ marginTop: 18 }}>{form(true)}</div>
            </details>
          ) : (
            form(false)
          )}

          {study && (
            <>
              <div className="grid-2">
                <section className="card">
                  <h2>{t("Lo que entendió la IA", "What the AI understood")}</h2>
                  <p>{study.summary}</p>
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">{t("Qué anunciar", "What to advertise")}</span>
                    <ul className="study-list">
                      {study.services.map((s, i) => <li key={i}><strong>{s.name}.</strong> {s.description}</li>)}
                    </ul>
                  </div>
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">{t("Por qué elegirte", "Why choose you")}</span>
                    <ul className="study-list">{study.differentiators.map((d, i) => <li key={i}>{d}</li>)}</ul>
                  </div>
                </section>
                <form action={saveStudyProfile.bind(null, id)} className="card">
                  <h2>{t("Perfil del negocio para la IA", "Business profile for the AI")}</h2>
                  <p className="small muted">
                    {t(
                      "Esto es lo único que la IA dirá de tu negocio como un hecho. Revisa que todo sea cierto, corrige lo que haga falta y guárdalo.",
                      "This is the only thing the AI will state about your business as fact. Check that everything is true, fix what's needed and save it.",
                    )}
                    {b.aiProfile.trim() ? t(" Reemplaza el perfil que tienes en Ajustes.", " It replaces the profile you have in Settings.") : ""}
                  </p>
                  <textarea name="aiProfile" className="field" style={{ minHeight: 220 }} maxLength={4000} defaultValue={b.aiProfile.trim() === study.suggestedProfile.trim() ? b.aiProfile : study.suggestedProfile} aria-label={t("Perfil del negocio", "Business profile")} />
                  <div className="row">
                    <button type="submit" className="btn on">{b.aiProfile.trim() === study.suggestedProfile.trim() ? t("Guardado ✓ (guardar cambios)", "Saved ✓ (save changes)") : t("Usar este perfil", "Use this profile")}</button>
                  </div>
                </form>
              </div>

              <section className="card">
                <div className="stack" style={{ gap: 4 }}>
                  <h2>{t("Tus clientes ideales", "Your ideal customers")}</h2>
                  <p className="small muted">{t("Del más importante al menos importante. La IA les habla a ellos en tus publicaciones y anuncios.", "From most to least important. The AI speaks to them in your posts and ads.")}</p>
                </div>
                <div className="cards">
                  {audiencesByPriority(study).map((a, i) => (
                    <div key={i} className="study-tile">
                      <span className="row" style={{ gap: 8 }}>
                        <span className={k.rank}>{i + 1}</span>
                        {a.priority && <span className={`pill ${PRIORITY[a.priority][0]}`}>{pick(PRIORITY[a.priority])}</span>}
                      </span>
                      <strong>{a.name}</strong>
                      <span className="small">{a.description}</span>
                      <ul className="study-list small">{a.pains.map((p, i) => <li key={i}>{p}</li>)}</ul>
                      <span className="small muted">{t("Dónde encontrarlos:", "Where to find them:")} {a.channels}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card">
                <h2>{t("Mercado local", "Local market")}</h2>
                <p>{study.market.area}</p>
                <div className="tags">{study.market.places.map((p, i) => <span key={i} className="tag">{p}</span>)}</div>
                <div className="grid-2" style={{ gap: 18 }}>
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">{t("Temporadas", "Seasons")}</span>
                    <ul className="study-list">{study.market.seasonality.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">{t("Oportunidades", "Opportunities")}</span>
                    <ul className="study-list">{study.market.opportunities.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                </div>
                {study.market.competitors.length > 0 && (
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">{t("Competencia", "Competitors")}</span>
                    <ul className="study-list">{study.market.competitors.map((c, i) => <li key={i}><strong>{c.name}:</strong> {c.note}</li>)}</ul>
                  </div>
                )}
              </section>

              <section className="card">
                <div className="stack" style={{ gap: 4 }}>
                  <h2>{t("Lo que la gente busca en Google", "What people search for on Google")}</h2>
                  <p className="small muted">
                    {t(
                      "Estas son las búsquedas que te pueden traer clientes, las mejores primero. Toca «Publicar sobre esto» y la IA escribe una publicación pensada para esa búsqueda.",
                      "These are the searches that can bring you customers, best ones first. Tap “Post about this” and the AI writes a post made for that search.",
                    )}
                  </p>
                </div>
                <details className={k.legend}>
                  <summary>{t("¿Qué significan las etiquetas y los colores?", "What do the labels and colors mean?")}</summary>
                  <dl>
                    <div>
                      <dt>{t("Qué quiere la persona", "What the person wants")}</dt>
                      <dd>
                        <span className={`pill ${INTENT.local[0]}`}>{pick(INTENT.local)}</span>{" "}
                        {t("busca un negocio como el tuyo en su zona.", "is looking for a business like yours in their area.")}{" "}
                        <span className={`pill ${INTENT.comercial[0]}`}>{pick(INTENT.comercial)}</span>{" "}
                        {t("ya quiere pagar o contratar.", "already wants to pay or hire.")}{" "}
                        <span className={`pill ${INTENT.informativa[0]}`}>{pick(INTENT.informativa)}</span>{" "}
                        {t("tiene una duda; es bueno para artículos que dan confianza.", "has a question; good for articles that build trust.")}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Cuánta gente lo busca", "How many people search it")}</dt>
                      <dd>{t("Mucha, algo o poca gente en tu zona cada mes. Es un cálculo de la IA; si dice «real», el número viene de Google.", "Lots, some or few people in your area each month. It's the AI's estimate; if it says “real”, the number comes from Google.")}</dd>
                    </div>
                    <div>
                      <dt>{t("Qué tan difícil es salir primero", "How hard it is to show up first")}</dt>
                      <dd>{t("Cuántos negocios compiten por esa búsqueda. Las fáciles son las que más rápido te traen clientes.", "How many businesses compete for that search. The easy ones bring you customers fastest.")}</dd>
                    </div>
                    <div>
                      <dt>{t("Colores", "Colors")}</dt>
                      <dd className={k.colors}>
                        <span className="pill done">{t("Verde: bueno para ti", "Green: good for you")}</span>
                        <span className="pill partial">{t("Amarillo: regular", "Yellow: so-so")}</span>
                        <span className="pill failed">{t("Rojo: difícil", "Red: hard")}</span>
                        <span className="pill">{t("Gris: poca gente", "Gray: few people")}</span>
                      </dd>
                    </div>
                  </dl>
                </details>
                <ol className={k.kwList}>
                  {keywords.map((kw, i) => {
                    const real = realVolume.get(kw.keyword.trim().toLowerCase())?.volume;
                    const perZone = byZone.size > 1 ? zoneVolumes(kw.keyword, zones, byZone) : [];
                    const total = perZone.filter((v) => typeof v === "number").length > 1 ? zoneTotal(perZone) : null;
                    return (
                      <li key={i} className={k.kw}>
                        <div className={k.kwMain}>
                          <span className={k.kwTop}>
                            <strong className={k.kwText}>{kw.keyword}</strong>
                            <span className={k.kwLang}>{kw.lang === "en" ? t("inglés", "English") : t("español", "Spanish")}</span>
                            {i < 3 && <span className={k.best}>★ {t("Recomendada", "Recommended")}</span>}
                          </span>
                          <span className={k.facts}>
                            <span className={`pill ${INTENT[kw.intent][0]}`} title={t("Qué quiere la persona", "What the person wants")}>{pick(INTENT[kw.intent])}</span>
                            <span className={`pill ${VOLUME[kw.volume][0]}`} title={t("Cuánta gente lo busca", "How many people search it")}>{pick(VOLUME[kw.volume])}</span>
                            {real != null && (
                              <span
                                className="small kw-real"
                                style={{ whiteSpace: "nowrap" }}
                                title={
                                  t("Búsquedas reales al mes según Google Ads", "Real monthly searches from Google Ads") +
                                  (kwReport?.location ? ` (${zoneLabel(kwReport.location)})` : "") +
                                  (total !== null
                                    ? `. ${t("Total en tus zonas", "Total in your areas")}: ${volume.format(total)} (${zones
                                        .map((z, i) => (typeof perZone[i] === "number" ? `${zoneLabel(z.name)}: ${volume.format(perZone[i] as number)}` : ""))
                                        .filter(Boolean)
                                        .join(" · ")})`
                                    : "")
                                }
                              >
                                {volume.format(real)}
                                {t("/mes", "/mo")} <span className="tag">{t("real", "real")}</span>
                                {total !== null && <span className="muted"> · Σ {volume.format(total)}</span>}
                              </span>
                            )}
                            <span className={`pill ${DIFFICULTY[kw.difficulty][0]}`} title={t("Qué tan difícil es salir primero", "How hard it is to show up first")}>{pick(DIFFICULTY[kw.difficulty])}</span>
                          </span>
                          <span className="small">
                            <span className="muted">{t("Idea:", "Idea:")}</span> {kw.idea}
                          </span>
                        </div>
                        <Link href={create(`${kw.idea}\n${t("Palabra clave", "Keyword")}: ${kw.keyword}`)} className={`btn ${i < 3 ? "ai" : "outline"} ${k.kwBtn}`}>
                          {i < 3 ? "✦ " : ""}
                          {t("Publicar sobre esto", "Post about this")} →
                        </Link>
                      </li>
                    );
                  })}
                </ol>
                {hasReal && kwReport && (
                  <p className="small muted">
                    {t(
                      `Los números marcados "real" vienen de Google Ads (DataForSEO) para ${zoneLabel(kwReport.location) || "tu zona"}. Los demás son cálculos de la IA.`,
                      `Numbers marked "real" come from Google Ads (DataForSEO) for ${zoneLabel(kwReport.location) || "your area"}. The rest are AI estimates.`,
                    )}
                    {byZone.size > 1 &&
                      t(
                        ` «Σ» es el total en tus ${byZone.size} zonas con datos (pasa el cursor para ver cada una).`,
                        ` “Σ” is the total across your ${byZone.size} areas with data (hover to see each one).`,
                      )}
                  </p>
                )}
              </section>

              <section className="card">
                <h2>{t("Ideas de campaña", "Campaign ideas")}</h2>
                <p className="small muted">
                  {t(
                    "Listas para usar. Crear con IA escribe el texto para cada red y hace la foto con tu marca; desde ahí también puedes convertir la foto en video.",
                    "Ready to use. Create with AI writes the text for each network and makes the photo with your brand; from there you can also turn the photo into a video.",
                  )}
                </p>
                <div className="cards">
                  {study.campaigns.map((c, i) => (
                    <article key={i} className="study-tile">
                      <strong>{c.title}</strong>
                      <span className="small muted">{t("Para:", "For:")} {c.audience}</span>
                      <span className="study-hook">“{c.hook}”</span>
                      <span className="small">{c.message}</span>
                      <span className="small"><strong>Video:</strong> {c.video}</span>
                      <div style={{ marginTop: "auto" }}><Link href={create(campaignIdea(c, lang))} className="btn ai">✦ {t("Crear con IA", "Create with AI")}</Link></div>
                    </article>
                  ))}
                </div>
              </section>

              <div className="grid-2">
                <section className="card">
                  <h2>{t("Pilares de contenido", "Content pillars")}</h2>
                  <p className="small muted">{t("De qué hablar y cuánto. El plan semanal con IA los sigue.", "What to talk about and how much. The AI weekly plan follows them.")}</p>
                  {study.pillars.map((p, i) => (
                    <div key={i} className="stack" style={{ gap: 4 }}>
                      <div className="row between"><strong>{p.name}</strong><span className="small muted">{Math.round(p.share)}%</span></div>
                      <span className="meter"><span style={{ width: `${Math.min(100, Math.max(0, p.share))}%` }} /></span>
                      <span className="small muted">{p.description}</span>
                    </div>
                  ))}
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">{t("Estilo de fotos y videos", "Photo and video style")}</span>
                    <p className="small">{study.visualStyle}</p>
                  </div>
                </section>
                <section className="card">
                  <h2>{t("Anuncios pagados", "Paid ads")}</h2>
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">{t("Público para Facebook e Instagram", "Facebook and Instagram audience")}</span>
                    <p className="small">{study.ads.metaAudience}</p>
                  </div>
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">{t("Palabras clave para Google Ads", "Google Ads keywords")}</span>
                    <div className="tags">{study.ads.googleKeywords.map((k, i) => <span key={i} className="tag">{k}</span>)}</div>
                  </div>
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">{t("Palabras negativas (para no pagar clics inútiles)", "Negative keywords (so you don't pay for useless clicks)")}</span>
                    <div className="tags">{study.ads.negativeKeywords.map((k, i) => <span key={i} className="tag neg">−{k}</span>)}</div>
                  </div>
                  <p className="small muted">{study.ads.budgetTip}</p>
                </section>
              </div>

              <div className="grid-2">
                <section className="card">
                  <h2>{t("Dudas de tus clientes", "Your customers' doubts")}</h2>
                  {study.objections.map((o, i) => (
                    <div key={i} className="stack" style={{ gap: 2 }}>
                      <strong>{o.objection}</strong>
                      <span className="small muted">{o.answer}</span>
                    </div>
                  ))}
                </section>
                <section className="card">
                  <h2>{t("Lo que la IA nunca dirá", "What the AI will never say")}</h2>
                  <ul className="study-list">{study.avoid.map((a, i) => <li key={i}>{a}</li>)}</ul>
                  <p className="note">{study.caveats}</p>
                  {study.sources.length > 0 && (
                    <details>
                      <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>{t("Fuentes que consultó la IA", "Sources the AI checked")} ({study.sources.length})</summary>
                      <ul className="study-list small" style={{ marginTop: 8 }}>
                        {study.sources.map((s, i) => <li key={i}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a></li>)}
                      </ul>
                    </details>
                  )}
                </section>
              </div>

              <details className="card" style={{ gap: 0 }}>
                <summary className="row between" style={{ cursor: "pointer" }}>
                  <span className="stack" style={{ gap: 2 }}>
                    <strong>{t("Borrar estudio", "Delete study")}</strong>
                    <span className="small muted">{t("Para empezar de cero. Si lo borras sin querer, lo puedes recuperar.", "To start over. If you delete it by mistake, you can get it back.")}</span>
                  </span>
                  <span className="btn danger">{t("Borrar", "Delete")}</span>
                </summary>
                <form action={deleteStudy.bind(null, id)} className="stack" style={{ gap: 12, marginTop: 16 }}>
                  <p className="small">
                    {t(
                      "Se borran el estudio y tus respuestas. La IA deja de usarlo en lo que escribe hasta que hagas uno nuevo o lo recuperes (queda una copia hasta que hagas otro estudio).",
                      "The study and your answers are deleted. The AI stops using it in what it writes until you make a new one or restore it (a copy is kept until you make another study).",
                    )}{" "}
                    {t("El perfil del negocio que guardaste en", "The business profile you saved in")} <Link href={`/b/${id}/negocio`}>{t("Ajustes", "Settings")}</Link>{" "}
                    {t("no se borra.", "is not deleted.")}
                  </p>
                  <div><button type="submit" className="btn danger">{t("Sí, borrar el estudio", "Yes, delete the study")}</button></div>
                </form>
              </details>
            </>
          )}
        </div>
      )}
    </>
  );
}
