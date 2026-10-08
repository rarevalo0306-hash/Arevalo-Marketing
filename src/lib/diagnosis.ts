// Diagnóstico guiado: los 10 pasos en orden, el estado guardado (SeoReport "diagnosis") y las reglas para seguir donde
// quedó, saber qué está viejo y cuánto cuesta lo que falta. Sin servidor ni base de datos: se usa en el navegador y en
// el servidor (src/app/actions-diagnosis.ts) y se prueba en tests/diagnosis.test.ts.

export type Bi = { es: string; en: string };

export const STEP_IDS = ["web", "study", "setup", "competitors", "audit", "rank", "maps", "gbp", "ai", "plan"] as const;
export type StepId = (typeof STEP_IDS)[number];
export const isStepId = (v: unknown): v is StepId => typeof v === "string" && (STEP_IDS as readonly string[]).includes(v);

export const STEP_STATUSES = ["pending", "running", "done", "skipped", "needs-you", "error"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/**
 * Lo que necesita un paso antes de correr. `website` lo pone el dueño en Ajustes; `info` = algo del negocio
 * (web, perfil o respuestas); zonas y palabras salen del paso 3 y el negocio en Google Maps del paso 7.
 */
export type Need = "website" | "info" | "zones" | "keywords" | "place" | "dfs" | "ai";
const NEED_FROM: Record<Need, StepId | null> = { website: null, info: "web", zones: "setup", keywords: "setup", place: "maps", dfs: null, ai: null };

/** free = no gasta (o casi nada, como leer la web); ai = usa una IA de pago; dfs = DataForSEO (pago por uso). */
export type CostKind = "free" | "ai" | "dfs";

export type StepDef = {
  id: StepId;
  n: number;
  title: Bi;
  what: Bi;
  why: Bi;
  cost: CostKind;
  needs: Need[];
  /** Días para que el resultado se considere viejo (null = no se vence). */
  staleDays: number | null;
  /** Dónde se ve el resultado: /b/<id> + esto. */
  path: string;
};

export const STEPS: readonly StepDef[] = [
  {
    id: "web",
    n: 1,
    title: { es: "Leer tu página web", en: "Read your website" },
    what: {
      es: "La IA lee tu página (inicio, servicios, contacto) y anota qué vendes, dónde trabajas y a quién le vendes.",
      en: "The AI reads your website (home, services, contact) and notes what you sell, where you work and who you sell to.",
    },
    why: { es: "Así no tienes que escribirlo tú, y todo lo demás sale de aquí.", en: "So you don't have to type it, and everything else builds on it." },
    cost: "free",
    needs: ["ai"],
    staleDays: 180,
    path: "/estudio",
  },
  {
    id: "study",
    n: 2,
    title: { es: "Estudio del negocio", en: "Business study" },
    what: {
      es: "La IA estudia tu negocio y tu mercado: a quién venderle, qué busca la gente en Google y qué anunciar.",
      en: "The AI studies your business and your market: who to sell to, what people search on Google and what to advertise.",
    },
    why: { es: "Es la base de tus textos, campañas y palabras clave.", en: "It's the base for your posts, campaigns and keywords." },
    cost: "ai",
    needs: ["ai", "info"],
    staleDays: 180,
    path: "/estudio",
  },
  {
    id: "setup",
    n: 3,
    title: { es: "Zonas y palabras clave", en: "Areas and keywords" },
    what: {
      es: "Te proponemos dónde están tus clientes y qué buscan en Google. Tú aceptas o quitas cada una.",
      en: "We propose where your customers are and what they search on Google. You accept or remove each one.",
    },
    why: {
      es: "Con esto medimos tu lugar en Google sin gastar en búsquedas que no te sirven.",
      en: "This lets us measure your Google ranking without paying for searches that don't help you.",
    },
    cost: "free",
    needs: [],
    staleDays: null,
    path: "/seo?tab=ajustes",
  },
  {
    id: "competitors",
    n: 4,
    title: { es: "Tu competencia", en: "Your competitors" },
    what: {
      es: "Buscamos quién te gana en Google y en qué búsquedas salen ellos y tú no.",
      en: "We find who beats you on Google and which searches they show up for and you don't.",
    },
    why: { es: "Para saber contra quién compites y qué te falta.", en: "So you know who you compete with and what you're missing." },
    cost: "dfs",
    needs: ["dfs", "website", "zones"],
    staleDays: 30,
    path: "/seo?tab=competencia",
  },
  {
    id: "audit",
    n: 5,
    title: { es: "Revisión de tu página", en: "Website check-up" },
    what: {
      es: "Revisamos tu página como lo hace Google: errores, velocidad, títulos y textos de tus páginas principales.",
      en: "We check your website the way Google does: errors, speed, titles and texts of your main pages.",
    },
    why: {
      es: "Lo que está roto en tu página te baja en Google aunque hagas todo lo demás bien.",
      en: "Anything broken on your site pulls you down on Google even if you do everything else right.",
    },
    cost: "free",
    needs: ["website"],
    staleDays: 30,
    path: "/seo?tab=web",
  },
  {
    id: "rank",
    n: 6,
    title: { es: "Posiciones en Google", en: "Google rankings" },
    what: {
      es: "Vemos en qué lugar sales en Google con las palabras clave que aceptaste, en cada zona.",
      en: "We see where you show up on Google for the keywords you accepted, in each area.",
    },
    why: { es: "Es el punto de partida para medir si vas mejorando.", en: "It's the starting point to measure whether you're improving." },
    cost: "dfs",
    needs: ["dfs", "website", "zones", "keywords"],
    staleDays: 7,
    path: "/seo?tab=google",
  },
  {
    id: "maps",
    n: 7,
    title: { es: "Google Maps", en: "Google Maps" },
    what: {
      es: "Eliges tu negocio en Google Maps y hacemos un mapa de calor: en qué partes de tu zona sales entre los 3 primeros.",
      en: "You pick your business on Google Maps and we make a heatmap: where in your area you show up in the top 3.",
    },
    why: { es: "Muchos clientes cercanos llaman directo desde el mapa.", en: "Many nearby customers call straight from the map." },
    cost: "dfs",
    needs: ["dfs", "zones", "keywords", "place"],
    staleDays: 30,
    path: "/seo?tab=local",
  },
  {
    id: "gbp",
    n: 8,
    title: { es: "Tu perfil de Google y reseñas", en: "Your Google profile and reviews" },
    what: {
      es: "Revisamos tu perfil de Google (fotos, horario, categoría) y traemos tus reseñas más nuevas.",
      en: "We check your Google profile (photos, hours, category) and bring in your newest reviews.",
    },
    why: { es: "Un perfil completo y reseñas contestadas te suben en el mapa.", en: "A complete profile and answered reviews lift you on the map." },
    cost: "dfs",
    needs: ["dfs", "place"],
    staleDays: 30,
    path: "/seo?tab=local",
  },
  {
    id: "ai",
    n: 9,
    title: { es: "Visibilidad en IAs", en: "AI visibility" },
    what: {
      es: "Preguntamos a ChatGPT, Gemini y Claude lo que preguntan tus clientes y vemos si te recomiendan.",
      en: "We ask ChatGPT, Gemini and Claude what your customers ask and see whether they recommend you.",
    },
    why: { es: "Cada vez más gente le pregunta a una IA antes de buscar en Google.", en: "More and more people ask an AI before searching on Google." },
    cost: "ai",
    needs: ["ai", "info"],
    staleDays: 30,
    path: "/seo?tab=ia",
  },
  {
    id: "plan",
    n: 10,
    title: { es: "Tu plan de acción", en: "Your action plan" },
    what: {
      es: "Juntamos todo lo encontrado en una sola lista de tareas, de lo que más ayuda a lo que menos.",
      en: "We put everything we found into one task list, from what helps most to what helps least.",
    },
    why: { es: "Así sabes qué hacer primero, sin perderte en reportes.", en: "So you know what to do first, without getting lost in reports." },
    cost: "free",
    needs: [],
    staleDays: null,
    path: "/seo?tab=resumen",
  },
];

export const TOTAL_STEPS = STEPS.length;
export const stepDef = (id: StepId): StepDef => STEPS.find((s) => s.id === id)!;

/** Los pasos que un paso necesita antes (por lo que le falta). Ej.: «Posiciones» necesita el paso 3. */
export function dependsOn(id: StepId): StepId[] {
  return [...new Set(stepDef(id).needs.map((n) => NEED_FROM[n]).filter((s): s is StepId => !!s && s !== id))];
}

// ---------- Lo que ya se sabe del negocio (lo arma el servidor) ----------

export type DiagnosisFacts = {
  website: boolean;
  /** Perfil para la IA (Ajustes) o respuestas del estudio guardadas. */
  profile: boolean;
  input: boolean;
  study: boolean;
  zones: number;
  keywords: number;
  place: boolean;
  /** DataForSEO conectado. */
  dfs: boolean;
  /** IAs con clave (Gemini, Claude, ChatGPT). */
  aiProviders: number;
  /** Hay una IA que investiga en internet para el estudio. */
  research: boolean;
  /** Preguntas para las IAs que ya hay (de la última revisión o del estudio). 0 = las propone la IA. */
  questions: number;
  /** Lo último que se hizo de cada paso fuera o dentro del diagnóstico (reportes guardados). */
  last: Partial<Record<StepId, { at: string | null; cost?: number | null }>>;
};

export const has = (need: Need, f: DiagnosisFacts): boolean =>
  ({
    website: f.website,
    info: f.website || f.profile || f.input,
    zones: f.zones > 0,
    keywords: f.keywords > 0,
    place: f.place,
    dfs: f.dfs,
    ai: f.aiProviders > 0,
  })[need];

export type Precheck = { status: "needs-you" | "skipped" | "error"; reason: Bi; from: StepId | null };

/**
 * ¿Se puede hacer el paso ahora? null = sí. Si no: lo tiene que hacer el dueño (needs-you), se salta porque le falta
 * algo de otro paso (skipped) o falta una clave del servidor (error, en palabras simples).
 */
export function precheck(id: StepId, f: DiagnosisFacts): Precheck | null {
  if (id === "web" && !f.website)
    return f.profile || f.input
      ? { status: "skipped", from: null, reason: { es: "No tienes página web en Ajustes: usamos lo que ya sabemos de tu negocio.", en: "There's no website in Settings: we use what we already know about your business." } }
      : {
          status: "needs-you",
          from: null,
          reason: {
            es: "Agrega la dirección de tu página web en Ajustes del negocio, o cuéntale a la IA qué vendes en tu estudio.",
            en: "Add your website address in Business settings, or tell the AI what you sell in your study.",
          },
        };
  if (id === "setup" && !(f.zones > 0 && f.keywords > 0))
    return { status: "needs-you", from: null, reason: { es: "Acepta o quita las zonas y palabras clave que te proponemos.", en: "Accept or remove the areas and keywords we propose." } };
  if (id === "maps" && f.dfs && f.zones > 0 && f.keywords > 0 && !f.place)
    return { status: "needs-you", from: null, reason: { es: "Busca tu negocio en Google Maps y elige «Este es el mío».", en: "Find your business on Google Maps and choose “This is mine”." } };
  for (const need of stepDef(id).needs) {
    if (has(need, f)) continue;
    if (need === "dfs")
      return {
        status: "error",
        from: null,
        reason: {
          es: "Este paso usa DataForSEO y todavía no está conectado (la clave va en la configuración del servidor).",
          en: "This step uses DataForSEO, which isn't connected yet (the key goes in the server settings).",
        },
      };
    if (need === "ai")
      return {
        status: "error",
        from: null,
        reason: { es: "Falta conectar una IA (la clave de Gemini, Claude o ChatGPT va en la configuración del servidor).", en: "No AI is connected yet (the Gemini, Claude or ChatGPT key goes in the server settings)." },
      };
    if (need === "website")
      return { status: "skipped", from: null, reason: { es: "Necesita la dirección de tu página web (Ajustes del negocio).", en: "Needs your website address (Business settings)." } };
    if (need === "info")
      return {
        status: "needs-you",
        from: "web",
        reason: { es: "Cuéntale a la IA qué vende tu negocio (en tu estudio) o agrega tu página web.", en: "Tell the AI what your business sells (in your study) or add your website." },
      };
    const from = NEED_FROM[need]!;
    const d = stepDef(from);
    return { status: "skipped", from, reason: { es: `Necesita el paso ${d.n} (${d.title.es}).`, en: `Needs step ${d.n} (${d.title.en}).` } };
  }
  return null;
}

// ---------- Lo guardado (SeoReport "diagnosis") ----------

export type SavedStep = {
  status: StepStatus;
  /** Cuándo terminó (o cuándo se detuvo). */
  at: string | null;
  message: string;
  /** Lo que costó (USD) o null si no se sabe. */
  cost: number | null;
  /** owner = el dueño lo saltó (no se vuelve a intentar solo). */
  by?: "owner" | "auto";
  /** Pasos de dos partes (revisión + páginas, perfil + reseñas): qué parte sigue. */
  phase?: string;
  startedAt?: string;
};

export type DiagnosisRun = {
  startedAt: string;
  finishedAt: string | null;
  /** Solo estos pasos (Rehacer / Intentar de nuevo). null = todos los que faltan. */
  only: StepId[] | null;
  /** Rehacer también lo que ya estaba hecho. */
  redoAll: boolean;
  /** Pasos que ya se hicieron (o se saltaron) en esta corrida. */
  attempted: StepId[];
  /** Lo que el dueño aceptó gastar (USD). null = solo lo gratis. */
  approved: number | null;
  spent: number;
};

export type DiagnosisState = {
  version: 1;
  startedAt: string | null;
  completedAt: string | null;
  steps: Partial<Record<StepId, SavedStep>>;
  run: DiagnosisRun | null;
};

export const emptyState = (): DiagnosisState => ({ version: 1, startedAt: null, completedAt: null, steps: {}, run: null });

const isoOrNull = (v: unknown): string | null => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ids = (v: unknown): StepId[] => (Array.isArray(v) ? [...new Set(v.filter(isStepId))] : []);

/** Lee el JSON guardado sin confiar en él: lo que no se entiende queda vacío. */
export function parseDiagnosisState(json: unknown): DiagnosisState {
  const out = emptyState();
  if (!json || typeof json !== "object" || Array.isArray(json)) return out;
  const o = json as Record<string, unknown>;
  out.startedAt = isoOrNull(o.startedAt);
  out.completedAt = isoOrNull(o.completedAt);
  const steps = o.steps && typeof o.steps === "object" ? (o.steps as Record<string, unknown>) : {};
  for (const id of STEP_IDS) {
    const s = steps[id];
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    if (!(STEP_STATUSES as readonly string[]).includes(String(r.status))) continue;
    out.steps[id] = {
      status: r.status as StepStatus,
      at: isoOrNull(r.at),
      message: typeof r.message === "string" ? r.message.slice(0, 1500) : "",
      cost: num(r.cost),
      ...(r.by === "owner" || r.by === "auto" ? { by: r.by } : {}),
      ...(typeof r.phase === "string" && r.phase ? { phase: r.phase.slice(0, 20) } : {}),
      ...(isoOrNull(r.startedAt) ? { startedAt: isoOrNull(r.startedAt)! } : {}),
    };
  }
  const run = o.run && typeof o.run === "object" ? (o.run as Record<string, unknown>) : null;
  const runStart = run ? isoOrNull(run.startedAt) : null;
  if (run && runStart) {
    const only = ids(run.only);
    out.run = {
      startedAt: runStart,
      finishedAt: isoOrNull(run.finishedAt),
      only: Array.isArray(run.only) && only.length ? only : null,
      redoAll: run.redoAll === true,
      attempted: ids(run.attempted),
      approved: num(run.approved) !== null && num(run.approved)! >= 0 ? num(run.approved) : null,
      spent: Math.max(0, num(run.spent) ?? 0),
    };
  }
  return out;
}

// ---------- Cómo se ve cada paso ahora ----------

/** Un paso que dice "corriendo" desde hace más de esto se cortó (la página se cerró o el servidor se pasó del tiempo). */
export const RUNNING_LIMIT_MS = 6 * 60_000;
const DAY = 86_400_000;

export type StepView = {
  id: StepId;
  n: number;
  status: StepStatus;
  at: string | null;
  message: string;
  cost: number | null;
  /** Hecho hace más de staleDays: conviene rehacerlo. */
  stale: boolean;
  /** El dueño lo saltó. */
  ownerSkipped: boolean;
  /** Lo que le falta para poder hacerse ahora (null = nada). */
  block: Precheck | null;
  phase?: string;
  /** Se cortó a medias (se cerró la página o el servidor se pasó del tiempo). */
  cut?: boolean;
};

export function isStale(def: Pick<StepDef, "staleDays">, at: string | null, now: number): boolean {
  if (def.staleDays === null || !at) return false;
  return now - Date.parse(at) > def.staleDays * DAY;
}

/**
 * Junta lo guardado del diagnóstico con lo que ya existe (reportes hechos desde otras pantallas) y lo que falta.
 * Lo más nuevo gana: si la revisión de posiciones se hizo después en «Diagnóstico», el paso queda hecho con esa fecha.
 */
export function stepViews(state: DiagnosisState, facts: DiagnosisFacts, now = Date.now()): StepView[] {
  return STEPS.map((def) => {
    const saved = state.steps[def.id];
    const last = facts.last[def.id];
    const block = precheck(def.id, facts);
    const view = (status: StepStatus, at: string | null, message = "", cost: number | null = null, extra: Partial<StepView> = {}): StepView => ({
      id: def.id,
      n: def.n,
      status,
      at,
      message,
      cost,
      stale: status === "done" && isStale(def, at, now),
      ownerSkipped: false,
      block,
      ...extra,
    });

    if (saved?.status === "running") {
      const started = Date.parse(saved.startedAt ?? saved.at ?? "") || 0;
      if (now - started <= RUNNING_LIMIT_MS) return view("running", saved.at, saved.message, saved.cost, saved.phase ? { phase: saved.phase } : {});
      return view("error", saved.startedAt ?? saved.at, "", saved.cost, { cut: true });
    }
    // Zonas y palabras: está hecho cuando existen, las haya elegido aquí o en Ajustes.
    if (def.id === "setup" && !block) {
      const at = saved?.status === "done" ? saved.at : (last?.at ?? saved?.at ?? null);
      return view("done", at, saved?.status === "done" ? saved.message : "", null);
    }
    const lastAt = last?.at ? Date.parse(last.at) : 0;
    const savedAt = saved?.at ? Date.parse(saved.at) : 0;
    if (saved && !(lastAt && lastAt > savedAt + 1000)) {
      if (saved.status === "skipped" && saved.by === "owner") return view("skipped", saved.at, saved.message, null, { ownerSkipped: true });
      // Lo que esperaba al dueño o a otro paso se vuelve a mirar: si ya está listo, queda pendiente.
      if ((saved.status === "needs-you" || (saved.status === "skipped" && saved.by !== "owner")) && !block) {
        return last?.at ? view("done", last.at, "", last.cost ?? null) : view("pending", null);
      }
      if (saved.status === "pending") return last?.at ? view("done", last.at, "", last.cost ?? null) : view("pending", null, saved.message);
      return view(saved.status, saved.at, saved.message, saved.cost);
    }
    // Hecho antes desde otra pantalla (o sin fecha conocida, como las respuestas del estudio).
    if (last) return view("done", last.at, "", last.cost ?? null);
    return view("pending", null);
  });
}

// ---------- Qué se hace en una corrida ----------

/** Los pasos que juntan datos: después de rehacer uno, el plan se vuelve a armar. */
const DATA_STEPS: StepId[] = ["competitors", "audit", "rank", "maps", "gbp", "ai"];

/**
 * Los pasos que va a intentar una corrida, en orden. Lo hecho hace poco se salta (salvo «Rehacer todo»); lo que
 * falta, lo que dio error y lo viejo se hace. Las zonas ya elegidas no se rehacen (se cambian en Ajustes).
 * El plan (paso 10) siempre se vuelve a armar al final, porque no cuesta nada.
 */
export function planRun(views: StepView[], opts: { redoAll?: boolean; only?: StepId[] | null } = {}): StepId[] {
  if (opts.only?.length) {
    const only = STEP_IDS.filter((id) => opts.only!.includes(id));
    return only.some((id) => DATA_STEPS.includes(id)) && !only.includes("plan") ? [...only, "plan"] : only;
  }
  const out = views
    .filter((v) => v.id !== "plan")
    .filter((v) => {
      if (v.ownerSkipped) return !!opts.redoAll;
      if (v.status === "done") return v.stale || (!!opts.redoAll && v.id !== "setup");
      return true;
    })
    .map((v) => v.id);
  return [...out, "plan"];
}

/** El siguiente paso de la corrida (el primero del plan que todavía no se intentó), o null si terminó. */
export function nextStep(views: StepView[], run: DiagnosisRun): StepId | null {
  const plan = planRun(views, { redoAll: run.redoAll, only: run.only });
  return plan.find((id) => !run.attempted.includes(id)) ?? null;
}

// ---------- Costos ----------

/** Precios en USD (los arma el servidor con las constantes de cada módulo). */
export type DiagnosisPrices = {
  rankPerKeyword: number;
  competitors: number;
  onpagePage: number;
  onpagePages: number;
  mapPoints: number;
  mapPoint: number;
  profile: number;
  profileCompetitors: number;
  reviews: number;
  /** El estudio con investigación en internet / sin investigación. */
  studyResearch: number;
  studyPlain: number;
  /** Cada respuesta de una IA con búsqueda en internet. */
  aiAnswer: number;
  /** Cuando no hay preguntas guardadas: la IA las propone (una llamada corta). */
  aiQuestions: number;
};

/** Si no se sabe todavía (antes del paso 3): unas 10 palabras clave en una zona. */
export const DEFAULT_KEYWORDS = 10;
export const DEFAULT_QUESTIONS = 5;

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Cuánto cuesta (aprox., USD) hacer el paso ahora. 0 = gratis o no se puede gastar (falta la clave). */
export function estimateStep(id: StepId, f: DiagnosisFacts, p: DiagnosisPrices): number {
  const dfs = f.dfs;
  switch (id) {
    case "study":
      return f.aiProviders ? (f.research ? p.studyResearch : p.studyPlain) : 0;
    case "competitors":
      return dfs ? p.competitors : 0;
    case "audit":
      return dfs ? round4(p.onpagePage * p.onpagePages) : 0;
    case "rank":
      return dfs ? round4((f.keywords || DEFAULT_KEYWORDS) * Math.max(1, f.zones) * p.rankPerKeyword) : 0;
    case "maps":
      return dfs ? round4(p.mapPoints * p.mapPoint) : 0;
    case "gbp":
      return dfs ? round4(p.profile * (1 + p.profileCompetitors) + p.reviews) : 0;
    case "ai":
      return f.aiProviders ? round4((f.questions || DEFAULT_QUESTIONS) * f.aiProviders * p.aiAnswer + (f.questions ? 0 : p.aiQuestions)) : 0;
    default:
      return 0;
  }
}

export type CostLine = { id: StepId; amount: number };

/** El total de los pasos pagados de una lista. */
export function planCost(list: StepId[], f: DiagnosisFacts, p: DiagnosisPrices): { total: number; items: CostLine[] } {
  const items = list.map((id) => ({ id, amount: estimateStep(id, f, p) })).filter((x) => x.amount > 0);
  return { total: round4(items.reduce((s, x) => s + x.amount, 0)), items };
}

/** Lo que falta de la corrida y cuánto cuesta. */
export function remainingCost(views: StepView[], run: DiagnosisRun, f: DiagnosisFacts, p: DiagnosisPrices) {
  const plan = planRun(views, { redoAll: run.redoAll, only: run.only }).filter((id) => !run.attempted.includes(id));
  return planCost(plan, f, p);
}

/** Margen sobre lo aceptado: los estimados son aproximados (un 25 % más y 2 centavos). */
export function canSpend(run: DiagnosisRun, amount: number): boolean {
  if (amount <= 0) return true;
  if (run.approved === null) return false;
  return run.spent + amount <= run.approved * 1.25 + 0.02 + 1e-9;
}

/** Paso que pide permiso para gastar (el gratis de la revisión se hace igual; su parte pagada se pregunta aparte). */
export const needsApproval = (id: StepId) => stepDef(id).cost !== "free";

// ---------- Avance ----------

const FINISHED: StepStatus[] = ["done", "skipped"];

/** «Paso N de 10» y cuántos están hechos. */
export function progress(views: StepView[]): { current: number; finished: number; total: number } {
  const finished = views.filter((v) => FINISHED.includes(v.status)).length;
  // Dónde estamos: lo que corre, lo que espera al dueño, lo primero por hacer y, al final, lo que dio error.
  const at = (["running", "needs-you", "pending", "error"] as StepStatus[]).map((st) => views.find((v) => v.status === st)).find(Boolean);
  return { current: at?.n ?? TOTAL_STEPS, finished, total: TOTAL_STEPS };
}

/** Todo hecho (o saltado): no queda nada pendiente, esperando al dueño ni con error. */
export const isComplete = (views: StepView[]) => views.every((v) => FINISHED.includes(v.status));

/** Después de 30 días conviene volver a hacer el diagnóstico. */
export const REDO_AFTER_DAYS = 30;
export const shouldRedo = (completedAt: string | null, now = Date.now()) => !!completedAt && now - Date.parse(completedAt) > REDO_AFTER_DAYS * DAY;

// ---------- Errores en palabras simples ----------

/**
 * Los errores técnicos que llegan de las IAs o de la red, dichos en simple. Lo que ya viene explicado
 * (por ejemplo, "Falta conectar DataForSEO…") queda igual.
 */
export function plainError(message: string, service: "dfs" | "ai" | "web"): Bi | null {
  const m = message.toLowerCase();
  // Lo que ya explica la acción (por ejemplo, «No se pudo abrir tu página web (…)») queda igual.
  if (/p[aá]gina web|your website|ajustes del negocio|business settings/.test(m)) return null;
  const who = service === "dfs" ? { es: "DataForSEO", en: "DataForSEO" } : service === "ai" ? { es: "la IA", en: "the AI" } : { es: "tu página web", en: "your website" };
  if (/api[_ ]?key|invalid.*key|key.*invalid|unauthori[sz]ed|\b401\b|\b403\b|permission denied|credential/.test(m) && !/datafor ?seo rechaz|dataforseo rejected/.test(m))
    return service === "ai"
      ? { es: "La clave de la IA no funciona. Hay que revisarla en la configuración del servidor (Vercel).", en: "The AI key doesn't work. It needs to be checked in the server settings (Vercel)." }
      : { es: `${cap(who.es)} no aceptó la clave. Hay que revisarla en la configuración del servidor (Vercel).`, en: `${who.en} didn't accept the key. It needs to be checked in the server settings (Vercel).` };
  if (/\b429\b|rate.?limit|quota|too many requests|resource.?exhausted/.test(m))
    return { es: `${cap(who.es)} pide esperar un momento (demasiadas consultas). Intenta de nuevo en un minuto.`, en: `${cap(who.en)} asks to wait a moment (too many requests). Try again in a minute.` };
  if (/timed? ?out|timeout|aborted|etimedout|deadline/.test(m))
    return { es: `${cap(who.es)} tardó demasiado en contestar. Intenta de nuevo.`, en: `${cap(who.en)} took too long to answer. Try again.` };
  if (/fetch failed|enotfound|econnrefused|econnreset|network|socket hang up/.test(m))
    return { es: `No se pudo conectar con ${who.es}. Revisa la conexión e intenta de nuevo.`, en: `Couldn't connect to ${who.en}. Check the connection and try again.` };
  return null;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
