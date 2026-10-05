// Ideas sugeridas para el Inicio, según el mes y el tipo de negocio.

const ADJUSTER = /ajustador|adjuster|reclamo|seguro|insurance|claim/i;

const SEASON_ADJUSTER: Record<number, string[]> = {
  5: ["Cómo prepararte para la temporada de huracanes", "Revisa tu póliza antes del 1 de junio"],
  6: ["Empieza la temporada de huracanes: tu lista de preparación", "Qué fotos tomar de tu casa ANTES de una tormenta"],
  7: ["Lluvias de verano: cómo detectar una filtración a tiempo", "Qué hacer si se te inunda la casa"],
  8: ["Pico de la temporada de huracanes: plan para tu familia", "Daños por viento vs. inundación: cuál cubre tu seguro"],
  9: ["Después de una tormenta: los primeros 5 pasos", "Cómo documentar daños en el techo sin subirte"],
  10: ["Revisa tu casa después de la temporada de lluvias", "¿Tu reclamo quedó corto? Señales de un pago insuficiente"],
  11: ["Termina la temporada de huracanes: revisa los daños pendientes", "Plazos para presentar un reclamo en Florida"],
  12: ["Protege tu casa en vacaciones: filtraciones y robos", "Fin de año: organiza los papeles de tu seguro"],
};
const ADJUSTER_ALWAYS = ["Mitos sobre los ajustadores públicos", "Qué hace un ajustador público y cuándo llamarlo", "Mi reclamo fue negado: ¿y ahora qué?", "Moho después de una filtración: lo que debes saber"];
const GENERIC = ["Presenta a tu equipo", "Responde la pregunta que más te hacen tus clientes", "Un consejo rápido de tu especialidad", "Comparte la historia de un cliente feliz (con su permiso)", "Detrás de cámaras de tu negocio", "Una oferta o novedad de este mes"];

export function ideasFor(aiProfile: string, name: string, month = new Date().getMonth() + 1): string[] {
  if (ADJUSTER.test(aiProfile) || ADJUSTER.test(name)) return [...(SEASON_ADJUSTER[month] ?? []), ...ADJUSTER_ALWAYS].slice(0, 5);
  return GENERIC.slice(0, 5);
}
