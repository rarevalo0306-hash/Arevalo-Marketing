// Una foto o video en «Tus fotos»: qué vio la IA, avisos de privacidad, si se puede usar y botones.
import Link from "next/link";
import { ChoiceButtons } from "@/components/library/ChoiceButtons";
import { translator, type UiLang } from "@/lib/i18n";
import { fmtDuration, qualityWord, SCENE_LABEL, type LibraryCard } from "@/lib/library-match";
import { PRIVACY_FLAGS, PRIVACY_LABEL, type PrivacyFlag } from "@/lib/library-shape";
import s from "./Library.module.css";

function StatePill({ c, lang }: { c: LibraryCard; lang: UiLang }) {
  const t = translator(lang);
  if (c.status === "error") return <span className="pill bad">{t("Con problema", "Problem")}</span>;
  if (c.status === "new") return <span className="pill info">{t("Revisando…", "Checking…")}</span>;
  if (c.choice === "skip") return <span className="pill neutral">{t("No usar", "Don't use")}</span>;
  if (c.needsReview) return <span className="pill warn">{t("Revisar privacidad", "Check privacy")}</span>;
  if (c.canUse)
    return <span className="pill good">{c.choice === "use" ? t("Aprobada por ti", "Approved by you") : t("Lista para usar", "Ready to use")}</span>;
  return <span className="pill neutral">{t("La IA no la usa", "AI won't use it")}</span>;
}

export function LibraryItemCard({ c, businessId, lang }: { c: LibraryCard; businessId: string; lang: UiLang }) {
  const t = translator(lang);
  const d = c.description;
  const q = qualityWord(c.quality);
  const flags = c.privacy.filter((f): f is PrivacyFlag => (PRIVACY_FLAGS as readonly string[]).includes(f));
  const ready = c.status === "ready" && c.choice !== "skip";
  const what = c.kind === "video" ? t("video", "video") : t("foto", "photo");
  const used =
    c.usedCount === 0
      ? t("Todavía no se ha usado", "Not used yet")
      : c.usedCount === 1
        ? t(c.kind === "video" ? "Usado 1 vez" : "Usada 1 vez", "Used once")
        : t(`${c.kind === "video" ? "Usado" : "Usada"} ${c.usedCount} veces`, `Used ${c.usedCount} times`);
  const alt = d ? d[lang] : c.name;
  return (
    <article className={`${s.item} ${c.choice === "skip" ? s.itemSkip : ""}`}>
      <div className={s.media}>
        {c.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- copia guardada (Supabase o /media)
          <img src={c.thumb} alt={alt} loading="lazy" />
        ) : (
          <span className={s.noThumb} aria-hidden="true">
            {c.kind === "video" ? "▶" : "▢"}
          </span>
        )}
        <span className={s.state}>
          <StatePill c={c} lang={lang} />
        </span>
        {c.kind === "video" && (
          <span className={s.badge}>
            <span aria-hidden="true">▶</span> {c.durationSec > 0 ? fmtDuration(c.durationSec) : t("Video", "Video")}
          </span>
        )}
      </div>
      <div className={s.body}>
        {d ? <p className={s.desc}>{d[lang]}</p> : <p className={`${s.desc} muted`}>{c.name || what}</p>}
        {d && (
          <div className={s.chips}>
            <span className={`${s.chip} ${s.scene}`}>{SCENE_LABEL[d.scene][lang]}</span>
            {d.topics.slice(0, 4).map((x) => (
              <span key={x} className={s.chip} title={x}>
                {x}
              </span>
            ))}
          </div>
        )}
        <p className={s.origin}>
          <strong>{c.source === "upload" ? t("Subida por link", "Uploaded by link") : t("De Drive", "From Drive")}</strong>
          {c.folderPath ? ` · ${c.source === "upload" ? `«${c.folderPath}»` : c.folderPath}` : ""}
        </p>
        {c.status === "ready" && (
          <div className={s.meta}>
            <span>
              {t("Calidad", "Quality")}: <strong className={s[q.tone] ?? ""}>{q[lang]}</strong>
            </span>
            <span>{used}</span>
          </div>
        )}
        {c.status === "ready" && d?.reason && c.choice !== "use" && (c.quality < 3 || c.quality === 0) && <p className={s.why}>{d.reason[lang]}</p>}
        {flags.length > 0 && c.choice !== "use" && (
          <ul className={s.warnings} aria-label={t("Avisos de privacidad", "Privacy warnings")}>
            {flags.map((f) => (
              <li key={f}>⚠ {PRIVACY_LABEL[f][lang]}</li>
            ))}
            {c.choice === "" && <li>{t("La IA no la usará sola hasta que la apruebes.", "AI won't use it on its own until you approve it.")}</li>}
          </ul>
        )}
        {c.status === "error" && (
          <p className={s.problem}>
            {c.error || t("No se pudo revisar este archivo. Se intentará otra vez en la próxima revisión.", "This file couldn't be checked. It will be tried again on the next check.")}
          </p>
        )}
        <div className={s.actions}>
          {ready && (
            <Link className="btn on" href={`/b/${businessId}/publicar?foto=${c.id}`}>
              {c.kind === "video" ? t("Crear publicación con este video", "Create a post with this video") : t("Crear publicación con esta foto", "Create a post with this photo")}
            </Link>
          )}
          {c.status !== "new" && <ChoiceButtons businessId={businessId} itemId={c.id} choice={c.choice} needsReview={c.needsReview} problem={c.status === "error"} />}
        </div>
      </div>
    </article>
  );
}
