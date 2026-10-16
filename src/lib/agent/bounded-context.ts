// Lo que se manda a la IA, acotado: el contexto del encargo y los datos sueltos de un agente. Módulo hoja: solo el tipo `Context`,
// para que cualquier agente lo use sin ciclos.
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
