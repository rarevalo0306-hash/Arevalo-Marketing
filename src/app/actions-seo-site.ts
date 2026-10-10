"use server";

import { revalidatePath } from "next/cache";
import { errorText } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { approveForSite, chooseSitePhoto, generateSitePhoto, prepareForSite } from "@/lib/seo/site-article-run";
import { suggestArticleTopic } from "@/lib/seo/topic-pick-load";

export type SiteResult = { ok: boolean; message: string } | null;
export type TopicResult = { ok: boolean; message: string; keyword?: string } | null;

const paths = (businessId: string) => {
  revalidatePath(`/b/${businessId}/seo/escribir`);
};

/** «Que la IA elija el tema»: el mejor tema con lo que Matya ya sabe (gratis: no llama a Google ni a la IA). */
export async function suggestTopic(businessId: string, _prev: TopicResult, f: FormData): Promise<TopicResult> {
  void _prev;
  const { lang, t } = await getT();
  const skip = String(f.get("skip") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  try {
    const r = await suggestArticleTopic(businessId, skip);
    if (!r)
      return {
        ok: false,
        message: skip.length
          ? t("No quedan más temas con lo que sabemos. Escribe tú la búsqueda.", "No more topics with what we know. Type the search yourself.")
          : t(
              "Todavía no sabemos lo suficiente. Corre «Palabras clave» o «Competencia» en SEO y visibilidad, o escribe tú la búsqueda.",
              "We don't know enough yet. Run “Keywords” or “Competitors” in SEO and visibility, or type the search yourself.",
            ),
      };
    return { ok: true, keyword: r.pick.keyword, message: lang === "en" ? r.pick.reason.en : r.pick.reason.es };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** «Publicar en mi web»: prepara la versión bilingüe y la foto. No publica ni gasta en fotos. */
export async function prepareSiteArticle(businessId: string, reportId: string, _prev: SiteResult, _f: FormData): Promise<SiteResult> {
  void _prev;
  void _f;
  const { lang, t } = await getT();
  try {
    await prepareForSite(businessId, reportId);
    paths(businessId);
    return { ok: true, message: t("Listo: revisa cómo va a quedar y autoriza.", "Done: check how it will look and approve.") };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** Cambiar la foto de la vista previa (gratis). */
export async function pickSitePhoto(businessId: string, reportId: string, _prev: SiteResult, f: FormData): Promise<SiteResult> {
  void _prev;
  const { lang, t } = await getT();
  try {
    await chooseSitePhoto(businessId, reportId, String(f.get("photo") ?? ""));
    paths(businessId);
    return { ok: true, message: t("Foto cambiada.", "Photo changed.") };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** «Crear otra con IA»: gasta lo que dice el botón (`cents`). */
export async function newSitePhoto(businessId: string, reportId: string, _prev: SiteResult, f: FormData): Promise<SiteResult> {
  void _prev;
  const { lang, t } = await getT();
  try {
    await generateSitePhoto(businessId, reportId, Number(f.get("cents") ?? -1));
    paths(businessId);
    return { ok: true, message: t("La IA creó una foto nueva.", "The AI created a new photo.") };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}

/** «Autorizar y publicar»: gasta lo que dice el botón (`cents`) y publica. */
export async function approveSiteArticle(businessId: string, reportId: string, _prev: SiteResult, f: FormData): Promise<SiteResult> {
  void _prev;
  const { lang, t } = await getT();
  try {
    const r = await approveForSite(businessId, reportId, Number(f.get("cents") ?? -1));
    paths(businessId);
    const photo = r.photoFailed ? t(" La foto no se pudo subir: tu web usa su foto del tema.", " The photo couldn't be uploaded: your website uses its topic photo.") : "";
    return {
      ok: true,
      message: r.already
        ? t("Ya estaba en tu web: no lo publicamos dos veces.", "It was already on your website: we didn't publish it twice.")
        : t(`Listo: tu web lo muestra en unos minutos.${photo}`, `Done: your website shows it in a few minutes.${photo}`),
    };
  } catch (e) {
    return { ok: false, message: errorText(e, lang) };
  }
}
