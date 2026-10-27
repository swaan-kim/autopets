import type { PetLink, PetRoleTemplate, Snapshot } from '@autopets/contracts/types';
import uiPet from '../../../../packages/contracts/data/ui-pet.json';

// Browser development fixture only. These are fictional cards, not host observations.
const startedAt = Date.now() - 60000;
const examples = [
  { number: '101', folder: '가상-행사-A-계획확인', state: 'waiting', profile: 'plan' },
  { number: '102', folder: '가상-행사-B-작업중', state: 'working', profile: 'light' },
  { number: '103', folder: '가상-행사-C-결과확인', state: 'complete', profile: 'light' },
] as const;

export function feedbackTaskSnapshot(): Snapshot {
  const petLinks: PetLink[] = examples.map((example, slot) => {
    const template = structuredClone(uiPet) as PetRoleTemplate;
    return {
      version: 1,
      target: { sourceId: 'codex-windows-local', threadId: `00000000-0000-4000-8000-000000000${example.number}`, cwd: `C:/AutoPets-review-only/${example.folder}` },
      slot, revision: 1, enabled: true, connected: true, profile: 'light', template,
      run: {
        id: `AP-REVIEW-${example.number}`, settingsRevision: 1, profile: example.profile,
        model: 'fixture-only', effort: 'not-observed', state: example.state,
        childId: null, turnId: null, observedModel: null, observedEffort: null,
        evidence: '합성 검수 예시 · 실제 작업을 실행하거나 관측하지 않았어요.',
        startedAt, resultReturned: example.state !== 'working', runtimeCompleted: example.state !== 'working',
        template, skillEvidence: [], figmaUsed: false,
      },
    };
  });
  return {
    sessions: [], slots: [0, 1, 2].map(index => ({ index, sessionId: null })), petLinks,
    connectionPath: '', capabilities: { tokenUsage: 'unavailable', taskReturn: 'manual' }, now: Date.now(),
  };
}
