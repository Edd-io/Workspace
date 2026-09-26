// Browser smoke test of a running Workspace: login, office sync, 3D world, desk terminal.
//
//   SMOKE_URL=http://127.0.0.1:4317 SMOKE_PASSWORD=... pnpm smoke
//
// Uses an installed Chrome through playwright-core (no browser download). Set CHROME_PATH when
// Chrome is not at its default macOS location. SMOKE_SCREENSHOT=path saves a screenshot.
import { chromium } from 'playwright-core';

const url = process.env.SMOKE_URL ?? 'http://127.0.0.1:4317';
const password = process.env.SMOKE_PASSWORD;
const executablePath =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!password) {
  console.error('Set SMOKE_PASSWORD.');
  process.exit(2);
}

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.fill('input[type=password]', password);
  await page.press('input[type=password]', 'Enter');
  await page.waitForSelector('.topbar', { timeout: 20_000 });
  check('logged in', true);
  await page.waitForSelector('.connection--open', { timeout: 15_000 }).catch(() => undefined);
  check('realtime connection open', (await page.locator('.connection--open').count()) === 1);
  check('3D canvas rendered', (await page.locator('canvas').count()) > 0);
  const desks = await page.locator('.sidebar-desk__main').count();
  check(`office synced (${desks} desks)`, (await page.locator('.sidebar').count()) === 1);
  if (desks > 0) {
    await page.locator('.sidebar-desk__main').first().click();
    await page.waitForSelector('.xterm-helper-textarea', { timeout: 10_000 }).catch(() => undefined);
    check('desk terminal opens', (await page.locator('.xterm-helper-textarea').count()) === 1);
  }
  if (process.env.SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.SMOKE_SCREENSHOT });
  check('no page error', errors.length === 0);
  for (const error of errors) console.log(`  page error: ${error}`);
} finally {
  await browser.close();
}
process.exit(failures.length === 0 ? 0 : 1);
