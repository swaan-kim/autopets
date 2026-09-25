import { spawn } from 'node:child_process';

const METHODS = new Set(['config/read', 'configRequirements/read', 'hooks/list', 'model/list', 'collaborationMode/list']);

/** Public protocol inspection only. Never resumes a chat, starts a turn or trusts hooks. */
export async function inspectRuntime({ executable, cwd, timeoutMs = 20000, transport = 'stdio' }) {
  if (!['stdio', 'proxy'].includes(transport)) throw new Error('Unsupported transport');
  const child = spawn(executable, ['app-server', ...(transport === 'proxy' ? ['proxy'] : ['--stdio'])], {
    cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let sequence = 0, buffer = '', bytes = 0, stderrPresent = false;
  const pending = new Map();
  const abort = () => {
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
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { abort(); continue; }
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(`RPC rejected (${message.error.code})`));
      else request.resolve(message.result);
    }
  });
  function call(method, params) {
    if (method !== 'initialize' && !METHODS.has(method)) throw new Error('Read-only method required');
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
    const result = {};
    for (const [method, params] of [
      ['config/read', { cwd, includeLayers: true }], ['configRequirements/read', {}],
      ['hooks/list', { cwds: [cwd] }], ['model/list', { includeHidden: false }], ['collaborationMode/list', {}],
    ]) {
      try { result[method] = await call(method, params); }
      catch (error) { result[method] = { inspectionError: error.message }; }
    }
    return { initialized, stderrPresent, result };
  } finally {
    abort(); child.stdin.end();
    if (child.exitCode === null) await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 1000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

/** Intentionally whitelist values: config can contain credentials and hook commands. */
export function summarizeRuntime(raw) {
  const config = raw.result['config/read'] ?? {};
  const hooks = raw.result['hooks/list'] ?? {};
  const models = raw.result['model/list'] ?? {};
  return {
    protocolVersion: 1, runtime: raw.initialized.userAgent ?? null,
    platform: raw.initialized.platformOs ?? null, stderrPresent: raw.stderrPresent,
    existingDesktopControlVerified: false, accountIdentity: 'unknown',
    config: {
      inspectionError: config.inspectionError ?? null,
      hooksFeature: config.config?.features?.hooks ?? config.config?.features?.codex_hooks ?? null,
      managedHooksOnly: config.config?.allow_managed_hooks_only ?? null,
      layers: (config.layers ?? []).map(layer => ({
        name: layer.name, disabledReason: layer.disabledReason ?? null,
        configKeys: Object.keys(layer.config ?? {}),
      })),
    },
    hooks: (hooks.data ?? []).map(entry => ({ cwd: entry.cwd,
      hooks: (entry.hooks ?? []).map(hook => ({ event: hook.eventName, source: hook.source, sourcePath: hook.sourcePath,
        enabled: hook.enabled, trustStatus: hook.trustStatus, managed: hook.isManaged })),
      errorCount: entry.errors?.length ?? 0, warningCount: entry.warnings?.length ?? 0,
    })),
    models: (models.data ?? []).map(model => ({ id: model.id, model: model.model, displayName: model.displayName,
      isDefault: model.isDefault, defaultReasoningEffort: model.defaultReasoningEffort,
      supportedReasoningEfforts: model.supportedReasoningEfforts?.map(e => e.reasoningEffort),
    })),
    modelsNextCursor: models.nextCursor ?? null,
    inspectionErrors: Object.entries(raw.result).flatMap(([method, value]) => value.inspectionError ? [{ method, error: value.inspectionError }] : []),
  };
}
