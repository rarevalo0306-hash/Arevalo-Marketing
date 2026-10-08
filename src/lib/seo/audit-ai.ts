// Lo que la auditoría revisa para las búsquedas con IA: robots.txt (qué robots de IA quedan bloqueados, y si se bloquea
// a Google entero) y el archivo /llms.txt. Puro: se prueba con textos de ejemplo.

export type AiBot = { ua: string; owner: string; purpose: "search" | "training" };

/** Robots de IA conocidos. "search" = buscan y citan páginas para responder; "training" = leen para entrenar. */
export const AI_BOTS: AiBot[] = [
  { ua: "OAI-SearchBot", owner: "ChatGPT", purpose: "search" },
  { ua: "ChatGPT-User", owner: "ChatGPT", purpose: "search" },
  { ua: "PerplexityBot", owner: "Perplexity", purpose: "search" },
  { ua: "Claude-User", owner: "Claude", purpose: "search" },
  { ua: "Claude-SearchBot", owner: "Claude", purpose: "search" },
  { ua: "GPTBot", owner: "OpenAI", purpose: "training" },
  { ua: "ClaudeBot", owner: "Anthropic", purpose: "training" },
  { ua: "Google-Extended", owner: "Google (Gemini)", purpose: "training" },
  { ua: "Applebot-Extended", owner: "Apple", purpose: "training" },
];

type Rule = { allow: boolean; path: string };
export type RobotsGroup = { agents: string[]; rules: Rule[] };

/** Lee robots.txt en grupos (User-agent + reglas), como lo hace Google. */
export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (current) current.rules.push({ allow: key === "allow", path: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

/** Las reglas que aplican a un robot: las de su grupo (si lo nombran) o las de «*». */
export function rulesFor(groups: RobotsGroup[], ua: string): Rule[] {
  const name = ua.toLowerCase();
  const own = groups.filter((g) => g.agents.includes(name));
  const pick = own.length ? own : groups.filter((g) => g.agents.includes("*"));
  return pick.flatMap((g) => g.rules);
}

/** ¿Una regla de robots.txt (con * y $) cubre esta ruta? */
function matches(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

/** ¿El robot puede leer esta ruta? Gana la regla más larga; si empatan, gana Allow. */
export function isAllowed(rules: Rule[], path: string): boolean {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!matches(r.path, path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow && !best.allow)) best = r;
  }
  return !best || best.allow;
}

/** Bloqueado = no puede leer ni el inicio ni una página cualquiera. */
const blockedSite = (rules: Rule[]) => !isAllowed(rules, "/") && !isAllowed(rules, "/pagina-de-ejemplo");

export type RobotsAi = {
  /** Google (Googlebot) no puede leer el sitio. */
  blocksGoogle: boolean;
  /** Robots de búsqueda con IA bloqueados (los nombres, ej. «PerplexityBot»). */
  searchBlocked: string[];
  /** Robots que entrenan IAs bloqueados. */
  trainingBlocked: string[];
};

export function robotsAiCheck(text: string): RobotsAi {
  const groups = parseRobots(text);
  const blocked = AI_BOTS.filter((b) => blockedSite(rulesFor(groups, b.ua)));
  return {
    blocksGoogle: blockedSite(rulesFor(groups, "Googlebot")),
    searchBlocked: blocked.filter((b) => b.purpose === "search").map((b) => b.ua),
    trainingBlocked: blocked.filter((b) => b.purpose === "training").map((b) => b.ua),
  };
}

export type LlmsTxtState = { status: "ok" } | { status: "missing"; why: "not-found" | "html" } | { status: "invalid"; problems: ("empty" | "no-title" | "no-summary" | "no-links")[] };

/**
 * Revisa /llms.txt (https://llmstxt.org): debe ser texto (no una página HTML), empezar con «# Nombre», tener un
 * resumen que empieza con «>» y enlaces en Markdown. `status` = código HTTP; `type` = content-type.
 */
export function checkLlmsTxt(status: number, type: string, text: string): LlmsTxtState {
  if (status === 404 || status === 410 || status >= 400) return { status: "missing", why: "not-found" };
  const body = text.replace(/^﻿/, "").trim();
  // Muchos sitios devuelven su página normal (o «no encontrada») con código 200: eso no es un llms.txt.
  if (/html/i.test(type) || /^<(!doctype|html|head|body)\b/i.test(body)) return { status: "missing", why: "html" };
  if (!body) return { status: "invalid", problems: ["empty"] };
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const problems: ("no-title" | "no-summary" | "no-links")[] = [];
  if (!/^#\s+\S/.test(lines[0] ?? "")) problems.push("no-title");
  if (!lines.some((l) => /^>\s*\S/.test(l))) problems.push("no-summary");
  if (!/\[[^\]]+\]\([^)\s]+\)/.test(body)) problems.push("no-links");
  // El resumen («>») se recomienda pero no es obligatorio: solo se reporta si además falta algo importante.
  return problems.some((p) => p !== "no-summary") ? { status: "invalid", problems } : { status: "ok" };
}
