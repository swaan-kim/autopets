# 펫 준비 화면 간소화와 AI 연결 경로 확인

담당 @swaan-kim · [Issue #29](https://github.com/swaan-kim/autopets/issues/29). 기준 소스 `677d6e4c9d918c4032fc1c5955329ffd17220906`. 이 기록은 이번 작업의 화면 검사와 연결 조사이며 설치·실제 AI 활용·사용자 편익 판정과 구분한다.

## 바뀐 화면

채팅이 없어도 기존 저장 API로 **펫 만들기**를 할 수 있다. 연결된 Codex 대상이 있으면 선택 → 적용 → 별도 재조회로 확인 → 해당 채팅 열기 순서다. 기본 화면의 반복 연결 안내·스킬 호출 문장·중첩된 상세 메뉴를 제거하고 설정/직접 요청을 한 개의 편집 창으로 옮겼다. 스킬 원본·개정·이용 조건은 설정에서 유지한다.

연결이 없는 상태의 기본 화면은 같은 가상 데이터와 992×688, 배율 1에서 표시 문자가 194자에서 52자로 줄었다. 글자 수는 사용자 이해도나 편익의 통과 근거가 아니다.

| Before | After |
| --- | --- |
| ![기존 펫 준비 화면](../changes/29/before.png) | ![간소화한 펫 준비 화면](../changes/29/after.png) |

모두 **합성 UI 검사**다. 동일 이미지 예시를 선택한 상태이며 설치 앱의 실제 연결 성공 자료가 아니다. [저장 후](../changes/29/saved.png), [설정](../changes/29/settings.png), [직접 요청](../changes/29/request.png), [채팅 선택](../changes/29/selected.png), [적용 확인](../changes/29/applied.png), [합성 동작 영상](../changes/29/quick-use-flow.webm).

## 실제 앱에서 확인한 범위

| 환경 | 이번 관측 | 아직 확인하지 못한 부분 |
| --- | --- | --- |
| 설치된 AutoPets 검토판 | 기존 `feed9cd` 앱 실행, 읽기 기능 응답, 저장한 펫 목록 접근 가능 | 이번 UI는 아직 설치되지 않음. 기존 사용자 저장 내용은 수정하지 않음 |
| Codex URI를 처리하는 Windows 앱 `26.1029.7803.0` | 분리된 시험 폴더와 고정 시험 문구로 공식 새 채팅 링크를 한 번 열었고 해당 폴더의 신뢰 화면 도달 | 사용자가 직접 신뢰를 승인하기 전 중지. 입력란의 문구·한글 보존·전송·스킬 읽기·현재 일반 입력 전체 흐름 미확인 |
| Claude Desktop `4.16336.0.0` | 설치 확인 후 앱 열기와 새 세션 화면 확인 | 창 초점 획득 실패로 설정 조작을 중지. 확장 설치·권한·기존 대화에서 펫 읽기·결과 품질 미확인 |

제품 AI 요청 **0회**, 제작용 이미지 생성 **0회**, 자동 전송 **0회**. 앞선 작업의 AI 시험 원장과 제작 이력은 소급 수정하지 않는다. 원본 앱 화면·대화·개인 경로·진단은 공개 자료에 포함하지 않는다. 앱 시작이나 링크 처리만으로 연결 통과를 선언하지 않는다.

## 복사 없는 경로와 한계

1. **기존 Codex 채팅:** 현재 등록된 정확한 대상에 펫 설정을 적용하고 `codex://threads/<thread-id>`로 복귀하는 기존 계약을 유지한다. 대상 ID·폴더·개정·재조회·A/B 격리·중복과 늦은 응답 방지를 이번 합성 검사에서도 확인했다. 등록되지 않은 임의의 열린 채팅은 추측해 선택하지 않는다.
2. **Codex 새 채팅:** 공식 문서는 `codex://threads/new?prompt=…&path=…`를 제공한다. `prompt`는 입력란 초기값이고 전송이 아니다. 이번 로컬 시제품은 신뢰 화면까지 확인했으며 제품 버튼으로 활성화하지 않았다. 새 채팅은 기존 채팅의 맥락 공유를 해결하지 않는다. [OpenAI 공식 명령 문서](https://learn.chatgpt.com/docs/reference/commands#chats).
3. **Claude Desktop:** 기존 읽기 전용 `.mcpb`를 한 번 설치하고 `autopets_list_pets` → 정확한 개정의 `autopets_read_pet`으로 지침을 가져오는 경로가 가장 작은 후속 검증 후보다. 공식 설치 위치는 Settings → Desktop app → Extensions의 Manage → Advanced settings → Install Extension이다. 앱에 표시한 **Claude 연결 파일**은 기존 내보내기 기능이며 설치나 연결 완료를 뜻하지 않는다. [Claude 로컬 확장 설치](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop), [로컬 확장과 원격 연결의 차이](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors).
4. **ChatGPT 웹/Work:** 로컬 STDIO 패키지만으로 클라우드에 연결되지 않는다. 공식 Secure MCP Tunnel은 사설 MCP에 대한 후보지만 Platform 설정·터널 키·권한·호스트 연결 검증이 필요하다. 공개 플러그인 배포도 별도 조건이다. 이번에는 서버·키·계정·지원 플래그를 변경하지 않았다. [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).
5. **Gemini:** CLI에는 로컬 MCP 설정 경로가 있다. 웹 Gemini에는 Connected Apps Platform의 원격 MCP 경로가 있으며 공식 가이드는 공개 HTTPS endpoint와 Developer Mode 검증, 등록·인증·게시 단계를 구분한다. 로컬 `.mcpb`와 동일한 설치 경로로 취급하지 않는다. 이번에는 Gemini 앱·계정·서버를 변경하지 않았다. [Gemini CLI MCP](https://geminicli.com/docs/tools/mcp-server/), [Google Connected Apps MCP 가이드](https://developers.google.com/connected-apps/mcp/).

현재 MCP는 선택한 펫의 **설정과 스킬 참조**를 읽는다. 스킬 본문을 실제 읽은 근거·실제 실행·모델 변경·다른 AI의 작업 상태 관측·전체 대화 공유·정확한 Claude/Gemini 채팅 복귀를 제공했다고 표시하지 않는다. 서로 다른 AI에서 같은 지침을 재사용하는 것과 대화 맥락을 공유하는 것은 별도로 검증한다.

## 검사

- `pnpm build`: 통과. TypeScript와 Vite production build, 기존 MCPB 패키징.
- `pnpm test`: 281개 중 280개 통과, 실제 미서명 설치 파일을 명시하지 않은 감사 1개 건너뜀. 실패 0개.
- `pet-quick-use-ui.cjs`: 미연결 저장, 실패·연속 클릭, 설정/직접 요청 전환, Escape 초점 복귀·키보드 가두기, 초안 보존, 992×688·661×459·375×812, 내보내기 오류/중복 통과.
- 기존 상세 UI 검사: 6개 역할의 원본·라이선스, 개정 충돌, 재선택 초점, 클립보드 실패, 지원하지 않는 조합, A 적용/B 보존 통과.
- `pnpm test:ui`: 전체 UI, 가상 사용자 검수 화면, 오프라인 패키지 검사 통과. 페이지 오류·패키지 외부 요청 0개. 초기 전체 검사에서 이전 접힌 메뉴/배경 버튼을 전제로 한 항목이 실패해 새 편집 창 순서로 수정했고, 개정 복구 초점의 비동기 반영을 기다린 뒤 확인하도록 고쳤다. PR 형식은 연결 PR의 최종 소스 기준 결과로 확인한다.
- 저장소 구조·문서 상대 링크 검사 통과. 검수 패키지 빌드의 폰트 경로 경고는 실행 시 로컬 파일로 해결되며 오프라인 검사에서 `fontLoaded: true`를 확인했다.
- 영역 검사: `pet-selection`의 기존 등록 파일들과 `home`의 화면 단순화 검사 통과. 연결 내보내기 컴포넌트·공통 검사 도우미·신규 UI 검사는 Issue의 통합 담당 범위다.
- Rust·API·DB·CI·의존성·설치본은 변경하지 않아 Rust 검사·재설치·배포를 수행하지 않았다. 작은 화면 검사는 브라우저 배치 검사이며 Windows 실제 DPI 검증이 아니다.

## 바로 다음 행동

Codex의 시험 폴더 신뢰는 사용자가 직접 확인한다. 승인 후 시험 문구가 보내지지 않은 입력란에 정확히 들어가는지부터 확인하고, 기존 설치판/설정이 일치하는 분리 시험에서 명시적 스킬 호출 → 정확한 대상 적용 → 같은 채팅의 일반 입력 → 복귀를 순서대로 관측한다. 결과를 모른 채 중복 요청하지 않는다.

Claude는 사용자가 앱을 앞으로 가져온 뒤 기존 MCPB의 설치 확인 화면을 준비하고, 권한 확인은 사용자가 한다. 이후 합성 펫의 목록·정확한 개정 읽기만 먼저 검증한다. 기존 대화 본문을 수집하거나 공개하지 않는다.

새 호스트 지원 활성화, 자동 요청 전달, 원격 MCP/터널 배포 또는 대화 맥락 공유의 계약은 사람 회의의 결론·이유·범위·참여자·날짜를 Issue #29에 기록한 뒤 해당 구현만 진행한다. 현재 화면 정리·기존 저장/적용·공식 조사와 독립 검사는 계속할 수 있다. 구현·병합·설치·배포·사용자 편익을 각각 구분한다.
