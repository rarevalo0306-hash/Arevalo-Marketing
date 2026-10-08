import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { I18nProvider } from "@/components/I18n";
import { inkOn } from "@/lib/design-shapes";
import { asLang, LANG_COOKIE, translator, type UiLang } from "@/lib/i18n";
import { r2Enabled } from "@/lib/r2";
import { businessForToken } from "@/lib/upload";
import { langFromAcceptLanguage } from "@/lib/upload-rules";
import { BizLogo } from "./BizLogo";
import { UploadForm } from "./UploadForm";
import s from "./subir.module.css";

// Link de subida para los técnicos: sin entrar a la app. Suben fotos y videos desde el celular a «Tus fotos» del negocio.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Subir fotos", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Idioma: el elegido en este navegador (si entró a la app alguna vez) o el del celular. */
async function pageLang(): Promise<UiLang> {
  const saved = (await cookies()).get(LANG_COOKIE)?.value;
  if (saved) return asLang(saved);
  return langFromAcceptLanguage((await headers()).get("accept-language"));
}

const HEX = /^#[0-9a-f]{6}$/i;

export default async function SubirPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const lang = await pageLang();
  const t = translator(lang);
  const b = await businessForToken(token);

  if (!b || !r2Enabled()) {
    return (
      <main className={s.page} lang={lang}>
        <section className={`card ${s.gone}`}>
          <span className={s.goneIcon} aria-hidden="true">
            {b ? "⏳" : "🔗"}
          </span>
          <h1>{b ? t("La subida todavía no está lista", "Uploads aren't ready yet") : t("Este link ya no sirve", "This link doesn't work anymore")}</h1>
          <p>
            {b
              ? t("Falta terminar de prepararla en la app. Avísale a tu jefe.", "It still needs to be set up in the app. Let your boss know.")
              : t("Pídele uno nuevo a tu jefe.", "Ask your boss for a new one.")}
          </p>
        </section>
      </main>
    );
  }

  const color = HEX.test(b.color) ? b.color : "#126BBC";
  const style = { "--biz": color, "--biz-ink": inkOn(color) } as React.CSSProperties;
  return (
    <I18nProvider lang={lang}>
      <main className={s.page} style={style} lang={lang}>
        <header className={s.head}>
          <BizLogo src={b.logoUrl} name={b.name} />
          <div className={s.headText}>
            <span className={s.biz}>{b.name}</span>
            <h1>{t("Sube fotos y videos de tu trabajo", "Upload photos and videos of your work")}</h1>
          </div>
        </header>
        <p className={s.lead}>
          {t(
            "Lo que subas aquí le llega a la empresa para usarlo en sus redes sociales. No necesitas cuenta ni contraseña.",
            "What you upload here goes to the company to use on its social media. You don't need an account or a password.",
          )}
        </p>
        <UploadForm token={token} />
      </main>
    </I18nProvider>
  );
}
