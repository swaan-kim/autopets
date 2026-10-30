import { ownerForAnnotation } from './check-ui-scope.mjs';

const endpoint = process.env.AUTOPETS_FEEDBACK_URL || 'http://127.0.0.1:4747';
const url = new URL(endpoint);
if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Local feedback endpoint required.');
const response = await fetch(new URL('/pending', url), {signal:AbortSignal.timeout(3000)});
if (!response.ok) throw Error(`Agentation unavailable (${response.status}). Start pnpm dev:feedback first.`);
const data = await response.json();
const annotations = (data.annotations ?? []).filter(annotation => {
  try { const page = new URL(annotation.url); return page.protocol === 'http:' && ['127.0.0.1','localhost'].includes(page.hostname) && page.port === (process.env.AUTOPETS_UI_PORT || '1420'); } catch { return false; }
}).map(annotation => ({id:annotation.id, owner:ownerForAnnotation(annotation) ?? 'needs-triage', comment:annotation.comment, elementPath:annotation.elementPath, url:annotation.url}));
console.log(JSON.stringify({count:annotations.length,annotations},null,2));
