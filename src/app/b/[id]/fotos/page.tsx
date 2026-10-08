import Link from "next/link";
import { PageHead } from "@/components/PageHead";
import { EnhanceAll } from "@/components/library/EnhanceAll";
import { LibraryItemCard } from "@/components/library/LibraryItemCard";
import { ReviewNow } from "@/components/library/ReviewNow";
import { UploadLinkCard } from "@/components/library/UploadLinkCard";
import s from "@/components/library/Library.module.css";
import { appOrigin } from "@/lib/app-origin";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { asLibraryFilter, LIBRARY_FILTERS, libraryCounts, loadLibrary, PAGE_SIZE, type LibraryFilter } from "@/lib/library";
import { AI_HINTS_COST_USD, pendingWhere } from "@/lib/photo-enhance-run";
import { readEnhanceInfo } from "@/lib/photo-enhance-shape";
import { r2Enabled } from "@/lib/r2";
import { fmtWhen } from "@/lib/time";
import { uploadStats } from "@/lib/upload";

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
  const b = await db.business.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, color: true, driveFolderId: true, driveFolderName: true, driveSyncedAt: true, driveError: true, uploadToken: true } });
  const connected = !!b.driveFolderId;
  const [counts, page, uploads, origin, toEnhance, enhancedCount] = await Promise.all([
    libraryCounts(id),
    loadLibrary(id, filter, limit),
    uploadStats(id),
    appOrigin(),
    db.libraryItem.findMany({ where: pendingWhere(id), select: { privacy: true, enhanceInfo: true } }),
    db.libraryItem.count({ where: { businessId: id, kind: "photo", status: { not: "gone" }, enhancedUrl: { not: "" } } }),
  ]);
  // Las que faltan y tienen avisos de privacidad sin indicaciones de la IA: esas se le preguntan aparte (con costo).
  const aiPhotos = toEnhance.filter((r) => r.privacy.length > 0 && !readEnhanceInfo(r.enhanceInfo)?.hints).length;
  const r2 = r2Enabled();
  const uploadCard = (
    <UploadLinkCard businessId={id} businessName={b.name} configured={r2} token={b.uploadToken} origin={origin} total={uploads.total} pending={uploads.pending} anchor="link-subida" />
  );
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
          <>
            {r2 && b.uploadToken && (
              <a className="btn" href={`/subir/${b.uploadToken}`} target="_blank" rel="noopener noreferrer">
                {t("Subir fotos", "Upload photos")}
              </a>
            )}
            <Link className="btn outline" href={`/b/${id}/publicar`}>
              {t("Nueva publicación", "New post")}
            </Link>
          </>
        }
      />

      {!connected && counts.todas === 0 ? (
        <div className={s.sources}>
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
          {uploadCard}
        </div>
      ) : (
        <>
          <div className={s.sources}>
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
                        "No hay una carpeta de Drive conectada. Puedes conectar una, o usar el link de subida para que tus técnicos manden fotos.",
                        "No Drive folder is connected. You can connect one, or use the upload link so your technicians send photos.",
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
            {uploadCard}
          </div>

          {photos > 0 && (
            <EnhanceAll
              businessId={id}
              pending={toEnhance.length}
              enhanced={enhancedCount}
              aiPhotos={aiPhotos}
              aiCost={AI_HINTS_COST_USD}
              aiReady={Boolean(process.env.GEMINI_API_KEY)}
            />
          )}

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
