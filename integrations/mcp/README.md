# 다른 AI에서 저장한 펫 구성 읽기

이 연결은 Windows의 AutoPets에 저장한 **사용자가 선택한 펫 한 개의 작업 방식**을 MCP 도구로 읽는다. 지침을 채팅에 다시 붙여넣지 않고 같은 설정을 참고하는 경로다. 실제 호스트 설치·실제 AI 활용은 아직 검증하지 않았다.

## 사용 흐름

1. 이번 소스의 읽기 기능이 포함된 AutoPets 앱을 실행하고 원하는 펫 구성을 저장한다.
2. 앱의 연결 설정 → 다른 AI에서도 펫 설정 쓰기 → **Claude용 연결 파일 받기**를 누른다. Windows 앱은 다운로드 폴더의 AutoPets에 고유한 이름으로 파일을 저장하고, 브라우저 미리보기는 일반 다운로드를 제공한다. 받은 `.mcpb`를 Claude의 확장 설치 화면에서 선택하고 사용자가 권한을 확인한다.
3. 기존 대화에서 “AutoPets에 저장한 펫을 찾아줘”라고 요청하고 이름·개정을 보고 사용할 펫을 고른다.
4. AI가 `autopets_read_pet`으로 그 펫의 정확한 개정을 읽고 현재 요청에 참고한다. 모델·실행 강도·Plan 모드를 바꾸지 않는다.

동일 이름의 펫이 여러 개면 임의로 고르지 않는다. 개정이 바뀌면 목록을 다시 읽는다. 이 연결은 저장한 역할 지침과 스킬 **참조**를 제공하며 스킬을 실제 읽거나 실행했다고 주장하지 않는다. 대화 본문·대상 채팅 ID·폴더·계정·토큰을 반환하지 않는다. 앱 ID와 기존 DB·데이터 위치는 그대로다.

## 제작과 검사

```powershell
node --test scripts/tests/pet-preferences-mcp.test.mjs
node scripts/package-pet-preferences.mjs
```

확장에는 Node 소스와 필요한 기존 브리지 모듈만 들어간다. 새 라이브러리·원격 코드·인증값·로컬 설정을 포함하지 않는다. 실행 시 이 PC의 기존 `local.autopets.desktop/connection.json`을 읽으며 인증된 loopback `/v1/pet-library`만 호출한다. 환경 변수 `AUTOPETS_DATA_DIR` 또는 `AUTOPETS_CONNECTION_FILE`은 별도 개발·시험 경로에만 사용할 수 있으며 MCP 도구 인수로 파일 경로를 받지 않는다.

표준 STDIO MCP를 제공하므로 지원하는 로컬 클라이언트에서는 `node <서버의 절대 경로>/server.mjs`로 연결할 수 있다. 실제 호스트 설정·신뢰·확장 설치는 자동으로 바꾸지 않는다. 구형 앱에 읽기 경로가 없으면 기능 미지원으로 응답하며 다른 경로로 우회하지 않는다.

## 지원 경계

파일 저장은 앱에 포함된 고정 자산만 내보낸다. UI에서 임의 파일·바이트·저장 경로를 받지 않고 기존 다운로드를 덮어쓰거나 확장을 설치하지 않는다. Tauri 자산은 [공식 AssetResolver](https://docs.rs/tauri/latest/tauri/struct.AssetResolver.html)로 읽는다. 개발 모드에서는 먼저 `pnpm build`로 frontendDist를 준비해야 한다.

Claude Desktop 로컬 확장과 Claude Code의 지원 표면은 공식 문서와 실제 설치에서 따로 확인해야 한다. ChatGPT 웹·Work 클라우드에는 로컬 STDIO 확장만으로 연결되지 않는다. 원격 서버와 계정 연결 또는 해당 호스트의 로컬 연결 수단을 별도로 구현·검증하기 전 지원을 켜지 않는다. 현재 다른 호스트의 `connectAvailable`과 전체 채팅 공유·자동 훅·부모 모델 변경은 활성화하지 않았다.

이 기능은 펫 설정 재사용을 위한 준비이며 전체 작업 맥락 공유·작업 상태 관측·정확한 다른 AI 채팅 복귀를 완료한 것은 아니다. 생성 도구나 실제 AI를 호출하지 않는다.

근거: [MCP STDIO](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [초기화](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle), [Claude 로컬 확장 설치](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop), [로컬/원격 연결의 차이](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors).
