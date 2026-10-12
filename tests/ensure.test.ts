import { describe, expect, it } from "vitest";
import { ensure, InvalidArgs } from "@/lib/ensure";

describe("server action arguments must be plain values", () => {
  it("accepts the declared types", () => {
    expect(() => ensure.text("biz1", "")).not.toThrow();
    expect(() => ensure.optionalText(null, undefined, "x")).not.toThrow();
    expect(() => ensure.number(0, 3.5)).not.toThrow();
    expect(() => ensure.optionalNumber(null, 2)).not.toThrow();
    expect(() => ensure.flag(true, false)).not.toThrow();
    expect(() => ensure.texts([], ["a", "b"])).not.toThrow();
    expect(() => ensure.optionalTexts(undefined, ["a"])).not.toThrow();
  });

  it("rejects objects that Prisma would read as filters, and other wrong types", () => {
    for (const bad of [{ in: ["a", "b"] }, { not: "x" }, ["a"], null, undefined, 1, true]) expect(() => ensure.text(bad), JSON.stringify(bad)).toThrow(InvalidArgs);
    expect(() => ensure.optionalText({ not: "x" })).toThrow(InvalidArgs);
    expect(() => ensure.number(NaN)).toThrow(InvalidArgs);
    expect(() => ensure.number("1")).toThrow(InvalidArgs);
    expect(() => ensure.flag("true")).toThrow(InvalidArgs);
    expect(() => ensure.texts(["a", { in: [] }])).toThrow(InvalidArgs);
    expect(() => ensure.texts(Array.from({ length: 501 }, () => "a"))).toThrow(InvalidArgs);
  });
});
