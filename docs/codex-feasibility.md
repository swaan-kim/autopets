# Codex Desktop 연결 검증 기록

> **이전 설계의 역사적 기록입니다.** 아래는 2026-09-09의 승인 연결 실험이며 현재 v1 제품 계약이 아닙니다. v1은 직접 승인을 제외했습니다. 최신 범위와 결과는 [검증 기록](acceptance.md)과 [프로토콜](protocol.md)을 확인하세요.

2026-09-09 기준. **로컬 어댑터와 설치된 Codex의 설정 조회는 검증했지만, 실행 중인 Desktop과 실제 권한 승인 왕복은 아직 검증하지 않았다.** AutoPets의 권한 제어 기본값은 꺼짐이다.

## 확인한 사실

| 대상 | 증거와 결과 | 판단 범위 |
| --- | --- | --- |
| 설치된 CLI | Codex `0.153.4`; 현재 환경의 hooks 기능 활성화 확인 | Desktop에서 이벤트가 발생했다는 증거는 아님 |
| 공식 이벤트 계약 | 공식 Hooks 문서에서 입력 필드, PermissionRequest 반환, 비동기 관측, Stop 빈 JSON 처리 확인 | 실행 중인 앱 버전의 실제 동작은 별도 검증 필요 |
| 어댑터 | Node `24.14.1`; 실제 child process와 인증된 loopback 시험 서버로 17개 테스트 통과 | 시험 서버 결과이며 실제 Codex 도구 실행 없음 |
| Windows 명령 | 생성된 PowerShell EncodedCommand를 실제 실행; 한글·공백·작은따옴표 연결 경로 성공 | 설치 명령의 인자 전달 확인 |
| 설치된 runtime 조회 | `app-server --stdio`, `initialize` → `initialized` → `hooks/list` 성공 | 별도 설치 runtime 프로세스의 설정 검색·trust 조회 |
| 초기 프로젝트 조회 | `outputs/autopets` 기준 hook 0개, 오류 0개, 경고 0개 | 이 조회 시점에는 AutoPets 훅 미등록 |
| 프로젝트 훅 설치 후 | `.codex/hooks.json` 파일에 8개 AutoPets 훅을 등록하고 checker complete=true 확인. 연결 파일은 아직 없음. 재조회 hooks/list는 여전히 0개 | 해당 runtime에서 프로젝트 훅이 활성 검색되지 않음. 파일 등록과 실행 가능 여부를 구분해야 함 |
| 프런트엔드 | 타입 검사·프로덕션 빌드·브라우저 UI 검사 통과 | Native overlay 동작은 미검증 |
| Rust/Native | 의존성 resolve와 rustfmt 통과. MSVC/Windows SDK 설치와 한글 경로 환경 로딩 완료. MSVC release 컴파일 중 `generic-array` build-script 실행이 Windows 앱 제어 정책 `4551`로 차단됨 | Rust 타입 검사·17개 테스트·exe 빌드 모두 미완료 |
| Desktop 이벤트 관측 | 아직 없음 | 미검증 |
| Desktop 허용·거절·30분 이관 | 아직 없음 | 미검증 |
| 관리 정책·자동 검토와의 실제 순서 | 아직 없음 | 미검증; 어떤 설정도 우회하거나 변경하지 않음 |

문서 출처: [공식 OpenAI Hooks 문서](https://learn.chatgpt.com/docs/hooks). 테스트가 통과했다는 사실을 Desktop 통합 성공으로 표시하지 않는다.

## 재현 가능한 조회

프로젝트 소스 루트에서 다음 명령을 사용한다. 경로는 실제 절대 경로로 바꾼다.

```powershell
node scripts/check-hooks.mjs --project '<PROJECT_ABSOLUTE_PATH>' --connection '<CONNECTION_JSON_ABSOLUTE_PATH>'
node scripts/feasibility-probe.mjs --project '<PROJECT_ABSOLUTE_PATH>'
```

`check-hooks`는 파일만 읽는다. `feasibility-probe`는 설치된 Codex 실행 파일을 stdio로 띄워 설정 목록만 읽고 종료한다. `--codex`로 실행 파일의 절대 경로를 지정할 수 있다. 20초 내 응답이 없으면 종료하며, 출력에는 훅 event/source/trust/enabled 정보만 넣는다. 명령 전문·token·raw 진단 문구는 출력하지 않는다. 오류는 경로와 안전한 분류로 표시한다.

`hooks/list`의 빈 목록은 이벤트가 올 것이라는 뜻이 아니다. `untrusted`/`modified`는 사용자 검토가 필요하다는 뜻이다. 이 도구는 trust 승인, 프로젝트 신뢰 설정, 모델 턴 생성, 정책 변경을 하지 않는다.

## Desktop 검증 절차

1. 무해한 파일만 있는 별도 테스트 프로젝트에서 AutoPets를 실행한다. 실제 연결 파일 경로를 확인하고, 해당 프로젝트에 대한 설치 dry-run 결과를 검토한다.
2. 프로젝트 `.codex/hooks.json`에 AutoPets 항목을 등록한다. 기존 훅은 보존된다. 훅 정의와 프로젝트 신뢰는 Codex의 사용자 검토 흐름에서 확인한다. 자동 trust 승인은 제공하지 않는다.
3. `feasibility-probe`로 8개 AutoPets 이벤트의 검색·trust 상태와 오류를 확인한다. Desktop이 이 설정을 사용하는지 별도 확인한다. 이 단계에서 검색이 안 되거나 신뢰 흐름을 사용할 수 없으면 권한 제어를 켜지 않는다.
4. Desktop에서 짧은 일반 응답을 요청해 작업 감지, 작업당 펫 배정, 진행 중, 응답 도착, 확인 후 대기를 검증한다. 관측 원문은 저장하지 않는다.
5. 범위를 검토한 테스트 작업에 한해 권한 제어를 켜고 실제 권한 요청을 만든다. 무해한 출력 또는 지정한 테스트 파일 생성으로 허용 후 실행 여부를 확인한다. 거절의 경우 그 보호된 동작이 실행되지 않았는지 확인한다.
6. 미배정 작업, 제어 꺼짐, 앱 종료, 앱 재시작, 연결 중단에서 원래 Codex 승인으로 이어지는지 확인한다. 두 작업과 한 작업의 여러 요청을 구분해 각각 처리한다.
7. 실제 요청을 30분간 처리하지 않고 Codex 승인으로 넘기는지 확인한다. 이전 펫 카드가 다시 승인할 수 없는지 확인한다. 시험 서버에서 즉시 만료시킨 테스트로 이 절차를 대체하지 않는다.

필수 왕복을 통과하기 전에는 Desktop 통합을 검증 완료로 표시하지 않는다. Desktop에서 훅 전달 또는 승인 결과 적용이 불가능하면 그 제한을 기록하고 권한 제어를 끈 채 유지한다.

## 어댑터의 안전한 실패 동작

- 인증된 `127.0.0.1` HTTP만 사용하며 리디렉션을 따라가지 않는다. UI의 승인 결정은 Tauri IPC에서 처리한다.
- 요청 UUID는 한 번 만들고 등록 재시도에서 유지한다. 다른 세션·턴의 결정을 재사용하지 않는다.
- 미배정·제어 꺼짐·연결 실패·만료·알 수 없는 입력에서 `{}`를 반환한다. 직접 허용하거나 차단하지 않는다.
- 권한 판단 내용은 원문 전체를 메모리로 전달한다. 128 KiB를 초과하는 상세 내용은 잘라서 승인하지 않고 Codex로 돌려보낸다.
- 승인 카드 만료는 서버의 30분 시각을 따른다. 어댑터 상한 1,830초, Codex hook 상한 1,860초이며, 45초 lease가 끊기면 이전 요청은 무효화된다.
- 관측 훅의 stdout은 `{}`다. 프롬프트·응답·도구 결과를 모델 context로 재삽입하지 않는다. SessionEnd는 공식 계약에 따라 동기 3초 제한을 사용한다.
- `/returned`는 어댑터가 결정을 수신했음을 뜻한다. 실제 도구 실행이 끝났다는 증거는 아니다.

## 검증 기록에 남길 항목

날짜, Desktop/CLI 버전, 테스트 프로젝트, 실제 수신 이벤트 종류, 요청별 허용·거절·이관 결과, 보호 동작 실행 여부, 정책과의 동작 순서, 재시작 후 오래된 승인 무효화 결과를 남긴다. 명령 전문·token·사용자 대화 내용은 기본 기록에서 제외한다.
