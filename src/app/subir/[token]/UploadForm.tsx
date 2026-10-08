"use client";

// Subir fotos y videos con el link de los técnicos: cada archivo va directo del celular a Cloudflare R2 (con una
// dirección firmada por la app), con su barra de avance. De cada video se saca una imagen (al segundo 1) para la IA.
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18n";
import { checkUploadFile, fmtMB, MAX_FILES, NOTE_MAX } from "@/lib/upload-rules";
import s from "./subir.module.css";

type State = "wait" | "up" | "done" | "fail" | "bad";
type Item = {
  id: number;
  file: File;
  kind: "photo" | "video";
  type: string;
  state: State;
  progress: number;
  error: string;
  preview: string;
  note: string;
};
type Frame = { blob: Blob | null; duration: number; width: number; height: number };

/** Cuántos archivos suben a la vez (los datos del celular no dan para más). */
const AT_ONCE = 2;

/** Una imagen del video (al segundo 1, o a la mitad si es más corto), en JPG de 768 px como mucho. */
function captureFrame(file: File): Promise<Frame> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    let finished = false;
    const finish = (blob: Blob | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const out = { blob, duration: Number.isFinite(v.duration) ? v.duration : 0, width: v.videoWidth || 0, height: v.videoHeight || 0 };
      v.removeAttribute("src");
      v.load();
      URL.revokeObjectURL(url);
      resolve(out);
    };
    const timer = setTimeout(() => finish(null), 12_000);
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onloadedmetadata = () => {
      const d = Number.isFinite(v.duration) ? v.duration : 2;
      v.currentTime = Math.min(1, d / 2);
    };
    v.onseeked = () => {
      try {
        const scale = Math.min(1, 768 / Math.max(v.videoWidth || 1, v.videoHeight || 1));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round((v.videoWidth || 1) * scale));
        c.height = Math.max(1, Math.round((v.videoHeight || 1) * scale));
        const ctx = c.getContext("2d");
        if (!ctx || !v.videoWidth) return finish(null);
        ctx.drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((b) => finish(b), "image/jpeg", 0.82);
      } catch {
        finish(null);
      }
    };
    v.onerror = () => finish(null);
    v.src = url;
  });
}

export function UploadForm({ token }: { token: string }) {
  const { lang, t } = useT();
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const pickRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const queue = useRef<Item[]>([]);
  const running = useRef(0);
  const frames = useRef(new Map<number, Frame>());
  const urls = useRef<string[]>([]);

  const busy = items.some((i) => i.state === "wait" || i.state === "up");
  const done = items.filter((i) => i.state === "done").length;
  const failed = items.filter((i) => i.state === "fail").length;

  // Avisar antes de cerrar la página mientras algo sube.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const patch = (id: number, p: Partial<Item>) => setItems((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)));

  async function api<R>(path: "firmar" | "listo", body: Record<string, unknown>): Promise<R> {
    let res: Response;
    try {
      res = await fetch(`/api/subir/${encodeURIComponent(token)}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, lang }),
      });
    } catch {
      throw new Error(t("Sin conexión. Revisa tu internet y toca «Reintentar».", 'No connection. Check your internet and tap "Try again".'));
    }
    const data = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string } & R) | null;
    if (!res.ok || !data?.ok) throw new Error(data?.error || t(`La app no contestó bien (${res.status}). Toca «Reintentar».`, `The app didn't answer properly (${res.status}). Tap "Try again".`));
    return data;
  }

  function put(url: string, body: Blob, type: string, onProgress?: (f: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("PUT", url);
      x.setRequestHeader("Content-Type", type);
      if (onProgress) x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      x.onload = () =>
        x.status >= 200 && x.status < 300
          ? resolve()
          : reject(new Error(t(`El almacenamiento no aceptó el archivo (${x.status}). Toca «Reintentar».`, `The storage didn't accept the file (${x.status}). Tap "Try again".`)));
      x.onerror = () => reject(new Error(t("Se cortó la conexión. Revisa tu internet y toca «Reintentar».", 'The connection dropped. Check your internet and tap "Try again".')));
      x.send(body);
    });
  }

  async function uploadOne(it: Item) {
    patch(it.id, { state: "up", progress: 0, error: "" });
    try {
      // Video: primero la imagen para la IA (y para verlo en la lista).
      let frame = frames.current.get(it.id);
      if (it.kind === "video" && !frame) {
        frame = await captureFrame(it.file);
        frames.current.set(it.id, frame);
        if (frame.blob) {
          const u = URL.createObjectURL(frame.blob);
          urls.current.push(u);
          patch(it.id, { preview: u });
        }
      }
      const main = await api<{ key: string; url: string; contentType: string }>("firmar", { name: it.file.name, type: it.type, size: it.file.size });
      await put(main.url, it.file, main.contentType, (f) => patch(it.id, { progress: Math.min(0.99, f) }));
      let thumbKey = "";
      if (frame?.blob) {
        try {
          const th = await api<{ key: string; url: string }>("firmar", { frame: true, type: "image/jpeg", size: frame.blob.size });
          await put(th.url, frame.blob, "image/jpeg");
          thumbKey = th.key;
        } catch {
          // Sin la imagen el video igual se guarda.
        }
      }
      await api("listo", {
        key: main.key,
        name: it.file.name,
        note: it.note,
        thumbKey,
        width: frame?.width ?? 0,
        height: frame?.height ?? 0,
        durationSec: frame?.duration ?? 0,
        lastModified: it.file.lastModified,
      });
      patch(it.id, { state: "done", progress: 1 });
    } catch (e) {
      patch(it.id, { state: "fail", error: e instanceof Error ? e.message : String(e) });
    }
  }

  function pump() {
    while (running.current < AT_ONCE && queue.current.length) {
      const it = queue.current.shift()!;
      running.current++;
      void uploadOne(it).finally(() => {
        running.current--;
        pump();
      });
    }
  }

  function add(list: FileList | null) {
    if (!list?.length) return;
    const all = Array.from(list);
    const files = all.slice(0, MAX_FILES);
    setNotice(
      all.length > MAX_FILES
        ? t(
            `Se suben como mucho ${MAX_FILES} a la vez. Elegiste ${all.length}: van las primeras ${MAX_FILES}; después sube el resto.`,
            `Up to ${MAX_FILES} at a time. You picked ${all.length}: the first ${MAX_FILES} go now; upload the rest afterwards.`,
          )
        : "",
    );
    const n = note.trim().slice(0, NOTE_MAX);
    const fresh: Item[] = files.map((file) => {
      const c = checkUploadFile({ name: file.name, type: file.type, size: file.size });
      const id = nextId.current++;
      let preview = "";
      if (c.ok && c.kind === "photo" && !/hei[cf]/.test(c.type)) {
        preview = URL.createObjectURL(file);
        urls.current.push(preview);
      }
      return c.ok
        ? { id, file, kind: c.kind, type: c.type, state: "wait", progress: 0, error: "", preview, note: n }
        : { id, file, kind: file.type.startsWith("video/") ? "video" : "photo", type: file.type, state: "bad", progress: 0, error: c[lang], preview: "", note: n };
    });
    setItems((prev) => [...prev, ...fresh]);
    queue.current.push(...fresh.filter((x) => x.state === "wait"));
    pump();
  }

  function retry(it: Item) {
    patch(it.id, { state: "wait", progress: 0, error: "" });
    queue.current.push(it);
    pump();
  }

  function again() {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
    frames.current.clear();
    setItems([]);
    setNotice("");
    pickRef.current?.click();
  }

  const statusText = (it: Item) => {
    if (it.state === "wait") return t("Esperando…", "Waiting…");
    if (it.state === "up") return it.progress > 0 ? t(`Subiendo ${Math.round(it.progress * 100)}%`, `Uploading ${Math.round(it.progress * 100)}%`) : t("Preparando…", "Getting ready…");
    if (it.state === "done") return t("Listo ✓", "Done ✓");
    return it.error;
  };

  const picker = (
    <>
      <label className={s.big}>
        <input
          ref={pickRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className={s.hiddenInput}
          onChange={(e) => {
            add(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
        <span aria-hidden="true" className={s.bigIcon}>
          ＋
        </span>
        {items.length ? t("Subir más fotos y videos", "Upload more photos and videos") : t("Subir fotos y videos", "Upload photos and videos")}
      </label>
      <label className={`btn ${s.camera}`}>
        <input
          type="file"
          accept="image/*,video/*"
          capture="environment"
          className={s.hiddenInput}
          onChange={(e) => {
            add(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
        📷 {t("Tomar una foto o video ahora", "Take a photo or video now")}
      </label>
    </>
  );

  return (
    <div className={s.form}>
      <div className={s.noteBox}>
        <label htmlFor="subir-nota" className={s.noteLabel}>
          {t("¿Qué trabajo es?", "What job is it?")} <span className={s.optional}>{t("(opcional)", "(optional)")}</span>
        </label>
        <input
          id="subir-nota"
          className="field"
          value={note}
          maxLength={NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("Ej.: Cortina nueva en Ferretería López", "E.g.: New door at López Hardware")}
          autoComplete="off"
          enterKeyHint="done"
        />
      </div>

      {!busy && items.length > 0 ? (
        <section className={`${s.summary} ${failed ? s.summaryWarn : ""}`} role="status">
          <strong className={s.summaryTitle}>
            {done
              ? t(`Listo: subiste ${done} ${done === 1 ? "archivo" : "archivos"}`, `Done: you uploaded ${done} ${done === 1 ? "file" : "files"}`)
              : t("No se subió nada todavía", "Nothing was uploaded yet")}
          </strong>
          {failed > 0 && <span>{t(`${failed} no se ${failed === 1 ? "subió" : "subieron"}.`, `${failed} didn't upload.`)}</span>}
          {done > 0 && <span>{t("¡Gracias! Ya le llegaron a la empresa.", "Thanks! The company has them now.")}</span>}
          <div className={s.summaryActions}>
            {failed > 0 && (
              <button type="button" className="btn" onClick={() => items.filter((i) => i.state === "fail").forEach(retry)}>
                {t("Reintentar los que fallaron", "Retry the failed ones")}
              </button>
            )}
            <button type="button" className={`btn ${s.more}`} onClick={again}>
              {t("Subir más", "Upload more")}
            </button>
          </div>
        </section>
      ) : null}

      {(busy || items.length === 0) && picker}
      {!busy && items.length > 0 && <div className={s.hiddenPicker}>{picker}</div>}

      <p className={s.limits}>
        {t(
          `Fotos hasta 40 MB y videos hasta 500 MB, ${MAX_FILES} a la vez. No cierres esta página mientras sube.`,
          `Photos up to 40 MB and videos up to 500 MB, ${MAX_FILES} at a time. Don't close this page while uploading.`,
        )}
      </p>
      {notice && <p className="note">{notice}</p>}

      {items.length > 0 && (
        <ul className={s.list} aria-label={t("Archivos", "Files")}>
          {items.map((it) => (
            <li key={it.id} className={`${s.row} ${it.state === "fail" || it.state === "bad" ? s.rowBad : ""} ${it.state === "done" ? s.rowDone : ""}`}>
              <span className={s.thumb} aria-hidden="true">
                {it.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- vista previa local del archivo
                  <img src={it.preview} alt="" />
                ) : (
                  <span>{it.kind === "video" ? "▶" : "▢"}</span>
                )}
              </span>
              <span className={s.rowText}>
                <span className={s.name}>{it.file.name || (it.kind === "video" ? t("Video", "Video") : t("Foto", "Photo"))}</span>
                <span className={s.sub}>
                  {fmtMB(it.file.size)} · <span className={s.state}>{statusText(it)}</span>
                </span>
                {(it.state === "up" || it.state === "wait") && (
                  <span className={s.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(it.progress * 100)} aria-label={it.file.name}>
                    <span style={{ width: `${Math.round(it.progress * 100)}%` }} />
                  </span>
                )}
              </span>
              {it.state === "fail" && (
                <button type="button" className={`btn small ${s.retry}`} onClick={() => retry(it)}>
                  {t("Reintentar", "Try again")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
