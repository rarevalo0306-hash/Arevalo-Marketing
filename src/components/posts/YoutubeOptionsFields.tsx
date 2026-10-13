// Campos de YouTube que aprueba una persona antes de cada subida: título, descripción, etiquetas, quién puede verlo y
// si es para niños (sin nada elegido de entrada). Sirve en formularios del servidor (Plan, Campañas) y del navegador
// (Videos, Nueva publicación): sin estado propio. Los nombres los lee youtubeApprovalFromForm (src/lib/youtube-options.ts).
import { translator, type UiLang } from "@/lib/i18n";
import { PRIVACY_LABEL, YT_DESCRIPTION_MAX, YT_PRIVACY, YT_TITLE_MAX, type YoutubePrivacy } from "@/lib/youtube-options";
import s from "./youtube.module.css";

export type YoutubeField = "title" | "tags" | "privacy" | "kids";

export function YoutubeOptionsFields({
  lang,
  idPrefix,
  mediaUrl,
  title,
  description,
  tags,
  verb,
  controlled,
}: {
  lang: UiLang;
  /** Para los id de los campos (puede haber varios formularios en la misma página). */
  idPrefix: string;
  /** El video que se sube (vista previa). */
  mediaUrl?: string;
  title: string;
  /** La descripción (v_youtube). Sin esto no se muestra: la pantalla manda su propio texto. */
  description?: string;
  tags: string[] | string;
  /** «Al aprobar…» o «Al publicar…». */
  verb: "approve" | "post";
  /** Solo en formularios del navegador: los campos quedan controlados (title y tags son los valores de ahora). */
  controlled?: { privacy: string; kids: string; onChange: (field: YoutubeField, value: string) => void };
}) {
  const t = translator(lang);
  const id = (k: string) => `${idPrefix}-yt-${k}`;
  const tagText = Array.isArray(tags) ? tags.join(", ") : tags;
  const on = controlled?.onChange;
  const text = (field: YoutubeField, value: string) =>
    on ? { value, onChange: (e: { target: { value: string } }) => on(field, e.target.value) } : { defaultValue: value };
  const radio = (field: "privacy" | "kids", value: string) =>
    on ? { checked: (field === "privacy" ? controlled?.privacy : controlled?.kids) === value, onChange: () => on(field, value) } : {};
  const privacyHint: Record<YoutubePrivacy, [string, string]> = {
    public: ["Cualquiera puede encontrarlo y verlo.", "Anyone can find and watch it."],
    unlisted: ["Solo quien tenga el enlace.", "Only people with the link."],
    private: ["Solo tú y quienes elijas.", "Only you and people you choose."],
  };
  const kids: [string, string, string][] = [
    ["no", "No, no es para niños", "No, it's not made for kids"],
    ["yes", "Sí, es para niños", "Yes, it's made for kids"],
  ];

  return (
    <fieldset className={s.box}>
      <legend className={s.head}>{t("Subida a YouTube", "YouTube upload")}</legend>
      <p className={s.intro}>{t("Esto es exactamente lo que se manda a YouTube. Revísalo y elige quién puede verlo.", "This is exactly what is sent to YouTube. Review it and choose who can see it.")}</p>
      {mediaUrl && <video className={s.video} src={mediaUrl} controls preload="metadata" playsInline aria-label={t("El video que se sube", "The video to upload")} />}

      <div className={s.field}>
        <label htmlFor={id("title")} className={s.lbl}>{t("Título", "Title")}</label>
        <input id={id("title")} name="yt_title" className="field" maxLength={YT_TITLE_MAX} required pattern=".*[^\s<>].*" {...text("title", title)} />
      </div>
      {description !== undefined && (
        <div className={s.field}>
          <label htmlFor={id("desc")} className={s.lbl}>{t("Descripción", "Description")}</label>
          <textarea id={id("desc")} name="v_youtube" className="field" rows={5} maxLength={YT_DESCRIPTION_MAX} defaultValue={description} />
        </div>
      )}
      <div className={s.field}>
        <label htmlFor={id("tags")} className={s.lbl}>{t("Etiquetas (separadas por comas)", "Tags (comma separated)")}</label>
        <input id={id("tags")} name="yt_tags" className="field" {...text("tags", tagText)} />
        <p className={s.help}>{t("Estas etiquetas exactas se mandan a YouTube.", "These exact tags are sent to YouTube.")}</p>
      </div>

      <fieldset className={s.group}>
        <legend className={s.lbl}>{t("¿Quién puede verlo en YouTube?", "Who can see it on YouTube?")}</legend>
        <div className={s.opts}>
          {YT_PRIVACY.map((v) => (
            <label key={v} className={s.opt}>
              <input type="radio" name="yt_privacy" value={v} required {...radio("privacy", v)} />
              <span className={s.optText}>
                <strong>{PRIVACY_LABEL[v][lang]}</strong>
                <span>{t(...privacyHint[v])}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={s.group}>
        <legend className={s.lbl}>{t("¿Es para niños?", "Is it made for kids?")}</legend>
        <div className={s.opts}>
          {kids.map(([v, es, en]) => (
            <label key={v} className={s.opt}>
              <input type="radio" name="yt_kids" value={v} required {...radio("kids", v)} />
              <span className={s.optText}>
                <strong>{t(es, en)}</strong>
              </span>
            </label>
          ))}
        </div>
        <p className={s.help}>
          {t(
            "YouTube lo pide en cada video. Si es para niños, YouTube apaga los comentarios y los anuncios personalizados.",
            "YouTube asks this for every video. If it's made for kids, YouTube turns off comments and personalized ads.",
          )}
        </p>
      </fieldset>

      <p className={s.help}>{t("Categoría: Gente y blogs", "Category: People & Blogs")}</p>
      <p className={s.legal}>
        {verb === "approve"
          ? t(
              "Al aprobar, autorizas a Matya a subir este video a tu canal de YouTube con este título, descripción, etiquetas y visibilidad.",
              "By approving, you authorize Matya to upload this video to your YouTube channel with this title, description, tags and visibility.",
            )
          : t(
              "Al publicar, autorizas a Matya a subir este video a tu canal de YouTube con este título, descripción, etiquetas y visibilidad.",
              "By posting, you authorize Matya to upload this video to your YouTube channel with this title, description, tags and visibility.",
            )}{" "}
        {t("Al usar YouTube desde Matya aceptas los ", "By using YouTube through Matya you agree to the ")}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
          {t("Términos del servicio de YouTube", "YouTube Terms of Service")}
        </a>
        {t(". Google trata los datos según su ", ". Google handles the data under the ")}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
          {t("Política de privacidad", "Google Privacy Policy")}
        </a>
        .
      </p>
    </fieldset>
  );
}
