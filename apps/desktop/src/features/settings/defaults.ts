import type { UserPreferences } from '@autopets/contracts/types';

export const DEFAULT_PREFERENCES: UserPreferences = { enabled: false, workStyle: 'auto', answerLength: 'concise', outputFormat: 'adaptive', routingMode: 'auto', fixedModel: null, allowedModels: [], allowEscalation: false, revision: 0 };
