// Íconos de línea propios del Tablero (dibujados aquí, sin librerías). Toman el color del texto (currentColor).

export type DashIconName =
  | "search"
  | "seo"
  | "local"
  | "ia"
  | "comp"
  | "content"
  | "social"
  | "reports"
  | "ads"
  | "alert"
  | "plug"
  | "star"
  | "bulb"
  | "check"
  | "link"
  | "web"
  | "key";

const PATHS: Record<DashIconName, React.ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  seo: <path d="M4 18l5-6 4 3 7-9M15 6h5v5" />,
  local: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  ia: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />,
  comp: (
    <>
      <path d="M5 20V10M10 20V4M15 20v-7M20 20V8" />
    </>
  ),
  content: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  social: (
    <>
      <path d="M4 11.5V9a1 1 0 0 1 1-1h3l7-4v16l-7-4H5a1 1 0 0 1-1-1z" />
      <path d="M18 9.5a3 3 0 0 1 0 5" />
    </>
  ),
  reports: (
    <>
      <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M12 11v6M9.5 14.5L12 17l2.5-2.5" />
    </>
  ),
  ads: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.8" />
    </>
  ),
  alert: <path d="M12 4l9 16H3zM12 10v4.5M12 17.2v.3" />,
  plug: <path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5" />,
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" />,
  bulb: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  web: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.5 3.5 5.4 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.4-3.5-8.5S9.6 6 12 3.5z" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8-8M16 7l2.5 2.5M14 9l2 2" />
    </>
  ),
};

export function DashIcon({ name, size = 18 }: { name: DashIconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
