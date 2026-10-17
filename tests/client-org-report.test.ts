import { describe, expect, it } from "vitest";
import { dueWeek, readReportSettings, reportWeek, retryable } from "@/lib/client-org-report";
import { BiError } from "@/lib/i18n";
import { rangePeriod } from "@/lib/report-period";

describe("the reported week", () => {
  it("is the Monday-to-Sunday week that just closed, in the organization's zone", () => {
    // Monday 2026-10-19 08:00 in New York
    expect(reportWeek(new Date("2026-10-19T12:00:00Z"), "America/New_York")).toEqual({ week: "2026-10-12", fromDay: "2026-10-12", toDay: "2026-10-18" });
    // Sunday 2026-10-18 23:30 in New York is still inside the week: the closed one is the week before
    expect(reportWeek(new Date("2026-10-19T03:30:00Z"), "America/New_York").week).toBe("2026-10-05");
    // the same instant is already Monday in Madrid
    expect(reportWeek(new Date("2026-10-19T03:30:00Z"), "Europe/Madrid").week).toBe("2026-10-12");
  });
  it("still runs Monday to Monday across the daylight-saving change", () => {
    // New York leaves DST on Sunday 2026-11-01; Monday 2026-11-02 08:00 EST = 13:00Z
    const w = reportWeek(new Date("2026-11-02T13:00:00Z"), "America/New_York");
    expect(w).toEqual({ week: "2026-10-26", fromDay: "2026-10-26", toDay: "2026-11-01" });
    const p = rangePeriod(w.fromDay, w.toDay, "America/New_York");
    expect(p.to.getTime() - p.from.getTime()).toBe((7 * 24 + 1) * 3600_000); // the 25-hour Sunday
  });
});

describe("when the weekly report is due", () => {
  const monday8 = { reportOn: true, reportDay: 1, reportHour: 8 };
  it("Monday 8:00 local: not at 7:59, yes at 8:00 and later that week", () => {
    expect(dueWeek(monday8, new Date("2026-10-19T11:59:00Z"), "America/New_York")).toBeNull();
    expect(dueWeek(monday8, new Date("2026-10-19T12:00:00Z"), "America/New_York")?.week).toBe("2026-10-12");
    expect(dueWeek(monday8, new Date("2026-10-22T20:00:00Z"), "America/New_York")?.week).toBe("2026-10-12");
  });
  it("8:00 local right after the DST change is 13:00Z, not 12:00Z", () => {
    expect(dueWeek(monday8, new Date("2026-11-02T12:30:00Z"), "America/New_York")).toBeNull();
    expect(dueWeek(monday8, new Date("2026-11-02T13:00:00Z"), "America/New_York")?.week).toBe("2026-10-26");
  });
  it("a Sunday send reports the week that closed the Sunday before", () => {
    const sunday18 = { reportOn: true, reportDay: 0, reportHour: 18 };
    expect(dueWeek(sunday18, new Date("2026-10-25T21:59:00Z"), "America/New_York")).toBeNull();
    expect(dueWeek(sunday18, new Date("2026-10-25T22:00:00Z"), "America/New_York")?.week).toBe("2026-10-12");
  });
  it("is never due when the report is off", () => {
    expect(dueWeek({ ...monday8, reportOn: false }, new Date("2026-10-22T20:00:00Z"), "America/New_York")).toBeNull();
  });
});

describe("report settings", () => {
  const ok = { contactName: " Juan Pérez ", reportEmail: "A@x.com; b@y.com", phone: "+1 305 555 0100", reportLang: "en", reportOn: "on", reportDay: "5", reportHour: "17", timezone: "America/Managua" };
  it("trims, parses and keeps valid values", () => {
    expect(readReportSettings(ok)).toEqual({ contactName: "Juan Pérez", reportEmail: "a@x.com, b@y.com", phone: "+1 305 555 0100", reportLang: "en", reportOn: true, reportDay: 5, reportHour: 17, timezone: "America/Managua" });
    expect(readReportSettings({ ...ok, reportOn: "", timezone: "" })).toMatchObject({ reportOn: false, timezone: "" });
  });
  it.each([
    ["reportEmail", "a@x.com, b@x.com, c@x.com, d@x.com"],
    ["reportEmail", "no-es-un-email"],
    ["contactName", "x".repeat(121)],
    ["phone", "1".repeat(41)],
    ["reportLang", "fr"],
    ["reportDay", "7"],
    ["reportHour", "24"],
    ["reportHour", "8.5"],
    ["timezone", "Mars/Olympus"],
  ])("rejects %s = %j with a bilingual error", (key, value) => {
    expect(() => readReportSettings({ ...ok, [key]: value })).toThrow(BiError);
  });
});

describe("retrying a failed automatic send", () => {
  const now = new Date("2026-10-19T13:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  it("retries an error or a stuck send after 30 minutes, up to 3 attempts", () => {
    expect(retryable({ state: "error", attempts: 1, updatedAt: ago(30) }, now)).toBe(true);
    expect(retryable({ state: "sending", attempts: 2, updatedAt: ago(31) }, now)).toBe(true);
    expect(retryable({ state: "error", attempts: 1, updatedAt: ago(29) }, now)).toBe(false);
    expect(retryable({ state: "error", attempts: 3, updatedAt: ago(90) }, now)).toBe(false);
    expect(retryable({ state: "sent", attempts: 1, updatedAt: ago(90) }, now)).toBe(false);
  });
});
