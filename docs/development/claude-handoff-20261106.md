# AutoPets를 Claude에 이어주기

2026-11-06 시점의 개발 인계다. 담당은 **swaan-kim**, 인계 작업은 [#44](https://github.com/swaan-kim/autopets/issues/44), 전체 사용성 목표는 [#27](https://github.com/swaan-kim/autopets/issues/27)이다. 이 문서는 새 AI가 이전 채팅을 읽지 않고 시작하도록 현재 사실과 다음 행동을 모았다. 이후 상태는 원격 Issue·PR의 최신 기록을 다시 확인한다.

## 지금 만드는 것

AutoPets는 **좋은 스킬과 작업 설정을 쉽게 쓰고, 펫과 하던 일을 이어가는 Windows 앱**이다. 첫 대상은 Codex를 쓰지만 스킬·설정에는 익숙하지 않은 사람이다. 요청은 기존 AI 채팅에서 입력하고, 앱은 펫 선택·설정·상태·재사용·정확한 작업 복귀를 맡는다.

사용자는 설명과 계층이 많은 화면, 반복 복사, 이미지처럼 멈추거나 자세가 툭툭 바뀌는 펫을 싫어한다. **지금의 최우선은 부드럽고 반응성 있는 펫 모션과 간결한 펫 UI, 사용자의 마우스를 점유하지 않는 검수 환경**이다. 새 캐릭터 20개 제작으로 돌아가지 말고 한 캐릭터의 움직임부터 검토한다.

기본 판매 방향은 스토어의 1회 구매다. 서버는 금지 조건이 아니지만 과도한 운영비·AI API 비용을 걱정한다. 성능·UX를 먼저 보고, 로컬 저장·모션·기존 AI 연결을 중심에 둔다. 별도 AutoPets AI API나 주기적인 AI 반응 호출을 기본 경로에 추가하지 않는다. 다른 AI 서비스의 이용료까지 포함한다고 약속하지 않는다.

## 먼저 읽을 순서

1. [AGENTS.md](../../AGENTS.md) → [공동 작업 안내](team-workflow.md). 오래된 문서의 날짜별 중단점·예산을 현재 지시로 적용하지 않는다.
2. [전체 목표 #27](https://github.com/swaan-kim/autopets/issues/27)의 최신 사용자 결정, [마우스 없는 검수 계획](https://github.com/swaan-kim/autopets/issues/27#issuecomment-6684398249), [이번 인계 #44](https://github.com/swaan-kim/autopets/issues/44).
3. 아래 PR의 본문·실제 diff·마지막 검사 결과. 완료한 코드를 다시 만들거나 미병합 코드를 main에 있는 것으로 설명하지 않는다.
4. [README](../../README.md), [실제 구조](../architecture/layout.md), [화면 공동 규칙](ui-collaboration.md), [영역별 파일 목록](ui-ownership.json).
5. 필요할 때만 원래 [서비스 검수표](../testing/pet-service-readiness.md)와 [설치형 과거 근거](../testing/copy-free-installed-20261021.md)를 읽는다. 합성 UI·내부 메시지 시험·일반 입력·실제 사용자의 편익을 구분한다.

## 완료한 것과 아직 합치지 않은 것

| 위치 | 현재 상태와 의미 |
| --- | --- |
| main | #22·#24·#26·#28·#30·#32·#34·#36·#37 병합 확인. 화면 정리, 펫 상태/모션 후속, 실제 영상 갤러리, 홈/탐색 후속이 포함돼 있다. 현재 사용자 요구 수준의 자연스러운 움직임이 완성됐다는 뜻은 아니다. |
| [PR #39](https://github.com/swaan-kim/autopets/pull/39) · Issue #38 | 초보자가 이해하기 쉬운 공동 안내·PR 설명과 시작 시 최신 코드/다른 PR 확인 규칙. 구현·필수 Windows/PR 검사 완료, OPEN·사람 검토 없음. |
| [PR #41](https://github.com/swaan-kim/autopets/pull/41) · Issue #40 | 연결 설정을 다녀와도 같은 펫·입력·선택·초점을 유지. 구현·합성 UI·필수 Windows/PR 검사 완료, OPEN·사람 검토 없음. 현재 PC 검토 설치본에는 포함되지 않았다. |
| [PR #43](https://github.com/swaan-kim/autopets/pull/43) · Issue #42 | 명시적 Codex 연결 버튼으로 호출 스킬과 읽기 전용 MCP 준비. 구현·45개 집중 검사·전체 Node 298개 통과/1개 제외·필수 Windows/PR 검사 완료, OPEN·사람 검토 없음. |
| 이번 공유 | 인계 문서와 [헤드리스 가상 포인터 재현 도구](../../scripts/probe-headless-pointer.mjs). 제품의 새 모션 렌더러나 실제 오버레이 성능 검증은 아직 아니다. |

인수 시 확인한 Orca 제품 작업 브랜치는 원격과 동기화됐고 미커밋 변경이 없었다. 원래 개발 폴더와 다른 사람의 체크아웃은 수정하지 않았다. 예전 문서 PR #17은 별도 열린 작업이며 이번 인계에서 다루지 않는다. 도엽님의 #37은 별도 펫 미리보기 실험이므로 제품 앱과 혼동하거나 임의로 수정하지 않는다.

한 작업·사람 담당 한 명·브랜치 하나·PR 하나를 유지한다. 시작/재개 시 `git status` → 원격 fetch → 관련 PR·diff·검사 확인 → 최신 기준 반영 순서로 진행하고, 기존 변경을 초기화하지 않는다. 새로운 작업은 본인의 별도 체크아웃에서 시작한다. 이전 초기 병합 예외를 #39/#41/#43이나 새 PR의 사람 승인으로 사용하지 않는다. 이번 요청은 GitHub 공유·인계이며 병합·공개 배포 요청이 아니다.

## 현재 PC와 공개 설치본은 다르다

사용자 승인으로 **#43의 미서명 검토판**을 현재 PC에 정상 설치하고 실행했다. 앱·연결 자원 166개가 검토 산출물의 해시와 같았다. 설치 전과 실행 후 DB 17개 테이블·저장한 펫 5개·확인한 Codex 설정/훅/호출 파일 6개를 대조해 보존을 확인했다. 펫 선택, 영상 분류, 실제 영상의 끝까지 재생, 대기 오버레이와 카드 열기·접기를 확인했다. [설치·보존·실제 화면 기록](https://github.com/swaan-kim/autopets/issues/42#issuecomment-6676167281).

기존 Orca 개발 대화에서 MCP 펫 목록 5개를 읽었다. 이것은 새 연결 버튼의 현재 PC 성공, 일반 사용자의 첫 연결, 실제 작업 실행이나 정확한 복귀를 검증한 결과가 아니다. 현재 PC에는 기존 수동 MCP 항목이 있어 관리 소유 기록과 충돌할 수 있다. #43의 보존 동작을 무시하고 설정을 덮어쓰거나 소유 기록을 임의로 채우지 않는다. 사용 중인 도구 프로세스를 임의 종료하지 않는다.

화면 제어 도구가 앱 ID로 다른 기존 설치 경로를 연 사례가 있었다. 방금 열린 인스턴스를 정상 종료한 뒤 해시를 확인한 실행 파일 경로로 현재 검토판을 실행했다. 원인은 미확정이며 일반 실행 진입점 확인이 남아 있다. 다른 설치본의 파일·데이터는 수정하지 않았다. 이를 제품 런처의 확정 원인이나 해결 완료로 쓰지 않는다.

공개 Release는 여전히 2026-10-20 미서명 미리보기다. 최신 main·현재 PC 검토판·일반 배포를 구분한다. 설치가 완료됐어도 새 PC의 보안 정책 유지 설치·서명·스토어 출시는 별도 관문이다. 사용 중인 Codex와 다른 AI 작업은 종료하지 않는 조건을 유지한다.

## Claude가 바로 이어갈 일

**첫 작업은 마우스를 점유하지 않는 모션 검수 화면을 만들 범위와 비교 시나리오를 확정하는 것이다.** 이 인계 문서에서 제품의 새 모션 구현을 시작하지 않았다. 이후 실제 수정은 작업별 Issue와 브랜치/PR에서 진행한다.

1. 기존 [모션 미리보기](../../apps/desktop/tests/pet-motion-preview.tsx)와 [동작 검사](../../apps/desktop/tests/companion-ui.cjs)를 읽고 제품 렌더러·입력·시간·Tauri 창 이동의 경계를 정한다. 새 펫 동작을 시험 코드에만 별도로 만들어 통과시키지 않는다.
2. 같은 가상 입력과 합성 작업 이벤트를 기존/개선 버전에 재생할 수 있게 한다. 설치 앱·사용자 DB·실제 채팅과 연결하지 않는다. 전용 테스트 포트와 비영속 브라우저 컨텍스트를 사용하고 다른 개발 서버를 종료하지 않는다.
3. 한 캐릭터로 숨쉬기·시선 → 접근/접촉 → 들기·흔들림 → 놓은 뒤 안정 → 작업 상태 전환을 비교한다. 중간 자세를 단순한 그림 겹침으로만 채우지 않는다. 필요하면 같은 캐릭터 인상으로 부위 분리 자산을 검토한다.
4. 짧은 클릭은 작업 카드, 드래그는 이동으로 구분한다. 놓은 뒤 카드까지 열리지 않게 하고 카드에서는 작업 이름·상태·대화 복귀를 먼저 보여준다. 숨기기·동작 줄이기를 유지한다.
5. 같은 상태·배율의 전후 영상, 연속 프레임과 자원 사용을 남긴다. 프레임 지연과 자세의 불연속을 따로 본다. 평균 fps나 영상 인코딩 fps만으로 자연스러움을 통과시키지 않는다.
6. Windows 투명창·실제 창 이동·다중 모니터는 별도 시험 세션에서 확인한다. 브라우저 통과를 네이티브 통과로 확대하지 않는다.

기존 연결/복귀 작업과는 범위를 분리한다. 일반 입력 → 펫 적용 → 같은 채팅 작업 → 정확한 복귀, #41/#43 함께 반영한 상태의 실사용, 새 PC 설치, 실제 사용자 편익은 계속 남아 있다. #41/#43을 임의로 합치거나 승인 없이 병합하지 않는다.

## 사용자의 마우스를 빌리지 않는 검수

기본 도구는 저장소에 이미 있는 Playwright의 **별도 헤드리스 브라우저**다. [재현 도구와 결과](../testing/headless-pointer-feasibility-20261106.md)에서 가상 이동·드래그·클릭 가능성을 확인했다. 사용 중인 Chrome에 붙거나 클립보드·물리 포인터로 전환하지 않는다. 사용자는 결과 영상과 비교 화면으로 검토할 수 있어야 한다.

[Vercel agent-desktop 공식 스킬](https://github.com/vercel-labs/agent-desktop/blob/main/skills/agent-desktop/SKILL.md)과 [Windows 지원표](https://agent-browser.dev/desktop/platforms/windows)를 확인했다. 의미 기반 버튼 검사 후보지만 Windows의 호버·드래그에는 실제 입력 모드가 필요하다. 이번에는 CLI를 설치·실행하지 않았다. 이름이 headless라고 창 초점 변경·키 입력·클립보드까지 무조건 허용하지 않는다. 실제 입력이 필요한 항목은 별도 Windows 시험 세션으로 분리한다.

## 참고 사례와 아직 만들지 않은 것

- [콤냥이](https://comnyang.com/ko): 시선·늘어나는 드래그·흔들림·접촉 반응. 공개 페이지/배포 스크립트의 연결을 조사했으며 현재 소개는 녹화 영상이다. 데스크톱 내부 엔진은 확인하지 않았다.
- [Drifty 변경 기록](https://drifty.so/changelog/)과 [Workcat](https://workcat.app/): 커서 인지, 드래그 상태와 조용한 공존을 참고한다.
- [Desktop Mate](https://store.steampowered.com/app/3301060/Desktop_Mate/), [Bongo Cat](https://store.steampowered.com/app/3419430/Bongo_Cat/), [Rusty's Retirement](https://store.steampowered.com/app/2666510/Rustys_Retirement/), [Desktop Goose](https://samperson.itch.io/desktop-goose): 접촉, 단순한 반응, 작업 영역과의 공존, 목적 있는 행동의 비교 자료다. 실제 설치 성능 비교는 하지 않았다.

공개 사례의 그림·영상·코드를 제품 자산으로 옮기지 않았다. 새 연속 모션 렌더러·모찌 드래그·검수 재생 화면은 **계획 단계**다. 이전 Orca 인라인 화면 구상은 검토용 모의 UI이며 제품 변경이 아니다. 설계 핵심은 [사용 흐름 계획](https://github.com/swaan-kim/autopets/issues/27#issuecomment-6683478612)과 [최신 모션/검수 계획](https://github.com/swaan-kim/autopets/issues/27#issuecomment-6684398249)에 공유돼 있다.

## 유지할 계약과 사용자 결정

- 앱 ID `local.autopets.desktop`, 기존 DB·데이터 위치·사용자 변경, 대상 ID·폴더·개정·재조회·A/B 격리·중복 실행/오래된 응답 방지를 보존한다.
- 요청은 기존 AI에서 입력한다. 펫 구성 읽기, 실제 스킬 읽기, 작업 실행, 결과 품질, 설치와 배포는 별개다. 현재 지원은 명시적 스킬·펫 하위 작업 라우팅·계획 프롬프트다. 자동 훅·부모 모델 변경·실제 Plan 강제·새 호스트 지원을 완료로 표시하지 않는다.
- 사용자는 협업 전 전체 사용성 정리 범위를 먼저 승인했다. 팀 전체의 회의/동료 검토 승인이라는 뜻은 아니다. 기존 권한·보안·데이터 계약을 바꾸거나 미합의 결정을 가정하지 않는다.
- 과거 `77/85턴` 상한은 이번 후속에 적용하지 않도록 사용자가 해제했다. 과거 기록은 보존하고 제작용 이미지와 실제 AI 시험을 따로 기록한다. 확인된 후속 독립 제품 AI 요청은 11건, 하위 작업 추가 0건이다. 이후 도구 읽기만 한 확인을 새 독립 AI 요청으로 세지 않는다. 결과가 불명확한 요청/자식을 재실행하지 않는다. 최근 계획·검수·이번 인계의 실제 AI 추가는 0회다.
- 새 펫 시안 20개와 AutoPets 제품의 Claude 호스트 설치/실사용 시험은 보류를 유지한다. **Claude에게 개발을 인계하는 것과 제품에 Claude를 연결하는 것은 다른 작업**이다.
- 로그인·신뢰·보안 승인을 대신하거나 Windows 차단을 우회하지 않는다. 인증값·개인 경로·원본 진단·전체 채팅은 GitHub에 올리지 않는다. 원래 개발 폴더와 다른 사람 파일은 보존한다.

<details>
<summary>소스·브랜치·검사 식별 정보</summary>

- main: `de5a974f2881d11f05648d07873cbb157e33ba3c`.
- PR #39: `task/38-readable-conventions`, `36f0b10b405fd7648cf20bb0a88db69b5169bdf6`. [Windows](https://github.com/swaan-kim/autopets/actions/runs/42082822613).
- PR #41: `task/40-preserve-pet-setup`, `58e05cec06893abb15de70961c9c5b47b45f37ce`. [Windows](https://github.com/swaan-kim/autopets/actions/runs/42098052356).
- PR #43: `task/42-codex-pet-connector`, `9bdac40f1e3525ebecf62e621f0135e34da41c9d`. [Windows](https://github.com/swaan-kim/autopets/actions/runs/42110002368), [최신 확인한 PR 양식 검사](https://github.com/swaan-kim/autopets/actions/runs/42157427184). 선택적인 bootstrap-recheck·recheck-lifecycle·draft-release는 제외됐다.
- 현재 PC 검토판 build source: `d75eb95fa6c3d2204edfa0058dd0623662b3d435`는 #43 변경 소스를 부모로 포함한다. 설치기 SHA-256 `90d3a4777b4ebf5c186d277b6b778ab94b347e1704b1359a85c244442acd619c`, 앱 SHA-256 `a78080a6abac106021283718388b1bc20e36c7d3d7a7ced42161fcd0f2bc227a`.
- 이번 인계: `task/44-claude-handoff`. 최신 공유 커밋과 검사는 연결된 PR의 Commits/Checks를 읽는다. 인계 시 미공유 제품 변경은 없다. 비공개 백업·원본 진단·조사 캐시는 공개 자료가 아니며 인수의 필수 입력으로 삼지 않는다.
- 주요 코드: [CompanionPet](../../apps/desktop/src/features/pets/CompanionPet.tsx), [상태와 완료 중복 방지](../../apps/desktop/src/features/pets/companionMotion.ts), [표시·동작 줄이기](../../apps/desktop/src/features/pets/usePetVisibility.ts), [오버레이](../../apps/desktop/src/features/pets/PetOverlay.tsx), [정확한 작업 열기](../../apps/desktop/src/features/pets/PetTaskReturn.tsx), [기존 성능 측정](../../apps/desktop/tests/companion-performance.cjs).
- 이번에 필요한 검사는 공유한 합성 실험·문서 링크·구조·PR 양식·diff다. 제품 변경이 없어 설치·실제 AI·사용자 PC 검사를 반복하지 않는다. 다음 화면/연결/Rust 수정은 AGENTS의 해당 검사와 마지막 소스 기준 Windows 결과를 따른다.

</details>

## Claude에게 붙여넣을 시작 요청

```text
AutoPets 개발을 인수해 주세요. 먼저 AGENTS.md와 공동 작업 안내를 읽고,
docs/development/claude-handoff-20261106.md, Issue #27의 최신 결정, Issue #44,
PR #39/#41/#43의 실제 diff·검사·미병합 상태를 확인해 주세요.
원격 최신 코드와 미공유 변경을 먼저 확인하고 원래 개발 폴더는 건드리지 마세요.
현재 우선순위는 부드러운 펫 모션·간결한 펫 UI와 마우스를 점유하지 않는 검수입니다.
완료한 것을 다시 만들지 말고, 헤드리스 모션 검수 화면의 범위·비교 시나리오부터 이어가 주세요.
기존 앱 데이터·채팅 격리·중복 방지와 진행 중인 Codex 작업을 보존하고,
제품 AI·설치·병합·배포·다른 호스트 지원의 검증 상태를 구분해 주세요.
```
