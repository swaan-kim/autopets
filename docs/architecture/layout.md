# 구조와 이관 순서

정식 체크아웃: `%USERPROFILE%\Documents\Codex\AutoPets`.
기존 체크아웃과 공개 데모는 보존한다. 아래는 M1 통과 후 적용할 목표 구조이며 아직 프로덕션 파일을 이동하지 않았다.

```text
AutoPets/
  apps/desktop/
    src/
      app/
      features/{pets,tasks,assistance,context,onboarding,settings}/
      bridge/
    src-tauri/
      src/{domain,application,transport,storage,platform}/
      capabilities/
      icons/
    public/assets/
    tests/
  integrations/
    codex/{hooks,scripts,skills/autopets,tests/fixtures}/
    codex/probe/                 # M1 한정 진단, production과 분리
    chatgpt/compatibility/
  packages/
    contracts/{schemas,types,fixtures}/
    guidance/{rules,catalog,tests}/
  docs/{product,architecture,roadmap,testing,releases,archive,demo,images,design-source}/
  scripts/
  .github/{workflows,ISSUE_TEMPLATE}/
  AGENTS.md
  README.md
  package.json
  pnpm-workspace.yaml
```

React 화면은 기능별로, Rust는 도메인·처리 흐름·통신·저장·Windows 기능별로 분리한다. 계약 패키지는 UI와 연결 코드가 공유하는 형식·검증 사례를 관리한다. guidance는 짧은 지침과 정적 문구·규칙을 관리하며 별도 추론 서비스를 포함하지 않는다.

## 이관 시 유지할 동작

- 앱 식별자 `local.autopets.desktop`, `%LOCALAPPDATA%/local.autopets.desktop`, `AUTOPETS_DATA_DIR`, SQLite·펫 위치를 유지한다. DB 변경은 버전별 이관과 기존 데이터 fixture로 검증한다.
- 루트 명령은 작업공간 명령으로 연결하고 Tauri 상대 경로·잠금 파일·CI·패키징·테스트 import를 함께 갱신한다.
- 홍보 제작기는 루트 package 이름을 검사하고 고정 출력 경로를 사용한다. 이동 시 이를 함께 검증하며 `docs/demo/index.html`과 Pages 주소는 유지한다.
- 기존 승인 실험은 production 라우팅에서 분리하고 기록을 archive로 옮긴다. 이전 DB를 삭제해 분리하지 않는다.

## 추가할 계약과 데이터 흐름

`UserPreferences`: 사용자가 선택한 공통 선호와 자동 도움 기본값.

`TaskContext`: 제공 환경+채팅 ID, 목표·결과 형식·조건·결정·남은 일, 개정 번호·갱신 시각.

`AssistanceState`: 적용 요청, 훅 출력, 전달 확인, 기록 저장, 연결 불가를 구분한다. stdout 생성만으로 모델 적용을 확정하지 않는다.

`Capabilities`: 자동 지침 전달·맥락 동기화·계획 관측·복귀·실제 토큰을 환경별로 표시한다.

메시지 제출 → opt-in/채팅 식별 → 필요한 짧은 지침만 전달 → 기존 모델의 정상 작업 → 의미 있는 변경 시 로컬 기록 갱신 → 펫 표시.

관측 훅과 준비 훅은 분리한다. 최초 연결·선호 변경·재개/압축 후 복구 시만 주입하고 UTF-8 3KB 이하로 제한한다. 최신 사용자 요청이 저장된 기본값보다 우선한다. 요약 내용은 데이터로 표시하고 실행 권한이나 상위 지침으로 승격하지 않는다. 모든 로컬 조회·갱신은 기존 인증과 채팅/턴 바인딩을 유지한다.

PostCompact는 복구 필요 표시만 남기고 다음 UserPromptSubmit에서 문맥을 전달한다. 지원하지 않는 훅 출력 형식을 가정하지 않는다. [공식 훅 문서](https://learn.chatgpt.com/docs/hooks)
