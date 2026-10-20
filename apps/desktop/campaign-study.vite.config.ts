import { defineConfig } from 'vite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// A separate, offline study package. Never added to the desktop installer.
const desktop = dirname(fileURLToPath(import.meta.url));
const output = resolve(desktop, '../../work/campaign-study-20261019/site');
const assets = [
  'brand/autopets-mark.svg', 'sources/github.svg', 'sources/github-LICENSE.txt',
  'companion-v1/social.webp', 'companion-v1/notes.webp',
  'companion-v1/arrival.webp', 'companion-v1/paws.webp',
  'soft-pet/poses.png', 'motions/sprite.png',
  'design-example-v1/desktop.webp', 'design-example-v1/mobile.webp',
  'fonts/pretendard/PretendardVariable.woff2', 'fonts/pretendard/LICENSE',
];

export default defineConfig({
  root: desktop,
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: output, emptyOutDir: false, target: 'es2022',
    lib: {
      entry: resolve(desktop, 'src/study/CampaignStudy.tsx'),
      name: 'AutoPetsCampaignStudy', formats: ['iife'],
      fileName: () => 'campaign-study.js', cssFileName: 'campaign-study',
    },
  },
  plugins: [{
    name: 'offline-study-package',
    renderChunk(code) {
      // Keep shared app source untouched; only the isolated package uses relative URLs.
      return code.replace(/(["'`])\/assets\//g, '$1./assets/');
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'index.html', source: `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>AutoPets · 네 장면 시제품</title><link rel="stylesheet" href="./campaign-study.css"></head><body><div id="campaign-study-root"></div><script src="./campaign-study.js"></script></body></html>` });
    },
    closeBundle() {
      const inventory: { file: string; bytes: number; sha256: string }[] = [];
      const cssPath = resolve(output, 'campaign-study.css');
      writeFileSync(cssPath, readFileSync(cssPath, 'utf8').replace(/url\((["']?)\/assets\//g, 'url($1./assets/'));
      for (const asset of assets) {
        const target = resolve(output, 'assets', asset);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(resolve(desktop, 'public/assets', asset)));
      }
      writeFileSync(resolve(output, 'React-LICENSE.txt'), readFileSync(resolve(desktop, 'node_modules/react/LICENSE')));
      writeFileSync(resolve(output, 'ReactDOM-LICENSE.txt'), readFileSync(resolve(desktop, 'node_modules/react-dom/LICENSE')));
      writeFileSync(resolve(output, '읽어주세요.txt'), '\ufeffAutoPets 네 장면 시제품\n\nindex.html을 Chrome 또는 Edge로 여세요. 설치나 로그인은 필요하지 않습니다.\n가상 작업만 표시하며 실제 AI 실행·채팅 연결·영구 저장은 없습니다.\n입력 내용은 새로고침 또는 처음으로 초기화하면 사라집니다.\n복사 실패 시 펼쳐진 체험 문구를 직접 복사할 수 있습니다.\nGitHub 원본 링크만 선택 시 외부 사이트로 이동합니다.\n이 패키지는 AutoPets 설치본이나 실제 결과 비교 자료가 아닙니다.\n');
      for (const file of ['index.html', 'campaign-study.js', 'campaign-study.css', ...assets.map(item => `assets/${item}`)]) {
        const bytes = readFileSync(resolve(output, file));
        inventory.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
      writeFileSync(resolve(output, 'manifest.json'), JSON.stringify({
        schemaVersion: 1, prototype: 'campaign-study-20261019', aiExecution: false,
        realChatConnection: false, persistentStorage: false, files: inventory,
      }, null, 2));
    },
  }],
});
