# AutoPets 기여 안내

AutoPets는 기존 AI 채팅을 유지하면서 작업 준비·조건 관리·설정 확인을 돕는 Windows 펫 앱입니다. 현재는 개발·검증 단계이며, 실제 AI 연결과 공개 설치판이 검증된 제품으로 안내하지 않습니다.

먼저 [팀 공유 요약](docs/product/team-brief.md), [현재 진행과 근거](docs/roadmap/project-status.md), [AGENTS.md](AGENTS.md), [개발 순서](docs/roadmap/implementation.md)를 읽어 주세요. 기능 추가나 공통 계약 변경은 [Issue](https://github.com/swaan-kim/autopets/issues)에서 사용자 문제·결과물·검수 기준을 먼저 합의합니다.

## 작업 기준과 시작 방법

일반 기여는 `main`에서 새 브랜치를 만듭니다. 2026-09-23 기준 계획·실행 프리셋, 원큐 설치, 두 입구 통합은 각각 [PR #14](https://github.com/swaan-kim/autopets/pull/14), [PR #15](https://github.com/swaan-kim/autopets/pull/15), [PR #16](https://github.com/swaan-kim/autopets/pull/16)에 쌓여 있으며 아직 main 기능이 아닙니다. 해당 기능 검토는 별도 체크아웃에서 `gh pr checkout 16`처럼 대상 PR을 지정하고, 기능 기여는 담당자와 기반 브랜치를 맞춥니다. PR 번호·SHA와 검사 결과를 함께 기록합니다.

개발 환경은 Node.js 24와 pnpm 11.19.0입니다. 네이티브 빌드에는 Rust MSVC, Microsoft C++ Build Tools·Windows SDK·WebView2가 필요합니다. 저장소 루트에서 실행합니다.

```powershell
git clone https://github.com/swaan-kim/autopets.git
cd autopets
git switch -c feat/my-change
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev`는 브라우저 개발 화면입니다. `pnpm desktop`은 네이티브 개발 실행이며 앱 창과 로컬 데이터가 생길 수 있습니다. 이 명령들이 AI 연결이나 훅 신뢰까지 검증해 주지는 않습니다. 로컬 실행이 차단되면 보안 설정을 끄지 않고 원인과 CI 결과를 남깁니다.

## 코드 책임

| 위치 | 맡는 일 |
|---|---|
| `apps/desktop` | React 화면, Tauri/Rust 상태·저장·통신·창 제어, 펫 자산 |
| `integrations/codex`, `integrations/chatgpt` | 서비스별 관측·준비·연결 도구와 검사 |
| `packages/contracts` | 공통 데이터 형식과 검증 |
| `packages/guidance` | 작업 절차·짧은 지침·모델 선택·결과 점검 규칙 |
| `scripts`, `.github` | 루트 명령·패키징·CI |
| `docs` | 제품·구조·검증 근거·시연 자료 |

[내부 구조](docs/architecture/layout.md)를 따르고, 공통 계약 변경은 화면·연결·저장 담당자와 먼저 맞춥니다. 기존 앱 ID·데이터 위치·펫 배치·공개 데모를 보존합니다. 호환 진입점에 구현을 복제하거나 비활성 승인 실험을 새 실행 경로에 연결하지 않습니다.

## 변경에 맞는 검수

| 변경 | 필요한 검사 |
|---|---|
| 문서만 변경 | `node scripts/check-doc-links.mjs`와 실제 링크·문구 확인. 검사기가 포함하지 않는 새 루트 문서는 따로 확인 |
| 디렉터리·작업공간 변경 | `pnpm verify:layout`과 영향받는 빌드·패키징 |
| 훅·브리지·공통 규칙 | `pnpm test` |
| 화면·상태 표시 | `pnpm build`, `pnpm test:ui` |
| Rust·저장·네이티브 기능 | `pnpm test:rust` 및 Windows CI. 로컬 차단 시 CI 근거 명시 |
| 홍보 자산·목업 | `node --test docs/design-source/build-assets.test.cjs docs/design-source/demo-model.test.cjs`, `node docs/design-source/build-assets.cjs --check` |

PR에는 문제와 변경 후 동작, 검사 명령·결과, 미검증 항목을 적습니다. 기존 테스트를 삭제하거나 지원 여부를 완화해서 통과시키지 않습니다. 문서 수정에 무관한 전체 기능 검사를 반복할 필요는 없습니다.

**코드 구현 → 격리 검사 → 실제 환경 검증 → 사용자 효과 측정은 서로 다른 증거입니다.** 합성 데이터로 통과한 화면, 훅 출력, 성공한 CI, 실행 중인 앱만으로 AI에 지침이 전달됐다거나 모델이 변경됐다고 표시하지 않습니다. 토큰 절감·품질 향상은 실제 비교 측정 뒤에만 주장합니다.

실제 설치·훅 신뢰·브라우저 프로필·계정 설정을 변경하는 검증은 환경 소유자의 명시적 동의와 별도 검수 범위에서 진행합니다. 사용자 PC에서 임의로 연결을 활성화하지 않으며 Windows 보안 설정이나 AI의 신뢰 확인을 우회하지 않습니다.

## 문제 제보

아래 내용을 공개 Issue에 복사하되 대화 원문·첨부·인증 정보·개인 경로를 제거해 주세요. 재현에는 가능한 한 합성 데이터를 사용합니다.

```text
환경: Windows 버전 / 배율 / AI 도구·실행 화면(Desktop·CLI·웹 등)
버전: AutoPets 버전 또는 commit SHA / AI 도구 버전
증거 수준: 문서 / 격리 테스트 / 실제 앱 / 실제 AI 연결 중 무엇인지
재현 단계: 최소한의 번호 목록
기대한 동작:
실제 동작:
빈도와 영향:
첨부: 개인정보를 가린 화면 또는 필요한 오류 부분만
```

`connection.json`, 인증 토큰, SQLite, 로컬 훅 설정, 전체 대화·도구 출력은 Git·Issue·PR에 올리지 않습니다. 진단 자료는 최소 범위만 공유하고 비밀값을 발견하면 게시 전에 제거합니다.

## 라이선스와 출처

기존 [MIT 라이선스](LICENSE)와 저작권 표시를 유지합니다. 외부 코드·라이브러리·이미지를 추가하면 원본 출처, 라이선스, 변경 여부를 PR에 기록하고 필요한 고지·동봉 파일을 포함합니다. 참조 제품의 자산이나 코드를 공개 저장소라는 이유만으로 가져오지 않습니다.
