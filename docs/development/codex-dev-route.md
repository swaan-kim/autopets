# Codex에서 소스 개발 앱 열기

Codex의 `$autopets`는 기본적으로 **설치된 앱**을 연다. 스킬이 설치본 `connector`의 `start.mjs`를 실행하고, 이 스크립트는 같은 폴더의 설치 exe와 설치본 데이터(`local.autopets.desktop`)에 연결한다. 그래서 소스에서 최신 화면을 고쳐도 Codex에서 부른 펫은 설치본의 예전 화면을 보여 준다. 두 빌드가 모두 `0.1.0`으로 보고하기 때문에 버전 확인으로도 구분되지 않는다.

`scripts/dev-codex-route.mjs`는 개발하는 동안만 이 스킬을 소스 개발 앱으로 돌린다. 앱 코드·API·설치본 데이터는 바꾸지 않는다.

## 사용 순서

1. 설치본과 데이터가 섞이지 않게 별도 데이터 폴더로 개발 앱을 띄우는 `.cmd` 실행기를 준비한다. 실행기는 `AUTOPETS_DATA_DIR`을 그 폴더로 지정하고, 가능하면 별도 앱 ID(`--config`로 `identifier` 변경)로 `tauri dev`를 실행한다. 실행기와 데이터는 Git에 넣지 않는 `.local/`에 둔다.
2. 개발 스킬을 설치한다. 기존 스킬은 `.local/codex-dev-route/`에 한 번만 백업된다.

   ```powershell
   node scripts/dev-codex-route.mjs install --data-dir "<저장소>\.local\dev-data" --launcher "<저장소>\.local\start-dev.cmd"
   ```

3. Codex 채팅에서 `/오토펫`(또는 `/autopets`, `$autopets`)만 보내거나 `$autopets 켜줘`라고 보낸다. 다른 요청 없이 스킬만 불러도 `start`를 가장 먼저 실행한다. 결과의 `target`이 `source-dev-app`이면 개발 앱이 열린 것이다. 개발 앱이 이미 켜져 있으면 그 앱을 재사용하고(중복 실행 없음), 꺼져 있으면 실행기를 켜고 최대 4분 기다린다. 결과의 `timings`에 앱 준비·펫 표시 요청·채팅 연결까지 걸린 시간(ms)이 나온다.
4. 설치본으로 확인할 때는 원래 스킬로 되돌린다.

   ```powershell
   node scripts/dev-codex-route.mjs restore
   ```

## 동작과 한계

- `start`는 설치 흐름의 앱 쪽 단계만 따른다. 앱 열기·재사용(250ms 간격으로 준비 확인) → 개발 exe를 `--show-pets --chat <CODEX_THREAD_ID>`로 한 번 더 실행해 떠 있는 앱에 펫 표시 요청 → 현재 `CODEX_THREAD_ID`와 작업 폴더로 `POST /v1/setup`. 파일 설치·훅 변경·설치 앱 실행은 하지 않는다. 앱에 연결하지 못하면 설치 앱으로 대신 열지 않고 실패를 알린다.
- 펫 표시 요청을 받은 앱은 숨김·가장자리 보관 상태의 펫을 다시 보이게 하고, 첫 실행이라 온보딩 보고를 기다리던 펫도 바로 띄운다. 펫에는 "Codex 연결 중…" → "Codex 채팅과 연결됨"이 잠깐 표시된다. 관리자 창은 따로 열지 않는다(콜드 스타트 때 관리자 창이 같이 뜨는 것은 기존 동작).
- 개발 스킬은 `agents/openai.yaml`에 표시 이름 "오토펫 · AutoPets"를 둔다. 원형 테스트 펫 스킬(`autopet`)은 "원형 테스트 펫 · autopet"으로 바뀌어 `/오토펫`을 더 이상 차지하지 않는다. `restore`는 이 yaml을 지운다.
- 개발 스킬은 모든 `pet.mjs` 호출에 개발 데이터의 `--connection`을 붙이도록 안내한다. 이 인수가 없으면 `pet.mjs connect`가 설치 앱을 연다.
- 개발 앱은 개발 데이터 폴더의 펫과 설정을 쓴다. 설치본에 저장한 펫은 보이지 않는다.
- 개발 스킬을 둔 상태에서 설치 앱의 연결 버튼을 누르면 스킬 해시가 달라 충돌로 표시되고 파일을 덮어쓰지 않는다. 설치본 검사 전에는 `restore`를 실행한다.
- 이 경로는 개발 확인용이다. 사용자가 최신 화면을 보려면 해당 코드가 들어간 새 설치본이 필요하다.
