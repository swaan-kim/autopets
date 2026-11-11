# 인계 · 모션과 AI 연결 (2026-11-10)

브랜치 `task/motion-review`, main `de5a974` 기준. 소유자 결정: **이 브랜치를 먼저 통합**하고, `feat/routing-tiers`는 그 위에 다시 올린다(rebase).

## 담긴 것
| 영역 | 내용 | 주요 파일 |
| --- | --- | --- |
| 모션 | 칸별 발 위치 보정, 자세 블렌드, 시간 주입 스프링, 몸통 끌기(⠿ 제거), 매달림, 쓰다듬기 | `apps/desktop/src/features/pets/*`, `public/assets/companion-v1/manifest.json` |
| 검수 | 실제 마우스를 쓰지 않는 헤드리스 검수 S1~S9, 비교 페이지 | `scripts/motion-review*`, `apps/desktop/tests/motion-review*` |
| Claude 데스크톱 | 확장 0.1.2: 항상 실행되는 `main.mjs`, `data` 이벤트 stdin(내장 Node에서 `initialize` 무응답 해결) | `integrations/mcp/{main,server}.mjs`, `manifest.json` |
| 앱 버튼 | Claude에 설치 · Claude에서 쓰기 · Codex 새 대화로 시작 | `platform/pet_preferences.rs`, `PetPreferencesConnector.tsx`, `UiPetStudio.tsx` |
| Claude Code | 플러그인(훅 + 읽기 전용 MCP), 전용 경로 `/v1/claude-code/events`, 설정의 연결·해제 | `integrations/claude-code/`, `platform/claude_code.rs`, `transport/http/claude_code.rs` |

## routing-tiers를 올릴 때 겹치는 곳
- `integrations/mcp/manifest.json`·`server.mjs`·`scripts/package-pet-preferences.mjs`: 이 브랜치의 `main.mjs` 진입점과 stdin 처리는 유지하고 routing 표 파일을 더한다. 파일 수 6→7, 버전 0.1.3 권장. `pet-preferences-mcp.test.mjs`의 파일 수 기대값도 함께.
- `integrations/claude-code/`: 이 브랜치는 `plugin/`, `hooks/`, `.claude-plugin/`, `tests/`. `agents.mjs`와 파일은 겹치지 않음. Claude Code 플러그인은 `agents/` 폴더도 실을 수 있으므로, 펫별 에이전트 파일을 `--out` 대신 플러그인 폴더에 함께 쓰는 방안을 검토(연결·해제가 한 번에 됨).
- "훅 기반 채팅 확인"(routing 5단계 남은 것): 이 브랜치의 훅이 `session_id`·`prompt_id`를 받아 전용 경로로 보낸다. 같은 입력을 쓰면 된다.
- `UiPetStudio.tsx`: 이 브랜치는 `saveAndOpenCodex`·`CODEX_OPENED`·복사 버튼 옆 버튼 추가. routing 표 읽기와는 다른 줄.
- `lib.rs` 명령 목록, `scripts/run-tests.mjs` 테스트 경로(`integrations/claude-code/tests` 추가).
- 4단계 AI 연결 화면: 설정의 [Claude Code에 연결] 블록(`ClaudeCodeConnector`)을 그 화면으로 옮긴다.

## 검사 상태
- 통과: 전체 UI 검사(ui-smoke), Node 268/270(실패 2개는 main과 같은 환경 문제), 모션 검수 S1~S9, Claude Code 플러그인 `claude plugin validate`·설치·해제(격리 HOME), 링크 조립 Rust 함수 단독 컴파일 테스트.
- **미실행: 전체 Rust 컴파일·`cargo test`, Vite 빌드, 실제 Claude Code 세션의 훅, 설치본 E2E.** 이 작업 공간에서는 crates·npm 레지스트리에 접근할 수 없었다.
- 실제 확인: Claude 데스크톱 앱에서 0.1.2 확장으로 `autopets_list_pets`·`autopets_read_pet` 호출 성공.
