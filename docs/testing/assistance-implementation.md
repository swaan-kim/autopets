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

Windows CI에서 Rust 저장/인증/개정 충돌/receipt 취소/중복/실제 HTTP, UI, NSIS 빌드를 실행한다. 로컬 Rust 검사는 이전에 Windows 앱 제어 오류4551로 차단됐고, 구조 변경 이후에는 프로젝트 검사 전에 time_macros 의존성 오류 E0463로 중단됐다. 보안 설정을 변경하지 않았다. 최신 CI 결과는 PR 검사에서 확인하며, 이전 성공을 새 코드 검증으로 사용하지 않는다.

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

## UX 확장 검수

작은 카드에서 작업별 방식 변경, 상세 3탭, 전역 답변 길이·형식, 이전 기록 한 번 되돌리기, 개별 펫 숨김을 추가했다. 18프레임을 기존 자료에서 재사용하며 실행 중 생성하지 않는다. 단순 텍스트 포함/형식 검사와 사실 검증은 구분한다.

추가 검사: 구형 설정 기본값, 설정 개정 충돌, 다른 채팅 영향 없음, 수정·되돌리기·전체 삭제 뒤 이전 receipt 거부, 3KB 부분 기록 공개, 4번째 이후 작업 목록, 빠른 카드 키보드 닫기·작은 화면·움직임 줄이기. 실제 모니터·창 포커스와 모델 적용은 여전히 실환경 검수 대상이다.

## 현재 앱 화면

다음은 실제 서비스 연결이 아닌 fixture 데이터로 검수한 구현 화면이다. 소개 목업과 구분한다.

[작은 펫 카드](../images/app-pet-card.png) · [기본 설정](../images/app-settings.png)

## 구조 정리 검수

화면과 연결 코드를 소유 폴더로 옮겼고 기존 검사 사례를 유지했다. 이전 훅·CLI 동작 동등성과 저장소 밖 ChatGPT ZIP 실행을 추가로 확인한다. 최종 결과와 커밋은 [상태 파일](../implementation-status.json)에 기록한다. 역할별 작업은 M2 하위 Issue #9~#13에서 추적한다.

### 구조 정리 검수 근거

기준 코드 `1315d19c5cbbfe82cbf5eb7a4716310575a35ff8`의 [Windows CI](https://github.com/swaan-kim/autopets/actions/runs/35594357064)에서 Node 102개·화면 14개·Rust 52개·홍보물 22개 및 NSIS/연결 ZIP 빌드가 통과했다. 문서 후속 커밋과 main의 검사 결과는 PR #8과 Actions에서 확인한다.

- 새 체크아웃에서 잠금 설치·루트 빌드·Node 102개·화면 14개 통과. dev/desktop 명령 위임은 도움말로 확인했으며 앱을 실행하지 않았다.
- Codex companion을 저장소 밖에 압축 해제한 뒤 49개 검사가 통과했다. 이전/새 훅·CLI 입출력과 오류 처리를 비교한다. ChatGPT ZIP 독립 실행·설치 dry-run 검사도 Node 전체 검사에 포함된다.
- 오프라인 목업은 네트워크를 차단한 file:// 환경에서 표시됐고 외부 요청·페이지 오류·콘솔 오류가 모두 0개였다. 홍보물 31개 산출물의 재현 검사도 통과했다.
- 기존 Rust 검사 52개를 유지했다. 이전 코드와 운영 SQL 고유 문장 26개, 앱 식별자·DB/좌표 파일 경로, 세션/설정/슬롯 트랜잭션 경계가 동일하다. 기존 버전 기록 읽기·재시작·DB 실패 시 롤백 검사로 호환성을 확인한다. 실제 Windows 창 위치 복원은 별도 검증이다.
- PowerShell 빌드 helper는 명시적 툴체인 경로를 지원한다. 구문 검사 3건과 경로/환경변수/인수 우선순위 검사 10건을 통과했다.

기존 DB·펫 배치를 이동하거나 새 DB 이관을 추가하지 않았다. 비밀 파일·개인 데이터·빌드 임시 폴더는 Git과 companion에 포함하지 않는다.
