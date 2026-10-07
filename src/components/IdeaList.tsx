"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { MoreIdeasResult } from "@/app/actions-ideas";
import { useT } from "@/components/I18n";
import type { ContentIdea, IdeasBasis } from "@/lib/content-ideas";
import s from "./IdeaList.module.css";

/** Ideas que se ven de entrada en el celular. */
const MOBILE = 4;

/**
 * "Ideas para hoy, según tu SEO": botones con el tema y una línea de por qué conviene. Lo usan el Inicio (sobre el
 * fondo oscuro) y Publicar (en la caja de la idea). "✦ Más ideas con IA" agrega 10 ideas más de la IA.
 */
export function IdeaList({
  ideas,
  basis,
  variant,
  onPick,
  selected,
  more,
  disabled = false,
  seoHref,
}: {
  ideas: ContentIdea[];
  basis: IdeasBasis;
  variant: "hero" | "box";
  onPick: (idea: ContentIdea) => void;
  selected?: string;
  more: (() => Promise<MoreIdeasResult>) | null;
  disabled?: boolean;
  /** Sin datos de SEO: enlace para revisarlo y tener ideas mejores. */
  seoHref?: string;
}) {
  const { t } = useT();
  const [extra, setExtra] = useState<ContentIdea[]>([]);
  const [error, setError] = useState("");
  // En celular se ven 4 ideas; el resto con "Ver más".
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const list = [...ideas, ...extra];
  if (!list.length) return null;
  const title =
    basis === "seo" ? t("Ideas para hoy, según tu SEO", "Ideas for today, based on your SEO")
    : basis === "study" ? t("Ideas para hoy, según tu estudio", "Ideas for today, based on your study")
    : t("Ideas para hoy", "Ideas for today");
  const loadMore = () =>
    start(async () => {
      setError("");
      try {
        const r = await more!();
        if (!r.ok) return setError(r.error);
        setOpen(true);
        setExtra((prev) => [...prev, ...r.ideas.filter((x) => !list.some((y) => y.topic.toLowerCase() === x.topic.toLowerCase()))]);
      } catch {
        setError(t("No se pudieron traer más ideas. Intenta de nuevo.", "Couldn't get more ideas. Try again."));
      }
    });
  return (
    <div className={`${s.wrap} ${variant === "hero" ? s.hero : s.box}`}>
      <div className={s.head}>
        <span className={s.title}>{title}</span>
        {basis === "seo" && <span className={s.hint}>{t("Lo que buscan tus clientes y donde todavía no sales", "What your customers search and where you don't show up yet")}</span>}
        {basis !== "seo" && seoHref && (
          <span className={s.hint}>
            {t("Para ideas según lo que buscan tus clientes,", "For ideas based on what your customers search,")} <Link href={seoHref} className={s.link}>{t("revisa tu SEO", "check your SEO")}</Link>
          </span>
        )}
      </div>
      <div className={open ? s.grid : `${s.grid} ${s.collapsed}`}>
        {list.map((x) => (
          <button
            key={x.id}
            type="button"
            className={selected === x.id ? `${s.item} ${s.on}` : s.item}
            aria-pressed={variant === "box" ? selected === x.id : undefined}
            onClick={() => onPick(x)}
            disabled={disabled}
          >
            <span className={s.topic}>{x.topic}</span>
            <span className={s.why}>{x.why}</span>
          </button>
        ))}
      </div>
      {(more || (!open && list.length > MOBILE)) && (
        <div className={s.foot}>
          {!open && list.length > MOBILE && (
            <button type="button" className={`${s.more} ${s.mobileOnly}`} onClick={() => setOpen(true)}>
              {list.length - MOBILE === 1 ? t("Ver 1 idea más", "See 1 more idea") : t(`Ver ${list.length - MOBILE} ideas más`, `See ${list.length - MOBILE} more ideas`)}
            </button>
          )}
          {more && (
            <button type="button" className={s.more} onClick={loadMore} disabled={pending || disabled}>
              {pending ? t("La IA está pensando ideas…", "AI is thinking of ideas…") : t("✦ Más ideas con IA", "✦ More ideas with AI")}
            </button>
          )}
          {error && <span className={s.error} role="alert">{error}</span>}
        </div>
      )}
    </div>
  );
}
