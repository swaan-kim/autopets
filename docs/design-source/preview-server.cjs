#!/usr/bin/env node
'use strict';
// Loopback preview of one generated HTML file. Request paths never map to files.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const port = Number(process.env.PORT || 4318);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (request.method !== 'GET' || !['/', '/index.html'].includes(url.pathname)) {
    response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found'); return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  const html = fs.readFileSync(path.join(__dirname, '../demo/index.html'), 'utf8');
  // Opt-in workaround for the specific Windows 150% region-exporter behavior.
  // Normal browser poster capture must use 100% zoom and omit this parameter.
  const captureHtml = html.replace('</style>', 'body.poster{zoom:1.5}</style>');
  response.end(url.searchParams.get('capture') === 'windows150' ? captureHtml : html);
});
server.listen(port, '127.0.0.1', () => console.log(`AutoPets concept preview: http://127.0.0.1:${port}`));
