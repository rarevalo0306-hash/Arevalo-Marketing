// El guardia del equipo, parte pura: un canal queda frenado cuando sus dos últimos envíos del agente fallaron; una pieza se
// programa solo si lo permiten los interruptores, la aprobación, los canales y el cupo del día; y a qué hora sale.
import { describe, expect, it } from "vitest";
import {
  approvedAfterReviews,
  articleRefusal,
  brakedChannels,
  pieceScheduleAt,
  refusalOf,
  switchesRefusal,
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

describe("switchesRefusal", () => {
  const on = { pausedAt: null, teamMode: true, enabled: true, allowPublish: true };

  it("no dice nada cuando todo está encendido, y cada interruptor apagado tiene su mensaje (la pausa va primero)", () => {
    expect(switchesRefusal(on)).toBeNull();
    expect(switchesRefusal({ ...on, pausedAt: new Date() })).toContain("pausa");
    expect(switchesRefusal({ ...on, teamMode: false })).toContain("modo equipo");
    expect(switchesRefusal({ ...on, enabled: false })).toContain("apagada");
    expect(switchesRefusal({ ...on, allowPublish: false })).toContain("permiso de publicación");
    expect(switchesRefusal({ pausedAt: new Date(), teamMode: false, enabled: false, allowPublish: false })).toContain("pausa");
  });

  it("son las mismas palabras de refusalOf, que solo les suma que la publicación quedó como borrador", () => {
    const ws = { ...on, mode: "auto", allowSocial: true, allowWebArticles: true, channels: ["facebook"], maxPostsPerDay: 2 };
    for (const off of [{ pausedAt: new Date() }, { teamMode: false }, { enabled: false }, { allowPublish: false }]) {
      const w = { ...ws, ...off };
      const facts: GuardFacts = { ws: w, format: "post", approved: true, channels: ["facebook"], connected: ["facebook"], braked: [], posts: 0 };
      expect(refusalOf(facts)).toBe(`${switchesRefusal(w)} La publicación quedó como borrador.`);
    }
  });
});

describe("articleRefusal", () => {
  const ws: GuardFacts["ws"] = {
    pausedAt: null,
    teamMode: true,
    enabled: true,
    allowPublish: true,
    mode: "approval",
    allowSocial: false,
    allowWebArticles: true,
    channels: [],
    maxPostsPerDay: 1,
  };
  const website = ["seo"];

  it("deja escribir un artículo cuando se puede publicar, sin pedir aprobación ni contar el cupo del día (un artículo no es una publicación)", () => {
    // Approval mode, no social channels and no social posts allowed: none of it matters before the article is written.
    expect(articleRefusal(ws, website)).toBeNull();
    expect(articleRefusal({ ...ws, mode: "auto" }, website)).toBeNull();
  });

  it("no deja gastar en un artículo si el día ya llegó a su límite de publicaciones: publicarlo contaría una más", () => {
    const two = { ...ws, maxPostsPerDay: 2 };
    expect(articleRefusal(two, website)).toBeNull();
    expect(articleRefusal(two, website, 1)).toBeNull();
    expect(articleRefusal(two, website, 2)).toBe("Se alcanzó el límite diario de publicaciones de MATYA.");
    expect(articleRefusal(two, website, 5)).toContain("límite diario");
    // The switches still go first.
    expect(articleRefusal({ ...two, pausedAt: new Date() }, website, 2)).toContain("pausa");
  });

  it("no deja gastar en un artículo que no se podría publicar, con las mismas palabras del guardia y sin «borrador»", () => {
    const off = (w: Partial<GuardFacts["ws"]>, connected = website) => articleRefusal({ ...ws, ...w }, connected);
    expect(off({ pausedAt: new Date() })).toContain("pausa");
    expect(off({ teamMode: false })).toContain("modo equipo");
    expect(off({ enabled: false })).toContain("apagada");
    expect(off({ allowPublish: false })).toContain("permiso de publicación");
    expect(off({ allowWebArticles: false })).toContain("permiso para publicar en seo");
    expect(off({}, ["facebook"])).toContain("no están conectados: seo");
    expect(off({}, [])).toContain("no están conectados: seo");
    for (const w of [{ pausedAt: new Date() }, { allowWebArticles: false }, { allowPublish: false }])
      expect(off(w)).not.toContain("borrador");
    // The pause still goes first.
    expect(off({ pausedAt: new Date(), allowWebArticles: false })).toContain("pausa");
    expect(articleRefusal(ws, website)).toBe(refusalOf({ ws: { ...ws, mode: "auto" }, format: "articulo", approved: true, channels: ["seo"], connected: website, braked: [], posts: 0 }));
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
  const ny = "America/New_York";
  const now = new Date("2026-10-16T14:00:00Z"); // Friday 10 am in Miami
  const soon = new Date(now.getTime() + 60000);
  const GENERAL = "general";
  const PA = "public-adjusting-fl";

  it("without a storm a piece goes out in a minute, as the agent's campaigns do, when that is inside the posting window", () => {
    for (const industry of [GENERAL, PA, "commercial-security-ni"]) {
      expect(pieceScheduleAt({}, now, ny, industry)).toEqual(soon);
      expect(pieceScheduleAt(null, now, ny, industry)).toEqual(soon);
      expect(pieceScheduleAt({ storm: { event: "huracan" } }, now, ny, industry)).toEqual(soon);
      expect(pieceScheduleAt({ storm: { event: "huracan", at: "no es una fecha" } }, now, ny, industry)).toEqual(soon);
      expect(pieceScheduleAt({ storm: { at: 12345 } }, now, ny, industry)).toEqual(soon);
    }
  });

  describe("every piece goes through a posting window (R39)", () => {
    it("a public adjuster's piece asked for at 7 am waits for 9 am the same day", () => {
      const seven = new Date("2026-10-16T11:00:00Z"); // Friday 7 am in Miami
      expect(pieceScheduleAt({}, seven, ny, PA)).toEqual(new Date("2026-10-16T13:00:00Z"));
    });

    it("a public adjuster never posts on a Sunday: it waits for Monday 9 am", () => {
      const sunday = new Date("2026-10-18T15:00:00Z"); // Sunday 11 am in Miami
      expect(pieceScheduleAt({}, sunday, ny, PA)).toEqual(new Date("2026-10-19T13:00:00Z"));
    });

    it("a public adjuster's piece asked for at 10 pm on a Saturday waits for Monday 9 am", () => {
      const saturdayNight = new Date("2026-10-18T02:00:00Z"); // Saturday 10 pm in Miami
      expect(pieceScheduleAt({}, saturdayNight, ny, PA)).toEqual(new Date("2026-10-19T13:00:00Z"));
    });

    it("another business's piece at 10 pm waits for 9 am the next day, and a Sunday is allowed", () => {
      const saturdayNight = new Date("2026-10-18T02:00:00Z"); // Saturday 10 pm in Miami
      expect(pieceScheduleAt({}, saturdayNight, ny, GENERAL)).toEqual(new Date("2026-10-18T13:00:00Z")); // Sunday 9 am
      const sunday = new Date("2026-10-18T15:00:00Z"); // Sunday 11 am
      expect(pieceScheduleAt({}, sunday, ny, GENERAL)).toEqual(new Date(sunday.getTime() + 60000));
      const seven = new Date("2026-10-16T11:00:00Z"); // Friday 7 am
      expect(pieceScheduleAt({}, seven, ny, "commercial-security-ni")).toEqual(new Date("2026-10-16T13:00:00Z"));
    });

    it("the window ends at 7 pm: a piece at 6:59:30 pm goes out the next morning", () => {
      const late = new Date("2026-10-16T22:59:30Z"); // Friday 6:59:30 pm in Miami: in a minute it is 7 pm
      expect(pieceScheduleAt({}, late, ny, GENERAL)).toEqual(new Date("2026-10-17T13:00:00Z"));
      expect(pieceScheduleAt({}, late, ny, PA)).toEqual(new Date("2026-10-17T13:00:00Z")); // Saturday 9 am
    });

    it("a piece made for a public adjuster keeps the offer window even if the industry setting changed after", () => {
      const sunday = new Date("2026-10-18T15:00:00Z");
      expect(pieceScheduleAt({ industry: { key: PA } }, sunday, ny, GENERAL)).toEqual(new Date("2026-10-19T13:00:00Z"));
      expect(pieceScheduleAt({ industry: { key: GENERAL } }, sunday, ny, GENERAL)).toEqual(new Date(sunday.getTime() + 60000));
    });

    it("uses the business's own time zone", () => {
      // 7:30 pm in Miami is already late; it is 6:30 pm in Chicago, still within the hours.
      const evening = new Date("2026-10-15T23:30:00Z");
      expect(pieceScheduleAt({}, evening, ny, PA)).toEqual(new Date("2026-10-16T13:00:00Z"));
      expect(pieceScheduleAt({}, evening, "America/Chicago", PA)).toEqual(new Date(evening.getTime() + 60000));
      // Managua (UTC-6, no summer time): 8 am there waits for 9 am there.
      const managua = new Date("2026-10-16T14:00:00Z");
      expect(pieceScheduleAt({}, managua, "America/Managua", "commercial-security-ni")).toEqual(new Date("2026-10-16T15:00:00Z"));
    });
  });

  it("after a storm it waits for the hours the storm rules allow", () => {
    // Friday 9:30 am in Miami, half an hour before `now`: the help post goes out an hour after the storm.
    const at = "2026-10-16T13:30:00Z";
    expect(stormSchedule(new Date(at), 0, "seguridad", ny).getTime()).toBeGreaterThan(soon.getTime());
    // The phase defaults to "seguridad" (help, no offer).
    expect(pieceScheduleAt({ storm: { event: "huracan", at } }, now, ny, GENERAL)).toEqual(stormSchedule(new Date(at), 0, "seguridad", ny));
    expect(pieceScheduleAt({ storm: { event: "huracan", at, phase: "seguridad" } }, now, ny, GENERAL)).toEqual(
      stormSchedule(new Date(at), 0, "seguridad", ny),
    );
    // An offer waits more than 48 hours after the storm.
    const offer = pieceScheduleAt({ storm: { event: "huracan", at, phase: "oferta" } }, now, ny, PA);
    expect(offer).toEqual(stormSchedule(new Date(at), 0, "oferta", ny));
    expect(offer.getTime() - Date.parse(at)).toBeGreaterThan(48 * 3600000);
    // A phase it does not know is the safe one.
    expect(pieceScheduleAt({ storm: { at, phase: "otra" } }, now, ny, GENERAL)).toEqual(stormSchedule(new Date(at), 0, "seguridad", ny));
  });

  it("an old storm goes out in a minute when that is inside the allowed hours", () => {
    expect(pieceScheduleAt({ storm: { event: "huracan", at: "2026-10-01T19:00:00Z" } }, now, ny, GENERAL)).toEqual(soon);
  });

  it("an old storm still keeps the allowed hours: at 9 pm the post waits for 9 am the next day", () => {
    const night = new Date("2026-10-16T01:00:00Z"); // Thursday 9 pm in Miami
    expect(pieceScheduleAt({ storm: { event: "huracan", at: "2026-10-01T19:00:00Z" } }, night, ny, GENERAL)).toEqual(
      new Date("2026-10-16T13:00:00Z"), // Friday 9 am
    );
    // An offer on a Sunday waits for Monday 9 am; help may go out on a Sunday (R29b: a storm piece keeps its phase's window).
    const sunday = new Date("2026-10-18T15:00:00Z"); // Sunday 11 am
    const old = { event: "huracan", at: "2026-10-10T19:00:00Z" };
    expect(pieceScheduleAt({ storm: { ...old, phase: "oferta" } }, sunday, ny, GENERAL)).toEqual(new Date("2026-10-19T13:00:00Z"));
    expect(pieceScheduleAt({ storm: old }, sunday, ny, GENERAL)).toEqual(new Date(sunday.getTime() + 60000));
  });

  it("a storm piece uses the business's own time zone", () => {
    const old = { storm: { event: "huracan", at: "2026-10-01T19:00:00Z" } };
    // 7:30 pm in Miami is already late; it is 6:30 pm in Chicago, still within the hours.
    const evening = new Date("2026-10-15T23:30:00Z");
    expect(pieceScheduleAt(old, evening, ny, GENERAL)).toEqual(new Date("2026-10-16T13:00:00Z"));
    expect(pieceScheduleAt(old, evening, "America/Chicago", GENERAL)).toEqual(new Date(evening.getTime() + 60000));
    // 8:30 pm in Chicago: 9 am the next day in Chicago, an hour after 9 am in Miami.
    const late = new Date("2026-10-16T01:30:00Z");
    expect(pieceScheduleAt(old, late, "America/Chicago", GENERAL)).toEqual(new Date("2026-10-16T14:00:00Z"));
  });
});
