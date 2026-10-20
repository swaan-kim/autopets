# 모루 오픈캠퍼스 — 디자인 예시

새 시작 경험의 결과 미리보기용으로 직접 디자인한 가상 학과 행사 페이지입니다. AutoPets의 실제 실행 결과나 스킬 성능 비교 자료가 아닙니다. 기존 실행 증거 `../companion-v1/verified-web-result.webp`는 변경하지 않았습니다.

- `index.html`, `style.css`: 로컬 반응형 페이지. 외부 요청·스크립트·개인정보 수집 없음.
- `campus-day.webp`: 제작 시 이미지 생성 도구로 만든 가상 행사 이미지. 실제 인물·행사·학교를 표현하지 않음.
- `desktop.webp`: HTML의 1440×900 Chromium 렌더.
- `mobile.webp`: 동일 HTML의 390×844 Chromium 렌더.
- 글꼴: 로컬 Pretendard Variable v1.3.9. 라이선스는 `../fonts/pretendard/LICENSE`.

제작일: 2026-10-17. 내장 이미지 생성 도구 1회 사용(허용된 최대 2회 이내). 생성 원본을 WebP로 인코딩하고, HTML 렌더를 미리보기로 저장했습니다. 원본 이미지 파일은 제작 환경에 보존됩니다.

## 이미지 생성 프롬프트

Use case: photorealistic-natural. Asset type: local website hero photograph for a fictional university department open-campus festival. Create a polished editorial photograph, wide landscape 3:2. A sunny spring campus garden with a long communal table holding ceramic objects, sketchbooks, little sculptural student projects and flowers; a few young adult students in casual cream/blue clothing chatting and looking at projects in the middle distance. Lush soft green trees and a handsome pale university building in the background, beautiful afternoon sunlight, candid joyful mood, clear spacious composition, cinematic but natural premium lifestyle photography, subtle film grain, refined muted spring palette with warm sunlight. Main focus on the delightful communal campus atmosphere and table, students not looking into the camera. Avoid text, any typography, banners, logos, watermarks, fake UI, fake letterforms, oversaturated colors, clutter. High quality attractive photograph suitable for the large hero of a clean white event webpage. This is a fictional design example, no real identifiable people.

## 확인

데스크톱·모바일의 이미지와 로컬 글꼴 로딩, 가로 넘침 없음, 방문 안내 앵커 이동을 확인했습니다. 브라우저 예시는 실제 신청이나 실행을 제공하지 않으며, 실제 AI 시험 턴을 사용하지 않았습니다.

앱의 ‘크게 보기’는 실제 HTML 렌더에서 저장한 캡처를 표시합니다. 네이티브 앱은 CSP의 `frame-src 'none'`을 유지하므로 HTML iframe을 삽입하지 않았습니다. 독립 HTML 파일은 로컬 브라우저에서 열어볼 수 있고, 이 예시를 보기 위해 보안 정책을 변경하지 않습니다.
