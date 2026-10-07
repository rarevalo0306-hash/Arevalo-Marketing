"use client";

// «Tus fotos» en Nueva publicación: elegir una foto o video de la carpeta de Drive del negocio.
// Va en un portal a <body>: con el estilo Vidrio el desenfoque de las tarjetas encerraría lo que es «fixed».
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/I18n";
import { errorText } from "@/lib/i18n";
import { cardMatches, fmtDuration, type LibraryCard } from "@/lib/library-match";
import s from "./LibraryPicker.module.css";

type Props = {
  onClose: () => void;
  load: () => Promise<LibraryCard[]>;
  /** Devuelve un error en palabras simples, o "" si quedó puesta. */
  onPick: (c: LibraryCard) => Promise<string>;
  manageHref: string;
};

export function LibraryPicker({ onClose, load, onPick, manageHref }: Props) {
  const { lang, t } = useT();
  const [items, setItems] = useState<LibraryCard[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    load()
      .then((x) => alive && setItems(x))
      .catch((e) => alive && setLoadError(errorText(e, lang)));
    return () => {
      alive = false;
    };
    // Una vez al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [busy, onClose]);

  const shown = useMemo(() => (items ?? []).filter((c) => cardMatches(c, query)), [items, query]);

  async function pick(c: LibraryCard) {
    setError("");
    setBusy(c.id);
    try {
      const why = await onPick(c);
      if (why) setError(why);
      else onClose();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy("");
    }
  }

  return createPortal(
    <>
      <div className={s.backdrop} onClick={() => !busy && onClose()} aria-hidden="true" />
      <div className={s.sheet} role="dialog" aria-modal="true" aria-labelledby="lib-title">
        <div className={s.head}>
          <div>
            <h2 id="lib-title">{t("Tus fotos", "Your photos")}</h2>
            <p>{t("Fotos y videos de tu carpeta de Google Drive que se pueden publicar.", "Photos and videos from your Google Drive folder that can be posted.")}</p>
          </div>
          <button type="button" className={s.close} onClick={onClose} disabled={!!busy} aria-label={t("Cerrar", "Close")}>
            ×
          </button>
        </div>
        {(items?.length ?? 0) > 0 && (
          <div className={s.search}>
            <label htmlFor="lib-search" className="sr-only">
              {t("Buscar", "Search")}
            </label>
            <input
              id="lib-search"
              type="search"
              className="field"
              placeholder={t("Buscar: cortina, techo, antes, después…", "Search: door, roof, before, after…")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
        {error && (
          <p className={`note error ${s.err}`} role="alert">
            {error}
          </p>
        )}
        <div className={s.list}>
          {loadError ? (
            <p className={`${s.state} note error`}>{loadError}</p>
          ) : items === null ? (
            <p className={s.state} role="status">
              {t("Cargando tus fotos…", "Loading your photos…")}
            </p>
          ) : items.length === 0 ? (
            <div className={s.state}>
              <span>
                {t(
                  "Todavía no hay fotos listas para usar. Conecta tu carpeta de Google Drive o revisa las que necesitan tu aprobación.",
                  "There are no photos ready to use yet. Connect your Google Drive folder or check the ones that need your approval.",
                )}
              </span>
              <Link className="btn outline" href={manageHref}>
                {t("Ir a Tus fotos", "Go to Your photos")}
              </Link>
            </div>
          ) : shown.length === 0 ? (
            <p className={s.state}>{t("Ninguna foto coincide con lo que buscas.", "No photo matches your search.")}</p>
          ) : (
            shown.map((c) => {
              const desc = c.description ? c.description[lang] : c.name;
              return (
                <button key={c.id} type="button" className={`${s.pick} ${busy === c.id ? s.pickOn : ""}`} disabled={!!busy} onClick={() => void pick(c)} title={desc}>
                  <span className={s.img}>
                    {c.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element -- copia guardada de la foto
                      <img src={c.thumb} alt="" loading="lazy" />
                    ) : (
                      <span aria-hidden="true">▶</span>
                    )}
                    {c.kind === "video" && <span className={s.badge}>▶ {c.durationSec > 0 ? fmtDuration(c.durationSec) : t("Video", "Video")}</span>}
                  </span>
                  <span className={s.desc}>{busy === c.id ? (c.kind === "video" ? t("Trayendo el video de Drive…", "Getting the video from Drive…") : t("Poniendo la foto…", "Adding the photo…")) : desc}</span>
                  {c.usedCount > 0 && busy !== c.id && <span className={s.used}>{t(`Usada ${c.usedCount} ${c.usedCount === 1 ? "vez" : "veces"}`, `Used ${c.usedCount}×`)}</span>}
                </button>
              );
            })
          )}
        </div>
        <div className={s.foot}>
          <Link href={manageHref}>{t("Ver y ordenar todas tus fotos", "See and manage all your photos")}</Link>
        </div>
      </div>
    </>,
    document.body,
  );
}
