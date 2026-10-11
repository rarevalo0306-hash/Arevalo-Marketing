"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { useT } from "@/components/I18n";
import s from "./Nav.module.css";

type Biz = { id: string; name: string; color: string };

/**
 * Computadora: el negocio activo en un control blanco redondeado (con línea fina). Al tocarlo se abre la lista de
 * negocios y «Agregar negocio» debajo, dentro de la barra. Sin negocio activo la lista se ve abierta.
 */
export function BizSwitcher({ businesses, activeId }: { businesses: Biz[]; activeId?: string }) {
  const { t } = useT();
  const path = usePathname();
  const id = useId();
  const active = businesses.find((b) => b.id === activeId);
  const [open, setOpen] = useState(!active);
  useEffect(() => setOpen(!active), [path, active]);
  useEffect(() => {
    if (!open || !active) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, active]);
  const initial = (name: string) => name.trim().charAt(0).toUpperCase();
  return (
    <div className={`desk-only ${s.switcher}`}>
      <button type="button" className={s.switch} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        {active && (
          <span className={s.switchDot} style={{ background: active.color }} aria-hidden="true">
            {initial(active.name)}
          </span>
        )}
        <span className={s.switchName}>
          <span className="sr-only">{t("Negocio: ", "Business: ")}</span>
          {active ? active.name : t("Mis negocios", "My businesses")}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className={s.switchChev} style={{ transform: open ? "rotate(180deg)" : undefined }}>
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div id={id} className={s.switchList} hidden={!open}>
        {businesses.map((b) => (
          <Link key={b.id} href={`/b/${b.id}/inicio`} className={`${s.row}${b.id === activeId ? ` ${s.on}` : ""}`} aria-current={b.id === activeId ? "true" : undefined}>
            <span className={s.switchDot} style={{ background: b.color }} aria-hidden="true">
              {initial(b.name)}
            </span>
            <span className={s.text}>{b.name}</span>
          </Link>
        ))}
        <Link href="/negocios/nuevo" className={s.row}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ margin: "0 3px" }}>
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className={s.text}>{t("Agregar negocio", "Add business")}</span>
        </Link>
      </div>
    </div>
  );
}
