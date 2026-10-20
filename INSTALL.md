# AutoPets 설치하기

**Windows에서 설치한 뒤, 쓰던 Codex 채팅에서 펫을 부릅니다.**

현재는 **미서명 개발 미리보기**입니다. 보안 정책을 유지한 모든 PC의 설치를 보장하지 않으며, 차단되면 중단합니다. 앱·실행 런타임·연결 도구를 포함한 EXE를 사용하므로 Git·Node·Rust 설치는 필요하지 않습니다.

[개발 미리보기 받기](https://github.com/swaan-kim/autopets/releases) · [배포 식별 정보](https://github.com/swaan-kim/autopets/blob/main/docs/releases/preview.json) · [지원 범위](README.md)

## 사용자: AI에 이 문장만 보내세요

```text
https://github.com/swaan-kim/autopets/blob/main/INSTALL.md 를 읽고,
내 Windows PC에 AutoPets를 설치하고 실행하는 것을 도와줘.
기존 설치와 데이터를 보존하고 공식 배포 파일과 해시를 확인해줘.
미서명 시험판이면 설치 전에 알려주고, 보안 설정은 바꾸지 마.
실행되면 Codex에 펫을 준비하는 단계까지 안내해줘.
```

PC에서 다운로드·실행할 수 없는 AI를 쓰고 있다면 [Releases](https://github.com/swaan-kim/autopets/releases)의 Pre-release 설치 EXE를 직접 받습니다. 아래 기술 절차는 AI용이며 일반 사용자가 콘솔에 입력할 필요는 없습니다.

설치 후에는 앱의 **Codex에 펫 준비**를 누르고, 사용할 채팅에서 **`AutoPets 스킬로 제작 펫 연결해줘`**라고 요청합니다. 연결한 채팅에는 앱에서 저장한 펫 설정을 직접 적용할 수 있습니다. 앱에 적은 할 일까지 채팅으로 옮길 때는 **시작 요청 복사**를 이용합니다.

## AI 설치 담당자용 계약

```yaml
product: AutoPets
repository: https://github.com/swaan-kim/autopets
platform: win32-x64
host: Windows local Codex
app_identifier: local.autopets.desktop
distribution: unsigned-preview
manifest: docs/releases/preview.json
helper: scripts/install-preview.ps1
stable_channel: docs/releases/channel.json
requires_explicit_unsigned_opt_in: true
requires_explicit_update_request: true
security_bypass: forbidden
auto_submit_or_ai_test: forbidden
```

### 1. 환경과 기존 설치부터 확인

- **Windows x64 로컬 실행**인지 확인합니다. 웹·클라우드 AI, macOS·Linux·Windows ARM64에서는 이 설치기를 실행하지 않습니다. 로컬 PC에 접근할 수 없으면 직접 다운로드 경로를 안내하고 끝냅니다.
- Codex 로그인과 **하위 작업에 모델·추론을 지정하는 기능**이 사용 가능한지 확인합니다. Codex 설치 자체나 계정 로그인을 자동 승인하지 않습니다. 모델 가용성은 실제 작업을 요청할 때 호스트에서 확인하며 고정 이름만으로 지원을 단정하지 않습니다.
- 기존 AutoPets 설치 기록·설치된 앱·실행 상태를 먼저 확인합니다. 동일한 해시의 검증 설치는 재사용합니다. 여러 설치 위치가 있으면 임의 선택·병합·삭제하지 않습니다.
- 기존 앱의 해시가 다르면 자동으로 덮어쓰지 않습니다. 사용자가 해당 배포로 **업데이트를 요청한 경우에만** `-UpdateExistingPreview`를 사용합니다. 서명된 앱이나 서명 오류가 있는 앱은 미서명 preview로 덮어쓰지 않습니다.
- 업데이트가 필요하면 사용 중인 작업이 끝난 뒤 앱의 정상 종료를 사용합니다. 기존 `local.autopets.desktop` 데이터, `%LOCALAPPDATA%/AutoPets` 연결 도구·설치 기록, 기존 사용자 스킬을 보존합니다. `AUTOPETS_HOME`이 지정되어 있으면 기존 값을 존중합니다. 제거 후 재설치나 데이터 초기화를 기본 복구로 삼지 않습니다.

### 2. 공개된 정확한 배포를 확인

1. 이 저장소의 [미리보기 manifest](https://github.com/swaan-kim/autopets/blob/main/docs/releases/preview.json)를 읽습니다. `sourceCommit`은 40자리 소스 커밋, `release.tag`는 고정 Pre-release 태그, `installer.url`·`installer.sha256`은 설치기, `app.sha256`은 설치 후 앱의 식별값입니다.
2. GitHub의 해당 태그가 `sourceCommit`을 가리키고, Release가 공개된 **Pre-release**이며 manifest의 설치 EXE가 실제 게시됐는지 확인합니다. manifest가 없거나 배포가 초안·미게시 상태이면 설치를 중단합니다.
3. 공개 Release의 `preview.json`과 저장소의 manifest가 같은 배포를 가리키는지 대조합니다. `SHA256SUMS.txt`·`BUILD.txt`가 게시됐다면 함께 대조합니다. 불일치 시 멈추며 최신 CI 산출물이나 다른 태그를 임의로 대체하지 않습니다.
4. 설치 helper는 **manifest의 `sourceCommit`으로 고정된 소스**에서 파일로 받습니다.
   `https://raw.githubusercontent.com/swaan-kim/autopets/<sourceCommit>/scripts/install-preview.ps1`
   `<sourceCommit>`에는 검증한 실제 40자리 값을 넣습니다. helper 본문을 검토한 뒤 로컬 파일로 실행합니다. 원격 문자열 즉시 평가, `Invoke-Expression`, 내려받은 문자열을 셸에 파이프로 실행하는 방식은 사용하지 않습니다.

`releases/latest/download`는 Pre-release를 가리키는 주소가 아닙니다. [안정판 채널](docs/releases/channel.json)의 `publicRelease: null`을 임의로 채우거나 미리보기를 안정판·자동 업데이트로 승격하지 않습니다.

### 3. 미서명 시험판임을 설명하고 선택받기

미서명임을 이미 명확하게 설명한 상태에서 사용자가 해당 시험판 설치를 선택했다면 반복 확인하지 않습니다. 일반적인 “설치해줘”만 있었다면 다음처럼 짧게 설명합니다.

> 현재 파일은 미서명 개발 시험판이라 Windows에서 차단될 수 있어요. 보안 설정은 유지합니다. 이 시험판 설치를 진행할까요, 서명된 배포를 기다릴까요?

명시적 선택 전에는 검사·다운로드 준비까지만 진행합니다. SHA-256 일치는 게시 파일과의 일치를 확인할 뿐, 발행자 서명을 대신하지 않습니다. `-AllowUnsignedPreview`를 사용자 동의 대신 사용하지 않습니다.

### 4. 검토한 helper로 검사·설치

아래 예시는 **이미 파일로 받은 helper와 manifest가 있는 폴더**에서 실행하는 형식입니다. 사용자에게 이 명령을 직접 입력하도록 요구하지 않습니다. 도우미는 Windows 기본 **Windows PowerShell 5.1 (`powershell.exe`)**에서 검증했습니다. PowerShell 7의 날짜 자동 변환과 호환되지 않으므로 `pwsh` 또는 현재 셸에 직접 불러 실행하지 않습니다.

```powershell
# manifest 형식만 검사: 설치·실행·AI 호출 없음
powershell.exe -NoProfile -File .\install-preview.ps1 -ManifestPath .\preview.json -ValidateOnly

# 미서명 시험판 선택 후: 정확한 공개 파일을 받고 해시·서명 상태 확인
powershell.exe -NoProfile -File .\install-preview.ps1 -ManifestPath .\preview.json -AllowUnsignedPreview -DownloadOnly

# 미서명 시험판 선택 후: 기존 설치 확인, 필요한 설치, 앱 실행 요청
powershell.exe -NoProfile -File .\install-preview.ps1 -ManifestPath .\preview.json -AllowUnsignedPreview

# 기존 앱의 해시가 다르고, 사용자가 이 배포로 업데이트를 요청한 경우에만
powershell.exe -NoProfile -File .\install-preview.ps1 -ManifestPath .\preview.json -AllowUnsignedPreview -UpdateExistingPreview
```

- `-ValidateOnly`는 형식 검사입니다. 배포 존재·실제 파일·설치 가능성의 통과로 표시하지 않습니다.
- helper는 고정 저장소·태그·소스·설치기 URL을 확인하고 파일 해시와 미서명 상태를 대조합니다. 서명 손상이나 예상과 다른 서명을 무시하지 않습니다.
- PowerShell 정책, Windows Defender·Smart App Control·SmartScreen 또는 조직 정책이 차단하면 **멈춥니다**. 실행 정책 변경·우회 플래그·예외 등록·보호 해제·차단 표시 제거를 하지 않습니다. 소유자에게 관측한 차단과 서명 배포 필요성을 안내합니다.
- 설치 실패·시간 초과는 기존 설치와 프로세스 상태부터 다시 확인합니다. 알 수 없는 결과를 자동 반복하거나 진행 중인 작업을 강제 종료하지 않습니다.

### 5. 앱 준비와 Codex 연결을 분리해 확인

1. helper의 `launch-requested`는 **앱 실행 요청**입니다. 실제 화면과 로컬 통신 준비를 별도로 확인합니다. 앱이 뜨지 않거나 통신이 준비되지 않으면 연결 완료라고 말하지 않습니다.
2. 앱에서 사용자가 선택한 **Codex에 펫 준비** 행동으로 설치된 연결 도구와 스킬을 준비합니다. 이미 정상 준비됐다면 반복하지 않습니다. 설치만 했다는 이유로 호스트 신뢰·훅 허용까지 완료됐다고 표시하지 않습니다.
3. 새 스킬이 보이지 않으면 Codex의 스킬 목록 새로 고침 또는 진행 중인 응답이 끝난 뒤 앱 재실행을 안내합니다. 개인 채팅을 닫거나 초안을 덮어쓰지 않습니다.
4. 실제 펫 연결·작업은 **설치된 AutoPets 스킬과 그 안내**를 사용합니다. 현재 호스트가 제공한 실제 `CODEX_THREAD_ID`와 작업 폴더를 유지합니다. 임의 ID·다른 채팅·별도 서버의 새 작업으로 대체하지 않습니다.
5. 이 설치 요청만으로 시험용 AI 작업이나 하위 작업을 자동 실행하지 않습니다. 사용자에게 다음 짧은 요청을 안내하고 설치 결과를 보고합니다.

```text
AutoPets 스킬로 제작 펫 연결해줘.
```

자연어로 스킬이 호출되지 않으면 **AutoPets 스킬 직접 선택**이 지원 경로입니다. 위의 짧은 연결 요청은 기본 제작 펫을 연결하며, 앱에서 마지막으로 고른 펫을 추측하지 않습니다.

저장한 특정 펫에는 두 경로가 있습니다.

- **연결된 채팅에 설정 적용:** 설치 앱의 **자세히 → 저장한 구성과 연결 관리**에서 대상을 선택하고 **저장하고 선택 채팅에 적용**을 누릅니다. 앱이 정확한 펫 ID·개정을 전달하므로 사용자가 이를 복사할 필요는 없습니다. 다음 명시적 펫 요청이 저장된 역할·스킬·작업 설정을 읽습니다.
- **앱에 적은 할 일까지 전달:** **시작 요청 복사**로 생성한 요청을 사용할 채팅에 보냅니다. 이 요청에는 `petId`·`petRevision`과 할 일이 포함됩니다.

설정 적용 버튼은 할 일 입력문을 전송하거나 AI를 실행하지 않습니다. 브라우저 미리보기에서는 실제 적용을 지원하지 않습니다. 직접 설정 적용은 UI·저장소 격리 검사로 확인했으며, 이 경로부터 실제 AI 실행까지의 연속 검증은 별도로 남아 있습니다. 일반 채팅의 모든 요청에 자동 적용하는 기능으로 설명하지 않습니다.

설치된 스킬 경로는 앱의 준비 결과에서 확인합니다. 소스 저장소의 개발 스크립트를 설치된 연결 도구처럼 사용하지 않습니다. 공개 보고에 인증값·전체 대화·개인 경로·정확한 개인 채팅 ID를 넣지 않습니다.

### 6. 결과는 확인한 단계까지만 보고

| 상태 | 필요한 근거 |
| --- | --- |
| 파일 확인 | 공개 태그·소스·설치기 해시·서명 상태 대조 |
| 앱 준비 | 설치 경로·앱 해시·실제 실행·통신 준비 확인 |
| Codex 준비 | 설치된 스킬·연결 도구 준비 결과 |
| 채팅 연결 | 사용자가 요청한 실제 현재 채팅의 연결과 재조회 |
| 작업 완료 | 사용자가 맡긴 작업의 실제 실행·결과 반환·일치하는 펫 상태 |

설치 담당자는 자동으로 마지막 두 단계를 수행하지 않습니다. **준비됨 ≠ 연결됨 ≠ 결과 완료**입니다. 훅의 자동 처리, 부모 모델 변경, 실제 Plan 강제, 모든 역할의 품질이나 모든 PC의 설치 성공을 약속하지 않습니다.

[실제 검증된 대표 흐름](docs/testing/installed-core-20261012.md) · [배포 안내](docs/releases/start.md) · [서명 준비와 남은 조건](docs/releases/code-signing.md)
