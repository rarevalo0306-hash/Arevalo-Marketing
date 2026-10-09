"use client";

import { useActionState, useRef, useState } from "react";
import type { ToxicResult } from "@/app/actions-toxic";
import { useT } from "@/components/I18n";
import { decodeExport } from "@/lib/toxic-links-shape";
import s from "./Toxic.module.css";

type Props = {
  action: (prev: ToxicResult, f: FormData) => Promise<ToxicResult>;
};

/** Archivos de más de esto no se leen (Semrush y Ahrefs exportan unos pocos MB como mucho). */
const MAX_BYTES = 20 * 1024 * 1024;

/** Pegar o subir la lista que el dueño ya tiene (Semrush, Ahrefs, Search Console o una lista de dominios). Gratis. */
export function ImportBox({ action }: Props) {
  const { t } = useT();
  const [result, run, pending] = useActionState(action, null);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [fileError, setFileError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError("");
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setFileError(t("El archivo es muy grande (más de 20 MB). Exporta solo los dominios.", "The file is too big (over 20 MB). Export just the domains."));
      return;
    }
    try {
      const content = decodeExport(new Uint8Array(await file.arrayBuffer()));
      setText(content);
      setName(file.name);
    } catch {
      setFileError(t("No se pudo leer el archivo. Prueba con un CSV o TXT.", "Couldn't read the file. Try a CSV or TXT."));
    }
  }

  const lines = text ? text.split(/\r\n|\n|\r/).filter((l) => l.trim()).length : 0;

  return (
    <form action={run} className={s.drop}>
      <input type="hidden" name="name" value={name} />
      <div style={{ display: pending ? "none" : undefined }} className="stack">
        <div className={s.fileRow}>
          <label className="btn" htmlFor="toxic-file">
            {t("Elegir archivo (CSV o TXT)", "Choose file (CSV or TXT)")}
          </label>
          <input id="toxic-file" ref={fileRef} type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" onChange={onFile} style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} />
          <span>{name || t("o pega la lista aquí abajo", "or paste the list below")}</span>
        </div>
        <textarea
          name="text"
          className={`field ${s.textarea}`}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (!e.target.value) setName("");
          }}
          placeholder={t("ejemplo-spam.xyz\nhttps://otro-sitio.top/pagina\ndomain:mas-spam.icu", "spam-example.xyz\nhttps://another-site.top/page\ndomain:more-spam.icu")}
          aria-label={t("Lista de enlaces o dominios", "List of links or domains")}
          spellCheck={false}
        />
        {fileError && (
          <p className="note error" role="alert">
            {fileError}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn solid" disabled={!text.trim()}>
            {t("Importar lista", "Import list")}
          </button>
          {lines > 0 && <span className="small muted">{t(`${lines} líneas`, `${lines} lines`)}</span>}
          {text && (
            <button
              type="button"
              className="btn link"
              onClick={() => {
                setText("");
                setName("");
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              {t("Borrar", "Clear")}
            </button>
          )}
        </div>
      </div>
      {pending && <p className="small muted">{t("Leyendo tu lista…", "Reading your list…")}</p>}
      {result && !pending && (
        <p className={result.ok ? "note ok" : "note error"} role="status">
          {result.message}
        </p>
      )}
    </form>
  );
}
