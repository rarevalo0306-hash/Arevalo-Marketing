import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ deleted: [] as string[], accepted: null as null | { id: string; sessionVersion: number }, cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: state.cookie }), delete: (n: string) => state.deleted.push(n), set: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`redirect:${to}`), { to });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ id: "usr_1", email: "ana@ejemplo.com" }), requireOrgAdmin: vi.fn() }));
vi.mock("@/lib/i18n-server", () => ({ getT: async () => ({ lang: "es", t: (es: string) => es }) }));
vi.mock("@/lib/team", () => ({ acceptInvitation: async () => state.accepted }));

import { acceptInvitationAction } from "@/app/actions-team";
import { createSession, SESSION_COOKIE } from "@/lib/session";

const TOKEN = "A".repeat(43);

beforeEach(async () => {
  vi.stubEnv("APP_PASSWORD", "pass");
  vi.stubEnv("APP_SECRET", "secret");
  state.deleted = [];
  state.cookie = await createSession("usr_1", 3);
});

describe("accepting an invitation while signed in", () => {
  it("keeps the session when accepting didn't close it", async () => {
    state.accepted = { id: "usr_1", sessionVersion: 3 };
    await expect(acceptInvitationAction(TOKEN)).rejects.toMatchObject({ to: "/" });
    expect(state.deleted).toEqual([]);
  });

  it("never hands out a new session when accepting closed the account's sessions (a password from another org's link)", async () => {
    state.accepted = { id: "usr_1", sessionVersion: 4 };
    await expect(acceptInvitationAction(TOKEN)).rejects.toMatchObject({ to: "/login?aceptada=1" });
    expect(state.deleted).toEqual([SESSION_COOKIE]);
  });

  it("explains when the invitation isn't for this email or no longer works", async () => {
    state.accepted = null;
    expect(await acceptInvitationAction(TOKEN)).toMatchObject({ ok: false });
  });
});
