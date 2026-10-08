"use client";

import { useActionState } from "react";
import type { IdentityResult } from "@/app/actions-brand-identity";
import { useT } from "@/components/I18n";
import { type BrandIdentity, MAX_MESSAGES } from "@/lib/brand-identity-shape";
import s from "./Identity.module.css";

type Action = (prev: IdentityResult, f: FormData) => Promise<IdentityResult>;

const lines = (list: string[]) => list.join("\n");
const commas = (list: string[]) => list.join(", ");

function Text({ name, label, value, placeholder, help }: { name: string; label: string; value: string; placeholder?: string; help?: string }) {
  return (
    <div className={s.field}>
      <label className="lbl" htmlFor={`id-${name}`}>{label}</label>
      <input id={`id-${name}`} name={name} className="field" defaultValue={value} placeholder={placeholder} />
      {help && <span className="small muted">{help}</span>}
    </div>
  );
}

function Area({ name, label, value, placeholder, help, rows = 3 }: { name: string; label: string; value: string; placeholder?: string; help?: string; rows?: number }) {
  return (
    <div className={s.field}>
      <label className="lbl" htmlFor={`id-${name}`}>{label}</label>
      <textarea id={`id-${name}`} name={name} className="field" rows={rows} style={{ minHeight: rows * 26 + 24 }} defaultValue={value} placeholder={placeholder} />
      {help && <span className="small muted">{help}</span>}
    </div>
  );
}

/** Los campos (se vuelven a pintar cuando cambia lo guardado, por ejemplo al completar con IA o usar una propuesta). */
function Fields({ identity: d }: { identity: BrandIdentity }) {
  const { t } = useT();
  const v = d.voice;
  const m = d.music;
  const rows = Math.min(MAX_MESSAGES, Math.max(3, d.messages.length + 1));
  const seeded = !d.updatedAt && (v.avoidWords.length > 0 || v.dont.length > 0);
  return (
    <>
      <fieldset className={s.group}>
        <legend className={s.legend}>{t("Eslogan y frase corta", "Slogan and short line")}</legend>
        <div className={s.two}>
          <Text name="slogan_es" label={t("Eslogan en español", "Slogan in Spanish")} value={d.slogan.es} placeholder={t("Ej.: Seguridad que abre puertas", "E.g.: Seguridad que abre puertas")} />
          <Text name="slogan_en" label={t("Eslogan en inglés", "Slogan in English")} value={d.slogan.en} placeholder={t("Ej.: Security that opens doors", "E.g.: Security that opens doors")} />
          <Text name="tagline_es" label={t("Qué haces, en una línea (español)", "What you do, in one line (Spanish)")} value={d.tagline.es} />
          <Text name="tagline_en" label={t("Qué haces, en una línea (inglés)", "What you do, in one line (English)")} value={d.tagline.en} />
        </div>
      </fieldset>

      <fieldset className={s.group}>
        <legend className={s.legend}>{t("Mensajes clave", "Key messages")}</legend>
        <p className="small muted">{t("De 3 a 6 ideas que tu marca repite siempre, y por qué le importan a tu cliente.", "3 to 6 ideas your brand always repeats, and why they matter to your customer.")}</p>
        <ol className={s.messages}>
          {Array.from({ length: rows }, (_, i) => {
            const msg = d.messages[i];
            return (
              <li key={i} className={s.message}>
                <span className={s.num} aria-hidden>{i + 1}</span>
                <div className={s.two}>
                  <Text name={`msg_es_${i}`} label={t(`Mensaje ${i + 1} (español)`, `Message ${i + 1} (Spanish)`)} value={msg?.text.es ?? ""} />
                  <Text name={`msg_en_${i}`} label={t(`Mensaje ${i + 1} (inglés)`, `Message ${i + 1} (English)`)} value={msg?.text.en ?? ""} />
                </div>
                <Text name={`msg_why_${i}`} label={t("Por qué importa", "Why it matters")} value={msg?.why ?? ""} />
              </li>
            );
          })}
        </ol>
        {rows < MAX_MESSAGES && <span className="small muted">{t("Guarda para que aparezca otro espacio (máximo 6).", "Save to get another space (6 max).")}</span>}
      </fieldset>

      <fieldset className={s.group}>
        <legend className={s.legend}>{t("Voz: cómo habla tu marca", "Voice: how your brand talks")}</legend>
        {seeded && (
          <p className="note info">
            {t(
              "Empezamos con lo que tu marca nunca hace o nunca dice, según lo que ya sabe la IA de tu negocio. Revísalo y guarda.",
              "We started with what your brand never does or never says, based on what the AI already knows about your business. Review it and save.",
            )}
          </p>
        )}
        <Area name="voice_summary" label={t("En pocas palabras", "In a few words")} value={v.summary} rows={2} placeholder={t("Ej.: Cercana y experta, como el técnico de confianza del barrio. Tratamos de usted.", "E.g.: Friendly and expert, like the trusted local technician. Polite and clear.")} />
        <Text name="personality" label={t("Personalidad (separada por comas)", "Personality (separated by commas)")} value={commas(v.personality)} placeholder={t("Ej.: confiable, directa, cercana", "E.g.: reliable, direct, friendly")} />
        <div className={s.two}>
          <Area name="voice_do" label={t("✓ Sí hace", "✓ Does")} value={lines(v.do)} rows={4} help={t("Una por renglón.", "One per line.")} />
          <Area name="voice_dont" label={t("✗ Nunca hace", "✗ Never does")} value={lines(v.dont)} rows={4} help={t("Una por renglón.", "One per line.")} />
          <Area name="use_words" label={t("Palabras que siempre usa", "Words it always uses")} value={commas(v.useWords)} rows={2} help={t("Separadas por comas.", "Separated by commas.")} />
          <Area name="avoid_words" label={t("Palabras que nunca usa", "Words it never uses")} value={commas(v.avoidWords)} rows={2} help={t("Separadas por comas.", "Separated by commas.")} />
        </div>
        <Area name="audience" label={t("A quién le habla", "Who it talks to")} value={d.audience} rows={2} />
      </fieldset>

      <fieldset className={s.group}>
        <legend className={s.legend}>{t("Música para tus videos", "Music for your videos")}</legend>
        <p className="small muted">{t("Solo música libre de derechos (sin canciones famosas, que pueden bloquear tus videos). La usaremos al crear videos.", "Royalty-free music only (no famous songs, which can get your videos blocked). We'll use it when making videos.")}</p>
        <div className={s.two}>
          <Text name="music_moods" label={t("Ánimo", "Mood")} value={commas(m.moods)} placeholder={t("Ej.: enérgica, moderna, optimista", "E.g.: energetic, modern, upbeat")} />
          <Text name="music_genres" label={t("Estilo de música", "Music style")} value={commas(m.genres)} placeholder={t("Ej.: pop electrónico, corporativo", "E.g.: electronic pop, corporate")} />
          <div className={s.field}>
            <span className="lbl" id="id-bpm">{t("Ritmo (golpes por minuto)", "Tempo (beats per minute)")}</span>
            <div className={s.range} role="group" aria-labelledby="id-bpm">
              <input name="bpm_min" type="number" min={40} max={220} className="field" defaultValue={m.bpmMin ?? ""} aria-label={t("Desde", "From")} placeholder="90" />
              <span aria-hidden>–</span>
              <input name="bpm_max" type="number" min={40} max={220} className="field" defaultValue={m.bpmMax ?? ""} aria-label={t("Hasta", "To")} placeholder="120" />
            </div>
          </div>
          <div className={s.field}>
            <label className="lbl" htmlFor="id-energy">{t("Energía", "Energy")}</label>
            <select id="id-energy" name="energy" className="field" defaultValue={m.energy}>
              <option value="">{t("Sin definir", "Not set")}</option>
              <option value="low">{t("Tranquila", "Calm")}</option>
              <option value="medium">{t("Media", "Medium")}</option>
              <option value="high">{t("Alta", "High")}</option>
            </select>
          </div>
          <Text name="instruments" label={t("Instrumentos o sonidos", "Instruments or sounds")} value={commas(m.instruments)} placeholder={t("Ej.: guitarra, batería suave, sintetizador", "E.g.: guitar, soft drums, synth")} />
          <Text name="music_search" label={t("Qué buscar en bibliotecas de música libre", "What to search in royalty-free libraries")} value={commas(m.searchTerms)} placeholder="upbeat corporate, modern industrial" />
        </div>
      </fieldset>

      <fieldset className={s.group}>
        <legend className={s.legend}>{t("Estilo de fotos", "Photo style")}</legend>
        <Area
          name="photo_style"
          label={t("Qué fotos van con tu marca", "What photos fit your brand")}
          value={d.photoStyle}
          rows={3}
          placeholder={t("Ej.: trabajos reales terminados, el taller y el equipo trabajando; luz de día; sin fotos de banco ni caras de clientes.", "E.g.: real finished jobs, the workshop and the team at work; daylight; no stock photos or customers' faces.")}
        />
      </fieldset>
    </>
  );
}

export function IdentityForm({ identity, aiOn, save }: { identity: BrandIdentity; aiOn: boolean; save: Action }) {
  const { t } = useT();
  const [result, run, pending] = useActionState(save, null);
  return (
    <section className="card" id="identidad-detalle" aria-labelledby="identidad-detalle-title">
      <div className="stack" style={{ gap: 4 }}>
        <h2 id="identidad-detalle-title">{t("Eslogan, mensajes, voz y música", "Slogan, messages, voice and music")}</h2>
        <p className="small muted">
          {t(
            "La IA sigue esto en todo lo que escribe para tu negocio: posts, artículos y respuestas a reseñas. Escríbelo tú, o deja que la IA llene lo que falta.",
            "The AI follows this in everything it writes for your business: posts, articles and review replies. Write it yourself, or let the AI fill in what's missing.",
          )}
        </p>
      </div>
      <form action={run} className={s.form}>
        <Fields key={identity.updatedAt || "new"} identity={identity} />
        <div className={s.bar}>
          {pending ? (
            <p className={s.progress} role="status">
              <span className={s.spinner} aria-hidden />
              {t("Guardando… (si pediste ayuda a la IA, tarda unos segundos)", "Saving… (if you asked the AI for help, it takes a few seconds)")}
            </p>
          ) : (
            <div className={s.actions}>
              <button type="submit" name="intent" value="save" className="btn on">{t("Guardar mi identidad", "Save my identity")}</button>
              {aiOn && (
                <button type="submit" name="intent" value="complete" className="btn ai">{t("✦ Completar con IA", "✦ Complete with AI")}</button>
              )}
            </div>
          )}
          {aiOn && !pending && <span className="small muted">{t("«Completar con IA» guarda lo tuyo y llena solo lo que está vacío.", "“Complete with AI” saves your text and fills only what's empty.")}</span>}
          {result && !pending && <p className={`note ${result.ok ? "ok" : "error"}`} role="status">{result.message}</p>}
        </div>
      </form>
    </section>
  );
}
