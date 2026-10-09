import type { Metadata, Viewport } from "next";
import { I18nProvider } from "@/components/I18n";
import { uiLang } from "@/lib/i18n-server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const lang = await uiLang();
  return {
    title: "Nehora",
    description: lang === "en" ? "Publish once and it goes out on all your channels." : "Publica una vez y sale en todos tus canales.",
    // Al instalarla en el iPhone abre a pantalla completa, como una app.
    appleWebApp: { capable: true, title: "Nehora", statusBarStyle: "default" },
  };
}

/** Estilo guardado (o «Claro») + color de la barra del navegador. Lo usa también ThemePicker (window.__amTheme). */
const THEME_BOOT = `(function(){var C={claro:"#ffffff",noche:"#0b1220",vidrio:"#eef2fb"};function a(t){if(!C[t])t="claro";document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",C[t]);return t}window.__amTheme=a;var t="claro";try{t=localStorage.getItem("am-theme")||"claro"}catch(e){}a(t);document.addEventListener("DOMContentLoaded",function(){a(document.documentElement.dataset.theme)})})()`;

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await uiLang();
  return (
    <html lang={lang} data-theme="claro" suppressHydrationWarning>
      <head>
        {/* Aplica el estilo guardado antes de pintar, para que no parpadee. Sin elección guardada: «Claro». */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Montserrat:wght@800&family=Poppins:wght@800&family=Inter:wght@800&family=Oswald:wght@700&family=Playfair+Display:wght@800&display=swap"
        />
      </head>
      <body>
        <I18nProvider lang={lang}>{children}</I18nProvider>
      </body>
    </html>
  );
}
