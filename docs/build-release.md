# Windows 빌드와 배포 검증

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

Tauri의 Windows 배포는 NSIS `-setup.exe`를 지원하며, Windows에서 Tauri CLI로 생성한다. WebView2가 없으면 기본 설치 동작에서 부트스트래퍼를 내려받는다. [Tauri Windows installer 문서](https://v2.tauri.app/distribute/windows-installer/)

NSIS 설치만으로 Codex 훅이나 스킬 trust를 변경하지 않는다. companion ZIP에는 `hooks/`, `skills/`, `scripts/`, `docs/`가 들어가며, 네 폴더의 상대 위치를 유지한다. 훅이 스킬 폴더의 공통 transport 모듈을 가져오므로 훅 파일만 따로 복사하지 않는다. Node.js 24 이상은 훅·스킬 실행에 별도로 필요하다.

## 소스 배포에 포함할 파일

`.github/`, `src/`, `src-tauri/src/` 전체, `src-tauri/icons/`, `src-tauri/capabilities/`, Tauri 설정·`build.rs`·Cargo manifest와 lockfile, `hooks/`, `skills/`, `scripts/`, `tests/`, `docs/`, 프런트엔드 설정·manifest·lockfile·README를 포함한다. `src-tauri/src/supervision.rs`도 필수다.

`node_modules/`, Rust `target/`, `work/`, `.local/`, `release/.local/`, 실제 `connection.json`, SQLite 데이터, 개인 `.codex/hooks.json`, 로컬 credential 파일은 배포하지 않는다. 소스 ZIP에는 숨김 폴더인 `.github/`가 실제로 포함됐는지 확인한다.

## 수동 초안 릴리스

저장소를 정하고 소스를 push한 후 Actions에서 이 workflow를 실행한다. `draft_release=false`로 성공한 artifact를 먼저 검토한다. 초안이 필요할 때만 `draft_release=true`와 이미 존재하는 `vX.Y.Z` 태그를 지정한다. 태그는 package 버전과 일치하고, workflow가 빌드한 정확한 commit을 가리켜야 한다.

빌드 job은 `contents: read`만 가진다. 초안 job에만 `contents: write`와 `actions: read`를 부여하며 해당 실행의 artifact를 받아 `gh release create --draft --verify-tag`를 호출한다. 태그를 만들거나 기존 릴리스를 덮어쓰지 않고, 공개 릴리스로 publish하지 않는다. 업로드된 artifact는 14일 보관한다. [GitHub checkout 권한 안내](https://github.com/actions/checkout#recommended-permissions), [artifact 보관 안내](https://github.com/actions/upload-artifact#retention-period)

GitHub CLI 인증과 대상 저장소 설정은 별개다. 이 문서와 workflow 작성은 CI 실행 또는 설치 파일 빌드 성공을 의미하지 않는다. 성공한 해당 commit의 Actions 결과와 artifact를 확인한다.

## 출시 전에 남은 실제 확인

### 무료 오픈소스 서명 후보

2026-09-20에 SignPath Foundation의 무료 지원 조건을 확인했다. OSI 라이선스, 유지보수와 문서화, 서명할 형태의 기존 릴리스가 필요하고, 인증서 지원에는 프로젝트의 검증 가능한 활동 이력과 검토 절차 등 추가 조건이 있다. AutoPets는 MIT 라이선스지만 신규 저장소이므로 즉시 지원 대상이라고 확정할 수 없다. 지원은 심사에 달려 있으며 현재 신청·계약·인증서 발급은 수행하지 않았다. 첫 CI 산출물은 서명되지 않은 검토용 설치 파일이다. [SignPath Foundation 조건](https://signpath.org/terms)

Smart App Control용 서명은 신뢰할 수 있는 공급자의 RSA 인증서를 사용해야 한다. 클라우드에서 빌드했다는 사실만으로 서명되거나 PC의 실행 차단이 해소되지는 않는다. 무료 지원 승인이나 적합한 인증서가 확보되지 않은 상태에서는 실행 차단 해결 여부를 미검증으로 남긴다. [Microsoft 서명 안내](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control)

### 사용자 PC 및 Codex 연결

Windows 정책에서 허용한 환경에서 설치·시작·종료·재실행 및 설치 파일 서명을 확인한다. 바이너리 차단이 발생하면 보안 정책을 끄거나 우회해서 검증하지 않는다.

실제 Codex Desktop에서 정상적인 `/hooks` trust 절차를 거친 뒤, 현재 작업의 이벤트가 들어오고 `context`가 같은 작업·활성 턴·경로를 돌려주는지 확인한다. 다른 작업을 연결하거나 토큰을 출력하지 않는다. 성공한 `update_plan`의 `PostToolUse`가 계획을 갱신하는지 확인한다. 현재 어댑터는 알려진 성공 응답 `Plan updated`만 수용하며, 관측되지 않거나 형식이 다른 계획을 추정하지 않는다. [Codex hooks 공식 문서](https://learn.chatgpt.com/docs/hooks)

작업별 실제 토큰 입력과 기존 Desktop 작업의 자동 중단은 현재 구현의 지원 범위 밖이다. 계정 공용 사용률을 작업 토큰으로 표시하지 않는다. v1 훅은 승인 필요 상태의 메타데이터만 보내며, 허용·거절 결정을 반환하지 않는다. 실제 승인은 Codex에서 처리한다.
