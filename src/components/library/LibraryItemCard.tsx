// Una foto o video en «Tus fotos»: qué vio la IA, avisos de privacidad, si se puede usar y botones.
import Link from "next/link";
import { ChoiceButtons } from "@/components/library/ChoiceButtons";
import { EnhancePanel } from "@/components/library/EnhancePanel";
import { PhotoAiTools } from "@/components/library/PhotoAiTools";
import { VariantButton } from "@/components/library/VariantButton";
import { translator, type UiLang } from "@/lib/i18n";
import { editedByAi } from "@/lib/library";
import { fmtDuration, qualityWord, SCENE_LABEL, type LibraryCard } from "@/lib/library-match";
import { PRIVACY_FLAGS, PRIVACY_LABEL, type PrivacyFlag } from "@/lib/library-shape";
import { canUpscale, CUTOUT_CENTS, FIX_CENTS, UPSCALE_CENTS } from "@/lib/photo-tools";
import e from "./Enhance.module.css";
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

/**
 * `variantCents`: precio de «Crear otra versión» (solo fotos hechas con IA), o null si no hay clave para hacerlas.
 * `aiTools`: qué herramientas de «Editar con IA» hay (según las claves del servidor).
 */
export function LibraryItemCard({ c, businessId, lang, variantCents = null, aiTools = { fal: false, fix: false } }: { c: LibraryCard; businessId: string; lang: UiLang; variantCents?: number | null; aiTools?: { fal: boolean; fix: boolean } }) {
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
  // Una foto real recortada o agrandada con IA sigue siendo real: dice «Editada con IA» y no se le hacen versiones.
  const edited = c.source === "ai" && editedByAi(c.folderPath);
  const photoReady = c.kind === "photo" && c.status === "ready";
  const tools = photoReady
    ? [
        ...(aiTools.fal ? [{ tool: "cutout" as const, cents: CUTOUT_CENTS }] : []),
        ...(aiTools.fal && canUpscale(c.width, c.height) ? [{ tool: "upscale" as const, cents: UPSCALE_CENTS }] : []),
        ...(aiTools.fix && c.source === "ai" && !edited ? [{ tool: "fix" as const, cents: FIX_CENTS }] : []),
      ]
    : [];
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
        {c.kind === "photo" && c.enhancedUrl && (
          <span className={`${e.badge} ${c.useEnhanced ? "" : e.badgeOff}`} title={c.useEnhanced ? t("Tus publicaciones usan la foto mejorada", "Your posts use the improved photo") : t("Elegiste usar la original", "You chose to use the original")}>
            {c.useEnhanced ? t("✨ Mejorada", "✨ Improved") : t("Original", "Original")}
          </span>
        )}
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
          <strong>{c.source === "upload" ? t("Subida por link", "Uploaded by link") : edited ? t("Editada con IA", "Edited with AI") : c.source === "ai" ? t("Hecha con IA", "Made with AI") : t("De Drive", "From Drive")}</strong>
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
          {c.source === "ai" && !edited && photoReady && variantCents !== null && <VariantButton businessId={businessId} itemId={c.id} cents={variantCents} />}
          <PhotoAiTools businessId={businessId} itemId={c.id} tools={tools} />
          {c.source !== "ai" && <EnhancePanel c={c} businessId={businessId} />}
          {c.status !== "new" && <ChoiceButtons businessId={businessId} itemId={c.id} choice={c.choice} needsReview={c.needsReview} problem={c.status === "error"} />}
        </div>
      </div>
    </article>
  );
}
