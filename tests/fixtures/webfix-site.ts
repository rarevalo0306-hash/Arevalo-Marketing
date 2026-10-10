// Un sitio de Next.js con App Router con la misma forma que ricardopa-web (rutas en inglés en app/(en)/…, en español
// en app/es/…, páginas [slug] que leen sus datos de lib/, ayuda de metadatos previewMetadata, sitemap y robots).
// Contenido mínimo, solo para las pruebas de «Arréglalo por mí».

export const SITE_FILES: Record<string, string> = {
  "package.json": '{ "name": "site" }\n',
  "package-lock.json": "{}\n",
  "next.config.ts": "export default {};\n",
  "proxy.ts": "export function proxy() {}\n",
  ".github/workflows/ci.yml": "name: ci\n",
  "scripts/check.mjs": "console.log(1);\n",
  "tests/leads.test.mjs": "test();\n",
  "supabase/migrations/1.sql": "select 1;\n",
  "vendor/x.css": "a{}\n",
  "public/hero.png": "\u0000PNG",
  "app/robots.ts": 'import { previewOrigin } from "@/lib/preview-site";\nexport default function robots() { return { rules: [{ userAgent: "*", allow: "/" }], sitemap: `${previewOrigin}/sitemap.xml` }; }\n',
  "app/sitemap.ts":
    'import { services, servicePath } from "@/lib/preview-services";\nimport { previewOrigin } from "@/lib/preview-site";\nexport default function sitemap() { return services.map(s => ({ url: `${previewOrigin}${servicePath("en", s)}` })); }\n',
  "app/(en)/layout.tsx":
    'import Script from "next/script";\nimport { pixelSetup } from "../../lib/ads-measurement";\nimport Document from "../../components/document";\nexport default function Layout({children}) { return <Document locale="en"><Script id="pixel">{pixelSetup}</Script>{children}</Document>; }\n',
  "app/es/layout.tsx":
    'import Script from "next/script";\nimport { pixelSetup } from "../../lib/ads-measurement";\nimport Document from "../../components/document";\nexport default function Layout({children}) { return <Document locale="es"><Script id="pixel">{pixelSetup}</Script>{children}</Document>; }\n',
  "app/(en)/page.tsx":
    'import { ClaimsExperience } from "@/components/claims-experience";\nimport { previewHome, previewMetadata } from "@/lib/preview-site";\nexport const metadata = previewMetadata("en", "Public Adjuster in Miami, Florida", "Public adjuster in Miami.", {en:previewHome("en"),es:previewHome("es")}, {index:true});\nexport default function Page() { return <ClaimsExperience locale="en" fullHome/>; }\n',
  "app/es/page.tsx":
    'import { ClaimsExperience } from "@/components/claims-experience";\nimport { previewHome, previewMetadata } from "@/lib/preview-site";\nexport const metadata = previewMetadata("es", "Ajustador público en Miami, Florida", "Ajustador público en Miami.", {en:previewHome("en"),es:previewHome("es")}, {index:true});\nexport default function Page() { return <ClaimsExperience locale="es" fullHome/>; }\n',
  "app/(en)/services/page.tsx":
    'import { ServicesIndexPage } from "@/components/services-index-page";\nimport { servicesIndexCopy, servicesIndexPath } from "@/lib/preview-services";\nimport { previewMetadata } from "@/lib/preview-site";\nexport const metadata = previewMetadata("en", servicesIndexCopy.en.seoTitle, servicesIndexCopy.en.description, {en:servicesIndexPath("en"),es:servicesIndexPath("es")}, {index:true});\nexport default function Page() { return <ServicesIndexPage locale="en"/>; }\n',
  "app/es/servicios/page.tsx":
    'import { ServicesIndexPage } from "@/components/services-index-page";\nimport { servicesIndexCopy, servicesIndexPath } from "@/lib/preview-services";\nimport { previewMetadata } from "@/lib/preview-site";\nexport const metadata = previewMetadata("es", servicesIndexCopy.es.seoTitle, servicesIndexCopy.es.description, {en:servicesIndexPath("en"),es:servicesIndexPath("es")}, {index:true});\nexport default function Page() { return <ServicesIndexPage locale="es"/>; }\n',
  "app/(en)/services/[slug]/page.tsx":
    'import { notFound } from "next/navigation";\nimport { ServicePage } from "@/components/service-page";\nimport { findService, services, servicePath } from "@/lib/preview-services";\nimport { previewMetadata } from "@/lib/preview-site";\nexport async function generateMetadata({params}) { const {slug}=await params; const service=findService("en",slug); if(!service) notFound(); return previewMetadata("en",service.en.seoTitle ?? service.en.title,service.en.seoDescription ?? service.en.description,{en:servicePath("en",service),es:servicePath("es",service)},{index:true}); }\nexport default async function Page({params}) { const {slug}=await params; return <ServicePage locale="en" service={findService("en",slug)}/>; }\n',
  "app/es/servicios/[slug]/page.tsx":
    'import { notFound } from "next/navigation";\nimport { ServicePage } from "@/components/service-page";\nimport { findService, services, servicePath } from "@/lib/preview-services";\nimport { previewMetadata } from "@/lib/preview-site";\nexport async function generateMetadata({params}) { const {slug}=await params; const service=findService("es",slug); if(!service) notFound(); return previewMetadata("es",service.es.seoTitle ?? service.es.title,service.es.seoDescription ?? service.es.description,{en:servicePath("en",service),es:servicePath("es",service)},{index:true}); }\nexport default async function Page({params}) { const {slug}=await params; return <ServicePage locale="es" service={findService("es",slug)}/>; }\n',
  "app/(en)/resources/[slug]/page.tsx": 'import { articles } from "@/lib/preview-articles";\nexport default function Page() { return null; }\n',
  "app/es/recursos/[slug]/page.tsx": 'import { articles } from "@/lib/preview-articles";\nexport default function Page() { return null; }\n',
  "app/(en)/privacy/page.tsx":
    'import { PrivacyPage } from "@/components/preview-privacy";\nimport { previewMetadata, privacyLabel, privacyPath } from "@/lib/preview-site";\nexport const metadata = previewMetadata("en", privacyLabel("en"), "How we handle your information.", { en: privacyPath("en"), es: privacyPath("es") });\nexport default function Page() { return <PrivacyPage locale="en"/>; }\n',
  "app/(en)/lp/[slug]/page.tsx": 'import { LandingPage } from "@/components/landing-page";\nimport { findLanding } from "@/lib/landing-pages";\nexport default function Page() { return null; }\n',
  "app/api/chat/route.ts": "export async function POST() {}\n",
  "app/share/[card]/route.tsx": "export async function GET() {}\n",
  "components/document.tsx": "export default function Document({children}) { return <html>{children}</html>; }\n",
  "components/claims-experience.tsx": 'import { previewLabels } from "@/lib/preview-site";\nexport function ClaimsExperience() { return <main><h1>Home</h1></main>; }\n',
  "components/service-page.tsx": 'import { previewLabels } from "@/lib/preview-site";\nexport function ServicePage({service}) { return <main><h1>{service.en.title}</h1></main>; }\n',
  "components/services-index-page.tsx": 'import { servicesIndexCopy } from "@/lib/preview-services";\nexport function ServicesIndexPage() { return <main/>; }\n',
  "components/preview-privacy.tsx": "export function PrivacyPage() { return <main/>; }\n",
  "components/landing-page.tsx": "export function LandingPage() { return <main/>; }\n",
  "lib/ads-measurement.ts": 'export const pixelSetup = "window.pixel=1";\n',
  "lib/preview-site.ts":
    'export const previewOrigin = "https://ricardopa.com";\nexport const previewHome = (l) => (l === "en" ? "/" : "/es");\nexport function previewMetadata(locale, title, description, paths, options = {}) { return { title: `${title} | Ricardo Public Adjusters`, description, robots: { index: options.index === true } }; }\nexport const privacyLabel = (l) => (l === "en" ? "Privacy" : "Privacidad");\nexport const privacyPath = (l) => (l === "en" ? "/privacy" : "/es/privacidad");\nexport const previewLabels = {};\n',
  "lib/preview-services.ts":
    'export const services = [\n  { id: "water", en: { seoTitle: "Water Damage Claims in Miami", slug: "water-damage", title: "Water Damage Claims", description: "A clearer starting point for leaks." }, es: { seoTitle: "Reclamos por daños por agua en Miami", slug: "danos-por-agua", title: "Reclamos por daños por agua", description: "Un punto de partida claro para filtraciones." } },\n  { id: "roof", en: { slug: "roof-damage", title: "Roof Damage Claims", description: "Help with roof damage." }, es: { slug: "danos-de-techo", title: "Reclamos por daños de techo", description: "Ayuda con daños de techo." } },\n];\nexport const servicesIndexCopy = { en: { seoTitle: "Claim Services", description: "All services." }, es: { seoTitle: "Servicios", description: "Todos los servicios." } };\nexport const findService = (l, slug) => services.find((s) => s[l].slug === slug);\nexport const servicePath = (l, s) => (l === "en" ? `/services/${s.en.slug}` : `/es/servicios/${s.es.slug}`);\nexport const servicesIndexPath = (l) => (l === "en" ? "/services" : "/es/servicios");\n',
  "lib/preview-articles.ts": `export const articles = [${"{ slug: 'x', body: 'long text' },".repeat(20)}];\n`,
  "lib/landing-pages.ts": "export const findLanding = () => null;\n",
  "content/articles.json": "[]\n",
};

/** El árbol (rutas y tamaños) como lo da GitHub. */
export const siteTree = () => Object.entries(SITE_FILES).map(([path, content]) => ({ path, size: Buffer.byteLength(content) }));
