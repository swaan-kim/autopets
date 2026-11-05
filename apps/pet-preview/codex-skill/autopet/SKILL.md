---
name: autopet
description: 실험용 AutoPets 테스트 펫(원형)을 Windows 화면에 띄우거나 숨기거나 닫고, 펫에서 고른 작업(발표자료 만들기)을 이 채팅에서 이어서 실행한다. 사용자가 /오토펫, /autopet, $autopet 으로 이 스킬을 직접 호출했을 때만 사용한다. 기존 autopets 스킬·앱·훅과는 별개다.
---

# 오토펫 (실험용 테스트 펫)

화면 오른쪽 아래에 작은 원형 테스트 펫을 띄운다. 사용자가 펫에서 기능을 고르고 '제작 시작'을 누르면, 그 작업은 **이 채팅의 이 턴에서** 실행된다. 별도 세션을 만들지 않는다.

이 `SKILL.md`와 같은 폴더의 `bin\autopet-preview.exe`만 실행한다. 다른 경로를 만들거나 다운로드·빌드하지 않는다. 아래 펫 명령(`show`·`wait`·`ask`·`done`·`fail`·`hide`·`quit`)은 모두 사용자의 데스크톱 펫과 통신해야 하므로 처음부터 **샌드박스 밖 실행 승인**을 요청해서 실행한다 (셸 도구의 `sandbox_permissions: "require_escalated"`). 샌드박스 안에서 실행해 `"state":"sandboxed"`가 나오면 같은 명령을 승인 요청과 함께 한 번만 다시 실행한다. 승인 정책이나 Windows 보안을 우회하지 않는다. 승인을 요청할 수 없거나 거부되면 실행하지 않았다고만 알린다. 명령 출력은 ASCII JSON 한 줄이며 한국어는 `\uXXXX`로 적혀 있다.

## 1. 펫 띄우기·숨기기·닫기

- 요청이 없거나 "띄워줘·불러줘·보여줘"이면 인수 없이 실행한다 (`show`). 사유: "AutoPets 테스트 펫 창을 바탕화면에 표시"
- "숨겨줘"면 `hide`, "닫아줘·꺼줘·종료"면 `quit` 인수 하나만 붙인다. 이때는 결과를 한 문장으로 알리고 끝낸다 (2단계 없음).

예: `& "<이 스킬 폴더>\bin\autopet-preview.exe"`

결과가 `ok: false`이면 `message`를 그대로 전하고 끝낸다. 실행 파일이 없으면 `apps/pet-preview/README.md`의 설치 절차가 필요하다고 알린다. 펫이 보인다고 추측하지 않는다.

## 2. 펫과 이 채팅 연결 (`show`가 `"state":"shown"`일 때)

1. 먼저 사용자에게 한두 문장으로 알린다: 펫이 나타났고, 펫을 클릭해 기능을 고르고 설정한 뒤 '제작 시작'을 누르면 이 채팅에서 이어서 진행한다는 것, 기다리는 동안 이 채팅은 실행 중으로 보이며 그만 기다리려면 이 턴을 중지하면 된다는 것.
2. 같은 폴더에서 `& "<이 스킬 폴더>\bin\autopet-preview.exe" wait` 를 승인 요청과 함께 실행한다 (사유: "AutoPets 펫에서 설정한 작업을 이 채팅으로 받기", 출력 토큰 한도 8000 이상). 작업 폴더(workdir)는 바꾸지 않는다.
3. `wait`는 사용자가 펫에서 '제작 시작'을 누를 때까지 끝나지 않는다(최대 30분). 명령이 아직 실행 중으로 돌아오면 **같은 프로세스 세션**을 빈 입력으로 계속 폴링해서(write_stdin, chars "") JSON 한 줄이 나올 때까지 기다린다. `wait`를 새로 다시 실행하지 않고, 기다리는 동안 다른 작업을 하지 않는다.
4. 출력의 `state`에 따라:
   - `task`: 아래 3단계를 한다.
   - `pet-closed`·`wait-timeout`·`superseded`·`not-running`·그 밖의 `ok: false`: `message`를 한 문장으로 알리고 끝낸다.

## 3. 펫에서 받은 작업 실행 (`state: "task"`)

`task` 객체가 이 채팅에 전달된 실제 작업이다. 같은 작업을 두 번 실행하지 않는다.

1. 작업을 시작하기 전에 이 채팅에 다음을 그대로 보여 준다:
   - 선택한 Pet: `task.pet.name` (`task.pet.featureId`), 작업 ID `task.id`
   - Skill: `task.skill.id` `task.skill.version` — `task.skill.path` (sha256 `task.skill.sha256` 앞 12자, 출처 `task.skill.upstream`)
   - Pet에서 고른 설정: `task.settings`의 목적·주제와 내용·분량·디자인·우선순위
   - AI에 전달된 실제 요청: `task.request` 전문을 인용 블록으로
   - 결과 파일 경로: `task.outputFile`
2. `task.request`를 사용자의 요청으로 보고 그대로 따른다. 먼저 `task.skill.path` 파일 전체를 `Get-Content -Raw -Encoding utf8`로 한 번에 읽고(출력 토큰 한도 넉넉히) 그 스킬 지침에 따라 만든다. 결과는 `task.outputFile` 한 파일만 만든다(아래 Pet 질문 JSON 파일은 예외). 파일 작성 명령은 일반 샌드박스에서 실행한다.
3. **작업 중 Pet 질문(사용자 개입).** 스킬이 말하는 "사용자 확인"은 이 채팅이 아니라 Pet에서 받는다. 이 채팅에서 사용자에게 묻고 턴을 끝내지 않는다.
   - 구성안(필수, 첫 질문): 실제로 분석한 내용으로 방향이 다른 구성안 2~3개를 만든다. 이 채팅에 짧게 보여 준 뒤 `task.checkpoint.file`에 `task.request`의 형식대로 JSON을 쓰고(apply_patch 또는 UTF-8 저장), `task.checkpoint.ask` 명령을 승인 요청과 함께 실행한다 (사유: "AutoPets 펫에서 사용자의 선택을 받기", 출력 토큰 한도 8000 이상).
   - `ask`는 사용자가 펫에서 답할 때까지 끝나지 않는다. `wait`처럼 **같은 프로세스 세션**을 빈 입력으로 계속 폴링한다(write_stdin, chars ""). 기다리는 동안 결과 HTML을 만들거나 다른 명령을 실행하지 않고, `ask`를 새로 또 실행하지 않는다.
   - 출력 `state`에 따라:
     - `answered`: `choice`가 사용자의 결정이다. 먼저 `chatSummary`를 이 채팅에 그대로 보여 주고, `next` 안내대로 그 결정을 반영해 이어서 만든다. `repeated: true`이면 이미 반영 중인 답이니 같은 작업을 다시 하지 않는다.
     - `ask-timeout`: 질문은 펫에 남아 있다. 결과를 만들지 말고 **같은 `ask` 명령을 다시** 실행한다(같은 질문에 다시 연결되며 새 질문이 생기지 않는다). 세 번 연속 시간이 지나면 `task.report.fail`을 이유 "사용자가 펫 질문에 답하지 않음"으로 실행하고 끝낸다.
     - 그 밖의 `ok: false`(`refused`·`pet-closed`·`task-ended`·`question-cancelled`): `message`를 이 채팅에 알린다. `refused`이면 메시지대로 JSON을 고쳐 한 번만 다시 묻고, 나머지는 결정 없이 진행하지 말고 `task.report.fail`로 끝낸다.
   - 추가 질문은 사용자 합의가 꼭 필요하거나 결과 품질을 크게 바꾸는 판단이 생겼을 때만, 같은 방식(`stage`: length·design·evidence·other, 파일 `checkpoint-<stage>.json`, `task.report.ask` 형식)으로 최대 2번 한다. 사소한 결정은 직접 정한다.
4. 끝나면 `task.report.done` 명령을 승인 요청과 함께 실행한다 (사유: "만든 발표자료를 AutoPets 펫에 보고하고 확인"). 파일을 만들지 못했으면 대신 `task.report.fail`의 `<짧은 이유>`를 바꿔 실행한다. 펫 질문에 답을 받기 전에는 `done`을 실행하지 않는다(펫이 거절한다).
5. 최종 답변은 `done`/`fail` 출력만 근거로 쓴다: 완료 또는 실패(`state`), HTML 파일 경로(`outputFile`), 슬라이드 장수(`slideCount`), 펫에서 받은 결정(`decisions`: 질문, 선택지, 사용자 선택)과 구성안 반영 확인(`outlineMatch`: 고른 안의 슬라이드 제목 중 결과에 들어간 수), 스킬 확인 결과(`skill.loaded`, `skill.evidence`), 실행 기록(`runRecord`), 그리고 펫 창에도 같은 결과와 '결과 열기'가 표시된다는 것. 출력이 `ok: false`이면 성공했다고 말하지 않고 `message`를 그대로 전한다.

기존 `autopets` 스킬, AutoPets 앱, 훅, 연결 설정, 저장된 펫 데이터는 호출하거나 바꾸지 않는다.
