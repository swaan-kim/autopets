# Windows 서명 배포 준비

2026-09-30 사용자 선택: Windows 보호 설정을 유지하고 서명 배포를 준비한다. **서명 신청·승인·인증서 발급·서명 실행은 아직 하지 않았다. 현재 PC의 새 설치본 차단도 미해결이다.**

## 준비 상태

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

수동 실행 전용 `.github/workflows/windows-signature-checks.yml`은 검사 도구의 동작만 Windows에서 확인한다. 실제 인증서 발급이나 서명, 설치기 실행, 릴리스 업로드를 하지 않는다. 정상 제품 빌드 workflow에 서명 자격 없이 자동 요청을 추가하지 않았다.

2026-09-30 현재 Windows에서 전체 Node 검사 222개 통과·조건부 실물 검사 1개 제외를 확인했다. 실물 설치기 경로를 명시한 별도 서명 검사에서는 7개 모두 통과했고 미서명 설치기를 올바르게 실패 판정하며 바이트를 변경하지 않았다. 읽기 전용 재고 조사에서도 새 설치기와 기존 앱·제거기는 `NotSigned`, 기존 번들 Node는 `Valid`였다. 기존 설치 폴더는 이전 빌드이므로 새 설치기 내부 검증으로 계산하지 않는다. XML 예시 2개는 공식 스키마 검증을 통과했다. 실제 서명·서비스 연동·SAC 허용은 여전히 미검증이다.

## 승인 후 빌드 연결 순서

1. 소유자가 서비스 심사·계정 보호·서명 승인 담당자를 확정한다. 서비스 자격 증명은 보호된 CI 환경에만 둔다.
2. 빌드 소스 commit과 검증된 GitHub Actions 산출물을 서비스의 프로젝트·artifact 설정에 연결한다. 서비스가 발급한 실제 프로젝트/정책 식별자를 사용한다.
3. 앱·제거기·최종 설치기를 서명하고 각각 서명 결과와 원래 빌드 출처를 대조한다. 서명 실패·시간 초과·승인 대기 시 미서명 파일로 계속 배포하지 않는다.
4. 서명 후 최종 바이트의 SHA256·크기·발행자·타임스탬프를 새로 기록한다. 기존 미서명 설치기의 해시를 재사용하지 않는다.
5. 서명 검사 후 별도 Windows에서 실제 설치 파일을 설치한다. 설치된 앱·제거기의 해시가 SignPath 반환 파일과 일치하는지, 외부 구성요소의 발행자·원본 해시가 검토한 공급자 자료와 일치하는지 대조한다. 설치·정상 종료·데이터 보존·제거도 다시 검사한다.
6. Smart App Control이 켜진 현재 PC에서 일반 설치와 실행을 재확인한다. 이때도 보안 설정을 변경하지 않는다.
7. 남은 UI 펫의 실제 A/B·Figma 흐름을 확인한다. 공개 배포와 자동 업데이트는 각각 기존 계약의 추가 관문을 따른다.

업데이트용 Tauri 서명은 Windows Authenticode와 다르다. 현 검증본의 업데이트 비활성·공개 manifest `null`을 유지하며 [배포 계약](../architecture/distribution.md)을 변경하지 않는다.

SignPath GitHub 연동은 공식 `signpath/github-action-submit-signing-request`의 검토된 commit `f6d04783b4569d051e0c80105fe66e82819d0092`를 기준 후보로 기록했다. 필요한 값은 소유자가 승인받은 organization/project/signing policy/artifact configuration, GitHub artifact ID와 API token이다. 반환 파일을 받을 때까지 대기하는 설정과 사람의 승인 제한 시간을 함께 둬야 한다. 실제 서비스 계정이 없으므로 실행 가능한 서명 workflow는 아직 활성화하지 않는다. [공식 GitHub 연동](https://docs.signpath.io/trusted-build-systems/github)

## 지금 소유자에게 남은 일

무료 후보를 계속 검토한다면 먼저 [신청 자료](signpath-application.md)의 연락처와 담당자·프로젝트 이력 정보를 본인이 확인해야 한다. 공개 릴리스가 아직 없다는 사실을 숨기지 않고 신청 자격을 문의한다. 승인 전에는 실제 CI 서명 요청이나 후원 표기를 활성화하지 않는다. 신청이 거절되거나 맞지 않으면 보유/발급 가능한 신뢰 인증서 또는 Store 경로를 별도 결정한다.
