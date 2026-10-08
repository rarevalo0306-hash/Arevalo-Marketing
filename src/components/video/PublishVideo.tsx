"use client";

// «Publicar»: el video listo va a Instagram (Reel), TikTok, YouTube (Short) y Facebook con el texto de cada red.
// Crea la publicación igual que «Nueva publicación» (queda en el Historial, con reintentos).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useT } from "@/components/I18n";
import type { PublishVideoResult, VideoView } from "@/app/actions-video";
import { channelsFor, type VideoTexts } from "@/lib/video-plan";
import s from "./video.module.css";

export type ChannelState = { id: string; name: string; connected: boolean };

const KIND: Record<string, { es: string; en: string }> = {
  instagram: { es: "Reel", en: "Reel" },
  tiktok: { es: "Video", en: "Video" },
  youtube: { es: "Short o video", en: "Short or video" },
  facebook: { es: "Video en tu página", en: "Video on your Page" },
};

export function PublishVideo({ video, texts, channels, connectHref, historyHref, publish }: { video: VideoView; texts: VideoTexts; channels: ChannelState[]; connectHref: string; historyHref: string; publish: (f: FormData) => Promise<PublishVideoResult> }) {
  const { lang, t } = useT();
  const router = useRouter();
  const format = video.project.storyboard.format;
  const list = channelsFor(format).map((id) => channels.find((c) => c.id === id) ?? { id, name: id, connected: false });
  const [on, setOn] = useState<string[]>(() => list.filter((c) => c.connected).map((c) => c.id));
  const [when, setWhen] = useState<"now" | "later">("now");
  const [state, action, isPending] = useActionState<PublishVideoResult | null, FormData>(async (_prev, f) => publish(f), null);

  useEffect(() => {
    if (state?.ok) router.push(state.href);
  }, [state, router]);

  const published = video.project.status === "published";
  const today = new Date().toLocaleDateString("en-CA");

  return (
    <div className={`stack ${s.publish}`}>
      <h3 className={s.publishTitle}>{published ? t("Publicar otra vez", "Post again") : t("Publicar", "Post")}</h3>
      {published && (
        <p className="small muted" style={{ margin: 0 }}>
          {t("Este video ya se publicó. Míralo en el ", "This video was already posted. See it in ")}
          <Link href={historyHref}>{t("Historial", "History")}</Link>.
        </p>
      )}
      {isPending && (
        <p className="note info" role="status">
          {t("Enviando el video a las redes… puede tardar un par de minutos (Instagram y YouTube lo procesan).", "Sending the video to the networks… it can take a couple of minutes (Instagram and YouTube process it).")}
        </p>
      )}
      <form action={action} className="stack" style={{ gap: 14, ...(isPending ? { display: "none" } : {}) }}>
        <fieldset className={s.fieldset}>
          <legend className={s.legend}>{t("¿Dónde?", "Where?")}</legend>
          <div className={s.channels}>
            {list.map((c) => {
              const checked = on.includes(c.id);
              return (
                <label key={c.id} className={`chip ${checked ? "on" : ""} ${c.connected ? "" : "off"}`}>
                  <input
                    type="checkbox"
                    name="channels"
                    value={c.id}
                    checked={checked}
                    disabled={!c.connected}
                    onChange={(e) => setOn((cur) => (e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)))}
                  />
                  <span className="stack" style={{ gap: 0 }}>
                    <strong>{c.name}</strong>
                    <span className="sub">{c.connected ? KIND[c.id]?.[lang] : t("No conectado", "Not connected")}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {list.some((c) => !c.connected) && (
            <p className="small muted" style={{ margin: "6px 0 0" }}>
              {t("¿Falta alguna? ", "Missing one? ")}
              <Link href={connectHref}>{t("Conéctala en Conexiones", "Connect it in Connections")}</Link>.
            </p>
          )}
        </fieldset>

        {on.includes("youtube") && (
          <div className="stack" style={{ gap: 6 }}>
            <label htmlFor="pv-title" className={s.legend}>{t("YouTube: título", "YouTube: title")}</label>
            <input id="pv-title" name="title" className="field" defaultValue={texts.title} maxLength={100} />
            <label htmlFor="pv-desc" className={s.legend}>{t("YouTube: descripción", "YouTube: description")}</label>
            <textarea id="pv-desc" name="description" className="field" rows={5} defaultValue={texts.description} maxLength={5000} />
          </div>
        )}
        {on.includes("instagram") && (
          <div className="stack" style={{ gap: 6 }}>
            <label htmlFor="pv-ig" className={s.legend}>{t("Instagram (Reel)", "Instagram (Reel)")}</label>
            <textarea id="pv-ig" name="instagram" className="field" rows={6} defaultValue={texts.instagram} maxLength={2200} />
          </div>
        )}
        {on.includes("tiktok") && (
          <div className="stack" style={{ gap: 6 }}>
            <label htmlFor="pv-tt" className={s.legend}>TikTok</label>
            <textarea id="pv-tt" name="tiktok" className="field" rows={6} defaultValue={texts.tiktok} maxLength={2200} />
          </div>
        )}
        {on.includes("facebook") && (
          <div className="stack" style={{ gap: 6 }}>
            <label htmlFor="pv-fb" className={s.legend}>Facebook</label>
            <textarea id="pv-fb" name="facebook" className="field" rows={6} defaultValue={texts.facebook} maxLength={5000} />
          </div>
        )}

        <fieldset className={s.fieldset}>
          <legend className={s.legend}>{t("¿Cuándo?", "When?")}</legend>
          <div className="row">
            <label className={`chip ${when === "now" ? "on" : ""}`}>
              <input type="radio" name="when" value="now" checked={when === "now"} onChange={() => setWhen("now")} />
              {t("Ahora", "Now")}
            </label>
            <label className={`chip ${when === "later" ? "on" : ""}`}>
              <input type="radio" name="when" value="later" checked={when === "later"} onChange={() => setWhen("later")} />
              {t("Programar", "Schedule")}
            </label>
          </div>
          {when === "later" && (
            <div className="row" style={{ marginTop: 8 }}>
              <label className="sr-only" htmlFor="pv-date">{t("Día", "Day")}</label>
              <input id="pv-date" type="date" name="date" className="field" min={today} defaultValue={today} style={{ width: "auto" }} />
              <label className="sr-only" htmlFor="pv-time">{t("Hora", "Time")}</label>
              <input id="pv-time" type="time" name="time" className="field" defaultValue="10:00" style={{ width: "auto" }} />
            </div>
          )}
        </fieldset>

        {state && !state.ok && (
          <p className="note error" role="alert">
            {state.error}
          </p>
        )}
        <button type="submit" className="primary" disabled={!on.length}>
          {when === "later" ? t("Programar el video", "Schedule the video") : t("Publicar ahora", "Post now")}
        </button>
      </form>
    </div>
  );
}
