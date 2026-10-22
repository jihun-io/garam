# Garam

오픈소스 크로스 플랫폼 Git GUI 클라이언트. Tauri 2 + React + TypeScript, Git 엔진은 Rust에서 시스템 `git` CLI를 실행한다.

작업 전에 관련 문서를 읽는다.

- `docs/SPEC.md`: 제품 범위, MVP 기능, 화면 구성
- `docs/ARCHITECTURE.md`: 구조, Git 실행 규칙, IPC, 오류·i18n 규칙
- `docs/ROADMAP.md`: 마일스톤과 현재 진행 상황. 작업을 끝내면 체크박스를 갱신한다
- `docs/UI.md`: UI 규칙(커서, 아이콘, 툴팁, 단축키 등)과 UI 개선 계획. 화면을 만들거나 고칠 때 따른다

## 구조

- `src/`: React 프론트엔드 (`features/<기능>/` 단위로 구성)
- `src-tauri/`: Tauri 명령 계층. 얇게 유지하고 로직은 `garam-git`에 둔다
- `crates/garam-git/`: Git 엔진. Tauri에 의존하지 않는다

## 반드시 지킬 규칙

- **git 호출은 항상 `GitCommand` 빌더를 거친다.** 직접 `std::process::Command::new("git")`를 쓰지 않는다. 실행 규칙은 ARCHITECTURE.md 2.2.
- **사용자에게 보이는 문자열은 모두 번역 키로 쓴다.** 키를 추가하면 `src/locales/en`과 `src/locales/ko`에 함께 추가한다. 용어는 `docs/GLOSSARY.md`를 따른다.
- Rust는 사용자용 문장을 만들지 않는다. 오류는 `ErrorKind` + params로 보내고 번역은 프론트가 한다.
- `src/ipc/bindings.ts`는 자동 생성 파일이므로 직접 수정하지 않는다.
- 데이터를 잃을 수 있는 작업은 반드시 확인 대화상자를 거친다.
- 텍스트 입력에서 Enter 계열 단축키를 처리할 때 IME 조합 중(`isComposing`)이면 무시한다.
- 코드, 주석, 커밋 메시지, 식별자는 영어로 쓴다. 문서(`docs/`)는 한국어로 쓴다.

## 검증

기능을 끝냈다고 말하기 전에 실행한다.

- Rust: `cargo test --workspace`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, `cargo fmt --all --check`
- 프론트: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm i18n:check`, `pnpm test`
- Tauri 명령이나 그 타입을 바꿨다면 `pnpm bindings`로 `src/ipc/bindings.ts`를 다시 만들어 함께 커밋한다
- Git 엔진 기능에는 `TestRepo` 픽스처(`garam-git`의 `testing` feature)로 실제 저장소를 만드는 통합 테스트를 붙인다
- UI를 바꿨다면 `pnpm tauri dev`로 실제 앱을 띄워 확인한다

## 자주 쓰는 명령

- `pnpm tauri dev`: 앱 실행 (Vite + Rust, 핫 리로드)
- `pnpm tauri build --no-bundle`: 설치 파일 없이 릴리스 빌드
- `pnpm bindings`: Rust → TypeScript 바인딩 재생성

## 알아둘 점

- Rust 버전은 `rust-toolchain.toml`에 고정되어 있다(specta가 최신 표준 라이브러리 기능을 요구한다).
- Tauri npm 패키지(`@tauri-apps/api`, `@tauri-apps/plugin-*`)는 대응하는 Rust 크레이트와 major.minor가 같아야 한다. 다르면 `tauri build`가 실패한다. 한쪽을 올리면 다른 쪽도 맞춘다.
- 오류 번역 키는 Rust `ErrorKind`의 snake_case 이름을 그대로 쓴다. 그래서 i18next의 context 구분자를 `_` 대신 `#`으로 바꿔 두었다.
- 번역 키는 타입 검사된다. `t()`의 보간 값이 `Record<string, string>`이면 `{ replace: params }`로 넘긴다.

## GitHub Desktop 소스 참고 정책

GitHub Desktop(https://github.com/desktop/desktop)은 MIT 라이선스다. 어려운 로직(예: status·diff 파싱, 부분 패치 생성, 진행률 파싱, 오류 패턴)은 접근 방식을 참고해도 된다.

- 기본은 **읽고 이해한 뒤 우리 구조(Rust/React)에 맞게 직접 구현**하는 것이다. 처음부터 코드를 가져다 쓰지 않는다.
- 상당한 분량의 코드나 데이터(예: 오류 정규식 목록)를 거의 그대로 옮겨야 한다면, 해당 파일 상단에 출처 주석을 달고 `THIRD_PARTY_NOTICES.md`에 GitHub Desktop의 저작권·MIT 고지를 추가한다.
- GitHub·GitHub Desktop의 이름, 로고, 아이콘, 고유한 시각 디자인은 쓰지 않는다. 이것들은 상표 영역이라 MIT 라이선스 범위 밖이다.
- 참고한 경우 PR 설명에 어떤 파일을 참고했는지 적는다.
