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
│                                       ┌──────────────▼──────────────┐  │
│                                       │ crates/garam-git             │  │
│                                       │  - git CLI 실행·출력 파싱       │  │
│                                       │  - 도메인 타입, 오류 분류        │  │
│                                       └──────────────┬──────────────┘  │
└──────────────────────────────────────────────────────┼─────────────────┘
                                                       │ spawn
                                                 시스템 git (2.35+)
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
    └── garam-git/          # Git 엔진 라이브러리 (Tauri 의존성 없음)
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
| `GIT_ASKPASS` / `SSH_ASKPASS` → 앱의 askpass 헬퍼                                   | 자격 증명 입력을 앱 UI로 받는다 (M5)                                                    |
| `-c core.quotePath=false` + 가능한 곳은 `-z`                                        | 한글 등 비ASCII 경로를 이스케이프 없이 정확히 받는다                                    |
| 읽기 전용 명령에 `--no-optional-locks`                                              | 사용자가 터미널에서 git을 함께 쓸 때 index.lock 충돌을 줄인다                           |
| 기계 판독용 포맷 사용 (`status --porcelain=v2 -z`, `log --format=` + NUL 구분자 등) | 사람용 출력은 버전마다 바뀔 수 있다                                                     |
| 인자를 배열로 전달, 셸을 거치지 않음                                                | 경로·브랜치 이름 인젝션 방지                                                            |
| 경로 인자 앞에 `--`                                                                 | `-`로 시작하는 파일명 처리                                                              |
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
├── remote.rs      # fetch/pull/push, ahead/behind, 진행률 파싱
├── log.rs         # 히스토리 페이지 단위 조회
├── stash.rs
└── conflict.rs    # 충돌 상태 감지, ours/theirs 해결
```

### 2.4 줄 단위 스테이징

1. 파일의 diff를 구조화된 hunk/line으로 파싱한다.
2. 사용자가 선택한 줄만 반영한 패치를 만든다. 선택하지 않은 `+` 줄은 제거하고, 선택하지 않은 `-` 줄은 context(` `)로 바꾼 뒤 hunk 헤더의 줄 수를 다시 계산한다.
3. `git apply --cached --unidiff-zero=false`로 index에 적용한다(언스테이징은 `--reverse`).
4. 새 파일, 삭제된 파일, 파일 끝 줄바꿈 없음(`\ No newline at end of file`), CRLF 파일은 테스트 케이스로 반드시 다룬다.

## 3. IPC 설계

- 프론트↔Rust 통신은 **Tauri 명령(`invoke`)** 으로 한다. 명령 이름은 `도메인_동작`(예: `status_get`, `branch_create`).
- **타입 공유**: `tauri-specta`로 Rust 타입에서 TypeScript 바인딩을 자동 생성한다. 생성 파일은 `src/ipc/bindings.ts`이며 직접 수정하지 않는다. 디버그 실행 시와 `pnpm bindings`(= `export_bindings` 테스트)에서 다시 만들어지고, CI는 커밋된 파일이 최신인지 검사한다. 프론트는 `src/ipc/index.ts`의 `unwrap()`으로 결과를 값 또는 `CommandError`로 바꿔 TanStack Query에 넘긴다.
- **장시간 작업**(clone, fetch, push): 진행률은 `tauri::ipc::Channel`로 스트리밍하고, 작업 ID를 반환해 취소할 수 있게 한다.
- **저장소 변경 감지**: Rust에서 `notify`로 작업 트리와 `.git`을 감시하고, 디바운스(약 200ms)한 뒤 `repo-changed` 이벤트를 보낸다. 프론트는 해당 쿼리를 invalidate한다.
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
- 자격 증명은 앱이 저장하지 않는다. git credential helper(OS 키체인)에 맡긴다.
- 외부 링크는 시스템 브라우저로 연다.

## 8. 아직 정하지 않은 것

- 인앱 diff 구문 강조(Shiki 지연 로딩 검토), 커밋 그래프 렌더링 방식(Canvas 대 SVG)
- Windows에서 git 번들 여부 (MVP는 시스템 git만 사용)
- 자동 업데이트 배포 채널(GitHub Releases + Tauri updater 검토)
