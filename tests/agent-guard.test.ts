// El guardia del equipo, parte pura: un canal queda frenado cuando sus dos últimos envíos del agente fallaron; una pieza se
// programa solo si lo permiten los interruptores, la aprobación, los canales y el cupo del día; y a qué hora sale.
import { describe, expect, it } from "vitest";
import {
  approvedAfterReviews,
  brakedChannels,
  pieceScheduleAt,
  refusalOf,
  type GuardFacts,
} from "@/lib/agent/guard";
import { stormSchedule } from "@/lib/storm";

const at = (hours: number) => new Date(Date.UTC(2026, 9, 10, hours));
const t = (channel: string, status: string, hours: number) => ({
  channel,
  status,
  createdAt: at(hours),
});

describe("brakedChannels", () => {
  it("frena el canal cuyos dos últimos envíos fallaron y deja el que tuvo un éxito", () => {
    expect(
      brakedChannels([
        t("facebook", "failed", 1),
        t("facebook", "failed", 2),
        t("instagram", "failed", 1),
        t("instagram", "sent", 2),
      ]),
    ).toEqual(["facebook"]);
  });

  it("cuentan los dos más nuevos, sin importar el orden en que llegan", () => {
    // Dos fallos recientes tras un éxito viejo: frenado.
    expect(
      brakedChannels([
        t("facebook", "failed", 3),
        t("facebook", "sent", 1),
        t("facebook", "failed", 2),
      ]),
    ).toEqual(["facebook"]);
    // Un éxito reciente tras dos fallos viejos: ya no está frenado.
    expect(
      brakedChannels([
        t("facebook", "sent", 3),
        t("facebook", "failed", 1),
        t("facebook", "failed", 2),
      ]),
    ).toEqual([]);
    // El último falló pero el anterior no: tampoco.
    expect(
      brakedChannels([
        t("facebook", "failed", 1),
        t("facebook", "sent", 2),
        t("facebook", "failed", 3),
      ]),
    ).toEqual([]);
  });

  it("un solo fallo, o un solo envío, no frena", () => {
    expect(brakedChannels([t("facebook", "failed", 1)])).toEqual([]);
    expect(brakedChannels([t("facebook", "failed", 1), t("facebook", "sent", 0)])).toEqual([]);
  });

  it("sin envíos no hay canales frenados", () => {
    expect(brakedChannels([])).toEqual([]);
  });

  it("solo `failed` cuenta como fallo: lo pendiente u omitido no frena", () => {
    expect(brakedChannels([t("x", "pending", 1), t("x", "pending", 2)])).toEqual([]);
    expect(brakedChannels([t("x", "skipped", 1), t("x", "failed", 2)])).toEqual([]);
  });

  it("cada canal se juzga por separado y la lista sale ordenada y sin repetidos", () => {
    expect(
      brakedChannels([
        t("x", "failed", 1),
        t("linkedin", "failed", 1),
        t("x", "failed", 2),
        t("linkedin", "failed", 2),
        t("linkedin", "failed", 3),
        t("facebook", "sent", 1),
        t("facebook", "sent", 2),
      ]),
    ).toEqual(["linkedin", "x"]);
  });

  describe("reconectar el canal", () => {
    const failed = [t("facebook", "failed", 1), t("facebook", "failed", 3)];

    it("sin dato de reconexión se miran todos los envíos y sigue frenado", () => {
      expect(brakedChannels(failed)).toEqual(["facebook"]);
      expect(brakedChannels(failed, {})).toEqual(["facebook"]);
      expect(brakedChannels(failed, { facebook: undefined })).toEqual(["facebook"]);
      // An invalid date is no data either.
      expect(brakedChannels(failed, { facebook: new Date("nope") })).toEqual(["facebook"]);
    });

    it("se libera si la conexión se guardó después de los dos fallos", () => {
      expect(brakedChannels(failed, { facebook: at(4) })).toEqual([]);
    });

    it("solo cuenta lo que pasó después de reconectar: lo de ese momento o antes ya no", () => {
      // Between the two failures: only the newest is left after the reconnection, and one failure does not brake.
      expect(brakedChannels(failed, { facebook: at(2) })).toEqual([]);
      // At the very instant of the newest failure: it does not count either.
      expect(brakedChannels(failed, { facebook: at(3) })).toEqual([]);
      // Before both failures nothing changes.
      expect(brakedChannels(failed, { facebook: at(0) })).toEqual(["facebook"]);
    });

    it("tras reconectar, un fallo nuevo no frena y dos fallos nuevos seguidos sí", () => {
      const old = [t("facebook", "failed", 1), t("facebook", "failed", 2)];
      const reconnected = { facebook: at(3) };
      expect(brakedChannels([...old, t("facebook", "failed", 4)], reconnected)).toEqual([]);
      expect(brakedChannels([...old, t("facebook", "failed", 4), t("facebook", "failed", 5)], reconnected)).toEqual([
        "facebook",
      ]);
      // A good delivery between them breaks the run of failures.
      expect(
        brakedChannels([...old, t("facebook", "failed", 4), t("facebook", "sent", 5), t("facebook", "failed", 6)], reconnected),
      ).toEqual([]);
    });

    it("la reconexión de un canal no libera a otro", () => {
      const both = [...failed, t("x", "failed", 1), t("x", "failed", 2)];
      expect(brakedChannels(both, { facebook: at(5) })).toEqual(["x"]);
      expect(brakedChannels(both, { x: at(5) })).toEqual(["facebook"]);
      // A channel name like an object key never reads from the prototype.
      expect(brakedChannels([t("constructor", "failed", 1), t("constructor", "failed", 2)])).toEqual(["constructor"]);
    });

    it("no cambia lo que recibe", () => {
      const reconnected = { facebook: at(4) };
      brakedChannels(failed, reconnected);
      expect(reconnected).toEqual({ facebook: at(4) });
    });
  });

  it("no cambia lo que recibe", () => {
    const targets = [t("facebook", "failed", 2), t("facebook", "failed", 1), t("facebook", "sent", 0)];
    const copy = targets.map((x) => ({ ...x }));
    brakedChannels(targets);
    expect(targets).toEqual(copy);
  });
});

describe("refusalOf", () => {
  const ws: GuardFacts["ws"] = {
    pausedAt: null,
    teamMode: true,
    enabled: true,
    allowPublish: true,
    mode: "auto",
    allowSocial: true,
    allowWebArticles: true,
    channels: ["facebook", "instagram", "youtube"],
    maxPostsPerDay: 2,
  };
  const ok: GuardFacts = {
    ws,
    format: "post",
    approved: false,
    channels: ["facebook", "instagram"],
    connected: ["facebook", "instagram", "youtube", "seo"],
    braked: [],
    posts: 1,
  };
  const facts = (extra: Partial<GuardFacts>, w: Partial<GuardFacts["ws"]> = {}): GuardFacts => ({
    ...ok,
    ...extra,
    ws: { ...ws, ...w },
  });

  it("deja programar cuando todo está en orden", () => {
    expect(refusalOf(ok)).toBeNull();
    // A carousel and a video follow the same rules.
    expect(refusalOf(facts({ format: "carrusel" }))).toBeNull();
    expect(refusalOf(facts({ format: "video" }))).toBeNull();
  });

  it("cada interruptor apagado tiene su propio mensaje, y la pausa va primero", () => {
    expect(refusalOf(facts({}, { pausedAt: new Date() }))).toContain("pausa");
    expect(refusalOf(facts({}, { teamMode: false }))).toContain("modo equipo");
    expect(refusalOf(facts({}, { enabled: false }))).toContain("apagada");
    expect(refusalOf(facts({}, { allowPublish: false }))).toContain("permiso de publicación");
    // Everything off at once: the pause is what the owner did last and what they must undo first.
    expect(
      refusalOf(facts({}, { pausedAt: new Date(), teamMode: false, enabled: false, allowPublish: false })),
    ).toContain("pausa");
    // Every message says the post stayed a draft.
    for (const w of [{ pausedAt: new Date() }, { teamMode: false }, { enabled: false }, { allowPublish: false }])
      expect(refusalOf(facts({}, w))).toContain("borrador");
  });

  it("en modo con aprobación necesita una aprobación posterior a la revisión", () => {
    expect(refusalOf(facts({ approved: false }, { mode: "approval" }))).toContain("aprobación");
    expect(refusalOf(facts({ approved: true }, { mode: "approval" }))).toBeNull();
    // In auto mode no approval is needed.
    expect(refusalOf(facts({ approved: false }, { mode: "auto" }))).toBeNull();
  });

  it("sin permiso para redes no programa una publicación, pero no frena un artículo", () => {
    expect(refusalOf(facts({}, { allowSocial: false }))).toContain("redes sociales");
    expect(refusalOf(facts({ format: "video" }, { allowSocial: false }))).toContain("redes sociales");
    // A run that is not a piece we can read follows the rules of a social post.
    expect(refusalOf(facts({ format: null }, { allowSocial: false }))).toContain("redes sociales");
    expect(refusalOf(facts({ format: "articulo", channels: ["seo"] }, { allowSocial: false }))).toBeNull();
  });

  it("refuses youtube, a channel the owner does not allow, one that is not connected and one that is braked", () => {
    expect(refusalOf(facts({ channels: [] }))).toContain("no tiene canales");
    // YouTube is never the agent's, even allowed and connected.
    expect(refusalOf(facts({ channels: ["facebook", "youtube"] }))).toContain("YouTube");
    expect(refusalOf(facts({ channels: ["facebook", "linkedin", "x"] }))).toContain("linkedin, x");
    expect(refusalOf(facts({ channels: ["facebook", "linkedin"] }))).toContain("permiso para publicar");
    expect(refusalOf(facts({ connected: ["facebook"] }))).toContain("no están conectados: instagram");
    expect(refusalOf(facts({ braked: ["instagram"] }))).toContain("frenados");
    expect(refusalOf(facts({ braked: ["instagram"] }))).toContain("instagram");
    // A braked channel the post does not use does not matter.
    expect(refusalOf(facts({ braked: ["linkedin"] }))).toBeNull();
  });

  it("the website is only an article's channel, and only with web articles allowed", () => {
    const article = { format: "articulo" as const, channels: ["seo"] };
    expect(refusalOf(facts(article))).toBeNull();
    expect(refusalOf(facts(article, { allowWebArticles: false }))).toContain("seo");
    expect(refusalOf(facts({ ...article, connected: ["facebook"] }))).toContain("no están conectados: seo");
    // A social post never goes to the website, even if the owner lists it; an article never goes to social channels.
    expect(refusalOf(facts({ channels: ["facebook", "seo"] }, { channels: ["facebook", "seo"] }))).toContain("seo");
    expect(refusalOf(facts({ format: "articulo", channels: ["seo", "facebook"] }))).toContain("facebook");
  });

  it("stops at the day's limit, counting what is already scheduled", () => {
    expect(refusalOf(facts({ posts: 1 }))).toBeNull();
    expect(refusalOf(facts({ posts: 2 }))).toContain("límite diario");
    expect(refusalOf(facts({ posts: 5 }))).toContain("límite diario");
    expect(refusalOf(facts({ posts: 0 }, { maxPostsPerDay: 0 }))).toContain("límite diario");
  });

  it("checks in the order of the list: switches, approval, social, channels, then the day's limit", () => {
    const all = facts(
      { approved: false, channels: ["linkedin"], braked: ["linkedin"], posts: 9 },
      { mode: "approval", allowSocial: false },
    );
    expect(refusalOf(all)).toContain("aprobación");
    expect(refusalOf({ ...all, approved: true })).toContain("redes sociales");
    expect(refusalOf({ ...all, approved: true, ws: { ...all.ws, allowSocial: true } })).toContain("permiso para publicar");
    expect(
      refusalOf({ ...all, approved: true, channels: ["instagram"], braked: ["instagram"], ws: { ...all.ws, allowSocial: true } }),
    ).toContain("frenados");
    expect(
      refusalOf({ ...all, approved: true, channels: ["instagram"], braked: [], ws: { ...all.ws, allowSocial: true } }),
    ).toContain("límite diario");
  });
});

describe("approvedAfterReviews", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 16, 12, minutes));
  const review = (name: string, minutes: number | null) => ({
    name,
    finishedAt: minutes === null ? null : at(minutes),
  });

  it("solo cuenta una aprobación posterior a la última revisión", () => {
    const reviews = [review("review", 10), review("review-r1", 20)];
    expect(approvedAfterReviews(at(25), reviews)).toBe(true);
    // Approved after the first review but before the second one (a video's cost, an old approval...): not enough.
    expect(approvedAfterReviews(at(15), reviews)).toBe(false);
    expect(approvedAfterReviews(at(5), reviews)).toBe(false);
    // At the very same instant is not after it.
    expect(approvedAfterReviews(at(20), reviews)).toBe(false);
    // The order the rows come in does not matter.
    expect(approvedAfterReviews(at(15), [...reviews].reverse())).toBe(false);
  });

  it("sin aprobación no hay aprobación, y una revisión sin terminar no deja pasar", () => {
    expect(approvedAfterReviews(null, [review("review", 10)])).toBe(false);
    expect(approvedAfterReviews(at(30), [review("review", 10), review("review-r1", null)])).toBe(false);
  });

  it("only review steps count", () => {
    // Other steps (and names that only start like a review) are not reviews.
    expect(approvedAfterReviews(at(15), [review("review", 10), review("reviewer", 50), review("schedule", 40)])).toBe(true);
    // A piece with no review yet only needs the approval.
    expect(approvedAfterReviews(at(15), [])).toBe(true);
  });
});

describe("pieceScheduleAt", () => {
  const now = new Date("2026-10-16T14:00:00Z");
  const soon = new Date(now.getTime() + 60000);

  it("without a storm a piece goes out in a minute, as the agent's campaigns do", () => {
    expect(pieceScheduleAt({}, now)).toEqual(soon);
    expect(pieceScheduleAt(null, now)).toEqual(soon);
    expect(pieceScheduleAt({ storm: { event: "huracan" } }, now)).toEqual(soon);
    expect(pieceScheduleAt({ storm: { event: "huracan", at: "no es una fecha" } }, now)).toEqual(soon);
    expect(pieceScheduleAt({ storm: { at: 12345 } }, now)).toEqual(soon);
  });

  it("after a storm it waits for the hours the storm rules allow", () => {
    // Friday 9:30 am in Miami, half an hour before `now`: the help post goes out an hour after the storm.
    const at = "2026-10-16T13:30:00Z";
    expect(stormSchedule(new Date(at), 0, "seguridad").getTime()).toBeGreaterThan(soon.getTime());
    // The phase defaults to "seguridad" (help, no offer).
    expect(pieceScheduleAt({ storm: { event: "huracan", at } }, now)).toEqual(stormSchedule(new Date(at), 0, "seguridad"));
    expect(pieceScheduleAt({ storm: { event: "huracan", at, phase: "seguridad" } }, now)).toEqual(
      stormSchedule(new Date(at), 0, "seguridad"),
    );
    // An offer waits more than 48 hours after the storm.
    const offer = pieceScheduleAt({ storm: { event: "huracan", at, phase: "oferta" } }, now);
    expect(offer).toEqual(stormSchedule(new Date(at), 0, "oferta"));
    expect(offer.getTime() - Date.parse(at)).toBeGreaterThan(48 * 3600000);
    // A phase it does not know is the safe one.
    expect(pieceScheduleAt({ storm: { at, phase: "otra" } }, now)).toEqual(stormSchedule(new Date(at), 0, "seguridad"));
  });

  it("never schedules in the past: an old storm goes out in a minute", () => {
    expect(pieceScheduleAt({ storm: { event: "huracan", at: "2026-10-01T19:00:00Z" } }, now)).toEqual(soon);
  });
});
