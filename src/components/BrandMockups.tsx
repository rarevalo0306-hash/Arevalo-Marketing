"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18n";
import s from "./BrandMockups.module.css";

export type MockBrand = {
  name: string;
  logo: string;
  logoLight: string;
  c1: string;
  c2: string;
  c3: string;
  /** CSS de la letra de los titulares (ya cargada en la app). */
  headingCss: string;
  /** Nombre de la letra del texto (de Google Fonts), o "". */
  bodyFont: string;
  phone: string;
  website: string;
  hashtags: string;
};

/** Texto blanco u oscuro, el que se lea mejor sobre ese color. */
export function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.45 ? "#0f1b2d" : "#ffffff";
}

const host = (w: string) => w.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || "";

/** El logo para fondo claro u oscuro; si no hay logo, el nombre escrito con la letra de la marca. */
function Mark({ b, dark, className }: { b: MockBrand; dark: boolean; className?: string }) {
  const src = dark ? b.logoLight : b.logo;
  if (src)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className={`${s.logo} ${className ?? ""}`} />
    );
  // Solo hay el logo para el otro fondo: va en una tarjetita (blanca o oscura) para que se vea.
  const other = dark ? b.logo : b.logoLight;
  if (other)
    return (
      <span className={`${s.logoChip} ${className ?? ""}`} style={{ background: dark ? "#ffffff" : "#0f1b2d" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={other} alt="" className={s.logo} />
      </span>
    );
  return (
    <span className={`${s.wordmark} ${className ?? ""}`} style={{ fontFamily: b.headingCss }}>
      {b.name}
    </span>
  );
}

/** Maquetas de la marca: tarjeta de presentación, post de Instagram, encabezado de sitio web y vehículo. */
export function BrandMockups({ brand: b }: { brand: MockBrand }) {
  const { t } = useT();
  // La letra del texto se pide a Google Fonts cuando dejan de escribir (no en cada tecla).
  const [bodyFont, setBodyFont] = useState(b.bodyFont);
  useEffect(() => {
    const id = setTimeout(() => setBodyFont(b.bodyFont), 700);
    return () => clearTimeout(id);
  }, [b.bodyFont]);
  const body = bodyFont.trim() ? `'${bodyFont.trim().replace(/['"\\]/g, "")}', system-ui, sans-serif` : "system-ui, sans-serif";
  const fontHref = /^[\w\s-]{2,40}$/.test(bodyFont.trim())
    ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(bodyFont.trim()).replace(/%20/g, "+")}:wght@400;600&display=swap`
    : "";
  const on1 = inkOn(b.c1);
  const on3 = inkOn(b.c3);
  const site = host(b.website) || t("tunegocio.com", "yourbusiness.com");
  const phone = b.phone.trim() || "+505 8888 1234";
  const tag = b.hashtags.trim().split(/\s+/)[0] || "";
  const handle = `@${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  const darkBg = on1 === "#ffffff";

  return (
    <div className={s.grid} style={{ fontFamily: body }}>
      {fontHref && <link rel="stylesheet" href={fontHref} precedence="default" />}

      <figure className={s.item}>
        <div className={s.cards}>
          <div className={s.bcard} style={{ background: b.c1, color: on1 }}>
            <Mark b={b} dark={darkBg} className={s.bcardMark} />
            <span className={s.bcardStripe} style={{ background: b.c3 }} />
          </div>
          <div className={`${s.bcard} ${s.bcardBack}`}>
            <span className={s.bcardBar} style={{ background: `linear-gradient(90deg, ${b.c1}, ${b.c2})` }} />
            <strong style={{ fontFamily: b.headingCss, color: b.c1 }}>{b.name}</strong>
            <span>{phone}</span>
            <span>{site}</span>
          </div>
        </div>
        <figcaption>{t("Tarjeta de presentación", "Business card")}</figcaption>
      </figure>

      <figure className={s.item}>
        <div className={s.post}>
          <div className={s.postHead}>
            <span className={s.avatar} style={{ background: b.c1 }}>
              {b.logo || b.logoLight ? (
                <Mark b={b} dark={darkBg} className={s.avatarMark} />
              ) : (
                <span className={s.initial} style={{ color: on1, fontFamily: b.headingCss }}>{b.name.trim().charAt(0).toUpperCase()}</span>
              )}
            </span>
            <span className={s.postName}>{handle}</span>
          </div>
          <div className={s.postImg} style={{ background: `linear-gradient(150deg, ${b.c1} 0%, ${b.c2} 100%)`, color: inkOn(b.c2) === on1 ? on1 : "#ffffff" }}>
            <span className={s.postKicker} style={{ background: b.c3, color: on3 }}>{t("Consejo", "Tip")}</span>
            <strong className={s.postTitle} style={{ fontFamily: b.headingCss }}>
              {t("Te ayudamos hoy mismo", "We can help you today")}
            </strong>
            <span className={s.postPhone}>{phone}</span>
          </div>
          <div className={s.postFoot}>
            <span>♡ ◯ ➤</span>
            {tag && <span className={s.postTag} style={{ color: b.c1 }}>{tag}</span>}
          </div>
        </div>
        <figcaption>{t("Post de Instagram", "Instagram post")}</figcaption>
      </figure>

      <figure className={s.item}>
        <div className={s.browser}>
          <div className={s.chrome}>
            <i /><i /><i />
            <span className={s.url}>{site}</span>
          </div>
          <div className={s.nav}>
            <Mark b={b} dark={false} className={s.navMark} />
            <span className={s.menu}>
              <span>{t("Servicios", "Services")}</span>
              <span>{t("Nosotros", "About")}</span>
            </span>
            <span className={s.cta} style={{ background: b.c3, color: on3 }}>{t("Llámanos", "Call us")}</span>
          </div>
          <div className={s.hero} style={{ background: b.c1, color: on1 }}>
            <strong style={{ fontFamily: b.headingCss }}>{b.name}</strong>
            <span>{t("Calidad y confianza para tu hogar y tu negocio.", "Quality and trust for your home and business.")}</span>
            <span className={s.heroBtn} style={{ background: b.c3, color: on3 }}>{phone}</span>
          </div>
        </div>
        <figcaption>{t("Encabezado de tu sitio web", "Website header")}</figcaption>
      </figure>

      <figure className={s.item}>
        <div className={s.vanScene}>
          <div className={s.van}>
            <div className={s.vanBody}>
              <span className={s.vanWindow} />
              <span className={s.vanStripe} style={{ background: `linear-gradient(90deg, ${b.c1}, ${b.c2} 70%, ${b.c3})` }} />
              <span className={s.vanSide}>
                <Mark b={b} dark={false} className={s.vanMark} />
                <span className={s.vanPhone} style={{ color: b.c1 }}>{phone}</span>
              </span>
            </div>
            <span className={`${s.wheel} ${s.wheelA}`} />
            <span className={`${s.wheel} ${s.wheelB}`} />
          </div>
        </div>
        <figcaption>{t("Vehículo de trabajo", "Work vehicle")}</figcaption>
      </figure>
    </div>
  );
}
