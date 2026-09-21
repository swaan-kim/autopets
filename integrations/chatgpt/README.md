# AutoPets ChatGPT 연결 — 검증 전 준비판

기존 ChatGPT 창에서 요청하고, 작업 방식·모델 허용 범위는 펫 설정에서 관리하는 연결 구조입니다. 이 버전은 **로컬 연결 상태 확인만 제공**합니다. 실제 계정·모델·전송 식별을 검증하지 않았으므로 입력 수정, 모델 변경, 맥락 동기화, 토큰 측정은 모두 꺼져 있습니다. 설치·브라우저 프로필 변경·실제 채팅 전송은 이번 제작에서 수행하지 않았습니다.

## 파일과 경계

- extension/: Chrome Manifest V3, 사용자 클릭 후 chatgpt.com만 접근 허용. popup은 짧은 연결 상태를 보여줍니다. content.js는 입력창·첨부·대화 본문·쿠키를 읽거나 수정하지 않습니다.
- native/: com.autopets.bridge 호스트. 4바이트 길이 + UTF-8 JSON, 메시지 최대 64KiB, 정확한 확장 origin 확인, 로컬 브리지 인증 모듈 재사용.
- extension/transaction.mjs: 원문·IME·첨부·수정 충돌·되돌리기·전송 재생 방지를 확인하는 **fixture 전용 어댑터**. 실제 페이지는 이를 import하지 않으며 send 버튼을 누르는 함수도 없습니다.
- 확장과 호스트는 임의 URL·명령·로컬 파일 경로를 메시지로 받지 않습니다. 상태 확인은 고정 authenticated GET /v1/assistance-status만 사용합니다. 별도 assistance 메시지에는 고정 POST /v1/assistance만 허용하며 write는 capability-unverified로 거절합니다. 공통 선호 쓰기는 브라우저에서 제공하지 않습니다.

네이티브 호스트의 handshake는 프로토콜 연결 확인일 뿐 앱 실행·지침 전달·모델 적용의 증거가 아닙니다. status는 현재 로컬 앱의 선호·기능 상태 조회가 성공했는지를 표시합니다. 계정·대화 ID가 없는 읽기 전용 경로이므로 새로고침마다 작업을 생성하지 않습니다. backend의 capabilities는 제공자별 맵이며 호스트 상태에는 ChatGPT용 단일 세트를 투영합니다. 모든 값은 false, verification은 unverified입니다.

계정 ID를 추측하거나 페이지 내부 전역 변수에서 얻지 않습니다. 현재 확장의 상태 확인은 계정·대화 ID와 본문을 전송하지 않습니다. 정확한 계정·전송 식별이 없는 상태에서 채팅별 맥락을 읽거나 쓰지 않으며 contextSync는 항상 false입니다. fixture 어댑터는 계정·대화·모델 변경 시 트랜잭션을 거절하고, 실제 페이지의 현재 채팅 기억으로 활성화되지 않습니다.

## 패키지 만들기

저장소 루트에서 Node.js 24 이상으로 실행합니다.

~~~sh
node --test integrations/chatgpt/tests/*.test.mjs
node scripts/package-chatgpt.mjs
~~~

release/chatgpt/에 확장 ZIP, companion ZIP, SHA256SUMS.txt, package-status.json을 만듭니다. 현재 저장소의 packages/guidance 및 packages/contracts는 ZIP에 로컬 파일로 복사합니다. 런타임에 원격 코드를 받지 않습니다. 기본 companion은 이미 설치된 Node.js가 필요합니다. Node 실행 파일과 배포 라이선스를 함께 포함하려면 --node <node.exe> --node-license <LICENSE>를 지정합니다.

## 설치는 별도의 사용자 동작

확장 ZIP을 풀어 Chrome 개발자 모드에서 로드하면 실제 확장 ID가 정해집니다. 이 동작은 자동으로 수행하지 않습니다. companion ZIP을 풀고 Node.js로 다음 명령을 **검토만** 할 수 있습니다.

~~~sh
node integrations/chatgpt/native/install.mjs --extension-id <실제32자리확장ID> --dry-run
~~~

기본값도 dry-run입니다. 실제 설치를 명시적으로 요청한 환경에서만 --install을 사용합니다. 필요하면 --node <node.exe>, --connection <connection.json>, --destination <설치폴더>로 경로를 지정합니다. 설치는 사용자 HKCU의 com.autopets.bridge 키와 지정한 설치 폴더에만 기록하며 브라우저 프로필·Codex 신뢰·Windows 보안 설정을 바꾸지 않습니다. connection.json의 인증값을 복사하거나 출력하지 않습니다. 설정은 경로만 보관합니다.

설치 후 사용자가 확장 popup의 **ChatGPT 연결 허용**을 눌러야 chatgpt.com 접근이 활성화됩니다. **연결 끄기**는 해당 접근 권한과 상태 스크립트를 해제합니다. 실제 입력·모델 자동 변경은 연결 버튼으로 켜지지 않습니다.

## 남은 실제 검증

1. 사용자 PC의 Chrome이 등록된 Node wrapper를 시작하고 프레이밍 응답을 받는지 확인.
2. 실제 앱 상태와 확장 표시가 맞고 브리지 종료·재시작을 구분하는지 확인.
3. 계정/대화/모델/전송의 신뢰할 수 있는 식별 방법을 각각 검증한 뒤에만 별도 기능 활성화 검토.
4. 이후 실제 입력창에서 원문, IME, 첨부, 메시지 편집, 제출 증거, 경로 변경, 롤백을 검증. fixtures 통과를 실제 전달 성공으로 간주하지 않음.

설계 기준: [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)의 stdio·origin·HKCU 규약, [optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)의 사용자 동의, [scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)의 격리된 상태 스크립트를 따릅니다. 현재 ChatGPT DOM 호환성은 미검증입니다.
