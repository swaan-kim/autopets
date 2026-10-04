export interface TaskGraphNode {
  id: string; label: string; cwd: string; projectId: string | null; parentId: string | null; forkedFromId: string | null;
  creationSurface: 'codex-local' | 'work-local' | 'unknown'; runtimeStatus: 'not-loaded' | 'idle' | 'active' | 'error' | 'unknown';
  configuredModel: string | null; configuredReasoning: string | null; metadataUpdatedAt: number; observedAt: number;
}
export interface TaskGraphSource {
  revision: number;
  report: { version: 1; sourceId: string; source: 'app-server-metadata'; runtime: string; nodes: TaskGraphNode[] };
}
