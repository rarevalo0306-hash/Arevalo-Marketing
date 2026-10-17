# Organizaciones por cliente — Entrega 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each account (today's `Organization`) groups its businesses into client organizations (`ClientOrg`) that its Administrators create, rename, delete and move businesses between, shown grouped in the company picker on desktop and phone, with today's «organización» wording renamed «Cuenta».

**Architecture:** One additive migration adds `ClientOrg` and `ClientOrgReport` (the report table is used by Entrega 2) and a required `Business.clientOrgId` with a composite FK `(clientOrgId, organizationId) → ClientOrg(id, organizationId)` so a business can only sit in an organization of its own account. Pure rules live in `src/lib/client-orgs.ts`, database work in `src/lib/client-orgs-store.ts`, server actions in `src/app/actions-client-orgs.ts` behind `requireOrgAdmin`, and a new `/organizaciones` page. Access of staff stays per business; nothing in MATYA or the per-business reports changes.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Prisma 6, PostgreSQL (Supabase), vitest (`unit` and `database` projects), CSS Modules, `useT()`/`t(es, en)`.

**Spec:** `docs/superpowers/specs/2026-10-17-organizaciones-por-cliente-design.md` (sections «Los nombres», «Decisiones», «Datos», «Entrega 1», «Pruebas»). Entrega 2 (weekly report) has its own plan later; this plan creates its table but no code uses it.

## Global Constraints

- Migration file: `supabase/migrations/20261017180000_client_orgs.sql`, additive, in one transaction, re-runnable (`IF NOT EXISTS`; the backfill only touches `clientOrgId IS NULL`); RLS on and no grants for `anon`/`authenticated` on both new tables, like `20261012190000_users_organizations.sql`.
- New `ClientOrg` ids from SQL: `'corg_' || replace(gen_random_uuid()::text, '-', '')`.
- Default organization name, exactly: `Mis compañías` (stored data, same in both UI languages).
- `ClientOrg.name`: trimmed, 1 to 120 characters.
- `Organization` is not renamed in code or database; only the screen says «Cuenta» / "Account".
- UI copy uses «negocio» like the rest of the app (except the default name above); every string through `t(es, en)`; server errors through `bi(es, en)`.
- Only an Administrator of the account (`requireOrgAdmin(accountId)`) creates, renames, deletes organizations or moves businesses; every write filters by that `organizationId`.
- Server action arguments are plain values checked with `ensure.text(...)` (tests/permission-coverage.test.ts and tests/ensure.test.ts enforce it).
- Local test database only: `postgresql://postgres@127.0.0.1:55439/matya_agent`, with `DATABASE_URL`, `DIRECT_URL` and `MATYA_TEST_DATABASE_URL` all exported to it. Database suites are files named `tests/*-database.test.ts`.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01N6TYBTCrH3PsdJnjsukzYp`.

## Review Focus

- A staff member with access to only some businesses: the picker shows only organizations holding a business they can see, never an empty heading, never another business's name. (Task 2 test: `groupByClientOrg` yields no empty group; Task 5: the picker groups only what `myBusinessesWhere()` returns.)
- An Administrator of two accounts: every action rejects an organization or business of the other account, even with forged ids in the form. (Task 2 and Task 3 tests.)
- Two first businesses created at the same moment in an account with no organization: only one «Mis compañías» is created. (Task 2 test.)
- Deleting an organization while a business is moved into it: the database refuses and the owner reads «Esta organización todavía tiene negocios: muévelos antes de borrarla.», not a crash. (Task 2 test.)
- Names that are blank, only spaces, over 120 characters, or contain HTML: rejected or shown escaped. (Task 2 and Task 3 tests.)

---

### Task 1: Migration, schema and fixtures

**Files:**
- Create: `supabase/migrations/20261017180000_client_orgs.sql`
- Modify: `prisma/schema.prisma` (`Business`, `Organization`, new `ClientOrg`, new `ClientOrgReport`)
- Create: `src/lib/client-orgs-store.ts` (only `ensureDefaultClientOrg` in this task)
- Modify: `src/app/actions-study.ts:286-296` (`createBusinessFromWeb`), `src/app/actions.ts:75-82` (delete the unused `createBusiness`)
- Modify: `scripts/agent-seed-local.mjs:28-34`, `tests/team-database.test.ts`, `tests/agent-database.test.ts`, `tests/agent-team-e2e.test.ts` (fixtures)
- Modify: `docs/agent/testing.md` (step 4: add the new migration to the list)
- Test: `tests/client-orgs-database.test.ts`

**Interfaces:**
- Produces: Prisma models `ClientOrg` (`id, organizationId, name, contactName, reportEmail, phone, reportLang, reportOn, reportDay, reportHour, timezone, createdAt, businesses, reports`) and `ClientOrgReport` (`id, clientOrgId, week, trigger, state, to, attempts, error, createdAt, updatedAt`); `Business.clientOrgId: string` and relation `Business.clientOrg`.
- Produces: `ensureDefaultClientOrg(organizationId: string): Promise<string>` in `src/lib/client-orgs-store.ts` — the id of the account's oldest `ClientOrg`; creates `Mis compañías` when the account has none, inside a transaction that first takes `SELECT pg_advisory_xact_lock(hashtext('client-org:' || $organizationId))`.

- [ ] **Step 1: Write the migration** with the columns and defaults of spec «Datos». The constraints that matter:

```sql
-- ClientOrg: PK id, FK organizationId → "Organization"(id) ON DELETE CASCADE,
-- UNIQUE ("id", "organizationId") named "ClientOrg_id_organizationId_key", INDEX on "organizationId".
-- ClientOrgReport: PK id, FK clientOrgId → "ClientOrg"(id) ON DELETE CASCADE, INDEX ("clientOrgId", "createdAt"),
-- "to" TEXT[] NOT NULL DEFAULT '{}', "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, and:
CREATE UNIQUE INDEX IF NOT EXISTS "ClientOrgReport_cron_week_key" ON "ClientOrgReport" ("clientOrgId", "week") WHERE "trigger" = 'cron';
-- Business: add "clientOrgId" TEXT (nullable), backfill, then:
ALTER TABLE "Business" ALTER COLUMN "clientOrgId" SET NOT NULL;
ALTER TABLE "Business" ADD CONSTRAINT "Business_clientOrgId_organizationId_fkey"
  FOREIGN KEY ("clientOrgId", "organizationId") REFERENCES "ClientOrg"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Business_clientOrgId_idx" ON "Business"("clientOrgId");
```

Backfill: for every `Organization` that has a business with `clientOrgId IS NULL` and no `ClientOrg`, insert one named `Mis compañías`; then set each such business's `clientOrgId` to its account's oldest `ClientOrg`. Wrap constraint creation in `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = …) … $$` blocks, and the REVOKEs in role-existence checks, like the previous migration.

- [ ] **Step 2: Update `prisma/schema.prisma`** to match: `Organization.clientOrgs ClientOrg[]`; `ClientOrg` with `@@unique([id, organizationId])`, `@@index([organizationId])`; `ClientOrgReport` with `@@index([clientOrgId, createdAt])` (the partial unique index lives only in SQL); on `Business`: `clientOrgId String`, `clientOrg ClientOrg @relation(fields: [clientOrgId, organizationId], references: [id, organizationId], onDelete: Restrict)`, `@@index([clientOrgId])`.

Run: `npx prisma validate && npx prisma generate`
Expected: "The schema at prisma/schema.prisma is valid" and the client generated.

- [ ] **Step 3: Apply to the local database twice and check the backfill**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261017180000_client_orgs.sql` (twice), then
`psql "$DATABASE_URL" -tAc 'SELECT count(*) FROM "Business" b LEFT JOIN "ClientOrg" c ON c.id = b."clientOrgId" WHERE c.id IS NULL OR c."organizationId" <> b."organizationId"'`
Expected: both runs end with `COMMIT`; the count is `0`.

Run: `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script`
Expected: empty, or only a `DROP INDEX "ClientOrgReport_cron_week_key"` (the SQL-only partial index).

- [ ] **Step 4: Write the failing database test** `tests/client-orgs-database.test.ts`, guarded like `tests/team-database.test.ts` (`describe.skipIf(!safe)`), with its own accounts `corg-it-a` and `corg-it-b`, created in `beforeEach` and removed in `afterAll` (businesses first, then organizations):

```ts
it("a business cannot sit in an organization of another account", async () => {
  const other = await db.clientOrg.create({ data: { organizationId: "corg-it-b", name: "Otra" } });
  await expect(db.business.create({ data: { id: "corg-it-x", name: "X", organizationId: "corg-it-a", clientOrgId: other.id } }))
    .rejects.toMatchObject({ code: "P2003" });
});
it("the weekly cron row is unique per organization and week; manual and test can repeat", async () => {
  const c = await db.clientOrg.create({ data: { organizationId: "corg-it-a", name: "Juan" } });
  const row = { clientOrgId: c.id, week: "2026-10-12", state: "sent" };
  await db.clientOrgReport.create({ data: { ...row, trigger: "cron" } });
  await expect(db.clientOrgReport.create({ data: { ...row, trigger: "cron" } })).rejects.toMatchObject({ code: "P2002" });
  await db.clientOrgReport.create({ data: { ...row, trigger: "manual" } });
  await db.clientOrgReport.create({ data: { ...row, trigger: "manual" } });
  await db.clientOrgReport.create({ data: { ...row, trigger: "test" } });
  expect(await db.clientOrgReport.count({ where: { clientOrgId: c.id } })).toBe(4);
});
it("ensureDefaultClientOrg creates «Mis compañías» once and then returns the oldest", async () => {
  const first = await ensureDefaultClientOrg("corg-it-a");
  expect(await db.clientOrg.findUnique({ where: { id: first } })).toMatchObject({ name: "Mis compañías", organizationId: "corg-it-a" });
  expect(await ensureDefaultClientOrg("corg-it-a")).toBe(first);
});
```

Run: `npx vitest run --project database tests/client-orgs-database.test.ts`
Expected: FAIL (`ensureDefaultClientOrg` not exported).

- [ ] **Step 5: Implement `ensureDefaultClientOrg`**, then make `createBusinessFromWeb` pass `clientOrgId: await ensureDefaultClientOrg(organizationId)` (Task 4 replaces this with the owner's choice) and delete the unused `createBusiness` in `src/app/actions.ts`.

- [ ] **Step 6: Fix the fixtures** that create businesses: each test file creates a `ClientOrg` per account it uses (ids `<account>-corg`) and passes `clientOrgId`; `scripts/agent-seed-local.mjs` upserts `ClientOrg` `matya-demo-corg` named `Mis compañías` in `matya-demo-org` and passes it in `create`. Add the new migration to the list in `docs/agent/testing.md` step 4.

- [ ] **Step 7: Run everything**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all files pass, including the three new database tests.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261017180000_client_orgs.sql prisma/schema.prisma src/lib/client-orgs-store.ts src/app/actions-study.ts src/app/actions.ts scripts/agent-seed-local.mjs tests/ docs/agent/testing.md
git commit -m "feat(orgs): client organizations table, required Business.clientOrgId, default «Mis compañías»"
```

### Task 2: Organization rules and store

**Files:**
- Create: `src/lib/client-orgs.ts`
- Modify: `src/lib/client-orgs-store.ts`
- Test: `tests/client-orgs.test.ts` (unit), `tests/client-orgs-database.test.ts` (add cases)

**Interfaces:**
- Consumes: `ensureDefaultClientOrg` (Task 1); `bi` from `src/lib/i18n.ts`.
- Produces in `src/lib/client-orgs.ts` (no database):
  - `DEFAULT_CLIENT_ORG = "Mis compañías"`, `ORG_NAME_MAX = 120`
  - `readOrgName(text: string): string | null` — trimmed name, or null when empty or longer than 120.
  - `groupByClientOrg<B extends { clientOrg: { id: string; name: string } }>(businesses: B[]): { id: string; name: string; businesses: B[] }[]` — groups in order of first appearance, keeping each group's business order; no empty groups.
- Produces in `src/lib/client-orgs-store.ts` (all take the account id first and only touch that account):
  - `listClientOrgs(organizationId: string): Promise<{ id: string; name: string; businesses: { id: string; name: string; color: string }[] }[]>` — organizations and businesses in creation order, empty organizations included.
  - `createClientOrg(organizationId: string, name: string): Promise<string>` — validates and trims `name` with `readOrgName`.
  - `renameClientOrg(organizationId: string, clientOrgId: string, name: string): Promise<void>` — same validation.
  - `deleteClientOrg(organizationId: string, clientOrgId: string): Promise<void>`
  - `moveBusiness(organizationId: string, businessId: string, clientOrgId: string): Promise<void>`
  - `clientOrgForNewBusiness(organizationId: string, requested: string): Promise<string>` — `requested` when it is an organization of this account, `ensureDefaultClientOrg` when `requested` is `""`; throws otherwise.
  - Errors (all `bi`): bad name → «Escribe un nombre de 1 a 120 caracteres.» / "Enter a name of 1 to 120 characters."; organization or business not in this account → «Esa organización no es de esta cuenta.» / "That organization isn't in this account."; delete with businesses (checked first, and Prisma `P2003` mapped to the same text) → «Esta organización todavía tiene negocios: muévelos antes de borrarla.» / "This organization still has businesses: move them before deleting it."

- [ ] **Step 1: Write the failing unit tests** in `tests/client-orgs.test.ts`:

```ts
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
```

Run: `npx vitest run --project unit tests/client-orgs.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement `src/lib/client-orgs.ts`**; run the same command — Expected: PASS.

- [ ] **Step 3: Write the failing database tests** (add to `tests/client-orgs-database.test.ts`): create, rename and list in creation order; `renameClientOrg`/`deleteClientOrg`/`moveBusiness` with an organization or business of `corg-it-b` while acting as `corg-it-a` reject with «Esa organización no es de esta cuenta.» and change nothing; deleting an organization with a business rejects with «Esta organización todavía tiene negocios: muévelos antes de borrarla.»; deleting an empty one works; `moveBusiness` changes only `clientOrgId` (its posts and `agentWorkspace` rows stay); `clientOrgForNewBusiness("corg-it-a", "")` returns the default and with an id of `corg-it-b` rejects; two concurrent `ensureDefaultClientOrg("corg-it-a")` on an account with no organizations return the same id and leave exactly one `Mis compañías`:

```ts
const [x, y] = await Promise.all([ensureDefaultClientOrg("corg-it-a"), ensureDefaultClientOrg("corg-it-a")]);
expect(x).toBe(y);
expect(await db.clientOrg.count({ where: { organizationId: "corg-it-a", name: "Mis compañías" } })).toBe(1);
```

Run: `npx vitest run --project database tests/client-orgs-database.test.ts` — Expected: FAIL (functions missing).

- [ ] **Step 4: Implement the store functions.** Writes use `updateMany`/`deleteMany` with `where: { id, organizationId }` and treat `count === 0` as «Esa organización no es de esta cuenta.»; `moveBusiness` first checks the target `ClientOrg` is in the account, then `updateMany({ where: { id: businessId, organizationId }, data: { clientOrgId } })`.

- [ ] **Step 5: Run** `npx vitest run --project database tests/client-orgs-database.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/client-orgs.ts src/lib/client-orgs-store.ts tests/client-orgs.test.ts tests/client-orgs-database.test.ts
git commit -m "feat(orgs): organization rules and account-scoped store"
```

### Task 3: Actions and the «Organizaciones» page

**Files:**
- Create: `src/app/actions-client-orgs.ts`
- Create: `src/app/organizaciones/page.tsx`, `src/components/orgs/ClientOrgs.tsx`, `src/components/orgs/Orgs.module.css`
- Modify: `src/components/Sidebar.tsx` (link «Organizaciones» for account Administrators, desktop and inside `MobileBizMenu` children, next to «Equipo y permisos»)
- Test: `tests/client-orgs-actions.test.ts`, `tests/client-orgs-page.test.tsx`

**Interfaces:**
- Consumes: the store functions and `readOrgName` (Task 2); `requireOrgAdmin`, `requireUser` (`src/lib/auth.ts`); `ensure`; `errorText`; `getT`.
- Produces in `src/app/actions-client-orgs.ts` (`"use server"`), each starting with `ensure.text(...)` on its string arguments and `await requireOrgAdmin(accountId)`, calling `revalidatePath("/organizaciones")` and `revalidatePath("/", "layout")` after a change:
  - `export type OrgResult = { ok: boolean; message: string } | null`
  - `createClientOrgAction(accountId: string, _prev: OrgResult, f: FormData): Promise<OrgResult>` (field `name`)
  - `renameClientOrgAction(accountId: string, clientOrgId: string, _prev: OrgResult, f: FormData): Promise<OrgResult>` (field `name`)
  - `deleteClientOrgAction(accountId: string, clientOrgId: string): Promise<OrgResult>`
  - `moveBusinessAction(accountId: string, businessId: string, _prev: OrgResult, f: FormData): Promise<OrgResult>` (field `clientOrgId`)
  - Success messages: «Listo.» / "Done."; errors: `errorText(e, lang)`.
- Produces: `ClientOrgs` client component props `{ accountId: string; accountName: string; orgs: { id: string; name: string; businesses: { id: string; name: string; color: string }[] }[] }`.

- [ ] **Step 1: Write the failing action tests** (`vi.mock("@/lib/auth")` and `vi.mock("@/lib/client-orgs-store")`, like `tests/save-connection.test.ts`):
  - a caller for whom `requireOrgAdmin` throws `AccessError(…, 403)` gets the rejection and no store function is called;
  - `createClientOrgAction("acc1", null, form({ name: "  Juan  " }))` calls `createClientOrg("acc1", "  Juan  ")` (the store validates and trims) and returns `{ ok: true, message: "Listo." }`;
  - a store `bi` error comes back as `{ ok: false, message: "Esa organización no es de esta cuenta." }`;
  - `moveBusinessAction("acc1", "b1", null, form({ clientOrgId: "c2" }))` calls `moveBusiness("acc1", "b1", "c2")`;
  - a non-string argument throws before `requireOrgAdmin` is called (`ensure`).

Run: `npx vitest run --project unit tests/client-orgs-actions.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement the actions**; run the same command — Expected: PASS. Then `npx vitest run --project unit tests/permission-coverage.test.ts tests/ensure.test.ts` — Expected: PASS without adding exceptions (`requireOrgAdmin` is a business guard).

- [ ] **Step 3: Write the failing page test** `tests/client-orgs-page.test.tsx` rendering `ClientOrgs` with `renderToStaticMarkup` (CSS Module mocked with the Proxy pattern of `tests/agent-team-settings-ui.test.tsx`): two organizations, one with two businesses and one empty; assert the heading «Organizaciones», each organization's name, each business linking to `/b/<id>/inicio`, a «Mover a…» select per business listing the other organizations, «Borrar organización» only on the empty one, «Nueva organización», an organization named `<script>x</script>` rendered escaped, and the English copy ("Organizations", "New organization", "Delete organization").

Run: `npx vitest run --project unit tests/client-orgs-page.test.tsx` — Expected: FAIL.

- [ ] **Step 4: Implement the page and component.** `src/app/organizaciones/page.tsx` follows `src/app/equipo/page.tsx`: `requireUser()`, accounts where the person is `admin`, `?cuenta=<id>` picks one (else the first), no account → «Solo el Administrador puede ver y cambiar las organizaciones.» / "Only the Administrator can see and change the organizations."; tabs «Cuentas que administras» / "Accounts you manage" when more than one; subtitle «Los clientes de «{cuenta}» y sus negocios» / `The clients of "{account}" and their businesses`. Each organization card: name with «Editar nombre» / "Rename" (inline form, «Guardar» / "Save"), its businesses with the move select (label «Mover a…» / "Move to…", button «Mover» / "Move"), «Agregar negocio» linking to `/negocios/nuevo?organizacion=<id>`, and «Borrar organización» only when empty, after `window.confirm` «¿Borrar «{nombre}»? No tiene negocios.» / `Delete "{name}"? It has no businesses.`. Results show next to the form that sent them (`role="status"`). Layout works at 390 px (cards stack, no horizontal scroll) and in the night theme (reuse the color variables `Team.module.css` uses).

- [ ] **Step 5: Run** `npx vitest run --project unit tests/client-orgs-page.test.tsx tests/permission-coverage.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions-client-orgs.ts src/app/organizaciones src/components/orgs src/components/Sidebar.tsx tests/client-orgs-actions.test.ts tests/client-orgs-page.test.tsx
git commit -m "feat(orgs): Organizaciones page with create, rename, delete and move"
```

### Task 4: Choose the organization when adding a business

**Files:**
- Modify: `src/app/negocios/nuevo/page.tsx`, `src/app/actions-study.ts` (`createBusinessFromWeb`)
- Test: `tests/client-orgs-new-business.test.ts`

**Interfaces:**
- Consumes: `listClientOrgs`, `clientOrgForNewBusiness` (Task 2); `newBusinessOrganizationId` (`src/lib/auth.ts`).
- Produces: the form field `clientOrgId` on `/negocios/nuevo`; the page reads `?organizacion=<id>` (string only) to preselect it.

- [ ] **Step 1: Write the failing test** (mock `@/lib/auth`, `@/lib/db`, `@/lib/client-orgs-store`, `next/navigation`): `createBusinessFromWeb` with `clientOrgId: "c2"` calls `clientOrgForNewBusiness(<account from newBusinessOrganizationId>, "c2")` and creates the business with that `organizationId` and the returned `clientOrgId`; with no field it passes `""`; when `clientOrgForNewBusiness` throws, no business is created.

Run: `npx vitest run --project unit tests/client-orgs-new-business.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implement.** The page lists the account's organizations (`listClientOrgs(await newBusinessOrganizationId())`) in a select labeled «Organización» / "Organization", preselecting `?organizacion=` when it is one of them, else the first (the default). `createBusinessFromWeb` replaces Task 1's `ensureDefaultClientOrg` call with `clientOrgForNewBusiness(organizationId, str(f, "clientOrgId"))`.

- [ ] **Step 3: Run** `npx vitest run --project unit tests/client-orgs-new-business.test.ts && npx tsc --noEmit` — Expected: PASS, clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/negocios/nuevo/page.tsx src/app/actions-study.ts tests/client-orgs-new-business.test.ts
git commit -m "feat(orgs): pick the organization of a new business"
```

### Task 5: Company picker grouped by organization

**Files:**
- Modify: `src/components/Sidebar.tsx` (business query and props), `src/components/nav/BizSwitcher.tsx`, `src/components/MobileBizMenu.tsx`, `src/components/nav/Nav.module.css`, `src/app/globals.css` (mobile menu classes)
- Test: `tests/biz-picker.test.tsx`

**Interfaces:**
- Consumes: `groupByClientOrg` (Task 2).
- Produces: `type BizGroup = { id: string; name: string; businesses: { id: string; name: string; color: string }[] }` exported from `src/components/nav/BizSwitcher.tsx`; `BizSwitcher` and `MobileBizMenu` take `groups: BizGroup[]` instead of `businesses`.

- [ ] **Step 1: Write the failing test** rendering both components with `renderToStaticMarkup`: two groups → each group name appears once as a heading (`role="group"` with `aria-label` = the organization's name) followed by its businesses; with `activeId` in the second group, the trigger shows that organization's name and the business name; a single group still shows its heading; an organization name with HTML is escaped; «Agregar negocio» only with `canAdd`.

Run: `npx vitest run --project unit tests/biz-picker.test.tsx` — Expected: FAIL.

- [ ] **Step 2: Implement.** `Sidebar` selects `{ id, name, color, clientOrg: { select: { id: true, name: true } } }` with `orderBy: [{ clientOrg: { createdAt: "asc" } }, { createdAt: "asc" }]` under `myBusinessesWhere()` (so a person with partial access only gets their businesses, and so only their organizations), groups with `groupByClientOrg`, and passes `groups`. The trigger shows the organization's name in small text above the business name (desktop `switchName`, mobile `mbiz-name`).

- [ ] **Step 3: Run** `npx vitest run --project unit tests/biz-picker.test.tsx tests/nav.test.ts && npx tsc --noEmit` — Expected: PASS, clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx src/components/nav src/components/MobileBizMenu.tsx src/app/globals.css tests/biz-picker.test.tsx
git commit -m "feat(orgs): company picker grouped by organization on desktop and phone"
```

### Task 6: «Cuenta» wording and access fields grouped by organization

**Files:**
- Modify: `src/components/Sidebar.tsx` (footer), `src/app/equipo/page.tsx:72`, `src/components/team/AccessFields.tsx`, `src/components/team/PeopleList.tsx:200`, `src/app/actions-drive.ts:89`, `src/lib/team.ts` (lines 58, 95, 333)
- Test: `tests/account-wording.test.tsx`

**Interfaces:**
- Consumes: `groupByClientOrg` (Task 2).
- Produces: `TeamBusiness` in `src/lib/team.ts` gains `clientOrg: { id: string; name: string }` (query adds it and orders like Task 5).

- [ ] **Step 1: Write the failing test**: `AccessFields` with businesses in two organizations renders each organization's name as a group heading over its checkboxes; with no businesses it says «Todavía no hay empresas en esta cuenta.» / "There are no businesses in this account yet."; the invitation copy built in `src/lib/team.ts` says «en la cuenta «{nombre}».» / `in the account "{name}".`.

Run: `npx vitest run --project unit tests/account-wording.test.tsx` — Expected: FAIL.

- [ ] **Step 2: Implement the copy changes**, exactly:
  - Sidebar footer: «Cuenta: {nombre}» / "Account: {name}" (one line per account).
  - `equipo/page.tsx:72` aria-label: «Cuentas que administras» / "Accounts you manage".
  - `PeopleList.tsx:200`: «…no podrás volver a entrar a esta cuenta.» / "…back into this account."
  - `actions-drive.ts:89`: «Esa carpeta ya está conectada a un negocio de otra cuenta.» / "That folder is already connected to a business in another account."
  - `team.ts:95`: «en la cuenta «${org.name}».» / `in the account "${org.name}".`
  - `team.ts:333`: «Esa persona también está en otra cuenta: …» / "That person is also in another account: …"
  - Leave alone: `DriveCard.tsx:128` (Google's organization), `MentionsPanel.tsx`, `prompt-core.ts` (another meaning).

- [ ] **Step 3: Run** `npx vitest run --project unit tests/account-wording.test.tsx && npx vitest run` — Expected: PASS; existing team tests updated only where they assert the old words.

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx src/app/equipo/page.tsx src/components/team src/app/actions-drive.ts src/lib/team.ts tests/
git commit -m "feat(orgs): the screen calls the account «Cuenta»; access fields grouped by organization"
```

### Task 7: Seed, browser check and docs

**Files:**
- Modify: `scripts/agent-seed-local.mjs`
- Create: `scripts/orgs-ui-check.mjs`
- Modify: `docs/agent/testing.md`, `README.md` (the users/organizations section)

**Interfaces:**
- Consumes: everything above; the login flow of `scripts/agent-ui-check.mjs`.

- [ ] **Step 1: Seed two organizations**: `matya-demo-corg` «Mis compañías» with `matya-demo-ni`, and `matya-demo-corg-rpa` «Ricardo PA (cliente)» with `matya-demo-fl` (upsert; re-running moves them back to these organizations).

- [ ] **Step 2: Write `scripts/orgs-ui-check.mjs`** (same guards as `agent-ui-check.mjs`: localhost only, `MATYA_LOCAL_PASSWORD`, global Playwright via `NODE_PATH`): at 390 and 1280 px, log in, open `/organizaciones` and a business page with the picker open, save screenshots in `<directory>`, fail on horizontal scroll (`scrollWidth > innerWidth`), check both organization names appear in the picker, and repeat at 390 px in the night theme. It changes nothing.

- [ ] **Step 3: Run it** against `npm run dev` on the seeded local database (as in `docs/agent/testing.md` «Revisión de las pantallas»).
Expected: "All checks passed." and the screenshots; look at them before continuing.

- [ ] **Step 4: Docs**: `docs/agent/testing.md` (the new script and the seed's two organizations); `README.md` (Cuenta → Organizaciones → Negocios; who manages organizations; apply `supabase/migrations/20261017180000_client_orgs.sql` before deploying).

- [ ] **Step 5: Final checks**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run && npx next build`
Expected: no type errors, no lint errors, all tests pass, build compiles.

- [ ] **Step 6: Commit**

```bash
git add scripts/agent-seed-local.mjs scripts/orgs-ui-check.mjs docs/agent/testing.md README.md
git commit -m "chore(orgs): seed two organizations, browser check, docs"
```
