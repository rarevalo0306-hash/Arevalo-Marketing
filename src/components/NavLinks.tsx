"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/I18n";
import { NavIcon } from "@/components/nav/NavIcon";
import { MOBILE_TABS, NAV_GROUPS, isGroupOn, isItemOn, itemHref, type NavGroup, type NavHere, type NavItem } from "@/components/nav/model";
import s from "@/components/nav/Nav.module.css";

const OPEN_KEY = "am-nav-open";

/** Grupos abiertos o cerrados a mano (se recuerda en este navegador). Sin elección, solo está abierto el grupo donde estás. */
function readOpen(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * Menú por herramientas (grupos). Computadora: lista en la barra de la izquierda con grupos que se abren y cierran.
 * Celular: barra de abajo con 4 accesos y «Más», que abre una hoja con todo el menú.
 * La pestaña de SEO abierta (?tab=) cuenta para marcar «estás aquí».
 */
export function NavLinks({ businessId }: { businessId: string }) {
  return (
    <Suspense fallback={<Nav businessId={businessId} tab={null} mapa={null} />}>
      <NavWithParams businessId={businessId} />
    </Suspense>
  );
}

function NavWithParams({ businessId }: { businessId: string }) {
  const params = useSearchParams();
  return <Nav businessId={businessId} tab={params.get("tab")} mapa={params.get("mapa")} />;
}

function Nav({ businessId, tab, mapa }: { businessId: string; tab: string | null; mapa: string | null }) {
  const pathname = usePathname();
  const here: NavHere = { pathname, tab, mapa };
  return (
    <>
      <SideNav businessId={businessId} here={here} />
      <MobileNav businessId={businessId} here={here} />
    </>
  );
}

function Label({ item }: { item: NavItem }) {
  const { lang } = useT();
  return <>{item.label[lang === "en" ? 1 : 0]}</>;
}

function Soon() {
  const { t } = useT();
  return <span className={s.soon}>{t("Pronto", "Soon")}</span>;
}

/** Un enlace del menú (o un renglón apagado si todavía no existe). */
function ItemLink({
  businessId,
  item,
  here,
  className,
  icon,
  onPick,
}: {
  businessId: string;
  item: NavItem;
  here: NavHere;
  className: string;
  icon?: string;
  onPick?: () => void;
}) {
  const { t } = useT();
  if (item.soon || !item.path) {
    return (
      <span className={`${className} ${s.off}`} aria-disabled="true" title={t("Muy pronto en la app", "Coming soon to the app")}>
        {icon && <NavIcon name={icon} />}
        <span className={s.text}>
          <Label item={item} />
        </span>
        <Soon />
      </span>
    );
  }
  const on = isItemOn(businessId, item, here);
  return (
    <Link href={itemHref(businessId, item)} className={`${className}${on ? ` ${s.on}` : ""}`} aria-current={on ? "page" : undefined} onClick={onPick}>
      {icon && <NavIcon name={icon} />}
      <span className={s.text}>
        <Label item={item} />
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------- Computadora

function SideNav({ businessId, here }: { businessId: string; here: NavHere }) {
  const { t } = useT();
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  useEffect(() => setChosen(readOpen()), []);
  const toggle = (key: string, open: boolean) => {
    const next = { ...readOpen(), ...chosen, [key]: !open };
    setChosen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {}
  };
  return (
    <div className={`desk-only ${s.side}`} role="list" aria-label={t("Herramientas", "Tools")}>
      {NAV_GROUPS.map((g) => (
        <div key={g.key} role="listitem">
          {g.items.length === 1 ? (
            <ItemLink businessId={businessId} item={g.items[0]} here={here} className={s.row} icon={g.icon} />
          ) : (
            <SideGroup businessId={businessId} group={g} here={here} open={chosen[g.key] ?? isGroupOn(businessId, g, here)} onToggle={toggle} />
          )}
        </div>
      ))}
    </div>
  );
}

function SideGroup({
  businessId,
  group,
  here,
  open,
  onToggle,
}: {
  businessId: string;
  group: NavGroup;
  here: NavHere;
  open: boolean;
  onToggle: (key: string, open: boolean) => void;
}) {
  const { lang } = useT();
  const id = useId();
  const on = isGroupOn(businessId, group, here);
  return (
    <>
      <button
        type="button"
        className={`${s.row} ${s.head}${on ? ` ${s.headOn}` : ""}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onToggle(group.key, open)}
      >
        <NavIcon name={group.icon} />
        <span className={s.text}>{group.label[lang === "en" ? 1 : 0]}</span>
        <svg
          className={s.chev}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div id={id} className={s.sub} hidden={!open}>
        {group.items.map((x) => (
          <ItemLink key={x.key} businessId={businessId} item={x} here={here} className={s.subrow} />
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Celular

function MobileNav({ businessId, here }: { businessId: string; here: NavHere }) {
  const { lang, t } = useT();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setMounted(true), []);

  const close = useCallback((focusBack = false) => {
    setOpen(false);
    if (focusBack) moreRef.current?.focus();
  }, []);

  // Se cierra al cambiar de página o de pestaña.
  const where = `${here.pathname}?${here.tab ?? ""}`;
  useEffect(() => setOpen(false), [where]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(true);
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, close]);

  // Fuera de la barra lateral: con el estilo Vidrio la barra de arriba tiene desenfoque y eso encerraría lo que es «fixed».
  if (!mounted) return null;
  const base = `/b/${businessId}/`;
  const anyOn = MOBILE_TABS.some((x) => x.on(here, base));
  const pick = lang === "en" ? 1 : 0;
  return createPortal(
    <>
      <nav className={s.bar} aria-label={t("Menú principal", "Main menu")}>
        {MOBILE_TABS.map((x) => {
          const on = x.on(here, base);
          return (
            <Link key={x.key} href={base + x.path} className={`${s.tab}${on && !open ? ` ${s.on}` : ""}`} aria-current={on ? "page" : undefined}>
              <NavIcon name={x.icon} />
              <span>{x.label[pick]}</span>
            </Link>
          );
        })}
        <button
          ref={moreRef}
          type="button"
          className={`${s.tab}${open || !anyOn ? ` ${s.on}` : ""}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((v) => !v)}
        >
          <NavIcon name="mas" />
          <span>{t("Más", "More")}</span>
        </button>
      </nav>
      {open && (
        <>
          <div className={s.backdrop} onClick={() => close()} aria-hidden="true" />
          <div className={s.sheet} role="dialog" aria-modal="true" aria-label={t("Todo el menú", "Full menu")}>
            <div className={s.sheetHead}>
              <strong>{t("Todo el menú", "Full menu")}</strong>
              <button ref={closeRef} type="button" className={s.close} onClick={() => close(true)} aria-label={t("Cerrar", "Close")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className={s.sheetBody}>
              {NAV_GROUPS.map((g) =>
                g.items.length === 1 ? (
                  <ItemLink key={g.key} businessId={businessId} item={g.items[0]} here={here} className={s.srow} icon={g.icon} onPick={() => close()} />
                ) : (
                  <section key={g.key} className={s.sgroup} aria-label={g.label[pick]}>
                    <div className={`${s.shead}${isGroupOn(businessId, g, here) ? ` ${s.headOn}` : ""}`}>
                      <NavIcon name={g.icon} size={18} />
                      {g.label[pick]}
                    </div>
                    {g.items.map((x) => (
                      <ItemLink key={x.key} businessId={businessId} item={x} here={here} className={`${s.srow} ${s.ssub}`} onPick={() => close()} />
                    ))}
                  </section>
                ),
              )}
            </div>
          </div>
        </>
      )}
    </>,
    document.body,
  );
}
