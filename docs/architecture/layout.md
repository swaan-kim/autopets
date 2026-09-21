# 실제 저장소 구조

앱은 apps/desktop, 서비스 연결은 integrations, 공통 계약과 작업 규칙은 packages에 둔다. 이 문서는 목표 폴더가 아닌 현재 소스 구조를 설명한다.

~~~text
AutoPets/
  apps/desktop/
    src/
      app/                 진입·관리창·공통 UI
      bridge/              앱 명령·상태 구독
      features/
        pets/              펫·모션·빠른 카드
        tasks/             목록·필터·단계·알림·복귀
        assistance/        현재 도움·채팅별 조절
        context/           기록 편집·변경 비교·되돌리기
        onboarding/        연결 안내
        settings/          공통 선호·데이터 관리
    src-tauri/src/
      domain/              타입·검증
      application/         작업·도움 처리
      transport/           HTTP·Tauri 명령
      storage/             SQLite
      platform/            Windows 창·트레이·위치
      legacy/              비활성 승인 실험
    public/assets/         펫·브랜드
    tests/                 화면 검사
  integrations/
    codex/                 hooks·scripts·skills·assistance·probe·tests
    chatgpt/               extension·native·compatibility·tests
  packages/
    contracts/             데이터 형식·검증·공통 TS 타입·tests
    guidance/              절차·지침·선택·점검·평가·tests
  docs/                    제품·설계·개발 순서·검수·배포·과거 기록·홍보물
  scripts/                 루트 명령·CI·패키징
  hooks/ · skills/          이전 설치 경로의 얇은 호환 진입점
  .github/                 Windows 검사·Pages·Issue 양식
~~~

## 의존 방향
UI 진입점은 app을 구성하고 app은 features를 조합한다. features는 공통 UI·bridge·contracts를 사용한다. 공통 TS 계약은 화면을 import하지 않는다.

Rust는 domain의 타입·검증, application의 처리, storage의 SQL, transport의 인증·입출력, platform의 Windows 기능을 구분한다. 트랜잭션과 잠금 범위를 유지하며 인터페이스의 이름·직렬화 형식은 바꾸지 않는다. legacy 모듈은 기존 비활성 실험의 보존용이며 새 제품 흐름에서 활성화하지 않는다.

관측 훅과 준비 훅은 별개다. Codex와 ChatGPT는 공통 규칙을 사용하되 capability를 각자 검증한다. SDK나 실제 서비스 연결 기능을 추가한 구조 변경은 아니다.

## 명령·호환
루트 package는 실행을 위임하고 앱 의존성은 desktop 패키지에 둔다. JavaScript 작업공간과 홍보 제작기는 루트 pnpm-lock.yaml 하나로 잠근다. Rust는 desktop의 Cargo.lock을 유지한다.

기존 pnpm dev/build/test/test:ui/desktop 명령을 유지한다. 이전 hooks/skills/scripts 경로는 호환 진입점이며 실제 코드를 복제하지 않는다. 새 스킬 배포본은 integrations/codex/skills/autopets다.

앱 ID local.autopets.desktop, AppData·AUTOPETS_DATA_DIR·SQLite·펫 배치는 그대로다. 디렉터리 정리에서는 기존 데이터 이동·삭제·스키마 이관을 하지 않았다. 후속 계획·실행 설정은 별도 버전의 테이블을 추가하고 기존 assistance JSON은 유지한다. 루트 work와 release는 무시된 산출물 디렉터리다. 공개 목업 docs/demo/index.html과 Pages 주소를 유지한다.

[실행 계약](assistance.md) · [검수](../testing/assistance-implementation.md) · [병렬 개발 인계](../roadmap/parallel-development.md)

후속 기능: [계획·실행 상태와 제출 보호](planning-execution.md).
