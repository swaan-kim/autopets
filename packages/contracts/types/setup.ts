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
}
export interface InstallManifest {
  version: 1;
  owner: 'autopets';
  installedVersion: string;
  packageDigest: string;
  appDirectory: string;
  appDigest: string;
  completedSteps: string[];
  ownedFiles: { path: string; sha256: string }[];
  hookIds: string[];
  skillPath: string | null;
  skillDigest?: string;
  updatedAt: number;
}
