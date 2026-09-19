import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export const MAX_BODY = 256 * 1024;
export const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const validString = (value, max = 512) => typeof value === 'string' && value.length > 0
  && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);

export class BridgeError extends Error {
  constructor(code, status = null) { super(code); this.code = code; this.status = status; }
}

export async function readConnection(connectionPath) {
  if (!isAbsolute(connectionPath)) throw new BridgeError('connection-path');
  let raw;
  try {
    if ((await stat(connectionPath)).size > 4096) throw new BridgeError('connection-size');
    raw = await readFile(connectionPath);
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError('connection-unavailable');
  }
  if (raw.length > 4096) throw new BridgeError('connection-size');
  let connection;
  try { connection = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/u, '')); }
  catch { throw new BridgeError('connection-format'); }
  if (!isObject(connection) || connection.version !== 1
    || typeof connection.token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/u.test(connection.token)
    || typeof connection.baseUrl !== 'string'
    || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/?$/u.test(connection.baseUrl)) {
    throw new BridgeError('connection-format');
  }
  let url;
  try { url = new URL(connection.baseUrl); } catch { throw new BridgeError('connection-format'); }
  if (Number(url.port) > 65535) throw new BridgeError('connection-format');
  return { token: connection.token, baseUrl: url.origin };
}

export async function requestJson(connection, path, body, timeoutMs = 1400) {
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  if (encoded && Buffer.byteLength(encoded) > MAX_BODY) throw new BridgeError('request-size');
  if (!path.startsWith('/v1/')) throw new BridgeError('request-path');
  let response;
  try {
    response = await fetch(`${connection.baseUrl}${path}`, {
      method: encoded === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${connection.token}`, ...(encoded ? { 'Content-Type': 'application/json' } : {}) },
      body: encoded, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { throw new BridgeError('bridge-unavailable'); }
  if (!response.ok) {
    await response.body?.cancel();
    // Raw remote error text is never forwarded: it might contain task content.
    throw new BridgeError('bridge-rejected', response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new BridgeError('response-format');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new BridgeError('response-size'); }
      chunks.push(value);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!isObject(result)) throw new BridgeError('response-format');
    return result;
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError('response-format');
  }
}
