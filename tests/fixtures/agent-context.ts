// Contextos de encargo para las pruebas de los agentes: uno pequeño y uno con todo al máximo de lo que acepta `boundedContext`.
import type { Context } from "@/lib/agent/schema";

export const context = (extra: Record<string, unknown> = {}): Context =>
  ({
    business: {
      id: "b1",
      name: "Techos Miami",
      website: "https://mio.com",
      aiProfile: "Reparamos techos.",
      brandVoice: "",
      study: { a: 1 },
      studyAt: null,
      timezone: "America/New_York",
      color: "#000",
      logoUrl: "",
      brandIdentity: null,
      seoKeywords: [],
    },
    industry: { key: "general", name: "General", geography: "US", audience: "", focus: [] },
    revision: 1,
    capturedAt: "2026-10-16T12:00:00.000Z",
    objective: "Más llamadas",
    memory: "",
    knowledge: [],
    connections: [],
    campaigns: [],
    posts: [],
    tools: [],
    messages: [],
    ...extra,
  }) as Context;

const FUTURE = new Date(Date.now() + 90 * 86400000).toISOString();

/** Every part of the context as big as the server lets it be (and in characters that take 2 or 3 bytes). */
export const maxContext = (extra: Record<string, unknown> = {}): Context => {
  const base = context();
  return context({
    business: {
      ...base.business,
      aiProfile: "ñ".repeat(4000),
      study: { text: "é".repeat(9000), more: "x".repeat(2000) },
      brandIdentity: { note: "i".repeat(3000) },
    },
    industry: { key: "general", name: "General", geography: "US", audience: "a".repeat(300), focus: Array.from({ length: 8 }, (_, i) => "foco ".repeat(10) + i) },
    objective: "o".repeat(1500),
    memory: "z".repeat(6000),
    knowledge: Array.from({ length: 30 }, (_, i) => ({
      fact: `hecho ${i} `.padEnd(1000, "f"),
      url: "https://example.com/" + "u".repeat(450),
      checkedAt: "2026-10-01T00:00:00.000Z",
      expiresAt: FUTURE,
      geography: "US",
    })),
    campaigns: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: "Campaña ".padEnd(100, "c"), status: "active", mode: "auto" })),
    posts: Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      status: "scheduled",
      text: "p".repeat(300),
      createdAt: "2026-10-01T00:00:00.000Z",
      targets: ["facebook", "instagram", "x"].map((channel) => ({ channel, status: "queued", externalUrl: "https://example.com/" + "t".repeat(200) })),
    })),
    tools: Array.from({ length: 40 }, (_, i) => ({ name: `herramienta ${i}`, href: `/herramientas/${"h".repeat(60)}${i}`, execution: "link" })),
    messages: Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "m".repeat(1000) })),
    news: { id: "n1", title: "t".repeat(250), summary: "s".repeat(1500), source: "https://fuente.example/a", evidence: [{ excerpt: "e".repeat(9000) }], revision: 3 },
    ...extra,
  });
};
