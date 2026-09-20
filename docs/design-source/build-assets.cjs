#!/usr/bin/env node
'use strict';

// Deterministic assembly of the included atlas. This script does not generate art.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');

const FRAME_SIZE = 64;
const FRAME_COUNT = 8;
const PLACEHOLDER = '__SPRITE_DATA__';
const MOTION_PLACEHOLDER = '__MOTION_MANIFEST__';
const NEW_MOTIONS = ['thinking', 'tool', 'dizzy', 'angry', 'celebrate'];

function isRepository(directory) {
  try { return JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).name === 'autopets-local'; }
  catch { return false; }
}

function findRepository() {
  for (let directory = __dirname; ; directory = path.dirname(directory)) {
    if (isRepository(directory)) return directory;
    if (directory === path.dirname(directory)) break;
  }
  // The authoring handoff may keep this file in a sibling autopets-concept folder.
  const sibling = path.resolve(__dirname, '../autopets');
  if (isRepository(sibling)) return sibling;
  throw new Error('AutoPets repository not found. Use --repo-root <repository-directory>.');
}

function parseArguments(argv) {
  const options = { check: false, plan: false, help: false, repoRoot: null, source: null, motionSourceDir: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--check') options.check = true;
    else if (arg === '--plan') options.plan = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--repo-root' || arg === '--source' || arg === '--motion-source-dir') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path.`);
      options[arg === '--repo-root' ? 'repoRoot' : arg === '--source' ? 'source' : 'motionSourceDir'] = path.resolve(value);
    } else if (!arg.startsWith('-') && !options.source) options.source = path.resolve(arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function outputPaths(repoRoot) {
  const petDirectory = path.join(repoRoot, 'public/assets/pet');
  const promoDirectory = path.join(repoRoot, 'docs/demo/assets');
  return {
    petDirectory,
    html: path.join(repoRoot, 'docs/demo/index.html'),
    sprite: path.join(petDirectory, 'sprite.png'),
    manifest: path.join(petDirectory, 'manifest.json'),
    frames: Array.from({ length: FRAME_COUNT }, (_, index) => path.join(petDirectory, `frame-${index}.png`)),
    promoSprite: path.join(promoDirectory, 'promo-sprite.png'),
    promoManifest: path.join(promoDirectory, 'promo-motion-manifest.json'),
    promoFrames: Array.from({ length: 18 }, (_, index) => path.join(promoDirectory, `frame-${index}.png`)),
  };
}

// Preserve the original native atlas algorithm and manifest byte for byte.
async function assemble(sharp, source) {
  const metadata = await sharp(source).metadata();
  if (!metadata.hasAlpha) throw new Error('The source atlas must have a genuine alpha channel.');
  if (metadata.width !== metadata.height * 2) throw new Error('The source atlas must have a 2:1 aspect ratio (four columns, two rows).');

  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error('The source atlas must decode to RGBA.');
  const frames = [], composites = [], checks = [];
  for (let index = 0; index < FRAME_COUNT; index++) {
    const col = index % 4, row = Math.floor(index / 4);
    const left = Math.round(col * info.width / 4), top = Math.round(row * info.height / 2);
    const right = Math.round((col + 1) * info.width / 4), bottom = Math.round((row + 1) * info.height / 2);
    let x1 = right, y1 = bottom, x2 = left, y2 = top;
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 128) {
        x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y);
      }
    }
    if (x2 <= x1 || y2 <= y1) throw new Error(`Empty frame ${index}.`);
    const w = x2 - x1 + 1, h = y2 - y1 + 1;
    const width = Math.max(1, Math.round(w * 52 / (info.height / 2 * .80)));
    const height = Math.max(1, Math.round(h * 52 / (info.height / 2 * .80)));
    if (width > 60 || height > 59) throw new Error(`Unexpected content bounds in frame ${index}.`);
    const resized = await sharp(source).extract({ left: x1, top: y1, width: w, height: h }).resize(width, height, { kernel: 'nearest' }).png().toBuffer();
    const frame = await sharp({ create: { width: FRAME_SIZE, height: FRAME_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: resized, left: Math.floor((FRAME_SIZE - width) / 2), top: 60 - height }]).png().toBuffer();
    frames.push(frame);
    composites.push({ input: frame, left: col * FRAME_SIZE, top: row * FRAME_SIZE });
    checks.push({ index, width: FRAME_SIZE, height: FRAME_SIZE, sourceBounds: [x1, y1, x2, y2], contentSize: [width, height], baseline: 60 });
  }
  const sprite = await sharp({ create: { width: 256, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites).png({ palette: true, colours: 64, dither: 0 }).toBuffer();
  const manifest = Buffer.from(JSON.stringify({
    version: 1, frameSize: FRAME_SIZE, columns: 4, rows: 2,
    animations: { idle: { frames: [0, 1, 2, 3], fps: 2 }, research: { frames: [4, 5], fps: 2 }, writing: { frames: [6, 7], fps: 3 } },
    runtimeGeneration: false, source: 'ImageGen, derived from user-shared cream puppy reference', bytes: sprite.length, checks,
  }, null, 2));
  return { frames, sprite, manifest, checks };
}

function validateMotionConfig(config) {
  if (config.version !== 4 || config.frameSize !== 64 || config.columns !== 4 || config.rows !== 5 || config.frameCount !== 18 || config.baseline !== 60 || config.bodySize !== 52 || config.runtimeGeneration !== false) {
    throw new Error('The promo config must describe 18 fixed 64px frames on a 4 by 5 grid (52px body, baseline 60).');
  }
  const expected = { idle: [0, 1, 2, 3], research: [4, 5], writing: [6, 7], thinking: [8, 9], tool: [10, 11], dizzy: [12, 13], angry: [14, 15], celebrate: [16, 17] };
  if (Object.keys(config.animations || {}).length !== Object.keys(expected).length) throw new Error('Unexpected promo animation count.');
  for (const [name, frames] of Object.entries(expected)) {
    const animation = config.animations[name];
    if (!animation || JSON.stringify(animation.frames) !== JSON.stringify(frames) || !frames.includes(animation.stillFrame) || !Number.isFinite(animation.fps) || animation.fps <= 0 || animation.fps > 12 || typeof animation.label !== 'string' || !animation.label.trim()) {
      throw new Error(`Invalid promo animation: ${name}.`);
    }
  }
}

// Both source poses retain one shared crop, scale, and placement. Per-frame
// auto-trimming would erase a hop or convert minor arm movement into jitter.
async function assembleMotionPair(sharp, source, name, firstIndex) {
  const metadata = await sharp(source).metadata();
  if (!metadata.hasAlpha || !metadata.width || !metadata.height || metadata.width < metadata.height) {
    throw new Error(`${name}: expected a transparent horizontal two-frame PNG.`);
  }
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const halfWidth = Math.floor(info.width / 2);
  const halves = [0, Math.ceil(info.width / 2)];
  let x1 = halfWidth, y1 = info.height, x2 = -1, y2 = -1;
  const sourceBounds = [];
  for (const left of halves) {
    let bx1 = halfWidth, by1 = info.height, bx2 = -1, by2 = -1, hasTransparency = false;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < halfWidth; x++) {
      const alpha = data[(y * info.width + left + x) * 4 + 3];
      if (alpha === 0) hasTransparency = true;
      if (alpha > 128) { bx1 = Math.min(bx1, x); by1 = Math.min(by1, y); bx2 = Math.max(bx2, x); by2 = Math.max(by2, y); }
    }
    if (bx2 <= bx1 || by2 <= by1) throw new Error(`${name}: empty pose in source half ${sourceBounds.length}.`);
    if (!hasTransparency) throw new Error(`${name}: source pose has no transparent background.`);
    if (bx1 === 0 || by1 === 0 || bx2 === halfWidth - 1 || by2 === info.height - 1) throw new Error(`${name}: pose touches its source cell edge; inspect possible clipping.`);
    sourceBounds.push([bx1, by1, bx2, by2]);
    x1 = Math.min(x1, bx1); y1 = Math.min(y1, by1); x2 = Math.max(x2, bx2); y2 = Math.max(y2, by2);
  }
  const cropWidth = x2 - x1 + 1, cropHeight = y2 - y1 + 1;
  const scale = 52 / Math.max(cropWidth, cropHeight);
  const width = Math.max(1, Math.round(cropWidth * scale)), height = Math.max(1, Math.round(cropHeight * scale));
  const frames = [], checks = [];
  for (let pose = 0; pose < 2; pose++) {
    const resized = await sharp(source).extract({ left: halves[pose] + x1, top: y1, width: cropWidth, height: cropHeight }).resize(width, height, { kernel: 'nearest' }).png().toBuffer();
    frames.push(await sharp({ create: { width: FRAME_SIZE, height: FRAME_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: resized, left: Math.floor((FRAME_SIZE - width) / 2), top: 60 - height }]).png().toBuffer());
    checks.push({ index: firstIndex + pose, motion: name, sourceHalf: pose, width: FRAME_SIZE, height: FRAME_SIZE, sourceBounds: sourceBounds[pose], sharedCrop: [x1, y1, x2, y2], contentSize: [width, height], baseline: 60 });
  }
  return { frames, checks };
}

function renderHtml(template, sprite, config) {
  for (const placeholder of [PLACEHOLDER, MOTION_PLACEHOLDER]) {
    if (template.split(placeholder).length !== 2) throw new Error(`The HTML template must contain exactly one ${placeholder} placeholder.`);
  }
  // Safe in an inline script even if a future display label contains HTML text.
  const json = JSON.stringify(config).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  return Buffer.from(template.replace(PLACEHOLDER, `data:image/png;base64,${sprite.toString('base64')}`).replace(MOTION_PLACEHOLDER, json));
}

async function assemblePromo(sharp, native, sources, config, template) {
  validateMotionConfig(config);
  const frames = [...native.frames], checks = [...native.checks];
  const inputs = [];
  for (const name of NEW_MOTIONS) {
    const source = sources[name];
    if (!source) throw new Error(`Missing source for ${name}.`);
    const pair = await assembleMotionPair(sharp, source, name, config.animations[name].frames[0]);
    frames.push(...pair.frames); checks.push(...pair.checks);
    inputs.push({ motion: name, source: `motion-sources/${name}.png`, sha256: createHash('sha256').update(source).digest('hex') });
  }
  // Copy RGBA rows directly: palette quantization and premultiplied alpha
  // compositing can both change pixels in the eight reused native poses.
  const atlasWidth = config.columns * FRAME_SIZE, atlasHeight = config.rows * FRAME_SIZE;
  const pixels = Buffer.alloc(atlasWidth * atlasHeight * 4);
  for (let index = 0; index < frames.length; index++) {
    const raw = await sharp(frames[index]).ensureAlpha().raw().toBuffer();
    const left = index % config.columns * FRAME_SIZE, top = Math.floor(index / config.columns) * FRAME_SIZE;
    for (let row = 0; row < FRAME_SIZE; row++) raw.copy(pixels, ((top + row) * atlasWidth + left) * 4, row * FRAME_SIZE * 4, (row + 1) * FRAME_SIZE * 4);
  }
  const sprite = await sharp(pixels, { raw: { width: atlasWidth, height: atlasHeight, channels: 4 } }).png().toBuffer();
  const manifest = Buffer.from(JSON.stringify({ ...config, source: 'ImageGen artwork; deterministic offline assembly', bytes: sprite.length, inputs, checks }, null, 2));
  return { frames, sprite, manifest, html: renderHtml(template, sprite, config) };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log('Usage: node docs/design-source/build-assets.cjs [--check | --plan] [--repo-root PATH] [--source PNG] [--motion-source-dir PATH]\nDefault: rebuild the original native atlas unchanged, the separate 18-frame promo atlas, and offline HTML.\n--check: compare generated bytes with existing outputs without writing.\n--plan: print source/output paths without loading image dependencies.');
    return;
  }
  const repoRoot = options.repoRoot || findRepository();
  if (!isRepository(repoRoot)) throw new Error('The destination is not an AutoPets repository (package.json name must be autopets-local).');
  const source = options.source || path.join(__dirname, 'sprite-source.png');
  const templatePath = path.join(__dirname, 'index.template.html');
  const configPath = path.join(__dirname, 'promo-motion-config.json');
  const motionSourceDir = options.motionSourceDir || path.join(__dirname, 'motion-sources');
  const motionSources = Object.fromEntries(NEW_MOTIONS.map(name => [name, path.join(motionSourceDir, `${name}.png`)]));
  const paths = outputPaths(repoRoot);
  const relative = file => path.relative(repoRoot, file).split(path.sep).join('/');
  if (options.plan) {
    console.log(JSON.stringify({ mode: 'plan', source: relative(source), motionSources: Object.fromEntries(Object.entries(motionSources).map(([name, file]) => [name, relative(file)])), config: relative(configPath), template: relative(templatePath), outputs: [...paths.frames, paths.sprite, paths.manifest, ...paths.promoFrames, paths.promoSprite, paths.promoManifest, paths.html].map(relative) }, null, 2));
    return;
  }
  let sharp;
  try { sharp = createRequire(path.join(repoRoot, 'docs/design-source/package.json'))('sharp'); }
  catch { throw new Error('Missing image dependency. Run npm ci --prefix docs/design-source from the repository root.'); }
  const brandPath = path.join(repoRoot, 'public/assets/brand/autopets-mark.svg');
  const brandMark = fs.readFileSync(brandPath, 'utf8').replace(/role="img" aria-labelledby="title desc"/, 'aria-hidden="true"').replace(/<title[^>]*>.*?<\/title>|<desc[^>]*>.*?<\/desc>/gs, '').replace(/[ \t]+$/gm, '');
  const template = fs.readFileSync(templatePath, 'utf8').replaceAll('__BRAND_MARK__', brandMark);
  const native = await assemble(sharp, source);
  const sourceBuffers = Object.fromEntries(Object.entries(motionSources).map(([name, file]) => [name, fs.readFileSync(file)]));
  const outputs = await assemblePromo(sharp, native, sourceBuffers, JSON.parse(fs.readFileSync(configPath, 'utf8')), template);
  const files = [...native.frames.map((buffer, index) => [paths.frames[index], buffer]), [paths.sprite, native.sprite], [paths.manifest, native.manifest], ...outputs.frames.map((buffer, index) => [paths.promoFrames[index], buffer]), [paths.promoSprite, outputs.sprite], [paths.promoManifest, outputs.manifest], [paths.html, outputs.html]];
  if (options.check) {
    const different = files.filter(([file, buffer]) => !fs.existsSync(file) || !fs.readFileSync(file).equals(buffer)).map(([file]) => relative(file));
    if (different.length) throw new Error(`Generated output differs (no files changed): ${different.join(', ')}`);
  } else {
    // Compute and validate every artifact first. Only the documented output files are written.
    for (const [file, buffer] of files) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buffer); }
  }
  console.log(JSON.stringify({ mode: options.check ? 'check' : 'build', files: files.length, spriteBytes: outputs.sprite.length, spriteSha256: createHash('sha256').update(outputs.sprite).digest('hex'), outputs: files.map(([file]) => relative(file)) }, null, 2));
}

module.exports = { assemble, assembleMotionPair, assemblePromo, main, outputPaths, parseArguments, renderHtml, validateMotionConfig };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
