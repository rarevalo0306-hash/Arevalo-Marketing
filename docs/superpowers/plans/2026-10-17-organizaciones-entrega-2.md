# Organizaciones por cliente, entrega 2: reporte semanal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each client organization gets one weekly email with all its businesses, built from rules (no AI), sent once per week by the per-minute tick and the daily cron, plus «Mandarme una prueba» and «Mandar ahora» on the Organizaciones page.

**Architecture:** A pure module (`src/lib/client-org-report.ts`) decides the week, when it is due, which settings are valid and what the client email says, from each business's existing `PeriodReport` cut down to a whitelist. A server module (`src/lib/client-org-report-run.ts`) claims the week in `ClientOrgReport` (the partial unique index stops a second automatic send), builds the reports, sends through the existing `sendSeoEmail`, and records the outcome. The Organizaciones page gains a report panel per organization.

**Tech Stack:** Next.js 15 App Router (server actions, `useActionState`), React 19, TypeScript strict, Prisma 6 + PostgreSQL, vitest (`unit` and `database` projects), CSS Modules.

**Spec:** `docs/superpowers/specs/2026-10-17-organizaciones-por-cliente-design.md` (sections «Datos» → `ClientOrg`/`ClientOrgReport`, «Entrega 2», «Pruebas»).

## Global Constraints

- No new migration: `ClientOrg` (contactName, reportEmail, phone, reportLang, reportOn, reportDay, reportHour, timezone) and `ClientOrgReport` (week, trigger, state, to, attempts, error) and the partial unique index `ClientOrgReport_cron_week_key` (`clientOrgId, week` WHERE `trigger = 'cron'`) already exist in production.
- Settings: contact name up to 120 characters; report emails up to 3, parsed with `parseAlertEmails` (`src/lib/seo/alerts.ts`, the app's report-recipient parser); phone up to 40; `reportLang` `es` or `en`; `reportDay` 0 = domingo … 6 = sábado (default 1); `reportHour` 0–23 (default 8); `timezone` `""` (the app's, `appTz()`) or a valid IANA zone (`isValidTz`).
- The week: the last complete Monday 00:00 → next Monday 00:00 before the send moment, in the organization's zone; `week` = that Monday, `YYYY-MM-DD`.
- No paid calls: highlights only through `reportHighlights(…, { ai: false })`; `buildReportFor` already makes none.
- The client sees only `posts`, `results`, `reviews`, `web`, `rankings` and `next` (its `upcoming` part only), chosen by an explicit whitelist. Never `costs`, `tasks`, `proposals`, `alerts`, `ai`, `campaigns`, `ads`, anything about the MATYA team, review notes, or a link into the app.
- Footer «Enviado por <nombre de la cuenta>» / "Sent by <account name>"; the account name is also the visible From name.
- Retries of an automatic send: at most 3 attempts in total, 30 minutes apart; a `sending` row older than 30 minutes counts as an error; a `SenderConfigError` is never retried (its row is written with `attempts: 3`).
- Only an Administrator of the account (`requireOrgAdmin(accountId)`) saves settings or sends; every query of the actions filters by that `organizationId`.
- UI copy through `t(es, en)`; server errors through `bi(es, en)`; server action arguments are plain values checked with `ensure.text(…)`.
- Local test database only: `postgresql://postgres@127.0.0.1:55439/matya_agent` with `DATABASE_URL`, `DIRECT_URL` and `MATYA_TEST_DATABASE_URL` all exported to it; database suites are `tests/*-database.test.ts`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01N6TYBTCrH3PsdJnjsukzYp`.

## Rulings on the spec's open points

- Spec «Datos» says emails are checked with `looksLikeEmail`; this plan uses `parseAlertEmails`, because `sendSeoEmail` drops any address its own pattern rejects: a saved email that would never be sent is worse.
- Spec «Qué lleva el email» lists `results` as «alcance, me gusta, comentarios»; `PeriodReport.results` only has `reach` and `interactions` (likes + comments + shares + saves). The email shows reach and interactions.
- Spec lists `next` («lo que viene»); `next.tasks` are the owner's app to-dos (connect Google, add a website), not news for a client. Only `next.upcoming` (scheduled posts) reaches the client.

## Review Focus

- A report where every internal section is full (costs, AI actions, ads spend, proposals, tasks, alerts): the client email shows none of it, not even in the summary. (Task 2 test.)
- The PC worker and the Vercel cron fire in the same minute: one automatic email per week, never two. (Task 3 test.)
- The week that contains a daylight-saving change, and a Monday 8:00 send right after it: still Monday-to-Monday and still 8:00 local. (Task 1 test.)
- An Administrator of account A sends or saves for an organization of account B with forged ids: refused, nothing sent, nothing written. (Task 3 and Task 4 tests.)
- A provider outage: up to 3 attempts 30 minutes apart, then quiet until next week, which sends normally; a configuration error is never retried. (Task 3 test.)

---

### Task 1: Week, due time and settings (pure)

**Files:**
- Create: `src/lib/client-org-report.ts`
- Modify: `src/lib/report-period.ts` (export a range builder)
- Test: `tests/client-org-report.test.ts`

**Interfaces:**
- Produces:
  - `rangePeriod(fromDay: string, toDay: string, tz: string): RangePeriod` in `report-period.ts` (preset `"custom"`, previous period = the same number of days right before; it is `makePeriod("custom", fromDay, toDay, tz)`).
  - In `client-org-report.ts`:
    - `export type ReportWeek = { week: string; fromDay: string; toDay: string }`
    - `reportWeek(now: Date, tz: string): ReportWeek`: the last complete Monday–Sunday week before `now` in `tz`.
    - `dueWeek(org: { reportOn: boolean; reportDay: number; reportHour: number }, now: Date, tz: string): ReportWeek | null`: the week to send if this week's send moment (the Monday of the current week + `(reportDay + 6) % 7` days, at `reportHour:00` local, via `localToUtc`) has passed, else `null`; always `null` when `reportOn` is false.
    - `orgTz(timezone: string): string`: `timezone` when `isValidTz`, else `appTz()`.
    - `export type ReportSettings = { contactName: string; reportEmail: string; phone: string; reportLang: "es" | "en"; reportOn: boolean; reportDay: number; reportHour: number; timezone: string }`
    - `readReportSettings(raw: Record<string, string>): ReportSettings`: trims, validates per Global Constraints and throws a `BiError` naming the first bad field; `reportEmail` is stored as the parsed list joined with `", "`; `reportOn` is true for `"on"`.
    - `MAX_ATTEMPTS = 3`, `RETRY_MS = 30 * 60_000`
    - `retryable(row: { state: string; attempts: number; updatedAt: Date }, now: Date): boolean`: true for `error` or `sending`, with `attempts < 3` and `updatedAt` at least 30 minutes old.

- [ ] **Step 1: Write the failing tests** in `tests/client-org-report.test.ts`:

```ts
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
```

The exact error texts are the implementer's (bilingual, naming the field, e.g. «Escribe hasta 3 emails válidos para el reporte.»).

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --project unit tests/client-org-report.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `rangePeriod` in `report-period.ts` and the functions above in `src/lib/client-org-report.ts`. Use `localDay`, `addDays` (`src/lib/business-tz.ts`) and `localToUtc` (`src/lib/time.ts`, DST-safe); the weekday of a `YYYY-MM-DD` day is `new Date(day + "T00:00:00Z").getUTCDay()`.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --project unit tests/client-org-report.test.ts tests/report-period.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/client-org-report.ts src/lib/report-period.ts tests/client-org-report.test.ts
git commit -m "feat(orgs): weekly report week, due time and settings rules"
```

---

### Task 2: The client email (pure)

**Files:**
- Modify: `src/lib/client-org-report.ts`
- Modify: `src/lib/seo/alerts.ts` (`sendSeoEmail` gains `fromName`)
- Test: `tests/client-org-report.test.ts`, `tests/seo-alerts.test.ts`

**Interfaces:**
- Consumes: `ReportWeek`, `rangePeriod` (Task 1); `PeriodReport`, `periodText` (`report-period.ts`); `reportSections`, `ruleHighlights`, `ViewSection` (`report-period-view.ts`); `reportHighlights` (`daily-report.ts`); `escapeHtml` (`src/lib/text.ts`); `BuiltEmail` (`daily-report.ts`).
- Produces:
  - `CLIENT_SECTIONS = ["posts", "results", "reviews", "web", "rankings", "next"] as const`
  - `clientOnly(r: PeriodReport): PeriodReport`: a new object that copies `business`, `period`, `generatedAt`, `posts`, `results`, `reviews`, `web`, `rankings`, sets `next` to `{ tasks: [], upcoming: r.next.upcoming }` (or `null` when there is no `upcoming`) and every other section to `null`. Written as an explicit object literal, never a spread of `r`, so a section added to `PeriodReport` later fails to compile here instead of leaking.
  - `clientView(r: PeriodReport, lang: "es" | "en"): ViewSection[]`: `reportSections(clientOnly(r), lang)` kept only when `CLIENT_SECTIONS` includes the id, without `href`/`hrefText`, with item `href`/`linkText` and `table.links` kept only for absolute `https://` URLs (posts and reviews link to the public post or review; app paths are dropped).
  - `orgHighlights(perBusiness: { name: string; items: string[] }[]): string[]`: at most 3, taking one item from each business in turn; with more than one business each item reads `"<name>: <item>"`.
  - `export type ClientOrgEmail = { orgName: string; accountName: string; week: ReportWeek; tz: string; lang: "es" | "en"; test: boolean; businesses: { name: string; color: string; sections: ViewSection[] }[]; highlights: string[] }`
  - `buildClientOrgEmail(e: ClientOrgEmail): BuiltEmail`
  - `senderWithName(sender: Sender, name?: string): Sender` in `seo/alerts.ts`: `name` (trimmed, at most 80 characters) replaces `sender.name` when not blank.
  - `sendSeoEmail` options gain `fromName?: string`, applied with `senderWithName` before sending.

Copy the email fixes (es / en):
- Subject: `Reporte semanal de ${orgName}: ${periodText(period, "es", "long")}` / `Weekly report for ${orgName}: ${periodText(period, "en", "long")}`; with `test` it starts with `Prueba · ` / `Test · `.
- Headings: «Resumen» / "Summary"; a business with no client section: «Sin actividad esta semana.» / "No activity this week."
- Footer: «Enviado por ${accountName}» / "Sent by ${accountName}".

- [ ] **Step 1: Write the failing tests**

In `tests/client-org-report.test.ts`, with `richInputs()` from `tests/report-period.test.ts` moved to a shared helper `tests/helpers/report-inputs.ts` (export it there and import it in both files) and `buildPeriodReport`:

```ts
describe("what the client sees", () => {
  const full = buildPeriodReport(richInputs()); // every section filled, costs, AI, ads, proposals, tasks and alerts included
  it("clientOnly keeps the whitelist and nothing else", () => {
    const c = clientOnly(full);
    for (const k of ["campaigns", "ai", "ads", "tasks", "proposals", "alerts", "costs"] as const) expect(c[k]).toBeNull();
    expect(c.posts).toEqual(full.posts);
    expect(c.next?.tasks).toEqual([]);
    expect(c.next?.upcoming).toEqual(full.next?.upcoming);
  });
  it("clientView has only client sections and no link into the app", () => {
    const v = clientView(full, "es");
    expect(v.map((s) => s.id).every((id) => (CLIENT_SECTIONS as readonly string[]).includes(id))).toBe(true);
    const links = v.flatMap((s) => [s.href, ...(s.items ?? []).map((i) => i.href), ...(s.table?.links ?? [])]).filter(Boolean);
    expect(links.every((l) => l!.startsWith("https://"))).toBe(true);
  });
  it("the email of a full report shows no internal word, cost or app link, not even in the summary", async () => {
    const lang = "es";
    const safe = clientOnly(full);
    const hl = await reportHighlights(safe, lang, { ai: false });
    const mail = buildClientOrgEmail({ orgName: "Juan Pérez", accountName: "Ricardo Arevalo", week: { week: "2026-10-12", fromDay: "2026-10-12", toDay: "2026-10-18" }, tz: "America/New_York", lang, test: false,
      businesses: [{ name: "Techos Pérez", color: "#0a7", sections: clientView(full, lang) }], highlights: orgHighlights([{ name: "Techos Pérez", items: hl.items }]) });
    const all = mail.html + mail.text;
    for (const word of ["Costos", "Gasto", "anuncios", "IA", "Propuestas", "Tareas", "Avisos", "MATYA", "/b/", "Ver en Matya"]) expect(all).not.toContain(word);
    expect(all).not.toContain(process.env.PUBLIC_BASE_URL || "https://app.matya.app");
    expect(mail.html).toContain("Enviado por Ricardo Arevalo");
  });
});
```

Adjust the forbidden words to the exact titles `reportSections` gives those sections in Spanish (read `report-period-view.ts`), and add the English run with the English titles. Also:

- `orgHighlights`: two businesses with 3 items each give `["A: a1", "B: b1", "A: a2"]`; one business gives its items unprefixed; never more than 3.
- `buildClientOrgEmail`:
  - A business whose `sections` is empty shows «Sin actividad esta semana.».
  - `test: true` starts the subject with `Prueba · `.
  - The English email uses "Summary", "No activity this week." and "Sent by".
  - An org, account or business name `<script>alert(1)</script>` appears escaped in html, and the text version has no HTML.
- `senderWithName` (in `tests/seo-alerts.test.ts`): `{ name: "Techos", … }` with `"Ricardo Arevalo"` gives name `"Ricardo Arevalo"`; `"  "` or `undefined` keeps `"Techos"`; a 200-character name is cut to 80.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --project unit tests/client-org-report.test.ts tests/seo-alerts.test.ts`
Expected: FAIL (functions missing).

- [ ] **Step 3: Implement** `clientOnly`, `clientView`, `orgHighlights`, `buildClientOrgEmail` and `senderWithName`/`fromName`. The email is an inline-styled table layout like `buildDailyEmail` (`src/lib/daily-report.ts`): a header with the org name and the long week text (`periodText(rangePeriod(week.fromDay, week.toDay, tz), lang, "long")`), the summary list, then per business its name with a color dot and each section's title, note, stats (label and value) and items (text, meta, and «Ver» / "View" only for an https link). Every interpolated string goes through `escapeHtml`. It has no button and no app link.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --project unit tests/client-org-report.test.ts tests/seo-alerts.test.ts tests/report-period.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/client-org-report.ts src/lib/seo/alerts.ts tests/client-org-report.test.ts tests/seo-alerts.test.ts tests/report-period.test.ts tests/helpers/report-inputs.ts
git commit -m "feat(orgs): the weekly client email, whitelist only, no app links"
```

---

### Task 3: Claim, send and run (database)

**Files:**
- Create: `src/lib/client-org-report-run.ts`
- Modify: `src/lib/client-orgs-store.ts` (settings save, report data in the list)
- Test: `tests/client-org-report-database.test.ts`

**Interfaces:**
- Consumes: Task 1 and Task 2 exports; `buildReportFor` (`daily-report.ts`); `sendSeoEmail`, `SenderConfigError`, `senderLabel`, `parseAlertEmails` (`seo/alerts.ts`).
- Produces:
  - `claimCronWeek(clientOrgId: string, week: string, now: Date): Promise<{ id: string; attempts: number } | null>`:
    - Inserts `{ trigger: "cron", state: "sending", to: [] }`.
    - On P2002 (the partial unique index; check `e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"`) it reclaims the existing row with one `updateMany` matching `retryable` (state `error` or `sending`, `attempts < 3`, `updatedAt <= now - 30 min`), setting `state: "sending"` and `attempts: { increment: 1 }`.
    - It returns the row, or `null` when the update matched nothing.
  - `export type ClientOrgSendOutcome = { state: "sent" | "error"; week: ReportWeek; to: string[]; subject: string; sender?: Sender; error?: string }`
  - `sendClientOrgReport(clientOrgId: string, opts: { trigger: "cron" | "manual" | "test"; organizationId: string | null; to?: string[]; now?: Date; week?: ReportWeek }): Promise<ClientOrgSendOutcome | null>`:
    - Loads the org filtered by `organizationId` when given. When it is not found it throws the store's «Esa organización no es de esta cuenta.».
    - `cron` claims with `claimCronWeek` (returns `null` when not claimed). `manual` and `test` insert their own row. `week` defaults to `reportWeek(now, orgTz(org.timezone))`.
    - Recipients: `test` sends to `opts.to`; otherwise `parseAlertEmails(org.reportEmail)`.
    - With no business, or (for `manual`/`cron`) no email, it throws a `BiError` before claiming.
    - Builds each business's `buildReportFor(id, rangePeriod(…), now)` in creation order, then `clientOnly` → `reportHighlights(…, { ai: false })` → `clientView`, then `buildClientOrgEmail` with `accountName = organization.name`.
    - Sends with `sendSeoEmail({ businessId: <first business>, to, subject, html, text, fromName: accountName })`.
    - Records `sent` with `to`, or `error` with the message cut to 300 characters (and `attempts: 3` for a `SenderConfigError`). It returns the outcome instead of throwing on a send failure.
  - `runClientOrgReports(now = new Date(), opts: { max?: number; budgetMs?: number } = {}): Promise<{ checked: number; sent: number; errors: number }>`:
    - Defaults `max: 5`, `budgetMs: 90_000`.
    - Candidates: organizations with `reportOn`, `reportEmail` not empty and at least one business.
    - For each: `dueWeek` in `orgTz(timezone)`, then a pre-check of the existing `cron` row for that week (skipped unless absent or `retryable`), then `sendClientOrgReport(id, { trigger: "cron", organizationId: null, week, now })`.
    - Each organization runs in its own try/catch that logs `[reporte-semanal] <id>: <message>` with no secrets.
  - In `client-orgs-store.ts`:
    - `saveClientOrgReport(organizationId: string, clientOrgId: string, raw: Record<string, string>): Promise<void>`: `readReportSettings`, then `updateMany({ where: { id, organizationId } })`; when the count is 0 it throws «Esa organización no es de esta cuenta.».
    - `export type LastSend = { at: string /* ISO */; trigger: string; state: string; to: string[]; error: string }`; `listClientOrgs` adds to each org `report: ReportSettings` and `last: LastSend | null` (the newest `ClientOrgReport`).

- [ ] **Step 1: Write the failing tests** in `tests/client-org-report-database.test.ts`:
  - Use the same `safe`/`describe.skipIf(!safe)` guard and the inline `clean()` style as `tests/client-orgs-database.test.ts`, with its own ids (`corep-it-a`, `corep-it-b`).
  - Mock `sendSeoEmail` with `vi.mock("@/lib/seo/alerts", async (orig) => ({ ...(await orig()), sendSeoEmail: vi.fn() }))`, resolving to `{ name: "Ricardo Arevalo", email: "r@x.com", apiKey: "k", via: "app" }`.
  - `now` = Monday 2026-10-19 13:00Z with org timezone `America/New_York`, report Monday 8:00.

  Tests (names and assertions):
  - "two automatic runs at the same moment send once": `await Promise.all([runClientOrgReports(now), runClientOrgReports(now)])`, then `sendSeoEmail` was called once and there is exactly 1 `cron` row for week `2026-10-12`, `sent`.
  - "a later run the same week sends nothing": after one sent run, `runClientOrgReports(later)` makes 0 calls.
  - "an error is retried after 30 minutes, at most 3 attempts, then waits for next week":
    - Make the mock reject 3 times with a `BiError`.
    - Runs at now, now+29 min, now+30 min and now+60 min give 1, 1, 2 and 3 calls in total.
    - A run at now+120 min still gives 3 calls; the row has `attempts: 3` and is `error`.
    - Next Monday the mock resolves: one call, and a new row for week `2026-10-19`.
  - "a configuration error is never retried": the mock rejects with `new SenderConfigError("x", "x")`; runs at now and now+60 min give 1 call, and the row has `attempts: 3`.
  - "a send that got stuck in sending for 30 minutes is retried": insert a `sending` row (attempts 1), set `updatedAt` 31 minutes ago with `$executeRaw`, and `runClientOrgReports` calls once.
  - "manual and test can repeat in the same week and do not block the automatic one": two `manual` and one `test` send all go out; then `runClientOrgReports(now)` still sends the `cron` one.
  - "skips organizations that are off, have no email or have no business": 0 calls, 0 rows.
  - "sendClientOrgReport with another account's organizationId is refused and records nothing": it rejects with «Esa organización no es de esta cuenta.»; 0 calls; 0 rows.
  - "the email goes from the first business with the account name, to the parsed emails": the mock's argument has `businessId` = the oldest business, `fromName` = the account name, `to` = `["a@x.com", "b@y.com"]`, and a subject starting with `Reporte semanal de`.
  - "saveClientOrgReport writes only its own account's organization": saving into B's org under account A rejects, and B is unchanged.
  - "listClientOrgs returns the settings and the newest send": `last.state` is the newest row's.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --project database tests/client-org-report-database.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/lib/client-org-report-run.ts` and the store changes as specified in Interfaces.

- [ ] **Step 4: Run them to see them pass, plus the existing org suites**

Run: `npx vitest run --project database tests/client-org-report-database.test.ts tests/client-orgs-database.test.ts tests/client-orgs-actions-database.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/client-org-report-run.ts src/lib/client-orgs-store.ts tests/client-org-report-database.test.ts
git commit -m "feat(orgs): claim the week, send the weekly report, retry safely"
```

---

### Task 4: Actions and the two schedulers

**Files:**
- Modify: `src/app/actions-client-orgs.ts`
- Modify: `src/lib/agent/service.ts` (global tick, after the team daily reports)
- Modify: `src/app/api/cron/route.ts` (inside `after`, after the daily reports)
- Test: `tests/client-orgs-actions.test.ts`, `tests/client-orgs-actions-database.test.ts`

**Interfaces:**
- Consumes: `saveClientOrgReport` and `sendClientOrgReport` (Task 3); `runClientOrgReports` (Task 3).
- Produces, each following the existing order `ensure.text(...)` → `requireOrgAdmin(accountId)` → `getT()`, and each returning `OrgResult`:
  - `saveClientOrgReportAction(accountId: string, clientOrgId: string, _prev: OrgResult, f: FormData)`: success «Guardado.» / "Saved.".
  - `sendClientOrgTestAction(accountId: string, clientOrgId: string, _prev: OrgResult)`: sends to the signed-in Administrator (`user.email`), with `trigger: "test"` and `organizationId: accountId`.
  - `sendClientOrgNowAction(accountId: string, clientOrgId: string, _prev: OrgResult)`: sends with `trigger: "manual"` and `organizationId: accountId`.
  - A sent outcome reads `Listo: mandamos el reporte de ${periodText(rangePeriod(week.fromDay, week.toDay, appTz()), lang, "short")} a ${to.join(", ")} desde ${senderLabel(sender)}.` / `Done: we sent the report for ${…} to ${…} from ${…}.`; an `error` outcome or a thrown `BiError` gives `{ ok: false, message }` in the visitor's language. Each one calls `refresh()`.

- [ ] **Step 1: Write the failing tests**
  - In `tests/client-orgs-actions.test.ts`, using the hoisted mocks already there and mocking `@/lib/client-org-report-run`:
    - When `requireOrgAdmin` throws `AccessError`, each new action rejects and neither the store nor the sender is called.
    - The test action passes `{ trigger: "test", organizationId: "acc1", to: ["admin@x.com"] }`.
    - The now action passes `{ trigger: "manual", organizationId: "acc1" }`.
    - A sent outcome gives `ok: true` with the recipients and `senderLabel` in the message; an error outcome gives `ok: false` with its error.
    - An empty `accountId` or `clientOrgId` throws `InvalidArgs` before any guard.
  - In `tests/client-orgs-actions-database.test.ts`: `saveClientOrgReportAction` with an organization of another account returns `ok: false` with «Esa organización no es de esta cuenta.» and changes nothing.
  - `tests/permission-coverage.test.ts` must pass unchanged.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --project unit tests/client-orgs-actions.test.ts tests/permission-coverage.test.ts`
Expected: FAIL (actions missing).

- [ ] **Step 3: Implement** the three actions. Then wire the runner:
  - In `runAgentCycle`'s global branch, right after the `runDailyReports(… teamOnly: true)` block: `try { await runClientOrgReports(new Date(), { max: 2, budgetMs: 15_000 }); } catch (error) { console.error("MATYA weekly client reports did not complete", error instanceof Error ? error.name : "unknown"); }`.
  - In `/api/cron`'s `after` block, right after the daily reports: its own try/catch with `runClientOrgReports(new Date(), { max: 5, budgetMs: Math.max(10_000, 120_000 - (Date.now() - started)) })`, logged only when `checked`.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --project unit tests/client-orgs-actions.test.ts tests/permission-coverage.test.ts && npx vitest run --project database tests/client-orgs-actions-database.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions-client-orgs.ts src/lib/agent/service.ts src/app/api/cron/route.ts tests/client-orgs-actions.test.ts tests/client-orgs-actions-database.test.ts
git commit -m "feat(orgs): weekly report actions; the tick and the daily cron send it"
```

---

### Task 5: The report panel on Organizaciones

**Files:**
- Create: `src/components/orgs/ReportPanel.tsx`
- Modify: `src/components/orgs/ClientOrgs.tsx` (render the panel in each `OrgCard`; `Org` gains `report` and `last`)
- Modify: `src/app/organizaciones/page.tsx` (pass the extended `listClientOrgs` data)
- Modify: `src/components/orgs/Orgs.module.css`
- Test: `tests/client-orgs-page.test.tsx`

**Interfaces:**
- Consumes: `listClientOrgs` extended shape (Task 3); the three actions (Task 4); `COMMON_TZS` and the timezone select pattern of `src/components/reports/DailySettings.tsx`.
- Produces: `ReportPanel({ accountId, org }: { accountId: string; org: { id: string; name: string; businesses: Biz[]; report: ReportSettings; last: LastSend | null } })` (`ReportSettings` from Task 1, `LastSend` from Task 3).

Behaviour and copy (es / en):
- **Toggle:** a «Reporte semanal» / "Weekly report" button (`aria-expanded`) opens the panel.
- **Line under the title:** «Reporte: lunes 8:00 a. m. a juan@x.com» or «Reporte apagado» / "Report off".
- **Form fields:** «Contacto» (`contactName`, maxLength 120); «Emails para el reporte (hasta 3, separados por comas)» (`reportEmail`); «Teléfono» (`phone`, maxLength 40); «Idioma del reporte» (Español / English); «Zona horaria» («La de la app» plus `COMMON_TZS`); «Mandar el reporte cada semana» (checkbox `reportOn`); «Día» (domingo … sábado); «Hora» (0–23, shown as 12-hour times); «Guardar».
- **Submitting:** the same `onSubmit` + `startTransition` + `useActionState` pattern as the rename form, so an error keeps what was typed. The result appears in a `role="status"` line.
- **Warnings next to the switch:**
  - With the report on and no email: «Falta un email: sin él no se manda.»
  - With no business: «Sin negocios no hay reporte.»
- **Last send:**
  - «Último envío: <fecha y hora> a <emails> · salió» or «· no salió: <error>», with «(prueba)» / «(enviado ahora)» for `test` / `manual`.
  - With none: «Todavía no se ha mandado.»
- **Buttons:** «Mandarme una prueba» and «Mandar ahora» each ask `window.confirm` first:
  - «¿Te mandamos una prueba del reporte de la semana pasada a tu email?»
  - «¿Mandamos ahora el reporte de la semana pasada a <emails>?»
  - Their result shows in the same status line. «Mandar ahora» is disabled without an email or a business.

- [ ] **Step 1: Write the failing tests** in `tests/client-orgs-page.test.tsx`, extending its `renderToStaticMarkup` setup (the actions are already mocked there):
  - A card with the report on shows «Reporte: lunes 8:00 a. m. a juan@x.com»; with the report off it shows «Reporte apagado».
  - The panel markup has inputs named `contactName`, `reportEmail`, `phone`, `reportLang`, `timezone`, `reportOn`, `reportDay` and `reportHour`, with the saved values selected or checked.
  - The report on with `reportEmail: ""` shows «Falta un email: sin él no se manda.» and «Mandar ahora» is disabled.
  - `last` `{ state: "error", error: "Brevo dijo 401", trigger: "cron" }` shows «no salió: Brevo dijo 401»; with `last: null` it shows «Todavía no se ha mandado.».
  - A contact `<b>x</b>` and an error `<img src=x>` appear escaped.
  - The English render shows "Weekly report", "Report off" and "Send me a test".

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --project unit tests/client-orgs-page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** `ReportPanel`, render it in `OrgCard` below the business list, and pass the new fields from the page through `ClientOrgs`. Only the fields the panel shows reach the client.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --project unit tests/client-orgs-page.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/orgs/ReportPanel.tsx src/components/orgs/ClientOrgs.tsx src/components/orgs/Orgs.module.css src/app/organizaciones/page.tsx tests/client-orgs-page.test.tsx
git commit -m "feat(orgs): weekly report panel per organization"
```

---

### Task 6: Seed, browser check, docs and final checks

**Files:**
- Modify: `scripts/agent-seed-local.mjs` (report settings on `matya-demo-corg-rpa`)
- Modify: `scripts/orgs-ui-check.mjs` (open the panel and read it)
- Modify: `README.md`, `docs/agent/testing.md`

- [ ] **Step 1: Seed**: `matya-demo-corg-rpa` «Ricardo PA (cliente)» gets `contactName: "Ricardo (prueba)"`, `reportEmail: "cliente@example.com"`, `reportOn: true`, `reportDay: 1`, `reportHour: 8`, `timezone: "America/New_York"`, set in the upsert's `update` too. `matya-demo-corg` keeps the report off. No `ClientOrgReport` rows.

- [ ] **Step 2: Browser check**: at 390 px, at 1280 px and at 390 px in the night theme, on `/organizaciones`:
  - The «Ricardo PA (cliente)» card shows «Reporte: lunes 8:00 a. m. a cliente@example.com».
  - «Mis compañías» shows «Reporte apagado».
  - After opening «Reporte semanal», the email field holds `cliente@example.com` and both send buttons are visible.
  - Nothing scrolls sideways, and a screenshot `reporte-<tag>.png` is saved. The check never presses Guardar or the send buttons.

- [ ] **Step 3: Run it** against `npm run dev` on the seeded local database, as in `docs/agent/testing.md` «Revisión de las organizaciones», plus `scripts/agent-ui-check.mjs`.
Expected: both end with "All checks passed." Look at the screenshots before continuing.

- [ ] **Step 4: Docs**
  - `README.md`: in the organizations bullets, what the weekly report sends and what it never sends; who configures it; that the per-minute tick and the daily cron send it once per week; and the retries.
  - `docs/agent/testing.md`: the new database suite, the seed's report settings and the panel check.

- [ ] **Step 5: Final checks**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run && npx next build`
Expected: no type errors, no lint errors, all tests pass, build compiles.

- [ ] **Step 6: Commit**

```bash
git add scripts/agent-seed-local.mjs scripts/orgs-ui-check.mjs README.md docs/agent/testing.md
git commit -m "chore(orgs): weekly report seed, browser check, docs"
```
