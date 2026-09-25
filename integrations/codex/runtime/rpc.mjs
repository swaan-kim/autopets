import { spawn } from 'node:child_process';

const METHODS = new Set(['config/read', 'configRequirements/read', 'hooks/list', 'model/list', 'collaborationMode/list', 'thread/read']);

/** One owned, bounded process. No turns, resume, settings, trust or approval methods. */
export async function withReadOnlyRuntime({ executable, cwd, timeoutMs = 20000, transport = 'stdio', spawnProcess = spawn }, inspect) {
  if (!['stdio', 'proxy'].includes(transport) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('Invalid runtime transport options');
  const child = spawnProcess(executable, ['app-server', ...(transport === 'proxy' ? ['proxy'] : ['--stdio'])], {
    cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let sequence = 0, buffer = '', bytes = 0, closed = false, stderrPresent = false;
  const pending = new Map();
  const abort = () => {
    closed = true;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Runtime transport closed')); }
    pending.clear();
  };
  child.on('error', abort); child.on('exit', abort); child.stdin.on('error', abort);
  child.stderr.on('data', () => { stderrPresent = true; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 16 * 1024 * 1024) { abort(); child.kill(); return; }
    buffer += chunk;
    let end;
    while (!closed && (end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { abort(); child.kill(); break; }
      if (!message || typeof message !== 'object') { abort(); child.kill(); break; }
      // A server request may be a human approval. Never answer it or mistake it for a response.
      if (message.method) {
        if (message.id !== undefined) { abort(); child.kill(); break; }
        continue;
      }
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(`RPC rejected (${Number.isInteger(message.error.code) ? message.error.code : 'unknown'})`));
      else request.resolve(message.result);
    }
  });
  function call(method, params) {
    if (method !== 'initialize' && !METHODS.has(method)) throw new Error('Read-only method required');
    if (method === 'thread/read' && (typeof params?.threadId !== 'string' || params.includeTurns !== false || Object.keys(params).some(key => !['threadId', 'includeTurns'].includes(key)))) throw new Error('Metadata-only thread read required');
    if (closed) return Promise.reject(new Error('Runtime transport closed'));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('RPC timeout')); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
  try {
    const initialized = await call('initialize', { clientInfo: { name: 'autopets_runtime_inspection', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
    return await inspect({ call, initialized, hasStderr: () => stderrPresent });
  } finally {
    abort(); child.stdin.end();
    if (child.exitCode === null) await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 1000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}
