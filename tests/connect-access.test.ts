// «Puede conectar»: conecta las cuentas de Google (Perfil de Negocio, YouTube, Search Console y Analytics) de sus
// empresas, nada más. Facebook, Instagram, los datos pegados a mano y Brevo siguen siendo del Administrador.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookie: "", user: vi.fn(), business: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (mocks.cookie ? { value: mocks.cookie } : undefined) }) }));
vi.mock("@/lib/i18n-server", () => ({ getT: async () => ({ lang: "en", t: (_es: string, en: string) => en }) }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: mocks.user }, business: { findUnique: mocks.business } } }));

import { GET as ga4Start } from "@/app/api/ga4/start/route";
import { GET as googleStart } from "@/app/api/google/start/route";
import { GET as gscStart } from "@/app/api/gsc/start/route";
import { GET as metaStart } from "@/app/api/meta/start/route";
import { GET as youtubeStart } from "@/app/api/youtube/start/route";
import { createSession } from "@/lib/session";

const ROOT = join(__dirname, "..");
const businesses: Record<string, string> = { bizA: "orgA", bizA2: "orgA" };
const person = (role: string, businessIds: string[] | null) => ({
  id: "u1",
  email: "reviewer@gmail.com",
  name: "Reviewer",
  sessionVersion: 0,
  memberships: [
    {
      organizationId: "orgA",
      role,
      allBusinesses: businessIds === null,
      businesses: (businessIds ?? []).map((businessId) => ({ businessId })),
      organization: { id: "orgA", name: "orgA", kind: "personal" },
    },
  ],
});

const STARTS = { google: googleStart, youtube: youtubeStart, gsc: gscStart, ga4: ga4Start };
const start = (route: keyof typeof STARTS, businessId: string) => STARTS[route](new Request(`https://app.example/api/${route}/start?b=${businessId}`));

beforeEach(async () => {
  vi.stubEnv("APP_PASSWORD", "pass");
  vi.stubEnv("APP_SECRET", "secret");
  vi.stubEnv("GOOGLE_CLIENT_ID", "client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
  vi.stubEnv("META_APP_ID", "meta-app");
  vi.stubEnv("META_APP_SECRET", "meta-secret");
  vi.stubEnv("PUBLIC_BASE_URL", "https://app.example");
  mocks.cookie = await createSession("u1", 0);
  mocks.business.mockImplementation(async ({ where }: { where: { id: string } }) => (businesses[where.id] ? { organizationId: businesses[where.id] } : null));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("connecting Google accounts", () => {
  it("Can connect, limited to one business, goes to Google for that business only", async () => {
    mocks.user.mockResolvedValue(person("manager", ["bizA"]));
    for (const route of Object.keys(STARTS) as (keyof typeof STARTS)[]) {
      const ok = await start(route, "bizA");
      expect(ok.status, route).toBe(302);
      expect(ok.headers.get("location"), route).toMatch(/^https:\/\/accounts\.google\.com\//);
      expect((await start(route, "bizA2")).status, route).toBe(404);
    }
  });

  it("Can publish and View only get a clear 403, the Administrator gets through", async () => {
    for (const role of ["publisher", "viewer"]) {
      mocks.user.mockResolvedValue(person(role, null));
      for (const route of Object.keys(STARTS) as (keyof typeof STARTS)[]) expect((await start(route, "bizA")).status, `${role} ${route}`).toBe(403);
    }
    mocks.user.mockResolvedValue(person("admin", ["bizA"]));
    for (const route of Object.keys(STARTS) as (keyof typeof STARTS)[]) expect((await start(route, "bizA2")).status, route).toBe(302);
  });

  it("Facebook and Instagram stay with the Administrator", async () => {
    mocks.user.mockResolvedValue(person("manager", null));
    expect((await metaStart(new Request("https://app.example/api/meta/start?b=bizA"))).status).toBe(403);
  });
});

/** El cuerpo de una función de nivel superior del archivo. */
function body(path: string, name: string): string {
  const file = join(ROOT, path);
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  for (const st of source.statements) if (ts.isFunctionDeclaration(st) && st.name?.text === name && st.body) return st.body.getText(source);
  throw new Error(`${name} not found in ${path}`);
}

describe("every Google connect, choose and disconnect step asks for «connect»", () => {
  it("the Google callback, the choosers and their actions", () => {
    expect(body("src/app/api/google/callback/route.ts", "GET")).toContain('businessAccess(businessId, "connect")');
    expect(body("src/app/b/[id]/conexiones/google/page.tsx", "ElegirUbicacionGoogle")).toContain('pageBusiness(id, "connect")');
    expect(body("src/app/b/[id]/seo/gsc/page.tsx", "ElegirSitioSearchConsole")).toContain('pageBusiness(id, "connect")');
    expect(body("src/app/actions.ts", "chooseGoogleLocation")).toContain('business(businessId, "connect")');
    expect(body("src/app/actions-seo-gsc.ts", "chooseGscSite")).toContain('ensureBusiness(businessId, "connect")');
    expect(body("src/app/actions-ga4.ts", "chooseGa4Property")).toContain('ensureBusiness(businessId, "connect")');
    expect(body("src/app/actions-ga4.ts", "changeGa4Property")).toContain('ensureBusiness(businessId, "connect")');
  });

  it("disconnecting and testing: Google with «connect», every other channel with «admin»", () => {
    expect(body("src/app/actions.ts", "deleteConnection")).toContain('requireBusiness(businessId, google ? "connect" : "admin")');
    expect(body("src/app/actions.ts", "testConnection")).toMatch(/GOOGLE_CHANNELS\.some\([^)]*\) \? "connect" : "admin"/);
  });

  it("Facebook, Instagram, pasted keys and Brevo stay with the Administrator", () => {
    for (const name of ["saveConnection", "connectBrevo", "chooseMetaPage"]) expect(body("src/app/actions.ts", name), name).toContain('business(businessId, "admin")');
    expect(body("src/app/api/meta/callback/route.ts", "GET")).toContain('businessAccess(businessId, "admin")');
  });
});
