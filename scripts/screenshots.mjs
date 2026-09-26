// Takes the README screenshots (docs/images/*.jpg) from a running Workspace, in English.
//
//   SHOTS_URL=http://localhost:5318 SHOTS_PASSWORD=... pnpm screenshots
//
// Point it at the Vite dev client of an ISOLATED instance (never your real office): it drives the
// camera through the development handles (window.__office), which production builds do not have.
// Uses an installed Chrome through playwright-core; set CHROME_PATH when Chrome is elsewhere.
// SHOTS_ONLY=overview,night takes a subset; SHOTS_DESK / SHOTS_TERMINAL pick the desks (by name) for
// the desk close-up and the terminal.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const url = process.env.SHOTS_URL ?? 'http://localhost:5317';
const password = process.env.SHOTS_PASSWORD;
const executablePath =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const only = process.env.SHOTS_ONLY?.split(',');
const outDir = resolve(import.meta.dirname, '../docs/images');
if (!password) {
  console.error('Set SHOTS_PASSWORD (the password of the isolated instance).');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const WIDTH = 1600;
const HEIGHT = 900;
/** Time for the camera to arrive and textures to load (the software renderer is slow). */
const SETTLE_MS = 3500;

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, locale: 'en-US' });
await page.addInitScript(() => localStorage.setItem('workspace.lang', 'en'));
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

const settle = (ms = SETTLE_MS) => page.waitForTimeout(ms);
const shoot = async (name) => {
  await page.screenshot({ path: join(outDir, `${name}.jpg`), type: 'jpeg', quality: 82 });
  console.log(`✓ ${name}.jpg`);
};
const wanted = (name) => !only || only.includes(name);

/** Resets the office to the overview, windows closed, at `hour` of the day. */
async function reset(hour) {
  await page.keyboard.press('Escape');
  await page.evaluate(
    async ({ hour, storeUrl }) => {
      const { useOffice } = await import(storeUrl);
      const state = useOffice.getState();
      state.setPanel(null);
      state.closeTerminal();
      state.focusDesk(null);
      // Toasts come and go: not in pictures.
      useOffice.setState({ toasts: [] });
      if (state.viewMode !== 'overview') state.setViewMode('overview');
      window.__office.setHour(hour);
    },
    { hour, storeUrl: '/src/state/officeStore.ts' },
  );
  await settle(1500);
}

/**
 * A desk to feature: the one named `name` if any, else one in the first of `states` found (running
 * desks have something on screen).
 */
async function featuredDesk(states, name) {
  return page.evaluate(
    async ({ storeUrl, states, name }) => {
      const { useOffice } = await import(storeUrl);
      const desks = Object.values(useOffice.getState().desks);
      const named = desks.find((desk) => desk.name === name);
      if (named) return named.id;
      const rank = (desk) => states.indexOf(desk.state);
      const running = desks.filter((desk) => rank(desk) >= 0).sort((a, b) => rank(a) - rank(b));
      return (running[0] ?? desks[0])?.id ?? null;
    },
    { storeUrl: '/src/state/officeStore.ts', states, name },
  );
}

/** World position of a point given in a desk's local frame (the chair is toward local +Z). */
function deskPoint(pose, [x, z]) {
  const cos = Math.cos(pose.rotation);
  const sin = Math.sin(pose.rotation);
  return [pose.x + x * cos + z * sin, pose.z - x * sin + z * cos];
}

/** Walk mode at a floor point, looking toward (tx, tz) with the given pitch. */
async function walkTo(x, z, tx, tz, pitch) {
  await page.evaluate(
    async ({ storeUrl }) => {
      const { useOffice } = await import(storeUrl);
      useOffice.getState().setViewMode('walk');
    },
    { storeUrl: '/src/state/officeStore.ts' },
  );
  await settle(800);
  await page.evaluate(
    ({ x, z, tx, tz, pitch }) => window.__office.goTo(x, z, Math.atan2(-(tx - x), -(tz - z)), pitch),
    { x, z, tx, tz, pitch },
  );
  await settle();
}

try {
  await page.goto(url);
  await page.fill('input[type=password]', password);
  await page.press('input[type=password]', 'Enter');
  await page.waitForSelector('.connection--open', { timeout: 30_000 });
  if (!(await page.evaluate(() => 'goTo' in (window.__office ?? {})))) {
    throw new Error('No development handles: point SHOTS_URL at the Vite dev client.');
  }
  // Walk hints and the crosshair are for people, not for pictures.
  await page.addStyleTag({
    content: '.walk-hints, .crosshair, .crosshair-label { display: none !important; }',
  });
  await settle();
  const workingDesk = await featuredDesk(['working', 'question', 'idle'], process.env.SHOTS_DESK);
  const askingDesk = await featuredDesk(['question', 'working', 'idle'], process.env.SHOTS_TERMINAL);
  const layout = await page.evaluate(() => ({
    desks: window.__layout.desks.map((entry) => ({
      id: entry.desk.id,
      x: entry.x,
      z: entry.z,
      rotation: entry.rotation,
    })),
    master: window.__layout.rooms.find((entry) => entry.kind === 'master'),
  }));

  if (wanted('overview')) {
    await reset(11);
    await settle();
    await shoot('overview');
  }

  const desk = layout.desks.find((entry) => entry.id === workingDesk);
  if (wanted('desk') && desk) {
    await reset(11);
    // Three-quarter view from the front right: the character at work, the screen and the lamp.
    const [x, z] = deskPoint(desk, [1.25, 1.15]);
    const [tx, tz] = deskPoint(desk, [0, -0.1]);
    await walkTo(x, z, tx, tz, -0.42);
    await shoot('desk');
  }

  if (wanted('terminal') && askingDesk) {
    await reset(11);
    await page.evaluate(
      async ({ deskId, storeUrl }) => (await import(storeUrl)).useOffice.getState().openTerminal(deskId),
      { deskId: askingDesk, storeUrl: '/src/state/officeStore.ts' },
    );
    await page.waitForSelector('.xterm-helper-textarea', { timeout: 15_000 });
    await settle();
    await shoot('terminal');
  }

  if (wanted('master-office')) {
    await reset(16);
    // At the chair of the master desk (its back to the back wall), looking at the three screens.
    const room = layout.master;
    const x = (room.x0 + room.x1) / 2;
    const deskZ = room.z0 + 0.06 + 2.1;
    await walkTo(x, deskZ - 0.85, x, deskZ + 1, -0.36);
    await shoot('master-office');
  }

  if (wanted('activity')) {
    await reset(11);
    await page.locator('.topbar__actions button', { hasText: 'Activity' }).click();
    await page.locator('.timeline__tabs button').nth(1).click();
    await page.locator('.segmented__item', { hasText: '7 days' }).click();
    await page.waitForSelector('.stats__table, .stats p', { timeout: 15_000 });
    await settle(1500);
    await shoot('activity');
  }

  if (wanted('search')) {
    await reset(11);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyK' : 'Control+KeyK');
    await page.waitForSelector('.search input');
    await page.keyboard.type(process.env.SHOTS_SEARCH ?? 'test');
    await page.waitForSelector('.search__results li, .search__status', { timeout: 15_000 });
    await settle(1500);
    await shoot('search');
  }

  if (wanted('night')) {
    // The lounge's terrace at night, facing the building, the neighborhood's windows lit behind it.
    await reset(22);
    const lounge = await page.evaluate(() => window.__layout.rooms.find((entry) => entry.kind === 'lounge'));
    const x = lounge.x1 - 4;
    const back = lounge.towardCorridor === -1 ? lounge.z1 : lounge.z0;
    const out = -lounge.towardCorridor;
    await walkTo(x, back + out * 11, x, back, 0.02);
    await shoot('night');
  }

  if (errors.length > 0) console.log(`page errors:\n  ${errors.join('\n  ')}`);
} finally {
  await browser.close();
}
