"use client";

// La lista de directorios: avance, y una tarjeta por directorio con «Buscar si ya estoy», «Registrarme», el estado y el
// enlace a tu ficha.
import { useActionState, useState, useTransition } from "react";
import { saveListing, setListingStatus, type DirResult } from "@/app/actions-directories";
import { useT } from "@/components/I18n";
import type { Bi, DirCost, DirPriority, ListingStatus } from "@/lib/directories";
import s from "./Directories.module.css";

export type DirItem = {
  id: string;
  name: string;
  why: Bi;
  data: Bi;
  priority: DirPriority;
  cost: DirCost;
  kind: "listing" | "check";
  signUpUrl: string;
  searchUrl: string;
  status: ListingStatus;
  url: string;
  notes: string;
  napOk: boolean | null;
  checkedAt: string | null;
  seenInSearch: boolean;
};

type Filter = "todo" | "done" | "all";

const STATUS_PILL: Record<ListingStatus, string> = { todo: "neutral", listed: "good", claimed: "good", "needs-fix": "warn", skip: "plain" };

function StatusText({ st }: { st: ListingStatus }) {
  const { t } = useT();
  const text = { todo: t("Por hacer", "To do"), listed: t("Ya estoy", "Listed"), claimed: t("Reclamado", "Claimed"), "needs-fix": t("Corregir datos", "Needs fixing"), skip: t("No aplica", "Not for me") }[st];
  return <span className={`pill ${STATUS_PILL[st]}`}>{text}</span>;
}

function DirCard({ businessId, d, onTouch }: { businessId: string; d: DirItem; onTouch: () => void }) {
  const { lang, t } = useT();
  const [pending, start] = useTransition();
  // Lo elegido aquí se ve al instante; cuando llega lo guardado (que puede ser distinto: pegar el enlace de una ficha
  // «por hacer» la marca «ya estoy»), manda lo guardado.
  const [local, setLocal] = useState<{ from: ListingStatus; v: ListingStatus } | null>(null);
  const status = local && local.from === d.status ? local.v : d.status;
  const setStatus = (v: ListingStatus) => setLocal({ from: d.status, v });
  const [state, action, isPending] = useActionState<DirResult, FormData>(saveListing.bind(null, businessId), null);
  const tx = (b: Bi) => (lang === "en" ? b.en : b.es);
  const prio = { 3: t("Imprescindible", "Must have"), 2: t("Importante", "Important"), 1: t("Extra", "Extra") }[d.priority];
  const cost = { free: t("Gratis", "Free"), paid: t("De pago", "Paid"), "free-paid": t("Gratis (con opciones de pago)", "Free (paid options)") }[d.cost];
  const quick = (next: ListingStatus) => {
    onTouch();
    setStatus(next);
    start(async () => {
      await setListingStatus(businessId, d.id, next);
    });
  };
  const isCheck = d.kind === "check";
  return (
    <li className={`${s.dir} ${status === "listed" || status === "claimed" ? s.dirDone : ""} ${status === "skip" ? s.dirSkip : ""}`} id={`dir-${d.id}`}>
      <div className={s.dirHead}>
        <div className={s.dirTitle}>
          <strong>{d.name}</strong>
          <div className={s.pills}>
            <span className={`pill ${d.priority === 3 ? "info" : d.priority === 2 ? "draft" : "plain"}`}>{prio}</span>
            <span className="pill plain">{cost}</span>
            {d.seenInSearch && <span className="pill partial">{t("Sale en tus búsquedas", "Shows in your searches")}</span>}
          </div>
        </div>
        <StatusText st={status} />
      </div>
      <p className={s.why}>{tx(d.why)}</p>
      <div className={`${s.dirActions} ${d.searchUrl && !isCheck ? s.two : ""}`}>
        {d.searchUrl && (
          <a className="btn" href={d.searchUrl} target="_blank" rel="noopener noreferrer">
            {isCheck ? t("Revisar mi licencia", "Check my license") : t("Buscar si ya estoy", "Check if I'm listed")} ↗
          </a>
        )}
        {!isCheck && (
          <a className="btn solid" href={d.signUpUrl} target="_blank" rel="noopener noreferrer">
            {t("Registrarme", "Sign up")} ↗
          </a>
        )}
      </div>
      <label className={s.statusRow}>
        <span>{t("Estado:", "Status:")}</span>
        <select className="field" value={status} disabled={pending} onChange={(e) => quick(e.target.value as ListingStatus)}>
          <option value="todo">{t("Por hacer", "To do")}</option>
          <option value="listed">{isCheck ? t("Revisado, está bien", "Checked, it's fine") : t("Ya estoy", "I'm listed")}</option>
          {!isCheck && <option value="claimed">{t("La reclamé (puedo editarla)", "I claimed it (I can edit it)")}</option>}
          <option value="needs-fix">{isCheck ? t("Hay que corregir", "Needs fixing") : t("Tiene datos distintos", "Has different details")}</option>
          <option value="skip">{t("No aplica para mí", "Not for me")}</option>
        </select>
      </label>
      <details className={s.more}>
        <summary>{t("Qué datos llenar y guardar el enlace", "What to fill in and save the link")}</summary>
        <p className="small">{tx(d.data)}</p>
        {isPending && (
          <p className="small muted" role="status">
            {t("Guardando…", "Saving…")}
          </p>
        )}
        <form action={action} onSubmit={onTouch} className={s.dirForm} style={isPending ? { display: "none" } : undefined}>
          <input type="hidden" name="directory" value={d.id} />
          <input type="hidden" name="status" value={status} />
          <label className={s.label}>
            {t("Enlace a tu ficha", "Link to your listing")}
            <input className="field" name="url" type="url" inputMode="url" defaultValue={d.url} placeholder="https://" />
          </label>
          <fieldset className={s.napQ}>
            <legend className={s.label}>{t("¿Tu nombre, dirección y teléfono están iguales?", "Are your name, address and phone the same?")}</legend>
            <label className={s.radio}>
              <input type="radio" name="napOk" value="yes" defaultChecked={d.napOk === true} /> {t("Sí", "Yes")}
            </label>
            <label className={s.radio}>
              <input type="radio" name="napOk" value="no" defaultChecked={d.napOk === false} /> {t("No, hay que corregir", "No, needs fixing")}
            </label>
            <label className={s.radio}>
              <input type="radio" name="napOk" value="" defaultChecked={d.napOk === null} /> {t("No lo he revisado", "Haven't checked")}
            </label>
          </fieldset>
          <label className={s.label}>
            {t("Notas (usuario, cuándo te verifican…)", "Notes (username, when they verify you…)")}
            <textarea className="field" name="notes" rows={2} defaultValue={d.notes} maxLength={1000} />
          </label>
          <button type="submit" className="btn outline">
            {t("Guardar", "Save")}
          </button>
        </form>
        {state?.message && !isPending && (
          <p className={`note ${state.ok ? "ok" : "error"}`} role={state.ok ? "status" : "alert"}>
            {state.message}
          </p>
        )}
        {d.url && (
          <p className="small">
            <a href={d.url} target="_blank" rel="noopener noreferrer">
              {t("Abrir mi ficha", "Open my listing")} ↗
            </a>
          </p>
        )}
      </details>
    </li>
  );
}

export function DirectoryList({ businessId, items, progress }: { businessId: string; items: DirItem[]; progress: { done: number; total: number } }) {
  const { t } = useT();
  const [filter, setFilter] = useState<Filter>("todo");
  // Las tarjetas que se acaban de tocar no desaparecen del filtro hasta cambiar de filtro (para poder pegar el enlace).
  const [touched, setTouched] = useState<string[]>([]);
  const isDone = (d: DirItem) => d.status === "listed" || d.status === "claimed" || d.status === "skip";
  const shown = items.filter((d) => touched.includes(d.id) || (filter === "all" ? true : filter === "done" ? isDone(d) : !isDone(d)));
  const main = shown.filter((d) => d.priority >= 2);
  const extra = shown.filter((d) => d.priority < 2);
  const touch = (id: string) => () => setTouched((x) => (x.includes(id) ? x : [...x, id]));
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const counts = { todo: items.filter((d) => !isDone(d)).length, done: items.filter(isDone).length, all: items.length };
  return (
    <div className="stack">
      <div className={s.progress}>
        <div className="row between">
          <strong>{t(`${progress.done} de ${progress.total} directorios importantes`, `${progress.done} of ${progress.total} important directories`)}</strong>
          <span className="small muted">{pct}%</span>
        </div>
        <div className={s.bar} role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label={t("Avance en directorios", "Directory progress")}>
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className={s.filters} role="group" aria-label={t("Mostrar", "Show")}>
        {(["todo", "done", "all"] as const).map((f) => (
          <button key={f} type="button" className={`btn ${filter === f ? "on" : ""}`} aria-pressed={filter === f} onClick={() => {
              setFilter(f);
              setTouched([]);
            }}>
            {{ todo: t("Por hacer", "To do"), done: t("Listos", "Done"), all: t("Todos", "All") }[f]} ({counts[f]})
          </button>
        ))}
      </div>
      {shown.length ? (
        <>
          <ul className={s.dirs}>
            {main.map((d) => (
              <DirCard key={d.id} businessId={businessId} d={d} onTouch={touch(d.id)} />
            ))}
          </ul>
          {extra.length > 0 && (
            <details className={s.more} open={main.length === 0}>
              <summary>{t(`Ver ${extra.length} directorios más (extra, cuando tengas tiempo)`, `See ${extra.length} more directories (extra, when you have time)`)}</summary>
              <ul className={s.dirs}>
                {extra.map((d) => (
                  <DirCard key={d.id} businessId={businessId} d={d} onTouch={touch(d.id)} />
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <p className="small muted">{filter === "todo" ? t("¡Listo! Ya estás en todos los directorios de la lista.", "All set! You're on every directory in the list.") : t("Todavía ninguno.", "None yet.")}</p>
      )}
    </div>
  );
}
