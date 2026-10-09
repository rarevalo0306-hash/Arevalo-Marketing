"use client";

// «¿Qué vas a publicar?»: Foto, Diseño (foto + texto con tu marca), Carrusel (2 a 10 fotos) o Historia (9:16).
// Los videos tienen su propia sección (Videos).
import Link from "next/link";
import { useT } from "@/components/I18n";
import s from "./posts.module.css";

export type StudioKind = "photo" | "design" | "carousel" | "story";
export const STUDIO_KINDS: StudioKind[] = ["photo", "design", "carousel", "story"];

const ICONS: Record<StudioKind, string> = {
  photo: "M4 7h3l2-3h6l2 3h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  design: "M4 4h16v16H4zM4 15l5-5 4 4 3-3 4 4M7 7h6",
  carousel: "M7 5h10v14H7zM3 7v10M21 7v10",
  story: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM10 5h4",
};

export function PostTypePicker({ value, onChange, videosHref }: { value: StudioKind; onChange: (k: StudioKind) => void; videosHref: string }) {
  const { t } = useT();
  const items: Record<StudioKind, { name: string; sub: string }> = {
    photo: { name: t("Foto", "Photo"), sub: t("Una foto tal cual", "One photo as it is") },
    design: { name: t("Diseño", "Design"), sub: t("Foto con texto y tu marca", "Photo with text and your brand") },
    carousel: { name: t("Carrusel", "Carousel"), sub: t("De 2 a 10 fotos", "2 to 10 photos") },
    story: { name: t("Historia", "Story"), sub: t("Vertical 9:16, dura 24 horas", "Vertical 9:16, lasts 24 hours") },
  };
  return (
    <section className={s.types} aria-labelledby="h-type">
      <div className={s.typesHead}>
        <h2 id="h-type" className={s.typesTitle}>{t("¿Qué vas a publicar?", "What are you posting?")}</h2>
      </div>
      <div className={s.typeGrid} role="radiogroup" aria-labelledby="h-type">
        {(Object.keys(items) as StudioKind[]).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? `${s.type} ${s.typeOn}` : s.type} onClick={() => onChange(k)}>
            <svg viewBox="0 0 24 24" className={s.typeIcon} aria-hidden="true">
              <path d={ICONS[k]} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className={s.typeName}>{items[k].name}</span>
            <span className={s.typeSub}>{items[k].sub}</span>
          </button>
        ))}
      </div>
      <p className={s.videoLink}>
        <span>{t("¿Quieres un video (Reel, TikTok, YouTube)?", "Want a video (Reel, TikTok, YouTube)?")}</span>
        <Link href={videosHref}>{t("Ir a Videos →", "Go to Videos →")}</Link>
      </p>
    </section>
  );
}
