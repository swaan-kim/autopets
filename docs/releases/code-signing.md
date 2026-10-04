# Windows 서명 배포 준비

**최신 상태 (2026-10-05):** [미서명 개발 Pre-release](https://github.com/swaan-kim/autopets/releases/tag/v0.1.0-dev.20261005.1)를 공개했다. 제품 head `a250f0c`의 Windows 검사와 현재 PC 설치·실행·데이터 보존이 통과했다. 설치기 SHA-256은 `c04423f241a96d9793f0b44b64893d043c228fb763d9fb5d4855832dcd263341`, 서명은 `NotSigned`다. 설치 22.543초, 실행 후 인증된 준비 응답 1.728초였으며 [실제 검사 기록](../testing/friendly-mvp.md)에 근거를 남겼다.

이 PC는 사용자가 10월 1일 Smart App Control을 끈 환경이다. 에이전트가 보호 설정을 변경하지 않았으며 이 설치 성공을 보호가 켜진 PC의 성공으로 확대하지 않는다. 발급된 인증서·서비스 승인·서명된 배포본은 아직 없고, 안정판과 자동 업데이트는 비활성이다. 아래 9월 30일·10월 1일의 차단 기록과 자격/가격 조사는 당시 이력이며, 신청 전 최신 조건을 다시 확인한다.

## 일반 사용자 설치 경로 재검토 — 2026-10-01

**10월 1일 17:14 KST 당시 차단 기록이다.** 제품 소스 `2b4420c`, 설치기 SHA256 `a92db31056cba7ff7f026b1a9c11b8ed3b9935b6a887d2c42490b18b4db43628`를 일반 실행했으나 Windows 애플리케이션 제어에 차단됐다. 과거 미서명 파일의 설치 성공은 있었지만 다른 파일·PC에서도 허용된다는 보장은 아니다. 기존 프로그램·데이터 보존과 실제 오류는 [검사 기록](../testing/mvp-feasibility.md)에 있다. 원본과 백업은 Git 제외 `work/mvp-goal/20261001-install-retry/`에 둔다.

사용자 요구는 보호 설정을 유지한 일반 사용자 설치·실행이다. 아래는 **조사한 선택지**이며, 계정 등록·구매·신청·Store 제출이나 배포 형식 전환을 완료한 것이 아니다. 기존 EXE 배포 계약은 유지한다.

| 경로 | 확인한 사실 | AutoPets의 남은 조건 |
| --- | --- | --- |
| Microsoft Store **MSIX** | 심사 통과 후 Microsoft가 패키지 서명. 새 개인 개발자 등록 무료. 아직 공개하지 않은 앱은 Private audience로 제한 시험 가능 | 소유자 계정·본인 확인, 앱 이름/Identity 예약, MSIX 호환성 개발·검사와 심사. 무료 우선 후보 |
| Microsoft Store **EXE/MSI** | Microsoft가 대신 서명하지 않음. 설치기와 포함된 실행 파일의 공인 서명 필요 | 현재 EXE를 올리기만 해서는 차단 해결 안 됨 |
| 기존 EXE + 개인 공인 서명 | SSL.com IV는 개인용 인증서와 클라우드 서명 제공. 조회한 인증서 가격 $129/년, 서명 구독 별도 | 구매 결정, 한국 개인 서류 수락 확인, 본인 확인/발급, 자체 앱·제거기·설치기 서명 및 재검사. 기존 구조 유지 후보 |
| Azure Artifact Signing | 서비스의 최신 quickstart는 한국 **조직** 지원, 개인은 미국·캐나다만 지원한다고 명시 | 한국 개인 자격으로 진행 불가. 실제 조직 자격이 있는지는 미확인 |
| SignPath Foundation | 기존 공개 출시·검증 가능한 평판·프로젝트 심사가 필요 | 개발 Pre-release는 게시됨. 이것이 심사 조건을 충족하는지와 프로젝트 자격은 미확정이며 무료 서명 가능으로 안내하지 않음 |

근거: [Microsoft 서명 방식 비교](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options), [개인 개발자 등록](https://learn.microsoft.com/en-us/windows/apps/publish/whats-new-individual-developer), [비공개 시험 배포](https://learn.microsoft.com/en-us/windows/apps/publish/beta-testing-and-targeted-distribution), [SSL.com 현재 상품](https://www.ssl.com/products/software-integrity/signing-service/), [발급 검증](https://www.ssl.com/how-to/validation-process-for-document-signing-code-signing-and-ev-code-signing-certificates/), [Azure 최신 자격](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart), [SignPath 조건](https://signpath.org/terms.html). 일반 Windows 비교 문서의 Azure 국가 목록보다 해당 서비스 quickstart의 최신 목록을 우선한다. 가격과 지역 자격은 신청 시 재확인한다.

### 무료 Store 후보의 실제 준비 순서

1. 소유자가 [무료 등록의 공식 입구](https://storedeveloper.microsoft.com/)에서 개인 계정을 선택하고 직접 본인 확인한다. 신분증과 셀피는 Microsoft에만 제출하며 저장소나 대화에 보관하지 않는다. 이미 계정이 있으면 기존 계정을 사용한다.
2. 앱 이름을 예약한 뒤 실제 Package Identity Name·Publisher·Publisher Display Name을 확인한다. 임의 값으로 서명본이나 배포 완료를 꾸미지 않는다. Store 패키지 식별자와 기존 앱 내부 `local.autopets.desktop`은 별개로 관리한다.
3. 별도 MSIX 검증 빌드를 준비한다. 현재 `installedRoot()`의 `%LOCALAPPDATA%/AutoPets` 가정, `connection.json` 공유, 설정·DB의 제거 후 보존, 설치된 스킬의 실행 경로를 먼저 해결한다. 패키지 업데이트로 경로가 바뀌어도 기존 채팅이 같은 앱을 찾는지 검사한다.
4. 번들 Node·WebView2·리소스 포함, 일반 권한의 로컬 통신, 트레이·투명 오버레이·Codex 복귀를 시험한다. AppData 가상화에 대한 manifest 선언은 필요한 폴더만 검토하고 Store의 제한 기능 심사를 거친다. 기존 EXE와 동시 실행·공유 DB 충돌을 방지한다. 단순 형식 변환을 설치 성공으로 계산하지 않는다.
5. 설명·실제 화면·개인정보 안내·제한 기능 설명을 작성해 소유자가 검토할 제출안을 만든다. **Private audience**와 무료 가격을 명시하고 시험 Microsoft 계정만 지정한다. 기본 공개 설정을 그대로 제출하지 않는다. 제출/공개는 별도 소유자 지시 후에 한다.
6. 심사와 서명 이후 Store의 실제 배포본으로 현재 PC 설치 → 실행/통신 → Codex 연결 → 종료/재시작 → 데이터 보존을 검사한다. 서명 전 패키지, self-signed 로컬 테스트, 기존 EXE CI 결과로 이 단계를 대체하지 않는다.

MSIX 파일 접근 동작의 근거: [Microsoft flexible virtualization](https://learn.microsoft.com/en-us/windows/msix/desktop/flexible-virtualization). 현재 부트스트랩은 `integrations/codex/bootstrap/files.mjs`, 앱의 연결 도구 호출은 `apps/desktop/src-tauri/src/platform/connection_setup.rs`에 있다. 파일 가상화/공유 데이터와 Store 설치 경로는 실제 패키지에서 별도 검증해야 한다.

추가 코드 조사 결과: `bootstrap/start.mjs`는 EXE의 HKCU 제거 등록을 조회하고 설치 스킬에 Node의 절대 경로를 넣는다. `files.mjs`의 단일 하드링크 검사도 MSIX의 파일 공유 방식과 충돌할 가능성이 있다. 이 검사를 통째로 완화하지 않고 패키지 신원·경로·무결성 검증을 분리해야 한다. 현재 NSIS가 수행하는 WebView2 런타임 준비도 MSIX에서 자동 재사용되지 않는다. **MSIX는 별도 호환성 실증이 필요한 후보**이며, 위 항목을 모두 해결했다고 표시하지 않는다. [MSIX 실행·파일 구조](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes), [WebView2 배포](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution).

### 현재 중단 조건과 다음 입력

조사와 기존 준비 도구는 사용할 수 있으나 **발급된 인증서도 Store의 서명된 패키지도 없다.** 현재 EXE 구조를 유지하며, 소유자가 기존 인증서 또는 서명 서비스 자격과 담당자를 확인해야 한다. 무료 Store 경로는 별도 선택·본인 확인·호환성 작업·심사가 필요하며 자동으로 전환하지 않는다. 과거 앱 재호출의 `blocked by policy`는 자동 승인 검토가 실행 전에 거절한 기록이며 Windows의 바이너리 차단과 구분한다. 최신 앱의 설치·실행 결과는 이 문서 상단을 따른다.

아래는 2026-09-30 당시 준비 기록이며 최신 설치기와 혼동하지 않는다.

2026-09-30 사용자 선택: Windows 보호 설정을 유지하고 서명 배포를 준비한다. **서명 신청·승인·인증서 발급·서명 실행은 아직 하지 않았다. 현재 PC의 새 설치본 차단도 미해결이다.**

## 2026-09-30 당시 준비 상태

| 항목 | 확인 결과 |
| --- | --- |
| 프로젝트 | `https://github.com/swaan-kim/autopets`, 공개 MIT 저장소 |
| 제품 검증본 | PR head `baae9b1`, merge `3a3742fc`, Windows CI `36691297174` |
| 설치기 | 243,690,510바이트, SHA256 `b60688704e611723d937525c633c7f31d1c7fbfbe775f04af1ec5a1c451be042`, NotSigned |
| 실제 설치·복구·제거 | 같은 설치본의 별도 Windows CI `36694514381` 통과. 서명/현재 PC 허용 증거는 아님 |
| 로컬 인증서 | CurrentUser/My와 LocalMachine/My에서 코드 서명 인증서 없음 |
| 게시된 릴리스 | 조회 시 없음. Actions 검토 산출물을 공개 릴리스라고 기재하지 않음 |
| 기존 설치 구성 | AutoPets 본체·제거 프로그램 NotSigned, 번들 Node.js는 OpenJS Foundation의 유효한 서명 |
| 보호 상태 | Smart App Control 켜짐. 보안 설정·인증서 신뢰 저장소는 변경하지 않음 |

무료 SignPath Foundation을 우선 후보로 검토한다. 공개 MIT 저장소만으로 승인되는 것은 아니며, 기존 릴리스·검증 가능한 활동 이력·서명 운영 정책 등 심사 조건이 남아 있다. 신청 전 조건 문의용 초안은 [신청 자료](signpath-application.md)에 있다. 아직 후원·인증서 제공을 받고 있다는 문구를 제품에 표시하지 않는다. [공식 조건](https://signpath.org/terms)

## 서명할 범위

1. AutoPets 자체 `autopets.exe`.
2. NSIS가 만드는 `uninstall.exe`.
3. 앞선 서명 결과를 담은 최종 `AutoPets_0.1.0_x64-setup.exe`.
4. 포함된 실행 코드의 원래 서명 확인. Node·WebView2 등 다른 공급자의 파일을 AutoPets 명의로 다시 서명하지 않는다.

최종 setup.exe의 바깥 서명만 추가해서 내부 파일까지 서명됐다고 판정하지 않는다. SignPath의 `<pe-file>` 서명과 MSI 등 지원 형식의 중첩 서명은 다르다. NSIS에 적용할 전체 절차는 실제 서비스 구성에서 검증해야 한다. [SignPath 형식 명세](https://docs.signpath.io/artifact-configuration/reference)

Tauri의 Windows `signCommand`는 외부 서명 명령과 연결할 수 있지만 GitHub Action 단계 자체를 명령처럼 호출할 수는 없다. 잠금 버전 CLI 2.11.4는 이 명령을 NSIS 플러그인 DLL에도 호출하므로, 외부 바이너리를 다시 서명하면 안 되는 Foundation 조건에 무차별 서명 명령을 바로 연결하지 않는다. 현재 제거 훅이 사용하는 `nsExec.dll`도 별도 확인 대상이다. 실제 승인된 서비스와 출처 검증 방법을 결정한 뒤 자체 파일의 허용 목록과 공급자 파일 검증을 분리한다. [Tauri 공식 서명 안내](https://v2.tauri.app/distribute/sign/windows/) · [잠금 버전 NSIS 구현](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/windows/nsis/mod.rs)

NSIS의 외부 서명 절차를 사용하려면 제거기를 내보내 서명한 뒤, 서명된 앱·제거기를 재컴파일 없이 가져와 설치기를 완성하고 최종 설치기를 다시 서명해야 한다. [NSIS 공식 절차](https://nsis.sourceforge.io/Signing_an_Uninstaller_externally). SignPath 공식 형식의 비활성 예시는 [앱·제거기 XML](signpath/app-and-uninstaller.xml)과 [설치기 XML](signpath/installer.xml)이다. `version` 입력은 현재 `0.1.0`이며 변경 시 실제 바이너리 메타데이터와 맞춰야 한다. 스키마 검증 성공은 실제 서비스 승인이나 서명 성공이 아니다.

## 준비한 읽기 전용 검사

`scripts/check-windows-signatures.ps1`은 파일을 실행하거나 서명하지 않고 Authenticode 상태와 파일 해시를 조사한다. 기존 설치 폴더·인증서·정책을 바꾸지 않는다. 출력 파일은 기존 폴더의 새 경로를 사용한다.

재고 조사 예시:

```powershell
.\scripts\check-windows-signatures.ps1 `
  -Installer 'C:\review\AutoPets_0.1.0_x64-setup.exe' `
  -InstalledDirectory 'C:\review\installed\AutoPets' `
  -ReportPath 'C:\review\signature-inventory.json' `
  -InventoryOnly
```

승인된 인증서를 받은 뒤 적용할 엄격 검사 예시:

```powershell
.\scripts\check-windows-signatures.ps1 `
  -Installer 'C:\review\AutoPets_0.1.0_x64-setup.exe' `
  -InstalledDirectory 'C:\review\installed\AutoPets' `
  -ExpectedPublisher '<발급된 인증서의 정확한 Subject>' `
  -ExpectedThumbprint '<확인한 인증서 SHA-1 지문 40자리>' `
  -ReportPath 'C:\review\signature-verification.json'
```

위 값은 예시이며 인증서나 지문을 생성하지 않는다. 자체 파일의 정확한 발행자·지문과 타임스탬프 존재를 검사하고, 포함된 EXE/DLL/Node 바이너리의 서명도 확인한다. 설치 폴더가 없으면 엄격 검사는 실패하며 설치기만 보고 전체 서명 준비 완료로 표시하지 않는다. 공급자 파일의 출처와 설치 폴더가 해당 설치기에서 나왔는지는 별도로 검증한다. 서명 성공과 Smart App Control 허용·공개 배포 준비는 별도다. 공개 준비 필드를 이 검사만으로 올리지 않는다.

`.github/workflows/windows-signature-checks.yml`은 수동 실행 또는 전용 `test/windows-signature-audit` 브랜치에서 검사 도구의 동작만 Windows에서 확인한다. 새 workflow는 기본 브랜치에 반영되기 전 이름으로 수동 실행할 수 없어 전용 브랜치 경로도 둔다. 실제 인증서 발급이나 서명, 설치기 실행, 릴리스 업로드를 하지 않는다. 정상 제품 빌드 workflow에 서명 자격 없이 자동 요청을 추가하지 않았다.

2026-09-30 현재 Windows에서 전체 Node 검사 222개 통과·조건부 실물 검사 1개 제외를 확인했다. 실물 설치기 경로를 명시한 별도 서명 검사에서는 7개 모두 통과했고 미서명 설치기를 올바르게 실패 판정하며 바이트를 변경하지 않았다. 읽기 전용 재고 조사에서도 새 설치기와 기존 앱·제거기는 `NotSigned`, 기존 번들 Node는 `Valid`였다. 기존 설치 폴더는 이전 빌드이므로 새 설치기 내부 검증으로 계산하지 않는다. XML 예시 2개는 공식 스키마 검증을 통과했다. 실제 서명·서비스 연동·SAC 허용은 여전히 미검증이다.

별도 [Windows 감사 도구 CI 36702302700](https://github.com/swaan-kim/autopets/actions/runs/36702302700), 소스 `673d23a`, 성공. 6개 검사 통과, 실물 설치기를 전달하지 않은 1개 검사는 제외됐다. 실제 미서명 설치기의 검사는 앞선 현재 PC의 7/7 결과에만 포함된다. 제품 코드는 변경하지 않아 새 제품 설치본을 만들지 않았다.

## 승인 후 빌드 연결 순서

1. 소유자가 서비스 심사·계정 보호·서명 승인 담당자를 확정한다. 서비스 자격 증명은 보호된 CI 환경에만 둔다.
2. 빌드 소스 commit과 검증된 GitHub Actions 산출물을 서비스의 프로젝트·artifact 설정에 연결한다. 서비스가 발급한 실제 프로젝트/정책 식별자를 사용한다.
3. 앱·제거기·최종 설치기를 서명하고 각각 서명 결과와 원래 빌드 출처를 대조한다. 서명 실패·시간 초과·승인 대기 시 미서명 파일로 계속 배포하지 않는다.
4. 서명 후 최종 바이트의 SHA256·크기·발행자·타임스탬프를 새로 기록한다. 기존 미서명 설치기의 해시를 재사용하지 않는다.
5. 서명 검사 후 별도 Windows에서 실제 설치 파일을 설치한다. 설치된 앱·제거기의 해시가 SignPath 반환 파일과 일치하는지, 외부 구성요소의 발행자·원본 해시가 검토한 공급자 자료와 일치하는지 대조한다. 설치·정상 종료·데이터 보존·제거도 다시 검사한다.
6. Smart App Control이 켜진 별도 Windows 환경에서 일반 설치와 실행을 확인한다. 현재 개발 PC의 보호 설정을 변경해 시험 조건을 만들지 않는다.
7. 남은 UI 펫의 실제 A/B·Figma 흐름을 확인한다. 공개 배포와 자동 업데이트는 각각 기존 계약의 추가 관문을 따른다.

업데이트용 Tauri 서명은 Windows Authenticode와 다르다. 현 검증본의 업데이트 비활성·공개 manifest `null`을 유지하며 [배포 계약](../architecture/distribution.md)을 변경하지 않는다.

SignPath GitHub 연동은 공식 `signpath/github-action-submit-signing-request`의 검토된 commit `f6d04783b4569d051e0c80105fe66e82819d0092`를 기준 후보로 기록했다. 필요한 값은 소유자가 승인받은 organization/project/signing policy/artifact configuration, GitHub artifact ID와 API token이다. 반환 파일을 받을 때까지 대기하는 설정과 사람의 승인 제한 시간을 함께 둬야 한다. 실제 서비스 계정이 없으므로 실행 가능한 서명 workflow는 아직 활성화하지 않는다. [공식 GitHub 연동](https://docs.signpath.io/trusted-build-systems/github)

## 지금 소유자에게 남은 일

무료 후보를 계속 검토한다면 먼저 [신청 자료](signpath-application.md)의 연락처와 담당자·프로젝트 이력 정보를 본인이 확인해야 한다. 게시된 것은 미서명 개발 Pre-release이며 안정판이나 서비스 적격성 검증이 아니라는 점을 명시해 신청 자격을 문의한다. 승인 전에는 실제 CI 서명 요청이나 후원 표기를 활성화하지 않는다. 신청이 거절되거나 맞지 않으면 보유/발급 가능한 신뢰 인증서 또는 Store 경로를 별도 결정한다.
