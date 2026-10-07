"use client";

import Link from "next/link";
import { useActionState } from "react";
import { retryFromHistory, type RetryLine, type RetryState } from "@/app/actions-historial";
import { useT } from "@/components/I18n";
import s from "./historial.module.css";

type Props = {
  businessId: string;
  postId: string;
  /** Un canal; sin targetId reintenta todos los que fallaron. */
  targetId?: string;
  label: string;
  /** "main": botón normal; "soft": enlace discreto ("Ya lo arreglé, intentar otra vez"). */
  look?: "main" | "soft";
  /** Lo que se muestra mientras no haya un resultado nuevo (la explicación del error). */
  children?: React.ReactNode;
  channelNames?: Record<string, string>;
};

function Spinner() {
  return <span className={s.spinner} aria-hidden="true" />;
}

function Lines({ lines, names }: { lines: RetryLine[]; names: Record<string, string> }) {
  const { t } = useT();
  return (
    <ul className={s.resultLines}>
      {lines.map((l, i) => (
        <li key={i} className={s[`line_${l.status}`] ?? ""}>
          <strong>{names[l.channel] ?? l.channel}:</strong> {l.message}{" "}
          {l.url && (
            <a href={l.url} target="_blank" rel="noreferrer">
              {t("Ver", "See")} ↗
            </a>
          )}
          {l.action && (
            <>
              {" "}
              <Link href={l.action.href}>{l.action.label}</Link>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export function RetryButton({ businessId, postId, targetId, label, look = "main", children, channelNames = {} }: Props) {
  const { t } = useT();
  const [state, action, isPending] = useActionState<RetryState, FormData>(retryFromHistory, null);
  const single = Boolean(targetId);
  const held = state?.lines.some((l) => l.status === "held");

  const form = (force: boolean, text: string, cls: string) => (
    <form action={action} className={s.inlineForm} style={isPending ? { display: "none" } : undefined}>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="postId" value={postId} />
      {targetId && <input type="hidden" name="targetId" value={targetId} />}
      {force && <input type="hidden" name="force" value="1" />}
      <button type="submit" className={cls}>
        {text}
      </button>
    </form>
  );

  return (
    <div className={s.retryBox}>
      {/* Mientras no haya un resultado nuevo, se ve la explicación que manda el servidor. */}
      {!state && children}
      {state && !isPending && (
        <div className={`${s.result} ${state.ok ? s.resultOk : s.resultBad}`} role="status" aria-live="polite">
          {single && state.lines.length === 1 ? (
            (() => {
              const l = state.lines[0];
              const prefix =
                l.status === "sent" ? t("¡Listo! ", "Done! ") : l.status === "held" ? "" : l.status === "skipped" ? t("Se saltó otra vez: ", "Skipped again: ") : t("Volvió a fallar: ", "It failed again: ");
              return (
                <p>
                  <strong>{prefix}</strong>
                  {l.message}{" "}
                  {l.url && (
                    <a href={l.url} target="_blank" rel="noreferrer">
                      {t("Ver la publicación", "See the post")} ↗
                    </a>
                  )}
                  {l.action && (
                    <>
                      {" "}
                      <Link className={s.fixLink} href={l.action.href}>
                        {l.action.label}
                      </Link>
                    </>
                  )}
                </p>
              );
            })()
          ) : (
            <>
              <p>
                <strong>{state.message}</strong>
              </p>
              {state.lines.length > 0 && <Lines lines={state.lines} names={channelNames} />}
            </>
          )}
        </div>
      )}
      {isPending && (
        <p className={s.pending} role="status" aria-live="polite">
          <Spinner /> {single ? t("Intentando otra vez… (puede tardar un minuto)", "Trying again… (may take a minute)") : t("Reintentando los canales que fallaron… (puede tardar un minuto)", "Retrying the channels that failed… (may take a minute)")}
        </p>
      )}
      <div className={s.retryActions}>
        {!(state?.ok) && form(false, state ? t("Intentar otra vez", "Try again") : label, look === "soft" ? `btn link ${s.softBtn}` : "btn outline")}
        {held && form(true, t("Intentar de todos modos", "Try anyway"), `btn link ${s.softBtn}`)}
      </div>
    </div>
  );
}
