"use client";

import { useT } from "@/components/I18n";
import styles from "./WebFix.module.css";

/**
 * «¿Cómo creo (o arreglo) la llave?»: los pasos exactos para la llave de GitHub que usa Matya. `fixing` = la llave ya
 * existe y solo le falta un permiso (se edita en GitHub y sigue siendo la misma; no hay que volver a pegarla).
 */
export function WebFixKeyHelp({ businessId, fixing, open }: { businessId: string; fixing?: boolean; open?: boolean }) {
  const { t } = useT();
  return (
    <details className={styles.help} open={open || undefined}>
      <summary>{fixing ? t("¿Cómo le agrego el permiso a la llave?", "How do I add the permission to the key?") : t("¿Cómo creo la llave?", "How do I create the key?")}</summary>
      <div className={styles.helpBody}>
        {fixing ? (
          <ol>
            <li>{t("Entra a github.com con tu cuenta → tu foto (arriba a la derecha) → Settings → Developer settings → Personal access tokens → Fine-grained tokens.", "Go to github.com with your account → your photo (top right) → Settings → Developer settings → Personal access tokens → Fine-grained tokens.")}</li>
            <li>{t("Abre la llave que usa Matya (la que tiene el repositorio de tu página web) y presiona «Edit».", "Open the key Matya uses (the one with your website's repository) and press “Edit”.")}</li>
            <li>{t("En «Repository permissions» pon: Contents: Read and write · Pull requests: Read and write · Commit statuses: Read · Checks: Read (si aparece).", "Under “Repository permissions” set: Contents: Read and write · Pull requests: Read and write · Commit statuses: Read · Checks: Read (if offered).")}</li>
            <li>{t("Presiona «Update». La llave sigue siendo la misma: no tienes que volver a pegarla en Matya. Vuelve aquí y prepara los arreglos otra vez.", "Press “Update”. The key stays the same: you don't need to paste it into Matya again. Come back here and prepare the fixes again.")}</li>
          </ol>
        ) : (
          <ol>
            <li>{t("Entra a github.com con la cuenta dueña de tu página web → tu foto (arriba a la derecha) → Settings → Developer settings → Personal access tokens → Fine-grained tokens → «Generate new token».", "Go to github.com with the account that owns your website → your photo (top right) → Settings → Developer settings → Personal access tokens → Fine-grained tokens → “Generate new token”.")}</li>
            <li>{t("Ponle un nombre (por ejemplo «Matya») y como vencimiento 1 año.", "Give it a name (for example “Matya”) and set the expiration to 1 year.")}</li>
            <li>{t("En «Repository access» elige «Only select repositories» y marca solo el repositorio de tu página web.", "Under “Repository access” choose “Only select repositories” and pick only your website's repository.")}</li>
            <li>{t("En «Repository permissions» pon: Contents: Read and write · Pull requests: Read and write · Commit statuses: Read · Checks: Read (si aparece) · Metadata: Read (sale solo).", "Under “Repository permissions” set: Contents: Read and write · Pull requests: Read and write · Commit statuses: Read · Checks: Read (if offered) · Metadata: Read (added automatically).")}</li>
            <li>{t("Opcional: Deployments: Read, para que Matya encuentre siempre el enlace «Ver cómo queda».", "Optional: Deployments: Read, so Matya can always find the “See how it looks” link.")}</li>
            <li>
              {t("Presiona «Generate token», cópiala y pégala en Matya, en ", "Press “Generate token”, copy it and paste it into Matya, in ")}
              <a href={`/b/${businessId}/conexiones#c-seo`}>{t("Conexiones → Sitio web", "Connections → Website")}</a>
              {t(". Nunca la pegues en un chat.", ". Never paste it into a chat.")}
            </li>
          </ol>
        )}
      </div>
    </details>
  );
}
