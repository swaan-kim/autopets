# 승완·서연·도엽 작업 시작

세 사람은 각자 별도 폴더에서 작업한다. 원래 개발 폴더와 다른 사람의 체크아웃을 함께 수정하지 않는다. 공통 규칙은 [공동 작업 안내](team-workflow.md)를 따른다.

| 사람 | GitHub 계정 | 개인 시작 브랜치 |
| --- | --- | --- |
| 승완 | [swaan-kim](https://github.com/swaan-kim) | `team/seungwan` |
| 서연 | [k-seo-yeon](https://github.com/k-seo-yeon) | `team/seoyeon` |
| 도엽 | [doyeop03](https://github.com/doyeop03) | `team/doyeop` |

이 브랜치들은 각자 체크아웃을 준비하는 기준이다. 실제 작업은 담당 Issue를 정한 뒤 `task/<Issue번호>-<작업이름>` 브랜치 하나와 PR 하나로 진행한다. 브랜치를 만들었다고 저장소 쓰기 권한이 생기지는 않는다. 서연·도엽은 각자 위 계정으로 [저장소 초대](https://github.com/swaan-kim/autopets/invitations)를 수락하고 쓰기 권한을 확인한다. 초대 발송과 수락 완료를 구분한다.

처음에는 자기 이름의 브랜치를 골라 별도 폴더로 받는다. 아래는 서연의 예이며 승완·도엽은 브랜치와 폴더 이름을 바꾼다.

```powershell
git clone --branch team/seoyeon https://github.com/swaan-kim/autopets.git autopets-seoyeon
cd autopets-seoyeon
git status --short --branch
git fetch origin
```

이제 GitHub의 열린 PR을 확인한다. 다른 사람이 올린 최신 PR은 본문·바뀐 파일·검사 결과를 직접 읽는 것을 권하며, 내 작업과 관련되거나 파일이 겹치는 PR은 반드시 확인한다. Issue에 목적·사람 담당자·수정 범위·완료 기준과 관련 PR을 적고, 최신 `origin/main`에서 새 작업 브랜치를 만든다. 아래의 `123`과 `short-name`은 실제 Issue 번호와 작업 이름으로 바꾼다.

```powershell
git switch -c task/123-short-name origin/main
```

다음 날 같은 작업을 이어갈 때도 [작업 시작 절차](team-workflow.md#매번-작업을-시작하거나-이어갈-때)에 따라 내 변경 보존 → 최신 코드 받기 → PR 확인 → 최신 main 반영을 먼저 한다. AI에는 `AGENTS.md` → 공동 안내 → 담당 Issue → 관련 PR·실제 diff → 검사 순서로 읽게 한다. 공통 스타일·패키지·CI·연동 파일은 작업마다 통합 담당을 정하고 수정 순서를 맞춘다.

작업 브랜치를 push한 뒤 `main`을 대상으로 PR을 연다. PR에는 짧은 요약과 사용 흐름의 전후 변화, 바꾼 의도와 장단점, 확인한 내용과 남은 점을 쉬운 말로 설명한다. 상세 비교 조건과 인계는 접힌 개발 기록에 모은다. 필요한 검사와 다른 사람 한 명의 승인을 받은 뒤 병합하며, 다른 사람의 승인을 AI가 대신 작성하지 않는다.

```powershell
git push -u origin task/123-short-name
```

병합 후 다음 작업은 최신 `origin/main`에서 새 작업 브랜치를 만든다. 개인 시작 브랜치나 작업 브랜치에 다른 사람의 변경이 있으면 강제로 초기화하지 않는다. PR #24·#26의 병합 상태와 이번 시작 브랜치의 실제 기준 커밋은 GitHub의 해당 PR·브랜치가 기준이며, 준비 중인 내용을 이미 `main`에 있다고 취급하지 않는다.
