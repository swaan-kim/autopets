# AutoPets

**좋은 스킬을 쉽게 쓰고, 하던 일은 펫과 이어서.**

쓰던 Codex 채팅에서 펫에게 일을 맡기는 Windows 앱입니다. 펫에 일하는 방법과 설정을 저장하고, 계획·작업·결과 확인을 이어갑니다.

[설치 안내](INSTALL.md) · [Windows 개발 미리보기](https://github.com/swaan-kim/autopets/releases) · [실제 검증 기록](docs/testing/installed-core-20261012.md) · [남은 계획](docs/roadmap/mvp-execution.md)

> **현재는 미서명 개발 미리보기입니다.** Windows 보안 정책에 따라 설치·실행이 차단될 수 있습니다. 보안 설정을 끄거나 차단을 우회하지 않으며, 일반 사용자용 서명 배포는 아직 준비 중입니다.

![AutoPets 홈 — 펫과 할 일 입력](docs/images/pet-home-20261017/after-home.png)

*브라우저에서 확인한 개발 화면입니다. 최신 화면의 설치형 전체 흐름 검증과는 구분합니다.*

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

1. **펫 고르기** — 할 일을 입력하거나 펫의 결과 예시를 봅니다.
2. **처음 한 번 준비** — 앱에서 **Codex에 펫 준비**를 누릅니다.
3. **쓰던 채팅에서 맡기기** — `AutoPets 스킬로 제작 펫 연결해줘`라고 요청합니다. 스킬이 호출되지 않으면 Codex에서 **AutoPets 스킬을 직접 선택**합니다.
4. **계획 확인 → 구현** — 같은 채팅에서 `제작 펫으로 행사 페이지 계획만 세워줘`, 확인 후 `그대로 구현해줘`라고 요청합니다.
5. **펫에서 이어가기** — 진행을 확인하고 연결된 Codex 채팅으로 돌아가 결과를 봅니다.

**저장한 펫 설정은 복사 없이 적용할 수도 있습니다.** 먼저 위 요청으로 채팅을 연결한 뒤, 설치 앱의 **자세히 → 저장한 구성과 연결 관리**에서 대상 채팅을 골라 **저장하고 선택 채팅에 적용**을 누릅니다. 다음에 그 채팅에서 펫에게 일을 맡기면 저장된 역할·스킬·작업 설정을 읽습니다.

앱 입력창에 적은 **할 일까지 전달**하려면 **시작 요청 복사**를 사용합니다. 브라우저 화면은 미리보기이며 실제 저장·적용은 설치 앱에서 합니다. 직접 설정 적용은 코드·격리 검사로 확인했으며, 이 경로부터 실제 AI 결과까지의 연속 검증은 별도로 남아 있습니다.

## 무엇을 맡길 수 있나요?

| 일상 | 업무 |
| --- | --- |
| 하루 정리 · 여행 일정 · 공부 도우미 | 웹페이지 · 홍보글 · 브라우저용 발표자료 |

펫마다 결과 예시와 스킬 출처를 확인할 수 있습니다. 웹페이지 펫은 고정 버전의 **Anthropic frontend-design**을 사용합니다. 즐겨찾기와 저장한 구성으로 같은 방식을 다시 쓸 수 있고, 외부 도구 연결은 필요한 경우에만 선택합니다. Figma는 기본 꺼짐입니다.

## 현재 확인한 범위

| 구분 | 상태 |
| --- | --- |
| **실제 Codex 작업** | 기존 설치본에서 웹페이지 계획→구현, 하루 정리, 공부 도우미를 일반 채팅으로 확인 |
| **스킬·라우팅** | 실제 스킬 읽기, 지정한 하위 작업의 모델·강도, 결과 반환과 펫 상태, A/B 격리 확인 |
| **새 화면·펫 반응** | 홈·역할 선택·초안·즐겨찾기·작업 복귀의 구현·화면 검사. 최신 설치본의 전체 사용자 체험은 별도 |
| **여행·홍보글·발표자료** | 번들·저장·화면 검사. 각 역할의 실제 결과 품질은 미검증 |
| **자동 훅** | 일반 입력의 자동 처리 미통과. 현재 지원 경로는 명시적 스킬 호출 |
| **일반 사용자 배포** | 미서명 Pre-release. 보안 정책을 유지한 다른 PC 설치·서명 배포는 미통과 |

[2026-10-12 실제 설치·작업 기록](docs/testing/installed-core-20261012.md)에 성공과 실패를 함께 남겼습니다. 준비된 지침·스킬 읽기·응답 이행은 확인했지만, 암호화된 최초 위임 입력의 바이트 단위 일치는 독립 확인하지 못했습니다. 실제 AI 시험 누계는 **71/72턴**이며 이번 배포 준비에서 추가 실행하지 않습니다.

[복붙 없는 연결의 현재 범위](docs/testing/copy-free-connection.md): 앱의 펫 설정 직접 적용, 요청문 전송, 브라우저 미리보기, 자동 훅을 각각 구분했습니다.

바꾸는 모델은 **펫의 하위 작업**입니다. 부모 채팅 모델 변경·실제 Plan 모드 강제·모든 요청 자동 처리·자동 전송은 지원하지 않습니다. Work·Dot·Jev·공유 사이트는 후속 범위입니다.

<details>
<summary>작업 설정과 남은 검증</summary>

| 단계·선택 | 하위 작업 설정 |
| --- | --- |
| 계획 | Luna · low |
| 제작 — 가볍게 | Luna · low |
| 제작 — 표준 | Sol · low |
| 제작 — 꼼꼼하게 | Sol · medium |

실행 전에 현재 호스트의 가용 모델·강도를 확인하며, 없으면 임의로 대체하지 않습니다. 계획 단계의 파일 변경 제한은 **계획 프롬프트 이행**입니다.

다음 관문은 최신 설치본의 대표 흐름, 보안 정책을 유지한 배포, 실제 사용자의 첫 성공과 재사용입니다. 과거 설치 성공은 Smart App Control이 꺼진 시험 PC의 결과이므로 모든 PC의 설치 성공을 뜻하지 않습니다.

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

`pnpm dev`는 개발 화면, `pnpm desktop`은 네이티브 개발 실행입니다. [Windows 빌드](docs/releases/windows.md) · [내부 구조](docs/architecture/layout.md) · [Windows CI](https://github.com/swaan-kim/autopets/actions/workflows/windows.yml)

기존 앱 ID `local.autopets.desktop`과 데이터 위치를 유지합니다. DB·인증값·개인 채팅·로컬 진단은 공개하지 않습니다. `campaign-study.html`과 [공개 소개](https://swaan-kim.github.io/autopets/)는 별도 예시·시제품이며 실제 실행 증거로 사용하지 않습니다.

</details>
