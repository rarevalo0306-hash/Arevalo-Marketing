// Screen check of the client organizations in a real browser (Chromium through Playwright), against the local fixtures of
// `scripts/agent-seed-local.mjs` (two organizations: «Mis compañías» with `matya-demo-ni`, «Ricardo PA (cliente)» with `matya-demo-fl`).
//
//   MATYA_LOCAL_PASSWORD='<the one you seeded with>' NODE_PATH="$(npm root -g)" node scripts/orgs-ui-check.mjs <directory> [url]
//
// It needs the dev server running on the local fixture database (see docs/agent/testing.md) and Playwright installed globally (it is
// not a dependency of the project). `url` is the dev server (default http://localhost:3000, or MATYA_UI_URL); only localhost is
// accepted, because the script types a password. Run the seed right before it, so the demo businesses sit in their two organizations.
//
// What it does, with a fresh login at 390 px, at 1280 px and at 390 px in the night theme: opens /organizaciones (a card per
// organization with its business) and /b/matya-demo-fl/inicio with the company picker open (the desktop switcher in the sidebar, the
// phone's menu from the top bar), saving a screenshot of each in <directory>, and fails if a page scrolls sideways
// (document.documentElement.scrollWidth > window.innerWidth). In the open picker it checks the tree: the account «MATYA local fixture»
// once at the top, both organizations inside it, each one with its business under it and never an empty heading, and that nothing
// sticks out of the picker; on the computer the closed button reads account / organization / business, in that order. It only reads:
// apart from the login it submits no form, so the database is as the seed left it. Exit code 0 only when every check passed.
import { mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

// `import` ignores NODE_PATH; `require` honors it, which is how a globally installed Playwright is found.
const { chromium } = createRequire(import.meta.url)('playwright');

const dir = process.argv[2];
const base = (process.argv[3] ?? process.env.MATYA_UI_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const email = process.env.MATYA_LOCAL_EMAIL ?? 'admin@matya.local';
const password = process.env.MATYA_LOCAL_PASSWORD ?? '';
const BUSINESS = 'matya-demo-fl';
// The account of the seed (`matya-demo-org`): the top of the picker's tree, above its organizations.
const ACCOUNT = 'MATYA local fixture';
// Each organization of the seed with the business that must be under it.
const ORGS = [
  { id: 'matya-demo-corg', name: 'Mis compañías', business: 'Fameseg · prueba local' },
  { id: 'matya-demo-corg-rpa', name: 'Ricardo PA (cliente)', business: 'Ricardo PA · prueba local' },
];
if (!dir) throw new Error('Usage: node scripts/orgs-ui-check.mjs <directory for the screenshots> [url]');
if (!password) throw new Error('Set MATYA_LOCAL_PASSWORD to the password you seeded admin@matya.local with');
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Only a local dev server is allowed: this script types a password');
mkdirSync(dir, { recursive: true });

const failures = [];
const shots = [];
const fail = (message) => {
  failures.push(message);
  console.error(`FAIL  ${message}`);
};
const pass = (message) => console.log(`ok    ${message}`);

/** Elements that stick out of the right edge of the window (to name the culprit when the page scrolls sideways). */
const overflowing = () =>
  [...document.querySelectorAll('body *')]
    .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
    .slice(0, 5)
    .map((el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/)[0]}` : ''} (${Math.round(el.getBoundingClientRect().right)}px)`);

/** Fails if the page scrolls sideways. */
async function noSideScroll(page, name, tag) {
  const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  if (scrollWidth > innerWidth) fail(`${name} at ${tag} scrolls sideways: scrollWidth ${scrollWidth} > innerWidth ${innerWidth}; sticking out: ${(await page.evaluate(overflowing)).join(', ')}`);
  else pass(`${name} at ${tag} has no horizontal scroll (${scrollWidth} <= ${innerWidth})`);
}

/** hide the dev server's own overlay, so it is never in a picture */
const hideOverlay = (page) =>
  page.evaluate(() => {
    if (!document.getElementById('matya-ui-check')) {
      const style = document.createElement('style');
      style.id = 'matya-ui-check';
      style.textContent = 'nextjs-portal { display: none !important; }';
      document.head.append(style);
    }
  });

/**
 * The whole page in one picture. A full-page capture would draw the fixed bars (the phone's top bar) where the window happens to be,
 * over the content: instead the window is made as tall as the page, so every bar sits where it does on a phone.
 */
async function shot(page, name, tag) {
  const file = join(dir, `${name}-${tag}.png`);
  await noSideScroll(page, name, tag);
  await hideOverlay(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const viewport = page.viewportSize();
  for (let attempt = 0; attempt < 3; attempt++) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height === page.viewportSize().height) break;
    await page.setViewportSize({ width: viewport.width, height });
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: file });
  await page.setViewportSize(viewport);
  shots.push(`${file} (${Math.round(statSync(file).size / 1024)} KB)`);
}

/** The window as the person sees it (the open picker is a layer over the page: a full-page capture would stretch it). */
async function windowShot(page, name, tag) {
  const file = join(dir, `${name}-${tag}.png`);
  await noSideScroll(page, name, tag);
  await hideOverlay(page);
  await page.waitForTimeout(400); // the button's arrow turns while the picker opens: wait for it to stop
  await page.screenshot({ path: file });
  shots.push(`${file} (${Math.round(statSync(file).size / 1024)} KB)`);
}

const expectVisible = async (locator, what) => {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: 15000 });
    pass(what);
  } catch {
    fail(`${what}: not visible`);
  }
};
const expectCount = async (locator, count, what) => {
  const n = await locator.count();
  if (n === count) pass(`${what}: ${n}`);
  else fail(`${what}: expected ${count}, found ${n}`);
};

async function login(page) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 120000 }), page.click('button[type=submit]')]);
}

async function open(page, path, what) {
  const res = await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (!res?.ok()) fail(`${what} answered ${res?.status()}`);
  if (await page.getByText('Application error').count()) fail(`${what} shows an application error`);
}

/** «Organizaciones»: a card per organization of the seed, with its business inside. */
async function organizations(page, tag) {
  await open(page, '/organizaciones', '/organizaciones');
  await expectVisible(page.getByRole('heading', { level: 1, name: 'Organizaciones' }), 'Organizaciones: the title');
  for (const o of ORGS) {
    const card = page.locator(`section[data-org="${o.id}"]`);
    await expectVisible(card.getByRole('heading', { level: 2, name: o.name, exact: true }), `Organizaciones: the card «${o.name}»`);
    await expectVisible(card.getByText(o.business, { exact: true }), `Organizaciones: «${o.business}» is in «${o.name}»`);
  }
  await expectVisible(page.getByRole('heading', { level: 2, name: 'Nueva organización' }), 'Organizaciones: the Nueva organización block');
  await shot(page, 'organizaciones', tag);
}

/** Opens the company picker of a business page: the phone's menu from the top bar, or the switcher of the sidebar. Returns the open list. */
async function openPicker(page, width) {
  const trigger = width <= 900 ? page.locator('.mbiz-trigger') : page.locator('nav.sidebar div.desk-only > button[aria-expanded]');
  await trigger.waitFor({ state: 'visible', timeout: 30000 });
  // A click before the page has hydrated (the dev server compiles it on first use) is lost: click again until it is open.
  let opened = false;
  for (let attempt = 0; attempt < 20 && !opened; attempt++) {
    if ((await trigger.getAttribute('aria-expanded')) === 'true') break;
    await trigger.click();
    try {
      await page.waitForFunction((el) => el.getAttribute('aria-expanded') === 'true', await trigger.elementHandle(), { timeout: 1500 });
      opened = true;
    } catch {
      /* not hydrated yet: click again */
    }
  }
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    fail('the company picker never opened');
    return null;
  }
  const list = page.locator(`[id="${await trigger.getAttribute('aria-controls')}"]`);
  await list.waitFor({ state: 'visible', timeout: 15000 });
  return { trigger, list };
}

/** A business page with the picker open: both organizations, each with its business, none empty, nothing sticking out. */
async function picker(page, width, tag) {
  await open(page, `/b/${BUSINESS}/inicio`, `/b/${BUSINESS}/inicio`);
  const opened = await openPicker(page, width);
  if (!opened) return;
  const { trigger, list } = opened;
  pass(`the company picker is open at ${tag}`);
  // The active business shows its organization above its name, and on the computer its account above both.
  const triggerText = ((await trigger.textContent()) ?? '').replace(/\s+/g, ' ');
  const lines = [...(width <= 900 ? [] : [ACCOUNT]), 'Ricardo PA (cliente)', 'Ricardo PA · prueba local'];
  const at = lines.map((line) => triggerText.indexOf(line));
  if (at.every((i, n) => i >= 0 && (n === 0 || i > at[n - 1]))) pass(`the picker button reads, in order: ${lines.join(' / ')}`);
  else fail(`the picker button reads "${triggerText}", expected in order: ${lines.join(' / ')}`);
  // The tree: the account once, with its name as the heading, and each organization inside it with its business.
  const account = list.getByRole('group', { name: ACCOUNT, exact: true });
  await expectCount(account, 1, `picker: groups named «${ACCOUNT}»`);
  // The heading reads «Cuenta: » to a screen reader before the name (an sr-only span), so its whole text is matched.
  await expectVisible(account.getByText(`Cuenta: ${ACCOUNT}`, { exact: true }), `picker: the account heading «${ACCOUNT}»`);
  for (const o of ORGS) {
    const group = account.getByRole('group', { name: o.name, exact: true });
    await expectCount(group, 1, `picker: groups named «${o.name}» inside «${ACCOUNT}»`);
    await expectVisible(group.getByText(o.name, { exact: true }), `picker: the heading «${o.name}»`);
    await expectVisible(group.getByText(o.business, { exact: true }), `picker: «${o.business}» under «${o.name}»`);
  }
  // Never an empty heading: every group holds at least one business link.
  const groups = list.getByRole('group');
  for (let i = 0; i < (await groups.count()); i++) {
    const g = groups.nth(i);
    if ((await g.getByRole('link').count()) === 0) fail(`picker: the group «${await g.getAttribute('aria-label')}» has no business`);
  }
  pass('picker: no group without a business');
  // Everything inside the picker stays inside it (and inside the window).
  const outside = await list.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const stray = [...el.querySelectorAll('*')].filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1);
    });
    const inWindow = box.left >= -1 && box.right <= window.innerWidth + 1;
    return { stray: stray.slice(0, 4).map((c) => `${c.tagName.toLowerCase()} "${(c.textContent ?? '').trim().slice(0, 30)}"`), inWindow, sideScroll: el.scrollWidth > el.clientWidth + 1 };
  });
  if (outside.stray.length || !outside.inWindow || outside.sideScroll) fail(`picker at ${tag}: contents stick out (${outside.stray.join(', ') || 'none'}; inside the window: ${outside.inWindow}; scrolls sideways: ${outside.sideScroll})`);
  else pass(`picker at ${tag}: everything fits inside it`);
  await windowShot(page, 'selector', tag);
}

const browser = await chromium.launch({ executablePath: process.env.MATYA_CHROMIUM || undefined });
try {
  for (const { width, height, night } of [
    { width: 390, height: 844, night: false },
    { width: 1280, height: 800, night: false },
    { width: 390, height: 844, night: true },
  ]) {
    const tag = night ? `${width}-noche` : `${width}`;
    const context = await browser.newContext({ viewport: { width, height }, locale: 'es-ES', colorScheme: 'light' });
    // The night theme the way the app's ThemePicker saves it (<html data-theme="noche"> from localStorage "am-theme").
    if (night) await context.addInitScript(() => localStorage.setItem('am-theme', 'noche'));
    const page = await context.newPage();
    page.on('pageerror', (e) => fail(`page error at ${tag}: ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 500 && new URL(r.url()).origin === new URL(base).origin) fail(`${r.status()} from ${r.url()}`);
    });
    console.log(`--- ${tag}`);
    try {
      await login(page);
      pass(`logged in as ${email}`);
      await organizations(page, tag);
      if (night) {
        const theme = await page.evaluate(() => document.documentElement.dataset.theme);
        if (theme === 'noche') pass('the night theme is on (data-theme="noche")');
        else fail(`the night theme did not turn on (data-theme="${theme}")`);
      }
      await picker(page, width, tag);
    } catch (e) {
      fail(`${tag}: ${e instanceof Error ? e.message : e}`);
      await page.screenshot({ path: join(dir, `error-${tag}.png`), fullPage: true }).catch(() => {});
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`\n${shots.length} screenshots in ${resolve(dir)}:`);
for (const s of shots) console.log(`  ${s}`);
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nAll checks passed.');
