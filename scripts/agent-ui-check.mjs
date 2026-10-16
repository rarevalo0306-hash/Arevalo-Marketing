// Screen check of the Centro MATYA in a real browser (Chromium through Playwright), against the local fixtures of
// `scripts/agent-seed-local.mjs`.
//
//   MATYA_LOCAL_PASSWORD='<the one you seeded with>' NODE_PATH="$(npm root -g)" node scripts/agent-ui-check.mjs <directory> [url]
//
// It needs the dev server running on the local fixture database with MATYA_AGENT_ENABLED=true (see docs/agent/testing.md) and
// Playwright installed globally (it is not a dependency of the project). `url` is the dev server (default http://localhost:3000, or
// MATYA_UI_URL); only localhost is accepted, because the script types a password. Run the seed right before it: the Hoy tab warns
// when the worker's minute tick is more than ten minutes old, and the seed stamps it.
//
// What it does, with a fresh login at each of two widths (390 and 1280 px): opens /b/matya-demo-fl/matya and goes through Hoy,
// Equipo and Configuración, saving a screenshot of each in <directory>, and fails if the page scrolls sideways
// (document.documentElement.scrollWidth > window.innerWidth). At 390 px it also takes Hoy with a piece open, Hoy with the Rehacer note
// filled (and checks the 500 character limit), Hoy in the night theme, and turns team mode off while on the Equipo tab (the Hoy and
// Equipo tabs must go and the center fall back to Conversación), then turns it on again so the fixtures stay as the seed left them.
// It never submits Rehacer, sends nothing and calls no provider. Exit code 0 only when every check passed.
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
if (!dir) throw new Error('Usage: node scripts/agent-ui-check.mjs <directory for the screenshots> [url]');
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

async function shot(page, name, width) {
  const file = join(dir, `${name}-${width}.png`);
  const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  if (scrollWidth > innerWidth) fail(`${name} at ${width}px scrolls sideways: scrollWidth ${scrollWidth} > innerWidth ${innerWidth}; sticking out: ${(await page.evaluate(overflowing)).join(', ')}`);
  else pass(`${name} at ${width}px has no horizontal scroll (${scrollWidth} <= ${innerWidth})`);
  // The whole page in one picture. A full-page capture would draw the fixed bars (the phone's bottom menu, the sticky top bar) where
  // the window happens to be, over the content: instead the window is made as tall as the page, so every bar sits where it does on
  // a phone. The dev server's own overlay is hidden.
  await page.evaluate(() => {
    if (!document.getElementById('matya-ui-check')) {
      const style = document.createElement('style');
      style.id = 'matya-ui-check';
      style.textContent = 'nextjs-portal { display: none !important; }';
      document.head.append(style);
    }
    window.scrollTo(0, 0);
  });
  const viewport = page.viewportSize();
  for (let pass = 0; pass < 3; pass++) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height === page.viewportSize().height) break;
    await page.setViewportSize({ width: viewport.width, height });
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: file });
  await page.setViewportSize(viewport);
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

const tab = (page, name) => page.getByRole('navigation', { name: 'Centro MATYA' }).getByRole('button', { name, exact: true });

/** Clicks a tab until it is the current one: a click before the page has hydrated (the dev server compiles it on first use) is lost. */
async function openTab(page, name) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await tab(page, name).click();
    try {
      await page.waitForFunction(
        (label) => [...document.querySelectorAll('nav button[aria-current="page"]')].some((b) => b.textContent?.trim().startsWith(label)),
        name,
        { timeout: 2000 },
      );
      return;
    } catch {
      /* not hydrated yet: click again */
    }
  }
  fail(`the ${name} tab never became the current one`);
}

/** Turns team mode on or off the way another device of the owner would: with the settings API, from the page (same origin). */
const setTeamMode = (page, on) =>
  page.evaluate(
    async ({ id, on }) => {
      const read = await fetch(`/api/agent/${id}`, { cache: 'no-store' });
      const snapshot = await read.json();
      if (!read.ok) return { ok: false, error: snapshot.error };
      const keys = ['enabled', 'mode', 'allowPublish', 'industry', 'objective', 'memory', 'channels', 'sources', 'knowledge', 'dailyBudgetCents', 'runBudgetCents', 'maxPostsPerDay', 'radarEnabled', 'radarHours', 'teamMode', 'dailyHour', 'agentModels', 'modelPrices', 'allowSocial', 'allowWebArticles'];
      const settings = Object.fromEntries(keys.map((k) => [k, snapshot.settings[k]]));
      settings.teamMode = on;
      const res = await fetch(`/api/agent/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'settings', settings }) });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, error: body.error };
    },
    { id: BUSINESS, on },
  );

async function openCenter(page) {
  const res = await page.goto(`${base}/b/${BUSINESS}/matya`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (!res?.ok()) fail(`the center answered ${res?.status()}`);
  await expectVisible(page.getByRole('heading', { level: 1, name: 'MATYA' }), 'the Centro MATYA opened (title MATYA)');
  if (await page.getByText('Application error').count()) fail('the page shows an application error');
  await tab(page, 'Hoy').waitFor({ state: 'visible', timeout: 15000 });
}

async function screens(page, width) {
  // ---------- Hoy ----------
  await openTab(page, 'Hoy');
  await expectVisible(page.getByRole('heading', { level: 2, name: 'El plan de hoy' }), 'Hoy: the plan block');
  await expectVisible(page.getByText('Educar a propietarios de Florida sobre los primeros pasos'), 'Hoy: the morning plan goal');
  await expectVisible(page.getByRole('heading', { level: 2, name: 'Necesita tu sí' }), 'Hoy: Necesita tu sí');
  await expectCount(page.locator('li[data-kind]'), 1, 'Hoy: pieces waiting for the owner');
  await expectCount(page.getByText('El llamado de cada minuto no está activo'), 0, 'Hoy: no minute-call warning (the seed stamped the tick)');
  await expectVisible(page.getByRole('heading', { level: 2, name: 'Tablero del equipo' }), 'Hoy: the board');
  await expectCount(page.locator('details'), 4, 'Hoy: cards on the board (the plan and three pieces)');
  await shot(page, 'hoy', width);

  // ---------- Equipo ----------
  await openTab(page, 'Equipo');
  await expectVisible(page.getByRole('heading', { level: 2, name: 'El equipo' }), 'Equipo: the team block');
  await expectCount(page.locator('li').filter({ hasText: /pasos? hoy/ }), 7, 'Equipo: one row per agent');
  await expectVisible(page.getByText('Total del equipo hoy'), 'Equipo: the day total');
  await shot(page, 'equipo', width);

  // ---------- Configuración ----------
  await openTab(page, 'Configuración');
  await expectVisible(page.getByRole('heading', { level: 2, name: 'Modo equipo' }), 'Configuración: the Modo equipo section');
  await expectVisible(page.getByLabel('Hora del plan de la mañana'), 'Configuración: the morning plan hour');
  await expectVisible(page.getByRole('button', { name: 'Pausar todo' }), 'Configuración: Pausar todo');
  await expectVisible(page.getByRole('heading', { name: 'IA de cada agente' }), 'Configuración: each agent\'s AI');
  await shot(page, 'configuracion', width);
}

const browser = await chromium.launch({ executablePath: process.env.MATYA_CHROMIUM || undefined });
let restored = true;
try {
  for (const [width, height] of [[390, 844], [1280, 800]]) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'es-ES', colorScheme: 'light' });
    const page = await context.newPage();
    page.on('pageerror', (e) => fail(`page error at ${width}px: ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 500 && new URL(r.url()).origin === new URL(base).origin) fail(`${r.status()} from ${r.url()}`);
    });
    console.log(`--- ${width} px`);
    try {
      await login(page);
      pass(`logged in as ${email}`);
      await openCenter(page);
      await screens(page, width);

      if (width === 390) {
        // A piece open on the board: the steps, models and the review problems must fit the phone.
        await openTab(page, 'Hoy');
        await page.locator('details', { hasText: 'Cómo documentar los daños del techo' }).last().locator('summary').click();
        await expectVisible(page.getByText('La segunda imagen no lleva el logo'), 'Hoy: the piece detail shows its steps');
        await shot(page, 'hoy-pieza', width);

        // «Rehacer» opens the owner's note; it holds 500 characters, and nothing is sent.
        await page.getByRole('button', { name: 'Rehacer', exact: true }).click();
        const note = page.getByLabel('Qué quieres que cambie (opcional)');
        await note.fill('x'.repeat(600));
        const typed = await note.evaluate((el) => el.value.length);
        if (typed === 500) pass('Rehacer: the note keeps 500 characters out of 600 typed');
        else fail(`Rehacer: the note kept ${typed} characters, expected 500`);
        await note.scrollIntoViewIfNeeded();
        await shot(page, 'hoy-rehacer', width);
        await note.fill('');
        await page.getByRole('button', { name: 'Rehacer', exact: true }).click();

        // The night theme (<html data-theme="noche">, as the app's ThemePicker sets it), with the piece closed again.
        await page.locator('details[open] > summary').first().click();
        await page.evaluate(() => {
          try {
            localStorage.setItem('am-theme', 'noche');
          } catch {}
          if (window.__amTheme) window.__amTheme('noche');
          else document.documentElement.dataset.theme = 'noche';
        });
        const theme = await page.evaluate(() => document.documentElement.dataset.theme);
        if (theme === 'noche') pass('the night theme is on (data-theme="noche")');
        else fail(`the night theme did not turn on (data-theme="${theme}")`);
        await shot(page, 'hoy-noche', width);
        await page.evaluate(() => {
          try {
            localStorage.removeItem('am-theme');
          } catch {}
          if (window.__amTheme) window.__amTheme('claro');
          else document.documentElement.dataset.theme = 'claro';
        });

        // Team mode off while on the Equipo tab: the tab goes away and the center falls back to Conversación.
        await openTab(page, 'Equipo');
        await expectVisible(page.getByRole('heading', { level: 2, name: 'El equipo' }), 'team mode off: standing on the Equipo tab');
        restored = false;
        const off = await setTeamMode(page, false);
        if (!off.ok) fail(`team mode could not be turned off: ${off.error}`);
        else {
          try {
            await tab(page, 'Equipo').waitFor({ state: 'detached', timeout: 30000 });
            pass('team mode off: the Equipo tab went away');
          } catch {
            fail('team mode off: the Equipo tab is still there after 30 s');
          }
          await expectCount(tab(page, 'Hoy'), 0, 'team mode off: the Hoy tab went away');
          await expectVisible(page.getByRole('heading', { level: 2, name: 'Qué hacemos hoy' }), 'team mode off: the center fell back to Conversación');
          if ((await tab(page, 'Conversación').getAttribute('aria-current')) === 'page') pass('team mode off: Conversación is the current tab');
          else fail('team mode off: Conversación is not the current tab');
          await shot(page, 'conversacion-sin-equipo', width);
        }
        const on = await setTeamMode(page, true);
        if (on.ok) {
          restored = true;
          pass('team mode is on again (the fixtures are as the seed left them)');
        } else fail(`team mode could not be turned on again: ${on.error}`);
      }
    } catch (e) {
      fail(`${width}px: ${e instanceof Error ? e.message : e}`);
      await page.screenshot({ path: join(dir, `error-${width}.png`), fullPage: true }).catch(() => {});
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
if (!restored) console.error('WARNING team mode may still be off in the database: run scripts/agent-seed-local.mjs again.');

console.log(`\n${shots.length} screenshots in ${resolve(dir)}:`);
for (const s of shots) console.log(`  ${s}`);
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nAll checks passed.');
