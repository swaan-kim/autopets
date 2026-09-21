import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { defaultPreferences, emptyContext, unverifiedWorkflowCapabilities } from '../../../packages/contracts/index.mjs';
import { submissionEvidence, explicitRequestModel, preflightSubmission } from '../assistance/workflow.mjs';
import { prepare, record, loadConfig } from '../assistance/prepare.mjs';

const task = () => ({ enabled: true, planFirst: true, phase: 'ready', settingsRevision: 1, planRevision: 1,
  planning: { model: 'gpt-5.6-sol', reasoning: 'medium' }, execution: { model: 'gpt-5.6-terra', reasoning: 'medium' },
  plan: { summary: '비교 보고서', steps: ['조사', '작성'], completionCriteria: ['공식 출처'] },
  approval: { settingsRevision: 1, planRevision: 1, approvedAt: 1 } });
const capabilities = () => ({ ...unverifiedWorkflowCapabilities(), verification: 'verified', modelObservation: true,
  submissionHold: true, inputPreservation: true, singleSubmission: true,
  availableModels: [{ model: 'gpt-5.6-terra', reasoning: ['medium'] }, { model: 'gpt-6-astra', reasoning: ['medium'] }] });
const input = (cwd, extra = {}) => ({ hook_event_name: 'UserPromptSubmit', session_id: 'chat-a', turn_id: 'turn-1', cwd, prompt: '보고서 계속 작성', model: 'gpt-6-astra', ...extra });

function run(file, args, body) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; const timer = setTimeout(() => { child.kill(); reject(Error('test-timeout')); }, 8000);
    child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(body));
  });
}
async function fixture(t, options = {}) {
  const project = await mkdtemp(path.join(tmpdir(), 'autopets-workflow-'));
  t.after(async () => { assert.equal(path.dirname(project), tmpdir()); assert.ok(path.basename(project).startsWith('autopets-workflow-')); await rm(project, { recursive: true, force: true }); });
  const dataDir = path.join(project, '.local', 'autopets-assistance'); await mkdir(path.join(dataDir, 'records'), { recursive: true });
  const calls = [], wf = task(), cap = capabilities(), previous = new Map();
  const ctx = { enabled: true, revision: 0, settingsRevision: 0, context: emptyContext() };
  const request = async (url, body) => {
    calls.push({ url, body });
    if (url.startsWith('/v1/task-context?')) return { sessionId: 'chat-a', cwd: project, turnId: 'turn-1' };
    if (url === '/v1/events') return { ok: true };
    if (url === '/v1/workflow') {
      if (options.fail) throw Error('private diagnostic');
      if (body.operation === 'read') return { preferences: { enabled: false }, task: { ...wf }, capabilities: cap };
      if (body.operation === 'preflight') {
        const key = body.submissionId;
        if (previous.has(key)) return { ...previous.get(key), duplicate: true };
        const target = { ...wf.execution, model: body.explicitModel ?? wf.execution.model };
        const decision = !wf.enabled || cap.verification !== 'verified' ? 'passthrough' : body.observation.model === target.model ? 'allow' : 'hold';
        if (decision === 'allow') wf.phase = 'executing';
        const result = { ok: true, decision, target, task: { ...wf }, duplicate: false, reason: decision === 'hold' ? '설정을 확인한 뒤 다시 보내세요.' : '보호 확인 불가' };
        previous.set(key, result); return result;
      }
      if (body.operation === 'recordPlan') {
        if (body.expectedPlanRevision !== wf.planRevision || body.expectedSettingsRevision !== wf.settingsRevision) throw Error('stale-plan');
        wf.plan = body.plan; wf.planRevision++; wf.approval = null; wf.phase = 'planning'; return { ok: true, task: wf };
      }
    }
    if (url === '/v1/assistance') {
      if (body.operation === 'read') return { preferences: { ...defaultPreferences(), enabled: true }, task: ctx, capabilities: { inputAssistance: true, contextSync: true } };
      if (body.operation === 'prepare') {
        if (options.race) options.race(wf);
        if (body.workflowBinding) {
          const gate = body.workflowBinding;
          if (!wf.enabled || gate.settingsRevision !== wf.settingsRevision || gate.planRevision !== wf.planRevision
            || gate.phase !== wf.phase || JSON.stringify(gate.approval) !== JSON.stringify(wf.approval)
            || !previous.has(gate.submissionId)) throw Error('stale-workflow');
        } else if (wf.enabled) throw Error('missing-workflow-binding');
        assert.ok(Buffer.byteLength(body.reason) <= 512);
        if (ctx.hash === body.guidanceHash) return { ok: true, duplicate: true };
        ctx.hash = body.guidanceHash; return { ok: true, nonce: 'fixture-nonce' };
      }
      if (body.operation === 'delivered') return { ok: true };
    }
    throw Error('unexpected-test-request');
  };
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (req.headers.authorization !== 'Bearer test-token-abcdefghijklmnopqrstuvwxyz0123456789') { res.writeHead(401).end('{}'); return; }
    try { const value = await request(req.url, raw ? JSON.parse(raw) : undefined); res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value)); }
    catch { res.writeHead(503).end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const connection = path.join(project, 'connection.json'), file = path.join(dataDir, 'config.json');
  await writeFile(connection, JSON.stringify({ version: 1, baseUrl: `http://127.0.0.1:${server.address().port}`, token: 'test-token-abcdefghijklmnopqrstuvwxyz0123456789' }));
  await writeFile(file, JSON.stringify({ version: 1, enabled: true, validationMode: false, project, connection }));
  return { project, config: await loadConfig(file), request, calls, wf, cap, previous,
    observer: body => run('integrations/codex/hooks/codex-hook.mjs', ['--connection', connection, '--autopets-hook-v1'], body),
    preparer: body => run('integrations/codex/assistance/prepare.mjs', ['hook', '--config', file], body) };
}

test('hook evidence only uses documented model; input text is hashed and unknown reasoning/mode ignored', () => {
  const a = submissionEvidence(input('/project', { reasoning: 'high', reasoning_effort: 'high', permission_mode: 'plan', collaboration_mode: 'plan', model: 'gpt-6-astra' }));
  assert.equal(a.observation.model, 'gpt-6-astra'); assert.equal(a.observation.reasoning, null); assert.equal(a.observation.mode, null);
  assert.equal(a.submissionId, submissionEvidence(input('/project')).submissionId);
  assert.notEqual(a.submissionId, submissionEvidence(input('/project', { turn_id: 'turn-2' })).submissionId);
  assert.notEqual(a.requestFingerprint, submissionEvidence(input('/project', { prompt: '다른 요청' })).requestFingerprint);
  assert.ok(!JSON.stringify(a).includes('보고서')); assert.equal(submissionEvidence(input('/project', { model: 'bad\nslug' })).observation.model, null);
  const attached = submissionEvidence(input('/project', { attachments: ['different-file'], request_identity: 'verified', source: 'verified-adapter' }));
  assert.equal(attached.requestFingerprint, a.requestFingerprint, 'prompt hash is explicitly NOT complete attachment identity');
  assert.equal(attached.observation.source, 'hook'); assert.equal(unverifiedWorkflowCapabilities().requestIdentity, false);
});
test('explicit request model accepts only the exact initial user directive, never quotes or body mentions', () => {
  for (const prompt of ['이번 요청은 Astra 모델로 진행해줘', '모델: gpt-6-astra\n보고서를 작성해줘', '/model gpt-6-astra']) assert.equal(explicitRequestModel(prompt), 'gpt-6-astra');
  for (const prompt of ['인용문: 이번 요청은 Astra 모델로 진행해줘', '"모델: gpt-6-astra"', '보고서 작성\n모델: gpt-6-astra', 'Astra를 설명해줘', '모델: unknown']) assert.equal(explicitRequestModel(prompt), null);
});
test('both real hook processes hold one submission before events, preparation or delivery', async t => {
  const f = await fixture(t), body = input(f.project);
  const [observer, preparer] = await Promise.all([f.observer(body), f.preparer(body)]);
  assert.deepEqual(observer, { code: 0, stdout: '{}\n', stderr: '' });
  assert.equal(preparer.code, 0); assert.equal(preparer.stderr, ''); assert.equal(JSON.parse(preparer.stdout).decision, 'block');
  assert.ok(!f.calls.some(call => call.url === '/v1/events' || call.url === '/v1/assistance'));
  const submissions = f.calls.filter(call => call.body?.operation === 'preflight').map(call => call.body);
  assert.equal(submissions.length, 2); assert.equal(submissions[0].submissionId, submissions[1].submissionId); assert.equal(f.previous.size, 1);
  assert.ok(!JSON.stringify(f.calls).includes(body.prompt));
  const resumed = input(f.project, { turn_id: 'turn-2', model: 'gpt-5.6-terra' });
  const [resumedObserver, resumedPreparer] = await Promise.all([f.observer(resumed), f.preparer(resumed)]);
  assert.equal(resumedObserver.stdout, '{}\n'); assert.ok(JSON.parse(resumedPreparer.stdout).hookSpecificOutput);
  assert.equal(f.previous.size, 2); assert.equal(f.calls.filter(call => call.url === '/v1/assistance' && call.body.operation === 'delivered').length, 1);
});
test('unverified, disabled, missing model and unavailable target cannot block; errors return empty output and preserve events', async t => {
  const f = await fixture(t);
  for (const mutate of [() => { f.cap.verification = 'unverified'; }, () => { f.cap.verification = 'verified'; f.wf.enabled = false; }, () => { f.wf.enabled = true; f.cap.availableModels = []; }]) {
    mutate(); f.previous.clear(); assert.notEqual((await preflightSubmission(input(f.project), f.request)).decision, 'hold');
  }
  f.cap.availableModels = capabilities().availableModels; f.previous.clear();
  assert.notEqual((await preflightSubmission(input(f.project, { model: undefined }), f.request)).decision, 'hold');
  const broken = await fixture(t, { fail: true });
  const result = await broken.preparer(input(broken.project)); assert.deepEqual(result, { code: 0, stdout: '{}\n', stderr: '' });
  assert.ok(broken.calls.some(call => call.url === '/v1/events')); assert.ok(!broken.calls.some(call => call.body?.operation === 'prepare'));
  const malformed = await fixture(t);
  const malformedRequest = (url, body) => url === '/v1/workflow' ? Promise.resolve({ task: {} }) : malformed.request(url, body);
  assert.deepEqual((await prepare(malformed.config, input(malformed.project), malformedRequest)).output, {});
  assert.ok(!malformed.calls.some(call => call.url === '/v1/assistance'));
});
test('explicit request override wins preset and unchanged staged guidance is deduplicated', async t => {
  const f = await fixture(t), body = input(f.project, { prompt: '이번 요청은 Astra 모델로 진행해줘' });
  const result = await prepare(f.config, body, f.request);
  assert.ok(result.receipt); assert.match(result.output.hookSpecificOutput.additionalContext, /실행 단계/);
  assert.ok(Buffer.byteLength(result.output.hookSpecificOutput.additionalContext) <= 3072);
  assert.equal(f.calls.find(call => call.body?.operation === 'preflight').body.explicitModel, 'gpt-6-astra');
  assert.deepEqual((await prepare(f.config, { ...body, turn_id: 'turn-2' }, f.request)).output, {});
  f.wf.approval = null; f.wf.phase = 'planning'; f.wf.planRevision++; f.previous.clear();
  const planned = await prepare(f.config, { ...body, turn_id: 'turn-3' }, f.request);
  assert.match(planned.output.hookSpecificOutput.additionalContext, /계획 단계/);
});
test('plan inspect/record uses current observed chat, validates bounded plan and stale revisions, consumes temporary input', async t => {
  const f = await fixture(t), file = path.join(f.config.dataDir, 'records', 'plan.json');
  const inspected = await record(f.config, 'plan-inspect', undefined, 'chat-a', f.project, f.request);
  assert.equal(inspected.planRevision, 1); assert.equal(inspected.deliveryVerified, false);
  const data = { expectedSettingsRevision: 1, expectedPlanRevision: 1, plan: { summary: '실제로 제시한 계획', steps: ['조사'], completionCriteria: ['근거'] } };
  await writeFile(file, JSON.stringify(data));
  assert.equal((await record(f.config, 'plan-record', file, 'chat-a', f.project, f.request)).planSaved, true);
  assert.equal(f.wf.approval, null); await assert.rejects(lstat(file), { code: 'ENOENT' });
  await writeFile(file, JSON.stringify(data)); await assert.rejects(record(f.config, 'plan-record', file, 'chat-a', f.project, f.request), /stale-plan/);
  await assert.rejects(lstat(file), { code: 'ENOENT' });
  await writeFile(file, JSON.stringify({ ...data, plan: { ...data.plan, steps: ['x'.repeat(513)] } }));
  await assert.rejects(record(f.config, 'plan-record', file, 'chat-a', f.project, f.request), /workflow-plan/);
  await assert.rejects(lstat(file), { code: 'ENOENT' });
});
test('plan/settings/approval/off changes after preflight cannot emit stale execution guidance or delivery receipt', async t => {
  for (const race of [wf => wf.planRevision++, wf => wf.settingsRevision++, wf => { wf.approval = null; }, wf => { wf.enabled = false; }]) {
    const f = await fixture(t, { race });
    const result = await f.preparer(input(f.project, { model: 'gpt-5.6-terra' }));
    assert.deepEqual(result, { code: 0, stdout: '{}\n', stderr: '' });
    const prepared = f.calls.find(call => call.body?.operation === 'prepare').body;
    assert.equal(prepared.workflowBinding.submissionId, submissionEvidence(input(f.project)).submissionId);
    assert.ok(!f.calls.some(call => call.body?.operation === 'delivered'));
  }
});
