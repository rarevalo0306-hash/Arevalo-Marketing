"use client";

import { useState, useTransition } from "react";
import type { TestResult } from "@/app/actions";
import type { ChannelDef } from "@/lib/channels";

type Props = {
  channel: ChannelDef;
  connected: boolean;
  values: Record<string, string>;
  secretSet: Record<string, boolean>;
  save: (f: FormData) => Promise<void>;
  remove: () => Promise<void>;
  test: () => Promise<TestResult>;
};

export function ConnectionCard({ channel, connected, values, secretSet, save, remove, test }: Props) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<TestResult>(null);
  const [pending, start] = useTransition();

  return (
    <article className="card" style={{ padding: 20, gap: 14 }}>
      <div className="row" style={{ gap: 14, flexWrap: "nowrap" }}>
        <span className="mono solid" style={{ width: 44, height: 44, borderRadius: 10, fontSize: 13 }}>{channel.mono}</span>
        <div style={{ flexGrow: 1 }}>
          <h2 style={{ fontSize: 17, fontFamily: "var(--body)", fontWeight: 600 }}>{channel.name}</h2>
          <div className="small muted">{channel.what}</div>
        </div>
        <span className={connected ? "pill connected" : "pill"}>{connected ? "Conectado" : "No conectado"}</span>
      </div>
      <p className="small" style={{ color: "#3f4246" }}><strong style={{ color: "var(--ink)" }}>Necesitas: </strong>{channel.need}</p>

      {open && (
        <form
          action={(f) =>
            start(async () => {
              await save(f);
              setResult(await test());
            })
          }
          className="stack"
          style={{ gap: 12 }}
        >
          {channel.fields.map((f) => (
            <div key={f.key} className="stack" style={{ gap: 4 }}>
              <label className="small" style={{ fontWeight: 500 }} htmlFor={`${channel.id}-${f.key}`}>{f.label}</label>
              <input
                id={`${channel.id}-${f.key}`}
                name={f.key}
                className="field"
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                defaultValue={values[f.key]}
                placeholder={f.secret && secretSet[f.key] ? "•••••••• (guardado; déjalo vacío para no cambiarlo)" : f.placeholder}
              />
            </div>
          ))}
          <div className="row">
            <button className="btn on" type="submit" disabled={pending}>{pending ? "Guardando y probando…" : "Guardar y probar"}</button>
            <button className="btn" type="button" onClick={() => setOpen(false)}>Cerrar</button>
          </div>
        </form>
      )}

      {result && <p className={result.ok ? "note ok" : "note error"} role="status">{result.message}</p>}

      <div className="row" style={{ justifyContent: "flex-end" }}>
        {connected && !open && (
          <>
            <button className="btn" type="button" disabled={pending} onClick={() => start(async () => setResult(await test()))}>
              {pending ? "Probando…" : "Probar conexión"}
            </button>
            <button
              className="btn danger"
              type="button"
              disabled={pending}
              onClick={() => {
                if (confirm(`¿Desconectar ${channel.name}?`)) start(async () => { await remove(); setResult(null); });
              }}
            >
              Desconectar
            </button>
          </>
        )}
        {!open && (
          <button className="btn outline" type="button" onClick={() => setOpen(true)}>
            {connected ? "Editar datos" : `Conectar ${channel.name}`}
          </button>
        )}
      </div>
    </article>
  );
}
