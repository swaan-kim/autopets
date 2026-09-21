'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const { assemble, assembleMotionPair, assemblePromo, renderHtml, validateMotionConfig } = require('./build-assets.cjs');
const config = require('./promo-motion-config.json');

// Geometric test fixtures are not character artwork. Shift one source pose so
// the test catches per-pose auto-centering, which destroys intended motion.
async function fixture({ emptySecond = false, opaque = false, clipped = false } = {}) {
  const width = 200, height = 100, pixels = Buffer.alloc(width * height * 4);
  if (opaque) for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255;
  for (let pose = 0; pose < 2; pose++) {
    if (pose && emptySecond) continue;
    const startX = clipped ? 0 : 20 + pose * 6;
    for (let y = 20; y < 70; y++) for (let x = startX; x < startX + 36; x++) {
      const offset = (y * width + pose * 100 + x) * 4;
      pixels[offset] = 200; pixels[offset + 1] = 150; pixels[offset + 2] = 90; pixels[offset + 3] = 255;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function opaqueBounds(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x1 = info.width, y1 = info.height, x2 = -1, y2 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3] > 128) {
    x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y);
  }
  return [x1, y1, x2, y2];
}

test('native eight-frame atlas and manifest stay byte-identical', async () => {
  const native = await assemble(sharp, path.join(__dirname, 'sprite-source.png'));
  const nativeDir = path.resolve(__dirname, '../../apps/desktop/public/assets/pet');
  assert.equal(createHash('sha256').update(native.sprite).digest('hex'), '04746ea7c1985acff12abaee2b03559d4a63ee67c65631b066f1d763a94fe31d');
  assert.deepEqual(native.manifest, fs.readFileSync(path.join(nativeDir, 'manifest.json')));
  for (let index = 0; index < 8; index++) assert.deepEqual(native.frames[index], fs.readFileSync(path.join(nativeDir, `frame-${index}.png`)));
});

test('pair shares crop and scale while preserving horizontal pose movement', async () => {
  const pair = await assembleMotionPair(sharp, await fixture(), 'thinking', 8);
  assert.deepEqual(pair.checks[0].sharedCrop, pair.checks[1].sharedCrop);
  assert.deepEqual(pair.checks[0].contentSize, pair.checks[1].contentSize);
  const bounds = await Promise.all(pair.frames.map(opaqueBounds));
  assert.ok(bounds[1][0] > bounds[0][0], 'the second pose must retain its source shift');
  assert.equal(bounds[0][3], 59);
  assert.equal(bounds[1][3], 59);
  for (const frame of pair.frames) {
    const metadata = await sharp(frame).metadata();
    assert.equal(metadata.width, 64); assert.equal(metadata.height, 64); assert.equal(metadata.hasAlpha, true);
  }
});

test('invalid backgrounds, empty poses, and source clipping fail before output', async () => {
  await assert.rejects(assembleMotionPair(sharp, await fixture({ opaque: true }), 'dizzy', 12), /transparent background/);
  await assert.rejects(assembleMotionPair(sharp, await fixture({ emptySecond: true }), 'dizzy', 12), /empty pose/);
  await assert.rejects(assembleMotionPair(sharp, await fixture({ clipped: true }), 'dizzy', 12), /source cell edge/);
});

test('promo atlas embeds exactly 18 frames and preserves the eight native pixels', async () => {
  const native = await assemble(sharp, path.join(__dirname, 'sprite-source.png'));
  const source = await fixture();
  const sources = Object.fromEntries(['thinking', 'tool', 'dizzy', 'angry', 'celebrate'].map(name => [name, source]));
  const promo = await assemblePromo(sharp, native, sources, config, '<style>__SPRITE_DATA__</style><script>const motions=__MOTION_MANIFEST__;</script>');
  assert.equal(promo.frames.length, 18);
  const metadata = await sharp(promo.sprite).metadata();
  assert.equal(metadata.width, 256); assert.equal(metadata.height, 320); assert.equal(metadata.hasAlpha, true);
  assert.equal(JSON.parse(promo.manifest).checks.length, 18);
  assert.equal(promo.html.includes('__MOTION_MANIFEST__'), false);
  for (let index = 0; index < 8; index++) {
    const actual = await sharp(promo.sprite).extract({ left: index % 4 * 64, top: Math.floor(index / 4) * 64, width: 64, height: 64 }).ensureAlpha().raw().toBuffer();
    assert.deepEqual(actual, await sharp(native.frames[index]).ensureAlpha().raw().toBuffer());
  }
  const blank = await sharp(promo.sprite).extract({ left: 128, top: 256, width: 128, height: 64 }).ensureAlpha().raw().toBuffer();
  assert.equal(blank.every(value => value === 0), true, 'unused atlas cells stay transparent');
});

test('motion manifest rejects conflicting frame maps and HTML safely embeds labels', () => {
  const invalid = structuredClone(config); invalid.animations.dizzy.frames = [14, 15];
  assert.throws(() => validateMotionConfig(invalid), /Invalid promo animation: dizzy/);
  assert.throws(() => renderHtml('__SPRITE_DATA__', Buffer.from('png'), config), /__MOTION_MANIFEST__/);
  const labelConfig = structuredClone(config); labelConfig.animations.thinking.label = '</script><script>bad</script>';
  const html = renderHtml('__SPRITE_DATA__ __MOTION_MANIFEST__', Buffer.from('png'), labelConfig).toString();
  assert.equal(html.includes('</script>'), false);
  assert.ok(html.includes('\\u003c/script>'));
});
