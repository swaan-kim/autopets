# Windows 빌드와 배포 검증

최신 배포 경로는 **단일 NSIS EXE → 앱에서 AI 연결**이다. EXE에 Node·연결 도구·라이선스·offline WebView2를 포함한다. 직접 설치와 AI 호출은 같은 파일을 사용하며, 서명·공개 Windows/Codex 검증 전에는 리뷰용으로만 제공한다. Store 등록과 실제 PC 설치는 이번 구현에 포함하지 않는다. [최신 배포 계약](../architecture/distribution.md) · [통합 검수](../testing/unified-distribution.md).

아래 이전 companion ZIP과 과거 설치 기록은 개발 호환·역사적 증거이며 현재 사용자 설치 흐름을 대신하지 않는다.

2026-09-21 자동 도움 변경은 [구현 검수](../testing/assistance-implementation.md)를 따른다. 새 빌드는 별도 CI에서 검증하며 이번 작업에서 사용자 PC에 설치하지 않는다. 기존 설치 성공은 새 기능의 연결 증거가 아니다.

후속 검증(2026-09-20): 기존 설치 파일을 이 PC에 설치하고 앱 프로세스·창·인증된 로컬 브리지 응답을 확인했다. 서명은 여전히 `NotSigned`다. 아래 첫 CI 기록과 실제 Desktop 연결 검증은 구분하며 최신 상태는 [M1 증거](../testing/m1-evidence.md)를 따른다.

이 소스의 `.github/workflows/windows.yml`은 Windows에서 테스트와 NSIS 설치 파일 생성을 수행한다. 자동 실행은 `main` push와 pull request이며, 수동 실행은 기본적으로 검토용 artifact만 만든다. 실제 GitHub 저장소의 루트에 이 프로젝트와 `.github`를 함께 두어야 한다.

## 확인된 첫 Windows 빌드

2026-09-20, [Actions 실행 35462024271](https://github.com/swaan-kim/autopets/actions/runs/35462024271)이 commit `c89595547d9c95049c85061bb87442a0f385b3f4`에서 성공했다. Node 22개·Rust 31개·화면 검사를 통과하고 NSIS 설치 파일을 생성했다. 다운로드한 설치 파일·companion ZIP·UI 캡처 2개의 SHA-256은 CI manifest와 일치했다. 설치 파일은 3,251,113바이트이며 Authenticode 조회 결과 `NotSigned`다. 설치·실행·실제 Codex 훅 연결은 아직 수행하지 않았다. 공개 릴리스는 발행하지 않았다.

설치 파일 `AutoPets_0.1.0_x64-setup.exe`의 SHA-256:

```text
0f3822925d90ce7ad670626da361cec7a59bba33ed17ea53d7aa1f4babc4673c
```

## 검증 범위

| 단계 | 확인하는 내용 |
| --- | --- |
| Node 24 + pnpm 11.19.0 | lockfile 설치, 어댑터 실제 stdin/stdout, 로컬 HTTP 인증·작업 바인딩·멱등 설정 |
| Playwright Chromium | 실제 렌더링과 사용자 조작; `scripts/ci-ui.mjs`가 Vite를 시작하고 종료 |
| Rust stable MSVC | `cargo test --locked`로 core·bridge 회귀 검증 |
| Tauri build | 타입 검사·프런트엔드 번들·Rust 릴리스·현재 사용자용 NSIS 설치 파일 생성 |
| Artifact | 설치 파일, companion ZIP, UI 검증 캡처, SHA-256, 빌드 commit과 검증 한계 |

Tauri의 Windows 배포는 NSIS `-setup.exe`를 지원하며, Windows에서 Tauri CLI로 생성한다. 현재 AutoPets는 `webviewInstallMode: offlineInstaller`로 WebView2 설치 구성요소를 포함한다. [Tauri Windows installer 문서](https://v2.tauri.app/distribute/windows-installer/)

### 로컬 PowerShell 빌드 도구

`scripts/build.ps1`과 `scripts/start-dev.ps1`은 현재 PATH의 Cargo와 MSVC를 사용한다. Rust와 Node 의존성을 준비한 Developer PowerShell에서 실행하거나, 개발자가 관리하는 환경 초기화 `.ps1`을 명시할 수 있다. 저장소 주변의 개인 툴체인 경로를 자동 탐색하지 않는다.

```powershell
.\scripts\build.ps1
.\scripts\build.ps1 -ToolchainPath 'C:\DevTools\enable-toolchain.ps1'
$env:AUTOPETS_TOOLCHAIN_PATH = 'C:\DevTools\enable-toolchain.ps1'
.\scripts\start-dev.ps1
```

위 `C:\DevTools` 경로는 예시이며 실제 초기화 스크립트 경로로 바꾼다. `-ToolchainPath` 인수가 환경변수보다 우선하고, 상대 경로는 호출한 PowerShell의 현재 디렉터리를 기준으로 해석한다. 지정한 파일이 없거나 `.ps1` 파일이 아니면 빌드·앱 실행 전에 오류로 종료한다. 초기화 후에도 Cargo 또는 MSVC를 찾을 수 없으면 중단한다. 도우미 자체는 도구를 설치하거나 실행 정책·시스템 PATH를 변경하지 않는다.

NSIS 설치만으로 Codex 훅이나 스킬 trust를 변경하지 않는다. companion ZIP에는 `hooks/`, `skills/`, `scripts/`, `integrations/`, `packages/`, `docs/`가 들어가며 상대 위치를 유지한다. `integrations/codex/probe`는 별도 opt-in한 프로젝트에서만 사용하는 M1 진단이며 앱 설치로 활성화되지 않는다. 새 `integrations/codex/assistance/setup.mjs`도 기본은 dry run이다. 훅이 공통 모듈을 가져오므로 파일 하나만 따로 복사하지 않는다. Codex 훅·스킬에는 Node.js 24 이상이 별도로 필요하다.

Chrome 연결은 확장 ZIP과 companion ZIP으로 분리한다. CI companion에는 해당 버전의 Node 실행 파일과 공식 LICENSE를 포함하며, 확장은 `chatgpt.com` 선택 권한과 정확한 extension origin만 사용한다. 로컬 패키징에서 Node 경로·라이선스를 제공하지 않으면 `package-status.json`에 runtime 미포함으로 기록한다. 패키징은 설치가 아니며 실제 입력·모델 변경 기능을 활성화하지 않는다. 초심자용 확장 배포·첫 연결·제거 경험은 알파 전 검증 대상이다.

## 소스 배포에 포함할 파일

`.github/`, `apps/desktop/`의 소스·자산·설정·Cargo manifest/lockfile, `hooks/`, `skills/`, `scripts/`, `integrations/`, `packages/`, `docs/`, 루트 작업공간 설정·pnpm 잠금 파일·README를 포함한다. 배포 companion ZIP은 Git 추적 파일만 수집하므로 설치된 node_modules를 포함하지 않는다.

`node_modules/`, Rust `target/`, `work/`, `.local/`, `release/.local/`, 실제 `connection.json`, SQLite 데이터, 개인 `.codex/hooks.json`, 로컬 credential 파일은 배포하지 않는다. 소스 ZIP에는 숨김 폴더인 `.github/`가 실제로 포함됐는지 확인한다.

## 수동 초안 릴리스

저장소를 정하고 소스를 push한 후 Actions에서 이 workflow를 실행한다. `draft_release=false`로 성공한 artifact를 먼저 검토한다. 초안이 필요할 때만 `draft_release=true`와 이미 존재하는 `vX.Y.Z` 태그를 지정한다. 태그는 package 버전과 일치하고, workflow가 빌드한 정확한 commit을 가리켜야 한다.

빌드 job은 `contents: read`만 가진다. 초안 job에만 `contents: write`와 `actions: read`를 부여하며 해당 실행의 artifact를 받아 `gh release create --draft --verify-tag`를 호출한다. 태그를 만들거나 기존 릴리스를 덮어쓰지 않고, 공개 릴리스로 publish하지 않는다. 업로드된 artifact는 14일 보관한다. [GitHub checkout 권한 안내](https://github.com/actions/checkout#recommended-permissions), [artifact 보관 안내](https://github.com/actions/upload-artifact#retention-period)

GitHub CLI 인증과 대상 저장소 설정은 별개다. 이 문서와 workflow 작성은 CI 실행 또는 설치 파일 빌드 성공을 의미하지 않는다. 성공한 해당 commit의 Actions 결과와 artifact를 확인한다.

## 출시 전에 남은 실제 확인

### 무료 오픈소스 서명 후보

2026-09-20에 SignPath Foundation의 무료 지원 조건을 확인했다. OSI 라이선스, 유지보수와 문서화, 서명할 형태의 기존 릴리스가 필요하고, 인증서 지원에는 프로젝트의 검증 가능한 활동 이력과 검토 절차 등 추가 조건이 있다. AutoPets는 MIT 라이선스지만 신규 저장소이므로 즉시 지원 대상이라고 확정할 수 없다. 지원은 심사에 달려 있으며 현재 신청·계약·인증서 발급은 수행하지 않았다. 첫 CI 산출물은 서명되지 않은 검토용 설치 파일이다. [SignPath Foundation 조건](https://signpath.org/terms)

2026-09-30 재확인: Smart App Control용 서명은 신뢰할 수 있는 공급자의 유효한 코드 서명 인증서를 사용해야 한다. 2026-09-28 갱신된 Microsoft 문서는 RSA와 ECC를 모두 지원한다고 명시한다. 클라우드에서 빌드했다는 사실만으로 서명되거나 PC의 실행 차단이 해소되지는 않는다. 무료 지원 승인이나 적합한 인증서가 확보되지 않은 상태에서는 실행 차단 해결 여부를 미검증으로 남긴다. [Microsoft 서명 안내](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control)

### 차단 이력과 서명 준비 (2026-09-30)

**2026-10-05 갱신:** 현재 설치본·공개 개발 Pre-release·서명 여부는 [최신 서명 배포 기록](code-signing.md)을 따른다. 아래 차단과 보호 상태는 9월 30일 관측이며 현재 앱의 실행 상태가 아니다. 최신 미서명 시험판의 설치 성공과 보호가 켜진 PC의 일반 배포 검증을 구분한다.

새 UI 펫 설치기 `b6068870…451be042`는 `NotSigned`이며 현재 PC에서 Code Integrity 3033/3077로 실행이 차단됐다. Windows 11 25H2 빌드 26200.9457에서 Smart App Control 상태는 켜짐(1)이다. 사용자/컴퓨터 인증서 저장소에 사용 가능한 코드 서명 인증서가 없고, 저장소의 서명 관련 GitHub secret도 확인되지 않았다. CI는 서명 상태를 기록할 뿐 실제 서명을 수행하지 않는다. 기존 앱 실행은 가능하며 새 설치본을 우회 실행하지 않았다.

현재 검토 가능한 배포 경로는 다음과 같다. 가입·신원 확인·결제·신청은 아직 진행하지 않았다.

| 경로 | 현재 조건 | 다음 필요한 조치 |
| --- | --- | --- |
| SignPath Foundation 무료 OSS | MIT 공개 저장소라는 조건은 확인. 프로젝트 평판·기존 릴리스·운영/승인 정책 등 심사는 미확정 | 공개 프로젝트 자료와 서명 승인 절차 준비 후 프로젝트 소유자가 신청. 승인 뒤 CI 연결 |
| Microsoft Artifact Signing | 한국 조직은 지원 지역에 포함. 개인은 미국·캐나다 지원으로, 한국 개인 명의의 즉시 이용 경로로 가정할 수 없음 | 실제 신청 자격 확인, Azure 구독·신원 검증 후 공개 신뢰 서명 프로필 구성 |
| Microsoft Store MSIX | Store가 검토 후 서명하는 경로. 현재 NSIS EXE가 자동 서명되는 것은 아님 | 개발자 본인 등록·검증, MSIX 전환과 데이터·연결 호환성 검사, 제출·심사 |
| 일반 신뢰 공급자의 인증서 | 현재 보유 인증서 없음. 개인/조직·지역·키 보관 방식·가격은 공급자별 확인 필요 | 공급자 결정과 본인 확인·발급 후 앱/설치기 서명 및 실제 정책 호환성 검사 |

근거: [SignPath 조건](https://signpath.org/terms), [Artifact Signing 자격 조건](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart), [Windows 서명 선택지](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options), [개인 Store 개발자 등록](https://learn.microsoft.com/en-us/windows/apps/publish/whats-new-individual-developer).

Smart App Control에는 앱 하나만 통과시키는 예외 기능이 없다. 기능을 끄는 선택은 PC 전체에 영향을 주며 서명된 제품 배포를 대신하지 않는다. 최신 Microsoft FAQ는 최근 Windows 업데이트에서 재설치 없이 다시 켤 수 있다고 설명하므로, 예전의 '항상 재설치해야 한다'는 안내를 반복하지 않는다. 실제 기기의 설정 가능 여부는 별도로 확인한다. 사용자는 **보호를 유지하고 서명 배포를 준비**하는 방향을 선택했다. 신청 자료·파일 검증·CI 연결 조건은 [서명 배포 준비](code-signing.md)에 정리하며 보안 설정은 그대로 유지한다. [Microsoft FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)

### 사용자 PC 및 Codex 연결

Windows 정책에서 허용한 환경에서 설치·시작·종료·재실행 및 설치 파일 서명을 확인한다. 바이너리 차단이 발생하면 보안 정책을 끄거나 우회해서 검증하지 않는다.

실제 Codex Desktop에서 정상적인 `/hooks` trust 절차를 거친 뒤, 현재 작업의 이벤트가 들어오고 `context`가 같은 작업·활성 턴·경로를 돌려주는지 확인한다. 다른 작업을 연결하거나 토큰을 출력하지 않는다. 성공한 `update_plan`의 `PostToolUse`가 계획을 갱신하는지 확인한다. 현재 어댑터는 알려진 성공 응답 `Plan updated`만 수용하며, 관측되지 않거나 형식이 다른 계획을 추정하지 않는다. [Codex hooks 공식 문서](https://learn.chatgpt.com/docs/hooks)

작업별 실제 토큰 입력과 기존 Desktop 작업의 자동 중단은 현재 구현의 지원 범위 밖이다. 계정 공용 사용률을 작업 토큰으로 표시하지 않는다. v1 훅은 승인 필요 상태의 메타데이터만 보내며, 허용·거절 결정을 반환하지 않는다. 실제 승인은 Codex에서 처리한다.
