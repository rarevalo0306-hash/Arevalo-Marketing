// Las acciones del servidor reciben sus argumentos del navegador, y quien las llame a mano puede mandar objetos donde
// el código espera un id: Prisma los tomaría como filtros ({ in: [...] }, { not: "x" }) y tocaría filas de otros negocios.
// Por eso cada acción revisa primero que cada argumento sea del tipo que declara. tests/permission-coverage.test.ts lo exige.

export class InvalidArgs extends Error {
  constructor() {
    super("Invalid request");
  }
}

const check = (ok: boolean) => {
  if (!ok) throw new InvalidArgs();
};

export const ensure = {
  /** Texto (ids, nombres, opciones). */
  text(...values: unknown[]) {
    for (const v of values) check(typeof v === "string");
  },
  /** Texto, o nada (null / undefined). */
  optionalText(...values: unknown[]) {
    for (const v of values) check(v == null || typeof v === "string");
  },
  /** Número de verdad (no NaN ni infinito). */
  number(...values: unknown[]) {
    for (const v of values) check(typeof v === "number" && Number.isFinite(v));
  },
  /** Número, o nada (null / undefined). */
  optionalNumber(...values: unknown[]) {
    for (const v of values) check(v == null || (typeof v === "number" && Number.isFinite(v)));
  },
  /** Sí o no. */
  flag(...values: unknown[]) {
    for (const v of values) check(typeof v === "boolean");
  },
  /** Sí, no, o nada. */
  optionalFlag(...values: unknown[]) {
    for (const v of values) check(v == null || typeof v === "boolean");
  },
  /** Lista de textos (hasta 500). */
  texts(...values: unknown[]) {
    for (const v of values) check(Array.isArray(v) && v.length <= 500 && v.every((x) => typeof x === "string"));
  },
  /** Lista de textos, o nada. */
  optionalTexts(...values: unknown[]) {
    for (const v of values) check(v == null || (Array.isArray(v) && v.length <= 500 && v.every((x) => typeof x === "string")));
  },
};
