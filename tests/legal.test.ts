// Enlaces legales y el aviso «Al continuar, aceptas…»: en el idioma de la app y en cada lugar donde se entra o se conecta.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsentLine, LegalLinks, YoutubeTermsLine } from "@/components/ConsentLine";
import { I18nProvider } from "@/components/I18n";
import type { UiLang } from "@/lib/i18n";
import { GOOGLE_PERMISSIONS_URL, GOOGLE_PRIVACY_URL, legalUrl, YOUTUBE_TERMS_URL } from "@/lib/legal";

const ROOT = join(__dirname, "..");
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");
// I18nProvider no usa hooks: se llama directo para envolver el elemento con el idioma.
const html = (lang: UiLang, el: ReactElement) => renderToStaticMarkup(I18nProvider({ lang, children: el }));

describe("legal links", () => {
  it("point to matya.app in the app's language (English under /en/)", () => {
    expect(legalUrl("condiciones", "en")).toBe("https://matya.app/en/condiciones/");
    expect(legalUrl("privacidad", "en")).toBe("https://matya.app/en/privacidad/");
    expect(legalUrl("borrado-de-datos", "en")).toBe("https://matya.app/en/borrado-de-datos/");
    expect(legalUrl("condiciones", "es")).toBe("https://matya.app/condiciones/");
    expect(legalUrl("privacidad", "es")).toBe("https://matya.app/privacidad/");
    expect(legalUrl("borrado-de-datos", "es")).toBe("https://matya.app/borrado-de-datos/");
  });

  it("Google's and YouTube's pages", () => {
    expect(YOUTUBE_TERMS_URL).toBe("https://www.youtube.com/t/terms");
    expect(GOOGLE_PRIVACY_URL).toBe("https://policies.google.com/privacy");
    expect(GOOGLE_PERMISSIONS_URL).toBe("https://myaccount.google.com/permissions");
  });
});

describe("consent line", () => {
  it("says what the person agrees to, with the links in their language", () => {
    expect(html("en", createElement(ConsentLine))).toBe(
      '<p class="small muted">By continuing, you agree to the <a href="https://matya.app/en/condiciones/">Terms of Use</a> and <a href="https://matya.app/en/privacidad/">Privacy Policy</a>.</p>',
    );
    expect(html("es", createElement(ConsentLine))).toBe(
      '<p class="small muted">Al continuar, aceptas las <a href="https://matya.app/condiciones/">Condiciones de uso</a> y la <a href="https://matya.app/privacidad/">Política de privacidad</a>.</p>',
    );
  });

  it("YouTube: its Terms of Service and Google's Privacy Policy", () => {
    expect(html("en", createElement(YoutubeTermsLine, { className: "hint" }))).toBe(
      '<p class="hint">YouTube: by connecting, you agree to the <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a> and the <a href="https://policies.google.com/privacy">Google Privacy Policy</a>.</p>',
    );
    expect(html("es", createElement(YoutubeTermsLine))).toContain("YouTube: al conectar aceptas las ");
  });

  it("the footer of the sign-in cards follows the language too", () => {
    const en = html("en", createElement(LegalLinks));
    expect(en).toContain('<a href="https://matya.app/en/privacidad/">Privacy</a>');
    expect(en).toContain('<a href="https://matya.app/en/condiciones/">Terms</a>');
    expect(en).toContain('<a href="https://matya.app/en/borrado-de-datos/">Data deletion</a>');
    expect(html("es", createElement(LegalLinks))).toContain('<a href="https://matya.app/condiciones/">Condiciones</a>');
  });

  it("is shown where people sign in, accept an invitation, choose a password or connect Google, Facebook and Instagram", () => {
    // AuthCard: invitación, «¿Olvidaste tu contraseña?» y contraseña nueva.
    for (const path of ["src/components/AuthCard.tsx", "src/app/login/page.tsx"]) {
      const s = source(path);
      expect(s, path).toContain("<ConsentLine");
      expect(s, path).toContain("<LegalLinks />");
      expect(s, path).not.toContain("https://matya.app/");
    }
    for (const path of ["src/components/ConnectionCard.tsx", "src/app/b/[id]/conexiones/GscCard.tsx", "src/app/b/[id]/conexiones/Ga4Card.tsx", "src/components/seo/Ga4Panel.tsx"])
      expect(source(path), path).toContain("<ConsentLine");
    expect(source("src/components/ConnectionCard.tsx")).toMatch(/channel\.id === "youtube" && <YoutubeTermsLine/);
  });

  it("the Connections page links Privacy, Terms, Data deletion and where to remove Matya's access", () => {
    const s = source("src/app/b/[id]/conexiones/page.tsx");
    for (const page of ["privacidad", "condiciones", "borrado-de-datos"]) expect(s).toContain(`legalUrl("${page}", lang)`);
    expect(s).toContain("<a href={GOOGLE_PERMISSIONS_URL}>myaccount.google.com/permissions</a>");
    expect(s).toContain("Data from YouTube is refreshed or deleted within 30 days.");
  });
});
