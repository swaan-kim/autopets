# 자동 도움의 데이터와 실행 경계

기존 React/Tauri/Rust/SQLite, 앱 ID와 데이터 위치, 공개 demo URL은 유지한다. UI는 src/Assistance.tsx, 로컬 저장/통신은 Rust assistance 모듈, 공유 규칙은 packages/guidance와 packages/contracts에 둔다. 초기 변경에서 전체 앱을 이동하지 않는다.

## 데이터

- Identity: provider + accountId + chatId. Codex는 확인 가능한 세션의 SHA256 범위(session:<hex>)를 강제한다. 로그인 계정 확인을 대신하지 않는다. Chrome 미검증 문서 신원은 일시적이며 실제 채팅 기록 동기화에 쓰지 않는다.
- UserPreferences: opt-in, workStyle, routingMode, fixedModel, allowedModels, allowEscalation, revision.
- TaskContext: goal, outputFormat, constraints, decisions, remaining. 직렬화 UTF-8 3KB 상한. 개정 번호가 맞을 때만 저장하고 동일 내용은 다시 쓰지 않는다.
- TaskRecipe: simple/research/document/planning, 불명확한 경우 general. 분류는 로컬 규칙의 보수적 힌트다.
- RoutingPolicy: 현재 제공 모델·빈 값이 아닌 버전·실측 작업별 품질 평가·사용 범위를 모두 만족해야 switch 후보가 된다. 기본 정책에 평가 모델 목록은 없고, 미검증은 preserve/recommend만 반환한다. 사용자가 현재 요청에 명시한 모델은 고정값·자동 정책보다 우선하며, 실제 연결 검증은 여전히 필요하다.
- QualityCheck: unchecked/passed/needs-review, 구체적인 결함, repairCount<=1. passed는 등록한 형식 기준 통과이며 사실 정확성 판정이 아니다.
- AssistanceState: off/pending/prepared/sent/confirmed/unavailable. requestedModel과 appliedModel을 분리하며 현재 구현은 모델 확인 증거를 만들지 않는다.

## 로컬 인터페이스

기존 events/task-context/task-config API는 유지한다. 새 경로도 같은 loopback 인증과 Origin 차단을 적용한다.

| 경로/명령 | 용도 |
| --- | --- |
| GET /v1/assistance-status | 선호·capability만 조회, 작업 생성 안 함 |
| POST /v1/assistance operation=read | 한 신원의 선호·기록·capability |
| prepare | 개정 번호와 지침 hash/byte 수 저장, scoped nonce 발급; 중복은 주입 생략 |
| delivered | 해당 nonce의 stdout 전송만 표시, confirmed로 승격 불가 |
| context / quality | 전달된 receipt와 같은 채팅/턴의 제한된 기록·점검 |
| sync | Codex 정상 턴 helper의 짧은 기록 갱신; 현재 session/turn/cwd + 개정 번호 필수 |
| get_assistance / save_preferences | 로컬 설정 UI 전용 |
| set_chat_assistance / save_task_context / delete_task_context / delete_all_contexts | 로컬 UI 조절; 끄기와 기록 삭제 분리 |

브라우저 메시지로 공통 선호·capability를 바꿀 수 없다. Native Messaging 호스트는 정확한 extension origin, message ID, 고정 endpoint, 크기·형식을 검증한다. 미검증 배포는 상태 조회 외 쓰기 전달을 거부한다. nonce·이전 요청은 설정 변경·끄기·삭제·앱 재시작 후 무효화한다.

원문·도구 결과는 저장하지 않는다. Codex 현재 요청은 프로세스 메모리에서 규칙 분류에만 사용한다. 다른 채팅 내용이나 원문을 추가 지침으로 승격하지 않는다. 복구·명시적 조건 변경·선호/기록 변경 때만 새 지침을 전달한다.

첫 성공한 Codex 준비에서는 기존 펫 배정을 유지하거나 빈 자리만 배정한다. 최대 세 개를 넘으면 목록에 남긴다. 자동 배정 시도와 슬롯은 함께 저장하며, 중복 준비·수동 해제·재시작으로 다시 나타나지 않는다. 기존 완료 기준과 알림 설정은 바꾸지 않는다.

## 증거

기능 flags는 현재 모든 환경에서 false다. 지원 승격에는 실제 서비스 창의 입력 전달, 동일 작업 식별, 다음 실행에 적용된 설정을 확인한 재현 기록이 필요하다. 자체 app-server가 모델을 지정할 수 있다는 사실은 기존 Desktop 창 제어 증거가 아니다. [Codex App Server](https://learn.chatgpt.com/docs/app-server), [UserPromptSubmit](https://learn.chatgpt.com/docs/hooks#userpromptsubmit), [ChatGPT 확장](https://developers.openai.com/plugins/reference#capabilities).

## 작업 카드와 기록 조절

- 전역 선호에 answerLength(concise/normal/detailed), outputFormat(adaptive/table/list/document)을 추가했다. 이전 저장값은 concise/adaptive로 읽는다.
- Task.workStyleOverride는 null이면 전역 기본값을 따른다. settingsRevision은 문맥 revision과 독립이며 set_task_work_style과 prepare에서 오래된 설정 요청을 거절한다.
- previousContext는 마지막 변경 이전 값 한 개다. undo_task_context는 현재 revision 확인 후 한 번 소비하고 새 revision을 만든다. 채팅별/전체 삭제는 이전 값·변경 요약·품질 검사·전달 receipt도 제거한다.
- 지침이 3KB를 넘으면 문맥 필드를 통째로 제외하고 contextPartial/includedContextKeys와 inspect 안내를 남긴다. 일부 조건을 몰래 잘라 전달하지 않는다.
- 품질 규칙의 checks는 코드 검사/모델 자체 보고/미지원 구분을 제공한다. 현재 저장 API는 요약 품질 결과만 저장한다. 세부 검사 이력 UI와 실제 추가 보완 실행은 다음 단계다.
- 펫 클릭은 작은 카드, 상세 선택은 설정창이다. 개별 숨김은 해당 슬롯에만 적용하며 전체 표시로 복구된다. 3개를 넘는 작업도 목록에 남는다.
- 18프레임은 public/assets/motions/manifest.json으로 관리한다. 축하 모션은 관측된 미확인 응답 도착이며 목표 달성 자동 판정이 아니다. 실제 고민 상태는 관측 근거가 없으면 연결하지 않는다.
