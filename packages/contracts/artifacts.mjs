import { isRecord, utf8Bytes } from './constants.mjs';
import { validateIdentity } from './identity.mjs';

export const INTRO_LIMITS = Object.freeze({ pngBytes: 5 * 1024 * 1024, requestBytes: 25 * 1024 * 1024,
  responseBytes: 32 * 1024 * 1024, sourceChars: 8000, renderedChars: 8000, logoBytes: 500 * 1024,
  logoDataUrlBytes: 700000, versions: 20, promptBytes: 3072 });
export const INTRO_TEMPLATES = Object.freeze(['product-intro', 'plan-summary', 'comparison']);
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const unpairedSurrogate = /[\ud800-\udfff]/u;
function shape(value, keys, required = keys) {
  if (!isRecord(value) || Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !(key in value))) throw Error('artifact-shape');
}
function text(value, max, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || [...value].length > max || controls.test(value) || unpairedSurrogate.test(value)) throw Error('artifact-text');
}
function member(value, values) { if (!values.includes(value)) throw Error('artifact-value'); }
function id(value) { text(value, 128); if (/\s|[/\\]/u.test(value)) throw Error('artifact-id'); }
export function validateIntroBrief(value) {
  shape(value, ['audience', 'message', 'points', 'sourceText', 'sourceLabel']);
  text(value.audience, 80); text(value.message, 240); text(value.sourceText, INTRO_LIMITS.sourceChars, true); text(value.sourceLabel, 160, true);
  if (!Array.isArray(value.points) || value.points.length < 1 || value.points.length > 5) throw Error('artifact-points');
  for (const point of value.points) text(point, 160);
  return value;
}
export function validateIntroStyle(value) {
  shape(value, ['palette', 'logoDataUrl', 'copyLength', 'layout']);
  if (!Array.isArray(value.palette) || value.palette.length < 1 || value.palette.length > 4 || value.palette.some(color => typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) throw Error('artifact-palette');
  member(value.copyLength, ['short', 'normal']); member(value.layout, ['landscape', 'portrait']);
  if (value.logoDataUrl !== null) {
    if (typeof value.logoDataUrl !== 'string' || utf8Bytes(value.logoDataUrl) > INTRO_LIMITS.logoDataUrlBytes || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.logoDataUrl)) throw Error('artifact-logo');
    const encoded = value.logoDataUrl.split(',')[1];
    if (encoded.length % 4 || encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0) > INTRO_LIMITS.logoBytes) throw Error('artifact-logo');
  }
  return value;
}
function revision(value) {
  shape(value, ['kind', 'instruction', 'baseVersionId']);
  member(value.kind, ['shorten', 'emphasize', 'restructure', 'custom']);
  text(value.instruction, 500); id(value.baseVersionId);
}
export function validateArtifactRequest(value) {
  if (!isRecord(value)) throw Error('artifact-shape');
  const fields = {
    'save-brief': ['templateId', 'brief', 'style'], 'request-revision': ['revisionRequest'],
    'import-version': ['pngBytes', 'renderedText'], 'review-version': ['versionId', 'review'],
    'accept-version': ['versionId'], 'set-favorite': ['favorite'], 'delete-project': [],
    'save-style': ['versionId', 'name', 'styleId'], 'delete-style': ['styleId'],
  };
  if (!Object.hasOwn(fields, value.operation)) throw Error('artifact-operation');
  const common = value.operation === 'delete-style' ? ['operation'] : ['operation', 'identity', 'expectedRevision'];
  const keys = [...common, ...fields[value.operation]];
  shape(value, keys, keys.filter(key => !(value.operation === 'save-style' && key === 'styleId')));
  if (value.operation !== 'delete-style') {
    validateIdentity(value.identity);
    if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) throw Error('artifact-revision');
  }
  switch (value.operation) {
    case 'save-brief': member(value.templateId, INTRO_TEMPLATES); validateIntroBrief(value.brief); validateIntroStyle(value.style); break;
    case 'request-revision': revision(value.revisionRequest); break;
    case 'import-version':
      if (!Array.isArray(value.pngBytes) || value.pngBytes.length < 33 || value.pngBytes.length > INTRO_LIMITS.pngBytes || !value.pngBytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) throw Error('artifact-png');
      text(value.renderedText, INTRO_LIMITS.renderedChars); break;
    case 'review-version':
      shape(value.review, ['readability', 'layout', 'fidelity']);
      for (const status of Object.values(value.review)) member(status, ['pending', 'pass', 'fail']);
      break;
    case 'set-favorite': if (typeof value.favorite !== 'boolean') throw Error('artifact-favorite'); break;
    case 'save-style': text(value.name, 60); break;
  }
  if ('versionId' in value) id(value.versionId);
  if ('styleId' in value) id(value.styleId);
  return value;
}
