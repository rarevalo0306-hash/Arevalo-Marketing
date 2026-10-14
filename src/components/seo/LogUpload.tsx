"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { saveLogReport } from "@/app/actions-seo-logs";
import { useT } from "@/components/I18n";
import { addLogLine, finishLog, newLogAcc } from "@/lib/seo/logs";

/** Lo más grande que se lee (en total). Los registros de un negocio pequeño pesan mucho menos. */
const MAX_BYTES = 1024 * 1024 * 1024;

/** ¿Está comprimido con gzip? (por el nombre o por los 2 primeros bytes). */
async function isGzip(file: File): Promise<boolean> {
  if (/\.gz$/i.test(file.name)) return true;
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  return head[0] === 0x1f && head[1] === 0x8b;
}

/**
 * Lee el registro de visitas EN EL NAVEGADOR (línea por línea, también .gz) y manda al servidor solo el resumen:
 * sin direcciones IP ni lo que va después de «?». `sitePaths`: las páginas de tu web, para ver cuáles no visitó Google.
 */
export function LogUpload({ businessId, sitePaths }: { businessId: string; sitePaths: string[] }) {
  const { t, lang } = useT();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const run = async (files: File[]) => {
    if (!files.length) return;
    const total = files.reduce((s, f) => s + f.size, 0);
    if (total > MAX_BYTES) {
      setResult({ ok: false, message: t("Los archivos pesan más de 1 GB. Elige solo los de las últimas semanas.", "The files are over 1 GB. Pick only the last few weeks.") });
      return;
    }
    setBusy(true);
    setResult(null);
    setProgress(0);
    const acc = newLogAcc();
    let done = 0;
    try {
      for (const file of files) {
        let raw: ReadableStream<Uint8Array> = file.stream();
        // Cuenta los bytes leídos (antes de descomprimir) para la barra de avance.
        raw = raw.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, ctrl) {
              done += chunk.byteLength;
              ctrl.enqueue(chunk);
            },
          }),
        );
        if (await isGzip(file)) raw = raw.pipeThrough(new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
        const reader = raw.pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>).getReader();
        let rest = "";
        let last = 0;
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) break;
          const text = rest + value;
          const lines = text.split(/\r?\n/);
          rest = lines.pop() ?? "";
          for (const line of lines) addLogLine(acc, line);
          const now = Date.now();
          if (now - last > 150) {
            last = now;
            setProgress(total ? done / total : 0);
          }
        }
        if (rest) addLogLine(acc, rest);
      }
      setProgress(1);
      const report = finishLog(acc, { files: files.map((f) => f.name), sitePaths });
      if (!report.parsed) {
        setResult({
          ok: false,
          message: t(
            "No reconocimos ninguna visita en ese archivo. Tiene que ser el registro de visitas del servidor (access log), no el de errores.",
            "We didn't recognize any visit in that file. It must be the server's access log, not the error log.",
          ),
        });
        return;
      }
      const saved = await saveLogReport(businessId, JSON.stringify(report));
      setResult(saved);
      if (saved.ok) router.refresh();
    } catch {
      setResult({ ok: false, message: t("No se pudo leer el archivo. Si es .zip, descomprímelo primero (se aceptan .log, .txt, .json y .gz).", "Couldn't read the file. If it's a .zip, unzip it first (.log, .txt, .json and .gz work).") });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <label className={`btn ai${busy ? " disabled" : ""}`} aria-disabled={busy}>
          {busy ? t("Leyendo el registro…", "Reading the log…") : t("Elegir el registro de visitas", "Choose the access log")}
          <input
            ref={input}
            type="file"
            multiple
            accept=".log,.txt,.gz,.json,.jsonl,.csv,text/plain,application/gzip,application/json"
            hidden
            disabled={busy}
            onChange={(e) => void run([...(e.target.files ?? [])])}
          />
        </label>
        <span className="small muted">
          {busy
            ? `${Math.round(progress * 100)}% · ${t("No cierres esta página.", "Don't close this page.")}`
            : t("Gratis. El archivo se lee en tu navegador: solo guardamos el resumen, sin direcciones IP.", "Free. The file is read in your browser: we only save the summary, without IP addresses.")}
        </span>
      </div>
      {busy && <progress max={1} value={progress} style={{ width: "100%" }} aria-label={t("Avance", "Progress")} lang={lang} />}
      {result && !busy && (
        <p className={result.ok ? "note ok" : "note error"} role="status">
          {result.message}
        </p>
      )}
    </div>
  );
}
