# AutoPets

**좋은 스킬을 쉽게 쓰고, 하던 일은 펫과 이어서.**

쓰던 Codex 채팅에서 펫에게 일을 맡기는 Windows 앱입니다. 펫에 일하는 방법과 설정을 저장하고, 계획·작업·결과 확인을 이어갑니다.

[설치 안내](INSTALL.md) · [Windows 개발 미리보기](https://github.com/swaan-kim/autopets/releases) · [실제 검증 기록](docs/testing/copy-free-installed-20261021.md) · [남은 계획](docs/roadmap/mvp-execution.md)

> **현재는 미서명 개발 미리보기입니다.** Windows 보안 정책에 따라 설치·실행이 차단될 수 있습니다. 보안 설정을 끄거나 차단을 우회하지 않으며, 일반 사용자용 서명 배포는 아직 준비 중입니다.

![AutoPets 개발 화면 — 펫 고르기](docs/changes/22/after-home.png)

*개발 브라우저에서 촬영한 검수 예시입니다. 합성 상태·카드는 실제 채팅 실행과 구분합니다.*

**공개 설치본과 개발 소스는 다릅니다.** 현재 공개 파일은 `v0.1.0-dev.20261020.797857d04ac3` 미서명 미리보기입니다. 아래 최신 화면·안정화·Agentation 개선은 [PR #22](https://github.com/swaan-kim/autopets/pull/22)의 개발 작업이며, 새 설치본 배포는 별도입니다.

## AI에게 설치를 부탁하려면

**PC에서 파일 다운로드와 프로그램 실행이 가능한 AI**에 아래 문장을 보내세요. 별도 Git·Node·Rust 설치는 필요하지 않습니다.

```text
https://github.com/swaan-kim/autopets/blob/main/INSTALL.md 를 읽고,
내 Windows PC에 AutoPets를 설치하고 실행하는 것을 도와줘.
기존 설치와 데이터를 보존하고 공식 배포 파일과 해시를 확인해줘.
미서명 시험판이면 설치 전에 알려주고, 보안 설정은 바꾸지 마.
실행되면 Codex에 펫을 준비하는 단계까지 안내해줘.
```

웹 AI처럼 PC를 실행할 수 없는 환경에서는 [Releases](https://github.com/swaan-kim/autopets/releases)의 **Pre-release 설치 EXE**를 직접 받습니다. 소스 ZIP을 빌드할 필요는 없습니다. [설치·연결 안내](INSTALL.md)

## 이렇게 사용해요

1. **처음 한 번 준비** — 설치 앱에서 **Codex에 펫 준비**를 누릅니다.
2. **쓰던 채팅에서 부르기** — `AutoPets 스킬로 제작 펫 연결해줘`라고 요청합니다. 스킬이 호출되지 않으면 Codex에서 **AutoPets 스킬을 직접 선택**합니다.
3. **앱에서 펫 선택·적용** — 펫과 대상 채팅을 고른 뒤 **이 채팅에 펫 적용**을 누릅니다. 설정을 다시 읽어 확인한 뒤 같은 채팅으로 돌아갑니다.
4. **계획 확인 → 구현** — 같은 채팅에서 `제작 펫으로 행사 페이지 계획만 세워줘`, 확인 후 `그대로 구현해줘`라고 요청합니다.
5. **펫에서 이어가기** — 진행을 확인하고 연결된 Codex 채팅으로 돌아가 결과를 봅니다.

**설정은 앱에서, 할 일은 같은 Codex 채팅에서.** 다음 명시적 펫 요청이 적용한 역할·스킬·하위 작업 설정을 읽으므로 펫 설정을 복사할 필요가 없습니다. 이전 공개 미리보기의 적용 버튼은 **자세히 → 저장한 구성과 연결 관리**에 있습니다.

앱에서 글을 작성하는 보조 경로는 **시작 요청 복사**로 전달하며 자동 전송하지 않습니다. 브라우저 화면은 미리보기이고 실제 저장·적용은 설치 앱에서 합니다. [연결과 전달의 현재 범위](docs/testing/copy-free-connection.md)

## 무엇을 맡길 수 있나요?

| 일상 | 업무 |
| --- | --- |
| 하루 정리 · 여행 일정 · 공부 도우미 | 웹페이지 · 홍보글 · 브라우저용 발표자료 |

펫마다 결과 예시와 스킬 출처를 확인할 수 있습니다. 웹페이지 펫은 고정 버전의 **Anthropic frontend-design**을 사용합니다. 즐겨찾기와 저장한 구성으로 같은 방식을 다시 쓸 수 있고, 외부 도구 연결은 필요한 경우에만 선택합니다. Figma는 기본 꺼짐입니다.

## 현재 확인한 범위

| 구분 | 상태 |
| --- | --- |
| **설치형 Codex 흐름** | 10월 21일 앱 적용→같은 시험 채팅의 웹페이지 계획·구현→복귀·재시작 복구 확인. 요청은 승인된 메시지 도구로 전달했으며 최신 흐름의 일반 입력 검사는 별도 |
| **스킬·라우팅** | 실제 스킬 읽기, 지정한 하위 작업의 모델·강도, 결과 반환, A/B 격리 확인. 최초 지침 평문 전체의 독립 대조는 미확인 |
| **개발 화면·Agentation** | 홈·펫 선택·작업 카드 분담과 UI 회귀 검사. 브라우저 의견→HTTP→실제 MCP→화면 완료 반영 확인. 작업 카드는 가상 예시이며 실제 채팅 실행 검사가 아님 |
| **여행·홍보글·발표자료** | 번들·저장·화면 검사. 각 역할의 실제 결과 품질은 미검증 |
| **자동 훅** | 일반 입력의 자동 처리 미통과. 현재 지원 경로는 명시적 스킬 호출 |
| **일반 사용자 배포** | 미서명 Pre-release. 보안 정책을 유지한 다른 PC 설치·서명 배포는 미통과 |

[설치형 상세 기록](docs/testing/copy-free-installed-20261021.md)과 [Agentation·UI 검사](docs/testing/agentation-ui-collaboration.md)에 근거와 제한을 남겼습니다. 과거 일반 입력 검사는 [10월 12일 기록](docs/testing/installed-core-20261012.md)과 구분합니다. 이번 개발 검사는 실제 AI 시험을 추가하지 않았으며, 사용자 편익과 역할별 결과 품질을 대신 입증하지 않습니다.

바꾸는 모델은 **펫의 하위 작업**입니다. 계획은 프롬프트를 따르는 방식입니다. 부모 채팅 모델 변경·실제 Plan 강제·모든 요청의 자동 훅 처리·자동 전송은 지원하지 않습니다. Work·Dot·Jev·Steam·공유 사이트는 후속 범위입니다.

<details>
<summary>작업 설정과 남은 검증</summary>

| 단계·선택 | 하위 작업 설정 |
| --- | --- |
| 계획 | Luna · low |
| 제작 — 가볍게 | Luna · low |
| 제작 — 표준 | Sol · low |
| 제작 — 꼼꼼하게 | Sol · medium |

실행 전에 현재 호스트의 가용 모델·강도를 확인하며, 없으면 임의로 대체하지 않습니다. 계획 단계의 파일 변경 제한은 **계획 프롬프트 이행**입니다.

다음 관문은 일반 입력으로 시작하는 사용자 체험, 보안 정책을 유지한 배포, 실제 사용자의 첫 성공과 재사용입니다. 설치 성공은 Smart App Control이 꺼진 시험 PC의 결과이므로 모든 PC의 설치 성공을 뜻하지 않습니다.

- [가능성·제한 기록](docs/testing/mvp-feasibility.md)
- [사용자 검사](docs/testing/first-success-user-check.md)
- [서명 배포 준비](docs/releases/code-signing.md)
- [최신 배포 식별 정보](https://github.com/swaan-kim/autopets/blob/main/docs/releases/preview.json) — 설치기·앱 해시와 고정 소스 커밋

</details>

<details>
<summary>개발·검사</summary>

개발 환경은 Node.js 24와 pnpm 11.19.0입니다. 네이티브 빌드에는 Rust MSVC, Microsoft C++ Build Tools·Windows SDK와 WebView2가 필요합니다. 일반 설치에는 이 개발 도구가 필요하지 않습니다.

```powershell
pnpm install --frozen-lockfile
pnpm verify:layout
pnpm test
pnpm build
pnpm test:ui
pnpm test:rust
node scripts/validate-release.mjs
```

`pnpm dev`는 개발 화면, `pnpm desktop`은 네이티브 개발 실행입니다. `pnpm dev:feedback`은 브라우저 검수 화면(1420)과 로컬 Agentation 서버(4747)를 함께 엽니다. `pnpm feedback:mcp`는 MCP 연결, `pnpm ui:scope <담당> <변경 파일...>`는 담당 파일 검사에 사용합니다. Agentation은 개발용이며 제품 빌드·Tauri 창·펫 오버레이에 포함하지 않습니다.

공동 작업은 **한 작업·한 담당자·한 PR**, 다른 사람 한 명의 검토를 기준으로 합니다. PR의 전후 비교·검사·AI 인계 형식은 `pnpm review:check --body <본문파일>`로 확인합니다. [화면 전후 비교](docs/changes/22/README.md) · [공동 규격 검사](docs/testing/team-collaboration-20261028.md)

[팀 작업 규칙](docs/development/team-workflow.md) · [Agentation 공동 수정](docs/development/ui-collaboration.md) · [UI 검사 기록](docs/testing/agentation-ui-collaboration.md)

[Windows 빌드](docs/releases/windows.md) · [내부 구조](docs/architecture/layout.md) · [Windows CI](https://github.com/swaan-kim/autopets/actions/workflows/windows.yml)

기존 앱 ID `local.autopets.desktop`과 데이터 위치를 유지합니다. DB·인증값·개인 채팅·로컬 진단은 공개하지 않습니다. `campaign-study.html`과 [공개 소개](https://swaan-kim.github.io/autopets/)는 별도 예시·시제품이며 실제 실행 증거로 사용하지 않습니다.

</details>
