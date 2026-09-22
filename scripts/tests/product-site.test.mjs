import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildProductSite } from '../build-product-site.mjs';

test('site renders no installer when unpublished and rejects an unverified release', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-site-'));
  try {
    await fs.mkdir(path.join(root, 'docs/start'), {recursive:true});
    await fs.mkdir(path.join(root, 'docs/releases'), {recursive:true});
    await fs.mkdir(path.join(root, 'scripts'), {recursive:true});
    await fs.writeFile(path.join(root,'scripts/fetch-installer.ps1'),'# isolated fixture, no installation');
    await fs.writeFile(path.join(root,'docs/start/index.html'),'<!doctype html><!-- AUTOPETS_RELEASE_DATA -->');
    const file=path.join(root,'docs/releases/channel.json');
    await fs.writeFile(file,JSON.stringify({version:2,platform:'win32-x64',publicRelease:null}));
    const out=path.join(root,'output');
    assert.equal((await buildProductSite({root,out})).publicReady,false);
    assert.match(await fs.readFile(path.join(out,'index.html'),'utf8'), /"publicRelease":null/u);
    assert.equal(JSON.parse(await fs.readFile(path.join(out,'channel.json'),'utf8')).publicRelease,null);
    await fs.writeFile(file,JSON.stringify({version:2,platform:'win32-x64',publicRelease:{version:'0.1.0'}}));
    await assert.rejects(buildProductSite({root,out}), /Publication metadata rejected/u);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
