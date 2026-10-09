"use client";

// Cómo se ve una publicación en una red (Instagram, Facebook, LinkedIn, Google, X, TikTok): el nombre y el logo de
// la cuenta, la foto con el recorte de esa red, el texto cortado donde la red pone «… más», los hashtags y los
// enlaces con su color. Reutilizable: recibe la marca, el texto y la foto; no sabe nada del compositor.
import { useRef, useState } from "react";
import { useT } from "@/components/I18n";
import { DESIGN_SHAPES } from "@/lib/design-shapes";
import { mediaFrame, NETWORKS, pieces, truncateForPreview, type NetworkSpec, type PreviewKind } from "@/lib/preview";
import s from "./preview.module.css";

export type PreviewBrand = {
  name: string;
  color: string;
  logoUrl?: string;
  /** Nombre de usuario (@…). Si no viene, se arma con el nombre. */
  handle?: string;
  website?: string;
};

export type PreviewMediaInfo = {
  type: "none" | "photo" | "video";
  /** La foto o el video tal como está (puede ser blob: mientras sube). */
  url: string;
  /** La foto exacta que se manda a esta red (ya recortada o dibujada en su forma), si se puede pedir. */
  exactUrl?: string;
  /** Es un diseño con la marca (se vuelve a dibujar en la forma de cada red). */
  design?: boolean;
  /** La foto puede tener letras (entonces no se recorta: se centra). */
  hasText?: boolean;
  /** Carrusel: todas las fotos en orden (la primera es `url`), con la exacta de esta red si se puede pedir. */
  items?: { url: string; exactUrl?: string; alt?: string }[];
};

/** Cuántas fotos de un carrusel muestra cada red (Google: solo la primera). */
const CAROUSEL_SHOWN: Partial<Record<PreviewKind, number>> = { instagram: 10, facebook: 10, linkedin: 20, x: 4 };

const handleOf = (b: PreviewBrand) => b.handle?.replace(/^@/, "") || b.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");

function Avatar({ brand, square }: { brand: PreviewBrand; square?: boolean }) {
  const cls = square ? `${s.avatar} ${s.avatarSq}` : s.avatar;
  if (brand.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- logo del negocio (puede ser /media/… o del almacenamiento)
    return <img src={brand.logoUrl} alt="" className={`${cls} ${s.avatarImg}`} />;
  }
  return (
    <span className={cls} style={{ background: brand.color }} aria-hidden="true">
      {brand.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** El texto con enlaces y hashtags de color, cortado donde la red pone «… más» (tocando «más» se ve todo). */
function PostText({ text, spec, lead, dark }: { text: string; spec: NetworkSpec; lead?: string; dark?: boolean }) {
  const { lang, t } = useT();
  const [open, setOpen] = useState(false);
  const { shown, cut } = truncateForPreview(text, spec);
  const body = open || !cut ? text : shown;
  const linkCls = spec.linksClickable ? s.link : s.plainLink;
  return (
    <p className={dark ? `${s.text} ${s.textDark}` : s.text}>
      {lead && <strong className={s.lead}>{lead} </strong>}
      {text.trim() ? (
        pieces(body).map((p, i) =>
          p.kind === "break" ? <br key={i} /> : p.kind === "link" ? <span key={i} className={linkCls}>{p.value}</span> : p.kind === "tag" ? <span key={i} className={s.tag}>{p.value}</span> : <span key={i}>{p.value}</span>,
        )
      ) : (
        <span className={s.placeholder}>{t("Tu mensaje aparecerá aquí.", "Your message will appear here.")}</span>
      )}
      {cut && !open && (
        <>
          {"… "}
          <button type="button" className={s.more} onClick={() => setOpen(true)} aria-label={t(`Ver el texto completo (en ${spec.name.es} aparece «${spec.more.es}»)`, `Show the full text (${spec.name.en} shows "${spec.more.en}")`)}>
            {spec.more[lang]}
          </button>
        </>
      )}
    </p>
  );
}

/**
 * La foto o el video en el cuadro de la red. Mientras llega la foto exacta (la que se publica), se muestra la
 * original con el mismo recorte; si la exacta no se puede pedir, se queda la simulación.
 */
function MediaBox({ media, spec, rounded }: { media: PreviewMediaInfo; spec: NetworkSpec; rounded?: boolean }) {
  const { t } = useT();
  const [ratio, setRatio] = useState<number | null>(null);
  // La foto exacta (la que se publica) ya viene en su forma: cuando llega, el cuadro toma su proporción.
  const [exactRatio, setExactRatio] = useState<number | null>(null);
  const [exactFailed, setExactFailed] = useState(false);
  const exactOk = exactRatio !== null;
  if (media.type === "none" || !media.url) return null;
  const sim = mediaFrame(spec, ratio, { hasText: media.hasText ?? true, design: media.design });
  const frame = exactOk ? { ratio: exactRatio, fit: "cover" as const } : sim;
  const useExact = media.type === "photo" && !!media.exactUrl && !exactFailed;
  const cls = rounded ? `${s.media} ${s.mediaRound}` : s.media;
  return (
    <div className={cls} style={{ aspectRatio: String(frame.ratio) }}>
      {media.type === "video" ? (
        <video src={media.url} className={s.fill} muted playsInline controls preload="metadata" onLoadedMetadata={(e) => setRatio(e.currentTarget.videoWidth / Math.max(1, e.currentTarget.videoHeight))} />
      ) : (
        <>
          {frame.fit === "blur" && !exactOk && (
            // eslint-disable-next-line @next/next/no-img-element -- fondo desenfocado de la simulación
            <img src={media.url} alt="" aria-hidden="true" className={`${s.fill} ${s.blur}`} />
          )}
          {!exactOk && (
            // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) o enlace externo
            <img
              src={media.url}
              alt={t("Foto de la publicación", "Post photo")}
              className={s.fill}
              style={{ objectFit: frame.fit === "cover" ? "cover" : "contain" }}
              onLoad={(e) => setRatio(e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight))}
            />
          )}
          {useExact && (
            // eslint-disable-next-line @next/next/no-img-element -- la foto exacta para esta red (la dibuja el servidor)
            <img
              src={media.exactUrl}
              alt={exactOk ? t("Foto de la publicación", "Post photo") : ""}
              className={s.fill}
              style={exactOk ? { objectFit: "cover" } : { opacity: 0 }}
              onLoad={(e) => setExactRatio(e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight))}
              onError={() => setExactFailed(true)}
            />
          )}
          {useExact && !exactOk && <span className={s.badge}>{t(`Preparando el tamaño de ${spec.name.es}…`, `Preparing the ${spec.name.en} size…`)}</span>}
        </>
      )}
    </div>
  );
}

/** Carrusel: las fotos una al lado de la otra; se pasan con el dedo (sin cambiar de red), con flechas y puntos. */
function Carousel({ media, spec, rounded, max }: { media: PreviewMediaInfo; spec: NetworkSpec; rounded?: boolean; max: number }) {
  const { t } = useT();
  const items = (media.items ?? []).slice(0, max);
  const [i, setI] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const f = spec.format;
  const ratio = f ? DESIGN_SHAPES[f.shape].w / DESIGN_SHAPES[f.shape].h : 1;
  const go = (n: number) => {
    const el = track.current;
    if (!el) return;
    const k = Math.max(0, Math.min(items.length - 1, n));
    el.scrollTo({ left: k * el.clientWidth, behavior: "smooth" });
    setI(k);
  };
  const stop = (e: React.TouchEvent) => e.stopPropagation();
  return (
    <div className={rounded ? `${s.car} ${s.carRound}` : s.car} onTouchStart={stop} onTouchEnd={stop} role="group" aria-roledescription={t("carrusel", "carousel")} aria-label={t(`Carrusel de ${items.length} fotos`, `Carousel of ${items.length} photos`)}>
      <div
        ref={track}
        className={s.carTrack}
        style={{ aspectRatio: String(ratio) }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const n = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (n !== i) setI(n);
        }}
      >
        {items.map((it, n) => (
          <div key={`${it.url}-${n}`} className={s.carSlide} aria-hidden={n !== i}>
            {/* eslint-disable-next-line @next/next/no-img-element -- foto del carrusel (la exacta de esta red si se puede) */}
            <img
              src={it.exactUrl ?? it.url}
              alt={it.alt || t(`Foto ${n + 1} del carrusel`, `Carousel photo ${n + 1}`)}
              loading={n > 1 ? "lazy" : undefined}
              onError={(e) => {
                if (it.exactUrl && e.currentTarget.src !== new URL(it.url, window.location.href).href) e.currentTarget.src = it.url;
              }}
            />
          </div>
        ))}
      </div>
      <span className={s.carCount}>{i + 1}/{items.length}</span>
      {i > 0 && <button type="button" className={`${s.carNav} ${s.carPrev}`} onClick={() => go(i - 1)} aria-label={t("Foto anterior", "Previous photo")}>‹</button>}
      {i < items.length - 1 && <button type="button" className={`${s.carNav} ${s.carNext}`} onClick={() => go(i + 1)} aria-label={t("Foto siguiente", "Next photo")}>›</button>}
      <div className={s.dots} aria-hidden="true">
        {items.map((_, n) => <span key={n} className={n === i ? `${s.dotC} ${s.dotCOn}` : s.dotC} />)}
      </div>
    </div>
  );
}

/** La foto (o el carrusel) de la publicación en esta red. */
function PostMedia({ kind, media, spec, rounded }: { kind: PreviewKind; media: PreviewMediaInfo; spec: NetworkSpec; rounded?: boolean }) {
  const max = CAROUSEL_SHOWN[kind] ?? 1;
  if (media.type === "photo" && (media.items?.length ?? 0) > 1 && max > 1) return <Carousel key={(media.items ?? []).map((x) => x.url).join("|")} media={media} spec={spec} rounded={rounded} max={max} />;
  return <MediaBox key={`${media.url}|${media.exactUrl ?? ""}`} media={media} spec={spec} rounded={rounded} />;
}

const Icon = ({ d, label }: { d: string; label?: string }) => (
  <svg viewBox="0 0 24 24" className={s.icon} aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ICONS = {
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  comment: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
  send: "M22 3 11 14M22 3l-7 18-4-7-7-4 18-7z",
  save: "M6 3h12v18l-6-4-6 4z",
  like: "M7 10v10H4V10h3zm0 0 4-7a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2l-2 7a2 2 0 0 1-2 1H7",
  share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13",
  repost: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  views: "M4 20V10M10 20V4M16 20v-8M22 20H2",
  globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-10 10h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  music: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
};

function counter(text: string, spec: NetworkSpec, n: number) {
  return spec.limit ? `${n.toLocaleString()} / ${spec.limit.toLocaleString()}` : `${n.toLocaleString()}`;
}

export type NetworkPreviewProps = {
  kind: PreviewKind;
  brand: PreviewBrand;
  text: string;
  media: PreviewMediaInfo;
  /** Caracteres que cuenta la red (para el contador). */
  count: number;
};

/** Una publicación dibujada como se ve en la red `kind`. */
export function NetworkPreview({ kind, brand, text, media, count }: NetworkPreviewProps) {
  const { t } = useT();
  const spec = NETWORKS[kind];
  const handle = handleOf(brand);
  const over = spec.limit > 0 && count > spec.limit;
  const counterEl = <span className={over ? `${s.count} ${s.countOver}` : s.count}>{counter(text, spec, count)}</span>;

  if (kind === "instagram") {
    return (
      <article className={`${s.frame} ${s.ig}`} aria-label={t("Vista previa en Instagram", "Instagram preview")}>
        <header className={s.head}>
          <span className={s.ring}><Avatar brand={brand} /></span>
          <strong className={s.name}>{handle}</strong>
          <Icon d={ICONS.dots} />
        </header>
        <PostMedia kind={kind} media={media} spec={spec} />
        {media.type === "none" && <div className={s.noMedia}>{t("Instagram necesita una foto o un video", "Instagram needs a photo or a video")}</div>}
        <div className={s.igActions}><Icon d={ICONS.heart} /><Icon d={ICONS.comment} /><Icon d={ICONS.send} /><span className={s.grow} /><Icon d={ICONS.save} /></div>
        <div className={s.body}>
          <PostText text={text} spec={spec} lead={handle} />
          <div className={s.meta}><span>{t("Hace un momento", "Just now")}</span>{counterEl}</div>
        </div>
      </article>
    );
  }

  if (kind === "instagram-story" || kind === "tiktok") {
    const tiktok = kind === "tiktok";
    return (
      <article className={`${s.frame} ${s.story}`} aria-label={tiktok ? t("Vista previa en TikTok", "TikTok preview") : t("Vista previa del reel de Instagram", "Instagram Reel preview")}>
        <div className={s.storyMedia}>
          {media.type !== "none" && media.url ? <MediaBox key={`${media.url}|${media.exactUrl ?? ""}`} media={media} spec={spec} /> : <div className={s.storyEmpty}>{tiktok ? t("TikTok necesita un video", "TikTok needs a video") : t("Sin foto ni video", "No photo or video")}</div>}
        </div>
        {/* Zonas que tapan los botones de la red: lo importante de la imagen tiene que quedar fuera. */}
        <div className={s.safeTop} aria-hidden="true" />
        <div className={s.safeBottom} aria-hidden="true" />
        <div className={s.storySide} aria-hidden="true"><Icon d={ICONS.heart} /><Icon d={ICONS.comment} /><Icon d={tiktok ? ICONS.save : ICONS.send} />{tiktok && <Icon d={ICONS.share} />}</div>
        <div className={s.storyFoot}>
          <div className={s.storyWho}><Avatar brand={brand} /><strong>{handle}</strong>{!tiktok && <span className={s.follow}>{t("Seguir", "Follow")}</span>}</div>
          <PostText text={text} spec={spec} dark />
          <div className={s.storyMusic}><Icon d={ICONS.music} /> {t("Audio original", "Original audio")}</div>
        </div>
        <div className={s.storyCount}>{counterEl}</div>
      </article>
    );
  }

  if (kind === "facebook") {
    return (
      <article className={`${s.frame} ${s.fb}`} aria-label={t("Vista previa en Facebook", "Facebook preview")}>
        <header className={s.head}>
          <Avatar brand={brand} />
          <div className={s.who}><strong className={s.name}>{brand.name}</strong><span className={s.sub}>{t("Ahora", "Just now")} · <Icon d={ICONS.globe} /></span></div>
          <Icon d={ICONS.dots} />
        </header>
        <div className={s.body}><PostText text={text} spec={spec} /></div>
        <PostMedia kind={kind} media={media} spec={spec} />
        <div className={s.fbBar}><span><Icon d={ICONS.like} /> {t("Me gusta", "Like")}</span><span><Icon d={ICONS.comment} /> {t("Comentar", "Comment")}</span><span><Icon d={ICONS.share} /> {t("Compartir", "Share")}</span></div>
        <div className={s.foot}>{counterEl}</div>
      </article>
    );
  }

  if (kind === "linkedin") {
    return (
      <article className={`${s.frame} ${s.li}`} aria-label={t("Vista previa en LinkedIn", "LinkedIn preview")}>
        <header className={s.head}>
          <Avatar brand={brand} square />
          <div className={s.who}><strong className={s.name}>{brand.name}</strong><span className={s.sub}>{t("Página de empresa", "Company page")} · {t("Ahora", "Now")} · <Icon d={ICONS.globe} /></span></div>
        </header>
        <div className={s.body}><PostText text={text} spec={spec} /></div>
        <PostMedia kind={kind} media={media} spec={spec} />
        <div className={s.fbBar}><span><Icon d={ICONS.like} /> {t("Recomendar", "Like")}</span><span><Icon d={ICONS.comment} /> {t("Comentar", "Comment")}</span><span><Icon d={ICONS.repost} /> {t("Compartir", "Repost")}</span><span><Icon d={ICONS.send} /> {t("Enviar", "Send")}</span></div>
        <div className={s.foot}>{counterEl}</div>
      </article>
    );
  }

  if (kind === "google") {
    return (
      <article className={`${s.frame} ${s.gb}`} aria-label={t("Vista previa en Google", "Google preview")}>
        <header className={s.head}>
          <Avatar brand={brand} />
          <div className={s.who}><strong className={s.name}>{brand.name}</strong><span className={s.sub}>{t("Novedades · en Google Maps y Búsqueda", "Updates · on Google Maps and Search")}</span></div>
        </header>
        <MediaBox key={`${media.url}|${media.exactUrl ?? ""}`} media={media} spec={spec} rounded />
        <div className={s.body}>
          <PostText text={text} spec={spec} />
          {brand.website && <span className={s.gbBtn}>{t("Más información", "Learn more")}</span>}
        </div>
        <div className={s.foot}>{counterEl}</div>
      </article>
    );
  }

  // X
  return (
    <article className={`${s.frame} ${s.x}`} aria-label={t("Vista previa en X", "X preview")}>
      <div className={s.xRow}>
        <Avatar brand={brand} />
        <div className={s.xMain}>
          <div className={s.xWho}><strong className={s.name}>{brand.name}</strong><span className={s.sub}>@{handle} · {t("ahora", "now")}</span></div>
          <PostText text={text} spec={spec} />
          <PostMedia kind={kind} media={media} spec={spec} rounded />
          <div className={s.xBar}><Icon d={ICONS.comment} /><Icon d={ICONS.repost} /><Icon d={ICONS.heart} /><Icon d={ICONS.views} /><Icon d={ICONS.share} /></div>
        </div>
      </div>
      <div className={s.foot}>{counterEl}</div>
    </article>
  );
}
