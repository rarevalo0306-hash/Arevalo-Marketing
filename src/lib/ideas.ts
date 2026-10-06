// Ideas sugeridas para el Inicio, según el mes y el tipo de negocio (en español o en inglés).
import type { UiLang } from "@/lib/i18n";

const ADJUSTER = /ajustador|adjuster|reclamo|seguro|insurance|claim/i;

type Ideas = { es: string[]; en: string[] };

const SEASON_ADJUSTER: Record<number, Ideas> = {
  5: {
    es: ["Cómo prepararte para la temporada de huracanes", "Revisa tu póliza antes del 1 de junio"],
    en: ["How to get ready for hurricane season", "Review your policy before June 1"],
  },
  6: {
    es: ["Empieza la temporada de huracanes: tu lista de preparación", "Qué fotos tomar de tu casa ANTES de una tormenta"],
    en: ["Hurricane season starts: your prep checklist", "What photos to take of your home BEFORE a storm"],
  },
  7: {
    es: ["Lluvias de verano: cómo detectar una filtración a tiempo", "Qué hacer si se te inunda la casa"],
    en: ["Summer rains: how to catch a leak early", "What to do if your home floods"],
  },
  8: {
    es: ["Pico de la temporada de huracanes: plan para tu familia", "Daños por viento vs. inundación: cuál cubre tu seguro"],
    en: ["Peak hurricane season: a plan for your family", "Wind vs. flood damage: which one your insurance covers"],
  },
  9: {
    es: ["Después de una tormenta: los primeros 5 pasos", "Cómo documentar daños en el techo sin subirte"],
    en: ["After a storm: the first 5 steps", "How to document roof damage without climbing up"],
  },
  10: {
    es: ["Revisa tu casa después de la temporada de lluvias", "¿Tu reclamo quedó corto? Señales de un pago insuficiente"],
    en: ["Check your home after the rainy season", "Was your claim paid short? Signs of an underpayment"],
  },
  11: {
    es: ["Termina la temporada de huracanes: revisa los daños pendientes", "Plazos para presentar un reclamo en Florida"],
    en: ["Hurricane season ends: check for damage you haven't claimed", "Deadlines to file a claim in Florida"],
  },
  12: {
    es: ["Protege tu casa en vacaciones: filtraciones y robos", "Fin de año: organiza los papeles de tu seguro"],
    en: ["Protect your home over the holidays: leaks and break-ins", "Year end: organize your insurance paperwork"],
  },
};
const ADJUSTER_ALWAYS: Ideas = {
  es: ["Mitos sobre los ajustadores públicos", "Qué hace un ajustador público y cuándo llamarlo", "Mi reclamo fue negado: ¿y ahora qué?", "Moho después de una filtración: lo que debes saber"],
  en: ["Myths about public adjusters", "What a public adjuster does and when to call one", "My claim was denied: now what?", "Mold after a leak: what you need to know"],
};
const GENERIC: Ideas = {
  es: ["Presenta a tu equipo", "Responde la pregunta que más te hacen tus clientes", "Un consejo rápido de tu especialidad", "Comparte la historia de un cliente feliz (con su permiso)", "Detrás de cámaras de tu negocio", "Una oferta o novedad de este mes"],
  en: ["Introduce your team", "Answer the question your customers ask most", "A quick tip from your area of expertise", "Share a happy customer's story (with their permission)", "Behind the scenes at your business", "A deal or something new this month"],
};

export function ideasFor(aiProfile: string, name: string, month = new Date().getMonth() + 1, lang: UiLang = "es"): string[] {
  if (ADJUSTER.test(aiProfile) || ADJUSTER.test(name)) return [...(SEASON_ADJUSTER[month]?.[lang] ?? []), ...ADJUSTER_ALWAYS[lang]].slice(0, 5);
  return GENERIC[lang].slice(0, 5);
}
