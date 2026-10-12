import { NAV_GROUPS, itemHref } from "@/components/nav/model";
import type { Context } from "./schema";
export const INDUSTRIES: Record<string, Context["industry"]> = {
  general: {
    key: "general",
    name: "Industria por definir",
    geography: "Usar la ubicación confirmada del negocio",
    audience: "Los clientes del negocio",
    focus: [
      "Confirmar servicios, público, territorio y objetivos antes de especializar recomendaciones",
    ],
  },
  "public-adjusting-fl": {
    key: "public-adjusting-fl",
    name: "Reclamaciones de propiedad",
    geography: "Florida, Estados Unidos",
    audience:
      "Propietarios con daños o dudas sobre su reclamación; no estudiantes de licencias de ajustador",
    focus: [
      "Daños a propiedades y proceso de reclamación",
      "Estacionalidad y preparación ante tormentas",
      "Verificar normativa vigente en fuentes oficiales; distinguir propuestas de normas efectivas",
      "No garantizar indemnizaciones ni inventar derechos o plazos",
    ],
  },
  "commercial-security-ni": {
    key: "commercial-security-ni",
    name: "Cortinas metálicas y seguridad comercial",
    geography: "Nicaragua",
    audience:
      "Comercios y propietarios que necesitan instalación, reparación o mantenimiento",
    focus: [
      "Seguridad física y continuidad de operaciones",
      "Mantenimiento preventivo y vida útil",
      "Construcción, clima y comercio local",
      "No trasladar normativa, precios o temporadas de Florida",
    ],
  },
};
export function industryFor(key: string) {
  return INDUSTRIES[key] ?? INDUSTRIES.general;
}
export function toolCatalog(businessId: string) {
  return NAV_GROUPS.flatMap((g) => g.items)
    .filter((x) => x.path && !x.soon)
    .map((x) => ({
      name: x.label[0],
      href: itemHref(businessId, x),
      execution: ["campanas", "publicar"].includes(x.key)
        ? "Campaña coordinada por MATYA"
        : "Consulta y acceso a herramienta existente",
    }));
}
