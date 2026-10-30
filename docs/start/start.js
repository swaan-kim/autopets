// Public download data is validated and injected by build-product-site.mjs.
// A source preview or missing/invalid declaration never enables stable installation.
// Copying an invocation is a convenience for an already prepared Codex host.
const copyInvocation = document.getElementById('copy-invocation');
copyInvocation.addEventListener('click', async () => {
  const request = document.getElementById('invocation-text').textContent;
  try {
    await navigator.clipboard.writeText(request);
    document.getElementById('copy-status').textContent = '호출 문구를 복사했어요. 사용할 Codex 채팅에 보내세요.';
  } catch {
    document.getElementById('copy-status').textContent = '복사하지 못했어요. 위 문구를 선택하거나 Codex에서 AutoPets 스킬을 직접 고르세요.';
  }
});
const data = document.getElementById('autopets-release');
let release = null;
try {
  const channel = JSON.parse(data?.textContent || 'null');
  const candidate = channel?.publicRelease;
  const url = new URL(candidate?.installer?.url);
  const prefix = `/swaan-kim/autopets/releases/download/v${candidate.version}/`;
  if (channel.version === 2 && /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(candidate.version)
      && url.origin === 'https://github.com' && !url.username && !url.password && !url.search && !url.hash
      && url.pathname.startsWith(prefix) && /^[A-Za-z0-9_.-]+\.exe$/.test(url.pathname.slice(prefix.length))
      && /^[a-fA-F0-9]{64}$/.test(candidate.installer.sha256)) release = candidate;
} catch { /* Keep both entrypoints in their truthful unpublished state. */ }

if (release) {
  const download = document.getElementById('download');
  download.href = release.installer.url;
  download.hidden = false;
  download.textContent = `Windows용 다운로드 · ${release.version}`;
  document.getElementById('download-pending').hidden = true;
  document.getElementById('download-detail').textContent = 'Windows x64 · 서명된 설치 프로그램';
  document.getElementById('hero-release').textContent = `Windows 앱 · ${release.version}`;
  document.getElementById('release-version').textContent = release.version;
  document.getElementById('release-sha').textContent = release.installer.sha256;
  document.getElementById('release-details').hidden = false;
}
