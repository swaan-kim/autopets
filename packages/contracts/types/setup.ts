import type { ConnectionHost, ConnectionProgress } from './connections';
/** Installation evidence is independent from AI feature verification. */
export interface SetupState {
  version: 1;
  installedVersion: string;
  phase: 'not-started' | 'connecting' | 'ready' | 'attention';
  appReady: boolean;
  chatConnected: boolean;
  guidanceDelivered: boolean;
  protection: { model: boolean; reasoning: boolean; submission: boolean };
  retryable: boolean;
  nextAction: 'start' | 'review-hooks' | 'send-message' | 'none';
  /** Additive fields retain compatibility with the original v1 setup response. */
  currentHostId?: string | null;
  entryPoint?: 'desktop' | 'ai' | 'store' | null;
  connectionMode?: 'explicit-pet' | null;
  hosts?: ConnectionHost[];
  connections?: ConnectionProgress[];
  warnings?: string[];
}
export interface InstallManifest {
  version: 1;
  owner: 'autopets';
  installedVersion: string;
  packageDigest: string;
  appDirectory: string;
  /** Read-only connector files included in the installed EXE. */
  resourceDirectory?: string;
  appDigest: string;
  completedSteps: string[];
  ownedFiles: { path: string; sha256: string }[];
  hookIds: string[];
  skillPath: string | null;
  skillDigest?: string;
  updatedAt: number;
  installSource?: 'direct' | 'store' | 'legacy' | 'unknown';
  entryPoint?: 'desktop' | 'ai' | 'store';
  connectionStates?: { hostId: string; configured: boolean }[];
  updateOwner?: 'autopets-signed-updater';
  connectionMode?: 'explicit-pet';
}
