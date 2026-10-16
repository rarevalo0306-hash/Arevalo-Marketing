// Lo que se manda a la IA, acotado: el contexto del encargo, los datos sueltos de un agente y el presupuesto de bytes de la llamada.
// Módulo hoja: solo el tipo `Context`, para que cualquier agente lo use sin ciclos.
import type { Context } from "./schema";

/** One line of plain text cut to `max`: text from websites, news and searches is data, so it carries no line breaks or control characters. */
export const oneLine = (value: unknown, max: number): string =>
  String(value ?? "")
    .replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, " ")
    .trim()
    .slice(0, max);

/** A value as it is when its JSON fits in `max` characters; else its first `max` characters, as a string. Nothing (undefined, null) stays nothing. */
export function boundedJson(value: unknown, max: number): unknown {
  if (value === undefined || value === null) return undefined;
  const json = JSON.stringify(value);
  if (json === undefined) return undefined;
  return json.length <= max ? value : json.slice(0, max);
}

export function boundedContext(c: Context) {
  return {
    ...c,
    business: {
      ...c.business,
      aiProfile: c.business.aiProfile.slice(0, 3000),
      study: JSON.stringify(c.business.study).slice(0, 5000),
    },
    knowledge: c.knowledge
      .filter((k) => Date.parse(k.expiresAt) > Date.now())
      .slice(0, 12),
    messages: c.messages.slice(-6),
    posts: c.posts.slice(0, 6),
    tools: c.tools.map((t) => ({
      name: t.name,
      href: t.href,
      execution: t.execution,
    })),
  };
}
export type BoundedContext = ReturnType<typeof boundedContext>;

/** The run's context without keys an agent sends on its own and bounded, which `boundedContext` would otherwise carry along (`...c`). */
export function contextWithout(c: Context, ...keys: ("news" | "signals" | "piece")[]): Context {
  const copy: Record<string, unknown> = { ...c };
  for (const key of keys) delete copy[key];
  return copy as Context;
}

/** The few fields an agent needs to know whose business this is. No study, knowledge, posts, messages, memory or tool links. */
export function slimContext(c: Context, aiProfileMax = 800) {
  return {
    business: {
      name: c.business.name,
      website: c.business.website,
      aiProfile: c.business.aiProfile.slice(0, aiProfileMax),
    },
    industry: c.industry,
    objective: c.objective,
  };
}
export type SlimContext = ReturnType<typeof slimContext>;

// ---------- The size of a call ----------
// `meteredAsk` refuses a call over MAX_PROMPT_BYTES (32,000), and it does so after the step has begun, so the run would
// end uncertain with the reservation held. An agent therefore measures what it is about to send and trims it first.

/** Where an agent keeps its prompt (system text + schema + payload): 4 KB under the 32,000 bytes `meteredAsk` allows. */
export const PROMPT_BUDGET = 28_000;

/** One step of trimming: the payload a little smaller, or null when this part has nothing left to give. */
export type Shrink<T> = (payload: T) => T | null;

/**
 * Trims a payload until it fits `budget` bytes. The shrinks are tried in order, lowest value first: each one is applied
 * step by step while the payload is still over, and the next one only starts when that one has nothing left. A payload
 * that already fits comes back untouched (same object, `steps` 0). If every shrink is spent and it is still over, `fits`
 * is false and the payload is the smallest one reached.
 * - `bytes` must measure the whole call the way `meteredAsk` does: use `promptBytes(schema, system, payload)`.
 * - Nothing is cut that the shrinks do not name, so the parts that must never go (the request, a budget limit) are simply not listed.
 */
export function fitPayload<T>(
  payload: T,
  bytes: (payload: T) => number,
  shrinks: readonly Shrink<T>[],
  budget: number = PROMPT_BUDGET,
): { payload: T; bytes: number; fits: boolean; steps: number } {
  let size = bytes(payload);
  let steps = 0;
  for (const shrink of shrinks) {
    // A shrink gives up by returning null; the count is only a guard against one that never does.
    for (let i = 0; i < 2000 && size > budget; i++) {
      const next = shrink(payload);
      if (next === null) break;
      payload = next;
      size = bytes(payload);
      steps += 1;
    }
    if (size <= budget) break;
  }
  return { payload, bytes: size, fits: size <= budget, steps };
}

/** A shrink that drops one element of a list per step: the last one (`end`) or the first one (`start`). */
export function shrinkList<T, E>(
  read: (payload: T) => readonly E[] | undefined,
  write: (payload: T, list: E[]) => T,
  from: "start" | "end" = "end",
): Shrink<T> {
  return (payload) => {
    const list = read(payload);
    if (!list || !list.length) return null;
    return write(payload, from === "end" ? list.slice(0, -1) : list.slice(1));
  };
}

/** A shrink that cuts a text to each of `sizes` in turn (largest first; end with 0 to let it go). */
export function shrinkText<T>(
  read: (payload: T) => string | undefined,
  write: (payload: T, text: string) => T,
  sizes: readonly number[],
): Shrink<T> {
  return (payload) => {
    const text = read(payload);
    if (text === undefined) return null;
    const size = sizes.find((n) => n < text.length);
    return size === undefined ? null : write(payload, text.slice(0, size));
  };
}

/** Runs a shrink of a part of the payload (`payload[key]`) as a shrink of the whole. */
export function shrinkKey<T, K extends keyof T>(key: K, shrink: Shrink<T[K]>): Shrink<T> {
  return (payload) => {
    const next = shrink(payload[key]);
    return next === null ? null : { ...payload, [key]: next };
  };
}

/** The shrinks for a `boundedContext`, lowest value first: tool links, news evidence, knowledge, posts, old messages, study, memory, campaigns, profile. */
export function contextShrinks(): Shrink<BoundedContext>[] {
  type C = BoundedContext;
  return [
    shrinkList<C, C["tools"][number]>((c) => c.tools, (c, tools) => ({ ...c, tools })),
    (c) =>
      c.news && JSON.stringify(c.news.evidence ?? []) !== "[]"
        ? { ...c, news: { ...c.news, evidence: [] } }
        : null,
    shrinkList<C, C["knowledge"][number]>((c) => c.knowledge, (c, knowledge) => ({ ...c, knowledge })),
    shrinkList<C, C["posts"][number]>((c) => c.posts, (c, posts) => ({ ...c, posts })),
    shrinkList<C, C["messages"][number]>((c) => c.messages, (c, messages) => ({ ...c, messages }), "start"),
    shrinkText<C>((c) => c.business.study, (c, study) => ({ ...c, business: { ...c.business, study } }), [1000, 0]),
    shrinkText<C>((c) => c.memory, (c, memory) => ({ ...c, memory }), [1500, 0]),
    shrinkList<C, C["campaigns"][number]>((c) => c.campaigns, (c, campaigns) => ({ ...c, campaigns })),
    shrinkText<C>((c) => c.business.aiProfile, (c, aiProfile) => ({ ...c, business: { ...c.business, aiProfile } }), [800, 200]),
  ];
}
