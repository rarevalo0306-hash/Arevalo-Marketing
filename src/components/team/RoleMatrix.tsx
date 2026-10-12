"use client";

// «Qué puede hacer cada papel»: lo mismo que revisa src/lib/roles.ts, dicho en palabras sencillas. En el celular cada
// fila se vuelve una tarjeta con los tres papeles debajo.
import { useT } from "@/components/I18n";
import { roleLabel, ROLES } from "@/lib/roles";
import s from "./Team.module.css";

function Mark({ yes }: { yes: boolean }) {
  const { t } = useT();
  return (
    <span className={yes ? s.yes : s.no}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {yes ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M7 7l10 10M17 7L7 17" />}
      </svg>
      <span className="sr-only">{yes ? t("sí", "yes") : t("no", "no")}</span>
    </span>
  );
}

export function RoleMatrix() {
  const { t } = useT();
  // [lo que se puede hacer, Administrador, Puede publicar, Solo ver]
  const rows: [string, boolean, boolean, boolean][] = [
    [t("Ver resultados y reportes", "See results and reports"), true, true, true],
    [t("Crear y publicar", "Create and publish"), true, true, false],
    [t("Usar la IA y gastar créditos", "Use the AI and spend credits"), true, true, false],
    [t("Conectar Facebook, Instagram y Google", "Connect Facebook, Instagram and Google"), true, false, false],
    [t("Borrar empresas y cambiar la autonomía de la IA", "Delete businesses and change the AI's autonomy"), true, false, false],
    [t("Invitar personas y cambiar papeles", "Invite people and change roles"), true, false, false],
  ];
  const labels = ROLES.map((r) => roleLabel(r, t));
  return (
    <section className={`card ${s.matrixCard}`} aria-labelledby="team-roles-title">
      <h2 id="team-roles-title">{t("Qué puede hacer cada papel", "What each role can do")}</h2>
      <div className={s.matrixBox}>
        <table className={s.matrix} aria-labelledby="team-roles-title">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">{t("Lo que se puede hacer", "What you can do")}</span>
              </th>
              {labels.map((l) => (
                <th key={l} scope="col">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([what, ...can]) => (
              <tr key={what}>
                <th scope="row">{what}</th>
                {can.map((yes, i) => (
                  <td key={labels[i]} data-label={labels[i]}>
                    <Mark yes={yes} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={s.soon}>
        <strong>{t("Pronto:", "Coming soon:")}</strong>{" "}
        {t("el Administrador podrá poner un límite de gasto por empresa para «Puede publicar».", 'the Administrator will be able to set a spending limit per business for "Can publish".')}
      </p>
    </section>
  );
}
