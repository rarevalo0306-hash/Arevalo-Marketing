// Synthetic fixtures only. This script deliberately refuses any other database.
//
//   MATYA_LOCAL_PASSWORD='<10+ characters of your choice>' node scripts/agent-seed-local.mjs
//
// It makes two demo businesses and, for `matya-demo-fl` (Ricardo PA), a team-mode day to look at on the Centro MATYA screens:
// the morning plan of today (completed), three pieces (one writing, one waiting for the owner after a failed review with two
// problems, one done) and a local Administrator (`admin@matya.local`) who logs in with MATYA_LOCAL_PASSWORD. Run it again to
// start the demo day over (it replaces its own runs and the morning plans of that business, nothing of any other). It sends no email, calls no provider and publishes nothing:
// no provider key is read, the business has no owner or report email and the pieces are plain rows.
import { randomBytes, scrypt } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
if (!/^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/matya_agent$/.test(url)) throw new Error('Only the isolated MATYA local database is allowed');
// The password of the local Administrator: required, never written in the repository.
const PASSWORD = process.env.MATYA_LOCAL_PASSWORD ?? '';
if (!PASSWORD) throw new Error('Set MATYA_LOCAL_PASSWORD (10 to 200 characters): it is the password of admin@matya.local');
if (PASSWORD.length < 10 || PASSWORD.length > 200) throw new Error('MATYA_LOCAL_PASSWORD must have 10 to 200 characters (the same rule as the app)');

/** Same format as `hashPassword` in src/lib/password.ts: scrypt$N$r$p$<salt base64url>$<key base64url> (N 16384, r 8, p 1, 64 bytes). */
const hashPassword = (password) =>
  new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(`scrypt$16384$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`)));
  });

const db = new PrismaClient();
const org = await db.organization.upsert({ where: { id: 'matya-demo-org' }, create: { id: 'matya-demo-org', name: 'MATYA local fixture' }, update: {} });
for (const [id, name, industry, timezone, aiProfile, color] of [
  ['matya-demo-fl', 'Ricardo PA · prueba local', 'public-adjusting-fl', 'America/New_York', 'Ayudamos a propietarios de Florida con daños a su propiedad. Datos sintéticos para validar MATYA.', '#146d88'],
  ['matya-demo-ni', 'Fameseg · prueba local', 'commercial-security-ni', 'America/Managua', 'Instalación y mantenimiento de cortinas metálicas en Nicaragua. Datos sintéticos para validar MATYA.', '#166d58'],
]) {
  await db.business.upsert({ where: { id }, create: { id, name, timezone, aiProfile, color, organizationId: org.id }, update: {} });
  await db.agentWorkspace.upsert({
    where: { businessId: id },
    create: { businessId: id, industry, enabled: true, allowPublish: false, objective: 'Educar a nuestros clientes con contenido útil y verificable.', memory: 'Español claro, tono profesional y cercano. No inventar promesas, cifras ni descuentos.', dailyBudgetCents: 0, runBudgetCents: 0 },
    update: {},
  });
}

// ---------- The local Administrator ----------
const admin = await db.user.upsert({
  where: { email: 'admin@matya.local' },
  create: { email: 'admin@matya.local', name: 'Administrador local', passwordHash: await hashPassword(PASSWORD) },
  update: { passwordHash: await hashPassword(PASSWORD), passwordOrgId: '' },
});
await db.membership.upsert({
  where: { userId_organizationId: { userId: admin.id, organizationId: org.id } },
  create: { userId: admin.id, organizationId: org.id, role: 'admin', allBusinesses: true },
  update: { role: 'admin', allBusinesses: true },
});

// ---------- The team-mode day of matya-demo-fl ----------
const BUSINESS = 'matya-demo-fl';
const TZ = 'America/New_York';
const now = new Date();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const MODEL = 'openai:demo-model'; // a made-up model: it is never called (no provider key is set)
const ago = (seconds) => new Date(now.getTime() - seconds * 1000);

await db.agentWorkspace.update({
  where: { businessId: BUSINESS },
  data: {
    teamMode: true,
    tickAt: now,
    pausedAt: null,
    dailyHour: 7,
    // A small daily limit, so the Equipo tab reads "of $5.00 a day". Nothing here can spend it: no provider key.
    dailyBudgetCents: 500,
    runBudgetCents: 100,
    channels: ['facebook', 'instagram'],
    agentModels: { director: { provider: 'openai', model: 'demo-model' } },
    modelPrices: { [MODEL]: { input: 1, output: 2 } },
  },
});

// A fresh demo day: the rows this script made (ids start with `demo-run-`) and any other morning plan of this fixture business (one
// of today would take the same request key; one of another day would show on the board) are replaced; nothing of any other business is touched.
const demoRuns = await db.agentRun.findMany({
  where: { businessId: BUSINESS, OR: [{ id: { startsWith: 'demo-run-' } }, { requestKey: { startsWith: `daily-${BUSINESS}-` } }] },
  select: { id: true },
});
await db.agentMessage.deleteMany({ where: { businessId: BUSINESS, runId: { in: demoRuns.map((r) => r.id) } } });
await db.agentRun.deleteMany({ where: { id: { in: demoRuns.map((r) => r.id) } } });

const pieces = [
  { id: 'p1', topic: 'Qué hacer en las primeras 24 horas después de un daño por agua', objective: 'Dar pasos claros a quien acaba de sufrir un daño por agua.', channels: ['facebook', 'instagram'], format: 'post', keyword: 'daño por agua' },
  { id: 'p2', topic: 'Cómo documentar los daños del techo antes de llamar al seguro', objective: 'Enseñar a reunir fotos y fechas sin prometer resultados.', channels: ['instagram', 'facebook'], format: 'carrusel', keyword: 'reclamo de seguro' },
  { id: 'p3', topic: 'Tres señales de que tu póliza de tormenta necesita revisión', objective: 'Invitar a revisar la póliza antes de la temporada de tormentas.', channels: ['facebook'], format: 'post', keyword: 'póliza de tormenta' },
];
const planOf = (piece, ids) => ({ kind: 'piece', piece, steps: ids.map((id) => ({ id, agent: id.startsWith('copy') ? 'copy' : id.startsWith('design') ? 'design' : id.startsWith('review') ? 'review' : 'matya', attempt: /-r(\d+)$/.exec(id)?.[1] ? Number(/-r(\d+)$/.exec(id)[1]) : 0 })) });
const step = (name, agent, seconds, output, cents = 0) => ({
  name,
  specialist: agent,
  status: 'succeeded',
  output,
  chargedCents: cents,
  budgetDay: today,
  agent,
  model: cents > 0 ? MODEL : '',
  attempt: Number(/-r(\d+)$/.exec(name)?.[1] ?? 0),
  createdAt: ago(seconds),
  finishedAt: ago(seconds - 5),
});

// The morning plan: completed, with the director's goal and the three pieces it dispatched.
const TEAM = 'demo-run-team';
const teamSteps = [
  step('plan', 'director', 290, { goal: 'Educar a propietarios de Florida sobre los primeros pasos tras un daño, sin prometer resultados.', maxPieces: 3 }, 2),
  step('research', 'seo', 280, { summary: 'Las búsquedas de la semana piden pasos concretos después de una tormenta o una fuga de agua.', audience: 'Propietarios de Florida con un daño reciente', angle: 'Pasos claros y verificables, sin promesas' }, 3),
  step('strategy', 'strategy', 270, { pieces }, 2),
  step('dispatch', 'matya', 260, { pieces, dropped: [] }),
];
await db.agentRun.create({
  data: {
    id: TEAM,
    businessId: BUSINESS,
    requestKey: `daily-${BUSINESS}-${today}`,
    kind: 'team',
    origin: 'daily',
    prompt: 'Plan del día',
    status: 'completed',
    stage: 4,
    context: { demo: true },
    plan: { kind: 'team' },
    chargedCents: 7,
    createdAt: ago(300),
    steps: { create: teamSteps },
  },
});

// Piece 1: the writer is working on it (copy). The lease keeps the worker away from a row that is only a fixture.
const P1 = 'demo-run-p1';
await db.agentRun.create({
  data: {
    id: P1,
    businessId: BUSINESS,
    requestKey: `daily-${BUSINESS}-${today}:p1`,
    kind: 'piece',
    origin: 'daily',
    parentRunId: TEAM,
    prompt: 'Plan del día',
    status: 'running',
    stage: 0,
    leaseToken: 'demo-lease',
    leaseUntil: new Date(now.getTime() + 6 * 3600 * 1000),
    context: { demo: true, piece: pieces[0] },
    plan: planOf(pieces[0], ['copy', 'design', 'review', 'prepare', 'schedule', 'verify']),
    createdAt: ago(250),
    steps: { create: [{ name: 'copy', specialist: 'redaccion', status: 'running', agent: 'copy', model: MODEL, budgetDay: today, createdAt: ago(60) }] },
  },
});

// Piece 2: its review failed twice (the one automatic round was used) with two problems, so it waits for the owner.
const P2 = 'demo-run-p2';
const problems = [
  { kind: 'promesa', detail: 'El texto sugiere que el seguro pagará todo el daño; no se puede asegurar un resultado.', sendBackTo: 'copy' },
  { kind: 'marca', detail: 'La segunda imagen no lleva el logo ni los colores de la marca.', sendBackTo: 'design' },
];
const p2Steps = [
  step('copy', 'copy', 230, { text: 'Antes de llamar a tu aseguradora, toma fotos del techo desde varios ángulos y anota la fecha. El seguro cubrirá todo el daño.' }, 4),
  step('design', 'design', 200, { summary: 'Tres imágenes con la plantilla de la marca.' }),
  step('review', 'review', 170, { approved: false, problems }, 1),
  step('copy-r1', 'copy', 140, { text: 'Antes de llamar a tu aseguradora, toma fotos del techo desde varios ángulos y anota la fecha. Un buen registro ayuda a explicar el daño.' }, 4),
  step('design-r1', 'design', 110, { summary: 'Imágenes ajustadas.' }),
  step('review-r1', 'review', 80, { approved: false, problems }, 1),
];
await db.agentRun.create({
  data: {
    id: P2,
    businessId: BUSINESS,
    requestKey: `daily-${BUSINESS}-${today}:p2`,
    kind: 'piece',
    origin: 'daily',
    parentRunId: TEAM,
    prompt: 'Plan del día',
    status: 'waiting_approval',
    stage: 6,
    context: { demo: true, piece: pieces[1] },
    plan: planOf(pieces[1], ['copy', 'design', 'review', 'copy-r1', 'design-r1', 'review-r1', 'prepare', 'schedule', 'verify']),
    chargedCents: 10,
    createdAt: ago(240),
    steps: { create: p2Steps },
  },
});

// Piece 3: done (its review passed and its channel result was read).
const P3 = 'demo-run-p3';
const p3Steps = [
  step('copy', 'copy', 220, { text: 'Revisa tu póliza antes de que empiece la temporada: busca el deducible de huracán, los límites de cobertura y los plazos para avisar un daño.' }, 4),
  step('design', 'design', 190, { summary: 'Una imagen con la plantilla de la marca.' }),
  step('review', 'review', 160, { approved: true, problems: [] }, 1),
  step('prepare', 'matya', 130, { summary: 'Publicación preparada para Facebook.' }),
  step('schedule', 'matya', 100, { summary: 'Programada para la próxima hora permitida.' }),
  step('verify', 'matya', 70, { summary: 'El canal confirmó la publicación (dato de prueba).' }),
];
await db.agentRun.create({
  data: {
    id: P3,
    businessId: BUSINESS,
    requestKey: `daily-${BUSINESS}-${today}:p3`,
    kind: 'piece',
    origin: 'daily',
    parentRunId: TEAM,
    prompt: 'Plan del día',
    status: 'completed',
    stage: 6,
    context: { demo: true, piece: pieces[2] },
    plan: planOf(pieces[2], ['copy', 'design', 'review', 'prepare', 'schedule', 'verify']),
    chargedCents: 5,
    createdAt: ago(235),
    steps: { create: p3Steps },
  },
});

// What the owner reads: the plan's summary and why the second piece waits.
await db.agentMessage.createMany({
  data: [
    { businessId: BUSINESS, runId: TEAM, role: 'assistant', text: 'Creé 3 piezas: «Qué hacer en las primeras 24 horas después de un daño por agua» (publicación), «Cómo documentar los daños del techo antes de llamar al seguro» (carrusel), «Tres señales de que tu póliza de tormenta necesita revisión» (publicación).' },
    { businessId: BUSINESS, runId: P2, role: 'assistant', text: 'La pieza no pasó la revisión dos veces. Te dejo las notas: decide si se aprueba como está, se rehace con tu nota o se cancela.' },
  ],
});

// Today's money, so the Equipo tab and the budget agree (the steps above charged 22 cents).
const spent = 7 + 10 + 5;
await db.agentBudget.upsert({
  where: { businessId_day: { businessId: BUSINESS, day: today } },
  create: { businessId: BUSINESS, day: today, chargedCents: spent },
  update: { chargedCents: spent, reservedCents: 0 },
});

await db.$disconnect();
console.log(`ready: two local fixture businesses, admin@matya.local, and the team day ${today} of ${BUSINESS}. No provider connections, no email, no paid calls.`);
