// Setup flows by catalog feature id. A feature without a flow is listed as
// "준비 중". To add one: create `<feature>-flow.js` with the same shape as
// presentation-flow.js (featureId, theme, steps, titles) and register it here.
import { presentationFlow } from './presentation-flow.js';

const flows = new Map([[presentationFlow.featureId, presentationFlow]]);

export const flowFor = (featureId) => (featureId ? flows.get(featureId) ?? null : null);
export const themeFor = (featureId) => flowFor(featureId)?.theme ?? null;
