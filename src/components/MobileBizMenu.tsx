"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/I18n";

type Biz = { id: string; name: string; color: string };

/**
 * Celular: la barra de arriba solo muestra el negocio activo. Al tocarlo se abre la lista de negocios,
 * «Agregar negocio», el idioma, el estilo y «Salir» (children). Las secciones van en la barra de abajo (NavLinks).
 */
export function MobileBizMenu({ businesses, activeId, children }: { businesses: Biz[]; activeId?: string; children: React.ReactNode }) {
  const { t } = useT();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const active = businesses.find((b) => b.id === activeId);
  const initial = (name: string) => name.trim().charAt(0).toUpperCase();
  return (
    <div className="mbiz">
      <button type="button" className="biz on mbiz-trigger" aria-expanded={open} aria-controls="mbiz-menu" onClick={() => setOpen((v) => !v)}>
        {active ? (
          <span className="dot" style={{ background: active.color }}>{initial(active.name)}</span>
        ) : null}
        <span className="mbiz-name">{active ? active.name : t("Mis negocios", "My businesses")}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {/* Fuera de la barra de arriba: con el estilo Vidrio su desenfoque encerraría lo que es «fixed». */}
      {open && createPortal(
        <>
          <div className="mbiz-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div id="mbiz-menu" className="mbiz-menu" aria-label={t("Mis negocios", "My businesses")}>
            <div className="mbiz-label">{t("Mis negocios", "My businesses")}</div>
            {businesses.map((b) => (
              <Link key={b.id} href={`/b/${b.id}/inicio`} className={b.id === activeId ? "biz on" : "biz"} aria-current={b.id === activeId ? "true" : undefined}>
                <span className="dot" style={{ background: b.color }}>{initial(b.name)}</span>
                <span style={{ flexGrow: 1 }}>{b.name}</span>
                {b.id === activeId && <span aria-hidden="true">✓</span>}
              </Link>
            ))}
            <Link href="/negocios/nuevo" className="biz">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ margin: "0 3px" }}><path d="M12 5v14M5 12h14" /></svg>
              {t("Agregar negocio", "Add business")}
            </Link>
            <div className="mbiz-sep" />
            {children}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
