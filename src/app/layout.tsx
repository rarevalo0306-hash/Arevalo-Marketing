import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arevalo Marketing",
  description: "Publica una vez y sale en todos tus canales.",
  // Al instalarla en el iPhone abre a pantalla completa, como una app.
  appleWebApp: { capable: true, title: "Marketing", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#0b1220", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" data-theme="noche" suppressHydrationWarning>
      <head>
        {/* Aplica el estilo guardado antes de pintar, para que no parpadee. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("am-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}` }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
