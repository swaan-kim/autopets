# M1 실제 자동 연결 검증

목적: 첫 설정 이후 스킬을 직접 부르지 않은 두 실제 Codex 채팅에 짧은 지침이 전달되고, 각 채팅의 기록이 자기 펫에만 연결되는지 확인한다.

## 현재 준비된 것

- Windows AutoPets 0.1.0 설치·프로세스·로컬 브리지 응답을 확인했다.
- 기존 관측 훅과 분리된 `integrations/codex/probe/prepare.mjs`를 준비했다.
- 이 진단은 지정 프로젝트에만 적용된다. 전역 자동 도움, 선호 설정 화면, 지속적인 맥락 동기화는 아직 제품 기능이 아니다.
- 진단 파일은 프로젝트의 `.local/autopets-m1`에만 저장하고 Git에서 제외한다. 민감한 업무 대신 아래 예시로 검증한다.

## 설치와 신뢰 확인

AutoPets 앱을 실행한 상태에서 정식 프로젝트 경로와 실제 연결 파일 경로를 사용한다. 이 명령은 전역 설정·실행 권한·trust를 바꾸지 않는다.

```powershell
node scripts/install-hooks.mjs install --project '<프로젝트 절대 경로>' --connection '<connection.json 절대 경로>' --dry-run
node scripts/install-hooks.mjs install --project '<프로젝트 절대 경로>' --connection '<connection.json 절대 경로>'
node integrations/codex/probe/setup.mjs install --project '<프로젝트 절대 경로>' --connection '<connection.json 절대 경로>' --dry-run
node integrations/codex/probe/setup.mjs install --project '<프로젝트 절대 경로>' --connection '<connection.json 절대 경로>'
```

Codex에서 이 프로젝트를 열고 `/hooks` 또는 해당 버전의 훅 검토 화면에서 정확한 정의를 확인한다. 기존 AutoPets 관측 훅 8개와 `AutoPets M1 preparation probe (review required)` 3개가 대상이다. 준비 훅은 UserPromptSubmit에 짧은 지침을 반환하고 SessionStart/PostCompact에 복구 표시만 남긴다. 정상적인 사용자 신뢰 확인을 마친 뒤 새 채팅에서 시험한다. 이 절차가 필요한 이유는 Codex가 훅 정의의 신뢰를 별도로 관리하기 때문이다. [공식 문서](https://learn.chatgpt.com/docs/hooks)

현재 작업에서 임의의 session_id로 훅을 수동 실행하지 않는다. 그런 실행은 Desktop 전달 검증이 아니다. 신뢰가 차단되거나 메뉴를 찾지 못하면 제품 버전과 오류 종류만 남기고 M1을 미완료로 유지한다.

## 두 채팅 시나리오

같은 프로젝트의 **로컬 실행 채팅**에서 평소 요청만 보낸다. 프롬프트에 `$autopets`, 진단 nonce, 기록 명령을 넣지 않는다.

1. 채팅 A: “가상의 협업 도구 3개를 비교하는 초안을 만들어줘. 실제 자료 조사는 하지 말고, 예시임을 표시해줘.”
2. 채팅 B: “내일 회의용 안건 초안을 만들어줘. 이번 예시는 일정·담당·다음 행동 세 항목으로 정리해줘.”
3. 현재 모델이 일반 작업을 수행하면서 준비 훅의 지침을 따라 짧은 JSON 기록을 만들고 acknowledge를 실행하는지 확인한다. Plan 모드 등 쓰기가 허용되지 않는 상황에서는 원래 작업을 계속하며 기록 성공으로 표시하지 않아야 한다.
4. 두 펫의 완료 기준이 서로 다른지 확인한다. A의 조건이 B의 기록에 들어오지 않아야 한다. 펫을 눌렀을 때 해당 작업만 표시되어야 한다.
5. 같은 채팅에 평범한 후속 요청을 보내도 같은 지침이 다시 추가되지 않는지 확인한다. 재개나 압축 후에는 해당 채팅 기록만 복구한다.

## 기록 확인

```powershell
node integrations/codex/probe/status.mjs --config '<프로젝트 절대 경로>/.local/autopets-m1/config.json'
```

이 출력은 내용·원래 채팅 ID·경로·nonce를 제외한다. `hookOutputPrepared`는 stdout 준비, `acknowledgementReceived`는 현재 채팅/활성 턴/nonce가 일치한 기록 요청, `contextSaved`는 실제 파일 저장이다. **어떤 값도 단독으로 실제 Desktop 전달 성공을 증명하지 않는다.** 실제 두 채팅의 행동과 함께 근거를 기록해야 한다.

`.local/autopets-m1/*.json`과 업무 JSON은 비공개 로컬 데이터다. 공개 Issue에는 위 요약과 버전·시간·기대/실제 결과만 붙인다. lock이 남으면 먼저 관련 Node 프로세스가 종료됐는지 확인하고, 살아 있는 기록 작업의 lock은 삭제하지 않는다.

## 통과 기준과 실패 처리

- 두 새 채팅에서 수동 스킬 호출 없이 실제 지침 전달과 기록 성공을 확인한다.
- 채팅·활성 턴·nonce가 일치할 때만 기록되고 서로 다른 업무 내용은 섞이지 않는다.
- 준비 지침은 UTF-8 3KB 이하, 저장 내용은 1KB 이하이며 원문 프롬프트/도구 출력/전체 대화를 저장하지 않는다.
- 동일 요청은 중복 주입되지 않고, 복구 시 자기 채팅의 기록만 사용한다.
- 연결 불가·잘못된 입력·기록 실패는 작업을 중단하지 않는다.
- 수동 실행이나 시험 서버의 기록을 실제 Desktop 증거로 사용하지 않는다.

M1 통과 전 M2–M6는 진행하지 않는다. 접근 거부를 피하려고 Codex 실행 파일을 복사하거나 Windows 정책·훅 trust 파일을 직접 수정하지 않는다.

## 진단 끄기

```powershell
node integrations/codex/probe/setup.mjs uninstall --project '<프로젝트 절대 경로>'
```

정확히 일치하는 M1 훅만 제거하고, 진단 opt-in을 끈다. 다른 훅과 기존 관측 훅은 보존한다. 기록은 재현을 위해 남으며 원하면 해당 진단 폴더의 위치를 확인한 뒤 사용자가 삭제할 수 있다. production의 기록 삭제 UI는 M3에서 구현한다.
