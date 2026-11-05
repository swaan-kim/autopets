# AutoPets

**쓰던 AI는 그대로, 일에 맞는 준비와 설정은 펫이 챙겨준다.**

유료 AI를 기본값으로 쓰는 초심자와, 모델·프롬프트·작업 방식을 반복 설정하기 번거로운 사용자를 위한 Windows 앱입니다. 요청과 결과 확인은 기존 AI 채팅에서 하고, 펫에서 현재 도움과 설정을 확인합니다.

## 현재 구현 상태

| 구현 | 상태 |
|---|---|
| 설치 버튼과 AI 호출 | 같은 설치 EXE·첫 연결 화면 · 공개 서명/실제 연결 검증 전 |
| AI 실행 환경별 지원 정보 | Codex 로컬 연결 코드 · Work/VS Code/Claude/Antigravity는 개별 검증 대기 |
| 앱 업데이트 | 고정 배포 주소·서명 검증 경로 · 리뷰 빌드 비활성 |
| 펫 빠른 카드·상세 설정 3탭·작업 목록과 필터 | 구현·화면 fixture 검수 |
| 채팅별 작업 방식·공통 답변 길이와 형식 | 저장·충돌 검사 구현 |
| 채팅별 조건·수정·1회 되돌리기·삭제 | 로컬 저장 구현 |
| 계획→실행 프리셋·계획 확인·설정 불일치 보호 | 구현·격리 검수 · 실제 보호는 검증 전 비활성 |
| 작업 절차·보수적 모델 선택·형식/누락 점검 | 공통 규칙 구현 |
| Codex 준비/관측·ChatGPT 확장 연결 | 코드와 검증 도구 구현, 실제 연결 미검증 |
| 실제 모델 변경·자동 보완·작업별 토큰 | 비활성 또는 미지원 |

설정 저장과 AI 전달 확인은 다릅니다. 토큰 절감·품질 향상은 아직 측정하지 않았습니다. 펫 표시를 위한 반복 모델 호출이나 실행 중 이미지 생성은 없습니다. 응답 도착은 목표 달성 자동 판정이 아닙니다.

[정확한 검수 상태](docs/implementation-status.json) · [Windows 검사와 빌드](https://github.com/swaan-kim/autopets/actions/workflows/windows.yml) · [현재 개발 단계](docs/roadmap/implementation.md)

## 사용 흐름

**설치 버튼 또는 “AutoPets 설치하고 켜줘” → 같은 앱 → AI 연결 → 평소처럼 요청 → 도움 확인·조절.**

설치 EXE는 앱과 실행 구성요소를 준비하고, AI 연결은 앱에서 선택합니다. 다음에는 “AutoPets 켜줘”로 기존 설치를 재사용합니다. 작업 준비·설정 실수 방지·채팅별 조건 유지에 집중합니다. [새 제품 소개 원본](docs/start/index.html) · [시작 안내와 현재 배포 상태](docs/releases/start.md)

공유용 새 경로는 `/start/`로 준비합니다. 이번 개발 브랜치의 사이트는 아직 공개 배포하지 않았으며, 기존 루트 체험 주소는 유지합니다.

가볍게 끝내기(Sol → Luna), 균형 있게(Sol → Terra), 어려운 일 풀기(Astra High → Medium) 중 고릅니다. 이 조합은 평가 후보이며 절감률을 보장하지 않습니다. 짧은 번역·맞춤법·단순 수정은 계획을 생략합니다. [설정과 보호의 약속](docs/product/planning-execution.md)

실제 서비스에서 이 전체 흐름을 자동으로 연결하는 검증은 남아 있습니다. 현재 연결에서 작업 창 직접 열기가 지원되지 않으면 작업명·ID를 복사합니다. 펫 메뉴에서 이번 채팅 도움 끄기, 개별 숨김, 앱 종료를 선택할 수 있습니다.

[최신 앱 검수 화면과 방법](docs/testing/assistance-implementation.md) · [제품 방향](docs/product/direction.md)

새 기능의 구현 화면(합성 데이터): [시작 설정 카드](docs/images/app-workflow-presets.png) · [계획 확인과 설정 불일치](docs/images/app-workflow-task.png).
설치·연결을 구분한 [시작 화면](docs/images/app-setup.png)도 확인할 수 있습니다.

[공개 소개·체험 목업](https://swaan-kim.github.io/autopets/)은 **시연 데이터로 만든 진행 확인 콘셉트**이며 실제 앱 연결을 의미하지 않습니다. [홍보 이미지](docs/images/00-overview-wide.png) · [오프라인 목업](docs/demo/index.html) · [제작 방법](docs/design-source/README-제작.md)

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
