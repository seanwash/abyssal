import chromium from '@sparticuz/chromium';
import { chromium as pw, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Opens two separate browsers against a running `npm run dev`, swims both divers with
 * real keyboard input, and records a video and screenshots of each client into bots/out.
 *
 *   npm run bots                      # uses the installed Chromium (npx playwright install chromium)
 *   BROWSER=sparticuz npm run bots    # uses the bundled headless Chromium with software WebGL
 */
const URL = process.env.URL ?? 'http://localhost:5173/';
const OUT = path.resolve('bots/out');
const SIZE = { width: Number(process.env.W ?? 960), height: Number(process.env.H ?? 540) };
const QUICK = process.argv.includes('--quick');
/** Stretches every key hold, for slow software-rendered runs where each frame takes hundreds of ms. */
const PACE = Number(process.env.PACE ?? 1);
/** Both browsers join this party so they share a dive. */
const PARTY = `BOTS${Date.now() % 100000}`;

const SOFTWARE_GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

async function launch() {
  if (process.env.BROWSER === 'sparticuz') {
    return pw.launch({ executablePath: await chromium.executablePath(), args: [...SOFTWARE_GL, '--no-sandbox'], headless: true });
  }
  return pw.launch({ args: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu'], headless: process.env.HEADED ? false : true });
}

async function hold(page: Page, keys: string[], ms: number) {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms * PACE);
  for (const k of keys) await page.keyboard.up(k);
}

async function ready(page: Page) {
  await page.waitForFunction(() => (window as any).__abyssal?.status && (window as any).__abyssal.status !== 'connecting', null, { timeout: 240_000, polling: 1000 });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browsers = [await launch(), await launch()];
  const mk = async (name: string, i: number) => {
    const ctx = await browsers[i].newContext({ viewport: SIZE, recordVideo: QUICK ? undefined : { dir: OUT, size: SIZE } });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${name}] ${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => console.log(`[${name}] pageerror: ${e.message}`));
    await page.goto(`${URL}?name=${encodeURIComponent(name)}&party=${PARTY}${process.env.QS ?? ''}`);
    return { ctx, page };
  };

  const a = await mk('Sean', 0);
  await ready(a.page);
  const b = await mk('Jaime', 1);
  await ready(b.page);
  await a.page.waitForTimeout(QUICK ? 1500 : 2500);
  await a.page.screenshot({ path: path.join(OUT, 'a-0-start.png'), timeout: 180_000 });
  await b.page.screenshot({ path: path.join(OUT, 'b-0-start.png'), timeout: 180_000 });
  if (QUICK) { await Promise.all(browsers.map((x) => x.close())); return; }

  await Promise.all([
    hold(a.page, ['KeyW', 'KeyA'], 2600),
    hold(b.page, ['KeyW', 'KeyD', 'Space'], 2000),
  ]);
  await Promise.all([
    a.page.screenshot({ path: path.join(OUT, 'a-1-swim.png'), timeout: 180_000 }),
    b.page.screenshot({ path: path.join(OUT, 'b-1-swim.png'), timeout: 180_000 }),
  ]);
  await Promise.all([
    hold(a.page, ['KeyD'], 1800),
    hold(b.page, ['KeyS', 'ShiftLeft'], 1800),
  ]);
  await Promise.all([
    hold(a.page, ['KeyW'], 1500),
    hold(b.page, ['KeyA'], 1500),
  ]);
  await a.page.waitForTimeout(1500);
  await Promise.all([
    a.page.screenshot({ path: path.join(OUT, 'a-2-together.png'), timeout: 180_000 }),
    b.page.screenshot({ path: path.join(OUT, 'b-2-together.png'), timeout: 180_000 }),
  ]);
  const report = await Promise.all([a.page, b.page].map((p) => p.evaluate(() => {
    const s = (window as any).__abyssal;
    return { status: s.status, corrections: s.corrections, frames: s.frames, frameMs: Math.round(s.frameMs), divers: s.divers.map((d: any) => ({ name: d.name, local: d.local, x: +d.x.toFixed(2), y: +d.y.toFixed(2), z: +d.z.toFixed(2) })) };
  })));
  console.log(JSON.stringify(report, null, 2));
  await a.ctx.close();
  await b.ctx.close();
  await Promise.all(browsers.map((x) => x.close()));
  console.log(`videos and screenshots in ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
