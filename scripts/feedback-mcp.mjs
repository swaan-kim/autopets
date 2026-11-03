import { startMcpServer } from 'agentation-mcp';

const endpoint = process.env.AUTOPETS_FEEDBACK_URL || 'http://127.0.0.1:4747';
const url = new URL(endpoint);
if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Agentation requires a local development endpoint.');
await startMcpServer(endpoint);
