// El guardia del equipo, parte pura: un canal queda frenado cuando sus dos últimos envíos del agente fallaron.
import { describe, expect, it } from "vitest";
import { brakedChannels } from "@/lib/agent/guard";

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
