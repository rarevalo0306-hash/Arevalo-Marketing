"use client";

// Vista previa animada del video en el navegador (sin costo): las mismas escenas, el mismo movimiento hacia lo
// importante de la foto, los textos en la zona segura y el cierre con la marca. Se parece mucho al video final.
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18n";
import { pickInk } from "@/lib/design-layout";
import { kenBurnsRect, totalSec, type Storyboard, type VideoScene } from "@/lib/video-plan";
import s from "./video.module.css";

const fmt = (ms: number) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};

export function VideoPreview({ sb, label }: { sb: Storyboard; label?: string }) {
  const { t } = useT();
  const total = Math.max(1, Math.round(totalSec(sb.scenes) * 1000));
  const [ms, setMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [dims, setDims] = useState<Record<string, { w: number; h: number }>>({});
  const startRef = useRef<{ at: number; from: number } | null>(null);

  // Empieza sola, salvo que la persona prefiera menos movimiento.
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) setPlaying(true);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    startRef.current = { at: performance.now(), from: ms };
    const step = (now: number) => {
      const st = startRef.current!;
      setMs((st.from + (now - st.at)) % total);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // Solo al pausar/seguir o si cambia el largo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, total]);

  let acc = 0;
  let idx = sb.scenes.length - 1;
  for (let i = 0; i < sb.scenes.length; i++) {
    const d = sb.scenes[i].durationSec * 1000;
    if (ms < acc + d) {
      idx = i;
      break;
    }
    acc += d;
  }
  const scene = sb.scenes[idx];
  const p = scene ? Math.min(1, Math.max(0, (ms - acc) / (scene.durationSec * 1000))) : 0;
  const vertical = sb.format === "vertical";

  return (
    <div className={s.previewWrap}>
      <div className={`${s.screen} ${vertical ? s.screenV : s.screenH}`} aria-label={label ?? t("Vista previa del video", "Video preview")} role="img">
        {scene && <SceneView key={scene.id} sb={sb} scene={scene} p={p} dims={dims} onDims={(id, w, h) => setDims((d) => (d[id] ? d : { ...d, [id]: { w, h } }))} />}
        <div className={s.screenBar} aria-hidden="true">
          {sb.scenes.map((sc, i) => (
            <span key={sc.id} style={{ flex: sc.durationSec }}>
              <i style={{ width: i < idx ? "100%" : i === idx ? `${p * 100}%` : "0%" }} />
            </span>
          ))}
        </div>
      </div>
      <div className={s.previewControls}>
        <button type="button" className="btn small" onClick={() => setPlaying((v) => !v)} aria-pressed={playing}>
          {playing ? t("❚❚ Pausa", "❚❚ Pause") : t("▶ Ver", "▶ Play")}
        </button>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            setMs(0);
            startRef.current = { at: performance.now(), from: 0 };
          }}
        >
          {t("↺ Desde el inicio", "↺ From the start")}
        </button>
        <span className="small muted">
          {fmt(ms)} / {fmt(total)}
        </span>
      </div>
    </div>
  );
}

function SceneView({ sb, scene, p, dims, onDims }: { sb: Storyboard; scene: VideoScene; p: number; dims: Record<string, { w: number; h: number }>; onDims: (id: string, w: number, h: number) => void }) {
  const { t } = useT();
  const out = sb.format === "vertical" ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 };
  if (scene.role === "outro") return <Outro sb={sb} caption={scene.caption} />;
  const m = sb.media.find((x) => x.id === scene.mediaId);
  if (!m) return <div className={s.screenEmpty}>{t("Falta la foto", "Photo missing")}</div>;
  const capClass = scene.role === "hook" ? s.capHook : sb.format === "vertical" ? s.capBody : s.capBodyH;
  const caption = scene.caption ? (
    <div className={capClass}>
      <span style={{ background: sb.outro.color || "#126BBC", color: pickInk(sb.outro.color || "#126BBC") }}>{scene.caption}</span>
    </div>
  ) : null;
  if (m.kind === "video") {
    return (
      <>
        {m.url && /^https?:\/\//.test(m.url) ? (
          <video className={s.clip} src={m.url} poster={m.thumb || undefined} muted playsInline autoPlay loop />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- miniatura del clip
          <img className={s.clip} src={m.thumb} alt="" />
        )}
        <span className={s.clipBadge}>{t("Clip de video", "Video clip")}</span>
      </>
    );
  }
  const src = dims[m.id] ?? (m.width > 0 && m.height > 0 ? { w: m.width, h: m.height } : null);
  const r = src ? kenBurnsRect(scene.motion, p, src, out, m.focus) : null;
  const style = r && src ? { width: `${(src.w / r.width) * 100}%`, height: `${(src.h / r.height) * 100}%`, left: `${(-r.left / r.width) * 100}%`, top: `${(-r.top / r.height) * 100}%` } : { width: "100%", height: "100%", left: 0, top: 0, objectFit: "cover" as const };
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- foto real del negocio */}
      <img
        className={s.kb}
        src={m.url || m.thumb}
        alt=""
        style={style}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth && img.naturalHeight) onDims(m.id, img.naturalWidth, img.naturalHeight);
        }}
      />
      {caption}
    </>
  );
}

function Outro({ sb, caption }: { sb: Storyboard; caption: string }) {
  const o = sb.outro;
  const ink = pickInk(o.color || "#126BBC");
  const dark = ink === "#ffffff";
  const logo = dark ? o.logoLightUrl || o.logoUrl : o.logoUrl || o.logoLightUrl;
  const plate = dark && !o.logoLightUrl;
  return (
    <div className={s.outro} style={{ background: `linear-gradient(160deg, ${o.color || "#126BBC"} 0%, ${o.color || "#126BBC"} 35%, #050a14 160%)`, color: ink }}>
      {logo ? (
        <span className={plate ? `${s.outroLogo} ${s.outroPlate}` : s.outroLogo}>
          {/* eslint-disable-next-line @next/next/no-img-element -- logo de la marca */}
          <img src={logo} alt={o.name} />
        </span>
      ) : (
        <strong className={s.outroName}>{o.name}</strong>
      )}
      <span className={s.outroLine}>{caption || o.slogan || o.name}</span>
      {o.phone && <span className={s.outroSmall}>{o.phone}</span>}
      {o.website && <span className={s.outroSmall}>{o.website.replace(/^https?:\/\//i, "").replace(/\/+$/, "")}</span>}
    </div>
  );
}
