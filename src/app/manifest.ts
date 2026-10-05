import type { MetadataRoute } from "next";

// Permite instalar la app en el celular o la computadora ("Agregar a pantalla de inicio").
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Arevalo Marketing",
    short_name: "Marketing",
    description: "Publica una vez y sale en todos tus canales, con IA.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1220",
    theme_color: "#0b1220",
    lang: "es",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
