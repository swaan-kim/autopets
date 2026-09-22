// Public download data is validated and injected by build-product-site.mjs.
// A source preview or missing/invalid declaration never enables installation.
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
  const copy = document.getElementById('copy-invocation');
  copy.disabled = false;
  copy.textContent = 'AI에게 요청할 문구 복사';
  copy.addEventListener('click', async () => {
    const request = `AutoPets를 켜줘. 없으면 공식 Windows 설치 안내 https://swaan-kim.github.io/autopets/start/ 를 확인하고, 지원되는 로컬 실행 환경에서 이 공개 설치 파일로 설치를 도와줘: ${release.installer.url}\nSHA-256: ${release.installer.sha256}\n설치 후 AutoPets 연결 화면을 열어줘. 이 Windows PC에 접근할 수 없는 웹·클라우드 환경이면 설치 링크를 안내해줘.`;
    try { await navigator.clipboard.writeText(request); document.getElementById('copy-status').textContent = '복사했어요. 사용 중인 AI에 붙여넣어 주세요.'; }
    catch { document.getElementById('copy-status').textContent = '복사하지 못했어요. 버튼으로 설치한 뒤 앱에서 연결해주세요.'; }
  });
}
