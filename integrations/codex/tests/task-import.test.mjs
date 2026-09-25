import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('metadata CLI authenticates exact source CAS, leaves conflicts unretried and excludes secrets', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'autopets-import-한글 '));
  t.after(async () => { assert.equal(path.dirname(dir), os.tmpdir()); await rm(dir, { recursive: true, force: true }); });
  const token = 'a'.repeat(40), sourceId = 'fixture:source/1', calls = [];
  let conflict = false;
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    calls.push({ method: request.method, url: request.url, auth: request.headers.authorization, body: body ? JSON.parse(body) : null });
    if (request.method === 'POST' && conflict) { response.writeHead(409); response.end('private server error'); return; }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ sourceId, revision: request.method === 'GET' ? 2 : 3 }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const connection = path.join(dir, 'connection.json'), input = path.join(dir, 'report.json');
  await writeFile(connection, JSON.stringify({ version: 1, token, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  await writeFile(input, JSON.stringify({ version: 1, source: 'app-server-metadata', sourceId, runtime: 'fixture', nodes: [{ id: 'fixture' }] }));
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/tasks-import.mjs', import.meta.url)), connection, input], { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('exit', code => resolve({ code, stdout, stderr }));
  });
  const ok = await run(); assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), { saved: true, revision: 3, importedTasks: 1, controlEnabled: false });
  assert.equal(calls[0].url, `/v1/task-graph?sourceId=${encodeURIComponent(sourceId)}`);
  assert.equal(calls[1].body.expectedRevision, 2); assert.equal(calls[1].auth, `Bearer ${token}`);
  conflict = true; calls.length = 0;
  const rejected = await run(); assert.equal(rejected.code, 1); assert.equal(calls.length, 2);
  assert.doesNotMatch(rejected.stdout + rejected.stderr, /private server|a{40}/u);
  calls.length = 0; await writeFile(input, JSON.stringify({ version: 1, source: 'app-server-metadata', sourceId }));
  assert.equal((await run()).code, 1); assert.equal(calls.length, 0);
});
