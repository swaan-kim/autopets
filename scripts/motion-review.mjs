// Mouse-free motion review: replays the same virtual pointer and synthetic task
// events against the real overlay renderer in a separate headless browser.
//   node scripts/motion-review.mjs [--label 기준] [--only S1,S3] [--scale 1.5] [--origin http://127.0.0.1:1437]
//   node scripts/motion-review.mjs --compare work/motion-review/<a> work/motion-review/<b>
// Never attaches to a running browser, the installed app, a user DB or a real chat.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installReviewBridge } from './motion-review/page-bridge.mjs';
import { fixtures, reviewSnapshot, runTemplate, scenarios } from './motion-review/scenarios.mjs';
import { summarize } from './motion-review/metrics.mjs';
import { compareHtml } from './motion-review/compare.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = parse(process.argv.slice(2));
const viewport = { width: 760, height: 680 };
// Not the 1420 development port: an existing dev server is never reused or stopped.
const reviewPort = 1437;

if (options.compare) {
  const runs = await Promise.all(options.compare.map(async directory => ({ directory: path.resolve(directory), report: JSON.parse(await fs.readFile(path.join(directory, 'report.json'), 'utf8')) })));
  const output = path.resolve(options.out || path.join(path.dirname(runs[0].directory), `compare-${stamp()}.html`));
  await fs.writeFile(output, compareHtml(runs, output));
  console.log(JSON.stringify({ compare: path.relative(root, output) }));
} else {
  await review();
}

async function review() {
  const { chromium } = await import('playwright');
  const directory = path.resolve(options.out || path.join(root, 'work', 'motion-review', `${stamp()}-${slug(options.label)}`));
  await fs.mkdir(directory, { recursive: true });
  let server;
  let browser;
  try {
    let origin = options.origin;
    if (!origin) {
      const desktopRequire = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
      const { createServer } = await import(pathToFileURL(desktopRequire.resolve('vite')).href);
      server = await createServer({ root: path.join(root, 'apps/desktop'), logLevel: 'error', clearScreen: false, server: { host: '127.0.0.1', port: reviewPort, strictPort: true } });
      await server.listen();
      origin = `http://127.0.0.1:${reviewPort}`;
    }
    origin = new URL(origin).origin;
    browser = await chromium.launch({ headless: true });
    const selected = scenarios.filter(item => !options.only || options.only.includes(item.id));
    if (!selected.length) throw Error('No scenario matches --only');
    const results = [];
    for (const scenario of selected) {
      console.log(`${scenario.id} ${scenario.title}`);
      results.push(await runScenario({ browser, origin, scenario, directory }));
    }
    const report = {
      label: options.label, recordedAt: new Date().toISOString(),
      evidence: 'synthetic: isolated headless browser, virtual pointer, synthetic task events. Not the native Windows overlay, the installed app or a real chat.',
      source: source(options.source ? path.resolve(options.source) : root), origin, browser: `Chromium ${browser.version()}`, viewport, scale: options.scale,
      modelRequests: 0, scenarios: results,
    };
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    const failed = results.flatMap(item => item.expectations.filter(check => !check.pass).map(check => `${item.id} ${check.name}`));
    console.log(JSON.stringify({ output: path.relative(root, directory), expectationsNotMet: failed }));
    if (options.strict && failed.length) process.exitCode = 1;
  } catch (error) {
    await fs.writeFile(path.join(directory, 'failure.json'), JSON.stringify({ result: 'failed', message: error instanceof Error ? error.message : String(error) }, null, 2) + '\n');
    throw error;
  } finally {
    await browser?.close();
    await server?.close();
  }
}

async function runScenario({ browser, origin, scenario, directory }) {
  const videoDirectory = path.join(directory, '.video-tmp');
  const context = await browser.newContext({
    viewport, deviceScaleFactor: options.scale, reducedMotion: 'no-preference', serviceWorkers: 'block', acceptDownloads: false, permissions: [],
    recordVideo: { dir: videoDirectory, size: viewport },
  });
  // Only the dedicated review server may answer; every other request is refused.
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(installReviewBridge, { snapshot: reviewSnapshot(scenario.runs), runTemplate, ...fixtures });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const stageUrl = `${origin}/tests/motion-review.html?pets=${scenario.pets}&scenario=${encodeURIComponent(`${scenario.id} · ${scenario.title}`)}&variant=${encodeURIComponent(options.label)}`;
    await page.goto(stageUrl);
    const frames = await petFrames(page, scenario.pets);
    for (const frame of frames) await frame.locator('.pet-hit [role="img"]').first().waitFor({ timeout: 15000 });
    const renderer = await frames[0].evaluate(() => document.querySelector('.pet-hit .companion-pet') ? 'companion' : 'pet');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
    for (const frame of frames) await frame.evaluate(() => { window.__review.startSampling(); window.__review.mark('start'); });
    const before = await metric();
    const pointer = { x: 120, y: viewport.height / 2, pressed: false };
    const probes = {};
    for (const step of scenario.steps) await perform(page, frames, step, pointer, probes);
    const after = await metric();
    const collected = [];
    for (const frame of frames) collected.push(await frame.evaluate(() => {
      window.__review.mark('end'); window.__review.stopSampling();
      const { frames, marks, calls, windowCalls, longFrames } = window.__review;
      return { frames, marks, calls, windowCalls, longFrames };
    }));
    const stage = await page.evaluate(() => window.__stage.state());
    await page.screenshot({ path: path.join(directory, `${scenario.id}-end.png`) });
    const seconds = after.Timestamp - before.Timestamp;
    const result = {
      id: scenario.id, title: scenario.title, renderer, durationMs: Math.round(seconds * 1000),
      pets: collected.map(item => summarize(item.frames)), stage, probes,
      // Task/connection calls must stay empty; window calls are presentation only.
      calls: collected.flatMap(item => item.calls.map(call => call.name)),
      windowCalls: collected.flatMap(item => item.windowCalls.map(call => call.name)),
      longAnimationFrames: collected.reduce((sum, item) => sum + item.longFrames.length, 0),
      resource: { cpuPerSecond: seconds ? Math.round((after.ProcessTime - before.ProcessTime) / seconds * 1000) / 1000 : null, taskPerSecond: seconds ? Math.round((after.TaskDuration - before.TaskDuration) / seconds * 1000) / 1000 : null, jsHeapBytes: after.JSHeapUsedSize },
      pageErrors: errors,
    };
    result.expectations = [
      { name: '작업·연결 명령 호출 없음', pass: result.calls.length === 0, detail: result.calls.join(', ') || '0건' },
      { name: '페이지 오류 없음', pass: errors.length === 0, detail: errors.slice(0, 3).join(' / ') || '0건' },
      ...scenario.expect(result),
    ];
    await fs.writeFile(path.join(directory, `frames-${scenario.id}.json`), JSON.stringify(collected.map(item => ({ frames: item.frames, marks: item.marks }))) + '\n');
    const video = page.video();
    await context.close();
    if (video) {
      result.video = `${scenario.id}.webm`;
      result.screenshot = `${scenario.id}-end.png`;
      await fs.rename(await video.path(), path.join(directory, result.video));
    }
    await fs.rm(videoDirectory, { recursive: true, force: true });
    return result;
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}

async function petFrames(page, count) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const frames = [0, 1, 2].slice(0, count).map(slot => page.frames().find(frame => new URL(frame.url()).search === `?pet=${slot}`));
    if (frames.every(Boolean)) return frames;
    await page.waitForTimeout(50);
  }
  throw Error('pet frames did not load');
}

async function anchor(page, frames, target) {
  if (target.at === 'away') return { x: 120, y: viewport.height / 2 };
  const selector = target.at === 'handle' ? '.drag-handle' : '.pet-hit';
  const box = await frames[target.slot ?? 0].locator(selector).first().boundingBox();
  if (!box) throw Error(`anchor not visible: ${target.at}`);
  return { x: box.x + box.width / 2 + (target.dx ?? 0), y: box.y + box.height / 2 + (target.dy ?? 0) };
}

async function glide(page, pointer, points, ms) {
  const started = Date.now();
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    await page.mouse.move(point.x, point.y);
    Object.assign(pointer, point);
    await page.evaluate(({ x, y, pressed }) => window.__stage.pointer(x, y, pressed), pointer);
    const due = started + ms * (index + 1) / points.length - Date.now();
    if (due > 0) await page.waitForTimeout(due);
  }
}

async function perform(page, frames, step, pointer, probes) {
  if (step.do === 'wait') return page.waitForTimeout(step.ms);
  if (step.do === 'move' || step.do === 'curve') {
    const to = await anchor(page, frames, step.to);
    const count = Math.max(1, Math.round(step.ms / 16));
    const from = { x: pointer.x, y: pointer.y };
    const control = step.do === 'curve' ? bendPoint(from, to, step.bend) : null;
    const points = Array.from({ length: count }, (_, index) => {
      const t = (index + 1) / count;
      if (!control) return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      return { x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t * t * to.x, y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t * t * to.y };
    });
    return glide(page, pointer, points, step.ms);
  }
  if (step.do === 'down' || step.do === 'up') {
    pointer.pressed = step.do === 'down';
    await page.evaluate(({ x, y, pressed }) => window.__stage.pointer(x, y, pressed), pointer);
    return step.do === 'down' ? page.mouse.down() : page.mouse.up();
  }
  if (step.do === 'cancel') return frames[0].evaluate(() => {
    for (const target of [document.querySelector('.pet-hit'), document]) target?.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1, pointerType: 'mouse' }));
    window.__review.mark('pointercancel');
  });
  if (step.do === 'run') {
    for (const frame of frames) await frame.evaluate(run => window.__review.setRun(run, 0), step.run);
    return page.evaluate(text => window.__stage.caption(text), `가상 작업 상태: ${step.run.state}${step.run.profile ? ` (${step.run.profile})` : ''}`);
  }
  if (step.do === 'hidden') {
    for (const frame of frames) await frame.evaluate(value => window.__review.setHidden(value), step.value);
    return page.evaluate(text => window.__stage.caption(text), step.value ? '창 숨김 (합성)' : '창 다시 표시');
  }
  if (step.do === 'reduced') {
    await page.emulateMedia({ reducedMotion: step.value ? 'reduce' : 'no-preference' });
    return page.evaluate(text => window.__stage.caption(text), step.value ? '동작 줄이기 켬' : '동작 줄이기 끔');
  }
  if (step.do === 'probe') {
    probes[step.name] = await frames[0].evaluate(() => {
      const pet = document.querySelector('.pet-hit .companion-pet');
      return { playing: pet?.dataset.playing === 'true', animations: pet ? pet.getAnimations({ subtree: true }).length : null };
    });
    return;
  }
  throw Error(`unknown step: ${step.do}`);
}

function bendPoint(from, to, bend = 0) {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (from.x + to.x) / 2 - (to.y - from.y) / length * bend, y: (from.y + to.y) / 2 + (to.x - from.x) / length * bend };
}

function source(directory) {
  try {
    const commit = execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', directory, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
    return { commit, dirty };
  } catch { return { commit: null, dirty: null }; }
}

function parse(args) {
  const result = { label: 'review', scale: 1, only: null, origin: null, out: null, source: null, strict: false, compare: null };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const value = () => {
      const next = args[++index];
      if (next === undefined) throw Error(`missing value for ${arg}`);
      return next;
    };
    if (arg === '--label') result.label = value();
    else if (arg === '--scale') result.scale = Number(value());
    else if (arg === '--only') result.only = value().split(',');
    else if (arg === '--origin') result.origin = value();
    else if (arg === '--out') result.out = value();
    else if (arg === '--source') result.source = value();
    else if (arg === '--strict') result.strict = true;
    else if (arg === '--compare') {
      result.compare = [];
      while (args[index + 1] !== undefined && !args[index + 1].startsWith('--')) result.compare.push(args[++index]);
    }
    else throw Error(`unknown option: ${arg}`);
  }
  if (!(result.scale > 0 && result.scale <= 3)) throw Error('--scale must be between 0 and 3');
  if (result.compare && result.compare.length < 2) throw Error('--compare needs two report directories');
  if (result.origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(result.origin)) throw Error('--origin must be a loopback review server');
  return result;
}

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function slug(text) { return String(text).toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '') || 'review'; }
