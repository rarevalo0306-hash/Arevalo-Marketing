import Link from "next/link";
import { refreshProfile, refreshReviews } from "@/app/actions-seo-gbp";
import { AiPromptButton } from "@/components/seo/AiPromptButton";
import { GbpRefreshButton } from "@/components/seo/GbpRefreshButton";
import { Fold } from "@/components/seo/Fold";
import { HowToRead } from "@/components/seo/HowToRead";
import { GbpReviews, Stars } from "@/components/seo/GbpReviews";
import { MapPlacePicker } from "@/components/seo/MapPlacePicker";
import { ScoreVerdict } from "@/components/seo/ScoreVerdict";
import { aiEnabled } from "@/lib/ai";
import { db } from "@/lib/db";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { dataForSeoEnabled, readZones, zoneLabel } from "@/lib/seo/dataforseo";
import {
  competitorTargets,
  type GbpCheck,
  type GbpPriority,
  googleReplyCreds,
  mapsUrl,
  profileCostEstimate,
  readGbpReport,
  readPendingTask,
  readReviewsReport,
  type ReviewStats,
  reviewsCostEstimate,
} from "@/lib/seo/gbp";
import { MAP_COST_PER_POINT, readMapPlace, readMapReport } from "@/lib/seo/maprank";
import { loadPromptContext } from "@/lib/seo/prompt-context";
import { gbpChecklist } from "@/lib/seo/prompts";
import { latestReports } from "@/lib/seo/reports";
import { BUSINESS_TZ } from "@/lib/time";

/** Reseñas por mes (últimos 12): barritas en SVG. */
function MonthsChart({ months, label }: { months: ReviewStats["months"]; label: (m: string) => string }) {
  const max = Math.max(1, ...months.map((m) => m.count));
  const w = 12;
  const gap = 4;
  const h = 44;
  return (
    <svg className="gbp-spark" viewBox={`0 0 ${months.length * (w + gap) - gap} ${h}`} preserveAspectRatio="none" role="img" aria-label={months.map((m) => `${label(m.month)}: ${m.count}`).join(", ")}>
      {months.map((m, i) => {
        const bh = m.count ? Math.max(3, (m.count / max) * h) : 1.5;
        return (
          <rect key={m.month} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={2} className={i === months.length - 1 ? "last" : undefined}>
            <title>{`${label(m.month)}: ${m.count}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/** "Tu Perfil de Google": salud del perfil de Google Maps, comparación con la competencia, reseñas y respuestas con IA. */
export async function GbpPanel({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  const header = (
    <div className="stack" style={{ gap: 4 }}>
      <h2>{t("Tu Perfil de Google", "Your Google Business Profile")}</h2>
      <p className="small muted">
        {t(
          "Tu ficha en Google Maps: lo que ve la gente cuando busca tu negocio. Aquí ves qué le falta, cómo estás frente a tu competencia y tus reseñas (la IA te escribe las respuestas).",
          "Your listing on Google Maps: what people see when they look up your business. Here you see what it's missing, how you compare with your competition, and your reviews (the AI drafts the replies).",
        )}
      </p>
    </div>
  );

  if (!dataForSeoEnabled()) {
    return (
      <section className="card" id="perfil">
        {header}
        <p className="note">
          {t(
            "Para revisar tu perfil y tus reseñas necesitas conectar DataForSEO (DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD en Vercel).",
            "To check your profile and reviews you need to connect DataForSEO (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Vercel).",
          )}
        </p>
      </section>
    );
  }

  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true, seoMapPlace: true, seoLocations: true, seoLocationCode: true, seoLocationName: true },
  });
  if (!b) return null;
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const place = readMapPlace(b.seoMapPlace);

  if (!place) {
    return (
      <section className="card" id="perfil">
        {header}
        {zones.length ? (
          <>
            <MapPlacePicker
              businessId={businessId}
              current={null}
              defaultQuery={b.name}
              zoneName={zoneLabel(zones[0].name) || t("tu zona principal", "your main area")}
              perSearch={MAP_COST_PER_POINT}
            />
            <p className="small muted">
              {t("Es el mismo negocio que usa el ", "It's the same business used by the ")}
              <a href="#mapa">{t("mapa de calor", "heatmap")}</a>
              {t(": lo eliges una sola vez.", ": you only pick it once.")}
            </p>
          </>
        ) : (
          <p className="note">
            {t(
              "Primero elige la zona donde buscan tus clientes en la pestaña «⚙ Ajustes» y luego tu negocio en el ",
              "First pick the area where your customers search in the “⚙ Settings” tab and then your business in the ",
            )}
            <a href="#mapa">{t("mapa de calor", "heatmap")}</a>.
          </p>
        )}
      </section>
    );
  }

  const [[gbpRow], [reviewsRow], [mapRow], [taskRow], creds] = await Promise.all([
    latestReports(businessId, "gbp", 1),
    latestReports(businessId, "reviews", 1),
    latestReports(businessId, "maprank", 1),
    latestReports(businessId, "reviews-task", 1),
    googleReplyCreds(businessId),
  ]);
  const reviews = reviewsRow ? readReviewsReport(reviewsRow.data) : null;
  const gbp = gbpRow ? readGbpReport(gbpRow.data, reviews?.stats ?? null) : null;
  const pending = taskRow ? readPendingTask(taskRow.data) : null;
  const nComps = competitorTargets(mapRow ? readMapReport(mapRow.data) : null, place.cid).length;
  const link = mapsUrl(gbp?.profile.cid || place.cid);

  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeStyle: "short", timeZone: BUSINESS_TZ });
  const int = new Intl.NumberFormat(intlLocale(lang));
  const one = new Intl.NumberFormat(intlLocale(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const money = new Intl.NumberFormat(intlLocale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 4 });
  const monthLabel = (m: string) =>
    new Intl.DateTimeFormat(intlLocale(lang), { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${m}-15T12:00:00Z`));
  const yesNo = (v: boolean) => (v ? t("Sí", "Yes") : t("No", "No"));

  const profileButton = (
    <GbpRefreshButton
      action={refreshProfile.bind(null, businessId)}
      kind="profile"
      label={gbp ? t("Actualizar perfil", "Update profile") : t("Revisar mi perfil", "Check my profile")}
      estimate={profileCostEstimate(nComps)}
      competitors={nComps}
      primary={!gbp}
    />
  );
  const reviewsButton = (
    <GbpRefreshButton
      action={refreshReviews.bind(null, businessId)}
      kind="reviews"
      label={reviews ? t("Actualizar reseñas", "Update reviews") : t("Traer mis reseñas", "Get my reviews")}
      estimate={pending ? 0 : reviewsCostEstimate()}
      primary={!reviews}
    />
  );

  const PRIORITY: [GbpPriority, string][] = [
    ["high", t("Importante", "Important")],
    ["medium", t("Conviene", "Worth doing")],
    ["low", t("Detalles", "Details")],
  ];
  const missing = gbp?.checklist.filter((c) => !c.ok) ?? [];
  const done = gbp?.checklist.filter((c) => c.ok) ?? [];
  const checkText = (c: GbpCheck) => (lang === "en" ? c.en : c.es);
  const p = gbp?.profile;
  const s = reviews?.stats;
  const distMax = s ? Math.max(1, ...s.distribution) : 1;
  const ctx = missing.length || s?.unanswered ? await loadPromptContext(businessId) : null;

  return (
    <section className="card" id="perfil">
      {header}
      <HowToRead title={t("Cómo leer esto", "How to read this")}>
        <ul>
          <li>{t("Tu Perfil de Google es la ficha que sale en el mapa. Es lo que más pesa para salir entre los 3 negocios que Google muestra con mapa arriba de todo; tu página web pesa menos ahí.", "Your Google profile is the listing shown on the map. It's what matters most to show up among the 3 businesses Google shows with a map at the top; your website matters less there.")}</li>
          <li>{t("La nota de 0 a 100 mide qué tan completo está (reclamado, categoría, horario, teléfono, página, fotos, estrellas y si contestas las reseñas): 90 o más es excelente, de 70 a 89 está bien, de 50 a 69 es regular y menos de 50 es urgente.", "The 0-100 score measures how complete it is (claimed, category, hours, phone, website, photos, stars and whether you reply to reviews): 90 or more is excellent, 70 to 89 is good, 50 to 69 is fair and under 50 is urgent.")}</li>
          <li>{t("Reseñas: pide reseñas a tus clientes cada mes y contéstalas todas, también las malas. Es lo que más te ayuda a subir en el mapa.", "Reviews: ask your customers for reviews every month and reply to all of them, bad ones too. It's what helps you most to move up on the map.")}</li>
        </ul>
      </HowToRead>

      {/* ---------- El perfil ---------- */}
      {p && gbp ? (
        <>
          <div className="gbp-profile">
            <div className="stack" style={{ gap: 4, minWidth: 0, flex: "1 1 220px" }}>
              <strong className="gbp-title">{p.title}</strong>
              {p.category && <span className="small muted">{p.category}</span>}
              <span className="small">
                {p.rating !== null ? (
                  <>
                    <Stars value={p.rating} /> <strong>{one.format(p.rating)}</strong>{" "}
                    <span className="muted">({t(`${int.format(p.reviews ?? 0)} reseñas`, `${int.format(p.reviews ?? 0)} reviews`)})</span>
                  </>
                ) : (
                  <span className="muted">{t("Sin reseñas todavía", "No reviews yet")}</span>
                )}
              </span>
              {p.address && <span className="small muted gbp-wrap">{p.address}</span>}
            </div>
            <div className="stack" style={{ gap: 6, alignItems: "flex-start" }}>
              {p.isClaimed !== null && (
                <span className={p.isClaimed ? "tag gbp-ok" : "tag neg"}>{p.isClaimed ? t("Reclamado ✓", "Claimed ✓") : t("Sin reclamar", "Not claimed")}</span>
              )}
              {link && (
                <a href={link} target="_blank" rel="noopener noreferrer" className="small">
                  {t("Ver en Google Maps ↗", "View on Google Maps ↗")}
                </a>
              )}
            </div>
          </div>
          {(p.status === "temporarily_closed" || p.status === "closed_forever") && (
            <p className="note error">
              {p.status === "closed_forever"
                ? t("Google muestra tu negocio como CERRADO PERMANENTEMENTE. Si no es así, corrígelo ya en business.google.com.", "Google shows your business as PERMANENTLY CLOSED. If that's wrong, fix it now at business.google.com.")
                : t("Google muestra tu negocio como cerrado temporalmente. Si ya abriste, corrígelo en business.google.com.", "Google shows your business as temporarily closed. If you're open, fix it at business.google.com.")}
            </p>
          )}
          <dl className="gbp-facts">
            <div>
              <dt>{t("Fotos", "Photos")}</dt>
              <dd>{p.totalPhotos !== null ? int.format(p.totalPhotos) : "—"}</dd>
            </div>
            <div>
              <dt>{t("Horario", "Hours")}</dt>
              <dd>{yesNo(p.hasHours)}</dd>
            </div>
            <div>
              <dt>{t("Teléfono", "Phone")}</dt>
              <dd className="gbp-wrap">{p.phone || t("No", "No")}</dd>
            </div>
            <div>
              <dt>{t("Página web", "Website")}</dt>
              <dd className="gbp-wrap">
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noopener noreferrer">
                    {p.domain || p.url}
                  </a>
                ) : (
                  t("No", "No")
                )}
              </dd>
            </div>
          </dl>

          <div className="gbp-score-row">
            <div className="seo-score">
              {gbp.score}
              <small>/100</small>
            </div>
            <div className="stack" style={{ gap: 6, flex: "1 1 240px", minWidth: 0 }}>
              <ScoreVerdict score={gbp.score} lang={lang} />
              <p className="small muted" style={{ margin: 0 }}>
                {t(
                  "Mide qué tan completo está tu perfil. Pesa más lo que más cuenta en Google Maps: estar reclamado, la categoría, horario, teléfono, página, fotos, estrellas y contestar reseñas.",
                  "It measures how complete your profile is. What counts most on Google Maps weighs more: being claimed, category, hours, phone, website, photos, stars and replying to reviews.",
                )}
                {!reviews && t(" Trae tus reseñas (abajo) para revisar también si las contestas.", " Bring in your reviews (below) to also check whether you reply to them.")}
              </p>
            </div>
          </div>

          <div className="stack" style={{ gap: 10 }}>
            <h3>{t("Lo que te falta en tu perfil", "What your profile is missing")}</h3>
            {missing.length ? (
              PRIORITY.map(([prio, label]) => {
                const items = missing.filter((c) => c.priority === prio);
                return items.length ? (
                  <div key={prio} className="stack" style={{ gap: 6 }}>
                    <span className={`gbp-prio gbp-prio-${prio}`}>{label}</span>
                    <ul className="gbp-checks">
                      {items.map((c) => (
                        <li key={c.id} className="gbp-check">
                          <span aria-hidden="true">✗</span>
                          <span>{checkText(c)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null;
              })
            ) : (
              <p className="note ok">{t("¡Tu perfil está completo! Sigue pidiendo y contestando reseñas.", "Your profile is complete! Keep asking for and replying to reviews.")}</p>
            )}
            {done.length > 0 && (
              <details>
                <summary className="small muted">{t(`Lo que ya tienes bien (${done.length})`, `What you already have right (${done.length})`)}</summary>
                <ul className="gbp-checks" style={{ marginTop: 8 }}>
                  {done.map((c) => (
                    <li key={c.id} className="gbp-check ok">
                      <span aria-hidden="true">✓</span>
                      <span>{checkText(c)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {gbp.competitors.length > 0 ? (
            <div className="stack" style={{ gap: 8 }}>
              <h3>{t("Tú contra tu competencia en Google Maps", "You vs. your competition on Google Maps")}</h3>
              <div className="table-wrap">
                <table className="gbp-table">
                  <thead>
                    <tr>
                      <th>{t("Negocio", "Business")}</th>
                      <th className="kw-num">{t("Estrellas", "Rating")}</th>
                      <th className="kw-num">{t("Reseñas", "Reviews")}</th>
                      <th className="kw-num">{t("Fotos", "Photos")}</th>
                      <th>{t("Categorías", "Categories")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { title: p.title, cid: p.cid, rating: p.rating, reviews: p.reviews, totalPhotos: p.totalPhotos, category: p.category, additionalCategories: p.additionalCategories, you: true, error: undefined },
                      ...gbp.competitors.map((c) => ({ ...c, you: false })),
                    ].map((c) => (
                      <tr key={`${c.cid}-${c.title}`} className={c.you ? "gbp-you" : undefined}>
                        <td className="gbp-wrap">
                          {c.cid && !c.you ? (
                            <a href={mapsUrl(c.cid)} target="_blank" rel="noopener noreferrer">
                              {c.title}
                            </a>
                          ) : (
                            <strong>{c.title}</strong>
                          )}
                          {c.you && <span className="small muted"> ({t("tú", "you")})</span>}
                        </td>
                        {c.error ? (
                          <td colSpan={4} className="small muted">
                            {t("No se pudo revisar esta vez.", "Couldn't be checked this time.")}
                          </td>
                        ) : (
                          <>
                            <td className="kw-num">{c.rating !== null ? `${one.format(c.rating)} ★` : "—"}</td>
                            <td className="kw-num">{c.reviews !== null ? int.format(c.reviews) : "—"}</td>
                            <td className="kw-num">{c.totalPhotos !== null ? int.format(c.totalPhotos) : "—"}</td>
                            <td className="small gbp-cats">
                              {c.category || "—"}
                              {c.additionalCategories.length > 0 && <span className="muted"> + {c.additionalCategories.join(", ")}</span>}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="small muted">
              {t("Para compararte con tu competencia, haz primero un ", "To compare yourself with your competition, first make a ")}
              <a href="#mapa">{t("mapa de calor", "heatmap")}</a>
              {t(": usamos los negocios que más te ganan ahí.", ": we use the businesses that beat you most there.")}
            </p>
          )}
          <p className="small muted">
            {t("Última revisión:", "Last check:")} {fmt.format(new Date(gbp.createdAt))} · {t("Costo:", "Cost:")} {money.format(gbp.cost)}
          </p>
          {profileButton}
        </>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <p className="small">
            {t(
              `Revisamos el perfil de «${place.title}» en Google Maps: si está reclamado, su categoría, descripción, horario, fotos, teléfono y página.`,
              `We check the profile of “${place.title}” on Google Maps: whether it's claimed, its category, description, hours, photos, phone and website.`,
            )}
            {nComps > 0 &&
              t(
                ` También lo comparamos con ${nComps} ${nComps === 1 ? "competidor" : "competidores"} de tu mapa de calor.`,
                ` We also compare it with ${nComps} ${nComps === 1 ? "competitor" : "competitors"} from your heatmap.`,
              )}
          </p>
          {gbpRow && <p className="note">{t("Tu última revisión tiene un formato viejo. Vuelve a revisar.", "Your last check is in an old format. Check again.")}</p>}
          {profileButton}
        </div>
      )}

      {/* ---------- Las reseñas ---------- */}
      <div className="stack gbp-reviews-box" style={{ gap: 14 }}>
        <h3>{t("Tus reseñas en Google", "Your Google reviews")}</h3>
        {pending && (
          <p className="note">
            {t(
              "Google seguía juntando tus reseñas la última vez. Presiona «Actualizar reseñas» para traerlas (no se cobra otra vez).",
              "Google was still gathering your reviews last time. Press “Update reviews” to get them (no extra charge).",
            )}
          </p>
        )}
        {reviews && s ? (
          <>
            <div className="seo-tiles">
              <div className="seo-tile">
                <span className="small muted">{t("Promedio", "Average")}</span>
                <strong>{s.average !== null ? `${one.format(s.average)} ★` : "—"}</strong>
              </div>
              <div className="seo-tile">
                <span className="small muted">{t("Contestadas", "Replied")}</span>
                <strong>{s.answeredPct !== null ? `${s.answeredPct} %` : "—"}</strong>
              </div>
              <div className="seo-tile">
                <span className="small muted">{t("Sin contestar", "Unanswered")}</span>
                <strong className={s.unanswered ? "gbp-bad" : undefined}>{int.format(s.unanswered)}</strong>
              </div>
              <div className="seo-tile">
                <span className="small muted">{t("Este mes", "This month")}</span>
                <strong>{int.format(s.thisMonth)}</strong>
              </div>
            </div>
            <Fold
              summary={t("Gráficas de tus reseñas", "Your review charts")}
              note={
                s.topics.length > 0
                  ? t(`Estrellas, reseñas por mes y de qué hablan tus clientes (${s.topics.length} temas)`, `Stars, reviews per month and what your customers talk about (${s.topics.length} topics)`)
                  : t("Estrellas y reseñas por mes", "Stars and reviews per month")
              }
            >
            <div className="gbp-charts">
              <div className="stack" style={{ gap: 6 }}>
                <span className="small muted">{t("Estrellas", "Stars")}</span>
                <div className="gbp-dist">
                  {[5, 4, 3, 2, 1].map((n) => (
                    <div key={n} className="gbp-dist-row">
                      <span>{n} ★</span>
                      <span className="gbp-bar">
                        <span className={n <= 3 ? "low" : undefined} style={{ width: `${Math.round((s.distribution[n - 1] / distMax) * 100)}%` }} />
                      </span>
                      <span className="kw-num">{int.format(s.distribution[n - 1])}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="stack" style={{ gap: 6 }}>
                <span className="small muted">{t("Reseñas por mes (12 meses)", "Reviews per month (12 months)")}</span>
                <MonthsChart months={s.months} label={monthLabel} />
                <span className="small muted gbp-spark-axis">
                  <span>{monthLabel(s.months[0].month)}</span>
                  <span>{monthLabel(s.months[s.months.length - 1].month)}</span>
                </span>
              </div>
            </div>
            <p className="small muted">
              {t(
                `Números de tus ${s.count} reseñas más nuevas${reviews.total !== null ? ` (tienes ${int.format(reviews.total)} en total)` : ""}.`,
                `Numbers from your ${s.count} newest reviews${reviews.total !== null ? ` (you have ${int.format(reviews.total)} in total)` : ""}.`,
              )}
              {s.avgReplyDays !== null && t(` Tardas ${one.format(s.avgReplyDays)} días en promedio en contestar.`, ` You take ${one.format(s.avgReplyDays)} days on average to reply.`)}
            </p>
            {s.topics.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <span className="small muted">{t("De qué hablan tus clientes", "What your customers talk about")}</span>
                <div className="gbp-topics">
                  {s.topics.map((x) => (
                    <span key={x.term} className="tag">
                      {x.term} · {x.count}
                    </span>
                  ))}
                </div>
              </div>
            )}
            </Fold>
            <GbpReviews businessId={businessId} reviews={reviews.reviews} canPost={Boolean(creds)} aiReady={aiEnabled()} mapsLink={link} />
            <p className="small muted">
              {t("Últimas reseñas traídas:", "Reviews last fetched:")} {fmt.format(new Date(reviews.createdAt))} · {t("Costo:", "Cost:")} {money.format(reviews.cost)}
            </p>
            {reviewsButton}
          </>
        ) : (
          <>
            <p className="small">
              {t(
                "Traemos tus 50 reseñas más nuevas para ver cuántas te faltan contestar, y la IA te escribe las respuestas para que solo las copies y pegues en Google.",
                "We bring in your 50 newest reviews to see how many still need a reply, and the AI writes the replies so you just copy and paste them on Google.",
              )}
            </p>
            {reviewsRow && <p className="note">{t("Tus últimas reseñas tienen un formato viejo. Vuelve a traerlas.", "Your last reviews are in an old format. Fetch them again.")}</p>}
            {reviewsButton}
          </>
        )}
        {!creds && !reviews && (
          <p className="small muted">
            {t("¿Quieres responder sin copiar y pegar? Conecta tu Perfil de Negocio en ", "Want to reply without copy and paste? Connect your Business Profile in ")}
            <Link href={`/b/${businessId}/conexiones`}>{t("Conexiones", "Connections")}</Link>
            {t(" (funciona cuando Google apruebe el acceso de la app).", " (it works once Google approves the app's access).")}
          </p>
        )}
      </div>
      {ctx && (
        <AiPromptButton
          variant="owner"
          text={gbpChecklist(ctx, missing, s?.unanswered ?? 0, lang)}
          hint={t(
            "Lo que le falta a tu perfil, en orden, para ir marcando. Esto lo haces tú en business.google.com, no la IA de tu web.",
            "What your profile is missing, in order, to tick off. You do this at business.google.com, not your website's AI.",
          )}
        />
      )}
    </section>
  );
}
