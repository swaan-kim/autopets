# 자동 도움 구현 검수 — 2026-09-21

소스 구현과 실서비스 연결을 구분한다. 이번 변경에서 사용자 PC 앱·확장·훅·trust를 설치/변경하지 않았다. 실제 사용자 모집·메시지 발송·모델 평가 호출도 수행하지 않았다.

## 구현한 것

설정 UI와 채팅별 기록 CRUD, SQLite 이관 보존, 직접 숨기기/종료, 네 종류 작업 규칙과 보수적 모델 선택 정책, 형식 점검/한 번 보완 조건, Codex opt-in 준비/정상 턴 기록 helper, Chrome 확장/Native Messaging 검증 패키지.

모델 선택과 결과 점검은 공통 정책 함수까지 구현했다. 기존 ChatGPT/Codex 화면에서의 모델 변경 및 자동 보완 실행은 아직 연결하지 않았고 비활성이다. Chrome 실제 페이지 입력 수정도 비활성이다. UI의 저장은 실제 모델 적용이 아니다.

## 실행 가능한 검수

```powershell
pnpm test
pnpm build
node scripts/ci-ui.mjs
node scripts/evaluate-assistance.mjs --out work/assistance-evaluation.json
node scripts/package-chatgpt.mjs
```

Node 검사는 계정·채팅 격리, 조건 수정, off/delete, 과대 입력, fail-open, 지침 중복/복구, 모델 고정/미지원/버전 만료, IME·첨부·입력 변경·rollback, message frame·origin·replay를 다룬다. UI 검사는 fixture만 사용한다. 실제 Windows 창/서비스 연동 검증이 아니다.

Windows CI에서 Rust 저장/인증/개정 충돌/receipt 취소/중복/실제 HTTP, UI, NSIS 빌드를 실행한다. 로컬 Rust 테스트는 의존성 build script가 Windows 앱 제어 오류4551로 차단됐다. 보안 설정을 변경하지 않았다. 최신 CI 결과는 PR 검사에서 확인하며, 이전 성공을 새 코드 검증으로 사용하지 않는다.

## 실제 연결 관문

- Codex: 스킬 호출 없는 새 채팅 두 개, 최신 조건 변경, 정상 턴 기록, 재개·압축, 끄기·삭제 후 재주입 여부.
- ChatGPT: 실제 계정/채팅 식별, 한국어 IME·첨부·편집/재생성·페이지 갱신, 원문 보존, 단일 제출, 모델 picker 변경 후 다음 실행 확인. 실패하면 자동 조작 유지 비활성.
- 데이터: 계정 전환·같은 이름의 채팅·새 채팅 임시 ID 전환, 네 번째 작업, 순서 바뀐 이벤트.
- Windows: DPI100/150/200%, 다중 모니터·절전·포커스·움직임 줄이기, 설정/숨기기/종료, 제거·복구.
- 배포: 앱+확장 첫 설치 안내, 사용자 동의, 확장 store 등록, 서명·다른 PC 실행 허용. 개발용 수동 unpacked 설치를 초심자용 설치 완료로 보지 않는다.

## 효과 평가와 인터뷰

packages/guidance/evaluation-cases.mjs에는 한국어 합성 요청24건(요약/수정6, 조사6, 문서6, 기획6)과 평가 기준이 있다. 기본 실행은 분류·추가 지침 바이트·로컬 처리시간만 측정한다. 품질 향상이나 토큰 절감의 실측이 아니다.

실측 결과는 `node scripts/evaluate-assistance.mjs --results <JSON> --out <보고서>`로 가져온다. 각 row는 caseId, variant(native-default/usual/autopets), provider, environmentVersion, source(live/fixture), trial, quality{acceptable,criticalError}, metrics{totalTokens:null|number,elapsedMs,settingsActions,reworkCount}, usageScope:'full-task', includesAllOverhead:true를 담는다. 같은 환경/사례/반복만 짝지으며 품질 저하는 자동 절약 후보에서 제외한다. 실패와 모든 추가 실행 비용을 합산하고, 관측할 수 없는 토큰은 null로 남긴다. 원문 응답을 보고서에 저장하지 않는다.

초심자3명·숙련자2명의 테스트 가이드:
1. 최근 모델/프롬프트를 설정하거나 결과를 다시 고친 경험을 먼저 묻는다.
2. 설명 없이 자동 도움 켜기 → 평소 요청 → 도움 상태 찾기 → 작업 방식 변경 → 이번 채팅 끄기를 수행하게 한다.
3. 설정 저장과 실제 적용을 구분하는지, 잘못 기억한 조건을 수정/삭제할 수 있는지 확인한다.
4. 자신의 다음 업무에서 쓸 상황과 방해되는 점을 묻는다.
5. 4/5명이 요청·조절·끄기 이해, 3/5명이 구체적인 수고 감소를 설명하는지 탐색한다. 모집·실행은 아직 하지 않았다.
