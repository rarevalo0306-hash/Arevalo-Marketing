export type ContactRow = { name: string; email: string; phone: string; emailOptIn: boolean; smsOptIn: boolean };

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if ((ch === "," || ch === ";" || ch === "\t") && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Lee contactos pegados desde Excel o un CSV. Acepta encabezados (nombre, email, telefono)
 * o, sin encabezados, detecta cada columna por su forma.
 */
export function parseContactsCsv(csv: string, consent: { emailOptIn: boolean; smsOptIn: boolean }): ContactRow[] {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const first = splitLine(lines[0]).map((h) => h.toLowerCase());
  const find = (...names: string[]) => first.findIndex((h) => names.some((n) => h.includes(n)));
  const header = { name: find("nombre", "name"), email: find("email", "correo", "mail"), phone: find("tel", "phone", "celular", "móvil", "movil") };
  const hasHeader = header.email >= 0 || header.phone >= 0;
  const rows: ContactRow[] = [];
  for (const line of hasHeader ? lines.slice(1) : lines) {
    const cells = splitLine(line);
    let name = "", email = "", phone = "";
    if (hasHeader) {
      name = header.name >= 0 ? cells[header.name] ?? "" : "";
      email = header.email >= 0 ? cells[header.email] ?? "" : "";
      phone = header.phone >= 0 ? cells[header.phone] ?? "" : "";
    } else {
      for (const c of cells) {
        if (!email && c.includes("@")) email = c;
        else if (!phone && /^\+?[\d\s().-]{7,}$/.test(c)) phone = c;
        else if (!name) name = c;
      }
    }
    phone = normalizePhone(phone);
    if (!email.includes("@")) email = "";
    if (email || phone) rows.push({ name, email, phone, ...consent });
  }
  return rows;
}

/** Deja el teléfono en formato internacional (+1… por defecto para números de 10 dígitos de EE. UU.). */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}
