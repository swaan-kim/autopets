# 환경별 지원 상태

| 환경 | 구현한 연결부 | 자동 지침·기록 | 실제 모델 변경 | 작업별 토큰 |
| --- | --- | --- | --- | --- |
| Windows 로컬 Codex | opt-in 준비 훅·정상 턴 기록 helper | fixture 검수, 실제 연결 미검증 | 미지원·비활성 | 미지원 |
| Windows Chrome의 ChatGPT | 확장·Native Messaging 상태 조회, 입력 보존 실험 | 실제 입력 조작·기록 전달 비활성 | 미검증·비활성 | 미지원 |
| ChatGPT 데스크톱·Work·다른 브라우저 | 공통 계약·안내 | 미검증 | 미검증 | 미검증 |

2026-09-21 소스 기준이며 이번 변경에서 실제 설치는 하지 않았다. [연결부와 검증 패키지](../README.md), [검수와 남은 관문](../../../docs/testing/assistance-implementation.md)을 참고한다. 모든 런타임 capability는 false이며 로컬 설정 저장을 서비스 적용으로 표시하지 않는다. 정확한 작업 복귀가 확인되지 않으면 ID 복사를 사용한다.

제품 대상과 현재 구현 지원은 다르다. 웹에서 플러그인을 설치했다고 실행 환경에 훅 스크립트가 배포된 것으로 간주하지 않는다. 기존 Desktop 작업을 별도 app-server 프로세스가 관측할 수 있다고 가정하지 않는다. [플러그인 문서](https://learn.chatgpt.com/docs/plugins), [훅 문서](https://learn.chatgpt.com/docs/hooks).

M6에서는 설치 환경·제품 버전·채팅 유형·관측 이벤트·전달/응답 증거·제한을 기록한 뒤 통과한 기능만 활성화한다.
