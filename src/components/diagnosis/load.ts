// Diagnóstico guiado (servidor): lee lo que ya se sabe del negocio, el estado guardado (SeoReport "diagnosis")
// y arma lo que ve el dueño. Lo usan la página /b/<id>/diagnostico, el aviso del Resumen y las acciones.
import type { Prisma } from "@prisma/client";
import { aiEnabled, researchProvider } from "@/lib/ai";
import { db } from "@/lib/db";
import {
  type DiagnosisFacts,
  type DiagnosisPrices,
  type DiagnosisState,
  parseDiagnosisState,
  type StepId,
  type StepView,
  stepViews,
} from "@/lib/diagnosis";
import { dataForSeoEnabled, readTrackedKeywords, readZones } from "@/lib/seo/dataforseo";
import { MAX_COMPETITORS, PROFILE_COST, reviewsCostEstimate } from "@/lib/seo/gbp-shared";
import { MAP_COST_PER_POINT } from "@/lib/seo/maprank-shared";
import { readMapPlace } from "@/lib/seo/maprank";
import { ONPAGE_COST_PER_PAGE, ONPAGE_MAX_PAGES } from "@/lib/seo/onpage";
import { RANK_COST_PER_KEYWORD } from "@/lib/seo/rank";
import { questionsFromStudy, customerLang, readVisibilityReport, visibilityProviders } from "@/lib/seo/visibility";
import { readInput, readStudy } from "@/lib/study-shape";

/**
 * Precios aproximados (USD). Los de DataForSEO salen de cada módulo; los de las IAs son estimados de una consulta
 * con búsqueda en internet (Gemini/Claude/ChatGPT cobran entre 1 y 3.5 centavos por búsqueda).
 */
export const DIAGNOSIS_PRICES: DiagnosisPrices = {
  rankPerKeyword: RANK_COST_PER_KEYWORD,
  // Competencia (DataForSEO Labs): «unos US$0.05 a 0.10», se toma lo más alto.
  competitors: 0.1,
  onpagePage: ONPAGE_COST_PER_PAGE,
  onpagePages: ONPAGE_MAX_PAGES,
  mapPoints: 25,
  mapPoint: MAP_COST_PER_POINT,
  profile: PROFILE_COST,
  profileCompetitors: MAX_COMPETITORS,
  reviews: reviewsCostEstimate(),
  studyResearch: 0.05,
  studyPlain: 0.01,
  aiAnswer: 0.03,
  aiQuestions: 0.005,
};

/** El mapa de calor del diagnóstico: 5×5 puntos a 1 km. */
export const DIAGNOSIS_MAP = { size: 5, spacingKm: 1 } as const;

/** Qué reporte deja cada paso (para la fecha de lo último y lo que costó). */
export const STEP_KINDS: Partial<Record<StepId, string[]>> = {
  competitors: ["competitors"],
  audit: ["audit", "onpage"],
  rank: ["rank"],
  maps: ["maprank"],
  gbp: ["gbp", "reviews"],
  ai: ["ai"],
  plan: ["plan"],
};

const BUSINESS = {
  id: true,
  name: true,
  color: true,
  website: true,
  aiProfile: true,
  aiText: true,
  study: true,
  studyInput: true,
  studyAt: true,
  seoKeywords: true,
  seoLocations: true,
  seoLocationCode: true,
  seoLocationName: true,
  seoMapPlace: true,
} as const;

const costOf = (data: unknown): number | null => {
  const c = data && typeof data === "object" ? (data as { cost?: unknown }).cost : null;
  return typeof c === "number" && Number.isFinite(c) ? c : null;
};

/** Lo que ya se sabe del negocio y lo último hecho de cada paso. */
export async function loadFacts(businessId: string) {
  const b = await db.business.findUnique({ where: { id: businessId }, select: BUSINESS });
  if (!b) return null;
  const kinds = [...new Set(Object.values(STEP_KINDS).flat())] as string[];
  // El último de cada tipo (una consulta por tipo, en paralelo).
  // La revisión de la página es grande y no trae costo: de ella solo hace falta la fecha.
  const rows: ({ kind: string; createdAt: Date; data?: unknown } | null)[] = await Promise.all(
    kinds.map((kind) =>
      kind === "audit"
        ? db.seoReport.findFirst({ where: { businessId, kind }, orderBy: { createdAt: "desc" }, select: { kind: true, createdAt: true } })
        : db.seoReport.findFirst({ where: { businessId, kind }, orderBy: { createdAt: "desc" }, select: { kind: true, createdAt: true, data: true } }),
    ),
  );
  const latest = new Map(rows.filter((r): r is NonNullable<typeof r> => !!r).map((r) => [r.kind, r]));
  const setupRow = await db.seoReport.findFirst({ where: { businessId, kind: "setup" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });

  const last: DiagnosisFacts["last"] = {};
  const input = readInput(b.studyInput);
  const study = readStudy(b.study);
  // Respuestas con lo que vende = ya se leyó la web (o se llenó a mano); la fecha no se guarda.
  // Si ya hay estudio, también: salió de lo que se sabía del negocio.
  if (input?.services.trim() || study) last.web = { at: null };
  if (study) last.study = { at: b.studyAt?.toISOString() ?? null };
  const zones = readZones(b.seoLocations, b.seoLocationCode, b.seoLocationName);
  const keywords = readTrackedKeywords(b.seoKeywords);
  if (zones.length && keywords.length) last.setup = { at: setupRow?.createdAt.toISOString() ?? null };
  for (const [step, list] of Object.entries(STEP_KINDS) as [StepId, string[]][]) {
    // La fecha es la del reporte principal del paso (la revisión de la página, el perfil); el costo suma los dos.
    const main = latest.get(list[0]);
    if (!main) continue;
    const cost = list.map((k) => costOf(latest.get(k)?.data)).reduce<number | null>((s, c) => (c === null ? s : (s ?? 0) + c), null);
    last[step] = { at: main.createdAt.toISOString(), cost };
  }

  const aiRow = latest.get("ai");
  const lastQuestions = aiRow ? (readVisibilityReport(aiRow.data)?.questions.length ?? 0) : 0;
  const questions = lastQuestions || (study ? questionsFromStudy(study, customerLang(b) ?? "es").length : 0);

  const facts: DiagnosisFacts = {
    website: Boolean(b.website.trim()),
    profile: Boolean(b.aiProfile.trim()),
    input: Boolean(input?.services.trim()),
    study: Boolean(study),
    zones: zones.length,
    keywords: keywords.length,
    place: Boolean(readMapPlace(b.seoMapPlace)),
    dfs: dataForSeoEnabled(),
    aiProviders: aiEnabled() ? visibilityProviders().length : 0,
    research: Boolean(researchProvider(b.aiText)),
    questions,
    last,
  };
  return { business: b, facts };
}

/** El estado guardado (la fila más nueva de "diagnosis"). */
export async function loadState(businessId: string): Promise<{ rowId: string | null; state: DiagnosisState }> {
  const row = await db.seoReport.findFirst({ where: { businessId, kind: "diagnosis" }, orderBy: { createdAt: "desc" }, select: { id: true, data: true } });
  return { rowId: row?.id ?? null, state: parseDiagnosisState(row?.data ?? null) };
}

/** Guarda el estado en la misma fila (se crea la primera vez). Devuelve el id de la fila. */
export async function storeState(businessId: string, rowId: string | null, state: DiagnosisState): Promise<string> {
  const data = state as unknown as Prisma.InputJsonValue;
  if (rowId) {
    const updated = await db.seoReport.updateMany({ where: { id: rowId, businessId, kind: "diagnosis" }, data: { data } });
    if (updated.count) return rowId;
  }
  const row = await db.seoReport.create({ data: { businessId, kind: "diagnosis", data }, select: { id: true } });
  return row.id;
}

export type DiagnosisView = {
  business: { id: string; name: string; color: string; website: string };
  facts: DiagnosisFacts;
  state: DiagnosisState;
  steps: StepView[];
  prices: DiagnosisPrices;
  /** El servidor sabe cuándo es "ahora" (para fechas y lo viejo). */
  now: string;
};

/** Todo lo que necesita la pantalla del diagnóstico. */
export async function loadDiagnosis(businessId: string): Promise<DiagnosisView | null> {
  const [loaded, { state }] = await Promise.all([loadFacts(businessId), loadState(businessId)]);
  if (!loaded) return null;
  const { business: b, facts } = loaded;
  const now = Date.now();
  return {
    business: { id: b.id, name: b.name, color: b.color, website: b.website },
    facts,
    state,
    steps: stepViews(state, facts, now),
    prices: DIAGNOSIS_PRICES,
    now: new Date(now).toISOString(),
  };
}
