import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Las fuentes de los diseños se leen del disco en el servidor.
  outputFileTracingIncludes: { "/**": ["./src/assets/fonts/**"] },
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
