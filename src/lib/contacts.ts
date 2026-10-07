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
  // Una fila con un email de verdad (ej.: ana@gmail.com contiene "mail") no es encabezado.
  const hasHeader = (header.email >= 0 || header.phone >= 0) && !first.some((h) => h.includes("@") || /\d{7,}/.test(h.replace(/\D/g, "")));
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

/** Listas de fábrica para clasificar contactos. Cualquier otro texto es una lista propia del negocio. */
export const DEFAULT_LISTS = [
  { id: "lead", es: "Interesados", en: "Leads", helpEs: "Preguntaron o pidieron precio, pero aún no compran.", helpEn: "They asked or requested a quote, but haven't bought yet." },
  { id: "prospect", es: "Prospectos nuevos", en: "New prospects", helpEs: "Gente o negocios a los que quieres llegar.", helpEn: "People or businesses you want to reach." },
  { id: "client", es: "Clientes actuales", en: "Current clients", helpEs: "Te compran o trabajan contigo ahora.", helpEn: "They buy from you or work with you now." },
  { id: "past-client", es: "Clientes anteriores", en: "Past clients", helpEs: "Te compraron antes; vale la pena recordarles que existes.", helpEn: "They bought before; worth reminding them you exist." },
] as const;

export const MAX_LISTS = 20;

/** Nombre visible de una lista (las de fábrica se traducen; las propias se muestran tal cual). */
export function listLabel(id: string, lang: "es" | "en" = "es"): string {
  const d = DEFAULT_LISTS.find((l) => l.id === id);
  return d ? d[lang] : id;
}

/**
 * Limpia las listas de un contacto: sin espacios de más, sin repetidas, máximo 40 letras cada una.
 * Si escriben el nombre de una lista de fábrica ("Clientes actuales"), se guarda su id ("client").
 */
export function cleanLists(raw: Iterable<string>): string[] {
  const out: string[] = [];
  for (const r of raw) {
    let v = String(r).replace(/\s+/g, " ").trim().slice(0, 40);
    if (!v) continue;
    const known = DEFAULT_LISTS.find((l) => l.id === v.toLowerCase() || l.es.toLowerCase() === v.toLowerCase() || l.en.toLowerCase() === v.toLowerCase());
    if (known) v = known.id;
    if (!out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
    if (out.length >= MAX_LISTS) break;
  }
  return out;
}

/** Todas las listas del negocio: primero las de fábrica, luego las propias en orden alfabético. */
export function allLists(contacts: { lists: string[] }[]): string[] {
  const custom = new Set<string>();
  for (const c of contacts) for (const l of c.lists) if (!DEFAULT_LISTS.some((d) => d.id === l)) custom.add(l);
  return [...DEFAULT_LISTS.map((d) => d.id as string), ...[...custom].sort((a, b) => a.localeCompare(b))];
}
