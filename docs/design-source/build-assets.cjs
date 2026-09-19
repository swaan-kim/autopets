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
  const options = { check: false, plan: false, help: false, repoRoot: null, source: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--check') options.check = true;
    else if (arg === '--plan') options.plan = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--repo-root' || arg === '--source') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path.`);
      options[arg === '--repo-root' ? 'repoRoot' : 'source'] = path.resolve(value);
    } else if (!arg.startsWith('-') && !options.source) options.source = path.resolve(arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function outputPaths(repoRoot) {
  const petDirectory = path.join(repoRoot, 'public/assets/pet');
  return {
    petDirectory,
    html: path.join(repoRoot, 'docs/demo/index.html'),
    sprite: path.join(petDirectory, 'sprite.png'),
    manifest: path.join(petDirectory, 'manifest.json'),
    frames: Array.from({ length: FRAME_COUNT }, (_, index) => path.join(petDirectory, `frame-${index}.png`)),
  };
}

async function assemble(sharp, source, template) {
  const metadata = await sharp(source).metadata();
  if (!metadata.hasAlpha) throw new Error('The source atlas must have a genuine alpha channel.');
  if (metadata.width !== metadata.height * 2) throw new Error('The source atlas must have a 2:1 aspect ratio (four columns, two rows).');
  if (template.split(PLACEHOLDER).length !== 2) throw new Error('The HTML template must contain exactly one sprite placeholder.');

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
  const html = Buffer.from(template.replace(PLACEHOLDER, `data:image/png;base64,${sprite.toString('base64')}`));
  return { frames, sprite, manifest, html };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log('Usage: node docs/design-source/build-assets.cjs [--check | --plan] [--repo-root PATH] [--source PNG]\nDefault: rebuild public/assets/pet/* and docs/demo/index.html.\n--check: compare generated bytes with existing outputs without writing.\n--plan: print source/output paths without loading image dependencies.');
    return;
  }
  const repoRoot = options.repoRoot || findRepository();
  if (!isRepository(repoRoot)) throw new Error('The destination is not an AutoPets repository (package.json name must be autopets-local).');
  const source = options.source || path.join(__dirname, 'sprite-source.png');
  const templatePath = path.join(__dirname, 'index.template.html');
  const paths = outputPaths(repoRoot);
  const relative = file => path.relative(repoRoot, file).split(path.sep).join('/');
  if (options.plan) {
    console.log(JSON.stringify({ mode: 'plan', source: relative(source), template: relative(templatePath), outputs: [...paths.frames, paths.sprite, paths.manifest, paths.html].map(relative) }, null, 2));
    return;
  }
  let sharp;
  try { sharp = createRequire(path.join(repoRoot, 'docs/design-source/package.json'))('sharp'); }
  catch { throw new Error('Missing image dependency. Run npm ci --prefix docs/design-source from the repository root.'); }
  const template = fs.readFileSync(templatePath, 'utf8');
  const outputs = await assemble(sharp, source, template);
  const files = [...outputs.frames.map((buffer, index) => [paths.frames[index], buffer]), [paths.sprite, outputs.sprite], [paths.manifest, outputs.manifest], [paths.html, outputs.html]];
  if (options.check) {
    const different = files.filter(([file, buffer]) => !fs.existsSync(file) || !fs.readFileSync(file).equals(buffer)).map(([file]) => relative(file));
    if (different.length) throw new Error(`Generated output differs (no files changed): ${different.join(', ')}`);
  } else {
    // Compute and validate every artifact first. Only the documented output files are written.
    for (const [file, buffer] of files) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buffer); }
  }
  console.log(JSON.stringify({ mode: options.check ? 'check' : 'build', files: files.length, spriteBytes: outputs.sprite.length, spriteSha256: createHash('sha256').update(outputs.sprite).digest('hex'), outputs: files.map(([file]) => relative(file)) }, null, 2));
}

module.exports = { assemble, main, outputPaths, parseArguments };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
