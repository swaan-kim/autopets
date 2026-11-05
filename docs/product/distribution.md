# 전용 앱 하나, 설치와 AI 호출 두 입구

**쓰던 AI는 그대로, 일에 맞는 준비와 설정은 펫이 챙겨준다.**

유료 AI의 설정이 낯선 초심자와 반복 설정이 번거로운 숙련자를 함께 대상으로 한다. 펫의 차별점은 귀여움이나 상태 표시만이 아니라 **실제로 전달한 도움과 확인된 설정을 보여주고 조절하는 것**이다. 요청·결과는 기존 AI 채팅에서 다룬다.

| 핵심 도움 | 사용자에게 보이는 말 | 제공 범위 |
|---|---|---|
| 작업 준비 | 비교 기준을 정리했어요 | 목표·조건·완료 기준, 필요한 경우 짧은 계획 |
| 설정 실수 방지 | 실행 설정을 확인해 주세요 | 계획·실행 희망 설정과 관측 설정 비교, 미검증 변경은 안내 |
| 조건 유지와 확인 | 바뀐 조건을 반영했어요 | 채팅별 조건·남은 일, 확인 요청 |

## 같은 앱으로 이어지는 시작

설치 버튼 → 단일 Windows EXE → 앱 준비 → AI 연결 → 첫 실제 작업 확인.

“AutoPets 설치하고 켜줘” → 같은 EXE 확인·실행 → 같은 연결 화면. 이미 설치했으면 다운로드 없이 실행한다. 로컬 실행을 할 수 없는 AI는 제품 사이트를 안내한다.

설치기는 앱·Node·연결 도구·라이선스·오프라인 WebView2를 준비한다. AI 연결은 첫 실행 화면에서 사용자가 선택하며 설치 중 다른 앱의 설정을 바꾸지 않는다. 신뢰·로그인·OS 허용은 해당 서비스 화면에서 처리한다.

희망 기본값은 균형 있게(Sol Medium → Terra Medium). 실제 계정의 모델 지원·설정 적용과는 별개다. 질문이나 모델 카드 선택을 시작 조건으로 강제하지 않는다. 펫에는 AI·작업명·현재 도움 한 줄, 메뉴에는 도움 끄기·숨기기·종료를 둔다.

## 배포 역할

| 경로 | 역할 | 공개 조건 |
|---|---|---|
| 제품 사이트 `/start/` | 대표 소개·설치·호환성 주소 | 공개 버전이 없으면 다운로드 비활성 |
| GitHub Releases | 고정 버전 EXE·해시·서명·변경 기록 | 실제 Windows/Codex 검증과 서명 |
| Microsoft Store EXE | 정식 Windows 설치 입구 | 같은 앱 ID·사용자 설치·무인 설치·자체 서명 업데이트 검수 |
| AI 스킬/플러그인 | 기존 AI에서 호출하는 입구 | 로컬 설치 지원 범위와 신뢰 절차 명시, 디렉터리 별도 심사 |
| VS Code Marketplace | 추후 연결 편의 도구 | 해당 확장과 공개 연동 수단 검증 |
| Steam | 펫 꾸미기 수요 확인 후 검토 | 첫 업무 보조 제품에서는 제외 |

스토어 등록은 앱 연결 지원을 증명하지 않는다. 플러그인 등록도 데스크톱 설치나 훅 배포를 대신하지 않는다. 기존 공개 콘셉트 목업의 루트 주소는 보존한다.

## 연결 순서

1. Windows 로컬 Codex: 상태·작업 식별·준비 지침·설정 관측을 두 채팅에서 검증.
2. Work 로컬·Codex VS Code: 같은 도구의 호환성을 별도로 확인.
3. Claude Code: 공식 훅·스킬 중심. Desktop Code 탭과 VS Code도 각각 검수.
4. Antigravity: 상태·문맥·실제로 관측되는 사용량부터 검증.
5. 일반 웹·클라우드: 안내·프리셋부터. PC 로컬 연결 접근을 가정하지 않는다.

현재는 Codex 연결 코드와 격리 검사를 구현했다. 후속 서비스는 지원 카탈로그이며 연결 구현 완료로 표시하지 않는다. 모델·추론·Plan 모드·제출 보류·토큰·복귀는 각각 별도 증거가 필요하다.

별도 AutoPets 계정·유료 API·자체 채팅·Jev·추가 판단 모델을 만들지 않는다. 전체 대화와 쿠키를 수집하지 않는다. 절감률·품질 향상·유료 구독 비용 절약은 실측 전 홍보하지 않는다.

[구조와 배포 계약](../architecture/distribution.md) · [공개 전 검수](../testing/unified-distribution.md)

공식 근거: [기본 펫](https://learn.chatgpt.com/docs/pets), [플러그인](https://developers.openai.com/plugins/concepts/plugins), [Store EXE/MSIX 비교](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path), [Claude 스킬](https://code.claude.com/docs/en/skills), [Google 전환](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/).
