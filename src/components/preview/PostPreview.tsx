"use client";

// Vista previa por red: pestañas con las redes elegidas y, debajo, una sola vista a la vez (en el celular se cambia
// también deslizando el dedo). Cada pestaña marca si hay algo que revisar (muy largo, falta la foto…).
// Reutilizable (Fase 4): recibe la marca, el texto de cada canal y la foto de cada canal.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/I18n";
import { channelName, type ChannelId } from "@/lib/channels";
import { channelOfView, countFor, isNetworkView, NETWORKS, previewNotes, viewsFor, type PreviewView } from "@/lib/preview";
import { NetworkPreview, type PreviewBrand, type PreviewMediaInfo } from "./NetworkPreview";
import s from "./preview.module.css";

export type { PreviewBrand, PreviewMediaInfo };

export type PostPreviewProps = {
  brand: PreviewBrand;
  /** Canales elegidos, en orden. */
  channels: ChannelId[];
  /** Texto de cada canal (o el mismo para todos). */
  textFor: (channel: ChannelId) => string;
  /** La foto o el video de cada canal (la exacta, si se puede pedir). */
  mediaFor: (channel: ChannelId) => PreviewMediaInfo;
  /** Agrega la vista de historia de Instagram para fotos (cuando se publiquen historias). */
  stories?: boolean;
  /** Pestaña elegida (si el que la usa quiere controlarla). */
  active?: PreviewView | null;
  onActive?: (view: PreviewView) => void;
  /** Lo que se ve en las pestañas sin vista propia (email, SMS, web). */
  renderOther?: (channel: ChannelId) => ReactNode;
  /** Debajo de la vista: por ejemplo, el texto solo para esa red. */
  below?: (view: PreviewView, channel: ChannelId) => ReactNode;
};

const VIEW_NAME: Record<string, { es: string; en: string }> = {
  "instagram-story": { es: "Instagram · Reel", en: "Instagram · Reel" },
};

export function PostPreview(p: PostPreviewProps) {
  const { lang, t } = useT();
  const mediaType = p.channels.length ? p.mediaFor(p.channels[0]).type : "none";
  const views = viewsFor(p.channels, mediaType, { stories: p.stories });
  const [own, setOwn] = useState<PreviewView | null>(null);
  const wanted = p.active !== undefined ? p.active : own;
  const view = views.find((v) => v === wanted) ?? views[0];
  const touch = useRef<{ x: number; y: number } | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  // La pestaña elegida siempre a la vista dentro de la fila (sin mover la página).
  useEffect(() => {
    const row = tabsRef.current;
    const btn = row?.querySelector<HTMLElement>(`[data-view="${view}"]`);
    if (!row || !btn) return;
    if (btn.offsetLeft < row.scrollLeft || btn.offsetLeft + btn.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollTo({ left: Math.max(0, btn.offsetLeft - 24), behavior: "smooth" });
  }, [view]);
  if (!view) return <p className="empty">{t("Elige al menos un canal para ver la vista previa.", "Pick at least one channel to see the preview.")}</p>;

  const pick = (v: PreviewView) => {
    setOwn(v);
    p.onActive?.(v);
  };
  const statusOf = (v: PreviewView): "error" | "warn" | "ok" => {
    if (!isNetworkView(v)) return "ok";
    const c = channelOfView(v);
    const notes = previewNotes(p.textFor(c), NETWORKS[v], p.mediaFor(c).type);
    return notes.some((n) => n.level === "error") ? "error" : notes.some((n) => n.level === "warn") ? "warn" : "ok";
  };
  const nameOf = (v: PreviewView) => VIEW_NAME[v]?.[lang] ?? (isNetworkView(v) ? NETWORKS[v].name[lang] : channelName(v, lang));
  const idx = views.indexOf(view);
  const step = (d: number) => pick(views[(idx + d + views.length) % views.length]);
  const channel = channelOfView(view);
  const text = p.textFor(channel);
  const notes = isNetworkView(view) ? previewNotes(text, NETWORKS[view], p.mediaFor(channel).type) : [];

  return (
    <div className={s.wrap}>
      <div ref={tabsRef} className={s.tabs} role="tablist" aria-label={t("Redes", "Networks")}>
        {views.map((v) => {
          const st = statusOf(v);
          return (
            <button
              key={v}
              type="button"
              role="tab"
              id={`pv-tab-${v}`}
              data-view={v}
              aria-controls="pv-panel"
              aria-selected={v === view}
              className={v === view ? `${s.chip} ${s.chipOn}` : s.chip}
              onClick={() => pick(v)}
            >
              {nameOf(v)}
              {st !== "ok" && <span className={st === "error" ? `${s.dot} ${s.dotError}` : s.dot} aria-label={st === "error" ? t("hay que corregir algo", "needs a fix") : t("revisa un aviso", "check a note")} />}
            </button>
          );
        })}
      </div>
      <div
        id="pv-panel"
        role="tabpanel"
        aria-labelledby={`pv-tab-${view}`}
        className={s.panel}
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          const st = touch.current;
          touch.current = null;
          if (!st || views.length < 2) return;
          const dx = e.changedTouches[0].clientX - st.x;
          const dy = e.changedTouches[0].clientY - st.y;
          // Deslizar a los lados (no al bajar la página) cambia de red.
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
        }}
      >
        {isNetworkView(view) ? (
          <NetworkPreview key={view} kind={view} brand={p.brand} text={text} media={p.mediaFor(channel)} count={countFor(text, NETWORKS[view])} />
        ) : (
          p.renderOther?.(channel)
        )}
        {views.length > 1 && (
          <div className={s.pager}>
            <button type="button" className="btn small" onClick={() => step(-1)} aria-label={t("Red anterior", "Previous network")}>‹</button>
            <span className="small muted">{idx + 1} / {views.length}</span>
            <button type="button" className="btn small" onClick={() => step(1)} aria-label={t("Red siguiente", "Next network")}>›</button>
          </div>
        )}
      </div>
      {notes.length > 0 && (
        <ul className={s.notes}>
          {notes.map((n) => (
            <li key={n.id} className={n.level === "error" ? `note error ${s.noteItem}` : n.level === "warn" ? `note ${s.noteItem}` : `note ${s.noteItem} ${s.tip}`}>{n[lang]}</li>
          ))}
        </ul>
      )}
      {p.below?.(view, channel)}
    </div>
  );
}
