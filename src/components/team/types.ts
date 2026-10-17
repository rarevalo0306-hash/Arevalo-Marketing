// Lo que la página «Equipo» (src/app/equipo/page.tsx) le pasa al tablero, ya listo para mostrar (fechas en texto).
import type { T } from "@/lib/i18n";
import type { Role } from "@/lib/roles";

export type TeamBusiness = { id: string; name: string; color: string; clientOrg: { id: string; name: string } };

export type TeamMember = {
  membershipId: string;
  userId: string;
  email: string;
  name: string;
  role: Role;
  allBusinesses: boolean;
  businessIds: string[];
  /** Fecha del último acceso, ya en el idioma de la app, o null si nunca entró. */
  lastLogin: string | null;
  /** Dueño de Matya (LOGIN_EMAILS): no se le cambia la contraseña desde aquí. */
  owner: boolean;
  /** Dueño en la organización principal: siempre Administrador; no se le cambia el papel ni se le quita el acceso. */
  fixedAdmin: boolean;
};

export type TeamInvite = {
  id: string;
  email: string;
  role: Role;
  allBusinesses: boolean;
  businessIds: string[];
  /** Fecha en que vence el enlace, ya en el idioma de la app. */
  expires: string;
};

/** Cuánto duran los enlaces (src/lib/team.ts), para el texto de WhatsApp. */
export type LinkLife = { inviteDays: number; resetMinutes: number };

/** «Todas las empresas» o los nombres de las empresas a las que entra. */
export function scopeText(allBusinesses: boolean, ids: string[], businesses: TeamBusiness[], t: T): string {
  if (allBusinesses) return t("Todas las empresas", "All businesses");
  const names = businesses.filter((b) => ids.includes(b.id)).map((b) => b.name);
  return names.length ? names.join(", ") : t("Ninguna empresa", "No businesses");
}

/** «Solo estas:» sin ninguna empresa marcada (se avisa antes de mandar). */
export const missingBusiness = (f: FormData) => f.get("role") !== "admin" && f.get("scope") === "some" && f.getAll("businessIds").length === 0;

/** Color de la etiqueta de cada papel. */
export const ROLE_TONE: Record<Role, string> = { admin: "info", manager: "good", publisher: "draft", viewer: "neutral" };
