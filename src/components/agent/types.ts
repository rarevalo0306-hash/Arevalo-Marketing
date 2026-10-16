import type { Settings, Context } from "@/lib/agent/schema";
import type { TeamSnapshot } from "@/lib/agent/team-view";
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
  /** `pausedAt`: since when everything is paused; `tickAt`: the worker's last minute tick (both null until they happen). */
  settings: (Settings & { revision: number; pausedAt: string | null; tickAt: string | null }) | null;
  /** The recent runs, without the pieces of a team request (those are in `team`). */
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
  /** The team's runs and agents; null while the business has no workspace yet. */
  team: TeamSnapshot | null;
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
