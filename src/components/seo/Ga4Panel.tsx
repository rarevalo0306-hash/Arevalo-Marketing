import { Suspense } from "react";
import { autoRefreshGa4, changeGa4Property, chooseGa4Property, disconnectGa4, refreshGa4Action } from "@/app/actions-ga4";
import { Fold } from "@/components/seo/Fold";
import { Ga4AutoRefresh, Ga4ConfirmButton, Ga4Notice, Ga4RefreshButton } from "@/components/seo/Ga4PanelClient";
import { Ga4HowTo } from "@/components/seo/Ga4PanelHowTo";
import { db } from "@/lib/db";
import { latestGa4Report, readGa4Connection } from "@/lib/ga4";
import {
  compareCount,
  compareRate,
  explainGa4Error,
  hasKeyEventsSetUp,
  isLowEngagementPage,
  needsRefresh,
  orderForPicker,
  organicShare,
  type Ga4Report,
  type Trend,
} from "@/lib/ga4-shape";
import { googleEnabled, googleRedirectUri } from "@/lib/google-oauth";
import { intlLocale, type T, type UiLang } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import s from "./Ga4Panel.module.css";

function fmt(lang: UiLang) {
  const locale = intlLocale(lang);
  const n0 = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const pct0 = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  return {
    int: (v: number) => n0.format(Math.round(v)),
    pct: (v: number) => pct0.format(v),
    day: (iso: string) => {
      const d = new Date(`${iso}T00:00:00Z`);
      return Number.isNaN(d.getTime()) ? iso : date.format(d);
    },
    when: (iso: string) => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? "—" : dateTime.format(d);
    },
    /** 85 → «1:25» min; 40 → «40» s. */
    time: (sec: number): React.ReactNode => {
      const t = Math.round(sec);
      const m = Math.floor(t / 60);
      return m ? (
        <>
          {m}:{String(t % 60).padStart(2, "0")} <small>min</small>
        </>
      ) : (
        <>
          {t} <small>s</small>
        </>
      );
    },
  };
}
type Fmt = ReturnType<typeof fmt>;

/** Los nombres de GA4 (sessionDefaultChannelGroup) en palabras simples. */
function channelName(key: string, t: T): string {
  const map: Record<string, [string, string]> = {
    "Organic Search": ["Google y otros buscadores (gratis)", "Google and other search engines (free)"],
    Direct: ["Directo (escriben tu dirección o la guardaron)", "Direct (they type your address or saved it)"],
    "Organic Social": ["Redes sociales", "Social media"],
    Referral: ["Otras páginas que te enlazan", "Other websites that link to you"],
    "Paid Search": ["Anuncios en Google", "Google ads"],
    "Paid Social": ["Anuncios en redes sociales", "Social media ads"],
    "Organic Maps": ["Google Maps", "Google Maps"],
    "Organic Video": ["Videos (YouTube)", "Videos (YouTube)"],
    "Organic Shopping": ["Google Shopping", "Google Shopping"],
    Email: ["Correos", "Email"],
    SMS: ["Mensajes de texto", "Text messages"],
    Display: ["Anuncios en otras páginas", "Display ads"],
    "Paid Other": ["Otros anuncios", "Other ads"],
    "Paid Video": ["Anuncios en video", "Video ads"],
    "Paid Shopping": ["Anuncios de Shopping", "Shopping ads"],
    "Cross-network": ["Campañas de Google en varias redes", "Google cross-network campaigns"],
    Affiliates: ["Afiliados", "Affiliates"],
    Audio: ["Audio", "Audio"],
    "Mobile Push Notifications": ["Notificaciones en el celular", "Mobile push notifications"],
    Unassigned: ["Sin identificar", "Unidentified"],
  };
  const m = map[key];
  return m ? t(m[0], m[1]) : key;
}

/** Las acciones importantes más comunes en palabras simples (las demás, con su nombre tal cual). */
function eventName(key: string, t: T): string {
  const k = key.toLowerCase();
  if (/call|llamad|phone|tel(efono)?_?click|^tel/.test(k)) return t(`Llamadas (${key})`, `Calls (${key})`);
  if (/whatsapp|wa_click|wa_/.test(k)) return t(`WhatsApp (${key})`, `WhatsApp (${key})`);
  if (/generate_lead|form|lead|contact|cotiza|quote/.test(k)) return t(`Formularios o contactos (${key})`, `Forms or contacts (${key})`);
  if (/purchase|compra/.test(k)) return t(`Compras (${key})`, `Purchases (${key})`);
  if (/email|mailto|correo/.test(k)) return t(`Correos (${key})`, `Emails (${key})`);
  if (/direction|como_llegar|map/.test(k)) return t(`Cómo llegar (${key})`, `Directions (${key})`);
  return key;
}

function deviceName(key: string, t: T): string {
  return ({ mobile: t("Celular", "Mobile"), desktop: t("Computadora", "Desktop"), tablet: t("Tableta", "Tablet"), "smart tv": t("Televisor", "TV") } as Record<string, string>)[key.toLowerCase()] ?? key;
}

/** Flecha contra los 28 días anteriores (verde = mejor). */
function Change({ trend, kind, f, t }: { trend: Trend; kind: "count" | "rate"; f: Fmt; t: T }) {
  const vs = t("vs. 28 días antes", "vs. previous 28 days");
  if (trend.dir === "none") return <span className="stat-note">{t("Sin datos para comparar", "No data to compare")}</span>;
  if (trend.dir === "new") return <span className="stat-note gsc-up">{t("▲ Nuevo (antes: 0)", "▲ New (before: 0)")}</span>;
  if (trend.dir === "same") return <span className="stat-note">= {vs}</span>;
  const amount = kind === "rate" ? t(`${Math.round(trend.pct * 100)} puntos`, `${Math.round(trend.pct * 100)} points`) : f.pct(trend.pct);
  return (
    <span className={`stat-note ${trend.dir === "up" ? "gsc-up" : "gsc-down"}`}>
      {trend.dir === "up" ? "▲" : "▼"} {amount} {vs}
    </span>
  );
}

function Tiles({ r, f, t }: { r: Ga4Report; f: Fmt; t: T }) {
  const tile = (label: string, value: React.ReactNode, change: React.ReactNode, hint?: string) => (
    <div className="stat" key={label}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {change}
      {hint && <span className={s.hint}>{hint}</span>}
    </div>
  );
  return (
    <div className={`stats ${s.tiles}`}>
      {tile(t("Visitas", "Visits"), f.int(r.totals.sessions), <Change trend={compareCount(r.totals.sessions, r.previous.sessions)} kind="count" f={f} t={t} />)}
      {tile(t("Personas", "People"), f.int(r.totals.users), <Change trend={compareCount(r.totals.users, r.previous.users)} kind="count" f={f} t={t} />)}
      {tile(
        t("Visitas con interés", "Engaged visits"),
        f.pct(r.totals.engagementRate),
        <Change trend={compareRate(r.totals.engagementRate, r.previous.engagementRate)} kind="rate" f={f} t={t} />,
        t("Se quedaron más de 10 segundos, vieron 2 páginas o hicieron una acción.", "Stayed over 10 seconds, saw 2 pages or took an action."),
      )}
      {tile(
        t("Tiempo promedio", "Average time"),
        f.time(r.totals.avgEngagementSec),
        <Change trend={compareCount(r.totals.avgEngagementSec, r.previous.avgEngagementSec)} kind="count" f={f} t={t} />,
        t("Por persona, con la página abierta y a la vista.", "Per person, with the page open and in view."),
      )}
      {tile(
        t("Acciones importantes", "Key actions"),
        f.int(r.totals.keyEvents),
        <Change trend={compareCount(r.totals.keyEvents, r.previous.keyEvents)} kind="count" f={f} t={t} />,
        t("Llamadas, formularios, WhatsApp…", "Calls, forms, WhatsApp…"),
      )}
    </div>
  );
}

/** Una barra simple: la etiqueta arriba, la barra y el número. */
function Bar({ label, value, max, note, title, extra }: { label: React.ReactNode; value: number; max: number; note: React.ReactNode; title: string; extra?: React.ReactNode }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <li className={s.barRow} title={title}>
      <div className={s.barTop}>
        <span className={s.barLabel}>{label}</span>
        <span className={s.barNote}>{note}</span>
      </div>
      <div className={s.track} aria-hidden="true">
        <div className={s.fill} style={{ width: `${w}%` }} />
      </div>
      {extra}
    </li>
  );
}

function rowChange(cur: number, prev: number, f: Fmt, t: T) {
  const tr = compareCount(cur, prev);
  if (tr.dir === "none" || tr.dir === "same") return null;
  if (tr.dir === "new") return <span className="gsc-up"> ▲ {t("nuevo", "new")}</span>;
  return (
    <span className={tr.dir === "up" ? "gsc-up" : "gsc-down"}>
      {" "}
      {tr.dir === "up" ? "▲" : "▼"} {f.pct(tr.pct)}
    </span>
  );
}

/** Visitas desde Google por día: columnas simples (pasa el ratón para ver el día). */
function OrganicTrend({ r, f, t }: { r: Ga4Report; f: Fmt; t: T }) {
  const days = r.organicTrend;
  if (!days.length) return null;
  const max = Math.max(1, ...days.map((d) => d.sessions));
  const total = days.reduce((a, d) => a + d.sessions, 0);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h3>{t("Visitas desde Google, día a día", "Visits from Google, day by day")}</h3>
      <p className="small muted">
        {t(
          `${f.int(total)} visitas llegaron buscando en Google (gratis): ${f.pct(organicShare(r))} de todas.`,
          `${f.int(total)} visits came from searching on Google (free): ${f.pct(organicShare(r))} of all.`,
        )}
      </p>
      <div className={s.cols} role="img" aria-label={t(`Visitas desde Google por día, máximo ${f.int(max)} en un día`, `Visits from Google per day, at most ${f.int(max)} in a day`)}>
        {days.map((d) => (
          <span key={d.date} className={s.col} title={`${f.day(d.date)}: ${f.int(d.sessions)} ${t("visitas", "visits")}`}>
            <span className={s.colFill} style={{ height: `${d.sessions ? Math.max(4, (d.sessions / max) * 100) : 0}%` }} />
          </span>
        ))}
      </div>
      <div className={s.colAxis}>
        <span>{f.day(days[0].date)}</span>
        <span>{t(`Máximo: ${f.int(max)} en un día`, `Peak: ${f.int(max)} in a day`)}</span>
        <span>{f.day(days[days.length - 1].date)}</span>
      </div>
    </div>
  );
}

function siteOrigin(website: string): string | null {
  const w = website.trim();
  if (!w) return null;
  try {
    return new URL(/^https?:\/\//i.test(w) ? w : `https://${w}`).origin;
  } catch {
    return null;
  }
}

function Report({ r, f, t, website }: { r: Ga4Report; f: Fmt; t: T; website: string }) {
  const maxChannel = Math.max(0, ...r.channels.map((c) => c.sessions));
  const totalSessions = r.totals.sessions || r.channels.reduce((a, c) => a + c.sessions, 0);
  const maxLanding = Math.max(0, ...r.landingPages.map((p) => p.sessions));
  const maxEvent = Math.max(0, ...r.keyEvents.map((e) => e.count));
  const origin = siteOrigin(website);
  const setUp = hasKeyEventsSetUp(r);
  const totalDevice = r.devices.reduce((a, d) => a + d.sessions, 0);
  // Las mismas que el plan de acción convierte en tarea.
  const lowEngagement = (p: Ga4Report["landingPages"][number]) => isLowEngagementPage(p, totalSessions);
  return (
    <>
      <Tiles r={r} f={f} t={t} />

      <div className={s.grid}>
        <div className="stack" style={{ gap: 8 }}>
          <h3>{t("De dónde llegan", "Where they come from")}</h3>
          {r.channels.length === 0 ? (
            <p className="small muted">{t("Todavía no hay visitas en estas fechas.", "No visits in these dates yet.")}</p>
          ) : (
            <ul className={s.bars}>
              {r.channels.map((c) => (
                <Bar
                  key={c.key}
                  label={channelName(c.key, t)}
                  value={c.sessions}
                  max={maxChannel}
                  title={`${c.key}: ${f.int(c.sessions)} ${t("visitas", "visits")} (${t("antes", "before")} ${f.int(c.prevSessions)})`}
                  note={
                    <>
                      {f.int(c.sessions)} · {totalSessions ? f.pct(c.sessions / totalSessions) : "—"}
                      {rowChange(c.sessions, c.prevSessions, f, t)}
                    </>
                  }
                />
              ))}
            </ul>
          )}
        </div>
        <OrganicTrend r={r} f={f} t={t} />
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <h3>{t("Las páginas por donde entran", "The pages where they land")}</h3>
        {r.landingPages.length === 0 ? (
          <p className="small muted">{t("Todavía no hay datos de páginas.", "No page data yet.")}</p>
        ) : (
          <ul className={s.bars}>
            {r.landingPages.slice(0, 8).map((p) => (
              <Bar
                key={p.key}
                label={
                  origin && p.key.startsWith("/") ? (
                    <a href={`${origin}${p.key}`} target="_blank" rel="noopener noreferrer">{p.key}</a>
                  ) : (
                    p.key
                  )
                }
                value={p.sessions}
                max={maxLanding}
                title={`${p.key}: ${f.int(p.sessions)} ${t("visitas", "visits")}`}
                note={t(`${f.int(p.sessions)} visitas`, `${f.int(p.sessions)} visits`)}
                extra={
                  <span className={s.barSub}>
                    {t(`${f.pct(p.engagementRate)} con interés`, `${f.pct(p.engagementRate)} engaged`)}
                    {p.keyEvents > 0 &&
                      (p.keyEvents === 1 ? t(" · 1 acción", " · 1 action") : t(` · ${f.int(p.keyEvents)} acciones`, ` · ${f.int(p.keyEvents)} actions`))}
                    {lowEngagement(p) && <span className="pill warn">{t("Casi nadie se queda", "Hardly anyone stays")}</span>}
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <h3>{t("Acciones importantes (llamadas, formularios)", "Key actions (calls, forms)")}</h3>
        {r.keyEvents.length > 0 ? (
          <ul className={s.bars}>
            {r.keyEvents.map((e) => (
              <Bar
                key={e.key}
                label={eventName(e.key, t)}
                value={e.count}
                max={maxEvent}
                title={`${e.key}: ${f.int(e.count)} (${t("antes", "before")} ${f.int(e.prevCount)})`}
                note={
                  <>
                    {f.int(e.count)}
                    {rowChange(e.count, e.prevCount, f, t)}
                  </>
                }
              />
            ))}
          </ul>
        ) : setUp === false ? (
          <p className="note">
            {t(
              "Tu Analytics todavía no cuenta las llamadas ni los formularios. Pídele a quien maneja tu página que los marque como «eventos clave» en Google Analytics (Administrar › Eventos clave): así sabrás cuántos clientes te contactan desde la web.",
              "Your Analytics doesn't count calls or forms yet. Ask whoever runs your website to mark them as \"key events\" in Google Analytics (Admin › Key events): that's how you'll know how many customers contact you from the web.",
            )}
          </p>
        ) : (
          <p className="small muted">{t("No hubo acciones importantes en estas fechas.", "There were no key actions in these dates.")}</p>
        )}
      </div>

      {(r.cities.length > 0 || r.countries.length > 0 || r.devices.length > 0) && (
        <Fold
          summary={t("Desde qué ciudad y con qué aparato", "Which city and which device")}
          note={t(`${r.cities.length} ciudades · ${r.devices.length} aparatos`, `${r.cities.length} cities · ${r.devices.length} devices`)}
        >
          <div className={s.grid3}>
            {r.cities.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <h4 className={s.h4}>{t("Ciudades", "Cities")}</h4>
                <ul className={s.simple}>
                  {r.cities.map((c) => (
                    <li key={`${c.key}-${c.country}`}>
                      <span>{c.key}{c.country ? <span className="muted"> · {c.country}</span> : null}</span>
                      <strong>{f.int(c.sessions)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.countries.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <h4 className={s.h4}>{t("Países", "Countries")}</h4>
                <ul className={s.simple}>
                  {r.countries.map((c) => (
                    <li key={c.key}>
                      <span>{c.key}</span>
                      <strong>{f.int(c.sessions)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.devices.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <h4 className={s.h4}>{t("Aparatos", "Devices")}</h4>
                <ul className={s.simple}>
                  {r.devices.map((d) => (
                    <li key={d.key}>
                      <span>{deviceName(d.key, t)}</span>
                      <strong>{totalDevice ? f.pct(d.sessions / totalDevice) : f.int(d.sessions)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Fold>
      )}
    </>
  );
}

export async function Ga4Panel({ businessId }: { businessId: string }) {
  const id = businessId;
  const { lang, t } = await getT();
  const head = (
    <div className="stack" style={{ gap: 6 }}>
      <h2>{t("Visitas a tu página (Google Analytics)", "Visits to your website (Google Analytics)")}</h2>
      <p className="small muted">
        {t(
          "Cuántas personas entran a tu página, de dónde llegan, por qué páginas entran y cuántas te llaman o te escriben. Gratis, y no cambia nada en tu página.",
          "How many people visit your website, where they come from, which pages they land on and how many call or message you. Free, and it doesn't change anything on your site.",
        )}
      </p>
    </div>
  );
  const notice = (
    <Suspense fallback={null}>
      <Ga4Notice />
    </Suspense>
  );
  const howTo = <Ga4HowTo t={t} redirectUri={googleRedirectUri()} />;

  if (!googleEnabled())
    return (
      <section className="card" id="ga4">
        {head}
        {notice}
        <p className="note">
          {t(
            "Google todavía no está configurado en esta app (falta GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el servidor). Cuando esté, aquí aparece el botón «Conectar Google Analytics».",
            "Google isn't set up in this app yet (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing on the server). Once it is, the \"Connect Google Analytics\" button shows up here.",
          )}
        </p>
        {howTo}
      </section>
    );

  const [business, conn] = await Promise.all([db.business.findUnique({ where: { id }, select: { website: true } }), readGa4Connection(id)]);
  const website = business?.website ?? "";

  if (!conn)
    return (
      <section className="card" id="ga4">
        {head}
        {notice}
        <div className={s.connect}>
          <p className={s.connectText}>
            {t(
              "Conéctalo y aquí verás tus visitas reales de los últimos 28 días comparadas con los 28 anteriores.",
              "Connect it and you'll see your real visits from the last 28 days compared with the previous 28.",
            )}
          </p>
          <a className="btn on" href={`/api/ga4/start?b=${id}`}>{t("Conectar Google Analytics", "Connect Google Analytics")}</a>
        </div>
        {howTo}
      </section>
    );

  const disconnect = (
    <Ga4ConfirmButton
      action={disconnectGa4.bind(null, id)}
      label={t("Desconectar Google Analytics", "Disconnect Google Analytics")}
      question={t("¿Desconectar Google Analytics? Los datos guardados se quedan.", "Disconnect Google Analytics? Saved data stays.")}
    />
  );

  // Conectado, pero falta elegir la propiedad de este negocio.
  if (!conn.secret.propertyId) {
    const { list, suggested } = orderForPicker(website, conn.secret.properties ?? []);
    return (
      <section className="card" id="ga4">
        {head}
        {notice}
        {list.length === 0 ? (
          <p className="note">
            {t(
              "Esa cuenta de Google no tiene ninguna propiedad de Google Analytics 4. Vuelve a conectar con la cuenta que ve las estadísticas de tu página.",
              "That Google account doesn't have any Google Analytics 4 property. Connect again with the account that sees your website's stats.",
            )}
          </p>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            <h3>{t("¿Cuál es la de este negocio?", "Which one is this business's?")}</h3>
            <p className="small muted">
              {suggested
                ? t("Tu cuenta tiene varias propiedades. Marcamos la que coincide con tu página web.", "Your account has several properties. We marked the one that matches your website.")
                : t("Tu cuenta tiene varias propiedades. Elige la de este negocio.", "Your account has several properties. Pick this business's.")}
            </p>
            <ul className={s.picker}>
              {list.map((p) => (
                <li key={p.id} className={p.id === suggested ? s.suggested : undefined}>
                  <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                    <strong className={s.wrap}>
                      {p.name} {p.id === suggested && <span className="pill good">{t("Sugerida", "Suggested")}</span>}
                    </strong>
                    <span className={`small muted ${s.wrap}`}>
                      {[p.urls.map((u) => u.replace(/^https?:\/\//, "").replace(/\/$/, "")).join(", "), p.account].filter(Boolean).join(" · ") || `ID ${p.id}`}
                    </span>
                  </div>
                  <form action={chooseGa4Property.bind(null, id, p.id)}>
                    <button type="submit" className={p.id === suggested ? "btn on" : "btn outline"}>{t("Usar esta", "Use this one")}</button>
                  </form>
                </li>
              ))}
            </ul>
            <p className="small muted">
              {t("¿No está? ", "Not there? ")}
              <a href={`/api/ga4/start?b=${id}`}>{t("Vuelve a conectar con otra cuenta de Google", "Connect again with another Google account")}</a>.
            </p>
          </div>
        )}
        <div>{disconnect}</div>
      </section>
    );
  }

  const f = fmt(lang);
  const last = await latestGa4Report(id, conn.secret.propertyId);
  const report = last?.report ?? null;
  const stale = needsRefresh({ fetchedAt: report?.fetchedAt ?? null, lastTryAt: conn.secret.lastTryAt });
  // El último intento falló después del último dato bueno: se muestra el motivo.
  const failed = conn.secret.lastError && (!report || Date.parse(conn.secret.lastTryAt ?? "") > Date.parse(report.fetchedAt)) ? explainGa4Error(conn.secret.lastError, t) : null;

  return (
    <section className="card" id="ga4">
      {head}
      {notice}
      <div className={s.meta}>
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <span className="small muted">{t("Propiedad conectada", "Connected property")}</span>
          <strong className={s.wrap}>{conn.secret.propertyName || conn.label || conn.secret.propertyId}</strong>
          <span className="small muted">
            {report
              ? t(
                  `Actualizado: ${f.when(report.fetchedAt)} · del ${f.day(report.range.start)} al ${f.day(report.range.end)}`,
                  `Updated: ${f.when(report.fetchedAt)} · ${f.day(report.range.start)} to ${f.day(report.range.end)}`,
                )
              : t("Todavía no hay datos.", "No data yet.")}
          </span>
          <Ga4AutoRefresh action={autoRefreshGa4.bind(null, id)} stale={stale} />
        </div>
        <Ga4RefreshButton action={refreshGa4Action.bind(null, id)} />
      </div>
      {failed && (
        <p className="note error" role="alert">
          {t(`No se pudieron traer los datos nuevos (${f.when(conn.secret.lastTryAt ?? "")}): `, `Couldn't get new data (${f.when(conn.secret.lastTryAt ?? "")}): `)}
          {failed}
        </p>
      )}

      {report ? (
        <Report r={report} f={f} t={t} website={website} />
      ) : (
        !failed && <p className="note">{t("Presiona «Actualizar» para traer tus visitas de los últimos 28 días.", "Click \"Refresh\" to get your visits from the last 28 days.")}</p>
      )}

      <div className={s.footer}>
        {(conn.secret.properties?.length ?? 0) > 1 && (
          <Ga4ConfirmButton action={changeGa4Property.bind(null, id)} label={t("Cambiar de propiedad", "Change property")} className="btn outline" />
        )}
        {disconnect}
      </div>
    </section>
  );
}
