"use client";

// Tablero de «Equipo y permisos»: a la izquierda quién tiene acceso y qué puede hacer cada papel; a la derecha
// «Invitar a alguien». Si no cabe en dos columnas (celular), va todo en una: lista, invitar y papeles.
// Las acciones del servidor (src/app/actions-team.ts) se atan aquí a esta organización con .bind(null, orgId, …).
import { InviteForm } from "./InviteForm";
import { PeopleList } from "./PeopleList";
import { RoleMatrix } from "./RoleMatrix";
import type { LinkLife, TeamBusiness, TeamInvite, TeamMember } from "./types";
import s from "./Team.module.css";

type Props = {
  orgId: string;
  orgName: string;
  /** La persona que mira (para marcarla con «(tú)»). */
  meId: string;
  businesses: TeamBusiness[];
  members: TeamMember[];
  invitations: TeamInvite[];
  life: LinkLife;
};

export function TeamBoard({ orgId, orgName, meId, businesses, members, invitations, life }: Props) {
  const common = { orgId, orgName, businesses, life };
  return (
    <div className={s.wrap}>
      <div className={s.board}>
        <PeopleList meId={meId} members={members} invitations={invitations} {...common} />
        <InviteForm {...common} />
        <RoleMatrix />
      </div>
    </div>
  );
}
