import Link from "next/link";
import {
  activateAdAction,
  campaignAdsOptionsAction,
  chooseAdAccountAction,
  createAdAction,
  createFromProposalAction,
  disconnectAdsAction,
  improveGooglePlanAction,
  pauseAdAction,
  pauseAllAdsAction,
  proposeAdsAction,
  saveAdsSettingsAction,
} from "@/app/actions-ads";
import { AdCard, type AdView } from "@/components/ads/AdCard";
import { AccountPicker, CampaignOptions, DisconnectAds, PauseAllButton, SettingsForm, SpendBar } from "@/components/ads/AdsForms";
import { GooglePlanView } from "@/components/ads/GooglePlan";
import { NewAdForm } from "@/components/ads/NewAdForm";
import { Proposals } from "@/components/ads/Proposals";
import s from "@/components/ads/ads.module.css";
import { PageHead } from "@/components/PageHead";
import { adsOverview, getAdsSettings, pageCreds, readAdsConn } from "@/lib/ads";
import { candidatePosts } from "@/lib/ads-ai";
import { googlePlanFor } from "@/lib/ads-google-load";
import { campaignRoomCents, daysBetween, guessSpecialCategory, isLive, money, readCampaignAds } from "@/lib/ads-shape";
import { aiEnabled } from "@/lib/ai";
import { statusLabel } from "@/lib/campaign-shape";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { metaEnabled, redirectUri } from "@/lib/meta-oauth";
import { readMapPlace } from "@/lib/seo/maprank";
import { fmtDate, fmtWhen } from "@/lib/time";

export const dynamic = "force-dynamic";
// Crear un anuncio en Meta son 4 pasos seguidos; la IA tarda unos 20 segundos.
export const maxDuration = 120;

const STATUS_PILL: Record<string, string> = { active: "pill good", paused: "pill warn", stopped: "pill bad", ended: "pill plain", draft: "pill draft" };

export default async function AnunciosPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ campana?: string; tab?: string; ads?: string; msg?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const { lang, t } = await getT();
  const tab = q.tab === "google" ? "google" : "meta";
  const [b, conn, settings, page, campaigns, overview] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id } }),
    readAdsConn(id),
    getAdsSettings(id),
    pageCreds(id),
    db.campaign.findMany({ where: { businessId: id }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
    adsOverview(id),
  ]);
  const now = new Date();
  const selected = campaigns.find((c) => c.id === q.campana) ?? campaigns.find((c) => c.status === "active" && c.budgetCents > 0) ?? campaigns[0] ?? null;
  const tabHref = (x: string) => `/b/${id}/anuncios?${new URLSearchParams({ ...(selected ? { campana: selected.id } : {}), ...(x === "google" ? { tab: "google" } : {}) })}`;
  const live = campaigns.flatMap((c) => readCampaignAds(c.ads).items).filter(isLive).length;
  const suggested = guessSpecialCategory(`${b.aiProfile} ${b.name}`);

  const flash =
    q.ads === "ok"
      ? { cls: "note ok", text: t("Listo: la cuenta de anuncios quedó conectada.", "Done: the ad account is connected.") }
      : q.ads === "choose"
        ? { cls: "note info", text: t("Conectado. Ahora elige con qué cuenta de anuncios se paga.", "Connected. Now pick which ad account pays.") }
        : q.ads === "error"
          ? { cls: "note error", text: q.msg || t("No se pudo conectar.", "Couldn't connect.") }
          : null;

  return (
    <>
      <PageHead
        business={b}
        prefix={t("Anuncios de", "Ads for")}
        section={t("Anuncios pagados", "Paid ads")}
        title={t("Anuncios pagados", "Paid ads")}
        subtitle={t(
          "Anuncios en Facebook e Instagram con límites de dinero que nunca se pasan, y un plan listo para copiar en Google Ads. Nada gasta sin que tú lo confirmes.",
          "Facebook and Instagram ads with money limits that are never exceeded, and a ready-to-copy Google Ads plan. Nothing spends without your confirmation.",
        )}
      />
      {flash && <p className={flash.cls} role="status">{flash.text}</p>}

      <div className="tabs" role="tablist" style={{ alignSelf: "flex-start", maxWidth: "100%" }}>
        <Link href={tabHref("meta")} className={`tab${tab === "meta" ? " on" : ""}`} role="tab" aria-selected={tab === "meta"} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
          Facebook · Instagram
        </Link>
        <Link href={tabHref("google")} className={`tab${tab === "google" ? " on" : ""}`} role="tab" aria-selected={tab === "google"} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
          {t("Google Ads (plan)", "Google Ads (plan)")}
        </Link>
      </div>

      {tab === "google" ? (
        <GoogleTab id={id} lang={lang} />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {/* 1. Conexión */}
          <section className="card">
            <div className="row between">
              <h2>{t("Cuenta de anuncios de Meta", "Meta ad account")}</h2>
              <span className={conn?.adAccountId ? "pill connected" : conn ? "pill warn" : "pill"}>
                {conn?.adAccountId ? t("Conectada", "Connected") : conn ? t("Falta elegir", "Pick one") : t("No conectada", "Not connected")}
              </span>
            </div>
            {!conn ? (
              <>
                <p>
                  {t(
                    "Para poner anuncios, la app necesita permiso para usar tu cuenta de anuncios de Facebook (la que tiene tu tarjeta). Es un permiso aparte: tu página y tu Instagram siguen conectados como están.",
                    "To run ads, the app needs permission to use your Facebook ad account (the one with your card). It's a separate permission: your Page and Instagram stay connected as they are.",
                  )}
                </p>
                {!page && (
                  <p className="note">
                    {t("Primero conecta la página de Facebook del negocio en ", "First connect the business Facebook Page in ")}
                    <Link href={`/b/${id}/conexiones`}>{t("Conexiones", "Connections")}</Link>.
                  </p>
                )}
                {metaEnabled() ? (
                  <div><a className="btn on" href={`/api/meta/start?b=${id}&for=ads`}>{t("Conectar anuncios", "Connect ads")}</a></div>
                ) : (
                  <p className="note">{t("Falta configurar META_APP_ID y META_APP_SECRET en el servidor.", "META_APP_ID and META_APP_SECRET need to be set on the server.")}</p>
                )}
                <details className={s.howto}>
                  <summary>{t("¿Qué pide Meta para esto?", "What does Meta require for this?")}</summary>
                  <ul>
                    <li>{t("Una cuenta de anuncios en business.facebook.com con una tarjeta o forma de pago, y la página del negocio dentro del mismo portafolio comercial.", "An ad account in business.facebook.com with a card or payment method, and the business Page in the same business portfolio.")}</li>
                    <li>{t("Que tú seas administrador de esa cuenta de anuncios y de la página.", "That you're an admin of that ad account and of the Page.")}</li>
                    <li>{t("La cuenta de anuncios en dólares (USD): así los límites de la app son exactos.", "The ad account in US dollars (USD): that way the app's limits are exact.")}</li>
                    <li>{t("Meta revisa cada anuncio antes de mostrarlo (unos minutos a 24 horas). Seguros, préstamos o crédito llevan reglas especiales (sin edades, radio mínimo de 25 km).", "Meta reviews every ad before showing it (minutes to 24 hours). Insurance, loans or credit have special rules (no ages, 25 km minimum radius).")}</li>
                  </ul>
                  <p className="small muted" style={{ marginTop: 8 }}>
                    {t(
                      "Para quien configura la app: en developers.facebook.com, al app de Meta hay que agregarle el producto «Marketing API» y pedir los permisos ads_management, ads_read, business_management y pages_manage_ads. Para la cuenta de anuncios propia basta el acceso estándar; para manejar cuentas de otros negocios Meta exige revisión de la app (App Review) con «acceso avanzado» y la verificación del negocio. Dirección de regreso: ",
                      "For whoever sets up the app: in developers.facebook.com, add the \"Marketing API\" product to the Meta app and request ads_management, ads_read, business_management and pages_manage_ads. Your own ad account works with standard access; to manage other businesses' accounts Meta requires App Review with \"advanced access\" and business verification. Redirect URI: ",
                    )}
                    <code style={{ overflowWrap: "anywhere" }}>{redirectUri()}</code>
                  </p>
                </details>
              </>
            ) : (
              <>
                {conn.adAccountId ? (
                  <p>
                    {t("Se paga con", "Paid with")} <b>{conn.adAccountName}</b> ({conn.currency || "?"}).
                    {conn.currency && conn.currency !== "USD" && (
                      <span className="note error" style={{ marginTop: 8 }}>
                        {t(`Esta cuenta usa ${conn.currency}. Por ahora la app solo crea anuncios con cuentas en dólares (USD).`, `This account uses ${conn.currency}. For now the app only creates ads with US dollar (USD) accounts.`)}
                      </span>
                    )}
                  </p>
                ) : null}
                {!conn.adAccountId ? (
                  <AccountPicker action={chooseAdAccountAction.bind(null, id)} accounts={conn.accounts} current="" />
                ) : conn.accounts.length > 1 ? (
                  <details className={s.howto}>
                    <summary>{t("Usar otra cuenta de anuncios", "Use another ad account")}</summary>
                    <AccountPicker action={chooseAdAccountAction.bind(null, id)} accounts={conn.accounts} current={conn.adAccountId} />
                  </details>
                ) : null}
                <div className="row">
                  <a className="btn outline" href={`/api/meta/start?b=${id}&for=ads`}>{t("Volver a conectar", "Reconnect")}</a>
                  <DisconnectAds disconnect={disconnectAdsAction.bind(null, id)} />
                </div>
              </>
            )}
          </section>

          {/* 2. Límites y parada de emergencia */}
          <section className="card">
            <h2>{t("Límites de dinero", "Money limits")}</h2>
            <div className={s.safety}>
              <SpendBar
                spent={overview.monthSpentCents}
                max={settings.monthlyCapCents}
                label={settings.monthlyCapCents ? t("Gastado este mes", "Spent this month") : t("Pon el máximo por mes para poder crear anuncios", "Set the monthly maximum to create ads")}
              />
              <PauseAllButton action={pauseAllAdsAction.bind(null, id)} live={live} />
            </div>
            <p className="small muted">
              {t(
                `Comprometido este mes (lo gastado + lo que los anuncios creados todavía pueden gastar): ${money(overview.monthCommittedCents)}.`,
                `Committed this month (spent + what created ads can still spend): ${money(overview.monthCommittedCents)}.`,
              )}
            </p>
            <SettingsForm action={saveAdsSettingsAction.bind(null, id)} monthlyCapCents={settings.monthlyCapCents} special={settings.specialCategory} suggested={suggested} />
          </section>

          {/* 3. Campañas y anuncios */}
          {!campaigns.length ? (
            <section className="card empty">
              <p>{t("Los anuncios van dentro de una campaña (con su presupuesto y fechas).", "Ads live inside a campaign (with its budget and dates).")}</p>
              <div><Link className="btn on" href={`/b/${id}/campanas`}>{t("Crear una campaña", "Create a campaign")}</Link></div>
            </section>
          ) : (
            <>
              <nav className={s.campaigns} aria-label={t("Campañas", "Campaigns")}>
                {campaigns.map((c) => (
                  <Link key={c.id} href={`/b/${id}/anuncios?campana=${c.id}`} className={`${s.campaign}${selected?.id === c.id ? ` ${s.on}` : ""}`} aria-current={selected?.id === c.id ? "page" : undefined}>
                    <span>{c.name}</span>
                    <span className={STATUS_PILL[c.status] ?? "pill"}>{statusLabel(c.status, lang)}</span>
                  </Link>
                ))}
              </nav>
              {selected && <CampaignAds id={id} campaignId={selected.id} lang={lang} conn={Boolean(conn?.adAccountId) && (!conn?.currency || conn.currency === "USD")} hasPage={Boolean(page)} monthlyCap={settings.monthlyCapCents} special={settings.specialCategory !== "NONE"} hasMapPlace={Boolean(readMapPlace(b.seoMapPlace))} city={b.seoLocationName.split(",")[0] ?? ""} hasPhone={b.phone.replace(/\D/g, "").length >= 7} now={now} />}
            </>
          )}
        </div>
      )}
    </>
  );
}

async function CampaignAds(p: { id: string; campaignId: string; lang: "es" | "en"; conn: boolean; hasPage: boolean; monthlyCap: number; special: boolean; hasMapPlace: boolean; city: string; hasPhone: boolean; now: Date }) {
  const { t } = await getT();
  const c = await db.campaign.findUniqueOrThrow({ where: { id: p.campaignId } });
  const ads = readCampaignAds(c.ads);
  const room = campaignRoomCents(c.budgetCents, ads.items);
  const blocked = !p.conn
    ? t("Conecta la cuenta de anuncios (arriba).", "Connect the ad account (above).")
    : !p.hasPage
      ? t("Conecta la página de Facebook en Conexiones.", "Connect the Facebook Page in Connections.")
      : !p.monthlyCap
        ? t("Pon el máximo por mes (arriba).", "Set the monthly maximum (above).")
        : c.budgetCents <= 0
          ? t("Esta campaña no tiene presupuesto para anuncios.", "This campaign has no ad budget.")
          : ["stopped", "ended"].includes(c.status)
            ? t("La campaña está parada o terminó.", "The campaign is stopped or ended.")
            : "";
  const canActivate = c.status !== "active" ? t("Activa la campaña primero (en Campañas).", "Turn the campaign on first (in Campaigns).") : null;
  const posts = p.conn && !blocked ? await candidatePosts(p.id).catch(() => []) : [];
  const postOptions = posts.map((x) => ({
    value: `${x.kind}:${x.id}`,
    label: `${x.kind === "fb_post" ? "Facebook" : "Instagram"} · ${(x.text || t("(sin texto)", "(no text)")).replace(/\s+/g, " ").slice(0, 60)}`,
  }));
  const views: AdView[] = [...ads.items].reverse().map((a) => {
    const last = a.errors.at(-1);
    return {
      ...a,
      dates: `${fmtDate(a.startsAt, p.lang)} – ${fmtDate(a.endsAt, p.lang)}`,
      fetchedText: a.insights ? t(`Actualizado ${fmtWhen(a.insights.fetchedAt, p.lang, p.now)}`, `Updated ${fmtWhen(a.insights.fetchedAt, p.lang, p.now)}`) : "",
      showError: Boolean(last) && (a.status === "error" || p.now.getTime() - Date.parse(last!.at) < 86_400_000),
    };
  });
  const daysLeft = c.endsAt ? daysBetween(p.now, c.endsAt) : 30;
  const create = Object.fromEntries(ads.proposals.map((x) => [x.id, createFromProposalAction.bind(null, p.id, c.id, x.id)]));
  return (
    <>
      <section className="card">
        <div className="row between">
          <h2>{c.name}</h2>
          <Link className="btn link" href={`/b/${p.id}/campanas`}>{t("Ver en Campañas", "See in Campaigns")}</Link>
        </div>
        {c.goal && <p className="small muted">{c.goal}</p>}
        <SpendBar spent={c.spentCents} max={c.budgetCents} label={t("Presupuesto de anuncios de la campaña", "Campaign ad budget")} />
        <p className="small muted">
          {t(
            `Le quedan ${money(room)} para anuncios nuevos.${c.endsAt ? ` Termina el ${fmtDate(c.endsAt, "es")}.` : ""} Si la campaña se pausa, se para o termina, todos sus anuncios se pausan solos.`,
            `${money(room)} left for new ads.${c.endsAt ? ` Ends ${fmtDate(c.endsAt, "en")}.` : ""} If the campaign is paused, stopped or ends, all its ads pause by themselves.`,
          )}
        </p>
        <CampaignOptions action={campaignAdsOptionsAction.bind(null, p.id, c.id)} auto={c.mode === "auto"} aiCanCreate={ads.aiCanCreate} dailyCapCents={ads.dailyCapCents} />
      </section>

      <section className="card">
        <h2>{t("Anuncios de esta campaña", "This campaign's ads")}</h2>
        {views.length ? (
          <div className={s.ads}>
            {views.map((a) => (
              <AdCard key={a.id} ad={a} pause={pauseAdAction.bind(null, p.id, c.id, a.id)} activate={activateAdAction.bind(null, p.id, c.id, a.id)} canActivate={canActivate} />
            ))}
          </div>
        ) : (
          <p className="muted">{t("Todavía no hay anuncios. Pide ideas a la IA o crea uno abajo.", "No ads yet. Ask the AI for ideas or create one below.")}</p>
        )}
      </section>

      <section className="card">
        <h2>{t("Ideas de la IA", "AI ideas")}</h2>
        <Proposals proposals={ads.proposals} propose={proposeAdsAction.bind(null, p.id, c.id)} create={create} canCreate={blocked} aiReady={aiEnabled()} />
      </section>

      <section className="card">
        <details className={s.howto} open={!views.length && !blocked ? true : undefined}>
          <summary>{t("Crear un anuncio a mano", "Create an ad by hand")}</summary>
          {blocked ? (
            <p className="note">{blocked}</p>
          ) : (
            <NewAdForm
              action={createAdAction.bind(null, p.id, c.id)}
              posts={postOptions}
              special={p.special}
              hasMapPlace={p.hasMapPlace}
              defaultCity={p.city}
              defaultDays={daysLeft}
              roomCents={room}
              hasPhone={p.hasPhone}
            />
          )}
        </details>
      </section>
    </>
  );
}

async function GoogleTab({ id, lang }: { id: string; lang: "es" | "en" }) {
  const { plan, saved, keywordsAt } = await googlePlanFor(id);
  // Si la IA mejoró los textos y las palabras no cambiaron, se muestra esa versión.
  const sameGroups = saved && saved.groups.map((g) => g.name).join("|") === plan.groups.map((g) => g.name).join("|");
  return <GooglePlanView plan={sameGroups ? saved : plan} improve={improveGooglePlanAction.bind(null, id)} aiReady={aiEnabled()} keywordsAt={keywordsAt ? fmtDate(keywordsAt, lang) : ""} />;
}
