"use client";

// Botones de cada foto en «Tus fotos»: «Aprobar de todas formas», «No usar» y «Usar de nuevo».
import { useActionState } from "react";
import { setLibraryChoice } from "@/app/actions-library";
import { useT } from "@/components/I18n";
import { errorText } from "@/lib/i18n";
import type { LibraryChoice } from "@/lib/library-shape";
import s from "./Library.module.css";

type Props = { businessId: string; itemId: string; choice: string; needsReview: boolean; problem: boolean };

export function ChoiceButtons({ businessId, itemId, choice, needsReview, problem }: Props) {
  const { lang, t } = useT();
  const [error, action, isPending] = useActionState<string, FormData>(async (_prev, f) => {
    try {
      await setLibraryChoice(businessId, itemId, String(f.get("choice") ?? "") as LibraryChoice);
      return "";
    } catch (e) {
      return errorText(e, lang);
    }
  }, "");

  const button = (value: LibraryChoice, label: string, cls = "btn") => (
    <button type="submit" name="choice" value={value} className={cls}>
      {label}
    </button>
  );

  return (
    <>
      {isPending && (
        <p className={s.pending} role="status">
          <span className={s.spinner} aria-hidden="true" /> {t("Guardando…", "Saving…")}
        </p>
      )}
      <form action={action} className={s.choiceForm} style={isPending ? { display: "none" } : undefined}>
        {choice === "skip" ? (
          button("", t("Usar de nuevo", "Use again"))
        ) : (
          <>
            {needsReview && button("use", t("Aprobar de todas formas", "Approve anyway"), "btn outline")}
            {choice === "use" && !problem && button("", t("Quitar mi aprobación", "Remove my approval"), "btn link")}
            {button("skip", t("No usar", "Don't use"), "btn danger")}
          </>
        )}
      </form>
      {error && (
        <p className={s.err} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
