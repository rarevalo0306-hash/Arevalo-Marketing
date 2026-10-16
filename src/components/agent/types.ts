import type { Settings, Context } from "@/lib/agent/schema";
export type RunView = {
  id: string;
  kind: string;
  prompt: string;
  status: string;
  stage: number;
  error: string;
  result: Record<string, unknown> | null;
  chargedCents: number;
  reservedCents: number;
  createdAt: string;
  steps: {
    name: string;
    specialist: string;
    status: string;
    output: Record<string, unknown> | null;
    error: string;
    chargedCents: number;
  }[];
};
export type NewsView = {
  id: string;
  title: string;
  canonicalUrl: string;
  source: string;
  status: string;
  summary: string;
  publishedAt: string | null;
  retrievedAt: string;
  revision: number;
};
export type Snapshot = {
  business: Context["business"];
  industry: Context["industry"];
  settings: (Settings & { revision: number }) | null;
  runs: RunView[];
  messages: {
    id: string;
    role: string;
    text: string;
    runId: string | null;
    createdAt: string;
  }[];
  news: NewsView[];
  budget: { chargedCents: number; reservedCents: number; posts: number } | null;
  aiReady: boolean;
  tools: Context["tools"];
  connections: string[];
  posts: Context["posts"];
  campaigns: Context["campaigns"];
  capturedAt: string;
};
export const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  mode: "auto",
  allowPublish: false,
  industry: "general",
  objective: "",
  memory: "",
  knowledge: [],
  sources: [],
  channels: [],
  dailyBudgetCents: 0,
  runBudgetCents: 0,
  maxPostsPerDay: 3,
  radarEnabled: false,
  radarHours: 24,
  teamMode: false,
  dailyHour: 7,
  agentModels: {},
  modelPrices: {},
  allowSocial: true,
  allowWebArticles: true,
};
