"use client";

import { useState } from "react";
import { useT } from "@/components/I18n";
import { GOAL_LABEL, MAX_DAYS, maxSpendCents, money, parseMoney, type AdGoal } from "@/lib/ads-shape";
import { ActionForm, type AdsAction } from "./AdsForms";
import s from "./ads.module.css";

export type PostOption = { value: string; label: string };

/** Crear un anuncio a mano: siempre queda APAGADO. */
export function NewAdForm({
  action,
  posts,
  special,
  hasMapPlace,
  defaultCity,
  defaultDays,
  roomCents,
  hasPhone,
}: {
  action: AdsAction;
  posts: PostOption[];
  special: boolean;
  hasMapPlace: boolean;
  defaultCity: string;
  defaultDays: number;
  roomCents: number;
  hasPhone: boolean;
}) {
  const { t } = useT();
  const [goal, setGoal] = useState<AdGoal>("awareness");
  const [post, setPost] = useState(posts[0]?.value ?? "new");
  const [daily, setDaily] = useState("5");
  const [days, setDays] = useState(String(Math.min(defaultDays, 7)));
  const needNew = goal === "messages" || goal === "calls";
  const needPost = goal === "engagement";
  const isNew = needNew || (!needPost && post === "new");
  const total = maxSpendCents(parseMoney(daily) ?? 0, Number(days) || 1);
  const goals: AdGoal[] = ["awareness", "traffic", "engagement", "messages", "calls"];
  return (
    <ActionForm action={action} busy={t("Creando en Meta (apagado, no gasta)…", "Creating on Meta (paused, spends nothing)…")}>
      <div className={s.formGrid}>
        <label>
          <span className="lbl">{t("¿Qué quieres lograr?", "What do you want?")}</span>
          <select className="field" name="goal" value={goal} onChange={(e) => setGoal(e.target.value as AdGoal)}>
            {goals.map((g) => (
              <option key={g} value={g} disabled={g === "calls" && !hasPhone}>
                {t(GOAL_LABEL[g].es, GOAL_LABEL[g].en)}
                {g === "calls" && !hasPhone ? ` (${t("falta el teléfono", "phone missing")})` : ""}
              </option>
            ))}
          </select>
        </label>
        {!needNew && (
          <label>
            <span className="lbl">{t("¿Qué se promociona?", "What gets promoted?")}</span>
            <select className="field" name="post" value={needPost && post === "new" ? posts[0]?.value ?? "" : post} onChange={(e) => setPost(e.target.value)} required={needPost}>
              {!needPost && <option value="new">{t("Un anuncio nuevo (escribo el texto)", "A new ad (I write the text)")}</option>}
              {posts.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            {needPost && !posts.length && <span className="small muted">{t("No encontré publicaciones para promocionar.", "I found no posts to promote.")}</span>}
          </label>
        )}
        {needNew && <input type="hidden" name="post" value="new" />}
      </div>
      {isNew && (
        <div className={s.formGrid}>
          <label style={{ gridColumn: "1 / -1" }}>
            <span className="lbl">{t("Texto del anuncio", "Ad text")}</span>
            <textarea className="field" name="text" rows={4} style={{ minHeight: 100 }} required minLength={10} placeholder={t("Usa tus palabras clave: qué haces, dónde y cómo te contactan.", "Use your keywords: what you do, where and how to contact you.")} />
          </label>
          <label>
            <span className="lbl">{t("Título (opcional)", "Headline (optional)")}</span>
            <input className="field" name="headline" maxLength={40} />
          </label>
          <label>
            <span className="lbl">{t("Foto (dirección web, opcional)", "Photo (web address, optional)")}</span>
            <input className="field" name="image" type="url" placeholder="https://…" />
          </label>
        </div>
      )}
      <div className={s.formGrid}>
        <label>
          <span className="lbl">{t("Gasto por día (US$)", "Spend per day (US$)")}</span>
          <input className="field" name="daily" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} required />
        </label>
        <label>
          <span className="lbl">{t("Días", "Days")}</span>
          <input className="field" name="days" type="number" min={1} max={MAX_DAYS} value={days} onChange={(e) => setDays(e.target.value)} required />
        </label>
        <label>
          <span className="lbl">{t("Radio (km)", "Radius (km)")}</span>
          <input className="field" name="radius" type="number" min={special ? 25 : 1} max={80} defaultValue={special ? 25 : 15} required />
        </label>
        {!hasMapPlace && (
          <label>
            <span className="lbl">{t("Ciudad", "City")}</span>
            <input className="field" name="city" defaultValue={defaultCity} placeholder="Managua" required />
          </label>
        )}
      </div>
      {!special && (
        <details className={s.howto}>
          <summary>{t("Más opciones de público (edades, intereses)", "More audience options (ages, interests)")}</summary>
          <div className={s.formGrid}>
            <label>
              <span className="lbl">{t("Edad mínima", "Minimum age")}</span>
              <input className="field" name="ageMin" type="number" min={18} max={65} placeholder="18" />
            </label>
            <label>
              <span className="lbl">{t("Edad máxima", "Maximum age")}</span>
              <input className="field" name="ageMax" type="number" min={18} max={65} placeholder="65+" />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              <span className="lbl">{t("Intereses (separados por comas, en inglés)", "Interests (comma separated)")}</span>
              <input className="field" name="interests" placeholder="Home improvement, Small business" />
            </label>
          </div>
        </details>
      )}
      <input type="hidden" name="name" value="" />
      <p className={total > roomCents ? "note error" : "note info"}>
        {t(
          `Lo máximo que podría gastar: ${money(total)}. A la campaña le quedan ${money(roomCents)}. Se crea APAGADO: no gasta nada hasta que lo enciendas.`,
          `The most it could spend: ${money(total)}. The campaign has ${money(roomCents)} left. It's created PAUSED: it spends nothing until you turn it on.`,
        )}
      </p>
      <div><button className="btn on" type="submit" disabled={total > roomCents}>{t("Crear (pausado)", "Create (paused)")}</button></div>
    </ActionForm>
  );
}
