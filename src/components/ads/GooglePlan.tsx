"use client";

import { useState } from "react";
import { useT } from "@/components/I18n";
import { DESCRIPTION_MAX, GOOGLE_STEPS, googlePlanCsv, HEADLINE_MAX, type GooglePlan } from "@/lib/ads-google";
import { money } from "@/lib/ads-shape";
import { ActionForm, type AdsAction } from "./AdsForms";
import s from "./ads.module.css";

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn link"
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          window.prompt(t("Copia el texto:", "Copy the text:"), text);
        }
      }}
    >
      {done ? t("¡Copiado!", "Copied!") : label}
    </button>
  );
}

function Texts({ list, max }: { list: string[]; max: number }) {
  return (
    <ul className={s.texts}>
      {list.map((h) => (
        <li key={h}>
          <span>{h}</span>
          <span className={`${s.count} ${h.length > max ? s.over : ""}`}>{h.length}/{max}</span>
        </li>
      ))}
    </ul>
  );
}

export function GooglePlanView({ plan, improve, aiReady, keywordsAt }: { plan: GooglePlan; improve: AdsAction; aiReady: boolean; keywordsAt: string }) {
  const { t } = useT();
  const download = () => {
    const blob = new Blob(["﻿" + googlePlanCsv(plan)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "google-ads-editor.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const totalKw = plan.groups.reduce((n, g) => n + g.keywords.length, 0);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <span className={s.planLabel}>🧾 {t("Plan para copiar — la app no gasta en Google", "Plan to copy — the app doesn't spend on Google")}</span>
        <p className="small muted">
          {t(
            "Google no deja que una app cree anuncios sin una aprobación especial (un «developer token»). Por eso aquí tienes la campaña lista para copiar en Google Ads o importar con Google Ads Editor. Tú decides cuándo encenderla y con qué tarjeta.",
            "Google doesn't let an app create ads without a special approval (a \"developer token\"). So here's the campaign ready to copy into Google Ads or import with Google Ads Editor. You decide when to turn it on and with which card.",
          )}
        </p>
        {!totalKw ? (
          <p className="note">{t("Primero elige las palabras clave del negocio en SEO › Palabras clave.", "First pick the business keywords in SEO › Keywords.")}</p>
        ) : (
          <>
            <div className={s.facts}>
              <div className={s.fact}>
                <b>{money(plan.dailyBudgetCents)}</b>
                <span>{t("por día (sugerido)", "per day (suggested)")}</span>
              </div>
              <div className={s.fact}>
                <b>{plan.avgCpc === null ? "—" : `$${plan.avgCpc.toFixed(2)}`}</b>
                <span>{t("costo por clic promedio", "average cost per click")}</span>
              </div>
              <div className={s.fact}>
                <b>{plan.clicksPerDay || "—"}</b>
                <span>{t("clics por día (aprox.)", "clicks per day (approx.)")}</span>
              </div>
              <div className={s.fact}>
                <b>{money(plan.dailyBudgetCents * 30)}</b>
                <span>{t("al mes, como máximo", "a month, at most")}</span>
              </div>
            </div>
            <p className="small muted">
              {t(
                `Costo por clic de Google Ads (DataForSEO${keywordsAt ? `, ${keywordsAt}` : ""}). Campaña: «${plan.campaignName}» · ${plan.location || "tu zona"}.`,
                `Google Ads cost per click (DataForSEO${keywordsAt ? `, ${keywordsAt}` : ""}). Campaign: "${plan.campaignName}" · ${plan.location || "your area"}.`,
              )}
            </p>
            <div className="row">
              <button className="btn on" type="button" onClick={download}>⬇ {t("Descargar CSV para Google Ads Editor", "Download CSV for Google Ads Editor")}</button>
              {plan.source === "ai" && <span className="pill info">{t("Textos mejorados con IA", "Texts improved by AI")}</span>}
            </div>
            <ActionForm action={improve} busy={t("La IA está escribiendo los textos…", "The AI is writing the texts…")}>
              <div className="row">
                <button className="btn ai" type="submit" disabled={!aiReady}>✨ {t("Mejorar textos con IA", "Improve texts with AI")}</button>
                <span className="small muted">{t("Todo se corta a 30 letras (títulos) y 90 (descripciones).", "Everything fits 30 characters (headlines) and 90 (descriptions).")}</span>
              </div>
            </ActionForm>
          </>
        )}
      </div>

      {plan.groups.map((g) => (
        <section key={g.name} className={s.group} aria-label={g.name}>
          <div className="row between">
            <h3>{t("Grupo de anuncios", "Ad group")}: {g.name}</h3>
            <CopyButton text={g.keywords.map((k) => (k.match === "exact" ? `[${k.text}]` : `"${k.text}"`)).join("\n")} label={t("Copiar palabras", "Copy keywords")} />
          </div>
          <div className="tags">
            {g.keywords.map((k) => (
              <span key={k.text} className="tag" title={k.match === "exact" ? t("Exacta", "Exact") : t("Frase", "Phrase")}>
                {k.match === "exact" ? `[${k.text}]` : `"${k.text}"`}
                {k.volume ? ` · ${k.volume}/${t("mes", "mo")}` : ""}
              </span>
            ))}
          </div>
          <div className="row between">
            <b>{t(`Títulos (${g.headlines.length}, máx. ${HEADLINE_MAX} letras)`, `Headlines (${g.headlines.length}, max ${HEADLINE_MAX} characters)`)}</b>
            <CopyButton text={g.headlines.join("\n")} label={t("Copiar títulos", "Copy headlines")} />
          </div>
          <Texts list={g.headlines} max={HEADLINE_MAX} />
          <div className="row between">
            <b>{t(`Descripciones (${g.descriptions.length}, máx. ${DESCRIPTION_MAX} letras)`, `Descriptions (${g.descriptions.length}, max ${DESCRIPTION_MAX} characters)`)}</b>
            <CopyButton text={g.descriptions.join("\n")} label={t("Copiar descripciones", "Copy descriptions")} />
          </div>
          <Texts list={g.descriptions} max={DESCRIPTION_MAX} />
        </section>
      ))}

      {totalKw > 0 && (
        <section className={s.group}>
          <div className="row between">
            <h3>{t("Palabras negativas", "Negative keywords")}</h3>
            <CopyButton text={plan.negatives.join("\n")} label={t("Copiar", "Copy")} />
          </div>
          <p className="small muted">{t("Búsquedas en las que NO quieres salir (no traen clientes).", "Searches you DON'T want to show up for (they don't bring customers).")}</p>
          <div className="tags">
            {plan.negatives.map((n) => (
              <span key={n} className="tag neg">−{n}</span>
            ))}
          </div>
        </section>
      )}

      <details className={`card ${s.howto}`} open={!totalKw ? undefined : true}>
        <summary>{t("Cómo crearla en Google Ads", "How to create it in Google Ads")}</summary>
        <ol>
          {GOOGLE_STEPS.map((step) => (
            <li key={step.es}>{t(step.es, step.en)}</li>
          ))}
        </ol>
        <p className="small muted">
          {t(
            "Con Google Ads Editor (programa gratis de Google): Cuenta › Importar › Desde archivo › elige el CSV › Revisar cambios › Publicar. Todo entra en PAUSA.",
            "With Google Ads Editor (free Google program): Account › Import › From file › pick the CSV › Review changes › Post. Everything comes in PAUSED.",
          )}
        </p>
      </details>
    </div>
  );
}
