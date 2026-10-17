import { describe, expect, it } from "vitest";
import { DEFAULT_CLIENT_ORG, ORG_NAME_MAX, groupByAccount, groupByClientOrg, readOrgName } from "@/lib/client-orgs";

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

  it("groupByAccount puts each account above its organizations, in the person's account order", () => {
    const b = (id: string, account: string, org: string) => ({ id, organizationId: account, clientOrg: { id: org, name: org.toUpperCase() } });
    const accounts = [
      { id: "acc2", name: "Estudio Luna" },
      { id: "acc1", name: "Ricardo Arevalo" },
      { id: "acc3", name: "Vacía" },
    ];
    expect(groupByAccount(accounts, [b("1", "acc1", "a"), b("2", "acc2", "c"), b("3", "acc1", "b"), b("4", "acc1", "a")])).toEqual([
      { id: "acc2", name: "Estudio Luna", groups: [{ id: "c", name: "C", businesses: [b("2", "acc2", "c")] }] },
      {
        id: "acc1",
        name: "Ricardo Arevalo",
        groups: [
          { id: "a", name: "A", businesses: [b("1", "acc1", "a"), b("4", "acc1", "a")] },
          { id: "b", name: "B", businesses: [b("3", "acc1", "b")] },
        ],
      },
      // An account with no business to show still shows its name, with nothing under it.
      { id: "acc3", name: "Vacía", groups: [] },
    ]);
    // A business of an account the person does not belong to is never shown.
    expect(groupByAccount([{ id: "acc1", name: "Ricardo Arevalo" }], [b("9", "otra", "x")])).toEqual([{ id: "acc1", name: "Ricardo Arevalo", groups: [] }]);
  });
});
