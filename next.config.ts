import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Las fuentes de los diseños se leen del disco en el servidor. Las letras estándar del PDF (pdfkit) se cargan
  // con un require dinámico que Vercel no detecta solo: sin ellas la página de Diagnóstico se cae.
  outputFileTracingIncludes: { "/**": ["./src/assets/fonts/**", "./node_modules/pdfkit/js/standard-fonts/**"] },
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
