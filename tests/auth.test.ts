import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookie: "", user: vi.fn(), business: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (mocks.cookie ? { value: mocks.cookie } : undefined) }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/i18n-server", () => ({ getT: async () => ({ lang: "en", t: (_es: string, en: string) => en }) }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: mocks.user }, business: { findUnique: mocks.business } } }));

import { AccessError, businessAccess, deniedText, hasBusiness, myBusinessesWhere, newBusinessOrganizationId, pageBusiness, requireBusiness, requireOrgAdmin } from "@/lib/auth";
import { createSession } from "@/lib/session";

const org = (id: string) => ({ id, name: id, kind: "personal" });
const person = (memberships: { organizationId: string; role: string; allBusinesses?: boolean; businessIds?: string[] }[], sessionVersion = 0) => ({
  id: "u1",
  email: "ana@gmail.com",
  name: "Ana",
  sessionVersion,
  memberships: memberships.map((m) => ({
    organizationId: m.organizationId,
    role: m.role,
    allBusinesses: m.allBusinesses ?? true,
    businesses: (m.businessIds ?? []).map((businessId) => ({ businessId })),
    organization: org(m.organizationId),
  })),
});
const businesses: Record<string, string> = { bizA: "orgA", bizA2: "orgA", bizB: "orgB" };

beforeEach(async () => {
  vi.stubEnv("APP_PASSWORD", "pass");
  vi.stubEnv("APP_SECRET", "secret");
  mocks.cookie = await createSession("u1", 0);
  mocks.business.mockImplementation(async ({ where }: { where: { id: string } }) => (businesses[where.id] ? { organizationId: businesses[where.id] } : null));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("business access", () => {
  it("lets members in only to the businesses of their organizations", async () => {
    mocks.user.mockResolvedValue(person([{ organizationId: "orgA", role: "publisher" }]));
    expect(await businessAccess("bizA", "publish")).toMatchObject({ ok: true, role: "publisher" });
    expect(await businessAccess("bizB", "view")).toEqual({ ok: false, status: 404 });
    expect(await businessAccess("missing", "view")).toEqual({ ok: false, status: 404 });
    expect(await businessAccess("../bizA", "view")).toEqual({ ok: false, status: 404 });
  });

  it("checks the role against what is asked", async () => {
    mocks.user.mockResolvedValue(person([{ organizationId: "orgA", role: "viewer" }]));
    expect(await hasBusiness("bizA", "view")).toBe(true);
    expect(await businessAccess("bizA", "publish")).toEqual({ ok: false, status: 403 });
    await expect(requireBusiness("bizA", "admin")).rejects.toMatchObject({ status: 403 });
  });

  it("an unknown role in the database gives no access", async () => {
    mocks.user.mockResolvedValue(person([{ organizationId: "orgA", role: "owner" }]));
    expect(await businessAccess("bizA", "view")).toEqual({ ok: false, status: 404 });
  });

  it("without a valid session: 401, and pages and actions go to /login", async () => {
    mocks.cookie = "";
    expect(await businessAccess("bizA")).toEqual({ ok: false, status: 401 });
    await expect(requireBusiness("bizA")).rejects.toThrow("REDIRECT /login");
    await expect(pageBusiness("bizA")).rejects.toThrow("REDIRECT /login");
  });

  it("a session from an older version or a deleted person no longer works", async () => {
    mocks.user.mockResolvedValue(person([{ organizationId: "orgA", role: "admin" }], 1));
    expect(await businessAccess("bizA")).toEqual({ ok: false, status: 401 });
    mocks.user.mockResolvedValue(null);
    expect(await businessAccess("bizA")).toEqual({ ok: false, status: 401 });
  });

  it("actions get a translated error and pages a 404, without saying whether the business exists", async () => {
    mocks.user.mockResolvedValue(person([{ organizationId: "orgA", role: "admin" }]));
    const e = await requireBusiness("bizB").catch((x) => x);
    expect(e).toBeInstanceOf(AccessError);
    expect(e).toMatchObject({ status: 404, message: "Business not found" });
    await expect(pageBusiness("bizB")).rejects.toThrow("NOT_FOUND");
  });

  it("lists only the businesses of the person's organizations", async () => {
    mocks.user.mockResolvedValue(person([{ organizationId: "orgA", role: "viewer" }, { organizationId: "orgC", role: "admin" }]));
    expect(await myBusinessesWhere()).toEqual({ OR: [{ organizationId: { in: ["orgA", "orgC"] } }] });
  });

  it("a member limited to some businesses only enters those", async () => {
    mocks.user.mockResolvedValue(person([{ organizationId: "orgA", role: "publisher", allBusinesses: false, businessIds: ["bizA"] }]));
    expect(await businessAccess("bizA", "publish")).toMatchObject({ ok: true, role: "publisher" });
    expect(await businessAccess("bizA2", "view")).toEqual({ ok: false, status: 404 });
    expect(await myBusinessesWhere()).toEqual({ OR: [{ organizationId: { in: [] } }, { id: "bizA", organizationId: "orgA" }] });
  });

  it("an Administrator always enters every business of the organization, whatever is stored", async () => {
    mocks.user.mockResolvedValue(person([{ organizationId: "orgA", role: "admin", allBusinesses: false, businessIds: [] }]));
    expect(await businessAccess("bizA2", "admin")).toMatchObject({ ok: true, role: "admin" });
  });

  it("explains a role that falls short instead of saying the business doesn't exist", async () => {
    mocks.user.mockResolvedValue(person([{ organizationId: "orgA", role: "viewer" }]));
    expect(await deniedText("bizA", "publish")).toContain("View only");
    expect(await deniedText("bizA", "admin")).toBe("Only the Administrator can do this.");
    expect(await deniedText("bizB", "view")).toBe("Business not found");
    expect(await deniedText("bizA", "view")).toBe("");
  });

  it("only an Administrator of that organization manages its team", async () => {
    mocks.user.mockResolvedValue(person([{ organizationId: "orgA", role: "admin" }, { organizationId: "orgB", role: "publisher" }]));
    await expect(requireOrgAdmin("orgA")).resolves.toMatchObject({ id: "u1" });
    await expect(requireOrgAdmin("orgB")).rejects.toMatchObject({ status: 403 });
    await expect(requireOrgAdmin("orgZ")).rejects.toMatchObject({ status: 403 });
  });

  it("new businesses go to the first organization where the person is Administrator", async () => {
    mocks.user.mockResolvedValue(person([{ organizationId: "orgA", role: "viewer" }, { organizationId: "orgC", role: "admin" }]));
    expect(await newBusinessOrganizationId()).toBe("orgC");
    mocks.user.mockResolvedValue(person([{ organizationId: "orgA", role: "publisher" }]));
    await expect(newBusinessOrganizationId()).rejects.toMatchObject({ status: 403 });
  });
});
