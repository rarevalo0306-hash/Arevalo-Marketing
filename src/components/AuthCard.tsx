import { ConsentLine, LegalLinks } from "@/components/ConsentLine";
import { LangPicker } from "@/components/I18n";

/**
 * Tarjeta centrada de las páginas públicas para entrar (invitación, contraseña olvidada, contraseña nueva), igual que
 * /login: «Matya» arriba y, abajo, el aviso de que al continuar acepta las condiciones, el idioma y los enlaces legales.
 */
export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="center-page">
      <div className="card">
        <h1 className="login-name">Matya</h1>
        {children}
        <ConsentLine style={{ textAlign: "center" }} />
        <LangPicker />
        <LegalLinks />
      </div>
    </main>
  );
}

/** «Entrar con Google», el mismo botón de /login. `href` siempre en la dirección principal: ahí vuelve Google. */
export function GoogleButton({ href, label }: { href: string; label: string }) {
  return (
    <a className="btn google-login" href={href}>
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.3 5.7c4.3-4 7-9.9 7-17.1z" />
        <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
      </svg>
      {label}
    </a>
  );
}

/** Enlace con forma de botón principal, a lo ancho de la tarjeta (para «Entrar», «Pedir otro enlace»…). */
export const wideButton = { width: "100%", minHeight: 48, fontSize: 16 } as const;

/** Texto largo sin espacios (correos, nombres de organizaciones) que no debe salirse de la tarjeta en un celular. */
export const wrapAnywhere = { overflowWrap: "anywhere" } as const;
