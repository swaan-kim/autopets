# MVP 기능 가능성 검사 기록

## 명시적 연결 MVP 실증 (2026-09-27)

**조건부 가능:** 배포할 스킬/연결 도구가 기존 Codex 작업을 실제 AutoPets 통신부에 연결하고, 펫 설정으로 native 하위 작업을 실행해 결과·설정을 대조했다. 자동 훅 수신, 부모 채팅의 직접 모델 변경, 설치된 GUI의 전체 통합은 별도 미검증이다.

환경은 Windows 10.0.26200, Desktop 26.917.6896.0, runtime 0.155.0-alpha.16. 실연결 시험 소스 `7fc135b34fed0083323ce217459ac041d01e36ea`. 이후 설치 스킬 진입 경로 누락을 고치고 탐색 실패 진단·합성 검사 ID를 정리한 제품 체크포인트는 `faf619df3fda8507b010290b904a16d5e331e8cc`다. 실제 통신부는 앞선 Windows CI 36254057316의 `7a08b5e` PR merge `d2cd61e46c4f3b65d99a3e9ef35cac1bfc892e5e`에서 만든 bounded probe다. 그 뒤 제품 Rust 변경은 없다. 연결 도구는 `7fc135b`의 독립 패키지 복사본이며 개발 소스 import에 의존하지 않는다. 실제 패키지는 Git 제외 work 폴더에 있고 명령은 별도 시험 작업 폴더에서 실행했다.

| 검사·합성 입력 | 예상 결과 | 실제 결과 | 증거·남은 조건 |
| --- | --- | --- | --- |
| 전용 A에서 연결 | 현재 ID/폴더 대조, 저장/재조회 일치 | connected=true, 기본 light, 훅 관측 세션 없이 연결 | 실제 Desktop 도구 → 번들 connector → 실제 Rust HTTP/SQLite. 계정은 unknown 유지 |
| light: 파일 바이트·해시 계산 | Luna/low native 자식 1회 | 요청/관측 일치, 19바이트와 예상 SHA256 반환, complete | 자식 runtime turn_context와 완료 이벤트 대조 |
| standard: 줄·바이트 계산 | Sol/low native 자식 1회 | 요청/관측 일치, 1줄/19바이트, complete | 모델 변경 확인. 기존 부모 모델 유지 |
| careful: 같은 파일 해시 | Sol/medium native 자식 1회 | 요청/관측 일치, 해시 동일, complete | 동일 모델의 추론 강도 변경 확인 |
| 역할·선택 스킬 | 짧은 역할 지침/고정 스킬 전달 | 각 자식이 autopets-build-implementation@1.0.0 읽기 호출 후 합성 계산 수행 | 전달과 스킬 로딩 근거. 효과·절감률 평가 아님 |
| plan: 나중에 DONE 추가할 계획 | 계획만 제시하고 대기 | Luna/low, waiting, 전용 계획 파일 내용/해시 불변 | 프롬프트 이행. 호스트 Plan 제한 검증 아님 |
| 도움 끄기 | 새 prepare 거절, 자식 0회 | bridge-rejected, enable 뒤 plan 수행 가능 | 실제 대상 한 작업. 전역 설정 변경 없음 |
| 재시작·복원 | 데이터 보존, 오래된 연결 무효 | 같은 DB 재개 시 light 보존/connected=false; 재연결 후 성공 | 실제 backend 정상 종료/통신 파일 제거. 설치 GUI 수명주기는 별도 |
| 상태 표시 | 반환만으로 완료를 꾸미지 않음 | 요청/작업/미확인/계획 대기/완료 UI 검사, 실제 complete 데이터 렌더 확인 | headless UI harness. 실제 설치 오버레이의 포커스/창 동작 미검증 |
| A/B·중복·오류 | 다른 작업 변경 및 중복 위임 거절 | Node/Rust 격리 검사: 대상/폴더/부모/턴/개정/오래된 요청/응답 유실 검사 | 이번 실연결은 A만 실행. B 실제 실행으로 확대하지 않음 |

사용 AI는 부모 4 + 자식 4 = 추가 8턴, 보수적 누계 **25/30**. 화면 조작 0, 기존 설치/훅 신뢰 변경 0. 시험 기본값 light 및 도움 켜짐 복원 후 자체 시험 통신부를 정상 종료했다.

### 코드·패키지 검사

- Node 전체 **205/205**, 화면 빌드와 전체 UI 검사 통과.
- 독립 연결 패키지 131개 파일의 manifest SHA256 일치. 명시적 연결 도구·runtime 조회/대조·선택 역할 스킬 포함을 확인했다.
- 앞선 [Windows CI 36254057316](https://github.com/swaan-kim/autopets/actions/runs/36254057316) 성공. [Windows CI 36254571092](https://github.com/swaan-kim/autopets/actions/runs/36254571092)는 Node 201·UI·Rust 119(2 ignored)·설치본 생성은 통과했지만 설치 직후 탐색이 5.259초에 existing-installation-review로 실패했다. 이전 간헐 실패의 재현이며 정확한 하위 원인은 이 기록만으로 확정하지 않는다.
- 설치로 생성되는 스킬에 명시적 펫 경로가 없던 누락은 실패 회귀 검사로 재현·수정했다. 탐색 실패는 timeout/spawn/exit/json/output-limit와 소요 시간만 기록하도록 보완했고 원본 출력·명령은 기록하지 않는다. 진단 버전의 [Windows CI 36256715208](https://github.com/swaan-kim/autopets/actions/runs/36256715208)에서 `reason=timeout`, 탐색 5.014초/전체 5.164초로 중단 위치를 확인했다. 실제 등록 정보 조회의 어느 내부 단계가 지연됐는지는 미확정이다.
- 확인된 5초 중단을 보완해 조회 대기만 최대 15초로 늘렸다. 잘못된 JSON/종료 코드/과대 출력은 계속 거절한다. 지연 응답·무응답 회귀와 Node 205개를 통과했고 실제 Windows 지연 fixture도 5.928초에 성공했다. 현재 PC의 일반 설치 탐색은 앱 실행 없이 0.865초에 성공했다. 최종 [Windows CI 36257983637](https://github.com/swaan-kim/autopets/actions/runs/36257983637) **성공**: Node 205, UI/빌드, Rust 119 passed / 2 ignored, NSIS, 실제 설치·AI 연결 설정·재호출·연결 도구 복구·연결 해제·제거 통과. 최초 앱 준비 호출 전체는 7.774초이며 레지스트리 조회만의 시간은 아니다. 무신호를 실제 Codex 연결로 계산하지 않았다.
- 최종 설치본은 PR head `faf619d`를 포함한 merge `d5d47910208a79a6ff2b14e7e17083c03de44e8e`, 243,478,880바이트다. CI SHA256SUMS 기준 EXE SHA256은 `9e4de3cf3bc54a3ff41c2f6b3949b7103b145960bb72b023529204fa9823a72b`. [검토 산출물](https://github.com/swaan-kim/autopets/actions/runs/36257983637/artifacts/10911522818). 서명 배포·일반 PC의 다운로드 경고와 전체 native 수명주기 재검사는 이번 통과에 포함하지 않는다.
- probe SHA256: `3b7cc83f4a0c6c1ca31a8e418cbb9e61ffb3b11d6c010c63602223e3a67febd1`. 이 해시는 설치 EXE 해시가 아니다.
- 기존 API/SQLite 위에 명시적 연결과 요청 이력만 버전 있는 구조로 추가했다. 과거 이벤트를 만들지 않고 계정/전체 서비스 지원 상태를 승격하지 않는다.

### 경로의 제품상 한계와 재현

`connector-runtime-audit`는 호스트가 로컬 기록에 남긴 모델·강도/완료를 대조한 값이다. 서버 내부의 실제 처리 모델 증명이 아니다. 로컬 `state_5.sqlite`와 선택된 자식 기록의 형식에 의존한다. 정확한 부모·경로·시각으로 유일한 자식을 얻지 못하거나 형식이 바뀌면 미확인으로 멈춘다. 도구 내부에서만 성공한 호출과 달리 외부 connector/실제 앱 계약까지 연결했지만, native 위임은 여전히 호스트가 제공해야 한다.

재현은 [스킬 절차](../../integrations/codex/skills/autopets/references/explicit-pet.md)의 connect → prepare → native 호출 → observe → returned → observe다. 개발 검사는 `pnpm test`, `pnpm build`, `pnpm test:ui`, Windows의 `pnpm test:rust`. 실제 backend 검사는 명시적 격리 폴더/marker가 있어야 동작하는 ignored test `transport::http::tests::external_pet_bridge_probe`를 사용하며 최대 300초 후 종료한다. 토큰·실제 작업 ID·로컬 경로·원본 대화는 공개 보고서에 넣지 않는다.

원본 자료: Git 제외 `work/mvp-goal/20260927-explicit/`의 connect/light/routing/plan 수신 결과, 각 runtime-audit, 정상 종료 결과, 패키지 manifest와 렌더링. 다음 관문은 **새 설치본에서 일반 입력 → 스킬 호출 → 실제 펫 창까지 통합**이다. 신뢰 완료와 훅 수신은 별개이며 같은 미수신 시험을 원인 수정 없이 반복하지 않는다.

아래는 이전 결과다. 당시 미확인이던 자식 모델·강도는 위 최신 시험에서 확인했다. 이전 일반 입력의 도구 호출은 custom_tool_call 형식으로 후속 발견했으며, 도구 실행이 없었다는 근거로 사용하지 않는다.

## 현재 검사 — native 하위 작업 라우팅 관문 (2026-09-26)

목표 변경: 원래 채팅 모델 변경이 아닌 **펫 전용 하위 작업 라우팅**. 검증 소스 `39527033f2cb271c626aee43a47c5937e18e700b`, Desktop `26.917.6896.0`, Windows runtime `0.155.0-alpha.16`. 실제 가용 목록에서 Luna/low, Sol/low·medium을 재확인했다. 이번 추가 AI 4턴(부모 3, 자식 1), 예산 누계 17/30(이전 재시도 예산 포함). 상한은 30이다. 화면 조작 0건.

| 검사 | 입력·예상 | 결과·증거 수준 | 남은 조건 |
| --- | --- | --- | --- |
| 부모·자식 격리 | 부모 session_id와 자식 agent_id/turn_id가 함께 온 훅 | 관측·준비·계획 보호·사용자 훅 설정 경로에서 부모 변경 0건. 형제별 중복 키 분리. Node 회귀 검사 통과 | 실제 Desktop 자식 수신 |
| 기본값·이번만 변경 | 고정 가용 목록과 한국어 첫 줄 지시·인용문 | 순수 함수 검사 통과. 다음 요청 기본값 복원, 미지원 조합 거절 | 부모의 실제 위임과 하위 작업 첫 실행 기록 대조 |
| 프로필 생성 | 역할·고정 스킬 경로·가용 모델/강도 | 네 개 TOML 생성, 권한 상승 설정 없음, 자식의 추가 위임 비활성. 계획 프로필 read-only | Desktop 실제 로딩·스킬 이행 |
| 전용 훅 | 새로운 관측 정의 7개와 기존 11개 | 사용자 검토 후 공식 hooks/list에서 18개 모두 enabled/trusted, 오류·경고 0 | 신뢰 완료. 실제 Desktop 실행·수신은 별도 |
| 별도 자식 관측 | SubagentStart/Stop 및 자식 도구 이벤트 | 격리 HTTP 시험에서 부모/자식 ID 보존, 원문·도구 출력 전송 0, 응답의 승인 지시 무시 | 현재 도구는 opt-in 실증용. 설치 앱 위임 API·저장·오버레이 아직 미구현 |
| 검사·배포 구성 | Node 전체 및 저장소 밖 패키지 import | 최종 전체 **195/195**, 관련 패키지/관측 검사 37건, 구조·문서 링크 검사 통과. Windows CI 36243544358 성공 | 실제 연결 및 간헐 재시작 안정성은 별도 |

별도 수신기는 사용자 앱/DB와 분리했다. 현재 훅의 model 필드는 관측값이며 추론 강도·서버 실제 처리 모델 증거가 아니다. 자식 Stop은 전체 사용자 작업 완료로 승격하지 않는다. 실제 UI나 입력은 조작하지 않았으며, 검토 안내용 파일 실행은 사용자가 직접 한다.

재현: `pnpm test`, `pnpm verify:layout`. 핵심 회귀는 `node --test integrations/codex/tests/delegation.test.mjs integrations/codex/tests/adapter.test.mjs scripts/tests/desktop-resources.test.mjs`. 새 설치본 및 실제 Desktop 시험 전에는 연결·라우팅·MVP를 통과로 표시하지 않는다.

### 신뢰 이후 실제 Desktop 시험 결과

모든 입력은 전용 A의 합성 시험이다. 상세 작업/턴 ID·진단은 Git 제외 원장에만 둔다.

| 최소 시험 | 예상 | 실제 결과·증거 수준 | 판정·남은 조건 |
| --- | --- | --- | --- |
| light 전용 프로필로 자식 호출 | 프로필 선택 및 자식 첫 실행 설정 확인 | 노출된 native 도구에 agent_type 선택 인수가 없어 부모가 미지원 응답, 자식 실행 0 | **해당 도구의 프로필 선택 경로 미지원 확인**. 서비스 전체 판정 아님 |
| native 도구에 모델·강도 명시 | Luna/low 자식 실행·결과 반환 | 실제 spawn_agent 요청에 model=Luna, reasoning_effort=low, fork_turns=none 기록. 반환된 자식 경로와 결과 확인 | **호출·반환 검증됨**. 자식 runtime 설정·스킬·외부 자동 위임은 미검증 |
| 사용자의 일반 입력 대조 | 시작·도구·완료가 AutoPets로 전달 | 일반 user 메시지와 합성 응답 표식·정상 완료 확인. 부모 runtime Luna/low. A DB 세션 없음·이벤트 0, 대상 조회 HTTP 404 task-not-observed. 후속 재검토에서 custom_tool_call 도구 호출 확인(이전 수집기 누락) | **수신 미통과**. 승인 재요청 대신 호스트 훅 실행/전달 실패 진단 필요 |

앞선 내부 발송 2회는 일반 사용자 메시지가 아니라 도구 응답으로 기록됐다. 실제 입력 대조 1회를 따로 수행한 이유다. 지정 프로필 자식만 받는 격리 관측기는 일반 부모 입력에 적용되지 않으며, 해당 수신 0건으로 훅 전체 미실행을 주장하지 않는다. 앱의 대상 조회 실패와 DB 과거 수신 0건은 각각 검사했다. 훅 실행 로그가 없어 현재는 **실행되지 않음 / 실행 후 실패**를 구분할 수 없다.

[Windows CI 36243544358](https://github.com/swaan-kim/autopets/actions/runs/36243544358)는 Node, UI, 프런트엔드 빌드, Rust **116 passed / 1 ignored**, 설치본 생성 및 bootstrap 검사를 통과했다. `AutoPets-windows-x64.zip` SHA-256은 `f14b463e926b11abe87a74d12eea686055088de631ac630e432486146ff8920c`다. ZIP 해시이며 개별 EXE 해시가 아니다. 별도 native lifecycle 재검사 job은 실행되지 않았다. 기존 앱은 교체하지 않았고 이전 간헐 준비/재시작 실패가 해결됐다는 증거는 없다.

재현 자료는 Git 제외 run 폴더의 `delegation-runtime-trust-check.json`, `delegation-native-trials.json`, `delegation-manual-control.json`, `delegation-receiver-check.json`, `delegation-windows-ci.log`다. 읽기 전용 재확인은 정확한 A의 runtime-inspection, inspectReceiver와 DB 해당 작업 조회로 수행한다. 실제 AI를 같은 이유로 재실행하지 않는다. **MVP 미완성:** 배포 가능한 외부 자동 위임·지침/스킬·실제 자식 수신·펫 연결 관문이 남았다.

## 최신 판정 — 무화면 기존 작업 제어의 차단 확인 (2026-09-26)

**조회 가능, 자동 라우팅 MVP 미완성.** 최신 사용자 요구는 기존 Codex 작업에 한 번 연결한 뒤 요청별 설정을 첫 실행 전에 자동 적용하는 것이다. 과거의 화면 선택값 변경이나 웹 프롬프트 성공은 이번 경로에서 제외한다. 제품 기능은 활성화하지 않았다.

환경: Windows 10.0.26200, Desktop 26.917.6896.0, runtime 0.155.0-alpha.16. 조사 시작 소스 3aea56d11e0e6485f36db1721f572342632300a6. 설치/연결 묶음은 ccd03a41e697e752fb64bf53b68caedf0800c81c로 유지. 설치된 Desktop archive SHA-256은 00b7936388d11a3faede5fc736a8c6264eb66e1907bac4ef72c39b7399175d68이다. 사용자 앱/DB/신뢰/설정 변경 0, 화면 조작 0, 추가 실제 AI 0턴.

| 최소 검사·입력 | 예상 결과 | 실제 결과 | 판정·증거 한계 |
| --- | --- | --- | --- |
| 실행 중 Desktop과 자식 codex.exe의 PID/부모/실행 인수 대조 | 실제 소유 서버와 공개 전송 주소 구분 | Desktop 자식 app-server 인수는 analytics-default-enabled, listen 인수 없음. 검사 도구 자식의 별도 서버들과 구분 | **프로세스 식별 검증됨.** 기본 stdio 실행; 작업 제어 권한은 미확보 |
| 해당 Desktop/서버 PID의 TCP LISTEN 조회 및 소스상 control socket 경로 존재 검사 | 외부 접속점이 있으면 정확한 주소로 읽기 검사 | TCP 수신 0, 사용자 app-server-control/app-server-control.sock 없음 | **해당 관측 경로 없음.** 모든 IPC/원격 경로 미지원으로 일반화하지 않음. 발견되지 않은 주소로 proxy 반복 없음 |
| 설치된 전송 선택 코드 읽기 | Windows Desktop이 공용 daemon으로 연결되는지 확인 | .vite/build/src-mOb8On4V.js의 Fq.connect는 local-daemon 선택 조건에 process.platform !== win32 사용. 이 PC는 stdio 경로 | **설치 코드 근거.** 내부 pipe 탈취/앱 패치/새 listener 시작은 하지 않음 |
| 정확한 A/B/Work 로컬 ID로 기존 metadata-only 조회 | ID/폴더 일치·설정 읽기 | 일치, 별도 조회 서버에서는 모두 not-loaded. A Sol/High, B와 Work Astra/Ultra | **조회 검증됨.** 해당 서버가 Desktop 작업을 소유하거나 제어한다는 증거 아님 |
| 가용 목록에서 Astra 계획/구현 강도 확인 | xhigh와 high가 실제 목록에 있음 | 둘 다 발견 | **목록 검증됨.** 해당 제출의 실행 설정 적용 미검증 |
| A 변경 훅과 선택 역할 스킬, AutoPets 저장된 A/B 이벤트 읽기 | 신뢰·실행·수신·스킬 발견 분리 | 훅 11개 modified, 오류 0. 역할 스킬 enabled/repo 발견. A/B/Work 수신 기록 0 | **발견만 확인.** 과거 신뢰를 재사용하지 않음. 새 시험을 보내지 않아 이번 실행 여부 판정은 없음 |
| 공식 플러그인/MCP 훅 출력 계약 | 배포 가능한 설정 제어 기능 존재 확인 | MCP 훅은 command 훅과 동일 출력 계약; 추가 지침/차단이 있으며 모델·강도 필드 없음 | **이 출력 경로는 모델 변경 미지원.** 다른 공식 제어 API가 없다고 단정하지 않음 |

[공식 App Server 규격](https://learn.chatgpt.com/docs/app-server#protocol)의 stdio·Unix socket·WebSocket은 서버가 선택해 실행하는 전송이다. [UserPromptSubmit](https://learn.chatgpt.com/docs/hooks#userpromptsubmit)의 추가 지침은 설정 변경과 별도이며, [MCP 훅](https://learn.chatgpt.com/docs/hooks#execution-and-lifecycle)은 동일 출력 계약을 사용한다. [플러그인 배포](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks)는 스킬·MCP·훅을 묶는 기능으로 조사했다.

추가 소스 대조: 공개 runtime 태그 rust-v0.155.0-alpha.16(commit 0e2f848bf4a4e8d41a02d848a851ba126c09d185)의 app-server transport 분기는 stdio와 UnixSocket listener를 분리한다. Windows socket 구현 자체는 존재한다. thread/settings/update 테스트는 향후 턴 설정 변경을 검사하므로 UserPromptSubmit 중 같은 제출의 모델 변경 근거로 사용하지 않는다. 로컬 stdio 관측만으로 remote_control 등 모든 연결 부재를 추론하지 않는다.

### 같은 제출의 첫 모델 설정: 독립 차단

정확한 공개 버전 소스의 [run_turn](https://github.com/openai/codex/blob/0e2f848bf4a4e8d41a02d848a851ba126c09d185/codex-rs/core/src/session/turn.rs#L257)은 first_step_context를 먼저 만든 뒤 UserPromptSubmit을 포함한 run_hooks_and_record_inputs를 호출하고, 저장해 둔 첫 context로 run_sampling_request를 시작한다. [설정 변경 처리](https://github.com/openai/codex/blob/0e2f848bf4a4e8d41a02d848a851ba126c09d185/codex-rs/core/src/session/step_activation.rs#L224)는 새 current_settings를 저장하지만 기존 step의 설정 사본은 바꾸지 않는다. turn/settings/update 역시 이 제약을 없애지 않는다.

따라서 **훅이 모델 호출보다 앞선다는 사실만으로, 훅 안 설정 변경이 같은 제출의 첫 모델에 반영되지는 않는다.** 훅 → thread/settings/update 조합은 이 요구를 충족하는 경로로 채택하지 않는다. 이후 턴/다음 sampling step 변경 가능성과 구분한다. 이것은 버전 소스 분석 결과이며 설치 바이너리의 빌드 SHA 동일성이나 실제 변경 실행을 증명하지 않는다. 인증된 제어 주소를 찾더라도 제출 설정 고정 전 개입 지점이 추가로 필요하다.

### 완료 범위와 다음 필요한 조건

① 통신은 **읽기만 검증**, 기존 Desktop 쓰기 연결은 **외부 조건으로 미검증**이다. ② 훅 내부 설정 변경으로 같은 요청 첫 실행 적용은 **해당 경로 미지원 확인(버전 소스 분석)**이며, 다른 사전 적용 경로와 ③~⑤ 통합은 대기한다. 동기 훅 승인만 받으면 자동 라우팅까지 된다는 설명은 하지 않는다. 프롬프트로 모델 이름을 요청하거나 별도 서버 새 작업을 실행하는 우회도 하지 않는다.

재개에는 기존 Desktop 소유 작업에 대한 배포 가능한 제어 endpoint/호스트 확장과, 제출 설정 확정 전 override 계약이 필요하다. 그 후 설정 재조회 3회 → 연결 완료 뒤 계획/구현의 실제 turn_context 기록 → 지침/스킬/펫 통합을 검사한다. turn_context는 호스트 요청 설정의 증거이며 서버의 실제 처리 모델 증명과 구분한다. 현재 계획은 고정 xhigh/high 표식으로만 시험한다.

재현은 화면이나 AI 실행 없이 다음 순서로 한다. 원본 진단과 정확한 PID/경로·선택 대상은 Git 제외 work/mvp-goal/20260925-minimum에 보존했다.

1. PowerShell Get-CimInstance Win32_Process에서 실제 Desktop 부모의 codex.exe를 선택하고 실행 파일·전송 플래그만 기록한다. 원본 명령줄/인증값은 공개하지 않는다.
2. Get-NetTCPConnection -State Listen을 그 PID들로 필터한다. 설치 코드에서 확인한 control socket 파일 경로만 확인한다. 포트 스캔이나 임의 연결은 하지 않는다.
3. node integrations/codex/scripts/tasks-inspect.mjs <runtime.exe 절대경로> <시험 폴더 절대경로> <전용 대상 JSON 절대경로>로 metadata-only 조회한다.
4. node integrations/codex/scripts/runtime-inspection.mjs <runtime.exe 절대경로> <시험 폴더 절대경로>로 가용 모델·변경 훅·스킬 발견을 분리한다.

원본 파일: no-ui-desktop-transport.json, installed-transport-source-excerpts.jsonl, no-ui-tasks.json, no-ui-runtime-a.json, no-ui-events.json. AI 예산 **13/30**, 현재 범위 상한 **18/30** 유지. 10050/미로딩 작업 쓰기는 재시도하지 않았다. 사용자가 변경한 시험 A의 설정을 덮어쓰지 않고, 과거 GUI 복원 대기는 이력으로 남겼다.

## Windows 재시작 검사 보완 (2026-09-26)

검사 소스 4d14e48 → 3555d9b → a141eed. 제품 설치본은 ccd03a4/CI merge 41a416021f48a2a8b56b1336ceeeea9e7419e021, SHA-256 306f137edf4be3c2412fd3fd008c2f9cc745b281c52a1300cbe980ff8b0384b5로 유지했다. 제품 Rust/UI/DB를 변경하거나 사용자 PC에서 재설치하지 않았다.

- UIA 검사를 별도 worker로 옮기고 부모 감시기가 단계별 제한 시간과 결과를 관리한다. 앱 실행 → 로컬 HTTP 준비 → UIA 준비 → 데이터 재읽기를 나눈다. 제한 시간 초과 시 검사 worker만 회수하고 앱 강제 종료는 성공으로 인정하지 않는다.
- [36224214209](https://github.com/swaan-kim/autopets/actions/runs/36224214209)는 실제 설치·재호출·숨김·정상 종료 3회·재시작·제거·재설치·기록/설정/위치 보존을 통과했다. 다만 부모 PowerShell에 설정되지 않은 LASTEXITCODE를 workflow가 검사해 전체 job은 실패했다. 결과 JSON과 worker 종료 코드를 검증하도록 세 workflow 호출부를 수정했다. 첫 설치 25.213초, 첫 화면 4.859초, 프로그램 파일 112,408,934바이트는 해당 단일 runner 실측이다.
- [36224494993](https://github.com/swaan-kim/autopets/actions/runs/36224494993)는 첫 정상 종료·종료 후 DB 읽기까지 통과한 뒤 **restart-bridge**에서 GET /v1/setup의 5초 요청 제한에 도달했다. 재시작 프로세스는 생성됐고 UIA 준비 단계 전이었다. 앞선 전체 통과 한 번으로 간헐 실패가 해결됐다고 판정하지 않는다.
- 연결 파일은 HTTP accept loop보다 먼저 발행되므로 파일 존재만으로 준비를 판단하던 검사를 보완했다. 같은 PID·시작 시각·실행 경로를 확인하며 GET만 요청당 2초/전체 30초로 제한한다. timeout/연결 실패만 재시도하고 인증 오류·잘못된 JSON·예상 밖 상태는 즉시 실패한다. 각 시도와 성공까지의 지연을 기록하고 토큰은 제외한다. 제출·변경·종료 요청은 재시도하지 않는다.
- Windows 로컬 Node 전체 **187/187**, PowerShell 구문, 레이아웃·문서 검사 통과. 실제 루프백 HTTP로 일시/영구 timeout, 401/403, JSON/의미 오류, 프로세스 교체/종료를 검사했다. 이는 실제 제품의 재시작 성공과 별개다.

마지막 판별 [CI 36225050773](https://github.com/swaan-kim/autopets/actions/runs/36225050773)는 선행 bootstrap에서 설치 뒤 앱 준비 요청이 25,001ms 후 **app-unavailable**로 실패했다. 뒤의 recheck-lifecycle은 건너뛰었으므로 새 30초 HTTP 준비 검사 자체의 실제 앱 결과는 **미검증**이다. 같은 원인을 수정하지 않고 다시 실행하지 않았다. bootstrap이 성공한 두 실행과 전체 native 검사가 성공한 한 실행도 보존하지만 **Windows 재시작/준비 안정성은 미해결**이다.

추가 코드 검토에서 platform/runtime.rs 및 windows.rs 일부 경로가 store 잠금을 유지한 채 메인 스레드의 동기 창 상태 응답을 기다리는 위험을 발견했다. 반대편 동기 get_snapshot도 같은 잠금을 요구하므로 교착 후보가 된다. 현재 CI 스레드 스택이 없어 이것을 실패의 확정 원인으로 기록하거나 제품 코드를 추측 수정하지 않았다. 준비 대기 성공도 이 위험의 해소 증거로 계산하지 않는다. 재현 시 스레드 스택 또는 제한 시간 있는 잠금/콜백 회귀로 확인하고, 잠금 해제 후 창 동작을 호출하는 최소 수정과 Windows 제품 빌드가 다음 조건이다.

이번 묶음은 여기서 종료한다. 다음 시작점은 두 개로 분리한다. 외부 라우팅은 공개 소유 서버 제어와 첫 설정 확정 전 개입이라는 호스트 조건이 필요하다. AutoPets 자체 안정성은 앱 준비 실패의 원인을 재현·확정한 뒤 제품 수정과 새 설치본 검사가 필요하다. 로컬 Node/문서 검사 통과를 Windows 앱 또는 연동 MVP의 완료로 대체하지 않는다.

## 이전 판정 — 작은 Codex MVP의 선행 관문 (2026-09-26)

**완성된 MVP 아님.** 사용자가 범위를 기존 Codex 작업 + 제작·구현 펫 하나로 줄였다. 현재 관문은 실제 이벤트, 외부 모델/강도 적용, 실행 전 역할/계획 지침, 스킬 적용이다. 이하 확장·웹 결과는 참고 이력이며 이 관문의 성공을 대신하지 않는다.

환경: 현재 Windows 10.0.26200, Desktop 26.917.6896.0, runtime 0.155.0-alpha.16. 설치/연결 묶음 PR 소스 `ccd03a41e697e752fb64bf53b68caedf0800c81c`, CI merge 소스 `41a416021f48a2a8b56b1336ceeeea9e7419e021`. 현재 PC 설치 앱/DB는 교체하지 않았다.

| 검사·입력 | 예상 | 실제 | 증거 수준·남은 조건 |
| --- | --- | --- | --- |
| CI 설치 묶음을 저장소 밖으로 추출, manifest 검증 | 실행 의존 파일 누락 없음 | 파일 126개 SHA-256 일치. Node v24.21.0, setup 및 새 턴 helper import, 동기 Stop 확인 | 배포 도구 독립 실행 검증. Desktop 수신 증거는 아님 |
| A의 AutoPets 정의 교체 | 다른 사용자 훅/신뢰 저장소 보존 | 관측 8개·동기 지침 3개, `modified` 11개, 오류/경고 0 | 정의 발견 확인. 변경 정의 사용자 검토 대기 |
| 새 읽기 진단으로 역할 스킬 조회 | 시험 폴더에서 스킬 발견 여부 구분 | 최초 A 0개. 검증 묶음의 스킬 하나를 A에 준비한 뒤 enabled/repo 1개, B 0개 | 별도 runtime의 발견만 검증. 기존 Desktop 로딩/적용 미검증 |
| A의 화면과 접근성 비교 | 같은 시험 작업/설정 | 검사 도구 초기화 후 일치. 메뉴 변경 직후에는 이전 트리가 반환되어 다시 관측한 뒤 진행 | 지연·캐시 의존 조건이 있는 UI 경로 |
| Astra High → Sol High → Sol Extra High → Sol High | 모델 및 같은 모델의 강도 선택값 3회 일치 | 화면/접근성 선택 결과 확인. High는 메뉴 접근성에 Extended로 표기됨 | Computer Use 선택값 증거. 배포 어댑터·실행 설정·서버 처리 모델은 미검증 |
| 원래 A 설정/화면 복원 | Astra High와 원래 개발 작업 | 복원 입력 전에 사용자 입력 감지로 중단 | 마지막 관측 Sol/High. 복원 미완료로 명시하며 사용자 후속 변경 보호 |
| A/B/Work 수신 조회 | 정확한 작업별 기존 기록 확인 | 세 대상 모두 session/event 없음 | 실제 AI 요청은 추가 0회. 수신 준비 완료나 작업 완료 표시 금지 |

후속 입력 없는 관측: 사용자가 원래 개발 작업 화면으로 이동했지만 접근성은 시험 A/메뉴를 계속 반환했다. 이 상태에서 모델 복원 클릭이나 작업 이동을 하지 않았다. 현재 A의 모델을 개발 작업 화면의 모델 표시로 추정하지 않는다.

설치기 243,401,343 bytes, SHA-256 `306f137edf4be3c2412fd3fd008c2f9cc745b281c52a1300cbe980ff8b0384b5`, `NotSigned`. 검증 설치 묶음의 전체 manifest SHA-256 `38b7bf71da12d905179841a3c92ea88ca639fe7afca9c58c0d0ea5379bdac715`. [원본 빌드](https://github.com/swaan-kim/autopets/actions/runs/36217263513)의 Node/UI/Rust/패키지/bootstrap 통과와 실제 현재 PC 훅 수신을 구분한다.

동일 설치본의 [별도 Windows 재검사](https://github.com/swaan-kim/autopets/actions/runs/36220818881)는 **bootstrap 통과, 수명주기 시간 초과**다. 설치, 첫 화면, 재호출, 숨김 복귀, 실제 역할 저장의 산출물이 있고 로그에 첫 정상 종료와 포트/연결 파일 검사 통과가 기록됐다. 종료 후 `before-restart.json`도 생성됐으며 기록·역할·설정과 SQLite integrity `ok`를 확인했다. 그 뒤 재시작 준비 구간에서 15분 job 제한에 도달했고 `after-restart.json`/최종 결과는 없다. 따라서 재시작·제거·재설치 보존 통과로 계산하지 않는다. 앱 재실행과 동기 UI Automation 관측 중 어느 지점이 정체됐는지는 현재 증거로 확정할 수 없다. 다음 검사는 재시작/창 탐색 각각의 제한 시간·진행 기록을 분리하여 같은 설치본으로 수행한다. 원인 분석 없이 동일 검사를 반복하지 않았다. 이전 설치본 및 현재 PC의 완료된 1단계 기록은 별도다.

스킬은 공식 [로컬 스킬 발견 위치](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)에 따라 A에만 준비했다. 파일 SHA-256 `cc47d741bf6f561eabb9cc3b1027d0949a1b9bbec8be74e9122ce070b433847e`, 스킬 버전 1.0.0. [skills/list](https://learn.chatgpt.com/docs/app-server#skills)의 발견 결과와 모델 입력의 실제 skill 로딩은 다른 증거다. 향후 같은 이름의 중복/다른 파일이 있으면 이름만으로 적용 성공을 판정하지 않는다.

진단 보완의 Node **180/180** 통과: 선택 폴더 한 곳만 조회, 추가 루트/쓰기 거절, 개인 스킬/설명/도구 의존 정보 제외, 실패·미발견에서 실행 지원 승격 방지를 확인했다. 화면/Rust/훅 실행 코드는 이번 진단 변경으로 바꾸지 않았다. 재현 명령은 기존 `runtime-inspection.mjs <runtime.exe> <시험 폴더>`이며, 새 `roleSkills` 결과도 공개 제품 지원 상태에 반영하지 않는다.

원본 진단·정의 백업·턴 원장은 Git 제외 경로에 있다. 실제 AI 11턴 + 관측된 호스트 재시도 2회 = **13/30**, 이번 상한 **18/30**. 다음 필수 조건은 A의 변경 정의 검토, 기존 Desktop 실제 수신, 배포 가능한 설정 제어, 실제 지침/스킬 적용이다.

## 이전 판정 — 실제 웹 응답과 Desktop 직접 입력 (2026-09-26)

소스 `ccd03a4`, 현재 PC Windows 10.0.26200, Desktop 26.917.6896.0/runtime 0.155.0-alpha.16. 로그인된 Chrome의 정확한 기존 합성 작업을 사용했다. 웹 서버 배포 버전은 미확인이다. 설치 앱/신뢰된 훅은 `2059bae`다. 아래 과거 행의 예산·신뢰 대기·웹 로그인 미확인은 이 최신 판정으로 대체한다.

| 환경 | 정확한 작업·실제 이벤트 | 모델·추론 | 지침·계획 프롬프트 | 실제 Plan·제출 보호 |
| --- | --- | --- | --- | --- |
| Codex Desktop | A/B metadata 조회. A 신뢰 11개 확인 후 내부/실제 사용자 제출 모두 수신 0건 | 별도 서버 쓰기 거절. 안정된 배포 제어 경로 미확보 | 동기 훅 전달 미검증 | 미검증 |
| 별도 Codex CLI | 세션/턴 시작·도구 시작/종료·세션 종료 수신. Desktop A/B와 혼선 없음 | CLI 요청 설정 확인, 기존 Desktop 제어 증거 아님 | 도움 꺼짐 상태로 미검증 | 미검증 |
| Work 로컬 | metadata 조회, 실제 수신 미검증 | 기존 작업 제어 미검증 | 미검증 | 미검증 |
| Work 클라우드 웹 | URL/시험 기록 일치, 이번 요청·응답 확인. AutoPets 이벤트 수신 미검증 | 선택값 3회 재조회 이력. 이번 Sol/High 선택 후 응답 완료; 서버 처리 모델 미확인 | **조건부 가능:** 입력창 계획 지침 전달·응답 대기 확인 | 미검증 |
| Chat 앱 | 과거 앱 시험 응답 외 이번 제어 미검증 | 웹 결과와 별개 | 미검증 | 미검증 |
| Chat 웹 | URL/시험 기록 일치, 이번 요청·응답 확인. AutoPets 이벤트 수신 미검증 | 선택값 3회 재조회 이력. 이번 5.6 Sol/Extra High 선택 후 응답 완료; 서버 처리 모델 미확인 | **조건부 가능:** 입력창 계획 지침 전달·응답 대기 확인 | 미검증 |

### 웹 계획 프롬프트 최소 실험

두 요청은 역할 지침, 계획 2개, 확인 대기, 도구/파일 생성 금지를 포함한 UTF-8 3KB 미만 한국어 여러 줄 합성 입력이다. 빈 입력창 → 삽입 → 원문 동일성 재읽기 → 한 번 제출 → 응답 완료 → 원래 설정/빈 입력창 확인 순서로 검사했다.

| 대상 | 입력·예상 | 실제 응답·증거 | 남은 조건 |
| --- | --- | --- | --- |
| Work 클라우드 | 조사·문서 역할, 사과/배 비교 파일 요청. 이번에는 계획/대기만 | 비교 정리와 파일 작성의 계획 2개, `AP-WAIT-WORK`. 보이는 도구/산출물 0. Astra/High 복원 | 원격 파일시스템 미감사. 배포 adapter·추가 지침·native Plan·실제 모델 증거 필요 |
| Chat 웹 | 제작·구현 역할, 숫자 증가 버튼 HTML 요청. 이번에는 계획/대기만 | UI 배치와 클릭 동작의 계획 2개, `AP-WAIT-CHAT`. 코드/파일 생성 표시 없음. 최신 모델/Pro 복원 | 동일. 앱에서 만든 작업이지만 이번 실행/관측은 웹에서 수행 |

요청/응답 DOM 메시지 ID를 구분했고 실제 실행 모델을 확인할 DOM 속성은 찾지 못했다. 화면 선택값이나 모델 자기보고를 실행 모델 확정에 사용하지 않는다. 원문/답변은 전용 합성 내용만 Git 제외 증거에 저장했다. 첫 실행 전 추가 지침, native Plan 제한, AutoPets 자동 재제출 보호로 판정하지 않는다. 첨부 시험은 수행하지 않았다.

### 수정·검사 상태

CLI의 중복 시작은 같은 작업/턴/폴더의 동일 이벤트 ID로 합치고 Stop 알림은 수신 응답을 기다리게 했다. 기존 이벤트 primary key를 사용하므로 API/DB 변경은 없다. 수정 전 실패한 회귀 2건이 통과했고 Node 178/178 통과. 최초 Windows 새 회귀 실패는 임시 폴더 경로 별칭 문제로 확인해 fixture를 정규 경로로 수정했다. `ccd03a4`의 [Windows CI](https://github.com/swaan-kim/autopets/actions/runs/36217263513)는 Node·UI·Rust·설치본 생성·bootstrap 연결/복구/제거 성공. 별도 깨끗한 runner 수명주기, 변경 정의 신뢰, 실제 수정 후 CLI 수신은 별도 검사다.

실제 AI 11턴 + 발견한 전송 재시도 2회 = 예산 **13/30**, 이번 상한 **18/30**. A의 사용자 변경 Astra/High와 다른 사용자 창을 보존했다. 공개 MVP 준비나 기존 Desktop 핵심 연결 완료로 판정하지 않는다.

## Desktop 실제 입력 결과·전달 결함 회귀 (2026-09-26)

제품 `2059bae`, Desktop 26.917.6896.0/runtime 0.155.0-alpha.16에서 사용자가 전용 A에 합성 파일 읽기를 직접 제출했다. 실제 사용자 메시지, 도구 실행, 완료 표식, 기본 모드와 Astra/High 요청 설정을 확인했다. AutoPets의 A session/event는 여전히 없었고 B/Work도 변하지 않았다. 따라서 내부 도구 전달만의 문제라는 가설은 해소되지 않았으며 **Desktop 실제 입력 훅 연결은 미통과**다. 사용자의 High 선택을 보존한다. 원본 입력·개인 대화 대신 시험 턴 ID·설정·완료 여부만 Git 제외 진단에 남겼다.

`e6496c7` 이후 소스 수정:

- 관측 프로세스·동기 준비·재전달이 각각 임의 ID로 같은 턴 시작을 보냈다. 실제 HTTP 경로에서 이 셋의 이벤트 ID가 서로 달라 기존 DB가 모두 저장할 수 있음을 재현했다. 시작 ID를 작업·턴·폴더에 묶어 중복 저장을 방지한다. A/B 및 다음 턴은 서로 다른 ID이며 원문은 해시에 넣지 않는다. DB/API 형식은 그대로다.
- Stop이 비동기인 정의를 기존/통합 설치 경로 모두 동기로 변경했다. 종료 시 호스트가 배경 훅을 취소하는 위험을 줄이고 제한된 전송 완료를 기다린다. 대기 중인 로컬 응답을 받기 전에 훅이 완료되지 않는 HTTP 검사와 오류 시 빈 JSON/정상 승인 흐름 검사로 검증했다. 실제 CLI에서 누락의 유일 원인인지와 새 패키지 실행 결과는 추가 확인 대상이다.
- 새 회귀 2건은 수정 전 실패, 수정 후 통과. Node 전체 **178/178**, 레이아웃 및 문서 링크 검사 통과. Windows 패키지/수명주기와 실제 새 정의 검토는 다음 결과로 기록한다. 현재 신뢰된 패키지를 몰래 교체하거나 신뢰 저장소를 변경하지 않았다.

직접 제출 후에도 전면 창의 화면은 A, 접근성은 이전 작업인 상태가 재현돼 모델·Plan·입력은 바꾸지 않았다. 실제 AI 시험 **9턴**, 관측된 전송 재시도 총 2회를 포함한 보수적 예산 **11/30**(이번 상한 18/30). 원본 진단: `manual-a-summary.json`, `after-manual-a.json`, `hook-delivery-fix-tests.txt`.

## 사용자 A 허용 후 실제 훅 비교 (2026-09-26)

환경: Windows 10.0.26200, Desktop 26.917.6896.0/runtime 0.155.0-alpha.16, 제품 및 외부 배포 묶음 `2059bae`. 현재 설치 수신 앱을 그대로 사용했다. 입력은 전용 폴더의 합성 파일 한 개와 알려진 완료 표식이며 일반 작업·개인 대화는 입력하지 않았다.

| 최소 검사 | 예상 | 실제 결과 | 판정·다음 조건 |
| --- | --- | --- | --- |
| A/B 신뢰 재조회 | 사용자가 허용한 정의만 trusted | A 11개 trusted, B 11개 untrusted, 오류/경고 0 | A 정의 신뢰 **검증됨**. B는 별도 검토 대기. 신뢰 저장소를 대신 변경하지 않음 |
| 기존 Desktop A 내부 전달 | 시작·도구·완료 수신 | 합성 파일 읽기 및 완료 표식 확인, 요청 설정 Astra/Ultra. AutoPets DB의 A 이벤트 0건 | **해당 실행에서 미수신**. 내부 전달은 일반 UserInput이 아닌 FunctionCallOutput으로 기록돼 실제 입력창 제출과 구분 |
| AI 없는 별도 App Server 시작 | 신뢰 상태와 세션 시작 경로 진단 | A의 같은 11개 신뢰 확인 후 ephemeral 작업 생성, 모델 턴 0, 수신 0 | 실행 요청 전 진단일 뿐 기존 Desktop 연결/실제 훅 실행 증거 아님 |
| 별도 CLI 일반 요청 | 신뢰된 패키지 훅이 실제 수신기에 전달 | Luna/low를 가용 목록에서 선택해 임시 작업 실행. 종료 코드 0, 파일 읽기 성공, 완료 표식 일치. 세션 시작·턴 시작·도구 시작/종료·세션 종료 수신 | **CLI 수신 경로 검증됨**. 외부 Desktop 기존 작업 제어·계정 확인·첫 지침 성공으로 확대하지 않음 |
| CLI 턴 종료·중복 | 턴 시작/종료를 정확히 대응 | 같은 턴의 시작 2건, tool start/end 각 1건, session end 1건, turn finished 0건 | **부분 실패**. 중복 시작과 종료 직전 비동기 훅 유실 여부 조사 필요. 세션 종료를 턴 종료 성공으로 세지 않음 |
| 기존 A/B/Work 격리 | 임시 CLI 이벤트가 기존 작업을 바꾸지 않음 | 전/후 읽기 전용 DB 비교에서 기존 세 대상의 session/event는 계속 없음 | 이 입력에 대한 **격리 검증됨**. B 실제 훅 수신 및 역순/재연결 실환경 검사는 별도 |
| Desktop 입력 안전성 | 화면/접근성/작업 일치 | 다른 시점의 작업 정보가 반환되는 문제 지속 | 자동 입력 중단. 사용자가 정확한 A 입력창에서 합성 요청을 한 번 보내는 검사 대기 |

정의·모델 기본 설정·전역 도움 설정을 변경하지 않았다. 기존 A의 정상 응답을 중단하지 않았다. CLI 실행은 별도 프로세스의 모델/추론 옵션이며 기존 Desktop 설정 변경이 아니다. CLI 종료 시 비동기 훅이 취소될 수 있다는 [공식 훅 규격](https://learn.chatgpt.com/docs/hooks#background-hooks)은 누락의 후보 설명이며 이번 실행의 원인으로 확정하지 않았다.

원본 증거: `trusted-hook-comparison.json`, `trust-after-user-a.json`, `trust-after-user-b.json`, `trusted-cli-probe.json`, 전/후 선택 대상 DB 기록과 턴 원장. 모두 Git 제외다. 실제 AI 시험 누계 **8턴**, 해당 Desktop 실행에서 발견한 전송 재시도 1회까지 보수적으로 포함해 **예산 사용 9/30**, 이번 상한 18/30. 이후 사용자 입력창 시험은 별도 1회로 추가 계산한다. 아래 A 미신뢰 및 6턴 기록은 이 검사 전 상태다.

## 배포 묶음·Windows 최종 체크포인트 (2026-09-26)

- 제품 커밋 `2059bae2b800507cc4a9a9a95f79e6fb0ab38912`, 실제 CI merge 소스 `0c074047dfee7bd048611b53090169d04b426221`. merge의 두 번째 부모가 제품 커밋임을 확인했다.
- [빌드 36211537467](https://github.com/swaan-kim/autopets/actions/runs/36211537467)의 Node·UI·Rust·NSIS 생성은 통과했지만 bootstrap 첫 발견이 `existing-installation-review`, 5.813초에 실패했다. 설치 탐색의 5초 제한이 후보 원인이지만 확정하지 않았으며 제품 코드를 추측으로 바꾸지 않았다.
- [동일 설치본 재검사 36212630208](https://github.com/swaan-kim/autopets/actions/runs/36212630208)에서 bootstrap과 별도 깨끗한 Windows의 수명주기·데이터 보존은 모두 통과했다. 최초 간헐 실패를 해결했다고 판정하지 않는다.
- 설치본 SHA256 `7e9f001faca1a72c3a7492ebb65d9a18e099f7d8417c2685dd2421880d010826`, 243,422,728 bytes, `NotSigned`. 같은 빌드의 배포 ZIP SHA256 `5445b6f7e7362343d90e3086f44a4299b37856b3c88e47c76d843c6859bdb33c`, 337,560,341 bytes.
- Windows 실측: 설치 23.588초, 첫 화면 5.228초, 정상 종료 0.799초, 제거 1.175초, 재설치 22.212초. 동일 프로세스 재호출, X 숨김 복귀, 종료 후 포트 닫힘/프로세스 0, 기록·설정·위치 보존과 SQLite integrity 확인. 제거/재설치 전후 데이터 바이트 동일. 수명주기 검사에서 강제 종료를 사용하지 않았다.
- 설치된 connector 123개 파일과 번들 Node v24.21.0을 CI에서 확인했다. 현재 PC에서는 같은 CI 배포 ZIP의 125개 파일(설치 파일 포함)을 전부 해시 검증해 저장소 밖에 풀고, 번들 Node로 전용 A/B 설정 도구를 실행했다. 현재 PC의 기존 앱을 재설치한 결과는 아니다.
- A/B 정의를 각각 관측 8·동기 지침 3개로 준비했다. 이전 파일 백업/해시와 다른 훅 보존을 확인했고, 동일 런타임 발견 결과는 각 11개 `untrusted`, 오류/경고 0이다. 신뢰 저장소를 변경하지 않았다. 앱 도움 설정은 enabled=false라 준비만으로 지침이 전달되지는 않는다.
- 진단 재현: `node integrations/codex/scripts/receiver-inspect.mjs <connection.json 절대 경로> <선택한 작업 JSON 절대 경로>`. 패키지 실행은 앞의 node를 배포 묶음 `runtime/node.exe`로 바꾼다. 대상 JSON은 기존 `id/cwd/label` 계약을 사용하며 GET만 수행한다. 원본 증거·명령·턴 원장·백업은 Git 제외 경로에 있다.

현재 중단점은 사용자의 A 훅 신뢰 검토다. 검토 프로세스 자동 실행에서 보이는 콘솔을 확인하지 못해 그 프로세스만 종료하고, 탐색기에 사용자용 바로가기를 열었다. AI 요청은 보내지 않았고 누계 6/30을 유지한다. 실제 첫 전달·실시간 연결·모델 실행·native Plan·자동 재제출 관문은 미통과다.

## 기존 Work·Chat 웹 설정 실험 (2026-09-26)

환경: 현재 PC Chrome의 로그인된 ChatGPT 웹. IAB의 과거 로그인 차단과 다른 브라우저 세션이며 계정 표시 이름을 검증된 계정 ID로 사용하지 않았다. 소스 기준 `2059bae`, 증거는 실제 페이지 DOM/접근성 선택값이며 AutoPets 확장은 활성화하지 않았다.

| 대상 | 입력·예상 | 실제 결과 | 증거 수준·남은 조건 |
| --- | --- | --- | --- |
| 기존 Work 클라우드 | 기록된 작업 링크/ID와 합성 완료 문구 대조 | 동일 작업의 기존 문구 확인 | 웹 대상 식별; 로컬 실행 환경 제어가 아님 |
| Work 모델·추론 | Astra High → Sol High → Sol Extra High → Sol High | 각 변경 후 선택값 일치, Astra High 복원 | 3회 UI 재조회만 통과. 다음 실행 기록·배포 가능한 외부 adapter는 미검증 |
| 기존 일반 Chat 웹 | 기존 Chat 시험 ID/합성 문구 대조 | 앱에서 만든 같은 대화를 웹에서 확인 | 웹에서의 동일 작업 조회, 앱 제어 증거로 전용하지 않음 |
| Chat 모델·파워 | 최신/6 Pro → 5.6 Sol Pro → Extra High → Pro | 각 변경 후 선택값 일치, 최신/6 Pro 복원 | 3회 UI 재조회만 통과. Codex 모델·추론 목록과 별도 취급 |
| Chat 계획 지침 초안 | 한국어 3줄을 빈 입력창에 삽입, 정확히 재읽기, 복원 | 원문 일치, 시험 텍스트만 지우고 빈 초안 확인 | 입력창 삽입만 확인. 전송·첫 실행 전 전달·응답 이행·제출 보호는 미검증 |
| Desktop UI | 전용 창에 시험 A를 준비한 뒤 화면/접근성 비교 | 화면은 A, 접근성은 다른 작업. 연결 초기화 한 번 뒤에도 불일치 | 클릭·입력 중단. 모델/Plan/초안 변경 없음 |

웹 메뉴는 닫힌 모델 하위 메뉴의 DOM도 남긴다. 상위 모델 메뉴를 실제로 연 뒤 접근 가능한 이름 있는 radio 항목을 선택해야 한다. 숨겨진 목록 존재나 클릭 요청 완료만으로 적용 성공을 판정하지 않는다. 모델 선택값을 재조회한 뒤 시험 설정을 복원했다.

실제 AI 추가 실행 0회, 누계 6/30. 이 결과로 확장의 `modelSwitch`, `reasoningSwitch`, `inputAssistance`를 활성화하지 않았다. native Plan·첫 지침·실제 응답/도구 이벤트·첨부 보존·자동 재제출은 아직 통과하지 않았다.

### 환경별 핵심 관문

| 환경 | 조회·이벤트 | 모델/추론 | 지침·Plan·보호 | 다음 조건 |
| --- | --- | --- | --- | --- |
| Codex 로컬 | 정확한 metadata 조회. 실제 훅 수신 미통과 | 별도 서버 쓰기는 unloaded 거절, Desktop 외부 경로 미확보 | 동기 훅 기반만 있음; 실증 미통과 | 패키지 정의의 사용자 신뢰, 실제 A/B 이벤트, 현재 Desktop 제어 경로 |
| Work 로컬 | 정확한 metadata 조회. Codex와 originator 구분 | 기존 작업 제어 미검증 | 실증 미통과 | 별도 작업의 훅/실행 환경과 제어 경로 |
| Work 클라우드 | 웹 ID·기존 합성 기록 확인. 실시간 수신 미검증 | 웹 선택값 3회 확인, 실행 적용 미검증 | native Plan·지침 전달 미검증 | 해당 실행 환경에 연결 도구 배치 가능 여부, 배포 adapter |
| Chat 앱 | 과거 합성 응답 확인. 이번 웹 결과와 별개 | 현재 앱 외부 제어 미검증 | 실증 미통과 | 앱 대상/접근성 일치와 배포 가능한 경로 |
| Chat 웹 | 로그인된 Chrome에서 정확한 기존 작업 확인 | 선택값 3회 확인, 실행 적용 미검증 | 한국어 계획 초안 삽입만 확인 | 확장/native bridge 실증, 전체 요청 식별·이행 확인 |

공식 [훅 문서](https://learn.chatgpt.com/docs/hooks)는 실행 전 동기 컨텍스트와 정의별 신뢰를 설명한다. [플러그인 문서](https://learn.chatgpt.com/docs/plugins)는 Work/Codex 훅 스크립트가 실행 환경에 있어야 하며 웹 설치만으로 배치되지 않는다고 명시한다. [App Server 문서](https://learn.chatgpt.com/docs/app-server)의 모델/협업 모드 기능과 현재 Desktop에 접속할 수 있는지는 별도 관문이다. 해당 문서에서 일반 Chat의 모델/Plan을 바꾸는 범용 플러그인 경로는 확인하지 못했다. 서비스 전체 미지원이라는 판정은 하지 않는다.

## 배포용 훅 연결 진단 수정 (2026-09-26)

| 검사 | 입력·예상 | 실제 결과·증거 | 남은 조건 |
| --- | --- | --- | --- |
| 저장소 밖 설정 도구 | 한글·공백 임시 경로의 staged connector에서 assistance setup import | 수정 전 `ERR_MODULE_NOT_FOUND` 재현, 누락 installer helper 포함 후 통과 | 새 Windows 설치 패키지 확인 |
| 활성 바인딩 진단 | 정확한 sessionId + cwd, GET만 사용 | 실제 수신기 A/B/Work 로컬은 `404 task-not-observed`; 과거 수신 이력은 이 검사로 판정하지 않음 | 신뢰된 실제 호스트 이벤트 |
| 진단 격리 | 다른 폴더 성공 응답, 미활성 턴, 알 수 없는 오류·큰 응답 | 대상 혼동 거부, 상태 구분, 원문·인증값 비출력 검사 통과 | 제품의 과거 이벤트 기록과 별도 대조 |

현재 Node 전체 176건 통과. 실제 AI 추가 호출 0회(누계 6/30). API/DB/앱 식별자 변경 없음. 새 빌드 확인 전 설치 패키지 완료로 계산하지 않는다.

검사 시작: 2026-09-25. 기반 `997a941`, Windows 현재 PC, Codex CLI/Desktop 실행 파일 `0.155.0-alpha.16`. 진행 중인 기록이며 빈 결과를 통과로 해석하지 않는다.

## 기존 작업 제어 우선 재검사 (2026-09-26)

**현재 결론:** Codex·Work 로컬의 선택한 작업 정보를 외부에서 읽는 경로는 검증됐다. 외부 AutoPets의 기존 작업 모델/추론 변경, native Plan, 실행 전 지침, 제출 보호는 미통과다. 사용자의 후속 질문에 따라 화면 자동 조작보다 훅의 실제 실행·수신을 우선한다. 이 절이 아래 과거의 ‘CI 실행 중’, ‘goal 일시정지’ 및 오래된 카운트보다 최신이다.

### 준비·설치본

제품 PR head `28d1f6c6f08bb4727efeb65664745e4e67e847db`, 실제 CI checkout은 테스트 merge `ba8c09b2a24570b0443c13cc4122ecf731e5093b`다. [원래 CI](https://github.com/swaan-kim/autopets/actions/runs/36175171683)는 Node 173건, 화면/빌드, Windows Rust 116건(합성 seed 1건 ignored), NSIS 생성까지 통과한 뒤 bootstrap의 첫 앱 열기 판정에서 실패했다. 오류 코드가 원래 로그에 없어 근본 원인은 확정하지 못했다.

- 하네스에 비밀값을 제외한 오류 코드·상태·소요 시간을 기록하고, 기존 설치본의 해시/소스 commit을 검증해 실패 단계만 재검사하는 경로를 추가했다. PR head와 CI merge commit을 각각 기록한다. 재검사 과정에서 확인된 하네스 문제(merge commit 식별, 설치 시험과 새 PC 수명주기 시험의 runner 공유)를 수정했다.
- 같은 설치본의 첫 재검사에서 bootstrap은 통과했다. 최종 하네스 `7369338`의 [CI 36208436056](https://github.com/swaan-kim/autopets/actions/runs/36208436056)는 bootstrap 및 별도 깨끗한 Windows의 수명주기 모두 통과했다. 최초 앱 열기 실패는 **재현되지 않음/원인 미확정**이며 추정으로 제품 코드를 바꾸지 않았다.
- 설치본 243,405,214바이트, `NotSigned`, SHA-256 `68d9473c3b7a761656f5d8634beb57080304827c517472356b0dcdb6f368463f`.
- 실제 설치 23.565초, 첫 화면 5.131초, 정상 종료 0.799초, 제거 5.250초, 재설치 22.234초. 실행 중 재호출과 X 숨김 후 재호출은 동일 프로세스/창을 유지했고 중복 프로세스는 없었다. 정상 종료는 강제 종료 없이 프로세스 0·포트 닫힘·연결 파일 제거였다.
- 실제 역할 저장, 재시작, 덮어쓰기, 제거·재설치 후 기록·설정·위치 보존과 SQLite 무결성 `ok`를 확인했다. GitHub-hosted 관리자 Windows 범위이며 현재 PC의 앱은 교체하지 않았다. 개발 도구 없는 일반 사용자 PC·서명·다운로드 경고를 통과했다고 확대하지 않는다.

### 기존 작업·훅·설정 요청

환경: 현재 Windows 10.0.26200, Desktop `26.917.6896.0`, runtime `0.155.0-alpha.16`, 제품 코드 `28d1f6c`, 진단 하네스 `7369338` 및 Git 제외 스크립트. 입력은 전용 A/B/Work 로컬의 정확한 ID·경로와 합성 설정값뿐이다. AI 추가 실행 **0회**, 누계 **6/30**.

| 검사 | 예상 | 실제 결과 | 판정/다음 조건 |
| --- | --- | --- | --- |
| A/B/Work 로컬 metadata 재조회 | 정확한 ID·cwd·출처·기존 설정 반환 | 세 대상 일치, Astra/Ultra 유지, 각각 `not-loaded` | **검증됨: 정보 조회만**. 실행 관측/공유 Desktop 세션 접근은 별도 |
| 별도 App Server의 A 설정 변경 | 현재값 → 가용 조합 확인 → Sol/High 요청 → 재조회 | model/list에서 조합 확인 후 `thread/settings/update`가 -32600(작업 미로딩/찾기 오류 계열)으로 거절. 재조회는 Astra/Ultra 그대로 | **미지원 확인: 이 별도 서버의 미로딩 작업 변경 경로**. 서비스 전체의 모델 제어 불가능을 뜻하지 않음. resume/새 턴/권한 변경 없이 종료 |
| 훅 사용 조건 | feature·설정 계층·발견·신뢰 분리 | `features list`: hooks stable true. A/B 프로젝트 계층 활성, 각 8개 enabled=true, 모두 untrusted, 오류/경고 0 | **외부 조건으로 미검증: 호스트 신뢰 검토 및 Desktop 실제 실행**. 정의 발견만으로 연결 성공 아님 |
| 설치 앱 수신 상태 | 정확한 시험 작업에 실제 이벤트 존재 | 인증 GET setup: appReady=true, chatConnected=false, guidanceDelivered=false. A/B/Work task-context 조회 거절 | 수신 미확인. 이 진단은 합성 이벤트를 실제 앱에 보내지 않음 |
| 전용 UI 창 | 작업 ID로 준비 후 화면·접근성·입력 대조 | 새 창을 열어 Codex A의 제목/AP-A 문구/Astra Ultra 확인. 이전 작업을 반환하는 접근성 정보와 편집 포커스 미확인 재현 | **조건부 가능: 화면 열기**. 안정된 대상/입력 제어 미통과. 설정 변경·붙여넣기·요청 제출 0회 |

읽기 모듈에 쓰기 권한을 섞지 않았다. 별도 설정 진단은 선택한 A에 `model`/`effort`만 요청했으며 `thread/resume`, `turn/start`, 로그인·신뢰·보안 설정을 호출하지 않았다. 공식 공유 연결의 오류 10050은 새 근거 없이 재시도하지 않았다. 위 거절 뒤 동일 변경도 반복하지 않았다.

현재 준비된 8개 훅은 **관측 전용**이다. [공식 훅 규격](https://learn.chatgpt.com/docs/hooks#userpromptsubmit)의 동기 `UserPromptSubmit`에서 `additionalContext`를 돌려주는 지침 경로와 구분한다. 비동기 훅 출력은 첫 요청 전에 적용된다는 보장이 없으며 제어 결정을 할 수 없다. 따라서 첫 지침/계획 프롬프트는 별도의 동기 훅으로 전달 시점과 응답 이행을 검사해야 한다. 훅의 모델 입력 필드는 관측값이며 모델·추론·native Plan을 바꾸는 출력 규격으로 취급하지 않는다.

[정의별 신뢰 절차](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks)는 훅 파일 발견과 별개다. 아직 Desktop의 정확한 검토 항목이 보이는 경로를 확인해야 하므로 사용자에게 존재하지 않는 승인 버튼을 누르도록 요구하지 않는다. CLI `/hooks`는 공식 검토 경로지만 이번 진단에서 터미널을 열거나 신뢰를 대신 승인하지 않았다.

### 환경별 외부 제품 판정

아래 미검증은 호스트·제어 연결·신뢰·입력 보존 조건 때문에 실제 검사를 완료하지 못했다는 뜻이다. 이전 내부 도구/Computer Use 시험 결과를 배포 가능한 AutoPets 지원으로 승격하지 않는다.

| 환경 | 조회 | 실시간 이벤트 | 모델·추론 변경 | 실행 전 지침 | 실제 Plan | 계획 프롬프트 | 제출 보호 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Codex 로컬 | **검증됨**, 선택 ID metadata | 미검증: 훅 미신뢰 | 미검증: 공유 제어 미확보. 별도 서버 요청 거절 | 미검증: 동기 지침 훅·신뢰·실행 증거 필요 | 미검증: 설정 제어·파일 제한 시험 필요 | 미검증: 전달·이행 필요 | 미검증: 입력 식별·단일 제출 필요 |
| Work 로컬 | **검증됨**, Work 출처 별도 식별 | 미검증: 전용 활성 훅 없음 | 미검증: Work 설정 경로 필요 | 미검증: Work 훅 전달 필요 | 미검증 | 미검증 | 미검증 |
| Work 클라우드 | 미검증: 내부 시험 작업만 존재 | 미검증: 원격 훅 배치/통신 필요 | 미검증: 클라우드 기존 작업 제어 필요 | 미검증 | 미검증 | 미검증 | 미검증 |
| Chat 앱 | 조건부: 전용 화면/응답 접근, 외부 ID 미확인 | 미검증: 네이티브 관측 연결 필요 | 미검증: 독립 선택기만 관측 | 미검증: 입력/확장 경로 필요 | 미검증: 호스트 제공 여부도 별도 | 미검증 | 미검증 |
| Chat 웹 | 미검증: 별도 웹 로그인 필요 | 미검증 | 미검증 | 미검증 | 미검증 | 미검증 | 미검증 |

### 재현·재개

- 전체 Node `pnpm test`: **173/173 통과**. 연결/브라우저/metadata/턴 감사 독립 검사도 **38/38 통과**. 가짜 호스트의 보존·격리·중복 검사를 실서비스 제출 보호 성공으로 세지 않는다.
- 기존 runtime 조회: `node integrations/codex/scripts/runtime-inspection.mjs <절대-Codex-실행파일> <전용-프로젝트>`; 선택 작업 조회: `node integrations/codex/scripts/tasks-inspect.mjs <실행파일> <전용-프로젝트> <전용-targets-JSON>`.
- 기존 설치본 CI 재현: `gh workflow run windows.yml --ref feat/mvp-feasibility -f bootstrap_recheck_run=36175171683`. 만료된 artifact는 새 빌드가 필요하다. 자동 PR 전체 빌드는 하네스만 바뀐 중복 실행을 취소했고, 제품 검사는 원래 run과 동일 설치본 재검사 증거로 연결했다.
- 원본/턴 원장: Git 제외 `work/mvp-goal/20260925-minimum/`. `existing-settings-probe.json`, `after-existing-probe.json`, `hook-a-current.json`, `hook-b-current.json`, `hook-receiver-current.json`, `lifecycle-28d1f6c/result.json`에 분리했다.
- 다음은 정확한 정의의 호스트 검토 → A 실제 이벤트 수신 → B 격리 → 동기 지침 전달이다. 모델/Plan은 별도 제어 관문으로 남긴다. AI 예산은 이번 묶음 최대 누계 18/30, 전체 30을 유지하며 새 작업 보조/펫 단계로 넘어가지 않는다.

## 증거 수준

- 코드/합성 검사: 격리 규칙 검증. 실제 호스트 지원 증거가 아니다.
- 별도 App Server: 실행 파일의 프로토콜·모델·훅 발견 확인. 기존 Desktop 제어 증거가 아니다.
- 실제 Desktop/Work: 전용 시험 채팅에서 대상·설정·실행까지 확인한 범위만 인정한다.
- 실장비: 현재 PC에서 확인한 화면/설치 조건. 다른 PC에 확대하지 않는다.

| 항목 | 상태 | 결과와 다음 조건 |
| --- | --- | --- |
| 1 설치 수명주기 | 기존 통과 | [기록](current-pc-lifecycle.md). 관련 변경 때 회귀 검사 |
| 2 훅·대상 식별 | 원인 확인 / 실제 훅 대기 | 기존 프로젝트 계층이 신뢰되지 않아 제외됨. 시험 A/B 기본 응답만 확인 |
| 3 기존 채팅 라우팅 | UI 변경·다음 턴 관측 / 외부 앱 미통과 | A의 Sol High 선택 후 해당 턴의 런타임 설정 일치. 배포 가능한 외부 어댑터·3회 일치·A/B 실제 적용은 미완료 |
| 4 선행 지침·Plan·제출 | 미검증 | 텍스트와 첨부 식별, 실제 실행 제한 분리 |
| 5 펫·직접 복귀 | 미검증 | 네이티브 입력·위치·정확한 채팅 복귀 |
| 6 역할·내 펫·모델 자료 | 저장·재설치 보존 통과 / 실제 전달 대기 | 두 템플릿과 버전 저장·격리·Windows CI 통과. 공식 권장 작업 유형 자료 구현. 실제 전달·설정 적용은 미통과 |
| 7 선택창·확인 연출 | 미구현 | 선택창 좌표와 검증된 변경 이벤트 필요 |
| 8 계층·꾸미기·MCP | 꾸미기 저장·오버레이 연결 / 나머지 대기 | 노트·풀밭의 정확한 작업별 렌더링 격리 검사 통과. 계층·MCP와 꾸미기의 네이티브 입력 검사는 후속 |
| 9 통합·제품 판단 | 대기 | 가능한 경로를 합친 뒤 비교·자원·배포 검사 |

실제 AI 시험 원장: Git 제외 `work/mvp-goal/20260925-minimum/progress.json`. 시작 사용량 0/30. Jev, 별도 유료 API, AutoPets 계정과 자체 채팅 서비스는 추가하지 않는다.

## 2–3단계 첫 검사

환경: 현재 Windows `10.0.26200`, Desktop이 사용하는 `codex-cli 0.155.0-alpha.16`, 기반 `997a941` + 진단 도구 작업 변경. 설치 앱과 DB는 변경하지 않았다.

| 입력·예상 | 실제 결과 | 증거 수준·다음 조건 |
| --- | --- | --- |
| 같은 실행 파일에서 `config/read`로 기존 프로젝트 계층 확인 | `disabledReason`이 프로젝트 신뢰 필요를 명시. 기존 `.codex/hooks.json`은 있으나 `hooks/list`는 0건 | 별도 App Server의 활성 설정 진단. 프로젝트 및 정확한 훅 정의의 사용자 신뢰 검토 필요 |
| `features list`, `model/list` | hooks 기본값 true. 모델 7개와 각 추론 수준 반환, 다음 페이지 없음 | 가용성 조회만 확인. Desktop 설정 적용이나 실행 확인이 아님 |
| 공식 `app-server proxy`로 기존 서버 연결 | 기본 control socket에서 Windows 오류 10050 | 해당 경로 실패. 다른 공식/배포 가능 경로와 별도 서버 실행을 구분 |
| 전용 Desktop A/B 기본 응답 | 각각 `AP-A-READY`, `AP-B-READY`, 정상 종료. 실제 AI 2/30턴 | 내부 앱 도구로 시험 작업을 만든 결과. 외부 AutoPets 훅 수신 증거 아님 |
| 시험 A 모델 메뉴 관측·열기 | 스크린샷은 A/Astra Ultra, 접근성 트리는 이전 개발 작업을 반환하여 서로 불일치. 좌표 입력은 `SendInput sent 0 of 1 events; GetLastError=87` | 대상 확인 실패 시 자동 변경 금지 필요. 모델 변경·실행 적용 미검증 |
| 오류 뒤 화면 재관측 | 사용자가 물리 Esc로 Computer Use 중단 | 이후 화면 입력 없음. UI 검사는 사용자 재개 전까지 대기, 독립 코드 검사는 가능 |

실행 가능한 읽기 전용 재현 명령:

```powershell
node integrations/codex/scripts/runtime-inspection.mjs <절대-codex.exe-경로> <절대-프로젝트-경로>
```

이 도구는 초기화·설정/요구사항·훅/모델/협업 모드 조회만 수행하며, 새 턴·기존 작업 재개·신뢰 변경은 하지 않는다. 원본 설정·명령·인증값 대신 허용한 진단 필드만 출력한다. 공식 [훅 발견·신뢰 절차](https://learn.chatgpt.com/docs/hooks), [App Server 전송 방식](https://learn.chatgpt.com/docs/app-server#protocol)과 설치 실행 파일의 스키마를 대조했다.

관련 검사: `pnpm test` **161/161 통과**, 실패·건너뜀 0. 비밀값/훅 명령의 출력 제외, 조회 결과가 Desktop 지원 상태로 승격되지 않는 회귀 검사를 추가했다. 이번 변경은 진단 도구와 문서뿐이며 설치 앱·Rust·UI 제품 코드는 아직 변경하지 않았다.

## 6단계 역할 저장 구현 (2026-09-26)

이 후속 변경부터 Rust·UI 제품 코드가 변경되었다. 기존 설치 앱에는 아직 배포하지 않았다.

- 조사·문서 / 제작·구현의 지침·희망 계획/실행 설정·버전 고정 스킬을 선택·편집·저장한다. 초기 모델은 대상 작업 설정 유지다. 역할 화면의 모델 선택은 해당 연결이 보고한 가용 조합만 사용하며, 목록이 없으면 후보를 만들어내지 않는다.
- 같은 SQLite에 `pet_templates_v1`와 `pet_roles_v1`를 추가한다. 기존 테이블·앱 ID·경로를 바꾸지 않는다. 저장한 펫을 편집해도 이미 선택한 작업의 개정은 자동 교체하지 않는다.
- 작업 선택은 정확한 제공자/계정·출처 키/채팅 식별자를 사용한다. 모델은 희망값으로만 저장하고 호스트 변경은 수행하지 않는다. 실행 중 역할 변경을 거절하고, 역할 변경·끄기 시 기존 계획 승인과 지침 영수증을 무효화한다.
- 템플릿에는 작업 내용·진행·승인 필드가 없다. 선택한 대상의 기존 문맥은 보존한다. 수동 복사 지침은 UTF-8 3KB 이내이며 자동 전달·스킬 실행·native Plan 성공을 주장하지 않는다.
- 소품 1개(노트)와 배경 1개(풀밭)의 편집·미리보기·저장 필드를 추가했다. 실제 오버레이 반영은 별도 후속 작업이다.

검사 환경: Windows의 Node 24 / pnpm 11.19 / headless Chromium. `pnpm test` **163/163**, `pnpm build`, `pnpm verify:layout`, 전체 `pnpm test:ui` 통과. UI에서는 A/B 역할 선택, 꺼짐, 다른 작업 내용의 복사 제외, 알려진 모델/추론 선택, 800px 화면, 한국어 바이트 제한과 소품 미리보기를 검사했다. 실제 SQLite 검사와 설치/종료 회귀는 Windows CI에서 실행한다. 스킬 두 개의 `quick_validate.py`도 UTF-8 모드와 격리된 검사 의존성에서 통과했다.

남은 조건: 실제 재시작/저장 결과의 CI 확인, 연결별 지침 전달과 실제 모델 적용, 모델 비교 정보, 오버레이 꾸미기 및 나머지 7–9단계. 이 변경만으로 역할 경험 전체나 MVP 완성을 판정하지 않는다.

## Work와 Chat 범위 점검 (후속 사용자 요구)

현재 코드 확인: `work-local`은 연결 비활성·호환성 검토 상태다. `chatgpt-web`은 안내만 제공하고, Chrome 연결 코드는 로컬 앱 상태만 읽는다. 입력 보존 트랜잭션은 fixture용이며 실제 페이지 코드가 import하지 않는다. 일반 Chat 앱과 Work 클라우드는 별도 실증이 필요하다. 이 상태로 Work/Chat 자동 라우팅을 지원한다고 표시하지 않는다.

공식 [2026-09-22 모델 공지](https://learn.chatgpt.com/docs/changelog#codex-2026-09-22-gpt-6-sol-luna)도 Sol/Luna의 Work·Codex 가용성과 Chat 가용성을 구분한다. 따라서 Codex에서 조회한 7개 모델을 일반 Chat의 모델 목록으로 전용할 수 없다. 실제 목록·계정 접근·실행값은 각 환경에서 별도로 확인해야 한다.

### 독립 경로 검사 (2026-09-26)

환경: 현재 Windows, Node 24.14.1, 기반 `997a941`와 작업 변경. 전체 goal은 현재 일시정지이며 이 후속 요청에서는 문서·코드·격리 검사만 수행했다. GUI, 계정, 훅 신뢰, 설치 앱을 변경하지 않았고 실제 AI 시험은 추가 없이 **2/30턴**이다.

| 대상 | 확인한 사실 | 현재 판정과 다음 최소 검사 |
| --- | --- | --- |
| Work 로컬 | 공식 훅 런타임 대상에 Work가 포함된다. AutoPets `work-local`은 아직 비활성이다 | 연결 후보는 존재. 전용 Work 작업에서 호스트/작업 ID·시작/도구/완료 수신, 지침 전달을 실제로 확인해야 함. 모델/추론/Plan 제어는 별도 |
| Work 웹·클라우드 | 웹 플러그인 설치만으로 실행 환경에 훅 스크립트가 배포되지 않는다 | 스크립트 배치·신뢰·통신 가능한 실행 환경부터 확인. 로컬 PC의 루프백 브리지에 자동 연결된다고 가정하지 않음 |
| 일반 Chat 웹 | 일반 Chat에는 Codex/Work용 훅을 전용할 수 없다. MCP UI는 도구 결과 표시·도구 호출·후속 메시지 경로를 문서화한다 | 역할 카드/도구의 후보 경로는 존재. 기존 채팅의 모델 제어·첫 실행 전 개입·전체 진행 관측을 증명하지는 않음. 브라우저 확장의 정확한 대상 식별과 입력 보존부터 실증 |
| 일반 Chat 앱 | 위 브라우저 확장은 Chrome용이며 네이티브 앱 연결부는 없다 | 앱의 접근성/UI 경로를 별도 검사. 웹 결과를 상속하지 않음 |

근거: [공식 플러그인과 훅 범위](https://learn.chatgpt.com/docs/plugins#use-plugins-from-a-supported-surface), [일반 Chat의 훅 제한](https://developers.openai.com/plugins/guides/submit-claude-plugin#review-what-openai-supports-1), [MCP UI 경로](https://developers.openai.com/plugins/build/chatgpt-ui). [환경별 권한 경계](https://learn.chatgpt.com/docs/enterprise/work-admin-faq#how-are-runtime-and-network-boundaries-governed)도 Work Local·Work Cloud·Codex Local을 구분한다. 이 문서 확인은 현재 계정의 실제 가용성이나 외부 AutoPets 제어 성공을 뜻하지 않는다.

재현 명령: `node --test integrations/chatgpt/tests/*.test.mjs packages/contracts/tests/connections.test.mjs` → **32/32 통과**, 실패·건너뜀 0. 원문/첨부 보존, IME·편집·대상 변경 시 취소, 중복 전달 거절, Native Messaging 프레이밍·출처 검사, 미검증 기능 비활성, 패키지 독립 실행을 격리 환경에서 확인했다. 실제 content script는 상태 조회만 하며 이 입력 트랜잭션을 호출하지 않는다. 따라서 이 결과를 Chat의 자동 지침·모델 변경·제출 보호 통과로 계산하지 않는다.

최소 실환경 순서: (1) 전용 대상 A/B의 환경·작업·출처 식별, (2) 진행/완료의 수신 경로, (3) 가용 설정 조회와 한 설정 변경·재조회, (4) 역할 지침 전달과 한국어/첨부 보존, (5) 정확한 기존 작업 복귀와 펫 연결. 변경 경로가 없으면 수동 안내만 가능한지 별도로 기록한다. Work와 Chat 모두 이 결과를 얻기 전 지원 완료로 표시하지 않는다.

## 역할 전달·오버레이 연결 후속 구현

기반 구현 `4f2999e`의 Windows 검사 [36155906792](https://github.com/swaan-kim/autopets/actions/runs/36155906792)를 시작했다. 결과 확정 전에는 통과로 계산하지 않는다.

- HTTP 읽기는 검증된 Codex 세션 바인딩의 역할만 반환한다. 지침 준비는 정확한 제공자/출처/채팅과 개정에 연결하고, 기존 설정 CAS로 읽은 뒤 역할이 바뀐 요청을 거절한다. 역할 선택이 꺼져 있거나 실제 전달 capability가 미검증이면 자동 전달을 활성화하지 않는다.
- 지침 전체를 UTF-8 3KB로 제한하며 역할 원문을 자르지 않는다. 역할·단계·문맥이 함께 들어갈 때 기록 helper가 넘치면 선택적 helper를 생략한다. 생략한 계획/문맥은 기존 부분 전달 필드로 표시한다. 훅 출력은 실제 응답의 지침 이행이나 native Plan 증거가 아니다.
- 사용자 모델 지정은 고정된 모델/세대 별칭 대신 해당 연결에서 확인한 모델 목록의 정확한 ID만 인식한다. 가용성 미검증·중복 ID·모호한 별칭은 자동 적용 대상으로 삼지 않는다.
- 저장한 노트/풀밭을 실제 오버레이 렌더링 경로에 연결했다. 역할 미리보기와 같은 컴포넌트를 사용하며 정확한 작업·출처 일치가 없으면 표시하지 않는다. 장식은 펫 클릭 영역 안에 있고 포인터 입력을 받지 않는다. 네이티브 투명 영역 통과는 별도 실환경 검사다.
- 설치 수명주기 CI를 실제 역할 저장 버튼으로 만든 SQLite 레코드까지 재시작·제거·재설치 전후 비교하도록 확장했다. 이 검사는 다음 설치본에서 실행해야 한다.

로컬 검사: Node **166/166**, 프런트엔드 빌드, 전체 headless UI 검사(페이지 오류 0), PowerShell 구문 검사 통과. 역할 원문 보존·중복 방지·A/B 격리·출처 변경·변경 경쟁·오버레이 클릭을 검사했다. Rust HTTP 역할 검사와 확장한 네이티브 CI는 결과 대기다.

사용자가 전용 시험 작업에서 화면 검사 재개를 명시적으로 승인했다. 이전 Esc 중단은 해제되었다. 아래 후속 검사와 최신 로컬 원장이 현재 상태다.

## Windows 설치본 회귀 결과

소스·하네스 `826af682acbfcf9853f700513bc60fb751387ad1`, [CI 36157233890](https://github.com/swaan-kim/autopets/actions/runs/36157233890) **성공**. 선행 `4f2999e`의 [CI 36155906792](https://github.com/swaan-kim/autopets/actions/runs/36155906792)도 성공했으나, 실제 역할 저장 버튼을 포함한 검사는 `826af68` 결과다.

- Node 166건, 렌더링 UI, 빌드 통과. Windows Rust 105건 통과, 합성 데이터 설치용 1건은 일반 테스트에서 의도적으로 ignored다. 역할 저장 재열기·A/B 격리·실행 중 변경 거절·롤백과 HTTP 출처 격리 검사가 포함된다.
- 새 설치 → 첫 화면 → 실행 중 재호출 → X로 숨김 → 재호출 → 역할 저장 → 정상 종료 → 재시작 → 덮어쓰기 → 제거 → 재설치 → 재실행 통과. 정상 종료에 강제 종료를 사용하지 않았고 프로세스 0, 포트 닫힘, 연결 파일 제거를 확인했다.
- 실제 UI에서 저장한 역할 1개를 포함한 레코드·설정·위치가 재시작 전후 동일했다. 제거·재설치 직후 보존 데이터도 바이트 단위로 동일했고 SQLite 무결성은 `ok`였다. 스크린샷의 저장 완료 문구도 확인했다.
- 실측: 설치 24.282초, 첫 화면 4.677초, 정상 종료 0.809초, 제거 1.162초, 재설치 23.233초. 설치기 243,294,142바이트, 설치 프로그램 111,901,998바이트. 설치기 SHA-256 `3a4d8f26733cd6b6347f92c0b0a6da819f65233efd61b6c07a89c39985cf36cd`, 서명 `NotSigned`.
- 범위: GitHub-hosted Windows의 관리자 권한 runner, 개발 도구를 PATH에서 제외한 실행이다. 일반 사용자 권한·개발 도구가 전혀 없는 별도 PC·현재 PC의 새 설치본 성공은 증명하지 않는다. 기존 현재 PC 설치본은 유지했다.

## Codex·Work·Chat 실환경 후속 (2026-09-26)

환경: Windows 10.0.26200, `OpenAI.Codex 26.917.6896.0`, 로컬 런타임 `0.155.0-alpha.16`. AutoPets 제품 코드 `826af68`; 아래 동작은 Computer Use와 내부 진단 도구로 수행했으며 AutoPets의 배포 가능한 제어 어댑터를 통한 실행은 아니다.

| 최소 입력·예상 | 실제 결과 | 증거 범위·남은 조건 |
| --- | --- | --- |
| Codex A에서 모델과 같은 모델의 추론을 각각 변경하고 다음 요청 실행 | Astra Ultra → Sol Ultra → Sol Extra High → Sol High 관측. 합성 요청 1회, `AP-A-ROUTE3` 응답. 해당 턴의 로컬 `turn_context`도 `gpt-6-sol/high/default`, 완료 기록 | UI 변경의 가능성과 호스트가 다음 턴에 사용한 설정을 확인. 서버가 실제 해석한 모델·외부 AutoPets 어댑터 성공은 미확인. A/B 각각 실행·3회 일치 기준은 아직 미충족 |
| 시험 후 원래 설정 복원, B 격리 확인 | Ultra 복원 중 전체 액세스 경고를 만나 자동 승인하지 않았다. 이후 새 관측에서 A의 Astra Ultra 복원과 경고 없음, B도 Astra Ultra 유지 확인 | 경고를 우회하지 않았음. B의 후속 실행값 확인은 별도 |
| 일반 Chat 앱의 독립 선택기와 한국어 여러 줄 요청 | Chat/Work 전환을 확인. Chat 목록은 최신/GPT-5.6 Sol/GPT-5.5, 파워 선택기는 6 Pro와 5단계 표시. 전용 새 채팅에 합성 요청 1회, `AP-CHAT-APP-READY` 응답 | 일반 Chat 앱 접근·요청·응답 가능. 로컬 Codex 7개 모델 목록을 전용하지 않음. 정확한 기존 채팅 ID·실행 모델의 외부 관측, 첨부 보존, 선행 개입은 미검증 |
| Work 로컬에서 지정된 합성 파일 하나 읽기 | 실행 위치 메뉴의 ‘내 컴퓨터에서’ 선택, 새 전용 작업에서 파일 읽기 도구 1회(종료 코드 0), `AP-WORK-LOCAL-READY` 응답. 런타임 설정 Astra Ultra, 완료 | 내부 앱 목록은 kind=codex였으나 해당 시험 파일의 런타임 originator는 `codex_work_desktop`. 공통 kind만으로 Codex/Work 지원을 합칠 수 없음. AutoPets의 훅 수신·설정 제어는 미통과 |
| Work 클라우드 전용 작업 생성·응답 | 내부 앱 도구의 `chatgptWorkCloud` 경로로 생성, `AP-WORK-CLOUD-READY` 응답과 완료 확인 | 현재 계정에서 클라우드 시험 작업 실행 가능. 외부 AutoPets의 기존 채팅 제어·훅 배포·로컬 브리지 통신·웹 UI 검증과는 별개 |
| 일반 Chat 웹 접근 | 독립 인앱 브라우저에서 로그인 화면 도달. Chrome용 브라우저 연결은 사용할 수 없었음 | 앱 로그인과 웹 세션은 별개. 로그인 후 전용 웹 채팅으로 별도 실증 필요. 새 계정·인증 우회 없음 |

현재 UI 자동화의 한계: 화면과 접근성 트리가 서로 다른 작업·이전 상태를 반환했고, 접근성 클릭이 바로 효과를 내지 않거나 관측에 지연이 있었다. 스크린샷과 실제 응답/런타임을 대조해 검사했으며, 불명확한 제출을 재전송하지 않았다. 안정된 정확한 대상 ID, 입력 보존, 변경 재조회가 제품 연결 경로에서 입증되기 전에는 자동 제어·보류 기능을 활성화하지 않는다. 이 실험은 주기적으로 AI에 화면을 보내는 제품 추적 방식을 도입한 것이 아니다.

Work 로컬 시험 폴더를 같은 실행 파일의 별도 읽기 전용 App Server로 조회했을 때 `hooks/list`는 0건, 오류/경고도 0건이었다. 첫 기존 프로젝트의 신뢰 문제와 이 ‘시험 폴더에 활성 훅 없음’을 같은 원인이라고 단정하지 않는다. 실제 AI 시험 누적 **6/30턴**, 재시도 제출 0건. 모델·지침·첨부·이벤트 등의 후속 기능은 각 환경에서 독립적으로 실증해야 한다.

진단 도구 `integrations/codex/scripts/turn-selection-audit.mjs`는 **사용자가 지정한 전용 시험 로그와 정확한 채팅 ID**만 읽고 모델·추론·모드·완료·알려진 출처만 추린다. 전체 대화·도구 인수·인증값을 내보내지 않는다. 출처 미상, 잘린 입력, 서로 다른 ID/설정/출처는 확인 성공으로 처리하지 않는다.

```powershell
node integrations/codex/scripts/turn-selection-audit.mjs <절대-시험-jsonl-경로> <정확한-시험-채팅-UUID>
```

## 모델 정보 최소 구현

`826af68` 이후 변경. ‘공식 권장 작업 유형’ 한 축으로 Sol과 Luna의 자료를 역할 선택 화면에 연결했다. 출처는 [OpenAI의 2026-09-22 발표](https://learn.chatgpt.com/docs/changelog#codex-2026-09-22-gpt-6-sol-luna), 자료 확인일은 2026-09-26이다. 제공사 안내이며 AutoPets의 성능 실험은 없다고 명시한다. 정확한 모델 ID와 환경에 맞는 자료만 표시하고, 모델 변경 시 바꾸며, 누락·별칭·다른 환경은 미확인이다. 30일 후에는 오래된 자료로 표시하고 비교 문구를 숨긴다. 점수·성능 순위·절감률·스킬 효과·가용성이나 실행 지원은 이 자료에서 추론하지 않는다.

로컬 Node **168/168**, 전체 headless UI 검사(페이지 오류 0), 프런트엔드 빌드, 레이아웃·문서 링크 검사 통과. 날짜 고정 UI 검사에서 Sol→Luna→오래된 자료→누락 모델 전환을 확인했다. 설치본 회귀는 이 변경을 포함한 별도 CI 결과로 후속 기록한다.

## 자원 측정 준비

Windows 수명주기 CI에 설치 앱 프로세스와 관측된 WebView 자식 프로세스의 9회 표본을 추가했다. 작업 없는 관리자 화면과 합성 작업 펫 상태를 각각 측정한다. CPU는 전체 논리 코어로 정규화하고, 표본의 프로세스 ID/시작 시각 집합이 바뀌면 수치를 미확인으로 남긴다. 메모리는 private bytes와 working set 합을 구분하며 후자는 공유 페이지를 중복 계산할 수 있다. 표본 사이에 생성·종료된 짧은 프로세스는 놓칠 수 있다. 수치가 나온 뒤에도 이 단일 CI 환경을 일반 PC 성능이나 실제 AI 작업 부하로 확대하지 않는다. 측정 스크립트 구문 검사는 통과했으며 실행 수치는 다음 CI에서 확인한다.

## e242f55 Windows 결과와 자원 실측

[CI 36164736372](https://github.com/swaan-kim/autopets/actions/runs/36164736372), 소스/하네스 `e242f55fce41dff4fa0fe5493f5b1ec784f07111` **성공**. Node 168건, Rust 105건(합성 데이터 준비용 1건 ignored), 화면 검사·설치·재호출·X 숨김·정상 종료·재시작·덮어쓰기·제거·재설치 통과. 역할 저장은 실제 UI 버튼으로 수행했으며 기록/설정/위치와 SQLite 무결성을 확인했다. 제거·재설치의 보존 파일은 바이트 단위로 동일했다. 강제 종료는 사용하지 않았다.

설치 24.254초, 첫 화면 5.272초, 첫 정상 종료 0.804초, 제거 1.166초, 재설치 23.236초. 설치기 243,340,395바이트, 프로그램 112,102,903바이트. 서명 `NotSigned`, 설치기 SHA-256 `05ef2b1e488bfa9bed862ee82e62d2c7e5333a4d5f7084410c8d38a966d4689d`.

| CI 상태 | 전체 4코어 대비 CPU | 최대 private bytes | 최대 working set 합 |
| --- | ---: | ---: | ---: |
| 첫 화면 후 작업 없음 | 1.779% | 228,610,048 | 583,245,824 |
| 관리자 화면 + 합성 진행 펫 | 1.498% | 234,307,584 | 604,798,976 |

각 8.346초/9표본이며 프로세스 집합은 안정적이었다. AutoPets와 WebView 자식을 합산했다. 시작 직후의 짧은 표본이므로 장시간 안정 대기 성능이나 애니메이션의 추가 비용을 뜻하지 않는다. 작업 부하 차이의 통계 비교도 아니다. 관리자 권한의 GitHub runner라는 범위와 working set 공유 페이지 중복 가능성은 그대로다.

## 5단계 작업 복귀의 최소 구현과 차단

기반 `e242f55` 후속 코드. 공식 [기존 로컬 작업 링크](https://learn.chatgpt.com/docs/reference/commands#deep-links)는 `codex://threads/<thread-id>`다. 현재 설치 패키지 manifest의 `codex` 프로토콜 등록도 읽기 전용으로 확인했다.

- 관리자 작업 카드와 펫에서 로컬 작업 열기 요청을 구현했다. 등록된 작업·정확한 UUID·같은 Windows 프로젝트 경로를 검증한다. 새 작업 링크, 임의 URI/쿼리/명령, 미등록 ID, 원격 경로와 바뀐 출처는 거절한다.
- Windows에 URI를 전달할 뿐 모델 호출·입력 제출·설정 변경은 없다. 응답은 `dispatched`, `targetVerified=false`이고 기존 `taskReturn=manual` 지원 판정을 승격하지 않는다. 제품에는 시험 기능으로 표시하고 ID 복사 안내를 유지한다. 다른 작업으로 바뀐 뒤 도착한 안내는 표시하지 않는다.
- 현재 PC의 전용 A 링크를 로컬 시험 페이지에서 실행하려 했으나 **Browser Use 보안 정책이 내비게이션을 차단**했다. OS/다른 브라우저/간접 실행으로 우회하지 않았다. 따라서 실제 외부 복귀 및 정확한 도착 ID 확인은 미통과다. 공식 문서·프로토콜 등록·명령 구현·fixture 결과와 구분한다.
- Node 168건, 빌드, 전체 UI 검사(페이지 오류 0), 문서/레이아웃 검사 통과. UI는 A/B 상태 불변, 정확한 대상 전달, 실패 시 ID 복사, 다른 ID 응답 거절, 펫 요청을 검증했다. 새 Rust 검사 2건과 설치본 회귀는 후속 Windows CI에서 확인한다.

## 2단계 전용 A/B 훅 발견 개선

현재 PC의 기존 실행 앱 DB는 읽기 전용 SQLite 온라인 백업, 위치와 연결 파일은 로컬 복사로 보존했다. 그 뒤 전용 A/B의 기존에 없던 `.codex/hooks.json`에 관측용 8개 정의만 준비했다. 전역 설정·일반 프로젝트·신뢰 DB는 변경하지 않았다.

같은 `0.155.0-alpha.16` 런타임의 별도 읽기 전용 App Server에서 A/B 각각 프로젝트 계층 활성, 훅 8건 발견, `enabled=true`, **`trustStatus=untrusted`**, 오류/경고 0을 확인했다. 기존 프로젝트의 계층 비활성과 달리 이번에는 정의 발견까지 성공했다. 실제 Desktop 이벤트 수신은 아직 0건이며 AI 시험은 계속 6/30턴이다.

사용자 신뢰 검토 전에 실제 Desktop 검토 화면을 확인한 결과, 현재 원래 개발 작업 범위의 설정→Hook은 ‘훅을 찾을 수 없음’이었다. 전용 A/B 작업 범위의 UI 발견은 다음 확인 대상이다. 사용자에게 아직 표시되지 않은 항목을 승인하도록 요구하지 않는다. `untrusted`는 별도 서버의 구체적인 차단 조건이지만 Desktop에서도 동일 목록이 보인다는 뜻은 아니다. 검토용 파일·원본 진단·백업은 Git 제외 경로에 보존하며 시험 종료 때 해당 시험 정의를 복원한다.

후속 Desktop 관측: 전용 A 작업의 설정→Hook에서도 목록이 비어 있었다. 시험 A/B 폴더는 저장된 프로젝트 목록에 없었다. 파일→폴더 열기로 정확한 A 시험 폴더를 선택하자 **Trust this folder?** 권한 안내가 표시되어 사용자에게 넘겼다. 이 안내는 해당 폴더의 읽기·수정·실행 및 폴더 설정의 자동 실행을 허용하는 것이며 단순 알림 동의가 아니다. 직접 승인하지 않았고, 폴더 신뢰와 개별 훅 신뢰·실제 전달은 별도 관문이다. 이후 화면과 접근성 트리가 서로 다른 작업/대화 상자를 반환하여 오래된 접근성 결과만으로 현재 권한 상태를 판정하지 않았다. 폴더 미등록이 빈 목록의 유일 원인이라는 결론도 아직 내리지 않는다.

## 8단계 도구 실행 기록과 MCP 소품

기반 `901abf4` 후속 구현. 기존 `lastTool`만으로 도구가 끝난 뒤에도 ‘사용 중’으로 표시할 수 있었으므로, 같은 작업·턴의 도구 호출 ID별 시작/종료/오류를 저장한다. 기존 supervision JSON에 선택적 `toolActivityV1`을 추가하며 SQLite 테이블과 기존 이벤트 입력은 유지한다. 도구 인수·응답 원문은 수집하지 않는다.

- 병렬 호출은 호출별 시각으로 처리하여 다른 호출의 나중 이벤트가 앞선 호출의 종료를 지우지 않는다. 중복과 뒤늦은 시작은 완료 상태를 되돌리지 않는다. 이름·결과가 충돌하면 확인 필요로 고정한다.
- 완료는 실행 종료의 관측이며 결과 품질의 성공을 뜻하지 않는다. 턴 종료·앱 재시작·연결 해제 때 결과를 못 받은 호출은 확인 필요로 남긴다. 새 턴과 바뀐 출처에는 이전 도구 사용 상태를 옮기지 않는다. 기록은 턴당 64개로 제한하고 누락 가능성을 표시한다.
- 작업 상세는 사용 중/실행 완료/실행 실패/확인 필요를 구분한다. MCP 형식의 도구 이벤트가 있을 때만 펫 소품을 표시한다. 도구 연결·사용 가능 여부는 별도 미확인이며 가용성만으로 사용 중 표시하지 않는다. 모든 호출이 끝났다면 도구 작업 모션도 계속하지 않는다.

입력은 합성 A/B 이벤트와 UI fixture다. 실제 호스트의 MCP 수신 및 네이티브 입력 통과는 미검증으로 남긴다. 검사 명령은 `pnpm test`, `pnpm test:ui`, `pnpm build`, `pnpm verify:layout`, Windows의 `pnpm test:rust`다. 이번 소스의 검사 결과는 아래 후속 기록으로 확정한다.

로컬 결과: Node **168/168**, 빌드, 전체 headless UI(페이지 오류 0), 레이아웃·문서 링크 검사 통과. UI는 병렬 도구의 완료/실패 전환, MCP와 일반 도구의 분리, 연결 해제 시 확인 필요, 기존 기록에 소품을 임의 생성하지 않음, 클릭 영역 내부·포인터 비간섭 및 도구 모션 종료를 확인했다. 최초 UI 검사의 실패는 동일 문구가 카드와 상세에 모두 있어 선택자가 모호했던 것으로 상세 범위를 지정해 수정했다. 렌더링된 상세와 펫 스크린샷도 확인했다. Rust의 호출별 순서·중복·충돌·저장/재열기·롤백·64개 제한 검사 5건과 기존 DB 회귀 검사는 별도 Windows CI 결과 대기다.

## 901abf4 Windows 회귀 확정

[CI 36166959226](https://github.com/swaan-kim/autopets/actions/runs/36166959226) **성공**. 소스/하네스 `901abf441af73a2dd0747c83cd58410452c435e5`, Node 168건, Windows Rust 107건 통과(설치 합성 seed 1건 ignored). 작업 복귀의 대상·경로 검증 테스트가 포함되지만 실제 외부 앱으로 도착한 결과는 아니다.

실제 역할 저장, 설치·재호출·X 숨김·정상 종료·재시작·덮어쓰기·제거·재설치 통과. 강제 종료 없이 프로세스 0, 로컬 포트 닫힘, 연결 파일 제거를 확인했다. 기록·설정·위치 보존과 SQLite 무결성 `ok`, 제거·재설치 보존 파일의 바이트 동일 및 AI 설정 불변을 확인했다.

설치 25.225초, 첫 화면 10.300초, 정상 종료 0.816초, 제거 2.153초, 재설치 22.254초. 설치기 243,351,658바이트, 프로그램 112,135,671바이트, 서명 `NotSigned`, 설치기 SHA-256 `4db384393c93d66a0e83b5a1bb2a1385f92cedc3fea5edec42165f1fbed530a3`. GitHub 관리자 Windows runner의 결과이며 현재 PC의 새 설치본이나 개발 도구 없는 일반 사용자 PC로 확대하지 않는다. 이후 도구 실행 기록 변경은 이 성공 결과에 포함되지 않는다.
