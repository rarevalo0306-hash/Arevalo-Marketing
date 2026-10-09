"use client";

// «Diseños maestros con IA»: 1) comparar modelos (precio antes de crear, confirmación), ver cada diseño ya armado con
// una foto y un titular de ejemplo, ajustarlo y guardarlo como plantilla; 2) hacer las otras formas con el mismo estilo.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { CheckResult, PreviewResult, SaveResult, StartResult } from "@/app/actions-design-ai";
import { DesignAiAdjust, type AdjustState } from "@/components/brand/DesignAiAdjust";
import { DesignAiCard } from "@/components/brand/DesignAiCard";
import { useT } from "@/components/I18n";
import type { MasterCandidate, MasterTemplateInfo } from "@/lib/design-ai-run";
import { MASTER_SHAPES, type MasterShape } from "@/lib/design-shapes";
import s from "./DesignAi.module.css";

export type PanelModel = { id: string; name: string; maker: string; usd: Record<MasterShape, number>; approx: boolean; styleRef: boolean; etaSec: number; defaultOn: boolean; good: string };
export type Sample = { photo: string; headline: string; logo: string; color: string; font: string };

export function DesignAiPanel(p: {
  models: PanelModel[];
  cap: number;
  candidates: MasterCandidate[];
  masters: MasterTemplateInfo[];
  favorite: string;
  sample: Sample;
  hasFal: boolean;
  hasIdeogram: boolean;
  /** Plantillas de redes del manual (para mandarlas como estilo). */
  bookPieces?: { url: string; label: string }[];
  start: (input: { models: string[]; shapes: string[]; parentId?: string; bookStyle?: boolean }) => Promise<StartResult>;
  check: (id: string) => Promise<CheckResult>;
  preview: (id: string, adjust?: AdjustState) => Promise<PreviewResult>;
  save: (id: string, adjust?: AdjustState) => Promise<SaveResult>;
  discard: (id: string) => Promise<SaveResult>;
}) {
  const { t } = useT();
  const router = useRouter();
  const SHAPE_LABEL: Record<MasterShape, string> = { square: t("Cuadrado (1:1)", "Square (1:1)"), portrait: t("Vertical (4:5)", "Portrait (4:5)"), story: t("Historia (9:16)", "Story (9:16)") };
  const ordered = useMemo(() => [...p.models].sort((a, b) => Number(b.id === p.favorite) - Number(a.id === p.favorite)), [p.models, p.favorite]);
  const [shapes, setShapes] = useState<MasterShape[]>(["square"]);
  const [picked, setPicked] = useState<string[]>(() => ordered.filter((m) => m.defaultOn).slice(0, 4).map((m) => m.id));
  const [confirm, setConfirm] = useState(false);
  const [list, setList] = useState<MasterCandidate[]>(p.candidates);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState("");
  const pieces = p.bookPieces ?? [];
  const [bookStyle, setBookStyle] = useState(pieces.length > 0);

  const chosen = ordered.filter((m) => picked.includes(m.id));
  const count = chosen.length * shapes.length;
  const total = Math.round(chosen.reduce((a, m) => a + shapes.reduce((b, sh) => b + m.usd[sh], 0), 0) * 100) / 100;
  const over = total > p.cap + 1e-9;
  const money = (v: number) => `US$${v.toFixed(2)}`;

  // Pregunta cada 4 segundos por los que se están creando.
  const polling = useRef(false);
  const waiting = list.some((c) => c.status === "pending" || c.status === "storing");
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        for (const c of list.filter((x) => x.status === "pending" || x.status === "storing")) {
          const r = await p.check(c.id);
          if (r.ok && r.candidate) setList((cur) => cur.map((x) => (x.id === c.id ? r.candidate! : x)));
        }
      } finally {
        polling.current = false;
      }
    }, 4000);
    return () => clearInterval(id);
  }, [waiting, list, p]);

  // Cada diseño listo se muestra ya armado (foto y titular de ejemplo), hasta 3 a la vez.
  const asked = useRef(new Set<string>());
  const inflight = useRef(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    const next = list.filter((c) => c.status === "ready" && !previews[c.id] && !asked.current.has(c.id)).slice(0, Math.max(0, 3 - inflight.current));
    for (const c of next) {
      asked.current.add(c.id);
      inflight.current++;
      p.preview(c.id)
        .then((r) => {
          // Si no se pudo armar, se muestra el diseño vacío.
          setPreviews((cur) => ({ ...cur, [c.id]: r.ok && r.url ? r.url : "none" }));
        })
        .finally(() => {
          inflight.current--;
          setTick((n) => n + 1);
        });
    }
  });

  function toggle<T>(arr: T[], v: T): T[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  function run(input: { models: string[]; shapes: string[]; parentId?: string; bookStyle?: boolean }) {
    setMsg(null);
    startTransition(async () => {
      const r = await p.start(input);
      setMsg({ ok: r.ok, text: r.message });
      setConfirm(false);
      if (!r.ok || !r.ids) return;
      const fresh: MasterCandidate[] = [];
      for (const id of r.ids) {
        const c = await p.check(id);
        if (c.ok && c.candidate) fresh.push(c.candidate);
      }
      setList((cur) => [...fresh, ...cur.filter((x) => !fresh.some((f) => f.id === x.id))]);
    });
  }

  async function onSave(id: string, adjust?: AdjustState) {
    setBusyId(id);
    const r = await p.save(id, adjust);
    setBusyId("");
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) {
      setAdjusting(null);
      setList((cur) => cur.filter((x) => x.id !== id));
      router.refresh();
    }
  }
  async function onDiscard(id: string) {
    setBusyId(id);
    const r = await p.discard(id);
    setBusyId("");
    if (r.ok) setList((cur) => cur.filter((x) => x.id !== id));
    else setMsg({ ok: false, text: r.message });
  }

  const parentName = (id?: string) => p.masters.find((m) => m.id === id)?.name ?? "";
  const editing = list.find((c) => c.id === adjusting && c.status === "ready");

  return (
    <div className={s.wrap}>
      <div className={s.head}>
        <h3 className={s.title}>
          <span aria-hidden className={s.spark}>✦</span> {t("Diseños maestros con IA (calidad de diseñador)", "AI master designs (designer quality)")}
        </h3>
        <p className="small muted">{t("La IA de diseño hace tu diseño principal una vez; después cada post lo usa como plantilla, casi gratis.", "The design AI makes your main design once; then every post uses it as a template, almost free.")}</p>
      </div>

      {!p.models.length ? (
        <div className="stack" style={{ gap: 8 }}>
          <p className="note info">{t("Para usarlo hace falta conectar una IA de diseño (Ideogram o fal.ai).", "To use it, connect a design AI (Ideogram or fal.ai).")}</p>
          <details className={s.howto}>
            <summary>{t("¿Cómo lo conecto?", "How do I connect it?")}</summary>
            <ol className="small">
              <li>{t("Ideogram (recomendado si ya tienes cuenta): en ideogram.ai → API, crea una clave.", "Ideogram (recommended if you already have an account): at ideogram.ai → API, create a key.")}</li>
              <li>{t("En Vercel → Settings → Environment Variables agrega IDEOGRAM_API_KEY con esa clave (o FAL_KEY para los modelos de fal.ai).", "In Vercel → Settings → Environment Variables add IDEOGRAM_API_KEY with that key (or FAL_KEY for the fal.ai models).")}</li>
              <li>{t("Vuelve a publicar la app (Redeploy) y recarga esta página.", "Redeploy the app and reload this page.")}</li>
            </ol>
          </details>
        </div>
      ) : (
        <section className={s.step} aria-labelledby="dai-step1">
          <h4 id="dai-step1" className={s.stepTitle}>
            <span className={s.num}>1</span> {t("Comparar modelos", "Compare models")}
          </h4>
          <fieldset className={s.group}>
            <legend className="lbl">{t("Formas", "Shapes")}</legend>
            <div className={s.chips}>
              {MASTER_SHAPES.map((sh) => (
                <label key={sh} className={shapes.includes(sh) ? `${s.chip} ${s.on}` : s.chip}>
                  <input type="checkbox" checked={shapes.includes(sh)} onChange={() => { setShapes((cur) => toggle(cur, sh)); setConfirm(false); }} />
                  {SHAPE_LABEL[sh]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className={s.group}>
            <legend className="lbl">{t("Modelos (elige de 1 a 4)", "Models (choose 1 to 4)")}</legend>
            <div className={s.models}>
              {ordered.map((m) => {
                const on = picked.includes(m.id);
                const price = shapes.length ? shapes.map((sh) => m.usd[sh]).reduce((a, b) => Math.max(a, b), 0) : m.usd.square;
                return (
                  <label key={m.id} className={on ? `${s.model} ${s.on}` : s.model}>
                    <input type="checkbox" checked={on} disabled={!on && picked.length >= 4} onChange={() => { setPicked((cur) => toggle(cur, m.id)); setConfirm(false); }} />
                    <span className={s.modelBody}>
                      <span className={s.modelTop}>
                        <strong>{m.name}</strong>
                        <span className={s.price}>{m.approx ? "≈" : ""}{money(price)} {t("c/u", "each")}</span>
                      </span>
                      <span className="small muted">{m.maker}</span>
                      <span className="small">{m.good}</span>
                      {m.id === p.favorite && <span className="pill good plain">{t("Tu favorito", "Your favorite")}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {pieces.length > 0 && (
            <label className={`check ${s.bookStyle}`}>
              <input type="checkbox" checked={bookStyle} onChange={(e) => setBookStyle(e.target.checked)} />
              <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                <strong className="small">{t("Seguir el estilo de mi manual", "Follow my brand book's style")}</strong>
                <span className="small muted">{t("Mandamos 1 o 2 de las plantillas de tu manual como referencia a los modelos que la aceptan.", "We send 1 or 2 of your brand book templates as a reference to the models that accept it.")}</span>
              </span>
              <span className={s.bookThumbs} aria-hidden>
                {pieces.slice(0, 2).map((x) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={x.url} src={x.url} alt="" />
                ))}
              </span>
            </label>
          )}
          <div className={s.costRow}>
            <p className={s.cost} aria-live="polite">
              {count
                ? t(`~${money(total)} por ${count} ${count === 1 ? "diseño" : "diseños"}`, `~${money(total)} for ${count} ${count === 1 ? "design" : "designs"}`)
                : t("Elige al menos una forma y un modelo.", "Choose at least one shape and one model.")}
              <span className="small muted"> · {t(`tope por vez ${money(p.cap)}`, `limit per run ${money(p.cap)}`)}</span>
            </p>
            {over && <p className="note error">{t("Pasa el tope por vez. Elige menos modelos o formas.", "That's over the limit per run. Choose fewer models or shapes.")}</p>}
            {pending ? (
              <p className={s.progressText} role="status"><span className={s.spinner} aria-hidden /> {t("Mandando los pedidos…", "Sending the requests…")}</p>
            ) : confirm ? (
              <div className={s.confirm} role="group" aria-label={t("Confirmar el gasto", "Confirm the cost")}>
                <span className="small">{t(`Se cobrarán ~${money(total)} a tu cuenta de la IA de diseño. ¿Seguimos?`, `About ${money(total)} will be charged to your design AI account. Continue?`)}</span>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn on" onClick={() => run({ models: chosen.map((m) => m.id), shapes, bookStyle })}>{t("Sí, crear", "Yes, create")}</button>
                  <button type="button" className="btn" onClick={() => setConfirm(false)}>{t("Cancelar", "Cancel")}</button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn ai" disabled={!count || over} onClick={() => setConfirm(true)}>
                {t(`Crear ${count || ""} ${count === 1 ? "diseño" : "diseños"}`, `Create ${count || ""} ${count === 1 ? "design" : "designs"}`)}
              </button>
            )}
          </div>
        </section>
      )}

      {msg && <p className={msg.ok ? "note ok" : "note error"} role="status">{msg.text}</p>}

      {list.length > 0 && (
        <section className={s.step} aria-labelledby="dai-results">
          <h4 id="dai-results" className={s.stepTitle}>{t("Resultados", "Results")}</h4>
          {editing ? (
            <DesignAiAdjust
              key={editing.id}
              candidate={editing}
              sample={p.sample}
              initial={adjustOf(editing)}
              busy={busyId === editing.id}
              preview={(a) => p.preview(editing.id, a)}
              onSave={(a) => onSave(editing.id, a)}
              onCancel={() => setAdjusting(null)}
            />
          ) : (
            <div className={s.grid}>
              {list.map((c) => (
                <DesignAiCard
                  key={c.id}
                  c={c}
                  preview={previews[c.id] === "none" ? undefined : previews[c.id]}
                  previewDone={c.id in previews}
                  shapeLabel={SHAPE_LABEL[c.shape]}
                  parentName={parentName(c.parentId)}
                  busy={busyId === c.id}
                  onUse={() => onSave(c.id)}
                  onAdjust={() => setAdjusting(c.id)}
                  onDiscard={() => onDiscard(c.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {p.models.length > 0 && p.masters.length > 0 && (
        <MoreShapes masters={p.masters} models={p.models} shapeLabel={SHAPE_LABEL} cap={p.cap} pending={pending} run={run} />
      )}
    </div>
  );
}

const adjustOf = (c: MasterCandidate): AdjustState => ({
  photoBox: c.areas!.photoBox,
  textBox: c.areas!.textBox,
  logoBox: c.areas!.logoBox,
  ink: c.ink ?? "claro",
  textAlign: c.areas!.textAlign,
});

/** Paso 2: las otras formas con el mismo estilo (el diseño guardado va como referencia a los modelos que la aceptan). */
function MoreShapes({ masters, models, shapeLabel, cap, pending, run }: { masters: MasterTemplateInfo[]; models: PanelModel[]; shapeLabel: Record<MasterShape, string>; cap: number; pending: boolean; run: (i: { models: string[]; shapes: string[]; parentId?: string }) => void }) {
  const { t } = useT();
  const [parentId, setParentId] = useState(masters[0].id);
  const parent = masters.find((m) => m.id === parentId) ?? masters[0];
  const missing = MASTER_SHAPES.filter((sh) => !parent.shapes.includes(sh));
  const [shapes, setShapes] = useState<MasterShape[]>(missing);
  const [confirm, setConfirm] = useState(false);
  const model = models.find((m) => m.id === parent.model) ?? models.find((m) => m.styleRef) ?? models[0];
  const total = Math.round(shapes.reduce((a, sh) => a + model.usd[sh], 0) * 100) / 100;
  const money = (v: number) => `US$${v.toFixed(2)}`;
  const choose = (id: string) => {
    const next = masters.find((m) => m.id === id) ?? masters[0];
    setParentId(next.id);
    setShapes(MASTER_SHAPES.filter((sh) => !next.shapes.includes(sh)));
    setConfirm(false);
  };
  return (
    <section className={s.step} aria-labelledby="dai-step2">
      <h4 id="dai-step2" className={s.stepTitle}>
        <span className={s.num}>2</span> {t("Hacer más con este estilo", "Make more in this style")}
      </h4>
      <p className="small muted">{t("Crea las otras formas (vertical e historia) con el mismo estilo, para que tu marca se vea igual en todas las redes.", "Create the other shapes (portrait and story) in the same style, so your brand looks the same on every network.")}</p>
      {masters.length > 1 && (
        <label className="stack" style={{ gap: 4 }}>
          <span className="lbl">{t("Diseño maestro", "Master design")}</span>
          <select className="field" value={parentId} onChange={(e) => choose(e.target.value)}>
            {masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      )}
      <div className={s.more}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={parent.imageUrl} alt={t(`Diseño maestro ${parent.name}`, `Master design ${parent.name}`)} className={s.moreThumb} />
        <div className="stack" style={{ gap: 8, minWidth: 0 }}>
          <strong className={s.wrapText}>{parent.name}</strong>
          <span className="small muted">{t("Ya tiene:", "Already has:")} {parent.shapes.map((sh) => shapeLabel[sh]).join(", ")}</span>
          {missing.length ? (
            <>
              <div className={s.chips}>
                {missing.map((sh) => (
                  <label key={sh} className={shapes.includes(sh) ? `${s.chip} ${s.on}` : s.chip}>
                    <input type="checkbox" checked={shapes.includes(sh)} onChange={() => { setShapes((cur) => (cur.includes(sh) ? cur.filter((x) => x !== sh) : [...cur, sh])); setConfirm(false); }} />
                    {shapeLabel[sh]}
                  </label>
                ))}
              </div>
              <span className="small">
                {t(`Con ${model.name}`, `With ${model.name}`)}
                {!model.styleRef && t(" (este modelo no acepta imagen de referencia: se le describe el estilo)", " (this model doesn't take a reference image: the style is described)")} · ~{money(total)}
              </span>
              {pending ? null : confirm ? (
                <div className={s.confirm}>
                  <span className="small">{t(`Se cobrarán ~${money(total)}. ¿Seguimos?`, `About ${money(total)} will be charged. Continue?`)}</span>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="btn on" onClick={() => { setConfirm(false); run({ models: [model.id], shapes, parentId: parent.id }); }}>{t("Sí, crear", "Yes, create")}</button>
                    <button type="button" className="btn" onClick={() => setConfirm(false)}>{t("Cancelar", "Cancel")}</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn outline" disabled={!shapes.length || total > cap} onClick={() => setConfirm(true)} style={{ alignSelf: "flex-start" }}>
                  {t("Crear las otras formas", "Create the other shapes")}
                </button>
              )}
            </>
          ) : (
            <span className="pill good">{t("Ya tiene las tres formas", "It already has all three shapes")}</span>
          )}
        </div>
      </div>
    </section>
  );
}
