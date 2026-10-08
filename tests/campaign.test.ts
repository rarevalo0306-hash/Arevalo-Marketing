import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------- Base de datos falsa en memoria (para PARAR, pausar y el candado del motor) ----------
type Row = Record<string, unknown>;
const mem = vi.hoisted(() => ({ campaigns: [] as Row[], posts: [] as Row[], actions: [] as Row[], emails: [] as unknown[] }));

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    const cur = row[k];
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if ("in" in o) return (o.in as unknown[]).includes(cur);
      if ("notIn" in o) return !(o.notIn as unknown[]).includes(cur);
      if ("gt" in o) return (cur as Date).getTime() > (o.gt as Date).getTime();
      if ("not" in o) return cur !== o.not;
      return true;
    }
    if (v instanceof Date) return cur instanceof Date && cur.getTime() === v.getTime();
    return cur === v;
  });
}

vi.mock("@/lib/db", () => {
  const table = (rows: () => Row[]) => ({
    findFirst: async ({ where }: { where: Row }) => rows().find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: { where: Row }) => rows().find((r) => matches(r, where)) ?? null,
    findUniqueOrThrow: async ({ where }: { where: Row }) => {
      const r = rows().find((x) => matches(x, where));
      if (!r) throw new Error("not found");
      return r;
    },
    findMany: async ({ where }: { where?: Row } = {}) => rows().filter((r) => matches(r, where)),
    count: async ({ where }: { where?: Row } = {}) => rows().filter((r) => matches(r, where)).length,
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const r = rows().find((x) => matches(x, where))!;
      Object.assign(r, data, { updatedAt: new Date(Date.now() + Math.random()) });
      return r;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const list = rows().filter((r) => matches(r, where));
      for (const r of list) Object.assign(r, data, { updatedAt: new Date((r.updatedAt as Date).getTime() + 1) });
      return { count: list.length };
    },
    create: async ({ data }: { data: Row }) => {
      const r = { id: `x${rows().length + 1}`, ...data, createdAt: new Date() };
      rows().push(r);
      return r;
    },
  });
  const db = {
    campaign: table(() => mem.campaigns),
    post: table(() => mem.posts),
    aiAction: table(() => mem.actions),
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  return { db };
});
vi.mock("@/lib/seo/alerts", async (orig) => ({
  ...(await orig<typeof import("@/lib/seo/alerts")>()),
  sendSeoEmail: vi.fn(async (opts: unknown) => {
    mem.emails.push(opts);
    return { name: "x", email: "x@x.com", apiKey: "k", via: "app" };
  }),
}));

import {
  bannedHits,
  campaignSlots,
  checkPost,
  decideStatus,
  defaultRules,
  dueSlots,
  failuresInRow,
  inQuietHours,
  localParts,
  pickKind,
  readEngine,
  readRules,
  reasonText,
  rulesFromForm,
  rulesJson,
  slotCounts,
  slotKey,
  validateCampaign,
  validateRules,
  type CampaignBasics,
  type CampaignRules,
  type CheckCampaign,
  type CheckCounts,
  type CheckDraft,
} from "../src/lib/campaign-shape";
import { buildCampaignEmail, pauseCampaign, resumeCampaign, stopCampaign } from "../src/lib/campaign";
import { claimCampaign, LOCK_MS, type ClaimDb } from "../src/lib/campaign-engine";

const TZ = "America/New_York";
const rules = (over: Partial<CampaignRules> = {}): CampaignRules => ({ ...defaultRules({ email: "dueno@negocio.com" }), timezone: TZ, ...over });

// Jueves 8 de octubre de 2026, 9:00 am en Miami (13:00 UTC).
const NOW = new Date("2026-10-08T13:00:00Z");
const campaign = (over: Partial<CheckCampaign> = {}): CheckCampaign => ({
  status: "active",
  mode: "auto",
  startsAt: new Date("2026-10-08T12:00:00Z"),
  endsAt: new Date("2026-11-05T03:59:00Z"),
  channels: ["facebook", "instagram"],
  perWeek: 3,
  ...over,
});
// Viernes 9 de octubre, 1:00 pm en Miami.
const FRI_1PM = new Date("2026-10-09T17:00:00Z");
const draft = (over: Partial<CheckDraft> = {}): CheckDraft => ({ texts: ["Consejo para cuidar tu portón enrollable."], channels: ["facebook"], scheduledAt: FRI_1PM, aiCostCents: 0, ...over });
const counts = (over: Partial<CheckCounts> = {}): CheckCounts => ({ day: 0, week: 0, aiSpentCents: 0, connected: ["facebook", "instagram"], usedChannels: ["facebook", "instagram"], ...over });
const codes = (r: { reasons: { code: string }[] }) => r.reasons.map((x) => x.code);

describe("readRules (lector tolerante)", () => {
  it("sin nada da los valores por defecto (seguridad marcada, 0 gasto en IA)", () => {
    const r = readRules(null, { email: "a@b.com" });
    expect(r.safety).toEqual({ politics: true, religion: true, competitors: true, prices: true, promises: true, insurance: true });
    expect(r.maxAiCostCents).toBe(0);
    expect(r.alerts.email).toBe("a@b.com");
    expect(r.weekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.contentMix).toEqual({ post: 100, carousel: 0, story: 0, video: 0 });
  });

  it("corrige lo que viene mal sin fallar", () => {
    const r = readRules({
      maxPerDay: 99,
      maxAiCostCents: -5,
      weekdays: [9, "2", 2, 0],
      quietHours: { from: "25:00", to: "7:5" },
      postTimes: ["9:00", "nope", "18:30"],
      bannedTopics: "barato, barato,  , lluvia",
      safety: { religion: false, extra: true },
      contentMix: { carousel: 0 },
      languages: ["fr"],
      stopOnErrors: "4",
      timezone: "Mars/Olympus",
    });
    expect(r.maxPerDay).toBe(5);
    expect(r.maxAiCostCents).toBe(0);
    expect(r.weekdays).toEqual([0, 2]);
    expect(r.quietHours).toEqual({ from: "21:00", to: "08:00" });
    expect(r.postTimes).toEqual(["09:00", "18:30"]);
    expect(r.bannedTopics).toEqual(["barato", "lluvia"]);
    expect(r.safety.religion).toBe(false);
    expect(r.safety.politics).toBe(true);
    expect(r.contentMix.post).toBe(100);
    expect(r.languages).toEqual(["es"]);
    expect(r.stopOnErrors).toBe(4);
    expect(r.timezone).toBe(process.env.BUSINESS_TZ || "America/New_York");
  });

  it("quietHours null = sin horas de silencio; el estado del motor se lee aparte", () => {
    expect(readRules({ quietHours: null }).quietHours).toBeNull();
    const json = rulesJson(rules(), { lockedUntil: null, handled: ["a"], errorsInRow: 2, held: [], lastRunAt: null, resetAt: null, videos: [] });
    expect(readEngine(json).handled).toEqual(["a"]);
    expect(readEngine(json).errorsInRow).toBe(2);
    expect(readEngine({ engine: "basura" }).handled).toEqual([]);
    // Las reglas siguen leyéndose igual con el estado del motor dentro.
    expect(readRules(json).maxPerDay).toBe(1);
  });

  it("lee el formulario del asistente", () => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ safety_present: "1", safety_politics: "on", maxPerDay: "2", quiet_present: "1", quietFrom: "20:00", quietTo: "07:00", weekdays_present: "1", maxAiCost: "1.5", alerts_present: "1", alertEmail: "x@y.com", alertStop: "on", mix_present: "1", mix_post: "60", mix_carousel: "40", bannedTopics: "barato\ngratis" }))
      f.set(k, v);
    f.append("weekdays", "1");
    f.append("weekdays", "3");
    const r = rulesFromForm(f, rules());
    expect(r.safety.politics).toBe(true);
    expect(r.safety.prices).toBe(false);
    expect(r.quietHours).toBeNull(); // quietOn no vino marcado
    expect(r.weekdays).toEqual([1, 3]);
    expect(r.maxAiCostCents).toBe(150);
    expect(r.alerts).toEqual({ email: "x@y.com", onEveryPost: false, onLimit: false, onError: false, onStop: true });
    expect(r.contentMix).toEqual({ post: 60, carousel: 40, story: 0, video: 0 });
    expect(r.bannedTopics).toEqual(["barato", "gratis"]);
  });
});

describe("validación", () => {
  const basics: CampaignBasics = { name: "Portones", mode: "approval", startsAt: NOW, endsAt: new Date("2026-11-05T03:59:00Z"), channels: ["facebook"], perWeek: 3 };

  it("una campaña bien hecha no tiene problemas", () => {
    expect(validateCampaign(basics, rules(), { now: NOW })).toEqual([]);
  });

  it("100% IA exige la casilla «Entiendo…»", () => {
    expect(validateCampaign({ ...basics, mode: "auto" }, rules(), { now: NOW }).map((p) => p.field)).toContain("autoAccepted");
    expect(validateCampaign({ ...basics, mode: "auto" }, rules(), { now: NOW, autoAccepted: true })).toEqual([]);
  });

  it("fechas, canales y frecuencia imposible", () => {
    const f = (x: Partial<CampaignBasics>, r = rules()) => validateCampaign({ ...basics, ...x }, r, { now: NOW }).map((p) => p.field);
    expect(f({ endsAt: new Date("2026-10-01T00:00:00Z") })).toContain("endsAt");
    expect(f({ endsAt: null })).toContain("endsAt");
    expect(f({ channels: [] })).toContain("channels");
    expect(f({ channels: [], mode: "manual" })).not.toContain("channels");
    expect(f({ perWeek: 8 }, rules({ weekdays: [1, 3], maxPerDay: 2 }))).toContain("perWeek");
    expect(f({ name: "  " })).toContain("name");
  });

  it("avisos sin email válido y horas de publicar todas en silencio", () => {
    expect(validateRules(rules({ alerts: { email: "no", onEveryPost: false, onLimit: true, onError: false, onStop: false } })).map((p) => p.field)).toEqual(["alerts.email"]);
    expect(validateRules(rules({ alerts: { email: "", onEveryPost: false, onLimit: false, onError: false, onStop: false } }))).toEqual([]);
    expect(validateRules(rules({ postTimes: ["22:00"], quietHours: { from: "21:00", to: "08:00" } })).map((p) => p.field)).toContain("quietHours");
  });
});

describe("checkPost: cada razón", () => {
  it("pasa cuando todo está dentro de los límites", () => {
    const r = checkPost(rules(), campaign(), draft(), counts(), NOW);
    expect(r).toEqual({ ok: true, reasons: [], needsApproval: [] });
  });

  it("modo manual y campaña no activa", () => {
    expect(codes(checkPost(rules(), campaign({ mode: "manual" }), draft(), counts(), NOW))).toEqual(["manual"]);
    expect(codes(checkPost(rules(), campaign({ status: "stopped" }), draft(), counts(), NOW))).toEqual(["status"]);
    expect(codes(checkPost(rules(), campaign({ status: "paused" }), draft(), counts(), NOW))).toEqual(["status"]);
  });

  it("fuera de fechas o en el pasado", () => {
    expect(codes(checkPost(rules(), campaign({ startsAt: new Date("2026-10-10T00:00:00Z") }), draft(), counts(), NOW))).toEqual(["beforeStart"]);
    expect(codes(checkPost(rules(), campaign({ endsAt: new Date("2026-10-09T12:00:00Z") }), draft(), counts(), NOW))).toEqual(["afterEnd"]);
    expect(codes(checkPost(rules(), campaign(), draft(), counts(), new Date("2026-10-09T18:00:00Z")))).toEqual(["past"]);
  });

  it("canal no permitido, no conectado o ninguno", () => {
    const r = checkPost(rules(), campaign(), draft({ channels: ["tiktok", "instagram"] }), counts({ connected: ["facebook"] }), NOW);
    expect(r.reasons).toEqual([
      { code: "channel", channel: "tiktok", detail: "notInCampaign" },
      { code: "channel", channel: "instagram", detail: "notConnected" },
    ]);
    expect(codes(checkPost(rules(), campaign(), draft({ channels: [] }), counts(), NOW))).toEqual(["noChannels"]);
  });

  it("máximo por día y por semana", () => {
    expect(codes(checkPost(rules(), campaign(), draft(), counts({ day: 1 }), NOW))).toEqual(["maxPerDay"]);
    expect(codes(checkPost(rules({ maxPerDay: 3 }), campaign(), draft(), counts({ day: 1, week: 3 }), NOW))).toEqual(["perWeek"]);
  });

  it("horas sin publicar y día no permitido, en la hora del negocio", () => {
    // Viernes 10:30 pm en Miami = sábado 02:30 UTC: cae en el silencio de 21:00 a 08:00.
    expect(codes(checkPost(rules(), campaign(), draft({ scheduledAt: new Date("2026-10-10T02:30:00Z") }), counts(), NOW))).toEqual(["quietHours"]);
    // Domingo 11 de octubre, 1 pm: el domingo no está permitido.
    expect(codes(checkPost(rules(), campaign(), draft({ scheduledAt: new Date("2026-10-11T17:00:00Z") }), counts(), NOW))).toEqual(["weekday"]);
  });

  it("tope de gasto en IA", () => {
    expect(codes(checkPost(rules({ maxAiCostCents: 10 }), campaign(), draft({ aiCostCents: 4 }), counts({ aiSpentCents: 8 }), NOW))).toEqual(["budget"]);
    expect(checkPost(rules({ maxAiCostCents: 10 }), campaign(), draft({ aiCostCents: 4 }), counts({ aiSpentCents: 6 }), NOW).ok).toBe(true);
    // Con tope 0, cualquier foto con IA queda fuera.
    expect(codes(checkPost(rules(), campaign(), draft({ aiCostCents: 1 }), counts(), NOW))).toEqual(["budget"]);
  });

  it("temas prohibidos: palabra del dueño, lista de seguridad (sin acentos), competencia y precios", () => {
    const r = rules({ bannedTopics: ["lluvia ácida"], competitors: ["Portones López"] });
    const hit = (text: string) => checkPost(r, campaign(), draft({ texts: [text] }), counts(), NOW).reasons;
    expect(hit("Cuidado con la LLUVIA ACIDA en tu portón")).toEqual([{ code: "banned", word: "lluvia ácida", topic: "owner" }]);
    expect(hit("Vota en las elecciones")).toEqual([{ code: "banned", word: "elecciones", topic: "politics" }]);
    expect(hit("Gracias a Dios por otro año")).toEqual([{ code: "banned", word: "dios", topic: "religion" }]);
    expect(hit("Mejor que Portones Lopez")).toEqual([{ code: "banned", word: "Portones López", topic: "competitors" }]);
    expect(hit("Instalación por solo $299")[0]).toMatchObject({ code: "banned", topic: "prices" });
    expect(hit("20% de descuento")[0]).toMatchObject({ code: "banned", topic: "prices" });
    expect(hit("Te garantizamos más dinero de tu seguro").map((x) => x.topic)).toEqual(["promises", "insurance"]);
    // Palabras completas: «diosa» o «precioso» no cuentan.
    expect(hit("Un portón precioso para tu negocio")).toEqual([]);
    expect(bannedHits(rules({ safety: { politics: false, religion: false, competitors: false, prices: false, promises: false, insurance: false } }), "Vota por Dios con 20% de descuento")).toEqual([]);
  });

  it("texto vacío", () => {
    expect(codes(checkPost(rules(), campaign(), draft({ texts: ["  ", ""] }), counts(), NOW))).toEqual(["empty"]);
  });

  it("necesita aprobación: precios permitidos, canal nuevo, foto de IA", () => {
    const r = rules({ safety: { ...rules().safety, prices: false }, needsApprovalFor: ["prices", "newChannel", "aiImage"], maxAiCostCents: 100 });
    const res = checkPost(r, campaign(), draft({ texts: ["Desde $199 la instalación"], aiImage: true, aiCostCents: 4 }), counts({ usedChannels: [] }), NOW);
    expect(res.ok).toBe(true);
    expect(res.needsApproval.map((x) => x.code)).toEqual(["prices", "newChannel", "aiImage"]);
    expect(reasonText(res.needsApproval[1], "en", (id) => id.toUpperCase())).toContain("FACEBOOK");
  });

  it("cada razón tiene una frase en los dos idiomas", () => {
    const all = ["status", "manual", "beforeStart", "afterEnd", "past", "noChannels", "channel", "maxPerDay", "perWeek", "quietHours", "weekday", "budget", "banned", "empty", "prices", "newChannel", "aiImage"] as const;
    for (const code of all) {
      expect(reasonText({ code, word: "x", channel: "facebook" }, "es")).toMatch(/\w/);
      expect(reasonText({ code, word: "x", channel: "facebook" }, "en")).not.toBe(reasonText({ code, word: "x", channel: "facebook" }, "es"));
    }
  });
});

describe("modo: qué hace el motor con una publicación lista", () => {
  const ok = { ok: true, reasons: [], needsApproval: [] };
  const needs = { ok: true, reasons: [], needsApproval: [{ code: "prices" as const }] };
  const bad = { ok: false, reasons: [{ code: "budget" as const }], needsApproval: [] };
  it("manual nada; con aprobación borrador; 100% IA programada (o borrador si pide permiso); si no pasa, nada", () => {
    expect(decideStatus("manual", ok)).toBeNull();
    expect(decideStatus("approval", ok)).toBe("draft");
    expect(decideStatus("auto", ok)).toBe("scheduled");
    expect(decideStatus("auto", needs)).toBe("draft");
    expect(decideStatus("auto", bad)).toBeNull();
    expect(decideStatus("approval", bad)).toBeNull();
  });
});

describe("horarios de la campaña", () => {
  const c = { startsAt: new Date("2026-10-08T04:00:00Z"), endsAt: new Date("2026-11-05T03:59:00Z"), perWeek: 3 };

  it("4 semanas a 3 por semana = 12, en días permitidos, nunca en horas sin publicar", () => {
    const r = rules();
    const slots = campaignSlots(c, r);
    expect(slots).toHaveLength(12);
    for (const s of slots) {
      const l = localParts(s, TZ);
      expect(r.weekdays).toContain(l.weekday);
      expect(inQuietHours(l.minutes, r.quietHours)).toBe(false);
      expect(l.minutes).toBe(13 * 60); // con una por día, la hora del medio (1 pm)
    }
    // Repartidas: nunca dos días seguidos en la misma semana.
    const days = slots.map((s) => localParts(s, TZ).day);
    expect(new Set(days).size).toBe(12);
    expect(days.slice(0, 3)).toEqual(["2026-10-09", "2026-10-12", "2026-10-14"]);
  });

  it("respeta los días elegidos y el máximo por día", () => {
    const slots = campaignSlots({ ...c, perWeek: 4 }, rules({ weekdays: [2, 4], maxPerDay: 2 }));
    expect(slots).toHaveLength(16);
    const perDay = new Map<string, number>();
    for (const s of slots) {
      const l = localParts(s, TZ);
      expect([2, 4]).toContain(l.weekday);
      perDay.set(l.day, (perDay.get(l.day) ?? 0) + 1);
    }
    expect(Math.max(...perDay.values())).toBe(2);
  });

  it("con todas las horas en silencio, publica cuando termina el silencio", () => {
    const slots = campaignSlots(c, rules({ postTimes: ["06:00"], quietHours: { from: "21:00", to: "08:00" } }));
    expect(slots.every((s) => localParts(s, TZ).minutes === 8 * 60)).toBe(true);
  });

  it("la zona horaria del negocio cambia la hora UTC", () => {
    // Empieza el jueves 8 a media mañana en las dos zonas (a las 04:00 UTC en Managua todavía sería miércoles).
    const c2 = { ...c, startsAt: new Date("2026-10-08T12:00:00Z") };
    const ny = campaignSlots(c2, rules({ timezone: "America/New_York" }))[0];
    const mga = campaignSlots(c2, rules({ timezone: "America/Managua" }))[0];
    expect(ny.toISOString()).toBe("2026-10-09T17:00:00.000Z");
    expect(mga.toISOString()).toBe("2026-10-09T19:00:00.000Z");
  });

  it("una semana corta lleva menos publicaciones", () => {
    const slots = campaignSlots({ ...c, endsAt: new Date("2026-10-18T03:59:00Z") }, rules()); // 10 días
    expect(slots).toHaveLength(3 + 1);
  });

  it("dueSlots: solo los próximos días, nunca el pasado ni lo ya atendido", () => {
    const slots = campaignSlots(c, rules());
    const due = dueSlots(slots, [], NOW, 3);
    expect(due.map(slotKey)).toEqual(["2026-10-09T17:00:00.000Z"]);
    expect(dueSlots(slots, [slotKey(slots[0])], NOW, 3)).toEqual([]);
    expect(dueSlots(slots, [], new Date("2026-10-09T17:00:00Z"), 3).map(slotKey)).toEqual(["2026-10-12T17:00:00.000Z"]);
  });

  it("slotCounts cuenta el mismo día y la misma semana de la campaña", () => {
    const existing = [{ scheduledAt: new Date("2026-10-09T14:00:00Z") }, { scheduledAt: new Date("2026-10-12T17:00:00Z") }, { scheduledAt: new Date("2026-10-16T17:00:00Z") }];
    expect(slotCounts(existing, new Date("2026-10-09T20:00:00Z"), c.startsAt, TZ)).toEqual({ day: 1, week: 2 });
  });
});

describe("tipo de publicación y errores seguidos", () => {
  it("pickKind sigue el reparto", () => {
    const kinds = Array.from({ length: 20 }, (_, i) => pickKind({ post: 50, carousel: 30, story: 20, video: 0 }, i));
    expect(kinds.filter((k) => k === "post")).toHaveLength(10);
    expect(kinds.filter((k) => k === "carousel")).toHaveLength(6);
    expect(kinds.filter((k) => k === "story")).toHaveLength(4);
    expect(pickKind({ post: 100, carousel: 0, story: 0, video: 0 }, 7)).toBe("post");
    expect(pickKind({ post: 0, carousel: 0, story: 0, video: 0 }, 3)).toBe("post");
  });

  it("failuresInRow cuenta desde la más nueva hasta la primera que salió", () => {
    expect(failuresInRow(["failed", "failed", "done", "failed"])).toBe(2);
    expect(failuresInRow(["done", "failed"])).toBe(0);
    expect(failuresInRow(["failed", "failed", "failed"])).toBe(3);
  });
});

// ---------- Con la base de datos falsa ----------

const T0 = new Date("2026-10-08T12:00:00Z");
function seed() {
  mem.campaigns.length = 0;
  mem.posts.length = 0;
  mem.actions.length = 0;
  mem.emails.length = 0;
  mem.campaigns.push({
    id: "c1",
    businessId: "b1",
    name: "Portones",
    goal: "",
    mode: "auto",
    status: "active",
    startsAt: T0,
    endsAt: new Date("2026-11-05T03:59:00Z"),
    channels: ["facebook"],
    perWeek: 3,
    keywords: [],
    rules: rulesJson(rules(), readEngine(null)),
    updatedAt: T0,
    business: { id: "b1", name: "Fameseg", color: "#126BBC", ownerEmail: "dueno@negocio.com", seoEmailLang: "es", seoLanguage: "es" },
  });
  const p = (id: string, status: string, h: number) => mem.posts.push({ id, campaignId: "c1", businessId: "b1", text: `Texto ${id}`, status, scheduledAt: new Date(Date.now() + h * 3600000), updatedAt: T0 });
  p("p-sched", "scheduled", 24);
  p("p-draft", "draft", 48);
  p("p-done", "done", -24);
  p("p-pub", "publishing", 0);
  p("p-sched2", "scheduled", 72);
  mem.posts.push({ id: "other", campaignId: "c2", businessId: "b1", text: "otra", status: "scheduled", scheduledAt: new Date(Date.now() + 3600000), updatedAt: T0 });
}

describe("PARAR (emergencia)", () => {
  beforeEach(seed);

  it("cancela al instante lo programado (queda como borrador, sin borrar el texto) y deja la campaña parada", async () => {
    const r = await stopCampaign("b1", "c1");
    expect(r).toEqual({ ok: true, cancelled: 2 });
    expect(mem.campaigns[0].status).toBe("stopped");
    const by = Object.fromEntries(mem.posts.map((p) => [p.id, p]));
    expect(by["p-sched"].status).toBe("draft");
    expect(by["p-sched2"].status).toBe("draft");
    expect(by["p-sched"].text).toBe("Texto p-sched");
    expect(by["p-draft"].status).toBe("draft");
    expect(by["p-done"].status).toBe("done");
    expect(by["p-pub"].status).toBe("publishing");
    // Las de otra campaña no se tocan.
    expect(by.other.status).toBe("scheduled");
    expect(mem.posts).toHaveLength(6);
    expect(mem.actions.map((a) => a.kind)).toEqual(["campaign.stopped", "alert.sent"]);
    expect(mem.emails).toHaveLength(1);
  });

  it("parar dos veces no hace nada la segunda vez; otro negocio no puede parar la campaña", async () => {
    await stopCampaign("b1", "c1");
    expect(await stopCampaign("b1", "c1")).toEqual({ ok: true, cancelled: 0, already: true });
    seed();
    expect((await stopCampaign("otro", "c1")).ok).toBe(false);
    expect(mem.campaigns[0].status).toBe("active");
  });

  it("pausar deja en espera lo programado y reanudar lo vuelve a programar", async () => {
    expect(await pauseCampaign("b1", "c1")).toBe(true);
    expect(mem.campaigns[0].status).toBe("paused");
    expect(mem.posts.find((p) => p.id === "p-sched")!.status).toBe("draft");
    expect(readEngine(mem.campaigns[0].rules).held.sort()).toEqual(["p-sched", "p-sched2"]);
    expect(await resumeCampaign("b1", "c1")).toBe(true);
    expect(mem.campaigns[0].status).toBe("active");
    expect(mem.posts.find((p) => p.id === "p-sched")!.status).toBe("scheduled");
    // El borrador que ya era borrador sigue esperando aprobación.
    expect(mem.posts.find((p) => p.id === "p-draft")!.status).toBe("draft");
    expect(readEngine(mem.campaigns[0].rules).held).toEqual([]);
  });
});

describe("candado del motor (si el cron corre dos veces)", () => {
  beforeEach(seed);
  const client = () => {
    // Igual que Postgres: updateMany con updatedAt compara y cambia de forma atómica.
    return {
      campaign: {
        findUnique: async ({ where }: { where: { id: string } }) => ({ ...mem.campaigns.find((c) => c.id === where.id)! }),
        updateMany: async ({ where, data }: { where: { id: string; updatedAt: Date; status: string }; data: { rules: unknown } }) => {
          const c = mem.campaigns.find((x) => x.id === where.id && (x.updatedAt as Date).getTime() === where.updatedAt.getTime() && x.status === where.status);
          if (!c) return { count: 0 };
          c.rules = data.rules;
          c.updatedAt = new Date((c.updatedAt as Date).getTime() + 1);
          return { count: 1 };
        },
      },
    } as unknown as ClaimDb;
  };

  it("dos corridas a la vez: solo una toma la campaña", async () => {
    const db = client();
    const [a, b] = await Promise.all([claimCampaign("c1", NOW, db), claimCampaign("c1", NOW, db)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("mientras está tomada nadie más entra; cuando vence el candado sí", async () => {
    const db = client();
    expect(await claimCampaign("c1", NOW, db)).not.toBeNull();
    expect(await claimCampaign("c1", new Date(NOW.getTime() + 60000), db)).toBeNull();
    expect(await claimCampaign("c1", new Date(NOW.getTime() + LOCK_MS + 1000), db)).not.toBeNull();
  });

  it("no toma campañas manuales, pausadas ni paradas", async () => {
    const db = client();
    mem.campaigns[0].mode = "manual";
    expect(await claimCampaign("c1", NOW, db)).toBeNull();
    mem.campaigns[0].mode = "approval";
    mem.campaigns[0].status = "paused";
    expect(await claimCampaign("c1", NOW, db)).toBeNull();
    mem.campaigns[0].status = "stopped";
    expect(await claimCampaign("c1", NOW, db)).toBeNull();
  });
});

describe("email de aviso", () => {
  it("el botón lleva a la campaña, no a SEO", () => {
    const e = buildCampaignEmail({ id: "b1", name: "Fameseg", color: "#126BBC" }, { id: "c1", name: "Portones" }, "limit", { es: "Se llegó al máximo", en: "Max reached" }, "es");
    expect(e.subject).toContain("Portones");
    expect(e.html).toContain("/b/b1/campanas/c1");
    expect(e.html).not.toContain("/b/b1/seo");
    expect(e.text).toContain("Se llegó al máximo");
  });
});
