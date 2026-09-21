import type { AssistanceSnapshot, ProviderCapabilities } from '@autopets/contracts/types';
import { DEFAULT_PREFERENCES } from '../features/settings/defaults';

const unsupported: ProviderCapabilities = { inputAssistance: false, modelSwitch: false, reasoningSwitch: false, contextSync: false, tokenUsage: false, additionalRepair: false, verification: 'unverified' };
export const EMPTY_ASSISTANCE: AssistanceSnapshot = { preferences: DEFAULT_PREFERENCES, tasks: [], capabilities: { codex: { ...unsupported }, chatgpt: { ...unsupported } } };
