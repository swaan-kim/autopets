# 구현 순서와 현재 관문

승인된 방향: [제품 정의](../product/direction.md), [목표 구조](../architecture/layout.md).

GitHub 관리: [Milestones](https://github.com/swaan-kim/autopets/milestones) · [M0 #1](https://github.com/swaan-kim/autopets/issues/1) · [M1 #2](https://github.com/swaan-kim/autopets/issues/2) · [M2 #3](https://github.com/swaan-kim/autopets/issues/3) · [M3 #4](https://github.com/swaan-kim/autopets/issues/4) · [M4 #5](https://github.com/swaan-kim/autopets/issues/5) · [M5 #6](https://github.com/swaan-kim/autopets/issues/6) · [M6 #7](https://github.com/swaan-kim/autopets/issues/7).

현재 M0 기반을 정리했고 M1 검증을 진행 중이다. 실제 설치·앱 실행·인증된 로컬 브리지 응답을 확인했다. Codex 실행 파일을 별도 실행하는 진단은 접근 거부로 실패했다. 실제 Desktop 훅 전달과 두 채팅의 맥락 기록은 아직 미검증이다.

**M1 통과 전 M2–M6 기능 확장은 진행하지 않는다.** 수동 실행·시험 서버·훅 stdout을 자동 연결 성공으로 표시하지 않는다. 다음 작업은 [M1 검증 절차](../testing/m1-runbook.md)다.

| 단계 | 결과물 | 선행 조건 | 완료 기준 |
| --- | --- | --- | --- |
| M0 개발 기반 | 정식 체크아웃, 제품·구조·검증 문서, Milestone/Issue | 없음 | 각 작업에 결과물·선행 조건·검수 기준 존재 |
| M1 자동 연결 검증 | Windows 실행 증거, 분리된 준비 훅 진단, 두 채팅 기록 | M0 | 스킬 수동 호출 없이 실제 두 채팅에서 지침 전달·맥락 기록 및 격리 확인 |
| M2 구조 정리 | apps/integrations/packages 분리, 계약, DB 이관 | M1 통과 | 기존 데이터·펫·설정·공개 데모 보존, 회귀 검사 통과 |
| M3 핵심 도움 | 자동 준비·명시적 선호·현재 채팅 기록·세 작업 방식 | M2 | 최신 조건 반영, 다음 메시지 적용, 수정·끄기·삭제, 실패 표시 |
| M4 펫 경험 | 18프레임·짧은 문구·단계·확인·오류·복귀 | M3 | 두 작업 구별, 4번째 작업 보존, 알림 중복 방지, 올바른 복귀 |
| M5 설치와 알파 | 의존성 패키징·연결 복구/제거·시연·인터뷰 자료 | M4 | 실제 Windows 검수, 본인+3–5명 테스트용 배포 준비 |
| M6 지원 확대 | Chat·Work 지원표와 자동 연결 검증 | M5 | 환경별 실측 통과 기능만 활성화 |

## Issue 작성 기준

각 Issue에 사용자 결과, 구현 결과물, 선행 Issue, 검수 체크리스트, 근거 링크, 남은 제한을 기록한다. 완료하지 않은 관문을 체크하지 않는다. 로컬 경로·채팅 본문·인증 정보는 공개 Issue에 첨부하지 않는다.

## 후속 단계의 검수 항목

- M2: 데이터/위치 이관, 루트 개발 명령, UI·Rust·Node 검사, Pages/홍보 제작 경로, 이전 승인 실험 분리.
- M3: 첫 opt-in, 채팅별 off, 공통 선호만 재사용, 최신 조건 우선, 로컬 저장/전달 구분, 변경 없는 내용 재주입 방지, 입력 3KB 상한, 일반 작업을 막지 않는 오류 처리.
- M4: 진행·행위·확인 사유·모션 분리, 오류 전용 화남, 실제 토큰 미지원 시 비활성, 10분 단발 알림, 새 작업·재시작·이벤트 중복/순서 변화.
- M5: 설치·재실행·복구·제거, DPI 100/150/200%, 다중 모니터, 절전, 포커스, 움직임 줄이기, 서명 상태와 실행 허용 분리.
- M6: 훅 배포 위치·trust·채팅 ID·자동 주입·동기화·복귀·사용량을 환경마다 확인. 미지원은 안내만 제공.

Jev는 기본 의존성이 아니다. 반복적인 안내 판단 문제가 확인된 경우에만 별도 한국어 평가로 비교한다. 사용자 모집·발송은 수행하지 않는다.
