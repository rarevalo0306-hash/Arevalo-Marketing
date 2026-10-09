"use client";

// Palabras clave de esta publicación y los hashtags de cada red como chips: se quitan con × y se agregan con
// «+ hashtag». Los hashtags salen de tus palabras clave y tu ciudad (Instagram y TikTok hasta 5, Facebook y
// LinkedIn 3, X 2; Google ninguno).
import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/I18n";
import { channelName, type ChannelId } from "@/lib/channels";
import { cleanHashtag, HASHTAG_MAX } from "@/lib/post-keywords";
import s from "./posts.module.css";

type Props = {
  /** Las palabras clave elegidas para este post. */
  keywords: string[];
  /** Redes elegidas que llevan hashtags. */
  channels: ChannelId[];
  tagsFor: (c: ChannelId) => string[];
  setTags: (c: ChannelId, tags: string[]) => void;
  seoHref: string;
};

function AddTag({ onAdd, label }: { onAdd: (tag: string) => void; label: string }) {
  const { t } = useT();
  const [v, setV] = useState("");
  const add = () => {
    const tag = cleanHashtag(v);
    if (tag) onAdd(tag);
    setV("");
  };
  return (
    <input
      className={`field ${s.tagAdd}`}
      aria-label={label}
      placeholder={t("+ hashtag", "+ hashtag")}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "," || e.key === " ") {
          e.preventDefault();
          add();
        }
      }}
      onBlur={add}
    />
  );
}

export function KeywordChips({ keywords, channels, tagsFor, setTags, seoHref }: Props) {
  const { lang, t } = useT();
  const nets = channels.filter((c) => HASHTAG_MAX[c] !== undefined);
  return (
    <div className={s.kw}>
      <div className={s.kwHead}>
        <strong>{t("Palabras clave de este post:", "Keywords for this post:")}</strong>
        {keywords.length ? (
          keywords.map((k) => <span key={k} className={s.kwPill}>{k}</span>)
        ) : (
          <span>
            {t("Todavía no tienes palabras clave.", "You don't have keywords yet.")} <Link href={seoHref}>{t("Elegirlas en SEO", "Choose them in SEO")}</Link>
          </span>
        )}
      </div>
      {nets.length > 0 && keywords.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {nets.map((c) => {
            const tags = tagsFor(c);
            const max = HASHTAG_MAX[c] ?? 0;
            const name = channelName(c, lang);
            return (
              <div key={c} className={s.netRow}>
                <span className={s.netName}>{name}</span>
                {max === 0 ? (
                  <span className={s.tagNone}>{t("Sin hashtags (en Google no sirven)", "No hashtags (they don't help on Google)")}</span>
                ) : (
                  <>
                    {tags.map((tag) => (
                      <span key={tag} className={s.tag}>
                        {tag}
                        <button type="button" className={s.tagX} aria-label={t(`Quitar ${tag} de ${name}`, `Remove ${tag} from ${name}`)} onClick={() => setTags(c, tags.filter((x) => x !== tag))}>×</button>
                      </span>
                    ))}
                    {tags.length < max && <AddTag label={t(`Agregar un hashtag en ${name}`, `Add a hashtag on ${name}`)} onAdd={(tag) => !tags.includes(tag) && setTags(c, [...tags, tag])} />}
                    {tags.length === 0 && <span className={s.tagNone}>{t("Sin hashtags nuevos", "No new hashtags")}</span>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
