import { notFound } from "next/navigation";
import { DirectoryList, type DirItem } from "@/components/directories/DirectoryList";
import s from "@/components/directories/Directories.module.css";
import { NapCard } from "@/components/directories/NapCard";
import { ReviewLink } from "@/components/directories/ReviewLink";
import { ReviewRequest } from "@/components/directories/ReviewRequest";
import { PageHead } from "@/components/PageHead";
import { brandSlogan } from "@/lib/brand-identity";
import { db } from "@/lib/db";
import { napIssueText } from "@/lib/directories";
import { loadDirectoryPage } from "@/lib/directories-data";
import { getT } from "@/lib/i18n-server";
import { qrSvg } from "@/lib/qr";
import { defaultTemplate, REVIEW_COOLDOWN_DAYS, REVIEW_DAILY_MAX } from "@/lib/reviews-request";
import { fmtDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DirectoriosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lang, t } = await getT();
  const d = await loadDirectoryPage(id);
  if (!d) notFound();
  const b = d.business;
  const conns = await db.connection.findMany({ where: { businessId: id, channel: { in: ["email", "sms"] } }, select: { channel: true } });
  const tx = (x: { es: string; en: string }) => (lang === "en" ? x.en : x.es);
  const listing = (dir: string) => d.listings.find((l) => l.directory === dir);
  const items: DirItem[] = d.dirs.map((dir) => {
    const row = listing(dir.id);
    return {
      id: dir.id,
      name: dir.name,
      why: dir.why,
      data: dir.data,
      priority: dir.priority,
      cost: dir.cost,
      kind: dir.kind,
      signUpUrl: dir.signUpUrl,
      searchUrl: dir.searchUrl,
      status: d.statuses[dir.id] ?? "todo",
      url: row?.url ?? "",
      notes: row?.notes ?? "",
      napOk: row?.napOk ?? null,
      checkedAt: row?.checkedAt?.toISOString() ?? null,
      seenInSearch: d.seenInSearch.includes(dir.id),
    };
  });
  const seo = (tab: string, hash: string) => `/b/${id}/seo?tab=${tab}#${hash}`;
  const regionName = {
    us: t("Estados Unidos", "United States"),
    ca: t("Centroamérica", "Central America"),
    other: t("tu país", "your country"),
  }[d.place.region];
  const kindName = {
    adjuster: t("un ajustador público", "a public adjuster"),
    home: t("un negocio de servicios para casas y negocios", "a home & business services company"),
    general: t("un negocio local", "a local business"),
  }[d.kind];
  const templates = {
    es: defaultTemplate("es", { name: b.name, slogan: brandSlogan(b, "es"), signer: b.ownerName }),
    en: defaultTemplate("en", { name: b.name, slogan: brandSlogan(b, "en"), signer: b.ownerName }),
  };
  const r = d.reviews;
  const fmtNum = new Intl.NumberFormat(lang === "en" ? "en-US" : "es", { maximumFractionDigits: 1 });

  return (
    <>
      <PageHead
        business={b}
        prefix={t("Directorios de", "Directories for")}
        title={t("Directorios y reseñas", "Directories & reviews")}
        subtitle={t(
          "Sal en los sitios donde la gente busca negocios, con los mismos datos en todos, y consigue más reseñas en Google.",
          "Show up on the sites where people look for businesses, with the same details everywhere, and get more Google reviews.",
        )}
      />

      <div className={s.summary}>
        <a href="#directorios" className={s.stat}>
          <span className={s.statNum}>
            {d.progress.done}/{d.progress.total}
          </span>
          <span className={s.statLabel}>{t("directorios importantes", "important directories")}</span>
        </a>
        <a href="#datos" className={s.stat}>
          <span className={`${s.statNum} ${d.issues.length ? s.statBad : s.statOk}`}>{d.issues.length}</span>
          <span className={s.statLabel}>{t("datos que no coinciden", "details that don't match")}</span>
        </a>
        <a href="#resenas" className={s.stat}>
          <span className={s.statNum}>{r?.rating != null ? `${fmtNum.format(r.rating)}★` : "—"}</span>
          <span className={s.statLabel}>{r?.total != null ? t(`${r.total} reseñas en Google`, `${r.total} Google reviews`) : t("reseñas en Google", "Google reviews")}</span>
        </a>
      </div>

      <section className="card" id="datos">
        <div>
          <h2>{t("1. Tus datos oficiales", "1. Your official details")}</h2>
          <p className="small muted">
            {t(
              "Copia y pega exactamente lo mismo en cada directorio. Si Google ve tu nombre, dirección o teléfono escritos distinto en distintos sitios, confía menos en ti.",
              "Copy and paste exactly the same thing on every directory. If Google sees your name, address or phone written differently on different sites, it trusts you less.",
            )}
          </p>
        </div>
        {d.issues.length > 0 ? (
          <div className="note error" role="alert">
            <strong>{t("Esto no coincide:", "This doesn't match:")}</strong>
            <ul className={s.issues}>
              {d.issues.map((i, n) => (
                <li key={n}>{tx(napIssueText(i))}</li>
              ))}
            </ul>
            <span className="small">
              {t("Decide cuál es el correcto y cámbialo donde está mal: tus datos en ", "Decide which is right and change it where it's wrong: your details in ")}
              <a href={`/b/${id}/negocio`}>{t("Mi negocio", "My business")}</a>
              {t(" o tu perfil en ", " or your profile at ")}
              <a href="https://business.google.com/" target="_blank" rel="noopener noreferrer">
                business.google.com
              </a>
              .
            </span>
          </div>
        ) : d.profile ? (
          <p className="note ok">
            {t(
              `Tu nombre, teléfono y dirección coinciden con tu Perfil de Google (revisado el ${fmtDate(d.profileAt ?? new Date(), "es")}).`,
              `Your name, phone and address match your Google profile (checked ${fmtDate(d.profileAt ?? new Date(), "en")}).`,
            )}
          </p>
        ) : (
          <p className="note info">
            {t("Para comparar tus datos con Google, actualiza tu Perfil de Google en ", "To compare your details with Google, refresh your Google profile in ")}
            <a href={seo("local", "perfil")}>{t("SEO → Google Maps y reseñas", "SEO → Google Maps & reviews")}</a>.
          </p>
        )}
        {(d.schema === "missing" || d.schema === "incomplete") && (
          <p className="note">
            {t("Tu página web no tiene tus datos en el formato que lee Google. ", "Your website doesn't have your details in the format Google reads. ")}
            <a href={seo("local", "codigo-google")}>{t("Copia el «Código para Google»", "Copy the “Code for Google”")}</a>
            {t(" y pégalo en tu página de inicio.", " and paste it on your home page.")}
          </p>
        )}
        <NapCard
          businessId={id}
          official={d.official}
          hours={d.hours}
          categories={d.categories}
          keywords={d.keywords}
          descriptions={d.descriptions}
          fromAi={d.descriptionsFromAi}
          links={{ business: `/b/${id}/negocio`, gbp: seo("local", "perfil"), schema: seo("local", "codigo-google") }}
        />
      </section>

      <section className="card" id="directorios">
        <div>
          <h2>{t("2. Directorios donde te conviene estar", "2. Directories you should be on")}</h2>
          <p className="small muted">
            {t(
              `Elegidos para ${kindName} en ${regionName}${d.place.city ? ` (${d.place.city})` : ""}, del más importante al menos. Empieza por los «Imprescindibles».`,
              `Picked for ${kindName} in ${regionName}${d.place.city ? ` (${d.place.city})` : ""}, most important first. Start with the “Must have” ones.`,
            )}
          </p>
        </div>
        <DirectoryList businessId={id} items={items} progress={d.progress} />
        <details className={s.more}>
          <summary>{t("¿Cómo sé si ya estoy en un directorio?", "How do I know if I'm already on a directory?")}</summary>
          <p className="small">
            {t(
              "«Buscar si ya estoy» abre el buscador del directorio (o Google) con tu nombre y tu ciudad. Si sale tu negocio, entra a la ficha y busca «Reclamar este negocio» o «Claim this business» para poder editarla; si no sale, usa «Registrarme». Marca el estado aquí para llevar la cuenta.",
              "“Check if I'm listed” opens the directory's search (or Google) with your name and city. If your business shows up, open the listing and look for “Claim this business” so you can edit it; if not, use “Sign up”. Mark the status here to keep track.",
            )}
          </p>
          <p className="small muted">
            {t(
              "«Sale en tus búsquedas» quiere decir que Google muestra ese directorio arriba cuando buscan lo que vendes (según tus posiciones guardadas).",
              "“Shows in your searches” means Google ranks that directory high when people search for what you sell (from your saved rankings).",
            )}
          </p>
        </details>
      </section>

      <section className="card" id="resenas">
        <div>
          <h2>{t("3. Consigue más reseñas", "3. Get more reviews")}</h2>
          <p className="small muted">
            {t(
              "Las reseñas nuevas y contestadas son de lo que más ayuda a salir en Google Maps.",
              "New, answered reviews are one of the things that help most to show up on Google Maps.",
            )}
          </p>
        </div>

        {r ? (
          <div className={s.revStats}>
            <div className={s.stat}>
              <span className={s.statNum}>{r.rating != null ? `${fmtNum.format(r.rating)}★` : "—"}</span>
              <span className={s.statLabel}>{t("calificación", "rating")}</span>
            </div>
            <div className={s.stat}>
              <span className={s.statNum}>{r.total ?? "—"}</span>
              <span className={s.statLabel}>{t("reseñas", "reviews")}</span>
            </div>
            <div className={s.stat}>
              <span className={s.statNum}>{r.last30}</span>
              <span className={s.statLabel}>{t("en los últimos 30 días", "in the last 30 days")}</span>
            </div>
            <div className={s.stat}>
              <span className={`${s.statNum} ${r.unanswered ? s.statBad : s.statOk}`}>{r.unanswered}</span>
              <span className={s.statLabel}>{t("sin contestar", "unanswered")}</span>
            </div>
          </div>
        ) : null}
        <p className="small">
          {r?.at && <span className="muted">{t(`Datos del ${fmtDate(r.at, "es")}. `, `Data from ${fmtDate(r.at, "en")}. `)}</span>}
          {r?.unanswered
            ? t(`Tienes ${r.unanswered} sin contestar: `, `You have ${r.unanswered} unanswered: `)
            : ""}
          <a href={seo("local", "perfil")}>{r?.unanswered ? t("contéstalas con ayuda de la IA", "reply with the AI's help") : t("Ver y contestar tus reseñas", "See and reply to your reviews")}</a>
          {!r && t(" (ahí también puedes traer tus reseñas de Google).", " (you can also load your Google reviews there).")}
        </p>

        <h3 className={s.h3}>{t("Tu link y tu código QR", "Your link and QR code")}</h3>
        {d.reviewLink ? (
          <ReviewLink businessId={id} link={d.reviewLink} qrSvg={qrSvg(d.reviewLink, { ecc: "M", margin: 2, dark: "#000000", light: "#ffffff" })} />
        ) : (
          <div className="note info">
            {t(
              "Para armar tu link de reseñas necesitamos saber cuál es tu negocio en Google Maps. ",
              "To build your review link we need to know which one is your business on Google Maps. ",
            )}
            <a href={seo("local", "mapa")}>{t("Elige tu negocio en el mapa", "Pick your business on the map")}</a>
            {t(" o actualiza tu ", " or refresh your ")}
            <a href={seo("local", "perfil")}>{t("Perfil de Google", "Google profile")}</a>.
            <details className={s.more}>
              <summary>{t("¿Cómo lo conecto?", "How do I connect it?")}</summary>
              <p className="small">
                {t(
                  "El link usa el «ID del lugar» (place_id) de tu ficha de Google. Lo tomamos de tu Perfil de Google guardado o del negocio que elegiste para el mapa de calor. También puedes sacarlo tú: en business.google.com → «Pedir reseñas» te da un link corto.",
                  "The link uses your Google listing's “Place ID” (place_id). We take it from your saved Google profile or the business you picked for the heatmap. You can also get one yourself: on business.google.com → “Ask for reviews” gives you a short link.",
                )}
              </p>
            </details>
          </div>
        )}

        <h3 className={s.h3}>{t("Pedir reseñas a tus clientes", "Ask your customers for reviews")}</h3>
        {d.reviewLink ? (
          <ReviewRequest
            businessId={id}
            link={d.reviewLink}
            contacts={d.contacts}
            recentlyAsked={d.recentlyAsked}
            sentToday={d.sentToday}
            dailyMax={REVIEW_DAILY_MAX}
            cooldownDays={REVIEW_COOLDOWN_DAYS}
            templates={templates}
            connected={{ email: conns.some((c) => c.channel === "email"), sms: conns.some((c) => c.channel === "sms") }}
            history={d.requests.map((x) => ({ ...x, at: x.at.toISOString() }))}
          />
        ) : (
          <p className="small muted">{t("Cuando tengamos tu link, aquí podrás mandarlo por email o SMS a tus clientes.", "Once we have your link, you'll be able to send it here by email or SMS to your customers.")}</p>
        )}
      </section>
    </>
  );
}
