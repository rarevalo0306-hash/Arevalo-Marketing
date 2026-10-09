"use client";

// «Tus datos oficiales»: nombre, dirección, teléfono, página web, horario, categorías y descripciones, cada uno con
// «Copiar», para pegar exactamente lo mismo en todos los directorios. La IA puede escribir las descripciones.
import { useActionState, useState } from "react";
import { writeDescriptions, type DescResult } from "@/app/actions-directories";
import { useT } from "@/components/I18n";
import type { NapDescriptions } from "@/lib/directories";
import { CopyButton } from "./CopyButton";
import s from "./Directories.module.css";

export type NapCardProps = {
  businessId: string;
  official: { name: string; phone: string; address: string; website: string };
  hours: { day: string; es: string; en: string; text: string }[];
  categories: string[];
  keywords: string[];
  descriptions: NapDescriptions;
  fromAi: boolean;
  links: { business: string; gbp: string; schema: string };
};

function Field({ label, value, empty, copyLabel, multiline }: { label: string; value: string; empty: React.ReactNode; copyLabel: string; multiline?: boolean }) {
  return (
    <div className={s.field}>
      <div className={s.fieldHead}>
        <span className={s.fieldLabel}>{label}</span>
        {value && <CopyButton text={value} label={copyLabel} />}
      </div>
      {value ? <div className={multiline ? s.fieldText : s.fieldValue}>{value}</div> : <div className={`${s.fieldValue} ${s.fieldEmpty}`}>{empty}</div>}
    </div>
  );
}

export function NapCard(p: NapCardProps) {
  const { lang, t } = useT();
  const [descLang, setDescLang] = useState<"es" | "en">(lang);
  const [state, action, isPending] = useActionState<DescResult, FormData>(writeDescriptions.bind(null, p.businessId), null);
  const d = state?.descriptions ?? p.descriptions;
  const fromAi = !!state?.descriptions || p.fromAi;
  const hoursText = p.hours
    .map((h) => `${lang === "en" ? h.en : h.es}: ${h.text || t("Cerrado", "Closed")}`)
    .join("\n");
  const short = descLang === "en" ? d.shortEn : d.shortEs;
  const long = descLang === "en" ? d.longEn : d.longEs;
  const missingLink = (href: string, text: string) => (
    <a href={href} className={s.fixLink}>
      {text}
    </a>
  );
  return (
    <div className={s.nap}>
      <Field label={t("Nombre", "Name")} value={p.official.name} copyLabel={t("el nombre", "the name")} empty={t("Falta", "Missing")} />
      <Field
        label={t("Dirección", "Address")}
        value={p.official.address}
        copyLabel={t("la dirección", "the address")}
        empty={<>{t("Todavía no la sabemos.", "We don't know it yet.")} {missingLink(p.links.gbp, t("Actualiza tu Perfil de Google", "Refresh your Google profile"))}</>}
      />
      <Field
        label={t("Teléfono", "Phone")}
        value={p.official.phone}
        copyLabel={t("el teléfono", "the phone")}
        empty={<>{t("Falta.", "Missing.")} {missingLink(p.links.business, t("Agrégalo en «Mi negocio»", "Add it in “My business”"))}</>}
      />
      <Field
        label={t("Página web", "Website")}
        value={p.official.website}
        copyLabel={t("la página web", "the website")}
        empty={<>{t("Falta.", "Missing.")} {missingLink(p.links.business, t("Agrégala en «Mi negocio»", "Add it in “My business”"))}</>}
      />
      <Field
        label={t("Horario", "Hours")}
        value={hoursText}
        multiline
        copyLabel={t("el horario", "the hours")}
        empty={<>{t("Sin horario guardado.", "No hours saved.")} {missingLink(p.links.schema, t("Escríbelo en «Código para Google»", "Enter it in “Code for Google”"))}</>}
      />
      <Field
        label={t("Categorías", "Categories")}
        value={p.categories.join(", ")}
        copyLabel={t("las categorías", "the categories")}
        empty={t("Usa la misma categoría principal que en tu Perfil de Google.", "Use the same main category as on your Google profile.")}
      />
      {p.keywords.length > 0 && (
        <div className={s.field}>
          <div className={s.fieldHead}>
            <span className={s.fieldLabel}>{t("Palabras clave para usar en la descripción", "Keywords to use in the description")}</span>
            <CopyButton text={p.keywords.join(", ")} label={t("las palabras clave", "the keywords")} />
          </div>
          <div className={s.kws}>
            {p.keywords.map((k) => (
              <span key={k} className="tag">
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className={s.descBox}>
        <div className={s.descHead}>
          <span className={s.fieldLabel}>{t("Descripción", "Description")}</span>
          <div className="theme-pick" role="group" aria-label={t("Idioma de la descripción", "Description language")}>
            {(["es", "en"] as const).map((l) => (
              <button key={l} type="button" className={descLang === l ? "on" : ""} aria-pressed={descLang === l} onClick={() => setDescLang(l)}>
                {l === "es" ? "Español" : "English"}
              </button>
            ))}
          </div>
        </div>
        <p className="small muted">
          {fromAi
            ? t("Escritas por la IA con tus palabras clave y la voz de tu marca. Revísalas antes de pegarlas.", "Written by the AI with your keywords and brand voice. Check them before pasting.")
            : t("Ejemplo armado con tus servicios y palabras clave. Pide a la IA una versión mejor.", "A sample built from your services and keywords. Ask the AI for a better one.")}
        </p>
        <Field label={t(`Corta (${short.length} letras)`, `Short (${short.length} characters)`)} value={short} multiline copyLabel={t("la descripción corta", "the short description")} empty="—" />
        <Field label={t(`Larga (${long.length} de 750 letras)`, `Long (${long.length} of 750 characters)`)} value={long} multiline copyLabel={t("la descripción larga", "the long description")} empty="—" />
        {isPending && (
          <p className="small muted" role="status">
            {t("La IA está escribiendo tus descripciones…", "The AI is writing your descriptions…")}
          </p>
        )}
        <form action={action} style={isPending ? { display: "none" } : undefined}>
          <button type="submit" className="btn outline">
            {fromAi ? t("Escribirlas otra vez con IA", "Rewrite them with AI") : t("Que la IA las escriba", "Have the AI write them")}
          </button>
        </form>
        {state?.message && !isPending && (
          <p className={`note ${state.ok ? "ok" : "error"}`} role={state.ok ? "status" : "alert"}>
            {state.message}
          </p>
        )}
      </div>
    </div>
  );
}
