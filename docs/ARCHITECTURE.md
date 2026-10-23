# Garam 아키텍처

> 상태: 초안 v0.1 (2026-10-21)

## 1. 전체 구조

```
┌─────────────────────────── Tauri 앱 프로세스 ───────────────────────────┐
│                                                                        │
│  WebView (React + TypeScript)          Rust 코어                        │
│  ┌───────────────────────┐   IPC      ┌─────────────────────────────┐  │
│  │ UI 컴포넌트             │ ────────▶ │ src-tauri (얇은 명령 계층)     │  │
│  │ TanStack Query (서버상태)│ ◀──────── │  - #[tauri::command]          │  │
│  │ Zustand (UI 상태)       │  events/  │  - 진행률 Channel, 이벤트       │  │
│  │ i18next                │  channels │  - 파일 감시(notify)           │  │
│  └───────────────────────┘            └──────────────┬──────────────┘  │
│                                                      │                 │
│                 ┌────────────────────────────────┬───┘                 │
│                 ▼                                ▼                     │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐      │
│  │ crates/garam-github         │  │ crates/garam-git            │      │
│  │  - Device Flow 로그인       │  │  - git CLI 실행·출력 파싱   │      │
│  │  - GitHub REST API          │  │  - 도메인 타입, 오류 분류   │      │
│  └──────────────┬──────────────┘  └──────────────┬──────────────┘      │
└─────────────────┼────────────────────────────────┼─────────────────────┘
                  │ HTTPS                          │ spawn
 github.com, api.github.com                 시스템 git (2.35+)
```

### 저장소 레이아웃

```
Garam/
├── CLAUDE.md
├── LICENSE
├── docs/                   # 명세·설계·로드맵
├── src/                    # React 프론트엔드
│   ├── app/                # 앱 셸, 라우팅, 전역 provider
│   ├── features/           # 기능별 폴더 (changes, history, branches, repos, settings ...)
│   ├── components/         # 기능에 무관한 공용 UI 컴포넌트
│   ├── ipc/                # Rust 명령 바인딩(자동 생성) + 래퍼
│   ├── i18n/               # i18next 설정
│   └── locales/{en,ko}/    # 번역 JSON (네임스페이스별 파일)
├── src-tauri/              # Tauri 앱 crate (명령 계층)
└── crates/
    ├── garam-git/          # Git 엔진 라이브러리 (Tauri 의존성 없음)
    └── garam-github/       # GitHub 로그인·API 클라이언트 (Tauri 의존성 없음, 토큰은 저장하지 않음)
```

`garam-git`을 Tauri와 분리하는 이유는 두 가지다. Git 로직을 Tauri 없이 `cargo test`로 빠르게 테스트할 수 있고, 나중에 CLI나 다른 프론트엔드에서도 재사용할 수 있다.

## 2. Git 엔진 (`crates/garam-git`)

### 2.1 방식: git CLI 실행

libgit2나 gitoxide 대신 **시스템 `git` 바이너리를 실행하고 출력을 파싱**한다. GitHub Desktop(dugite)도 같은 방식을 쓴다.

- 장점: 사용자의 `.gitconfig`, 훅, credential helper, LFS, 서명 설정이 그대로 동작한다. 동작이 CLI와 완전히 같다.
- 단점: 프로세스 생성 비용이 든다. 그래서 같은 정보는 한 번의 호출로 가져오고, 결과는 프론트엔드에서 캐시한다.
- 성능상 꼭 필요할 때만(예: 대량 커밋 그래프 계산) gitoxide(`gix`) 도입을 검토한다. 쓰기 작업은 항상 CLI로 한다.

### 2.2 실행 규칙

모든 git 호출은 `GitCommand` 빌더 하나를 거친다. 빌더가 아래 규칙을 강제한다.

| 규칙                                                                                | 이유                                                                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `LC_ALL=C`, `LANGUAGE=C`                                                            | 출력·오류 문자열을 영어로 고정해서 파싱과 오류 분류를 안정적으로 한다. 번역은 앱이 한다 |
| `GIT_TERMINAL_PROMPT=0`                                                             | 터미널 프롬프트에서 멈추는 것을 막는다                                                  |
| 네트워크 작업은 `GIT_ASKPASS` / `SSH_ASKPASS` → 앱의 askpass 헬퍼 (2.7)             | 자격 증명 입력을 앱 UI로 받는다                                                         |
| `-c core.quotePath=false` + 가능한 곳은 `-z`                                        | 한글 등 비ASCII 경로를 이스케이프 없이 정확히 받는다                                    |
| 읽기 전용 명령에 `--no-optional-locks`                                              | 사용자가 터미널에서 git을 함께 쓸 때 index.lock 충돌을 줄인다                           |
| 기계 판독용 포맷 사용 (`status --porcelain=v2 -z`, `log --format=` + NUL 구분자 등) | 사람용 출력은 버전마다 바뀔 수 있다                                                     |
| 인자를 배열로 전달, 셸을 거치지 않음                                                | 경로·브랜치 이름 인젝션 방지                                                            |
| 경로 인자 앞에 `--`                                                                 | `-`로 시작하는 파일명 처리                                                              |
| `GIT_LITERAL_PATHSPECS=1`                                                           | `*`, `[ab].txt` 같은 파일명이 다른 파일까지 가리키지 않게 한다(변경 취소 데이터 손실)   |
| 취소 가능한 실행 + 타임아웃                                                         | clone·fetch 같은 장시간 작업                                                            |

### 2.3 모듈 구성 (예정)

```
garam-git/src/
├── command.rs     # GitCommand 빌더, 프로세스 실행, 취소
├── error.rs       # GitError, stderr → 오류 종류 분류
├── version.rs     # git 버전 감지·최소 버전 검사
├── repo.rs        # 저장소 열기/검증/init/clone
├── status.rs      # porcelain v2 파서
├── diff.rs        # unified diff 파서 → 구조화된 hunk/line
├── patch.rs       # 선택한 줄로 부분 패치 생성 (줄 단위 스테이징)
├── commit.rs      # commit/amend
├── branch.rs      # 브랜치 목록·생성·전환·삭제·병합
├── remote.rs      # fetch/pull/push/publish, 원격 저장소 정보
├── credential.rs  # askpass로 들어온 git·ssh 프롬프트 분류
├── log.rs         # 히스토리 페이지 조회, 커밋 상세·diff, revert
├── commit_graph.rs # commit-graph 파일 만들기·새 커밋 덧붙이기·블룸 필터 (대형 저장소 히스토리 속도)
├── stash.rs       # 스태시 목록·보관·적용·버리기
└── conflict.rs    # 충돌 상태 감지, ours/theirs 해결
```

### 2.4 스테이징 모델

- **index가 기준이다.** 파일 체크박스는 index 상태를 그대로 보여주고, 누르는 즉시 `git add`/`git restore --staged`를 실행한다. 그래서 터미널에서 함께 git을 써도 화면이 어긋나지 않는다. (GitHub Desktop은 선택을 앱 상태로 들고 있다가 커밋할 때 스테이징한다. Garam은 이 방식을 따르지 않는다.)
- 체크박스 상태: 전부 스테이지됨 = 체크, 일부만 = 혼합, 없음 = 빈칸.
- diff 뷰어는 **HEAD → 작업 폴더** 전체 변경을 보여준다(스테이지 여부와 무관). 커밋이 없는 저장소는 빈 트리와 비교한다.
- 경로 목록은 `--pathspec-from-file=- --pathspec-file-nul`로 stdin에 넘긴다. 명령줄 길이 제한과 특수 문자 문제를 피하기 위해서다.
- 변경 취소는 작업 폴더에 있는 파일을 먼저 시스템 휴지통으로 옮긴 뒤 HEAD 상태로 되돌린다. 휴지통 이동이 실패하면 아무것도 되돌리지 않는다.

### 2.5 줄 단위 스테이징 (`patch.rs`)

패치를 만들어 `git apply --cached`로 적용하는 대신, **index가 가져야 할 파일 내용을 직접 만들어 기록**한다.

1. HEAD → 작업 폴더 diff를 구조화한다. 줄은 `LineRef`(추가 줄은 새 줄 번호, 삭제 줄은 이전 줄 번호)로 식별한다.
2. 프론트는 "스테이지되어야 할 줄 전체 집합"을 보낸다(토글이 아니라 절대 선택). 그래서 같은 요청을 다시 보내도 결과가 같다.
3. HEAD 내용에 선택된 변경만 적용해 새 내용을 만든다. 문맥 줄과 적용하지 않은 삭제 줄은 HEAD에서 바이트 그대로 복사하므로 CRLF와 파일 끝 줄바꿈 상태가 보존된다.
4. `git hash-object -w --stdin --no-filters`로 blob을 만들고 `git update-index --cacheinfo`로 index 항목을 바꾼다. 모드는 index → HEAD → 작업 폴더 순으로 가져온다.
5. 선택이 0개면 파일 단위 언스테이지, 전부면 파일 단위 스테이지로 처리한다(삭제·모드를 정확히 다루기 위해).

각 줄이 이미 스테이지됐는지는 보조 diff 두 개로 계산한다. 삭제 줄은 HEAD → index diff에서 지워졌으면 스테이지된 것이고, 추가 줄은 index → 작업 폴더 diff에서 추가로 나오지 않으면(이미 index에 있으면) 스테이지된 것이다.

diff 본문은 구문 강조를 한다(`src/features/changes/syntax/`). 어떤 문법을 쓸지는 GitHub Linguist의 파일 이름·확장자·shebang 표로 정한다. 이 표는 `pnpm languages`(`scripts/gen-languages.mjs`)가 `linguist-languages`와 Shiki 문법 목록을 맞춰 `languages.json`으로 만든다. Shiki와 각 언어 문법은 처음 쓸 때 불러오고, WebAssembly가 필요 없는 JavaScript 정규식 엔진을 쓴다(CSP를 넓히지 않음). hunk마다 이전 쪽(문맥+삭제 줄)과 이후 쪽(문맥+추가 줄)을 각각 이어진 코드로 토큰화해 여러 줄 주석·문자열이 이어지게 한다. 2만 줄이 넘는 diff는 강조하지 않고, 토큰화는 12ms마다 화면에 양보한다.

프론트의 diff 쿼리 키에는 파일의 staged/unstaged 상태가 들어간다. 상태가 바뀌면 줄 표시도 새로 계산해야 하기 때문이다. index를 쓰는 요청(스테이지, 줄 스테이지, 변경 취소, 커밋)은 `index.lock` 충돌을 피하려고 저장소마다 순서대로 실행한다(TanStack Query mutation `scope`).

### 2.6 브랜치 전환과 자동 보관

- "현재 브랜치에 보관하기"를 고르면 `git stash push --include-untracked --message garam-auto-stash:<브랜치>`로 보관한 뒤 전환한다. 그 브랜치로 돌아오면 메시지로 stash를 찾아 복원 배너를 띄운다.
- stash는 `stash@{n}` 대신 커밋 id로 가리킨다. 다른 stash가 생기면 번호가 밀리기 때문이다. 작업 직전에 id로 현재 번호를 다시 찾는다.
- 스태시는 `stash.rs`가 다룬다(목록, 보관, 적용·꺼내기, 버리기·되살리기, 스태시에서 브랜치 만들기, 파일과 diff). 스태시 커밋의 첫 부모는 보관한 커밋, 두 번째는 index, 세 번째는 추적하지 않는 파일이다. `--include-untracked`는 추적하지 않는 파일이 없어도 빈 세 번째 부모를 만들므로 트리가 비었는지로 판단한다.
- 적용은 `--index`로 스테이지 상태까지 되살리고, 그게 안 되면(`conflicts in index`) 없이 다시 적용한다. 보관한 추적하지 않는 파일이 이미 있으면 git은 추적 중인 변경을 적용한 뒤에 실패하므로, 적용하기 전에 겹치는 파일을 먼저 확인해 아무것도 하지 않는다. 충돌은 오류가 아니라 결과(`Conflicted`)로 돌려주고, 이때 꺼내기도 스태시를 지우지 않는다.
- 전환이 실패하면 **이번에 만든 stash만** 되돌린다. 보관할 변경이 없으면 git이 stash를 만들지 않으므로, 전후 `refs/stash`를 비교해 새로 생겼는지 확인한다.
- 원격 브랜치를 고르면 같은 이름의 로컬 브랜치가 있을 때는 그쪽으로, 없으면 `git switch --track`으로 추적 브랜치를 만들어 전환한다.

### 2.7 원격 동기화와 자격 증명

- **fetch**: `git fetch --progress --prune -- <원격>`. 기본 원격은 현재 브랜치의 업스트림 원격, 없으면 `origin`, 그것도 없으면 첫 번째 원격이다. 마지막 fetch 시각은 `FETCH_HEAD`의 수정 시각으로 보여준다.
- **pull**: `git pull` 한 번 대신 **업스트림 원격 fetch(취소 가능) → 로컬 통합** 두 단계로 나눈다. 네트워크 단계만 취소할 수 있고, 병합·리베이스 도중에 프로세스를 죽여 저장소를 망가뜨리는 일이 없다. 통합은 `branch.<이름>.rebase` → `pull.rebase` 순서로 설정을 따라 `git rebase`(merges면 `--rebase-merges`) 또는 `git merge --no-edit @{upstream}`(`pull.ff`가 only/false면 `--ff-only`/`--no-ff`)를 실행한다. 아무 설정이 없으면 병합한다. 그래서 git 2.27+의 "갈라진 브랜치를 어떻게 합칠지" 질문에서 멈추지 않는다.
- **push**: `git push --progress -- <업스트림 원격> refs/heads/<브랜치>:<branch.<이름>.merge>`로 refspec을 명시한다. `push.default` 설정과 무관하게 항상 업스트림으로 간다. 강제 푸시는 MVP에 없다.
- **publish**: `git push --set-upstream -- <원격> refs/heads/<브랜치>:refs/heads/<브랜치>`. 업스트림이 없거나 원격에서 삭제된(`gone`) 브랜치에 쓴다.
- 진행률 가중치는 작업마다 다르다(`TransferKind`). push는 `Writing objects` 단계를 쓴다.

**askpass 중계**

```
git/ssh ──GIT_ASKPASS/SSH_ASKPASS──▶ garam 실행 파일(헬퍼 모드)
                                        │ 127.0.0.1 TCP, 토큰 확인
                                        ▼
                         앱의 Askpass 서버 ──operationId──▶ 해당 작업의 Channel
                                                              │ RemoteEvent::Credential
                                                              ▼
                                               프론트 자격 증명 대화상자 → credential_respond
```

- 별도 헬퍼 바이너리를 배포하지 않고 **앱 실행 파일 자신**을 askpass로 쓴다. `main()`이 맨 먼저 `GARAM_ASKPASS_PORT` 환경 변수를 확인하고, 있으면 창을 열지 않고 프롬프트(argv[1])를 앱으로 보낸 뒤 답을 stdout에 쓰고 끝난다. 답이 없으면 종료 코드 1로 거절한다.
- 앱은 시작할 때 `127.0.0.1`의 임의 포트에 소켓을 열고 128비트 무작위 토큰을 만든다. 헬퍼 환경 변수로 포트·토큰·작업 ID를 넘긴다. 토큰이 틀린 요청에는 답하지 않는다.
- 프롬프트는 그 작업의 진행률 Channel로 함께 보낸다. 핸들러가 등록되지 않은 작업(백그라운드 fetch)은 즉시 거절되므로 아무도 보지 못하는 질문에서 git이 멈추지 않는다.
- 사용자가 프롬프트를 취소하면 그 작업을 취소한다. 작업이 끝나거나 취소되면 대기 중인 프롬프트도 모두 거절한다. 답을 기다리는 시간은 최대 10분이다.
- `SSH_ASKPASS_REQUIRE=force`로 터미널이 있어도 askpass를 쓰게 하고, 오래된 ssh를 위해 `DISPLAY`가 없으면 채운다.
- 프롬프트 문장(`LC_ALL=C`라 영어)은 `credential.rs`가 종류(사용자 이름, 암호, SSH 키 암호, SSH 암호, 호스트 키 확인, 기타)와 대상으로 나눈다. 문장은 프론트가 번역한다.
- 사용자에게 credential helper가 있으면(macOS git의 `osxkeychain`, Git for Windows의 Git Credential Manager 등) 입력한 자격 증명은 앱이 저장하지 않는다. 인증에 성공하면 git이 그 helper에 저장한다. 예외는 앱이 발급받은 GitHub 토큰이다(2.10).
- **helper가 없을 때(Linux에서 흔함) 기억하기**: 모든 호스트에 쓰는 `credential.helper`가 없으면(빈 값은 그 앞의 helper를 지운 것으로 친다, `credential::has_helper`) 앱 실행 파일을 `-c credential.helper=…`로 덧붙이고, 암호 입력 창에 "이 컴퓨터에 기억"(기본 켬)을 보여 준다. 저장은 git의 helper 프로토콜을 그대로 따른다. git은 인증에 성공한 뒤에만 `store`를 보내므로 틀린 토큰은 저장되지 않고, 사용자가 기억을 골랐을 때만 저장한다. 인증이 거부되면 git이 보내는 `erase`로, 거부된 값이 저장된 값과 같을 때 지운다. 다음부터는 `get`에 저장된 값으로 답하므로 백그라운드 가져오기도 동작한다. 호스트·사용자 이름은 `logins.json`(설정 > 계정의 "이 컴퓨터에 기억한 로그인"에서 지움), 암호·토큰은 OS 키체인(서비스 `io.jihun.garam.git`)에 둔다. 계정 토큰을 내주는 호스트에서는 계정 helper가 이 helper를 지우므로 계정 토큰이 로그인 목록에 섞이지 않는다

**프론트**

- 툴바의 동기화 버튼 하나가 상황에 따라 바뀐다: 분리된 HEAD·동기화됨 → 가져오기, 받을 커밋 있음 → 풀, 보낼 커밋만 있음 → 푸시, 업스트림 없음·삭제됨 → 브랜치 게시. 옆 메뉴에서 다른 작업을 직접 고를 수 있다.
- 저장소마다 네트워크 작업은 한 번에 하나다(`syncStore`). pull은 index를 바꾸므로 커밋·스테이지와 같은 mutation scope에 들어간다.
- 백그라운드 fetch: 1분마다 확인해서 마지막 fetch(또는 시도)가 5분보다 오래됐으면 프롬프트 없이 fetch한다. 실패는 조용히 무시한다. 주기 설정은 M8.

### 2.8 히스토리

- 커밋 목록은 `git log -z --format=...`(필드 구분자 `0x1f`)로 HEAD에서 페이지 단위(100개, `--skip`/`--max-count`)로 가져온다. 프론트는 `useInfiniteQuery`로 끝에서 20줄 전에 다음 페이지를 미리 불러온다.
- 커밋의 변경 파일과 diff는 **첫 번째 부모**와 비교한다. 루트 커밋은 빈 트리와 비교한다. 병합 커밋 되돌리기도 `--mainline 1`로 첫 번째 부모 기준이다.
- 프론트에서 받은 커밋 id는 16진수만 허용한다. `HEAD~1`이나 `-`로 시작하는 값이 옵션·리비전 식으로 해석되지 않게 하기 위해서다. 브랜치 시작점도 `-`로 시작하면 거부한다.
- 히스토리 쿼리 키는 `["history", repo, ...]`로, 파일이 바뀔 때마다 무효화되는 `["repo", repo]` 아래에 두지 않는다. 목록 키에 HEAD 커밋 id를 넣어 HEAD가 움직일 때만 다시 불러오고, 커밋 상세와 diff는 바뀌지 않으므로 계속 캐시한다.
- revert는 커밋을 만들므로 다른 index 쓰기와 같은 mutation scope에서 실행한다. 충돌하면 `revert_conflict`로 안내하고 해결은 M7에서 한다.
- **commit-graph**: 저장소를 열면 `history_prepare`가 git의 commit-graph 파일(`.git/objects/info/commit-graph`)이 없을 때 한 번 만든다(`git commit-graph write --reachable`, `commit_graph.rs`). 이 파일이 없으면 `--topo-order`가 첫 커밋을 내기 전에 모든 커밋을 읽어서, 커밋 50만 개 저장소에서 페이지마다 약 1.5초가 걸린다(있으면 약 20ms). clone은 이 파일을 만들지 않고 `git gc`도 돌 때만 만든다. 캐시일 뿐이라 내용은 바뀌지 않는다. 이미 있으면 그 뒤에 생긴 커밋만 작은 층으로 덧붙인다(`--split`, git의 `fetch.writeCommitGraph`와 같은 방식). 저장소를 열 때와 가져오기·풀이 끝날 때 하고, 새 커밋이 없으면 파일을 건드리지 않는다. 그래프에 없는 커밋은 페이지마다 조금씩 비용이 들기 때문이다(50만 개 위에 2만 개면 10ms → 40ms). 덧붙이는 데는 2만 개에 약 60ms, 새 것이 없으면 약 10ms다. 단일 파일은 처음 덧붙일 때 chain으로 바뀌는데, git은 둘을 똑같이 읽는다. 가져오기 뒤의 덧붙이기가 실패해도(다른 git이 잠금을 쥔 경우 등) 무시한다. `core.commitGraph=false`면 만들지도 덧붙이지도 않는다. 경로 필터를 빠르게 하는 changed-path 블룸 필터(`--changed-paths`)는 쓰는 데 약 4배가 걸려서(커밋 50만 개에 약 7초), 기록을 처음 경로로 걸렀을 때 `history_prepare_paths`가 백그라운드에서 한 번 넣는다. 걸러진 목록은 기다리지 않는다. 블룸 필터가 있으면 아무 데서도 바뀌지 않은 경로의 첫 페이지가 3.6초에서 0.5초가 된다. 나중에 덧붙이는 층에도 git이 알아서 블룸 필터를 넣는다. 한 저장소(object store)에 대한 앱의 그래프 쓰기는 차례로 하고, 가져오기 뒤의 덧붙이기는 다른 쓰기가 진행 중이면 기다리지 않고 건너뛴다.
- **검색 취소**: 검색어나 필터를 바꾸면 이전 페이지 요청은 더 필요 없다. `history_list`는 프론트가 만든 `operationId`를 받고, TanStack Query가 그 쿼리를 중단(`signal`)하면 `operation_cancel`로 git 프로세스를 끝낸다. 코드 내용 검색(`-S`)은 커밋 50만 개에서 20초 넘게 걸리기 때문이다.
- **태그와 원격**: 원격에 태그가 있는지는 `ls-remote --tags --refs`로 원격 태그 객체 id를 받아 로컬 `%(objectname)`과 비교한다(같음·다름·없음, `remote::tag_states`). 네트워크 작업이라 기록 탭을 열 때 백그라운드 가져오기처럼 묻지 않는 방식으로 조회하고, 결과는 파일 감시가 무효화하는 `["repo", repo]` 밖의 쿼리 키(`["tag-states", repo, 원격, 태그 이름들]`)에 둔다. 태그를 만들거나 지우면 키가 바뀌어 한 번 다시 조회하고, 가져오기·푸시 뒤에는 무효화한다. 인증이 필요해 실패하면 "다시 확인"이 로그인 창을 띄울 수 있는 방식으로 다시 조회한다. `fetch --prune-tags`는 한 번도 푸시하지 않은 로컬 태그까지 지우므로 쓰지 않는다. 태그 푸시는 이름을 하나씩 지정하고(`refs/tags/x:refs/tags/x`), 덮어쓰기만 `+`를 붙인다

### 2.9 충돌 해결

- **진행 중인 작업 감지**: git 디렉터리(`rev-parse --absolute-git-dir`)의 `rebase-merge`/`rebase-apply`(단 `git am`은 제외), `MERGE_HEAD`, `REVERT_HEAD`, `CHERRY_PICK_HEAD` 순서로 확인한다. stash pop처럼 작업 없이 충돌만 남는 경우도 있으므로 작업과 충돌 파일 목록은 따로 다룬다.
- **충돌 종류**는 `git ls-files --unmerged -z`의 stage(1 공통 조상, 2 ours, 3 theirs) 조합으로 정한다. 상태 파서의 `FileChange`에는 넣지 않고 `conflict_state` 명령으로 따로 받는다.
- **"내 변경 / 상대 변경"은 사용자 기준**이다. 병합·되돌리기·체리픽에서는 내 변경 = stage 2(ours)지만, 리베이스에서는 git이 뒤바꾸므로 내 변경 = stage 3(theirs)이다. 충돌 종류 이름(`deleted_by_me` 등)도 같은 기준을 따른다.
- **한쪽 사용**: 그쪽 stage가 있으면 `git checkout --ours/--theirs` 후 `git add`, 그쪽에서 파일을 지웠다면 `git rm`.
- **해결 완료로 표시**: `git add --all -- <경로>`(삭제도 반영). 작업 폴더 파일에 `<<<<<<<`…`>>>>>>>` 줄이 남아 있으면 프론트가 한 번 더 확인한다. 충돌 파일의 체크박스는 막아서 표시 없이 해결 처리되는 일을 막는다.
- **계속**: 충돌이 남아 있으면 `conflicts_remain`으로 거부한다. 병합은 `git commit --no-edit`, 나머지는 `git rebase|revert|cherry-pick --continue`를 `GIT_EDITOR=true`로 실행해 git이 준비한 메시지를 그대로 쓴다. 리베이스는 다음 커밋에서 다시 멈출 수 있다.
- **중단**: `git <작업> --abort`. 해결한 내용이 사라지므로 확인 대화상자를 거친다.
- 작업이 진행 중이면 커밋 입력 대신 계속·중단 패널을 보여준다. 리베이스 도중 일반 커밋을 만들면 안 되기 때문이다.
- 파일 감시는 `REVERT_HEAD`, `CHERRY_PICK_HEAD`, `rebase-merge`, `rebase-apply` 변경에도 반응한다.

### 2.10 GitHub 계정

- **로그인**: OAuth Device Flow(`garam-github`). client secret 없이 client ID만 쓴다. `github_sign_in`이 일회용 코드를 `Channel`로 보내고 승인될 때까지 기다린다. 취소는 다른 장시간 작업처럼 `operation_cancel`이다. 프론트는 코드를 클립보드에 복사하고 인증 페이지를 시스템 브라우저로 연다.
- **scope**: `repo`(비공개 저장소 push·pull), `workflow`(워크플로 파일 push), `read:org`(저장소별 계정 추천), `user:email`(작성자 이메일 추천).
- **저장**: 계정 정보(로그인 이름, 이름, 아바타, 인증된 이메일, noreply 주소)는 앱 데이터 폴더의 `accounts.json`에, 토큰은 OS 키체인(`keyring`, 서비스 `io.jihun.garam.github`, 계정 `<host>/<user id>`)에 둔다. 키를 사용자 ID로 잡아 로그인 이름이 바뀌어도 같은 계정으로 본다.
- 토큰은 백엔드 밖으로 나가지 않는다. 프론트로 보내는 타입에는 토큰이 없다.
- 키체인에서 읽은 토큰은 앱이 실행되는 동안 메모리에 둔다. macOS는 키체인 항목을 만든 실행 파일과 서명이 다른 실행 파일이 읽으려 하면 사용자에게 묻는데, 개발 빌드(ad-hoc 서명)는 다시 빌드할 때마다 서명이 바뀌어 매번 묻게 된다. 그래서 한 번 실행하는 동안에는 한 번만 읽는다. 사용자가 거절하거나 창을 닫으면 `keychain_failed`로 '항상 허용'을 안내한다. 고정된 Developer ID로 서명하는 릴리스 빌드에서는 처음 한 번만 묻는다.
- **로그아웃**: 키체인에서 토큰을 지운다. GitHub의 토큰 폐기 API는 client secret이 필요해 부를 수 없으므로, 권한 취소는 GitHub 설정 페이지로 안내한다.
- 아바타는 `avatars.githubusercontent.com`에서 불러온다(CSP `img-src`에 추가).
- **저장소별 계정**: 저장소 목록 항목에 계정 키를 저장한다(`repo_set_account`). 고르지 않으면 지금까지처럼 사용자의 git 설정을 그대로 쓴다.
- **토큰을 git에 넘기기(credential helper)**: 계정이 있는 저장소의 네트워크 작업에는 `-c credential.https://<host>.helper=`(빈 값으로 사용자가 설정한 도우미 목록을 비움)와 `-c credential.https://<host>.helper=!'<garam 실행 파일>' 'garam-credential'`을 붙인다(`Git::with_credential_helper`). askpass와 같은 방식으로 **앱 실행 파일 자신**이 도우미가 되어, `main()`이 `garam-credential get`을 보면 창을 열지 않고 askpass 중계 소켓으로 앱에 물어 `username=<로그인 이름>`, `password=<토큰>`을 돌려준다. 앱은 그 작업에 맡겨 둔 계정(`Askpass::provide`)이 있고 호스트가 맞을 때만 답한다. `store`·`erase`는 아무것도 하지 않으므로 토큰이 사용자의 osxkeychain 등에 복사되지 않는다.
- 도우미 값은 git이 셸로 실행하므로 `!`로 시작하고 경로와 인수를 작은따옴표로 감싼다(공백·따옴표가 있는 경로). `!`가 없으면 git이 `git credential-<값>`으로 해석한다.
- 이 설정은 Garam이 실행하는 git에만 붙는다. 터미널에서 실행하는 git은 사용자의 설정(`gh auth git-credential`, 원격 URL의 사용자 이름 등)을 그대로 따른다.
- **추천**: 원격 URL의 사용자 이름(`https://jihun-io@github.com/...`) → 원격 소유자 → 작성자 이메일이 계정의 인증된 이메일·noreply 주소인 계정 순서.
- **불일치 경고**: 저장소에 계정이 있고 작성자 이메일이 그 계정의 인증된 이메일·noreply 주소가 아니면 GitHub가 커밋을 그 계정과 연결하지 않는다. 커밋 영역과 대화상자에 알리되 커밋을 막지는 않는다.

### 2.11 앱 업데이트

- `tauri-plugin-updater`를 Rust에서만 쓴다(`src-tauri/src/updater.rs`). 창이 여러 개라도 확인 결과·설치 상태는 하나라서, 상태를 Rust가 들고 바뀔 때마다 `update-changed` 이벤트로 모든 창에 알린다. 프론트용 플러그인 권한은 열지 않는다.
- 피드: `https://github.com/jihun-io/garam/releases/latest/download/latest.json`. GitHub의 "latest"는 공개된 정식 릴리스만 가리키므로 초안·프리릴리스는 설치된 앱에 가지 않는다. 릴리스 워크플로가 `latest.json`과 플랫폼별 업데이트 파일(macOS `.app.tar.gz`, Linux AppImage·deb, Windows NSIS)과 서명(`.sig`)을 올린다.
- 서명 확인: 업데이트 파일은 Tauri 업데이터 키(minisign)로 서명하고, 앱에 박힌 공개 키(`plugins.updater.pubkey`)로 확인한다. 개인 키는 GitHub Secrets에만 둔다. 키를 잃으면 기존 사용자에게 업데이트를 보낼 수 없다.
- 확인 시점: 시작 10초 뒤, 그 뒤로 6시간마다(설정 > 일반 > 업데이트에서 끌 수 있음). 개발 빌드는 스스로 확인하지 않는다. 메뉴 "업데이트 확인…"(macOS는 앱 메뉴, 그 외는 도움말)은 언제든 확인하고, "나중에"로 미룬 버전도 다시 보여준다.
- 설치: macOS·Linux는 내려받아 설치한 뒤 "지금 다시 시작"으로 적용한다(`app_restart`). Windows는 NSIS 설치 프로그램이 passive 모드로 앱을 닫고 설치한다. Linux deb는 `pkexec dpkg -i`로 설치한다(플러그인이 실행 중인 패키지 종류를 보고 고른다).
- 업데이트 산출물은 서명 키가 있어야 만들어지므로 로컬 `tauri build`에서는 끄고, 릴리스 워크플로만 `src-tauri/tauri.release.conf.json`으로 켠다.

## 3. IPC 설계

- 프론트↔Rust 통신은 **Tauri 명령(`invoke`)** 으로 한다. 명령 이름은 `도메인_동작`(예: `status_get`, `branch_create`).
- **타입 공유**: `tauri-specta`로 Rust 타입에서 TypeScript 바인딩을 자동 생성한다. 생성 파일은 `src/ipc/bindings.ts`이며 직접 수정하지 않는다. 디버그 실행 시와 `pnpm bindings`(= `export_bindings` 테스트)에서 다시 만들어지고, CI는 커밋된 파일이 최신인지 검사한다. 프론트는 `src/ipc/index.ts`의 `unwrap()`으로 결과를 값 또는 `CommandError`로 바꿔 TanStack Query에 넘긴다.
- **장시간 작업**(clone, fetch, pull, push): 진행률과 자격 증명 프롬프트를 `tauri::ipc::Channel<RemoteEvent>`로 스트리밍하고, 프론트가 만든 작업 ID로 취소할 수 있게 한다.
- **저장소 변경 감지**: Rust에서 `notify`로 작업 트리와 `.git`을 감시하고, 디바운스(약 200ms)한 뒤 `repo-changed` 이벤트를 보낸다. 프론트는 해당 쿼리를 invalidate한다. 감시는 창(label)마다 따로 두고, 창이 닫히면 멈춘다. 디바운서의 파일 ID 캐시는 쓰지 않는다(`NoCache`). 이름 변경 이벤트를 짝짓는 데만 쓰이는데, macOS·Windows에서는 감시를 시작할 때 저장소의 모든 파일을 훑고 경로를 메모리에 들고 있기 때문이다.
- **여러 창**: 창마다 보여 주는 저장소는 Rust의 `RepoWindows`(창 label → 저장소 경로)가 기억한다(`src-tauri/src/windows.rs`). `repo_list`·`repo_select`는 호출한 창 기준으로 `selected`를 돌려주고 바꾼다. 처음 뜬 창은 마지막으로 연 저장소(`repositories.json`의 `selected`)를 이어받는다. 새 창은 `window_open`이 첫 창 설정(`tauri.conf.json`)을 복사해 `repo-<n>` label로 만들고, 같은 저장소가 이미 열려 있으면 `window_focus_repo`처럼 그 창을 앞으로 가져온다. 설정은 저장소가 없는 `settings` 창 하나에 띄운다(`window_open_settings`). 페이지는 창 label을 보고 저장소 화면 대신 설정 화면만 그린다(`src/app/SettingsApp.tsx`). 권한(`capabilities/default.json`)은 `main`, `repo-*`, `settings` 창에 준다. 각 창은 웹뷰가 따로라 쿼리 캐시도 따로이므로, 설정은 `settings-changed` 이벤트로, 저장소 목록은 창 포커스 때 다시 읽어 맞춘다.
- **창 배치 복원**: `RepoWindows`는 저장소 창(`main`, `repo-*`)마다 저장소, 위치·크기(물리 픽셀, 최대화·전체 화면 전의 값), 최대화·전체 화면 여부를 마지막으로 포커스한 순서로 들고 `windows.json`에 저장한다. 창이 열리거나 저장소가 바뀌거나 포커스를 받거나 사용자가 닫을 때 저장하고, 이동·크기 변경은 메모리에만 두었다가 앱이 끝날 때(`RunEvent::Exit`, 다시 시작은 `app_restart`에서) 저장한다. 앱을 종료하면 창이 `CloseRequested` 없이 사라지므로, 목록에서는 사용자가 닫은 창(`CloseRequested`)만 빼고 마지막 창은 남긴다. 시작할 때 첫 항목은 `main` 창에, 나머지는 새 창에 적용하고(`restore_layout`), 목록에서 사라진 저장소의 창은 열지 않는다. 연결이 끊긴 모니터처럼 제목 막대를 잡을 수 없는 위치는 버린다. 창 label은 실행마다 새로 붙으므로 label 기준으로 저장하는 `tauri-plugin-window-state`는 쓰지 않는다.
- **취소**: 장시간 작업은 프론트가 만든 `operationId`로 `Operations` 레지스트리에 `CancelToken`을 등록하고, `operation_cancel`로 취소한다. `GitCommand::run_streaming`이 토큰을 확인해 git 프로세스를 종료한다.
- **앱 상태 저장**: 저장소 목록은 앱 데이터 폴더의 `repositories.json`에 저장한다(`src-tauri/src/repositories.rs`). 임시 파일에 쓴 뒤 이름을 바꾸는 방식으로 원자적으로 저장하고, 손상된 파일은 덮어쓰지 않고 `.corrupt-<시각>.json`으로 옮겨 둔다.
- **오류 코드**: Git 엔진 오류(`ErrorKind`)와 앱 계층 오류(`AppErrorKind`)는 `ErrorCode`로 합쳐서 하나의 문자열 유니언으로 프론트에 전달한다.
- **동시성**: 저장소 하나에서 쓰기 작업은 저장소별 큐로 직렬화한다. 읽기 작업은 병렬로 실행해도 된다.

## 4. 오류 처리와 번역

```rust
// 프론트로 직렬화되는 오류 형태
struct AppError {
    kind: ErrorKind,      // 예: "auth_failed", "non_fast_forward", "merge_conflict", "not_a_repo", "git_not_found"
    params: Map,          // 메시지 보간용 값 (브랜치 이름 등)
    detail: Option<String>, // git stderr 원문 (사용자가 "자세히"로 볼 수 있음)
}
```

- Rust는 사용자에게 보여줄 문장을 만들지 않는다. **`kind`와 `params`만 넘기고, 문장은 프론트엔드가 `errors:<kind>` 번역 키로 만든다.**
- stderr 패턴 → `ErrorKind` 매핑은 `error.rs`에 모으고, 패턴마다 실제 git 출력 샘플로 테스트한다.
- 분류되지 않은 오류는 `unknown`으로 보내고 원문을 보여준다.

## 5. 프론트엔드

| 영역      | 선택                                                                           |
| --------- | ------------------------------------------------------------------------------ |
| 빌드      | Vite, TypeScript `strict`                                                      |
| UI        | React 19, Radix UI 기반 접근성 컴포넌트, CSS 변수 기반 디자인 토큰             |
| 서버 상태 | TanStack Query. Git 데이터는 모두 쿼리로 다루고 `repo-changed` 이벤트로 무효화 |
| UI 상태   | Zustand (선택된 파일, 패널 크기 등)                                            |
| 목록      | `@tanstack/react-virtual` (파일 목록, 커밋 목록, 큰 diff)                      |
| i18n      | i18next + react-i18next, 네임스페이스별 JSON                                   |
| 구문 강조 | Shiki(TextMate 문법, JS 정규식 엔진, 지연 로딩) + GitHub Linguist 언어 판별    |
| 테스트    | Vitest + Testing Library, IPC는 목(mock)으로 대체                              |
| 린트·포맷 | ESLint, Prettier (Rust는 `cargo fmt`, `clippy`)                                |

### 5.1 i18n 규칙

- 모든 사용자 노출 문자열은 번역 키로 쓴다. JSX에 문자열을 하드코딩하지 않는다.
- 원본 언어는 영어(`en`). 키를 추가할 때 `en`과 `ko`를 함께 추가한다.
- 키 형식: `네임스페이스:영역.의미` (예: `changes:commit.summaryPlaceholder`).
- 날짜·상대 시간·숫자는 `Intl` API로 포맷한다.
- CI에서 언어별 키 누락·미사용 키를 검사한다.
- 용어 번역은 `docs/GLOSSARY.md`(M0에서 작성)를 따른다. 예: commit → 커밋, branch → 브랜치, stage → 스테이지, discard → 변경 취소.

### 5.2 한국어 환경 특이 사항

- **IME 조합**: 입력 필드에서 `Ctrl/Cmd+Enter`로 커밋할 때 `event.nativeEvent.isComposing`이 참이면 무시한다. 마지막 글자가 사라지거나 두 번 입력되는 문제를 막는다.
- **유니코드 정규화**: macOS 파일 시스템은 한글 파일명을 NFD로 저장할 수 있다. 경로를 비교할 때는 NFC로 정규화하고, 저장소의 `core.precomposeunicode` 설정을 존중한다.
- **글꼴**: 한글 글꼴(시스템 기본: Apple SD Gothic Neo / Malgun Gothic / Noto Sans KR)을 fallback 체인에 포함한다. diff용 고정폭 글꼴에도 한글 fallback을 넣는다.

## 6. 테스트 전략

- **Git 엔진 통합 테스트**가 가장 중요하다. `tempfile`로 임시 저장소를 만드는 픽스처 빌더(`TestRepo`)를 두고 충돌, rebase 중단, 서브모듈, 한글 파일명, CRLF, 빈 저장소 같은 상황을 재현한다.
- 파서(status, diff, log, 진행률)는 실제 git 출력 샘플로 단위 테스트한다.
- 프론트엔드는 기능별로 핵심 상호작용을 Vitest로 테스트한다.
- CI(GitHub Actions): macOS·Windows·Linux에서 `cargo test`, `pnpm test`, 린트, 번역 키 검사, Tauri 빌드.

## 7. 보안

- Tauri capability는 필요한 권한만 연다. 프론트엔드에서 임의 셸 실행 권한(shell plugin의 execute)은 열지 않는다. git 실행은 Rust 명령으로만 한다.
- 사용자가 입력한 자격 증명은 사용자의 git credential helper가 있으면 거기에 맡기고 앱은 저장하지 않는다. helper가 없을 때는 사용자가 "이 컴퓨터에 기억"을 고르고 인증에 성공한 값만 OS 키체인에 저장한다(2.7).
- 앱이 OS 키체인에 저장하는 것은 앱이 발급받은 GitHub 토큰과, 위처럼 사용자가 기억을 고른 로그인뿐이다. 둘 다 파일·로그·프론트로 보내지 않는다. 파일(`accounts.json`, `logins.json`)에는 비밀이 아닌 정보(계정·호스트·사용자 이름)만 둔다.
- 저장소의 `.git/config`(`core.fsmonitor`, `core.sshCommand`, 훅 등)가 실행하는 프로그램은 git 자체의 신뢰 범위라 막지 않는다. 이런 프로그램은 네트워크 작업 중 askpass 소켓에 물어 그 작업의 토큰을 받을 수 있지만, osxkeychain 같은 일반 credential helper에서 `git credential fill`로 받는 것과 같은 수준이다. 토큰을 작업당 한 번만 내주면 git-lfs처럼 한 작업에서 여러 번 묻는 경우가 깨지므로 그렇게 하지 않는다. 토큰은 작업이 끝나면 더 내주지 않고, 요청한 호스트가 계정 호스트와 같을 때만 내준다.
- 외부 링크는 시스템 브라우저로 연다.

## 8. 아직 정하지 않은 것

- 커밋 그래프 렌더링 방식(Canvas 대 SVG)
- Windows에서 git 번들 여부 (MVP는 시스템 git만 사용)
