"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { TemplatesResult } from "@/app/actions";
import { useT } from "@/components/I18n";

function Submit({ has }: { has: boolean }) {
  const { pending } = useFormStatus();
  const { t } = useT();
  return (
    <button type="submit" className="btn ai" disabled={pending}>
      {pending
        ? t("La IA está diseñando… (unos segundos)", "The AI is designing… (a few seconds)")
        : has
          ? t("✦ Crear más plantillas con IA", "✦ Create more templates with AI")
          : t("✦ Crear plantillas con IA", "✦ Create templates with AI")}
    </button>
  );
}

export function TemplatesButton({ action, has }: { action: () => Promise<TemplatesResult>; has: boolean }) {
  const [result, run] = useActionState(action, null);
  return (
    <form action={run} className="stack" style={{ gap: 10 }}>
      <div><Submit has={has} /></div>
      {result && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}
    </form>
  );
}
