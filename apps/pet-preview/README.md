# 오토펫 테스트 펫 (실험)

Codex 채팅에서 `/오토펫`(또는 `/autopet`, `$autopet`)을 입력하면 Windows 화면 오른쪽 아래에 원형 테스트 펫이 뜨는 실험 기능이다. 펫에서 고른 발표자료 작업은 펫을 부른 그 채팅에서 실행된다. 자유 대화는 아직 없다.

기존 AutoPets 앱(`apps/desktop`, `local.autopets.desktop`), `autopets` 스킬, 훅, 저장 데이터와는 완전히 분리된 별도 Tauri 2 실행 파일이다.

| 항목 | 기존 AutoPets | 이 실험 |
| --- | --- | --- |
| 앱 식별자 | `local.autopets.desktop` | `local.autopets.petpreview` |
| 데이터 위치 | AutoPets AppData · SQLite | `%LOCALAPPDATA%\local.autopets.petpreview\` (상태·연결 파일, WebView2 캐시). 발표자료는 채팅 작업 폴더 |
| Codex 스킬 | `autopets` | `autopet` (표시명 “오토펫 · autopet”) |
| 펫 모습 | 강아지 이미지·모션 | 그라데이션 원 (이미지 에셋 없음) |

## 구조

```text
apps/pet-preview/
  src-tauri/            Tauri 2 실행 파일 (autopet-preview.exe)
    src/main.rs         실행기: 펫 프로세스를 분리 실행하고 상태를 JSON 한 줄로 출력
    src/pet.rs          펫 창: 투명·테두리 없음·항상 위·작업표시줄 제외, 단일 인스턴스
    src/status.rs       실행기↔펫 상태 파일
    src/handoff.rs      채팅↔펫 연결: wait·done·fail 명령, 연결 파일, 세션 기록 위치
    src/slides.rs       발표자료 작업: 전달, 진행 추적(세션 기록 읽기), 결과 확인, run.json
  ui/
    index.html, pet.js, pet.css   창 동작(드래그·숨기기·닫기)
    appearance/circle.*           임시 외형. 실제 캐릭터는 같은 mountAppearance(host)를 가진 모듈로 교체
  codex-skill/autopet/  Codex 스킬 원본 (SKILL.md, agents/openai.yaml)
  scripts/install.mjs   현재 사용자 Codex에 스킬 설치·제거
```

## 빌드·설치

Rust(1.77+)와 WebView2 런타임(Windows 11 기본 포함)이 필요하다. 저장소 루트에서:

```powershell
cargo build --release --manifest-path apps/pet-preview/src-tauri/Cargo.toml
node apps/pet-preview/scripts/install.mjs
```

설치는 `%USERPROFILE%\.codex\skills\autopet\`(또는 `CODEX_HOME\skills\autopet\`)에 `SKILL.md`, `agents/openai.yaml`, `bin/autopet-preview.exe`를 복사하는 것뿐이다. 제거는 `node apps/pet-preview/scripts/install.mjs --uninstall`.

설치 후 **새 Codex 채팅**을 열어야 스킬 목록이 갱신된다. 목록에 없으면 VS Code 창을 다시 불러오거나(Developer: Reload Window) Codex를 재시작한다.

## 사용

- Codex 입력창에 `/오토펫` 또는 `/autopet` → Skills 그룹의 **오토펫 · autopet** 선택 → 전송. CLI에서는 `$autopet`.
- 처음 실행 시 Codex가 샌드박스 밖 실행 승인을 요청하면 허용한다 (데스크톱 창을 띄우기 위해 필요).
- 펫: 드래그로 이동, 마우스를 올리면 `–`(숨기기)·`×`(닫기), Esc는 숨기기. 숨긴 펫은 다시 호출하면 같은 자리에 나타난다.
- 기능 선택(프로토타입): 입력창 위쪽에 AutoPets 기능 목록이 나온다. 목록은 `packages/contracts/data/pet-catalog.json`을 빌드 때 그대로 포함한 것(복사본 없음)이다. 이번에는 '발표자료 만들기'(`presentation`)만 설정 흐름이 있고 나머지는 '준비 중'이다. 선택하면 펫이 보라색으로 바뀌고 4단계(목적·분량·디자인·우선순위)를 하나씩 묻는다. 요약에서 '완료'를 누르면 구조화된 설정(`featureId`, `template`, `skills`, `settings`)이 펫 프로세스 메모리에 저장된다. 숨겼다 다시 불러도 유지되며 디스크·DB에는 저장하지 않는다. '설정 취소'·'초기화'는 기본 색으로 되돌린다. AI 실행은 없다. 구조: `ui/features/`(흐름 정의·패널), `src-tauri/src/features.rs`(목록·현재 상태). 새 기능 흐름은 `ui/features/<기능>-flow.js`를 만들고 `flows.js`에 등록하면 된다.
- 발표자료 제작(실제 실행): 설정 4단계와 발표 주제(5/5)를 입력하고 요약에서 '제작 시작'을 누르면, **`$autopet`을 호출한 그 Codex 채팅**이 같은 턴에서 실행한다(`src-tauri/src/handoff.rs`, `slides.rs`). 별도 Codex 세션이나 두 번째 모델 호출은 없다.
  - 연결: `$autopet` 턴은 펫을 띄운 뒤 `autopet-preview.exe wait`를 실행하고 '제작 시작'까지 기다린다(최대 30분, 그동안 채팅은 실행 중으로 보이며 턴을 중지하면 대기도 끝난다). 채팅은 Codex가 명령 환경에 넣는 `CODEX_THREAD_ID`로 식별한다. 요약 화면 왼쪽 아래에 실제로 기다리는 채팅이 있으면 `● 채팅 <ID> 연결됨`, 없으면 `○ 대기 중인 채팅 없음`이 보인다.
  - 전달: '제작 시작'을 누르면 기다리던 `wait`가 작업 JSON을 출력한다. 내용은 펫과 스킬(`autopets-presentation`, 고정 sha256), 설정, AI에 전달하는 요청 전문, 결과 경로, 보고 명령이다. 채팅의 모델은 이 내용을 채팅에 먼저 보여 준다. 그다음 스킬 `SKILL.md` 전체를 읽고 HTML을 만든 뒤 `autopet-preview.exe done --task <ID>`(실패 시 `fail`)로 보고하고, 그 결과로 최종 답변을 쓴다.
  - 기다리는 채팅이 없을 때 '제작 시작'을 누르면 작업은 '전달 대기'로 남는다. 마지막으로 펫을 부른 채팅에 다시 `$autopet`을 입력하면 그 채팅이 이어받는다. 다른 채팅은 가져가지 못한다. '전달 취소'로 거둘 수 있다.
  - 스킬: 설치된 AutoPets 패키지(`%LOCALAPPDATA%\AutoPets\connector\…`)를 먼저, 없으면 이 저장소 사본을 쓴다. 전달 전과 완료 확인 때 `skill-sources.json`의 고정 해시와 라이선스 해시를 확인한다.
  - 진행 상태: 펫은 그 채팅의 세션 기록(`~/.codex/sessions/…/rollout-*-<채팅 ID>.jsonl`)을 읽기만 한다. 전달 대기·전달됨·제작 중·완료·오류 상태와 명령 수·파일 변경 수·마지막 이벤트가 모두 거기에서 나온다.
  - 완료 판정(펫이 직접 확인): `presentation.html`이 슬라이드 2장 이상과 스크립트를 가진 완전한 HTML인지 본다. 또 작업 전달 이후 그 채팅의 세션 기록에 고정 SKILL.md 전체 본문이 있는지 본다(이름·경로만으로는 인정하지 않음). 채팅이 보고 없이 턴을 끝내도 펫이 같은 기준으로 판정한다.
  - 결과: 채팅 작업 폴더의 `autopets-presentation\<시각>\presentation.html`(채팅 샌드박스가 쓸 수 있는 곳)에 저장한다. 같은 폴더의 `run.json`에는 채팅 ID, 세션 기록 위치, 요청, 스킬 고정값과 근거, 이벤트, 채팅의 최종 답변이 남는다. 채팅과 펫에 같은 경로가 표시되고, 펫의 '결과 열기'·'폴더 열기'로 연다.
  - 중복: 작업이 진행 중이면 '제작 시작'을 거부한다. 한 작업은 한 채팅만 가져가고, 같은 채팅이 다시 받아도 같은 작업과 경로를 돌려준다. `done`은 몇 번 불러도 같은 판정을 돌려준다. 자동 재시도는 하지 않는다.
  - 승인: `show`·`wait`·`done`·`fail`은 데스크톱 펫과 통신해야 하므로 Codex의 샌드박스 밖 실행 승인이 필요하다(사용자 설정의 승인 방식을 따른다). 펫은 승인에 관여하지 않는다.
- 입력창: 펫을 짧게 클릭하면 옆에 입력창이 열린다(오른쪽에 공간이 없으면 왼쪽). Enter·전송 버튼은 입력 내용을 입력창 안에만 표시하고 AI에는 보내지 않는다(Shift+Enter 줄바꿈). 펫을 다시 클릭하거나 Esc로 닫는다. 4px 넘게 움직이면 드래그이며 입력창도 함께 이동한다. 창은 입력창이 열린 동안만 넓어진다(`src-tauri/src/bubble.rs`, `ui/bubble/`).
- 직접 실행: `autopet-preview.exe [show|hide|quit]` — 결과를 `{"ok":true,"state":"shown",...}` 한 줄로 출력한다.

## 문제 확인

1. `%USERPROFILE%\.codex\skills\autopet\bin\autopet-preview.exe`가 있는지, 직접 실행해서 펫이 뜨는지 본다.
2. 출력이 `"state":"sandboxed"`이면 Codex 샌드박스 계정에서 실행된 것이다. 승인 요청을 허용하거나 Codex 권한 모드를 확인한다. `"state":"timeout"`이면 WebView2 런타임과 데스크톱 세션을 확인한다. 어느 경우에도 보이지 않는 펫 프로세스는 남지 않는다.
3. 스킬이 메뉴에 없으면 새 채팅을 열고, 그래도 없으면 VS Code/Codex를 재시작한다. `$autopet`을 직접 입력해도 된다.
4. '제작 시작' 후 계속 '전달 대기'이면 기다리는 채팅이 없는 것이다(요약 화면이 `○ 대기 중인 채팅 없음`). 그 채팅에 `$autopet`을 다시 입력한다. `wait` 출력이 `"state":"no-chat"`이면 Codex 채팅 밖에서 실행된 것이고, `"sandboxed"`이면 승인 없이 샌드박스에서 실행된 것이다.
5. 펫이 화면 밖에 있으면 `autopet-preview.exe quit` 후 다시 호출하면 기본 위치(오른쪽 아래)로 돌아온다.
