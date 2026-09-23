# AutoPets 소개 화면과 펫 자산 재생성

> 자료 범위 · 2026-09-23: 아래 v4는 과거의 상태 확인 중심 콘셉트다. 토큰 알림과 작업 복귀 장면은 시연이며, 최신 제품 전체의 지원 목록이 아니다. 원본과 공개 목업은 보존한다. 현재 제품·후속 PR·실증 과제는 [팀 공유 요약](../product/team-brief.md)과 [진행 현황](../roadmap/project-status.md)을 따른다.

이 폴더에는 원본 그림, HTML 템플릿, 재조립 스크립트가 들어 있습니다. 아래 명령과 경로는 공개 저장소의 루트를 기준으로 합니다. v4 재생성은 포함된 `sprite-source.png`와 `motion-sources/`의 PNG 5개를 사용합니다. ImageGen 호출, API 키, 제작자의 PC 경로, 외부 참고 이미지가 필요하지 않습니다. 앱 실행 중에는 이 제작 도구를 사용하지 않습니다.

## 홍보물 v4

기존 대기·조사·작성 8프레임에 고민·도구 사용·어지러움·오류·기쁨을 각각 2프레임씩 추가하여 **홍보용 18프레임**을 구성합니다. 새 그림의 제작 도구는 ImageGen이며 완성된 5개 원본을 소스에 포함합니다. 런타임에는 저장된 모션만 재생합니다. 3번 장면은 어지러운 펫에서 출발해 사용 기준 확인, 시연용 작업 복귀, 결과물과 기쁨 모션으로 마무리합니다. 화남은 오류 전용이며 사용량 증가에 연결하지 않습니다.

첫 화면은 1280×800 가로 구성의 그림 소개입니다. `00-overview-wide.png`는 **“AI는 맡겨두고, 내 일에 집중하세요.”**라는 제안과 큰 업무 장면, 세 가지 편리함, 전체 사용 흐름을 한 화면에 담습니다. `01-overview.png`는 같은 소개의 세로판, `02-user-flow.png`는 결과물까지 이어지는 이야기, `03-benefits.png`는 사용자가 얻는 편의를 보여주며 세로 세 장은 각각 1080×1350입니다. 모션 상태표 한 장을 추가하며 최신 자료 묶음은 `AutoPets-promo-v4.zip`입니다. 상단 **직접 체험하기**와 첫 장의 편리함 카드가 클릭 목업으로 연결됩니다.

로고 원본은 `apps/desktop/public/assets/brand/autopets-mark.svg`입니다. 템플릿의 `__BRAND_MARK__` 위치에 빌드 스크립트가 같은 SVG를 삽입하므로 원본 한 곳을 고치면 소개·체험 화면에 함께 반영됩니다. 워드마크 및 PNG 배포본도 같은 brand 폴더에 있습니다. 로고는 코드로 만든 벡터이며 이번 수정에서 ImageGen을 추가 호출하지 않았습니다.

## 준비와 재생성

저장소 루트에서 Node.js 24와 pnpm 11.19.0으로 실행합니다. 이 폴더는 pnpm workspace에 포함되며 제작용 Sharp 의존성도 루트 `pnpm-lock.yaml` 하나로 관리합니다. 재생성에는 별도의 npm 설치나 잠금 파일 생성이 필요하지 않습니다.

```sh
pnpm install --frozen-lockfile
node docs/design-source/build-assets.cjs --plan
node --test docs/design-source/build-assets.test.cjs
node --test docs/design-source/demo-model.test.cjs
node docs/design-source/build-assets.cjs --check
```

`--plan`은 입출력 위치만 출력합니다. `--check`는 모든 산출물을 메모리에서 계산해 현재 파일과 바이트 단위로 비교하며 파일을 쓰지 않습니다. 차이가 있거나 파일이 없으면 종료 코드 1과 해당 경로를 반환합니다.

템플릿이나 원본 아틀라스를 수정한 뒤 다음 명령으로 실제 산출물을 갱신합니다.

```sh
node docs/design-source/build-assets.cjs
```

출력은 저장소 루트 기준 다음 31개 파일로 고정됩니다. 네이티브 앱용 10개 파일은 기존 알고리즘과 바이트를 유지하며, 홍보용 아틀라스와 구분합니다. 실행한 터미널의 현재 폴더에 영향을 받지 않습니다.

| 출력 | 내용 |
| --- | --- |
| `apps/desktop/public/assets/pet/frame-0.png` … `frame-7.png` | 64 × 64 RGBA 프레임 8개 |
| `apps/desktop/public/assets/pet/sprite.png` | 256 × 128 런타임 아틀라스 |
| `apps/desktop/public/assets/pet/manifest.json` | 프레임 순서, 기준선, 원본 내용 경계 |
| `docs/demo/assets/frame-0.png` … `frame-17.png` | 홍보용 64 × 64 RGBA 프레임 18개 |
| `docs/demo/assets/promo-sprite.png` | 홍보용 256 × 320 RGBA 아틀라스, 4열 × 5행 |
| `docs/demo/assets/promo-motion-manifest.json` | 홍보 모션 설정, 원본 해시, 공통 crop·기준선 검증 기록 |
| `docs/demo/index.html` | 홍보 PNG data URL과 모션 설정을 내장한 단일 오프라인 HTML |

스크립트는 원본 PNG, 모션 설정, 템플릿, `docs/images/` 소개 PNG, 기존 개념 시연 폴더의 완성 HTML을 덮어쓰지 않습니다. 모든 입력과 산출물을 검증한 뒤 명시된 출력만 씁니다. 별도 위치의 원본을 사용하려면 `--source <atlas.png>`와 `--motion-source-dir <pair-png-directory>`, 복사된 제작 폴더에서 특정 저장소에 출력하려면 `--repo-root <repository-directory>`를 명시할 수 있습니다. 대상 저장소의 `package.json` 이름이 `autopets-local`인지 확인합니다.

별도 개념 시연 폴더에 제작 소스를 복사할 때는 원본 6개 PNG, 모션 설정, 템플릿을 함께 보관합니다. 공개 저장소를 함께 준비하고 제작 의존성을 설치한 뒤 `node <concept-directory>/build-assets.cjs --repo-root <repository-directory> --check`처럼 실행할 수 있습니다. 이때 입력은 제작 스크립트의 폴더에서 읽고, 출력은 지정한 저장소의 위 31개 경로로 향합니다.

## 수정할 소스

- `index.template.html`: 소개 문구와 시연 동작. `__SPRITE_DATA__`와 `__MOTION_MANIFEST__` 표식을 각각 정확히 한 번 유지하세요. 완성된 HTML을 직접 편집하면 다음 재생성 때 사라집니다.
- `sprite-source.png`: ImageGen에서 이미 생성한 4열 × 2행 아틀라스입니다. 사용자가 처음 제공한 참고 이미지와는 다른 파일입니다.
- `motion-sources/{thinking,tool,dizzy,angry,celebrate}.png`: 각 모션의 새 ImageGen 원본. 각각 좌우 2프레임과 실제 투명 배경을 갖춥니다.
- `promo-motion-config.json`: 8개 모션의 프레임·재생 속도·대표 정지 프레임·상태 문구를 관리합니다.
- `build-assets.cjs`: 기존 프레임의 팔레트 64색·디더링 없음 설정과 결과 바이트를 유지합니다. 새 모션은 두 포즈의 공통 경계에 같은 축척·위치를 적용하여 움직임을 보존하고, 긴 변 52px·기준선 60의 64px 셀로 조립합니다. 홍보 아틀라스는 재양자화 없이 RGBA 픽셀을 복사하며 새로운 포즈를 만들지 않습니다.
- `asset-provenance.md`: 생성 경위, 포함 파일, 검증 기준. 외부 참고 이미지와 대화 공유 URL은 패키지에 포함하지 않습니다.

0–3번은 idle, 4–5번은 research, 6–7번은 writing, 8–9번은 thinking, 10–11번은 tool, 12–13번은 dizzy, 14–15번은 angry, 16–17번은 celebrate입니다. 네이티브 앱의 기존 자산과 상태 타입·토큰 기능은 확장하지 않습니다. 출력의 바이트 재현성을 점검할 때는 잠금 파일과 같은 Sharp 버전을 사용하세요. 플랫폼별 이미지 라이브러리 차이로 바이트가 달라지면 프레임 크기·투명도·기준선과 화면도 확인한 뒤 변경을 검토합니다.

## 브라우저 시연과 소개 이미지

완성된 `docs/demo/index.html`은 외부 글꼴이나 원격 자산을 불러오지 않는 오프라인 목업입니다. 실제 Codex에 연결하거나 앱의 작업 상태 저장소를 변경하지 않습니다. 토큰 `10,400 / 10,000`은 실제 사용량·권장 예산이 아니며 수치 옆에 시연 데이터라고 표시합니다. 사용 기준 알림으로 시연의 작업이 중단되지는 않습니다. 데모의 작업 복귀·완료 화면은 시연이며 실제 지원 범위는 앱 문서와 구현을 기준으로 확인합니다.

다음 서버는 완성된 HTML 한 페이지만 loopback 주소로 제공합니다.

```sh
node docs/design-source/preview-server.cjs
```

- 기본 시연: `http://127.0.0.1:4318/`
- 가로 소개: `http://127.0.0.1:4318/?poster=1&layout=wide`를 확대 100%, 폭 1280 CSS px에서 1280 × 800 PNG로 내보내 `docs/images/00-overview-wide.png`로 저장합니다.
- 세로 소개 1·2·3과 모션 상태표 4: `http://127.0.0.1:4318/?poster=1`에서 마지막 번호를 바꿉니다. 상태표는 `04-motion-states.png`로 저장합니다.
- 세로 소개는 확대 100%, 폭 1080 CSS px에서 1080 × 1350 영역을 PNG로 내보냅니다. `docs/images/`의 가로 한 장과 세로 세 장은 브라우저 검수 후 별도로 갱신하며 자산 빌드 명령에 포함되지 않습니다.
- 포트가 사용 중이면 `PORT` 환경 변수에 다른 포트를 지정합니다. 서버는 `127.0.0.1`에만 바인딩합니다.

제작 당시 Windows 디스플레이 배율 150%의 특정 영역 내보내기 도구가 렌더링을 2/3로 축소하는 현상이 있었습니다. 그 환경에서만 `?poster=1&capture=windows150`로 HTML 줌 1.5 보정을 적용했습니다. 일반 브라우저에서는 이 보정을 사용하지 않습니다. 당시 최종 소개 PNG는 정상 캡처된 1080 × 1320 영역을 유지하고 화면과 같은 `#f8f5fc` 배경의 하단 여백 30px을 추가했습니다. 같은 캡처 문제가 없으면 1080 × 1350을 그대로 내보내면 됩니다.

v4의 같은 세로 캡처 보정에서는 첫 장의 배경색 `#fffdf7`, 2·3·4장의 배경색 `#fcfaf5`를 사용합니다. 결과는 각각 1080 × 1350 PNG입니다. 첫 장의 가로판은 1280 × 800으로 별도 출력합니다. 최초 3장의 이전 그림은 기록으로 남겨 두며 현재 소개에는 overview-wide·overview·user-flow·benefits·motion-states 파일을 사용합니다.

## 검증 체크

1. 조립 테스트가 네이티브 원본 동일성, 공통 축척과 움직임 보존, 18프레임 순서, 투명 빈 셀, 잘못된 입력 거부를 확인하고 `--check`가 31개 파일 일치로 종료되는지 봅니다.
2. 네이티브 아틀라스는 256 × 128, 홍보 아틀라스는 256 × 320이며 각 프레임은 64 × 64인지 확인합니다.
3. 작은 크기에서 고민·도구·어지러움·오류·기쁨이 구별되고 투명 배경·발 기준선·잘림이 없는지 확인합니다. 움직임 줄이기 설정에서도 대표 정지 프레임과 문구로 상태를 알 수 있어야 합니다.
4. 조사 → 작성 → Notion 정리 → 완료의 흐름, 예시 결과물, 클릭한 작업으로만 복귀, 알림 중복 방지, 다시 시작 초기화를 확인합니다.
5. 가로 소개 한 장과 세로 포스터 세 장 및 모션 상태표의 글자·캐릭터·하단 문구가 잘리지 않았는지 브라우저에서 확인합니다.
6. 프런트 변경을 함께 했다면 저장소 루트에서 `pnpm build`와 UI 테스트를 실행합니다. 홍보 제작 소스만 바꿀 때는 네이티브 앱 실행이 필요하지 않습니다.
