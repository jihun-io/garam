# Garam 로드맵

> 각 마일스톤은 "동작하는 앱"으로 끝난다. 완료 조건을 모두 만족해야 다음 단계로 넘어간다.
> 마일스톤 순서는 의존 관계를 따른다. 진행하면서 체크박스를 갱신한다.

## M0. 프로젝트 기반

- [x] Tauri 2 + React + TypeScript + Vite 프로젝트 생성, pnpm 사용
- [x] Cargo workspace 구성 (`src-tauri`, `crates/garam-git`), `rust-toolchain.toml`로 Rust 버전 고정
- [x] ESLint, Prettier, `cargo fmt`, `clippy` 설정
- [x] i18next 설정, `en`/`ko` 기본 네임스페이스, 언어 전환 (설정 화면은 M8, 지금은 시작 화면에 배치)
- [x] `docs/GLOSSARY.md` (Git 용어 한국어 번역표)
- [x] 번역 키 누락 검사 스크립트 + 번역 키 타입 검사
- [x] Rust→TS 타입 바인딩 자동 생성 파이프라인 (tauri-specta)
- [x] `AppError` 형식과 프론트 오류 표시 컴포넌트
- [x] git 설치·버전 감지, 미설치 시 안내 화면
- [x] `TestRepo` 테스트 픽스처
- [ ] GitHub Actions CI (3개 OS) — 워크플로 작성 완료, 원격 저장소에 push한 뒤 첫 실행으로 검증 필요

**완료 조건**: 앱이 실행되고, git 버전이 표시되며, 한국어↔영어 전환이 되고, CI가 통과한다.

## M1. 저장소 관리

- [x] 로컬 저장소 추가 (폴더 선택, 드래그 앤 드롭, 저장소가 아니면 init 제안)
- [x] 새 저장소 만들기
- [x] 복제 (진행률, 취소, 실패·취소 시 부분 복제 정리)
- [x] 저장소 목록 저장·검색·제거, 사라진 저장소 표시와 위치 재지정
- [x] Finder/탐색기, 에디터(VS Code, Cursor, Zed, Sublime Text 감지), 터미널에서 열기

**남은 확인**: 네이티브 폴더 선택 대화상자, 드래그 앤 드롭, 외부 앱 실행은 실제 앱에서 직접 눌러 확인해야 한다(자동 테스트는 목으로 대체).

## M2. 변경 사항과 커밋

- [x] status 파서 + 파일 목록 (가상 스크롤, 키보드 이동·Space로 포함/제외)
- [x] 파일 감시 → 자동 새로고침 (`.git` 내부는 index·HEAD·refs 변경만 반영)
- [x] diff 파서 + diff 뷰어 (텍스트, 이미지 전후 비교, 바이너리, 너무 큰 diff)
- [x] 파일 단위 스테이징·언스테이징 (전체 선택 포함, 이름 변경은 양쪽 경로 함께)
- [x] 변경 취소 (확인 대화상자, 현재 내용은 휴지통으로 이동)
- [x] 커밋 (요약·설명, IME 처리), amend, Co-authored-by
- [x] Git 사용자 정보가 없을 때 설정 유도

**남은 확인**: 이미지 전후 비교와 휴지통 이동은 실제 앱에서 직접 확인해야 한다(자동 테스트는 목과 임시 삭제 함수로 대체).

## M3. 줄 단위 스테이징

- [x] 줄 단위 index 기록 + 예외 케이스 테스트 (새 파일, 커밋 없는 저장소, 삭제, 줄바꿈 없음, CRLF, 실행 권한)
- [x] hunk 단위·줄 단위 선택 UI (클릭, 드래그, 키보드: Tab으로 이동 후 Space)

**제외 범위**: 이름이 바뀐 파일, 충돌 파일, 서브모듈, UTF-8이 아닌 파일은 파일 단위로만 스테이징한다.

## M4. 브랜치

- [x] 브랜치 목록·검색 (로컬·원격, 로컬에 없는 원격 브랜치만 표시, 최근 커밋 순, ahead/behind)
- [x] 생성·전환·이름 변경·삭제 (이름 자동 정리, 병합 안 된 브랜치는 한 번 더 확인)
- [x] 변경 사항이 있을 때 전환하면 stash 또는 가져가기 선택, 돌아오면 복원 배너
- [x] 현재 브랜치에 병합 (가져올 커밋 수 미리보기, 충돌은 오류로 안내 — 해결 UI는 M7)

## M5. 원격 동기화

- [x] fetch/pull/push + 진행률 (pull은 fetch 단계만 취소 가능, 리베이스·ff-only 설정 존중)
- [x] ahead/behind 표시, publish (업스트림이 원격에서 삭제된 브랜치 포함)
- [x] askpass 헬퍼 + 앱 내 자격 증명 프롬프트 (HTTPS, SSH 암호, SSH 호스트 키 확인)
- [x] 백그라운드 fetch (5분, 프롬프트 없음 — 주기 설정은 M8)
- [x] non-fast-forward, 인증 실패 등 오류 안내

**남은 확인**: 실제 HTTPS 원격(개인 액세스 토큰)과 암호가 걸린 SSH 키로 앱 안에서 직접 로그인해 봐야 한다. askpass 중계는 실제 git + 앱 실행 파일 + Basic 인증 로컬 서버로 확인했고, 대화상자는 IPC 목으로 확인했다. Windows에서 GUI 서브시스템 실행 파일이 askpass로 stdout을 제대로 넘기는지도 확인이 필요하다.

## M6. 히스토리

- [x] 커밋 목록 (페이지 단위 로딩, 가상 스크롤, 키보드 이동)
- [x] 커밋 상세 + diff (첫 번째 부모 기준, 이름 변경 표시)
- [x] revert(병합 커밋 포함), 해시 복사, 여기서 브랜치 만들기

**남은 확인**: 대형 저장소(커밋 50만 개)에서 뒤쪽 페이지 로딩 속도는 M8 성능 점검에서 확인한다(`--skip`은 건너뛰는 만큼 비용이 든다). 커밋 diff의 이미지 전후 비교는 아직 없다.

## M7. 충돌 해결

- [ ] 병합·pull 충돌 상태 감지, 안내 배너
- [ ] 파일별 ours/theirs, 외부 에디터, 해결 완료 표시
- [ ] 병합 계속/중단

## M8. 마무리와 첫 릴리스 (v0.1.0)

- [ ] 설정 화면 (언어, 테마, Git 사용자 정보, 에디터·터미널, fetch 주기)
- [ ] 키보드 단축키, 접근성 점검
- [ ] 대형 저장소 성능 점검 (SPEC 성공 기준)
- [ ] macOS 서명·공증, Windows 서명, Linux 패키지 (AppImage, deb)
- [ ] 자동 업데이트
- [ ] README (영어·한국어), 기여 가이드, 번역 기여 가이드

## 이후 (v0.2+)

SPEC.md 7장 "GitHub Desktop과의 차별점"의 v0.2 이후 항목들, GitHub 로그인·PR 연동, 추가 언어.

### GitHub 계정 로그인 (v0.2 후보)

버튼 하나로 브라우저에서 GitHub에 로그인하고, 여러 계정을 등록해 저장소마다 골라 쓴다. 지금은 HTTPS 원격에서 개인 액세스 토큰을 직접 붙여 넣어야 한다(M5의 자격 증명 대화상자).

- [ ] GitHub OAuth App 등록 (프로젝트 소유자가 직접 해야 함, Device Flow 사용 설정)
- [ ] OAuth Device Flow 로그인: 버튼 → 일회용 코드를 클립보드에 복사하고 `github.com/login/device`를 시스템 브라우저로 연다 → 앱은 승인될 때까지 폴링
- [ ] 토큰을 OS 키체인에 계정별로 저장 (macOS 키체인, Windows 자격 증명 관리자, Linux Secret Service)
- [ ] 계정 목록·추가·로그아웃 (설정 화면, M8 이후), 계정 정보(로그인 이름, 아바타)는 GitHub API로 가져온다
- [ ] 저장소별 계정 선택: 원격 URL의 소유자와 계정이 속한 조직으로 추천, 선택은 저장소 목록에 저장
- [ ] 선택한 계정의 토큰을 git에 넘기기 (아래 설계)
- [ ] GitHub Enterprise Server 호스트 지원

**설계 메모**

- **Device Flow를 쓰는 이유**: 웹 플로(브라우저 → loopback 리디렉션)는 토큰 교환에 client secret이 필요한데, 오픈소스 앱에 넣으면 공개된다. Device Flow는 client ID만으로 동작하고 GitHub CLI도 이 방식을 쓴다. 사용자가 코드를 붙여 넣는 단계가 하나 더 있지만, 코드를 미리 클립보드에 넣어 두면 부담이 작다.
- **토큰 전달**: askpass보다 **credential helper**가 맞다. 사용자의 osxkeychain 같은 도우미에 다른 자격 증명이 저장돼 있으면 git이 askpass를 부르지 않기 때문이다. 네트워크 작업에 `-c credential.https://github.com.helper=`(목록 초기화)와 `-c credential.https://github.com.helper=<garam 실행 파일>`을 붙이고, askpass처럼 앱 실행 파일을 credential helper 모드로 실행해 작업 ID로 계정을 찾아 토큰을 돌려준다. 계정이 없는 저장소는 지금처럼 사용자 설정을 그대로 쓴다.
- **보안 원칙 변경**: ARCHITECTURE.md 7장의 "자격 증명은 앱이 저장하지 않는다"를 "앱이 발급받은 GitHub 토큰만 OS 키체인에 저장한다"로 바꿔야 한다. 토큰은 파일·로그·프론트로 보내지 않는다.
- **새 의존성**: HTTPS 클라이언트(`reqwest`, rustls)와 키체인 접근(`keyring`). 토큰이 오래 유지되므로 로그아웃할 때 GitHub에서도 토큰을 폐기한다.
- **테스트**: Device Flow와 API는 목 서버로, credential helper 프로토콜은 `git credential fill`로 통합 테스트한다.
