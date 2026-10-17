"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/I18n";
import { findActive, type BizAccount } from "@/components/nav/BizSwitcher";

const initial = (name: string) => name.trim().charAt(0).toUpperCase();

/**
 * La lista del menú: cada cuenta con su nombre arriba, sus organizaciones debajo (cada una con su nombre como encabezado) y los
 * negocios de cada una, y «Agregar negocio» (solo para el Administrador) después de todo. Aparte del menú para poder pintarla sin el portal.
 */
export function MobileBizList({ accounts, activeId, canAdd }: { accounts: BizAccount[]; activeId?: string; canAdd: boolean }) {
  const { t } = useT();
  return (
    <>
      {accounts.map((a) => (
        <div key={a.id} role="group" aria-label={a.name} className="mbiz-account">
          <div className="mbiz-account-head">
            <span className="sr-only">{t("Cuenta: ", "Account: ")}</span>
            {a.name}
          </div>
          {a.groups.map((g) => (
            <div key={g.id} role="group" aria-label={g.name} className="mbiz-group">
              <div className="mbiz-org-head">{g.name}</div>
              {g.businesses.map((b) => (
                <Link key={b.id} href={`/b/${b.id}/inicio`} className={b.id === activeId ? "biz on" : "biz"} aria-current={b.id === activeId ? "true" : undefined}>
                  <span className="dot" style={{ background: b.color }}>{initial(b.name)}</span>
                  <span style={{ flexGrow: 1 }}>{b.name}</span>
                  {b.id === activeId && <span aria-hidden="true">✓</span>}
                </Link>
              ))}
            </div>
          ))}
        </div>
      ))}
      {canAdd && (
        <Link href="/negocios/nuevo" className="biz">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ margin: "0 3px" }}><path d="M12 5v14M5 12h14" /></svg>
          {t("Agregar negocio", "Add business")}
        </Link>
      )}
    </>
  );
}

/**
 * Celular: la barra de arriba solo muestra el negocio activo, con el nombre de su organización arriba en letra chica. Al tocarlo se abre
 * el árbol (la cuenta, sus organizaciones y sus negocios), «Agregar negocio» (solo para el Administrador) y «Salir» (children).
 * Las preferencias tienen su propio acceso arriba a la derecha.
 */
export function MobileBizMenu({ accounts, activeId, canAdd, children }: { accounts: BizAccount[]; activeId?: string; canAdd: boolean; children: React.ReactNode }) {
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
  const current = findActive(accounts, activeId);
  const active = current?.business;
  return (
    <div className="mbiz">
      <button type="button" className="biz on mbiz-trigger" aria-expanded={open} aria-controls="mbiz-menu" onClick={() => setOpen((v) => !v)}>
        {active ? (
          <span className="dot" style={{ background: active.color }}>{initial(active.name)}</span>
        ) : null}
        <span className="mbiz-name">
          {current ? (
            <>
              <span className="mbiz-org">
                <span className="sr-only">{t("Organización: ", "Organization: ")}</span>
                {current.group.name}
              </span>
              <span className="mbiz-biz">
                <span className="sr-only">{t("Negocio: ", "Business: ")}</span>
                {current.business.name}
              </span>
            </>
          ) : (
            <span>{t("Mis negocios", "My businesses")}</span>
          )}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {/* Fuera de la barra de arriba: con el estilo Vidrio su desenfoque encerraría lo que es «fixed». */}
      {open && createPortal(
        <>
          <div className="mbiz-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div id="mbiz-menu" className="mbiz-menu" aria-label={t("Mis negocios", "My businesses")}>
            <MobileBizList accounts={accounts} activeId={activeId} canAdd={canAdd} />
            <div className="mbiz-sep" />
            {children}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
