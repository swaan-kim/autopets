import { withReadOnlyRuntime } from './rpc.mjs';

/** Public protocol inspection only. Never resumes a chat, starts a turn or trusts hooks. */
export async function inspectRuntime(options) {
  return withReadOnlyRuntime(options, async ({ call, initialized, hasStderr }) => {
    const result = {};
    for (const [method, params] of [
      ['config/read', { cwd: options.cwd, includeLayers: true }], ['configRequirements/read', {}],
      ['hooks/list', { cwds: [options.cwd] }], ['model/list', { includeHidden: false }], ['collaborationMode/list', {}],
    ]) {
      try { result[method] = await call(method, params); }
      catch (error) { result[method] = { inspectionError: error.message }; }
    }
    return { initialized, stderrPresent: hasStderr(), result };
  });
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
