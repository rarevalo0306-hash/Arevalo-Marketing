import { describe, expect, it } from "vitest";
import { DEFAULT_CLIENT_ORG, ORG_NAME_MAX, groupByClientOrg, readOrgName } from "@/lib/client-orgs";

describe("client organization rules", () => {
  it("exposes the default name and the name limit", () => {
    expect(DEFAULT_CLIENT_ORG).toBe("Mis compañías");
    expect(ORG_NAME_MAX).toBe(120);
  });

  it("readOrgName trims and bounds the name", () => {
    expect(readOrgName("  Juan Pérez  ")).toBe("Juan Pérez");
    expect(readOrgName("")).toBeNull();
    expect(readOrgName("   ")).toBeNull();
    expect(readOrgName("x".repeat(120))).toBe("x".repeat(120));
    expect(readOrgName("x".repeat(121))).toBeNull();
    expect(readOrgName("<b>Juan</b>")).toBe("<b>Juan</b>"); // stored as typed; React escapes it
  });

  it("groupByClientOrg keeps order and never yields an empty group", () => {
    const b = (id: string, org: string) => ({ id, clientOrg: { id: org, name: org.toUpperCase() } });
    expect(groupByClientOrg([b("1", "a"), b("2", "b"), b("3", "a")])).toEqual([
      { id: "a", name: "A", businesses: [b("1", "a"), b("3", "a")] },
      { id: "b", name: "B", businesses: [b("2", "b")] },
    ]);
    expect(groupByClientOrg([])).toEqual([]);
  });
});
