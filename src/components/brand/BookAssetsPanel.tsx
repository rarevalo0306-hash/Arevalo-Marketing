"use client";

// "Imágenes de tu manual": lo que la IA sacó del manual de marca, agrupado (logos, símbolo, patrones, íconos,
// ejemplos de piezas, fotos). El dueño acepta o rechaza cada una; las aceptadas se pueden usar como logo o plantilla.
import { useEffect, useState, useTransition } from "react";
import { acceptAllBookAssets, applyBookAsset, decideBookAsset } from "@/app/actions-brand-book";
import { useT } from "@/components/I18n";
import type { BrandAsset, BrandAssetKind, BrandAssetStatus } from "@/lib/brand-assets";
import { intlLocale } from "@/lib/i18n";
import { BOOK_FILE_TYPES } from "@/lib/pdf-pages";
import s from "./BookAssets.module.css";
import { bookRunBusy, bookRunText, clearBookRun, resumeBookRun, setBookRunEnabled, startBookRun, useBookRun } from "./BookRun";

type Props = {
  businessId: string;
  /** Hay clave de Gemini en el servidor. */
  canRead: boolean;
  /** El manual guardado (vacío si no hay o sin Supabase). */
  bookUrl: string;
  readAt: string;
  pages: number;
  /** Solo las del manual (source "book"). */
  items: BrandAsset[];
  logoUrl: string;
  logoLightUrl: string;
  /** Imágenes que ya son plantillas del negocio. */
  templateUrls: string[];
};

type Group = { id: string; kinds: BrandAssetKind[]; es: string; en: string };
const GROUPS: Group[] = [
  { id: "logos", kinds: ["logo", "logo-light", "logo-dark"], es: "Logos", en: "Logos" },
  { id: "simbolo", kinds: ["isotype"], es: "Símbolo", en: "Symbol" },
  { id: "patrones", kinds: ["pattern"], es: "Patrones y fondos", en: "Patterns and backgrounds" },
  { id: "iconos", kinds: ["icon"], es: "Íconos", en: "Icons" },
  { id: "piezas", kinds: ["template"], es: "Ejemplos de piezas", en: "Example pieces" },
  { id: "fotos", kinds: ["photo"], es: "Fotos", en: "Photos" },
];

const LOGO_KINDS: BrandAssetKind[] = ["logo", "logo-light", "logo-dark", "isotype"];

/** Botón que abre el selector de archivos para elegir el manual (PDF o imagen). */
function PickBook({ businessId, label, disabled }: { businessId: string; label: string; disabled: boolean }) {
  return (
    <label className={`btn ${s.pick}`} aria-disabled={disabled} style={{ cursor: disabled ? "wait" : "pointer" }}>
      {label}
      <input
        type="file"
        accept={BOOK_FILE_TYPES.join(",")}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void startBookRun(businessId, f);
        }}
      />
    </label>
  );
}

/** El avance de la lectura (o el error, o el "listo"). */
function RunStatus({ businessId }: { businessId: string }) {
  const run = useBookRun();
  const { lang, t } = useT();
  if (run.status === "idle" || run.businessId !== businessId) return null;
  if (run.status === "error") {
    return (
      <div className={`note error ${s.runNote}`} role="alert">
        <span>{run.error ? (lang === "en" ? run.error.en : run.error.es) : t("Algo salió mal.", "Something went wrong.")}</span>
        <span className="row" style={{ gap: 8 }}>
          {run.canResume && (
            <button type="button" className="btn" onClick={() => void resumeBookRun()}>
              {run.read ? t(`Seguir desde la página ${run.from}`, `Continue from page ${run.from}`) : t("Intentar de nuevo", "Try again")}
            </button>
          )}
          <button type="button" className="btn link" onClick={clearBookRun}>{t("Cerrar", "Close")}</button>
        </span>
      </div>
    );
  }
  if (run.status === "done") {
    return (
      <div className={`note ${run.added ? "ok" : "info"} ${s.runNote}`} role="status">
        <span>{bookRunText(run, t)}</span>
        <button type="button" className="btn link" onClick={clearBookRun}>{t("Cerrar", "Close")}</button>
      </div>
    );
  }
  const total = Math.max(1, run.total);
  // Abrir el archivo es la primera parte (rápida); leer con la IA, la segunda.
  const pct = run.status === "opening" ? (run.prepared / total) * 15 : 15 + (run.read / total) * 85;
  return (
    <div className={s.progress} role="status" aria-live="polite">
      <div className="row between" style={{ gap: 8 }}>
        <strong className={s.progressText}>{bookRunText(run, t)}</strong>
        {run.added > 0 && <span className="pill done">{t(`${run.added} encontradas`, `${run.added} found`)}</span>}
      </div>
      <div className={s.bar} aria-hidden>
        <span style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} />
      </div>
      <span className="small muted">{t("Puedes seguir trabajando en esta página mientras tanto. Las imágenes aparecen aquí a medida que la IA las encuentra.", "You can keep working on this page meanwhile. Images show up here as the AI finds them.")}</span>
    </div>
  );
}

function AssetCard({ a, businessId, logoUrl, logoLightUrl, isTemplate, onMessage }: { a: BrandAsset; businessId: string; logoUrl: string; logoLightUrl: string; isTemplate: boolean; onMessage: (m: { ok: boolean; text: string }) => void }) {
  const { lang, t } = useT();
  const [pending, start] = useTransition();
  const [doing, setDoing] = useState("");
  const pick = (x: { es: string; en: string }) => (lang === "en" ? x.en : x.es);
  const label = pick(a.label);
  const go = (what: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
    setDoing(what);
    start(async () => {
      try {
        const r = await fn();
        if (r.message) onMessage({ ok: r.ok, text: r.message });
      } catch {
        onMessage({ ok: false, text: t("No se pudo guardar. Revisa tu internet e intenta de nuevo.", "Couldn't save. Check your internet and try again.") });
      }
    });
  };
  const decide = (status: BrandAssetStatus) => go(status, () => decideBookAsset(businessId, a.id, status));
  const isMain = a.url === logoUrl;
  const isLight = a.url === logoLightUrl;
  const busyText = (what: string, idle: string) => (pending && doing === what ? t("Guardando…", "Saving…") : idle);

  return (
    <li className={`${s.item} ${a.status === "accepted" ? s.accepted : ""} ${a.status === "rejected" ? s.rejected : ""}`} aria-busy={pending}>
      <div className={`${s.thumb} ${a.kind === "logo-light" ? s.thumbDark : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a.url} alt={label} loading="lazy" />
      </div>
      <div className={s.body}>
        <div className={s.meta}>
          <strong className={s.label}>{label}</strong>
          <span className="small muted">
            {a.page ? t(`Página ${a.page}`, `Page ${a.page}`) : ""}
            {a.page && a.note ? " · " : ""}
            {a.note ? pick(a.note) : ""}
          </span>
          {(isMain || isLight || isTemplate || a.status === "accepted") && (
            <span className={s.badges}>
              {a.status === "accepted" && <span className="pill done">{t("Aceptada", "Accepted")}</span>}
              {isMain && <span className="pill info">{t("Tu logo principal", "Your main logo")}</span>}
              {isLight && <span className="pill info">{t("Logo para fondos oscuros", "Dark-background logo")}</span>}
              {isTemplate && <span className="pill info">{t("Ya es una plantilla", "Already a template")}</span>}
            </span>
          )}
        </div>
        <div className={s.actions}>
          {a.status === "proposed" && (
            <>
              <button type="button" className={`btn ${s.yes}`} disabled={pending} onClick={() => decide("accepted")} aria-label={t(`Aceptar ${label}`, `Accept ${label}`)}>
                {busyText("accepted", t("✓ Aceptar", "✓ Accept"))}
              </button>
              <button type="button" className={`btn ${s.no}`} disabled={pending} onClick={() => decide("rejected")} aria-label={t(`Rechazar ${label}`, `Reject ${label}`)}>
                {busyText("rejected", t("✗ Rechazar", "✗ Reject"))}
              </button>
            </>
          )}
          {a.status === "accepted" && (
            <>
              {LOGO_KINDS.includes(a.kind) && a.kind !== "logo-light" && !isMain && (
                <button type="button" className="btn" disabled={pending} onClick={() => go("logo", () => applyBookAsset(businessId, a.id, "logo"))}>
                  {busyText("logo", t("Usar como logo principal", "Use as main logo"))}
                </button>
              )}
              {a.kind === "logo-light" && !isLight && (
                <button type="button" className="btn" disabled={pending} onClick={() => go("light", () => applyBookAsset(businessId, a.id, "logoLight"))}>
                  {busyText("light", t("Usar para fondos oscuros", "Use on dark backgrounds"))}
                </button>
              )}
              {a.kind === "template" && !isTemplate && (
                <button type="button" className="btn" disabled={pending} onClick={() => go("template", () => applyBookAsset(businessId, a.id, "template"))}>
                  {busyText("template", t("Usar como plantilla", "Use as template"))}
                </button>
              )}
              <button type="button" className={`btn link ${s.remove}`} disabled={pending} onClick={() => decide("rejected")} aria-label={t(`Quitar ${label}`, `Remove ${label}`)}>
                {busyText("rejected", t("Quitar", "Remove"))}
              </button>
            </>
          )}
          {a.status === "rejected" && (
            <button type="button" className="btn" disabled={pending} onClick={() => decide("proposed")} aria-label={t(`Recuperar ${label}`, `Restore ${label}`)}>
              {busyText("proposed", t("↺ Recuperar", "↺ Restore"))}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export function BookAssetsPanel({ businessId, canRead, bookUrl, readAt, pages, items, logoUrl, logoLightUrl, templateUrls }: Props) {
  const { lang, t } = useT();
  const run = useBookRun();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [allPending, startAll] = useTransition();
  useEffect(() => setBookRunEnabled(canRead), [canRead]);

  const busy = bookRunBusy() && run.businessId === businessId;
  const visible = items.filter((a) => a.status !== "rejected");
  const rejected = items.filter((a) => a.status === "rejected");
  const proposed = items.filter((a) => a.status === "proposed");
  const tpl = new Set(templateUrls);
  const card = (a: BrandAsset) => (
    <AssetCard key={a.id} a={a} businessId={businessId} logoUrl={logoUrl} logoLightUrl={logoLightUrl} isTemplate={tpl.has(a.url)} onMessage={setMessage} />
  );
  const cost = t("Cuesta unos centavos por manual.", "It costs a few cents per brand book.");

  // Sin imágenes todavía: una línea corta y el botón, no una tarjeta grande vacía.
  if (!items.length && run.businessId !== businessId) {
    return (
      <section className={`card ${s.slim}`} id="imagenes-manual" aria-label={t("Imágenes de tu manual", "Images from your brand book")}>
        {canRead ? (
          <>
            <p className={s.slimText}>
              <strong>{t("¿Tienes tu manual de marca?", "Have a brand book?")}</strong>{" "}
              {t("La IA puede sacar de ahí tus logos, el símbolo, los patrones y ejemplos de piezas.", "The AI can pull your logos, symbol, patterns, and example pieces out of it.")}{" "}
              <span className="muted">{cost}</span>
            </p>
            <div className={`row ${s.slimButtons}`}>
              {bookUrl && (
                <button type="button" className="btn on" onClick={() => void startBookRun(businessId, bookUrl)}>
                  {t("Sacar logos e imágenes del manual", "Pull logos and images from the brand book")}
                </button>
              )}
              <PickBook businessId={businessId} label={bookUrl ? t("Elegir otro archivo", "Pick another file") : t("Elegir el manual", "Pick the brand book")} disabled={false} />
            </div>
          </>
        ) : (
          <p className={`small muted ${s.slimText}`}>
            {t("Para sacar logos e imágenes de tu manual de marca hace falta la clave de Gemini (la IA de Google).", "Pulling logos and images from your brand book needs the Gemini key (Google's AI).")}
          </p>
        )}
      </section>
    );
  }

  const when = readAt ? new Date(readAt).toLocaleDateString(intlLocale(lang), { day: "numeric", month: "short", year: "numeric" }) : "";

  return (
    <section className="card" id="imagenes-manual" aria-labelledby="imagenes-manual-title">
      <div className="stack" style={{ gap: 4 }}>
        <h2 id="imagenes-manual-title">{t("Imágenes de tu manual", "Images from your brand book")}</h2>
        <p className="small muted">
          {items.length
            ? t(
                "La IA sacó estas imágenes de tu manual de marca. Acepta las que quieras usar en tus diseños; las que rechaces no se usan.",
                "The AI pulled these images from your brand book. Accept the ones you want to use in your designs; the ones you reject aren't used.",
              )
            : t(
                "La IA busca en tu manual los logos, el símbolo, los patrones, íconos, fotos y ejemplos de piezas. Después tú decides cuáles usar.",
                "The AI looks in your brand book for logos, the symbol, patterns, icons, photos, and example pieces. Then you decide which ones to use.",
              )}
        </p>
      </div>

      <RunStatus businessId={businessId} />

      {proposed.length > 0 && (
        <div className={s.toolbar}>
          <span className={s.count}>
            {t(`${proposed.length} por revisar`, `${proposed.length} to review`)}
          </span>
          <button
            type="button"
            className="btn on"
            disabled={allPending}
            onClick={() =>
              startAll(async () => {
                try {
                  const r = await acceptAllBookAssets(businessId);
                  if (r.message) setMessage({ ok: r.ok, text: r.message });
                } catch {
                  setMessage({ ok: false, text: t("No se pudo guardar. Revisa tu internet e intenta de nuevo.", "Couldn't save. Check your internet and try again.") });
                }
              })
            }
          >
            {allPending ? t("Guardando…", "Saving…") : t("✓ Aceptar todas", "✓ Accept all")}
          </button>
        </div>
      )}

      {message && (
        <p className={`note ${message.ok ? "ok" : "error"} ${s.runNote}`} role="status">
          <span>{message.text}</span>
          <button type="button" className="btn link" onClick={() => setMessage(null)}>{t("Cerrar", "Close")}</button>
        </p>
      )}

      <div className={s.groups}>
      {GROUPS.map((g) => {
        const list = visible
          .filter((a) => g.kinds.includes(a.kind))
          .sort((x, y) => (x.status === y.status ? (x.page ?? 0) - (y.page ?? 0) : x.status === "proposed" ? -1 : 1));
        if (!list.length) return null;
        return (
          <div key={g.id} className={`${s.group} ${list.length > 2 ? s.wide : ""}`}>
            <h3 className={s.groupTitle}>
              {lang === "en" ? g.en : g.es} <span className="muted">({list.length})</span>
            </h3>
            <ul className={s.grid}>{list.map(card)}</ul>
          </div>
        );
      })}
      </div>

      {items.length > 0 && !visible.length && !busy && (
        <p className="small muted">{t("No queda ninguna imagen por revisar.", "There are no images left to review.")}</p>
      )}

      {rejected.length > 0 && (
        <details className={s.rejectedBox}>
          <summary>{t(`Ver rechazadas (${rejected.length})`, `See rejected (${rejected.length})`)}</summary>
          <ul className={s.grid}>{rejected.map(card)}</ul>
        </details>
      )}

      <div className={s.footer}>
        <span className="small muted">
          {when
            ? t(`Leímos tu manual el ${when}${pages ? ` (${pages} ${pages === 1 ? "página" : "páginas"})` : ""}.`, `We read your brand book on ${when}${pages ? ` (${pages} ${pages === 1 ? "page" : "pages"})` : ""}.`)
            : ""}{" "}
          {cost} {items.length > 0 && t("Al volver a leerlo, las que no aceptaste se reemplazan.", "Reading it again replaces the ones you didn't accept.")}
        </span>
        {canRead && !busy && (
          <div className="row" style={{ gap: 8 }}>
            {bookUrl && (
              <button type="button" className="btn" onClick={() => void startBookRun(businessId, bookUrl)}>
                {items.length ? t("Volver a leer el manual", "Read the brand book again") : t("Sacar logos e imágenes del manual", "Pull logos and images from the brand book")}
              </button>
            )}
            <PickBook businessId={businessId} label={bookUrl ? t("Elegir otro archivo", "Pick another file") : t("Elegir el manual", "Pick the brand book")} disabled={false} />
          </div>
        )}
      </div>
    </section>
  );
}
