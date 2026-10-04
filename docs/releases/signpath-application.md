# SignPath 신청 전 확인 자료

상태: **2026-10-05 갱신한 미제출 초안**. 프로젝트 소유자의 연락처, 서명 승인 담당자, 활동 이력은 본인이 확인해야 한다. 계정 생성·약관 동의·외부 연락·프로젝트 권한 부여를 수행하지 않았다.

## 프로젝트 자료

- 이름: AutoPets
- 저장소: https://github.com/swaan-kim/autopets
- 라이선스: MIT. 선택한 frontend-design 스킬은 고정 원본과 Apache-2.0 라이선스 파일을 포함한다.
- 설명: 기존 로컬 Codex 채팅에 명시적으로 연결한 펫이 사용자가 맡긴 작업의 설정·진행·결과를 이해하기 쉽게 보여주는 Windows 앱.
- 배포 형태: Tauri Windows 앱, 현재 사용자용 NSIS EXE, 번들 Node.js 및 WebView2 설치 구성요소.
- 현재 검증: `a250f0c`의 [코드·설치·연결·복구·제거 CI](https://github.com/swaan-kim/autopets/actions/runs/37233967139), [현재 PC 업데이트·정상 종료·데이터 보존 기록](../testing/friendly-mvp.md). 현재 PC는 사용자가 Smart App Control을 끈 환경이며 보호가 켜진 PC의 통과 증거가 아니다.
- 게시된 배포: [v0.1.0-dev.20261005.1](https://github.com/swaan-kim/autopets/releases/tag/v0.1.0-dev.20261005.1). 미서명 개발 Pre-release이며 안정판이 아니다.
- 미확정 조건: 개발 Pre-release와 신규 프로젝트 활동 이력이 지원 심사에 충분한지, 서명 프로젝트/정책. 번들 WebView2 오프라인 설치 구성요소의 System Libraries 예외 해당 여부와 NSIS 외부 DLL의 허용·출처 검증 기준도 서비스에 확인해야 한다.
- 제출 전 본인 기입: 담당자 이름·이메일, 프로젝트 운영 시작일/활동 자료, 작성·검토·서명 승인 담당자, MFA 설정 확인.

## 문의 초안

Subject: Eligibility inquiry — AutoPets Windows open-source project

Hello SignPath Foundation team,

I maintain AutoPets, a public MIT-licensed Windows project at https://github.com/swaan-kim/autopets. It provides a pet interface for explicitly requested work in an existing local Codex chat.

Our GitHub Actions build produces a Tauri/NSIS installer. We have verified installation, normal shutdown, reinstallation and data preservation on a disposable Windows runner. An unsigned development pre-release is published at https://github.com/swaan-kim/autopets/releases/tag/v0.1.0-dev.20261005.1, with build provenance and checksums. It is not a stable release, and we do not claim that it satisfies your release or reputation requirements.

The current development PC can install and run this build, but its owner previously disabled Smart App Control. Earlier unsigned builds were blocked there while application control was enabled. We have not verified the current release on a protected PC and do not present disabling security as a distribution solution.

Could you advise whether this early project is eligible, or which additional release and project-history evidence is needed? We also need to confirm a supported workflow for signing our application, NSIS uninstaller and final installer while preserving third-party signatures and verified build provenance.

Does the bundled Microsoft WebView2 offline installer qualify for your System Libraries exception, and what provenance or signature checks do you require for upstream NSIS plug-in DLLs?

Contact name and email: [maintainer to supply]

## 승인될 경우 준비할 정책 초안

현재는 제공/승인된 서명 서비스가 없다. 아래는 운영 제안이며 소유자 확인 전 실제 정책으로 선언하지 않는다.

- 소유 저장소의 검토된 commit에서 생성한 자체 바이너리만 서명한다.
- CI 빌드 출처와 검증 결과를 확인한 담당자가 각 서명 요청을 승인한다.
- 계정 MFA와 최소 권한을 사용하며 서명 자격 증명을 앱·저장소·진단 파일에 포함하지 않는다.
- 업스트림 바이너리의 원래 서명을 보존한다. 사용자 PC의 신뢰 저장소나 보안 정책을 수정하지 않는다.
- 실제 저장·네트워크 전송 동작을 검토한 개인정보처리방침과, 사용자에게 영향을 주는 제삼자 구성요소·서비스의 관련 정책을 공개 서명 정책에 연결한다. 아직 검토하지 않은 데이터 처리 내용을 보장 문구로 쓰지 않는다.
- 공개 서명 정책·서비스 제공 표기는 실제 승인 내용과 일치할 때 게시한다.

조건 출처: https://signpath.org/terms. 무료 지원과 승인 시점은 보장되지 않는다.
