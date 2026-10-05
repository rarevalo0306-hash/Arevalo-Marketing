"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { TemplatesResult } from "@/app/actions";

function Submit({ has }: { has: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn ai" disabled={pending}>
      {pending ? "La IA está diseñando… (unos segundos)" : has ? "✦ Crear más plantillas con IA" : "✦ Crear plantillas con IA"}
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
