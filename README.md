# AutoPets

**쓰던 Codex 채팅에서 펫에게 계획과 구현을 맡기고, 진행과 결과를 가까이에서 확인합니다.**

모델·작업 지침·스킬을 반복해서 고르는 대신, 저장한 펫 설정으로 작은 작업을 맡기는 Windows 앱입니다. 현재 대상은 **Windows 로컬 Codex의 명시적 펫 호출**입니다. 요청과 계획 확인은 기존 Codex 채팅에서 하고, AutoPets는 펫 작업의 상태와 확인된 실행 설정을 보여줍니다.

## 현재 구현과 검증 상태

현재 개발하는 첫 체험은 **UI 제작 펫으로 가상 학과 행사 소개 웹페이지 한 장 만들기**입니다. `Anthropic frontend-design` 기반 스킬을 사용하며, Figma 시안 활용은 기본 꺼짐인 선택 기능입니다. [사용 안내와 제품 범위](docs/product/ui-pet-mvp.md) · [현재 실행 계획](docs/roadmap/mvp-execution.md) · [실제 검증 기록](docs/testing/mvp-feasibility.md)

| 항목 | 상태 |
|---|---|
| 기존 설치형 제작 펫 `5ec2fd0` | 현재 PC에서 일반 입력의 계획·구현·검토, 모델·강도, 두 채팅 격리, 도움 끄기·정상 재시작 확인 |
| 새 UI 제작 펫과 3단계 시작 화면 | Node·화면·Windows Rust·빌드 통과. 별도 Windows 설치·종료·데이터 보존 확인. 개별 펫 숨김 메뉴 자동 검사와 실제 Codex 원플로우는 미검증 |
| 선택형 Figma 시안 활용 | 연결 안내·사용 근거 확인 구현. 시험 시안 읽기 사전 확인과 실제 펫 제작 흐름은 별도 검증 |
| 펫에서 기존 Codex 채팅 열기 | 저장된 출처·전체 채팅 ID·폴더·개정을 확인한 뒤 OS에 링크 전달. 실제 도착한 채팅은 별도 확인 필요 |
| 새 설치본의 현재 PC 실행 | 애플리케이션 제어 정책으로 차단. 보안을 유지하며 서명 배포 준비 중 |
| 공개 배포·다른 PC·Work | 별도 검증 대기. 리뷰 빌드의 공개 업데이트는 비활성 |

**새 UI 제작 펫의 설치형 전체 흐름은 아직 미통과입니다.** Windows 빌드와 개별 검사 통과는 현재 PC의 보안 정책 허용이나 실제 Codex·Figma 연결 성공을 뜻하지 않습니다. 기존 앱과 데이터는 보존하며, 서명 준비를 차단 해결로 표시하지 않습니다. [서명 배포 준비](docs/releases/code-signing.md)

## 첫 사용 흐름

1. **이 펫으로 시작** — UI 제작 펫의 역할과 기반 스킬을 확인합니다. 상세에서 제작 설정을 고를 수 있습니다.
2. **Codex에 펫 준비** — 이 PC에 펫 호출 스킬을 준비합니다. 이미 준비됐다면 재연결 없이 다음 단계로 갑니다. Figma는 필요한 경우에만 선택하고 Codex에서 연결합니다.
3. **시작 요청 복사** — 정확한 저장 펫 ID·개정이 담긴 요청을 사용할 Codex 채팅에 직접 보냅니다. 복사는 전송이나 연결 완료가 아닙니다.
4. **계획 확인 → 구현 요청** — 같은 채팅에서 계획을 읽고 `그대로 구현해줘`라고 요청합니다. 펫 설정에 맞는 하위 작업이 실행되며 부모 채팅 모델은 유지됩니다.
5. **상태 확인 → 결과 확인** — 펫에서 진행·확인 대기·완료를 보고, **Codex 작업 열기**로 기존 채팅의 열기를 요청합니다. 결과 파일은 Codex가 반환한 링크에서 확인합니다. 링크 전달 성공과 실제 채팅 도착은 구분합니다.

자연어로 스킬이 호출되지 않으면 Codex에서 **AutoPets 스킬을 직접 선택**합니다. 재방문하면 연결된 펫을 먼저 보여주며, **펫 준비**로 다른 채팅에 사용할 구성을 만들 수 있습니다. 연결 복구·해제는 **연결 설정**, 프로필 변경·도움 끄기는 **펫 설정과 관리**에서 합니다. 펫 숨기기와 앱 종료도 지원합니다.

| 작업 단계 | 현재 제공 설정 |
|---|---|
| 계획 | Luna · low |
| 제작 — 가볍게 | Luna · low |
| 제작 — 표준 | Sol · low |
| 제작 — 꼼꼼하게 | Sol · medium |

실행 전에 해당 조합의 가용성을 확인하며 사용할 수 없는 모델을 임의로 대체하지 않습니다. 요청한 설정·호스트 실행 기록·결과 반환을 구분합니다. 계획 중 파일을 바꾸지 않는 것은 **계획 프롬프트 이행**이며 실제 Plan 모드 강제가 아닙니다. 토큰 절감·품질 향상 수치는 아직 주장하지 않습니다.

모든 요청 자동 처리, 훅 자동화, 부모 채팅 모델 변경, 실제 Plan 강제, 자동 제출·재전송은 현재 사용 경로에 포함하지 않습니다. Work·다른 펫·Jev·공유 사이트는 후속 범위입니다. 펫 표시를 위한 반복 모델 호출이나 이미지 생성은 없습니다.

## 배포 안내와 이전 구현

설치 버튼과 “AutoPets 설치하고 켜줘”는 같은 설치 EXE를 사용하는 두 입구로 설계했습니다. 공개 설치 경로는 배포 관문을 통과한 뒤 제공합니다. [제품 소개 원본](docs/start/index.html) · [시작 안내와 현재 배포 상태](docs/releases/start.md) · [Windows 검사와 빌드](https://github.com/swaan-kim/autopets/actions/workflows/windows.yml)

공유용 경로는 `/start/`로 준비하며 기존 루트 체험 주소는 유지합니다. [공개 소개·체험 목업](https://swaan-kim.github.io/autopets/)은 **시연 데이터로 만든 콘셉트**이며 실제 앱 연결을 의미하지 않습니다. [홍보 이미지](docs/images/00-overview-wide.png) · [오프라인 목업](docs/demo/index.html) · [제작 방법](docs/design-source/README-제작.md)

고급 화면과 이전 개발에는 소개 자료 PNG·버전 비교·스타일 재사용, 채팅별 지침과 계획·실행 정책, 작업 목록·훅 관측·ChatGPT 확장 코드가 남아 있습니다. 이 구현들의 자동 연결·보호 기능을 현재 명시적 펫 호출의 지원 범위로 표시하지 않습니다.

- 소개 자료: [제품 범위](docs/product/intro-artifacts.md) · [구조](docs/architecture/intro-artifacts.md) · [검수·효과 평가](docs/testing/intro-evaluation.md) · [구현 검수](docs/testing/intro-implementation.md)
- 이전 계획·도움 기능: [설정과 보호의 약속](docs/product/planning-execution.md) · [앱 검수 기록](docs/testing/assistance-implementation.md) · [제품 방향](docs/product/direction.md)
- 이전 합성 화면: [설정 카드](docs/images/app-workflow-presets.png) · [계획과 설정 불일치](docs/images/app-workflow-task.png) · [시작 화면](docs/images/app-setup.png)
- 기록과 단계: [검수 상태 파일](docs/implementation-status.json) · [단계별 구현 기록](docs/roadmap/implementation.md)

## 디렉터리

| 위치 | 책임 |
|---|---|
| apps/desktop | React 화면·Tauri/Rust·펫 자산·화면 검사 |
| integrations/codex | 관측 훅·준비/기록·스킬·연결 검사 |
| integrations/chatgpt | Chrome 확장·Native Messaging·연결 검사 |
| integrations/plugins/autopets | 미등록 스킬 중심 플러그인 소스 |
| packages/contracts | 공통 데이터 형식·검증 |
| packages/guidance | 작업 절차·지침·라우팅/점검 정책·평가 |
| scripts | 루트 실행·검수·패키징 진입점 |
| docs | 제품·구조·계획·검수·배포·과거 기록·소개 자료 |
| hooks · skills | 이전 설치 경로를 위한 호환 진입점 |
| .github | Windows 검사·Pages 배포·Issue 양식 |

[내부 모듈 구조](docs/architecture/layout.md) · [역할별 개발 인계](docs/roadmap/parallel-development.md) · [작업 목록](https://github.com/swaan-kim/autopets/issues)

## 개발·검수

Node.js 24와 pnpm 11.19.0을 사용합니다. JavaScript 의존성은 루트 pnpm-lock.yaml로 관리합니다. 네이티브 빌드는 Rust MSVC, Microsoft C++ Build Tools·Windows SDK, WebView2가 필요합니다.

~~~powershell
pnpm install --frozen-lockfile
pnpm verify:layout
pnpm test
pnpm build
pnpm test:ui
pnpm test:rust
node scripts/validate-release.mjs
node scripts/build-product-site.mjs --out work/product-site
node scripts/package-plugin.mjs
~~~

개발 화면은 pnpm dev, 네이티브 개발 실행은 pnpm desktop입니다. 로컬 보안 정책이 실행을 차단하면 설정을 끄지 않고 Windows CI로 검수합니다. [빌드·배포 안내](docs/releases/windows.md)

앱 ID와 데이터 위치는 기존 local.autopets.desktop을 유지합니다. 구조 정리는 기존 앱·확장·훅 신뢰·계정을 변경하거나 설치하지 않습니다. connection.json, SQLite, 인증 정보, 개인 업무 기록을 저장소에 올리지 않습니다.

[Codex 연결 도구](integrations/codex/assistance/README.md) · [ChatGPT 검증 패키지](integrations/chatgpt/README.md) · [환경별 실제 연결 검수](docs/testing/m1-evidence.md)

[두 입구 제품 설계](docs/product/distribution.md) · [배포/업데이트 계약](docs/architecture/distribution.md) · [공개 전 검수](docs/testing/unified-distribution.md)
