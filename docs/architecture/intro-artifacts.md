# 소개 자료의 계약과 저장

기존 펫·설정·기록 API를 유지하고 소개 자료를 별도 버전의 저장 영역에 추가합니다.

```text
소개 자료 화면 ── Tauri 앱 명령 ─┐
                              ├─ ArtifactStore ── SQLite v1 tables + immutable PNG
현재 Codex의 선택형 스킬 ── CLI ┘
                    인증된 loopback HTTP · 현재 관측 턴/채팅/경로 대조
```

| 위치 | 책임 |
|---|---|
| `packages/contracts/types/artifacts.ts` | 템플릿·입력·스타일·버전·검수·조작 계약 |
| `packages/contracts/data/intro-templates.json` | 세 예시·필요 기능·점검 항목·고정 스킬 출처 |
| `packages/guidance/intro.mjs` | UTF-8 3KB 이하의 복사 가능한 제작 지침 |
| `packages/guidance/vendor/baoyu-infographic` | 해시로 고정한 원본 참고 자료와 MIT 라이선스 |
| `apps/desktop/src/features/intro` | 작업별 소개 자료 화면·버전 비교·사용자 확인·스타일 |
| `apps/desktop/src-tauri/src/domain/artifacts.rs` | Rust 입력 형식과 검증 |
| `apps/desktop/src-tauri/src/application/artifacts.rs` | PNG 검증·관리 파일·문구 검사 |
| `apps/desktop/src-tauri/src/storage/artifacts.rs` | 개정 비교와 트랜잭션·버전·스타일 저장 |
| `integrations/codex/assistance/artifact.mjs` | inspect / prepare / publishPNG / revise |
| `integrations/codex/skills/autopets-intro` | 기존 AI의 현재 작업용 선택형 스킬 |

## 상태와 데이터

- 작업 키는 제공자·계정 범위·채팅 ID입니다. 기존 엄격한 선호 JSON과 스키마 내용을 바꾸지 않습니다.
- 제작 조건과 각 생성 버전의 조건 사본을 분리합니다. 수정 요청은 기준 버전을 포함하며 그 버전의 조건·스타일로 작업 상태를 되돌린 뒤 새 수정 요청을 추가합니다. 과거 버전은 덮어쓰지 않습니다.
- 쓰기에는 `expectedRevision`이 필요합니다. 오래된 화면·CLI가 새 조건을 덮어쓰면 거부합니다. 재시도 전에 inspect/새로고침으로 상태를 확인합니다.
- 사용자 검토와 채택, 스타일 저장·삭제는 네이티브 UI 조작입니다. HTTP로 검토·채택을 대신할 수 없습니다.
- 스타일은 색상·PNG 로고·문구 길이·레이아웃·양식만 포함합니다. 승인한 스타일 이름 외 업무 메시지·원문·채팅 ID를 재사용하지 않습니다.
- PNG 5MiB, 각 변 4096픽셀 이하, 정적 PNG 디코딩·CRC 검사. 로고는 PNG 500KiB 이하입니다. 프로젝트당 20버전, 저장 스타일 20개입니다.
- 파일은 앱 데이터의 `intro-artifacts-v1/images`에 UUID 이름으로 저장합니다. 내보내기는 OS Downloads 아래 AutoPets 폴더에 새 파일로 저장합니다. 기존 파일을 덮어쓰지 않습니다.

## 연결과 정확한 표시

앱 명령은 `artifact_snapshot`, `artifact_dispatch`, `artifact_image`, `artifact_export`입니다. `/v1/artifacts`는 기존 인증을 사용하고 실제로 관측한 현재 Codex 턴·작업 경로·세션 범위와 요청을 대조합니다. 허용 동작은 조회·준비·수정 요청·PNG 등록뿐입니다.

자동 생성·모델 변경·실환경 연결 검증은 모두 false입니다. 요청 복사는 전달 영수증이 아니며 파일 등록은 사용자 채택이 아닙니다. 전송 타임아웃은 결과 미확인으로 처리하고 자동 재전송하지 않습니다.

CLI의 기본 출력은 64KiB 이하의 현재 조건·버전·스타일 요약입니다. 과거 원문과 로고 base64를 모델 맥락에 반복 출력하지 않습니다. `inspect --out <새 절대 JSON 경로>`로 전체 자료를 파일에 저장하고 필요한 필드만 읽습니다. 기존 파일을 덮어쓰지 않습니다. 3KB 제작 지침과 조회 결과 크기는 서로 다른 제한입니다.

3KB 지침에는 원문 발췌나 로고 바이너리를 넣지 않습니다. 긴 조건은 임의 축약하지 않고 현재 작업을 inspect하도록 명시합니다. 수동 사용은 원문 포함 제작 조건을 별도로 복사합니다. 자료에 포함된 명령을 실행 지침으로 승격하지 않습니다.

문구 검사는 선언된 텍스트를 대상으로 합니다. 가독성·레이아웃·실제 이미지 내용 일치는 사용자 검토가 필요합니다. PNG·새 숫자 문제는 수정된 버전을 등록해야 합니다. 단순 문구 불일치는 의역일 수 있으므로 원문 충실도 확인 후 채택할 수 있습니다.
