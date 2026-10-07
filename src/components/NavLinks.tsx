"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useT } from "@/components/I18n";

const ICONS: Record<string, React.ReactNode> = {
  inicio: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></>,
  estudio: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /><path d="M8 13v-2M11 13V8M14 13v-3" /></>,
  seo: <><path d="M3 3v18h18" /><path d="m7 14 3-3 3 3 5-6" /><circle cx="18" cy="8" r="1.5" /></>,
  publicar: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  plan: <><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8Z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z" /></>,
  historial: <><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>,
  contactos: <><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0" /><path d="M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-4-5.6" /></>,
  conexiones: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  marca: <><circle cx="13.5" cy="6.5" r="1.5" /><circle cx="17.5" cy="10.5" r="1.5" /><circle cx="8.5" cy="7.5" r="1.5" /><circle cx="6.5" cy="12.5" r="1.5" /><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2Z" /></>,
  negocio: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
};

// [ruta, nombre, nombre corto para la barra de abajo en el celular (vacío = no cabe en el celular)], en español y en inglés
const LINKS = [
  ["inicio", ["Inicio", "Inicio"], ["Home", "Home"]],
  ["estudio", ["Estudio del negocio", "Estudio"], ["Business study", "Study"]],
  ["seo", ["SEO y visibilidad", "SEO"], ["SEO and visibility", "SEO"]],
  ["publicar", ["Publicar", "Publicar"], ["Publish", "Publish"]],
  ["plan", ["Plan con IA", "Plan IA"], ["AI plan", "AI plan"]],
  ["historial", ["Historial", "Historial"], ["History", "History"]],
  ["marca", ["Marca", "Marca"], ["Brand", "Brand"]],
  ["contactos", ["Contactos", "Contactos"], ["Contacts", "Contacts"]],
  ["conexiones", ["Conexiones", "Cuentas"], ["Connections", "Accounts"]],
  ["negocio", ["Ajustes del negocio", "Ajustes"], ["Business settings", "Settings"]],
] as const;

/** En el celular caben estas primeras secciones en la barra de abajo; el resto va en «Más». */
const MOBILE_BAR = 5;

const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export function NavLinks({ businessId }: { businessId: string }) {
  const path = usePathname();
  const { lang, t } = useT();
  const [more, setMore] = useState(false);
  // Al cambiar de página o con Escape se cierra el menú «Más».
  useEffect(() => setMore(false), [path]);
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMore(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [more]);
  const items = LINKS.map(([slug, es, en], i) => {
    const [label, short] = lang === "en" ? en : es;
    const href = `/b/${businessId}/${slug}`;
    return { slug, label, short, href, on: path === href || path.startsWith(`${href}/`), inMore: i >= MOBILE_BAR };
  });
  const moreOn = items.some((x) => x.inMore && x.on);
  return (
    <>
      <div className="navlinks">
        {items.map(({ slug, label, short, href, on, inMore }) => (
          <Link key={slug} href={href} className={`navlink${on ? " on" : ""}${inMore ? " nav-desk" : ""}`} aria-current={on ? "page" : undefined}>
            <Icon>{ICONS[slug]}</Icon>
            <span className="nav-long">{label}</span>
            <span className="nav-short">{short}</span>
          </Link>
        ))}
        <button type="button" className={`navlink nav-more-btn${moreOn || more ? " on" : ""}`} aria-expanded={more} aria-controls="nav-more" onClick={() => setMore((v) => !v)}>
          <Icon>
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
          </Icon>
          <span className="nav-short">{t("Más", "More")}</span>
        </button>
      </div>
      {more && (
        <>
          <div className="nav-more-backdrop" onClick={() => setMore(false)} aria-hidden="true" />
          <div id="nav-more" className="nav-more" role="menu" aria-label={t("Más secciones", "More sections")}>
            {items
              .filter((x) => x.inMore)
              .map(({ slug, label, href, on }) => (
                <Link key={slug} href={href} role="menuitem" className={`navlink${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
                  <Icon>{ICONS[slug]}</Icon>
                  {label}
                </Link>
              ))}
          </div>
        </>
      )}
    </>
  );
}
