"use client";

import { useParams } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import type { IdentityResult } from "@/app/actions-brand-identity";
import { useT } from "@/components/I18n";
import { emitBrandSaved } from "@/lib/brand-events";
import type { IdentityProposal, IdentitySource } from "@/lib/brand-identity-shape";
import { BODY_FONTS, FONTS, inkOn } from "@/lib/design-shapes";
import s from "./Identity.module.css";

type Action = (prev: IdentityResult, f: FormData) => Promise<IdentityResult>;

// Las letras del texto se piden a Google Fonts (las de los titulares ya las carga la app).
const BODY_HREF = `https://fonts.googleapis.com/css2?${Object.values(BODY_FONTS)
  .map((f) => `family=${f.name.replace(/ /g, "+")}:wght@400;600`)
  .join("&")}&display=swap`;

const headingCss = (id: keyof typeof FONTS) => `'${FONTS[id].name}', ${id === "playfair-display" ? "serif" : "sans-serif"}`;
const bodyCss = (id: keyof typeof BODY_FONTS) => `'${BODY_FONTS[id].name}', system-ui, sans-serif`;

function Card({ p, chosen, choose }: { p: IdentityProposal; chosen: boolean; choose: Action }) {
  const { t, lang } = useT();
  const [asking, setAsking] = useState(false);
  const [result, run, pending] = useActionState(choose, null);
  const businessId = useParams<{ id: string }>()?.id ?? "";
  const seen = useRef<number | undefined>(undefined);
  // Al usar una propuesta, el kit y las plantillas (más abajo) se vuelven a crear con los colores nuevos.
  useEffect(() => {
    if (!result?.ok || !result.visual || seen.current === result.at) return;
    seen.current = result.at;
    setAsking(false);
    if (businessId) emitBrandSaved({ businessId, visual: true });
  }, [result, businessId]);
  const [c1, c2, c3] = p.palette;
  const ink = inkOn(c1);
  const slogan = (lang === "en" ? p.slogan.en || p.slogan.es : p.slogan.es || p.slogan.en) || "";
  const fh = FONTS[p.fontHeading];
  return (
    <article className={`${s.proposal}${chosen ? ` ${s.chosen}` : ""}`} aria-label={p.name}>
      <div className={s.mock} style={{ background: `linear-gradient(160deg, ${c1} 0%, ${c1} 62%, ${c2} 100%)`, color: ink }}>
        <span className={s.mockBar} style={{ background: c3 }} aria-hidden />
        <strong className={s.mockHead} style={{ fontFamily: headingCss(p.fontHeading), fontWeight: fh.bold }}>{p.headline || slogan}</strong>
        {slogan && <span className={s.mockSlogan} style={{ fontFamily: bodyCss(p.fontBody) }}>{slogan}</span>}
      </div>
      <div className={s.body}>
        <div className={s.head}>
          <h3 className={s.name}>{p.name}</h3>
          {chosen && <span className="pill done">{t("En uso", "In use")}</span>}
        </div>
        <div className={s.palette} aria-label={t("Colores", "Colors")}>
          {p.palette.map((c, i) => (
            <span key={i} className={s.swatch}>
              <span className={s.chip} style={{ background: c }} aria-hidden />
              <span className={s.hex}>{c}</span>
            </span>
          ))}
        </div>
        {p.paletteWhy && <p className="small muted">{p.paletteWhy}</p>}
        <dl className={s.facts}>
          <div>
            <dt>{t("Letras", "Fonts")}</dt>
            <dd>
              <span style={{ fontFamily: headingCss(p.fontHeading), fontWeight: fh.bold }}>{fh.name}</span>
              {" + "}
              <span style={{ fontFamily: bodyCss(p.fontBody) }}>{BODY_FONTS[p.fontBody].name}</span>
            </dd>
          </div>
          {slogan && (
            <div>
              <dt>{t("Eslogan", "Slogan")}</dt>
              <dd>«{slogan}»</dd>
            </div>
          )}
          {p.voice && (
            <div>
              <dt>{t("Cómo habla", "How it talks")}</dt>
              <dd>{p.voice}</dd>
            </div>
          )}
          {p.music && (
            <div>
              <dt>{t("Música para videos", "Music for videos")}</dt>
              <dd>{p.music}</dd>
            </div>
          )}
        </dl>
        {pending ? (
          <p className={s.progress} role="status">
            <span className={s.spinner} aria-hidden />
            {t("Aplicando a tu marca…", "Applying to your brand…")}
          </p>
        ) : asking ? (
          <div className={s.confirm} role="group" aria-label={t("Confirmar", "Confirm")}>
            <p className="small">
              {t(
                "Esto cambia tus colores y letras por los de esta propuesta, y pone su eslogan, su voz y su música en tu identidad. Después se vuelven a crear tu kit y tus plantillas. ¿Seguimos?",
                "This replaces your colors and fonts with this proposal's, and puts its slogan, voice and music in your identity. Then your kit and templates are created again. Continue?",
              )}
            </p>
            <form action={run} className={s.actions}>
              <input type="hidden" name="proposal" value={p.id} />
              <button type="submit" className="btn on">{t("Sí, usar esta", "Yes, use this one")}</button>
              <button type="button" className="btn link" onClick={() => setAsking(false)}>{t("Cancelar", "Cancel")}</button>
            </form>
          </div>
        ) : (
          <button type="button" className={`btn${chosen ? "" : " outline"} ${s.use}`} onClick={() => setAsking(true)}>
            {chosen ? t("Volver a aplicar", "Apply again") : t("Usar esta", "Use this one")}
          </button>
        )}
        {result && !pending && <p className={`note ${result.ok ? "ok" : "error"}`} role="status">{result.message}</p>}
      </div>
    </article>
  );
}

export function IdentityProposals({
  proposals,
  chosen,
  hasBook,
  source,
  aiOn,
  propose,
  choose,
}: {
  proposals: IdentityProposal[];
  chosen: string;
  hasBook: boolean;
  source: IdentitySource | "";
  aiOn: boolean;
  propose: Action;
  choose: Action;
}) {
  const { t } = useT();
  const [result, run, pending] = useActionState(propose, null);
  const [mode, setMode] = useState<"auto" | "ai">("auto");
  const fromBook = hasBook && mode === "auto";
  return (
    <section className="card" id="identidad" aria-labelledby="identidad-title">
      <link rel="stylesheet" href={BODY_HREF} precedence="default" />
      <div className="stack" style={{ gap: 4 }}>
        <div className={s.head}>
          <h2 id="identidad-title">{t("Tu identidad", "Your identity")}</h2>
          {source === "book" && <span className="pill neutral">{t("Sacada de tu manual", "From your brand book")}</span>}
          {source === "ai" && <span className="pill draft">{t("Propuesta por la IA", "Suggested by the AI")}</span>}
        </div>
        <p className="small muted">
          {hasBook
            ? t(
                "Además de colores y letras, tu marca tiene eslogan, mensajes, una forma de hablar y hasta música. La IA lo saca de tu manual de marca, o te propone 3 caminos distintos para escoger.",
                "Beyond colors and fonts, your brand has a slogan, messages, a way of speaking and even music. The AI pulls it from your brand book, or suggests 3 different directions to choose from.",
              )
            : t(
                "Además de colores y letras, tu marca tiene eslogan, mensajes, una forma de hablar y hasta música. La IA te propone 3 caminos distintos, pensados con lo que sabe de tu negocio. Escoge uno y cámbialo como quieras.",
                "Beyond colors and fonts, your brand has a slogan, messages, a way of speaking and even music. The AI suggests 3 different directions, based on what it knows about your business. Pick one and change it any way you like.",
              )}
        </p>
      </div>

      {aiOn ? (
        <form action={run} className={s.actions} onSubmit={(e) => setMode(((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === "ai" ? "ai" : "auto")}>
          {pending ? (
            <p className={s.progress} role="status">
              <span className={s.spinner} aria-hidden />
              {fromBook ? t("La IA está leyendo tu manual…", "The AI is reading your brand book…") : t("La IA está pensando 3 identidades para tu negocio…", "The AI is coming up with 3 identities for your business…")}
            </p>
          ) : hasBook ? (
            <>
              <button type="submit" name="mode" value="auto" className="btn ai">{t("✦ Sacar la identidad de mi manual", "✦ Get the identity from my brand book")}</button>
              <button type="submit" name="mode" value="ai" className="btn link">{t("Prefiero 3 propuestas de la IA", "I'd rather see 3 AI proposals")}</button>
            </>
          ) : (
            <button type="submit" name="mode" value="ai" className="btn ai">
              {proposals.length ? t("✦ Proponer 3 identidades nuevas", "✦ Suggest 3 new identities") : t("✦ Proponer identidades", "✦ Suggest identities")}
            </button>
          )}
        </form>
      ) : (
        <p className="note">{t("La IA no está disponible (falta su clave en la configuración del servidor). Puedes escribir tu identidad a mano, abajo.", "The AI isn't available (its key is missing from the server settings). You can write your identity by hand below.")}</p>
      )}
      {result && !pending && <p className={`note ${result.ok ? "ok" : "error"}`} role="status">{result.message}</p>}

      {proposals.length > 0 && (
        <>
          <p className="small muted">
            {t(
              "Cada propuesta trae colores, letras, eslogan, forma de hablar, música y un titular de ejemplo. «Usar esta» cambia tus colores y letras (te preguntamos antes).",
              "Each proposal has colors, fonts, slogan, way of speaking, music and a sample headline. “Use this one” changes your colors and fonts (we ask first).",
            )}
          </p>
          <div className={s.proposals}>
            {proposals.map((p) => (
              <Card key={p.id} p={p} chosen={p.id === chosen} choose={choose} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
