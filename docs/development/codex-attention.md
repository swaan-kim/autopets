# Codex 확인 필요·작업 완료 알림

Codex에 일을 맡기고 다른 프로그램을 쓰는 동안, **Codex가 사용자 답을 기다릴 때**와 **요청한 작업이 실제로 끝났을 때** 화면의 강아지 펫이 알려 준다. 펫은 알리기만 하고 답이나 승인은 대신하지 않는다. 사용자는 말풍선의 "Codex에서 확인하기"로 원래 채팅에 돌아가 직접 답한다.

## 알림 두 가지

| 유형 | 말풍선 제목 | 표시 | 예 |
|---|---|---|---|
| `action_required` | Codex에서 확인이 필요해! | 주황 `?` | 계획 승인 요청, A안/B안 선택, 추가 정보 요청, 명령·파일 변경 승인 창, Plan 모드 질문 |
| `completed` | Codex 작업이 완료됐어! | 초록 `✓` | 파일을 만들거나 고친 뒤 완료를 알린 응답, 테스트·빌드를 실행하고 끝낸 응답 |

세부 사유(`reason`)는 `question`, `confirmation_required`, `approval_required`, `completed`다. 턴이 끝났다는 사실만으로는 완료라고 하지 않는다. 완료는 "만들었습니다/완료했습니다" 같은 완료 문장과 **그 턴에서 실제로 관측된 작업**(파일 변경, 읽기 전용이 아닌 명령, MCP 도구, 하위 에이전트)이 함께 있어야 한다. 대화 기록을 읽지 못하면 "Codex 답변이 끝났어"로 표시하고 결과는 직접 확인하라고 안내한다.

## 사용하는 Codex 공식 이벤트

`integrations/codex/hooks/attention-hook.mjs` 하나가 사용자 수준 `~/.codex/hooks.json`의 다섯 이벤트에 비동기(`async: true`)로 등록된다. Codex는 이 훅을 기다리지 않고, 훅은 항상 `{}`만 출력한다(차단·승인·거부·계속 실행·문맥 추가 없음).

| 이벤트 | 하는 일 |
|---|---|
| `Stop` | `last_assistant_message`와 그 턴의 대화 기록(`transcript_path`) 요약으로 확인 필요/완료/없음을 판단. Plan 모드의 제안 계획(`Plan` 항목)도 여기서 확인 필요로 잡힌다. 턴 종료 신호도 보낸다. |
| `PermissionRequest` | Codex가 승인 창을 띄우기 직전. 그 채팅의 승인 검토자가 `auto_review`(자동 검토)면 사용자에게 묻지 않으므로 알리지 않는다. |
| `PreToolUse` (`^request_user_input$`) | Plan 모드에서 선택지를 보여 주고 답을 기다릴 때. |
| `PostToolUse` | 승인한 명령/파일 변경이 실행됐거나 질문에 답해서 도구가 끝남 → 해당 알림 해제. |
| `UserPromptSubmit` | 사용자가 그 채팅에 새 메시지를 보냄 → 이전 질문·완료 알림 해제. (펫 추천 훅과 별개의 핸들러다.) |

Codex Desktop의 App Server 알림(`item/completed`, `turn/completed`, `item/tool/requestUserInput`, `*/requestApproval`)은 Desktop 창과 stdio로만 연결돼 외부 프로그램이 받을 수 없다. 그래서 같은 순간을 알려 주는 공식 훅을 쓴다. 각 훅이 어느 App Server 요청과 같은 순간에 오는지는 격리한 실제 Codex(0.167)에서 확인했다.

## 어떤 채팅이 알림을 받나

펫과 연결된 채팅만 받는다. 펫 링크가 연결된 채팅이거나, `$autopets`로 앱을 연 설정 채팅(앱을 다시 켜서 저장된 링크가 끊긴 상태여도 포함)이다. 다른 채팅은 훅이 `check`에서 거절당해 요약 문구가 앱으로 가지 않는다. 해제 신호에는 ID와 해시만 담긴다. 알림은 링크된 채팅이면 그 펫에, 아직 펫이 없는 설정 채팅이면 첫 번째 강아지 펫에 표시된다. 알림 상태는 메모리에만 있고 DB는 바꾸지 않는다.

## 펫 화면

- 새 알림이 오면 펫 위에 작은 말풍선이 한 번 뜬다(창 크기 252×404, 포커스를 가져가지 않고 위치도 옮기지 않음). 펫 카드가 열려 있으면 카드 맨 위에 같은 내용이 나온다.
- "닫기"는 **읽음** 처리다. Codex가 아직 기다리면 흐린 `?` 표시와 "Codex가 답을 기다리는 중" 문구가 남는다. 실제 해제는 위 해제 이벤트가 왔을 때만 일어난다.
- "Codex에서 확인하기"는 Codex Desktop이 스스로 쓰는 `codex://threads/<채팅 ID>` 링크를 Windows에 넘긴다. 앱 밖에서는 Codex가 정확히 그 채팅을 열었는지 확인할 수 없으므로, "열어 달라고 요청했어. 다른 채팅이 보이면 ‘채팅 이름’을 찾아 줘"라고 안내한다.
- 화면 가장자리에 숨긴 펫은 나오지 않고 손잡이에 주황 `?`/초록 `✓` 배지만 붙는다. 손잡이를 누르면 펫이 돌아오면서 말풍선이 열린다.

## 켜고 끄기

```powershell
# 개발 앱(.local\dev-data)으로 알림 받기
node integrations/codex/scripts/attention-hook.mjs enable --connection "<저장소>\.local\dev-data\connection.json"
node integrations/codex/scripts/attention-hook.mjs status
node integrations/codex/scripts/attention-hook.mjs disable
```

알림이 뜨지 않으면 진단부터 실행한다. 설치 → Codex 신뢰 → 훅 실행 → 분류 → 앱 전달 → 연결 채팅 → 앱 저장 → 펫 표시 순서로 확인하고, 처음 실패한 단계(`firstFailure`)를 알려 준다. 대화 본문이나 경로는 읽거나 출력하지 않는다.

```powershell
node integrations/codex/scripts/attention-hook.mjs doctor --connection "<저장소>\.local\dev-data\connection.json"
```

- `hooks.json`을 바꾸거나 신뢰를 파일로 기록했다면 **Codex Desktop을 완전히 종료(트레이 포함)한 뒤 다시 켜야** 실행 중인 Codex 서버가 새 훅을 읽는다. Codex의 훅 검토 화면에서 신뢰하면 바로 반영된다.
- Codex Desktop은 `transcript_path`를 `\\?\C:\...` 형식으로 넘긴다. 훅은 이 형식을 일반 경로로 바꿔 읽고, 경로가 없거나 쓸 수 없으면 같은 채팅 ID의 기록을 `CODEX_HOME\sessions`에서 찾는다.

`enable`은 "AutoPets attention v1" 핸들러만 추가한다. 다른 훅(펫 추천 훅 포함)은 그대로 두고, 바꾸기 전 파일을 `hooks.json.autopets-attention-<시각>.backup`으로 남긴다. 새 훅은 Codex에서 사용자가 직접 검토·신뢰해야 실행된다. Codex의 훅 설정 화면에서 개별 훅을 끌 수도 있다.

## 판단 기준과 한계

- 질문·확인 판단은 응답의 **마지막 몇 문장**만 본다. 코드 블록, 인용(`>`), 표, 따옴표 안 문구(예: FAQ의 "궁금한 점이 있으신가요?")는 제외한다. "원하시면 …해 드릴까요?" 같은 선택적 제안이나 "궁금한 점이 있으면 알려 주세요" 같은 맺음말은 알리지 않는다.
- 물음표 없이 계획만 제시하고 멈춘 경우도 있다. 이때는 계획 구조(목록·제목과 '계획/단계'), 파일 변경 없음, 그리고 "아직 만들지 않겠습니다" 같은 보류 문장이나 사용자의 "먼저 계획을 제안해줘" 요청이 함께 있을 때만 확인 필요로 본다.
- 모델 호출 없이 패턴으로 판단하므로 표현이 특이하면 놓칠 수 있다(미탐). 맺음말로 진짜 질문을 하는 경우나 하위 에이전트가 한 작업은 증거가 부족해 놓칠 수 있다. 반대로 "완료했습니다"라며 실행만 한 명령이 있으면 완료로 볼 수 있다(오탐).
- 자동 검토(`auto_review`) 채팅의 승인은 사용자에게 묻지 않으므로 알리지 않는다. 사용자 승인 방식 채팅에서만 승인 알림이 뜬다.
- 앱을 다시 켜면 아직 남은 알림은 사라진다(메모리 상태).
- 훅 진단 기록은 소스 체크아웃의 `.local/attention-trace.jsonl`에 ID와 사유 코드만 남는다(대화 본문 없음).
