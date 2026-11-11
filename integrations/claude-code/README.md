# Claude Code (계획 단계 · 미연결)

저장한 펫의 계획·구현 단계를 Claude Code 하위 에이전트 파일(`model`·`effort`)로 만든다. 값은 [공통 라우팅 표](../../packages/contracts/data/routing-profiles.json)의 `claude-code` 항목에서 가져온다.

```powershell
node integrations/claude-code/agents.mjs --template <펫 템플릿.json>            # 미리보기(이름·해시)
node integrations/claude-code/agents.mjs --template <펫 템플릿.json> --out <절대 경로>
```

- 계획 우선 펫: `autopets-plan`(읽기 전용, permissionMode plan) + 구현 프로필 하나. 바로 처리하는 펫: 구현 프로필 하나.
- `--out`을 지정해야만 쓴다. `~/.claude/agents`에 자동 설치하지 않는다. AutoPets가 만들지 않은 같은 이름 파일은 덮어쓰지 않는다.
- 목록 밖의 저장 설정은 다른 모델로 바꾸지 않고 거부한다.

## 아직 아닌 것

- `connections.json`의 Claude Code `connectAvailable`은 `false` 그대로다. 앱 연결·정확한 채팅 확인·실행 기록 대조는 없다.
- Claude Code는 Bash·스킬에 일반 세션 ID 환경 변수를 주지 않는다(Remote Control 중에만 `CLAUDE_CODE_BRIDGE_SESSION_ID`). 정확한 채팅 확인은 훅 입력의 `session_id`를 쓰는 방식으로 설계해야 한다.
- `CLAUDE_CODE_EFFORT_LEVEL`이 설정돼 있으면 에이전트의 `effort`보다 우선한다.
- 실제 Claude Code에서 생성 파일로 하위 작업을 실행·확인한 적은 없다(이 PC에는 아직 Claude Code 사용 기록이 없음).

근거: [하위 에이전트 frontmatter](https://code.claude.com/docs/en/sub-agents), [환경 변수](https://code.claude.com/docs/en/env-vars).
