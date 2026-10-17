// Runs once before the database suites (vitest.config.mts → the `database` project's globalSetup), which run one file at a time.
// The local database may hold the demo of scripts/agent-seed-local.mjs: `matya-demo-fl` with team mode on and a piece that waits for
// its owner. The database suites count every business with team mode on (the alert tick, the morning plan), so the demo would change
// their numbers. It is put aside for the run (team mode off) and put back when the run ends. This only happens against the isolated
// local database, the same condition under which those suites run at all; anywhere else it does nothing.
// The same goes for the weekly report of the demo organization `matya-demo-corg-rpa` (the seed turns it on, with a business and an
// email): `runClientOrgReports` walks every organization with the report on, so the demo would add one send to the counts of
// tests/client-org-report-database.test.ts. Its report is put aside (off) for the run and put back when the run ends.
import { PrismaClient } from "@prisma/client";

const LOCAL = /^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/matya_agent$/;

export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  const url = process.env.DATABASE_URL ?? "";
  if (!LOCAL.test(url) || process.env.MATYA_TEST_DATABASE_URL !== url) return undefined;
  const db = new PrismaClient();
  let aside: string[] = [];
  let reportsAside: string[] = [];
  try {
    aside = (await db.agentWorkspace.findMany({ where: { teamMode: true, businessId: { startsWith: "matya-demo-" } }, select: { businessId: true } })).map((w) => w.businessId);
    if (aside.length) await db.agentWorkspace.updateMany({ where: { businessId: { in: aside } }, data: { teamMode: false } });
  } catch {
    // No database or no tables yet: the suites that need them skip or fail on their own.
    aside = [];
  }
  try {
    reportsAside = (await db.clientOrg.findMany({ where: { reportOn: true, id: { startsWith: "matya-demo-" } }, select: { id: true } })).map((o) => o.id);
    if (reportsAside.length) await db.clientOrg.updateMany({ where: { id: { in: reportsAside } }, data: { reportOn: false } });
  } catch {
    reportsAside = [];
  }
  return async () => {
    try {
      if (aside.length) await db.agentWorkspace.updateMany({ where: { businessId: { in: aside } }, data: { teamMode: true } });
    } finally {
      try {
        if (reportsAside.length) await db.clientOrg.updateMany({ where: { id: { in: reportsAside } }, data: { reportOn: true } });
      } finally {
        await db.$disconnect();
      }
    }
  };
}
