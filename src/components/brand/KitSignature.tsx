"use client";

import { useEffect, useState } from "react";
import { downloadUrl, HowTo } from "@/components/brand/KitCard";
import type { KitBusiness, KitItem } from "@/components/brand/KitPanel";
import { useT } from "@/components/I18n";
import { signatureHtml, signatureText, type KitFormat } from "@/lib/brand-kit-formats";
import s from "./Kit.module.css";

/** Copia la firma con formato (para pegarla en Gmail u Outlook) y, si el navegador no deja, como texto. */
async function copyRich(html: string, text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
      return true;
    }
  } catch {}
  // Navegadores viejos: se selecciona una copia escondida y se copia.
  try {
    const box = document.createElement("div");
    box.contentEditable = "true";
    box.innerHTML = html;
    box.style.cssText = "position:fixed;left:-9999px;top:0;background:#fff";
    document.body.appendChild(box);
    const range = document.createRange();
    range.selectNodeContents(box);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const ok = document.execCommand("copy");
    sel?.removeAllRanges();
    box.remove();
    if (ok) return true;
  } catch {}
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function KitSignature({ businessId, business, logo, format, tagline }: { businessId: string; business: KitBusiness; logo: KitItem; format: KitFormat; tagline: string }) {
  const { t, lang } = useT();
  const key = `kit-signature-${businessId}`;
  const [person, setPerson] = useState("");
  const [role, setRole] = useState("");
  const [copied, setCopied] = useState<"" | "ok" | "fail">("");
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? "null") as { person?: string; role?: string } | null;
      if (v?.person) setPerson(v.person);
      if (v?.role) setRole(v.role);
    } catch {}
  }, [key]);
  const remember = (p: string, r: string) => {
    try {
      localStorage.setItem(key, JSON.stringify({ person: p, role: r }));
    } catch {}
  };
  // El correo necesita la dirección completa de la imagen.
  const logoUrl = /^https?:\/\//.test(logo.url) ? logo.url : origin ? origin + logo.url : logo.url;
  const data = { name: business.name, person, role, tagline, phone: business.phone, website: business.website, color: business.color, logoUrl, logoW: logo.w, logoH: logo.h };
  const html = signatureHtml(data);

  return (
    <figure className={`${s.item} ${s.wide}`}>
      <div className={s.signature}>
        <div className={s.sigPaper} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <figcaption className={s.body}>
        <div className={s.head}>
          <strong>{t("Firma de email", "Email signature")}</strong>
          <span className="small muted">{t("Con tu logo, teléfono y sitio web", "With your logo, phone and website")}</span>
        </div>
        <div className={s.sigFields}>
          <label className="stack" style={{ gap: 4 }}>
            <span className="small lbl">{t("Tu nombre (opcional)", "Your name (optional)")}</span>
            <input className="field" value={person} maxLength={60} onChange={(e) => { setPerson(e.target.value); remember(e.target.value, role); }} placeholder={t("Ej.: Ricardo Arévalo", "E.g.: Ricardo Arevalo")} />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span className="small lbl">{t("Cargo (opcional)", "Job title (optional)")}</span>
            <input className="field" value={role} maxLength={60} onChange={(e) => { setRole(e.target.value); remember(person, e.target.value); }} placeholder={t("Ej.: Gerente", "E.g.: Manager")} />
          </label>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn solid"
            onClick={async () => {
              const ok = await copyRich(html, signatureText(data));
              setCopied(ok ? "ok" : "fail");
              setTimeout(() => setCopied(""), 4000);
            }}
          >
            {t("Copiar firma", "Copy signature")}
          </button>
          <a className="btn" href={downloadUrl(businessId, logo.id, lang)} download>
            {t("Descargar el logo de la firma", "Download the signature logo")}
          </a>
        </div>
        {copied && (
          <p className={copied === "ok" ? "note ok" : "note error"} role="status">
            {copied === "ok" ? t("Firma copiada. Ahora pégala en tu correo.", "Signature copied. Now paste it in your email.") : t("Tu navegador no dejó copiar. Selecciona la firma de arriba y cópiala.", "Your browser didn't allow copying. Select the signature above and copy it.")}
          </p>
        )}
        <HowTo places={format.places} title={t("¿Cómo la pongo en mi correo?", "How do I add it to my email?")} />
      </figcaption>
    </figure>
  );
}
