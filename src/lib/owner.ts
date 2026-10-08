// Dueño o representante del negocio (Business.ownerName/ownerEmail/ownerPhone): a quién se le manda el reporte diario
// y con quién se habla. Sin servidor: se usa al crear el negocio y en «Datos del negocio».

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i;

/** Lee los campos del formulario. `ownerEmail` es null si se escribió un correo que no es válido. */
export function ownerFields(f: FormData): { ownerName: string; ownerEmail: string | null; ownerPhone: string } {
  const get = (k: string) => String(f.get(k) ?? "").trim();
  const email = get("ownerEmail").toLowerCase().slice(0, 200);
  return {
    ownerName: get("ownerName").replace(/\s+/g, " ").slice(0, 120),
    ownerEmail: email && !EMAIL.test(email) ? null : email,
    ownerPhone: get("ownerPhone").replace(/[^\d+()\-.\s]/g, "").replace(/\s+/g, " ").trim().slice(0, 40),
  };
}
