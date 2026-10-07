import Link from "next/link";
import { PageHead } from "@/components/PageHead";
import { LibraryItemCard } from "@/components/library/LibraryItemCard";
import { ReviewNow } from "@/components/library/ReviewNow";
import s from "@/components/library/Library.module.css";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { asLibraryFilter, LIBRARY_FILTERS, libraryCounts, loadLibrary, PAGE_SIZE, type LibraryFilter } from "@/lib/library";
import { fmtWhen } from "@/lib/time";

// «Revisar ahora» trae y revisa con IA lo nuevo de la carpeta.
export const maxDuration = 300;

function FolderIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-9 9" />
    </svg>
  );
}

export default async function FotosPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ver?: string; n?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const filter = asLibraryFilter(q.ver);
  const limit = Math.min(2000, Math.max(PAGE_SIZE, Math.round(Number(q.n) / PAGE_SIZE) * PAGE_SIZE || PAGE_SIZE));
  const { lang, t } = await getT();
  const b = await db.business.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, color: true, driveFolderId: true, driveFolderName: true, driveSyncedAt: true, driveError: true } });
  const connected = !!b.driveFolderId;
  const [counts, page] = await Promise.all([libraryCounts(id), loadLibrary(id, filter, limit)]);
  const conexiones = `/b/${id}/conexiones#c-drive`;
  const href = (f: LibraryFilter, n?: number) => {
    const p = new URLSearchParams();
    if (f !== "todas") p.set("ver", f);
    if (n) p.set("n", String(n));
    const qs = p.toString();
    return `/b/${id}/fotos${qs ? `?${qs}` : ""}`;
  };
  const label: Record<LibraryFilter, string> = {
    todas: t("Todas", "All"),
    listas: t("Listas para usar", "Ready to use"),
    revisar: t("Revisar privacidad", "Check privacy"),
    "no-usar": t("No usar", "Don't use"),
    problemas: t("Con problemas", "With problems"),
    videos: t("Videos", "Videos"),
  };
  const photos = counts.todas - counts.videos;

  return (
    <>
      <PageHead
        business={b}
        prefix={t("Tus fotos de", "Photos for")}
        section={t("Tus fotos", "Your photos")}
        title={t("Tus fotos y videos", "Your photos and videos")}
        subtitle={t(
          "Las fotos y videos reales de tu negocio. Cuando la IA prepara una publicación, primero busca aquí una foto que vaya con el tema, y solo crea una nueva si no encuentra.",
          "Your business's real photos and videos. When the AI prepares a post, it first looks here for a photo that fits the topic, and only creates a new one if none fits.",
        )}
        aside={
          <Link className="btn outline" href={`/b/${id}/publicar`}>
            {t("Nueva publicación", "New post")}
          </Link>
        }
      />

      {!connected && counts.todas === 0 ? (
        <section className={`card ${s.empty}`}>
          <span className={s.emptyIcon}>
            <FolderIcon size={28} />
          </span>
          <h2>{t("Conecta tu carpeta de fotos", "Connect your photo folder")}</h2>
          <p>
            {t(
              "Pon tus fotos y videos de trabajos en una carpeta de Google Drive y conéctala aquí. La app las mira cada día, la IA entiende qué muestra cada una, y las usa en tus publicaciones en vez de fotos inventadas.",
              "Put your job photos and videos in a Google Drive folder and connect it here. The app checks it every day, the AI understands what each one shows, and uses them in your posts instead of made-up photos.",
            )}
          </p>
          <Link className="btn on" href={conexiones}>
            {t("Conectar mi carpeta de Drive", "Connect my Drive folder")}
          </Link>
        </section>
      ) : (
        <>
          <section className={`card ${s.source}`} aria-label={t("De dónde vienen", "Where they come from")}>
            <div className={s.sourceText}>
              <span className={s.folder}>
                <span className={s.folderIcon}>
                  <FolderIcon />
                </span>
                {connected ? (
                  <>
                    {t("Carpeta de Google Drive", "Google Drive folder")}
                    {b.driveFolderName ? `: «${b.driveFolderName}»` : ""}
                  </>
                ) : (
                  t("Ninguna carpeta conectada", "No folder connected")
                )}
              </span>
              <p className="small muted">
                {connected
                  ? t(
                      "Cuando subes una foto o video a esa carpeta (también desde el celular con la app de Google Drive), aparece aquí. La app la revisa sola una vez al día.",
                      "When you upload a photo or video to that folder (also from your phone with the Google Drive app), it shows up here. The app checks it on its own once a day.",
                    )
                  : t(
                      "Estas fotos vienen de la carpeta que tenías conectada. Conecta una carpeta para que lleguen fotos nuevas.",
                      "These photos come from the folder you had connected. Connect a folder so new photos keep coming in.",
                    )}
              </p>
              <div className={s.stats}>
                <span>
                  <strong>{photos}</strong> {photos === 1 ? t("foto", "photo") : t("fotos", "photos")}
                </span>
                <span>
                  <strong>{counts.videos}</strong> {counts.videos === 1 ? t("video", "video") : t("videos", "videos")}
                </span>
                <span>
                  <strong>{counts.listas}</strong> {t("listas para usar", "ready to use")}
                </span>
                {b.driveSyncedAt && <span>{t(`Revisada ${fmtWhen(b.driveSyncedAt, "es")}`, `Checked ${fmtWhen(b.driveSyncedAt, "en")}`)}</span>}
              </div>
              {b.driveError && <p className="note error">{b.driveError}</p>}
            </div>
            <div className={s.sourceActions}>
              {connected ? (
                <>
                  <ReviewNow businessId={id} />
                  <Link className="btn link" href={conexiones}>
                    {t("Cambiar carpeta", "Change folder")}
                  </Link>
                </>
              ) : (
                <Link className="btn on" href={conexiones}>
                  {t("Conectar mi carpeta de Drive", "Connect my Drive folder")}
                </Link>
              )}
            </div>
          </section>

          <nav className={`tabs ${s.filters}`} aria-label={t("Filtrar fotos", "Filter photos")}>
            {LIBRARY_FILTERS.map((f) => (
              <Link key={f} href={href(f)} className={`tab ${s.filter} ${filter === f ? "on" : ""}`} aria-current={filter === f ? "page" : undefined} scroll={false}>
                {label[f]}{" "}
                <span className={`${s.count} ${f === "revisar" && counts[f] > 0 ? s.countWarn : ""} ${f === "problemas" && counts[f] > 0 ? s.countBad : ""}`}>{counts[f]}</span>
              </Link>
            ))}
          </nav>

          {page.items.length === 0 ? (
            <div className="card empty">
              {counts.todas === 0 ? (
                <>
                  <strong style={{ color: "var(--ink)" }}>{t("Tu carpeta todavía no tiene fotos.", "Your folder doesn't have photos yet.")}</strong>
                  <span>
                    {t(
                      "Sube fotos a tu carpeta de Drive (también desde el celular con la app de Google Drive). Después toca «Revisar ahora» o espera a la revisión de cada día.",
                      "Upload photos to your Drive folder (also from your phone with the Google Drive app). Then tap «Check now» or wait for the daily check.",
                    )}
                  </span>
                </>
              ) : filter === "revisar" ? (
                t("¡Bien! No hay fotos con avisos de privacidad por revisar.", "Nice! No photos with privacy warnings to check.")
              ) : filter === "problemas" ? (
                t("¡Bien! Ningún archivo tuvo problemas.", "Nice! No files had problems.")
              ) : (
                t("No hay nada aquí.", "Nothing here.")
              )}
            </div>
          ) : (
            <>
              <div className={s.grid}>
                {page.items.map((c) => (
                  <LibraryItemCard key={c.id} c={c} businessId={id} lang={lang} />
                ))}
              </div>
              {page.more && (
                <div className={s.more}>
                  <Link className="btn" href={href(filter, limit + PAGE_SIZE)} scroll={false}>
                    {t("Ver más", "See more")}
                  </Link>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
