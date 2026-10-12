"use client";

// Papel y empresas de una persona: los usa «Invitar a alguien» y «Cambiar» en la lista. Los nombres de los campos son
// los que lee src/app/actions-team.ts: role (admin | publisher | viewer), scope (all | some) y businessIds (varios).
import { useState } from "react";
import { useT } from "@/components/I18n";
import { roleLabel, type Role } from "@/lib/roles";
import type { TeamBusiness } from "./types";
import s from "./Team.module.css";

type Props = {
  businesses: TeamBusiness[];
  role?: Role;
  allBusinesses?: boolean;
  businessIds?: string[];
  /** Más ancho (el editor de la lista): los papeles van uno al lado del otro si caben. */
  wide?: boolean;
};

export function AccessFields({ businesses, role: startRole = "publisher", allBusinesses = true, businessIds = [], wide }: Props) {
  const { t } = useT();
  const [role, setRole] = useState<Role>(startRole);
  const [scope, setScope] = useState<"all" | "some">(allBusinesses || !businesses.length ? "all" : "some");
  const [picked, setPicked] = useState<string[]>(businessIds);
  const roles: { id: Role; text: string }[] = [
    { id: "admin", text: t("Todo: también conectar cuentas, invitar y borrar.", "Everything: also connect accounts, invite and delete.") },
    { id: "publisher", text: t("Crea, publica y usa la IA.", "Creates, publishes and uses the AI.") },
    { id: "viewer", text: t("Mira resultados y reportes.", "Sees results and reports.") },
  ];
  const toggle = (id: string, on: boolean) => setPicked((now) => (on ? [...now.filter((x) => x !== id), id] : now.filter((x) => x !== id)));

  return (
    <>
      <fieldset className={s.group}>
        <legend className="lbl">{t("Papel", "Role")}</legend>
        <div className={`${s.options} ${wide ? s.optionsWide : ""}`}>
          {roles.map((r) => (
            <label key={r.id} className={`${s.option} ${role === r.id ? s.on : ""}`}>
              <input type="radio" name="role" value={r.id} checked={role === r.id} onChange={() => setRole(r.id)} />
              <span className={s.optionText}>
                <strong>{roleLabel(r.id, t)}</strong>
                <span className="small muted">{r.text}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {role === "admin" ? (
        <p className={s.adminAll}>{t("El Administrador entra a todas las empresas.", "The Administrator gets into every business.")}</p>
      ) : (
        <fieldset className={s.group}>
          <legend className="lbl">{t("¿A qué empresas entra?", "Which businesses can they get into?")}</legend>
          <label className={`${s.option} ${scope === "all" ? s.on : ""}`}>
            <input type="radio" name="scope" value="all" checked={scope === "all"} onChange={() => setScope("all")} />
            <span className={s.optionText}>
              <strong>{t("Todas las empresas", "All businesses")}</strong>
              <span className="small muted">{t("También las que agregues después", "Also the ones you add later")}</span>
            </span>
          </label>
          <label className={`${s.option} ${scope === "some" ? s.on : ""} ${!businesses.length ? s.off : ""}`}>
            <input type="radio" name="scope" value="some" checked={scope === "some"} onChange={() => setScope("some")} disabled={!businesses.length} />
            <span className={s.optionText}>
              <strong>{t("Solo estas:", "Only these:")}</strong>
              {!businesses.length && <span className="small muted">{t("Todavía no hay empresas en esta organización.", "There are no businesses in this organization yet.")}</span>}
            </span>
          </label>
          {scope === "some" && (
            <div className={s.bizList} role="group" aria-label={t("Empresas a las que entra", "Businesses they can get into")}>
              {businesses.map((b) => (
                <label key={b.id} className={s.biz}>
                  <input type="checkbox" name="businessIds" value={b.id} checked={picked.includes(b.id)} onChange={(e) => toggle(b.id, e.target.checked)} />
                  <i className={s.dot} style={{ background: b.color }} aria-hidden="true" />
                  <span>{b.name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}
    </>
  );
}
