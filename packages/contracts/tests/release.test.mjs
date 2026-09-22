import test from 'node:test';
import assert from 'node:assert/strict';
import { RELEASE_EVIDENCE, validateReleaseChannel } from '../release.mjs';

function channel() {
  return { version: 2, platform: 'win32-x64', publicRelease: {
    version: '0.1.0', tag: 'v0.1.0', publishedAt: '2026-09-22T00:00:00Z',
    installer: { url: 'https://github.com/swaan-kim/autopets/releases/download/v0.1.0/AutoPets_0.1.0_x64-setup.exe', sha256: 'a'.repeat(64), authenticodeThumbprint: 'b'.repeat(40) },
    update: { url: 'https://swaan-kim.github.io/autopets/updates/windows-x64.json', publicKey: 'fixture-only-not-a-real-key' },
    evidence: Object.fromEntries(RELEASE_EVIDENCE.map(key => [key, true])),
  } };
}
test('unpublished channel is valid but exposes no installer', () => {
  assert.deepEqual(validateReleaseChannel({version:2,platform:'win32-x64',publicRelease:null}), {ok:true, errors:[], release:null});
  assert.equal(validateReleaseChannel({version:1,platform:'win32-x64',publicRelease:null}).ok, false);
});
test('only a pinned publication with every evidence gate exposes a release', () => {
  assert.equal(validateReleaseChannel(channel()).ok, true);
  for (const key of RELEASE_EVIDENCE) {
    const value=channel(); value.publicRelease.evidence[key]=false;
    assert.equal(validateReleaseChannel(value).release, null, key);
  }
});
test('mutable, foreign, mismatched version and ambiguous installer URLs are rejected', () => {
  for (const url of [
    'https://github.com/swaan-kim/autopets/releases/latest/download/setup.exe',
    'https://github.com/other/autopets/releases/download/v0.1.0/setup.exe',
    'http://github.com/swaan-kim/autopets/releases/download/v0.1.0/setup.exe',
    'https://github.com/swaan-kim/autopets/releases/download/v0.2.0/setup.exe',
    'https://github.com/swaan-kim/autopets/releases/download/v0.1.0/setup.exe?ref=other',
    'https://github.com/swaan-kim/autopets/releases/download/v0.1.0/../setup.exe',
    'https://user@github.com/swaan-kim/autopets/releases/download/v0.1.0/setup.exe',
  ]) {
    const value=channel(); value.publicRelease.installer.url=url;
    assert.equal(validateReleaseChannel(value).release, null, url);
  }
});
test('missing integrity, publisher or update verification prevents publication', () => {
  for (const section of ['installer','update']) {
    for (const key of Object.keys(channel().publicRelease[section])) {
      const value=channel(); delete value.publicRelease[section][key];
      assert.equal(validateReleaseChannel(value).release, null, `${section}.${key}`);
    }
  }
});
