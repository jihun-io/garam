# Garam

[English](README.md) · **한국어**

Garam은 macOS, Windows, Linux에서 쓰는 무료 오픈소스 Git 클라이언트입니다. 변경 사항 확인, 커밋, 푸시로 이어지는 일상적인 흐름을 한 화면에서 끝낼 수 있고, Git이 내는 오류 메시지까지 우리말로 보여 줍니다. 지금은 한국어와 영어를 지원합니다.

> [!NOTE]
> Garam 0.1.0은 첫 정식 버전입니다. 아직 다듬어지지 않은 부분이 있을 수 있고, 특히 Linux 빌드는 macOS·Windows보다 덜 확인했습니다. 문제를 발견하면 [알려 주세요](https://github.com/jihun-io/garam/issues).

## 기능

- **변경 사항과 커밋**: 파일, hunk, 한 줄 단위로 커밋에 포함합니다. 변경을 취소한 파일은 바로 지우지 않고 휴지통으로 보냅니다. 마지막 커밋 수정, 공동 작성자, 저장소별 작성자를 지원합니다.
- **기록**: 커밋 그래프를 보여 줍니다. 메시지·작성자·해시·코드 내용으로 검색하고, 경로나 브랜치로 거를 수 있습니다. 커밋끼리, 브랜치끼리 비교할 수 있고, reflog에서 잃어버린 커밋을 되찾을 수 있습니다.
- **조심스러운 기록 수정**: 커밋을 브랜치로 끌어다 놓아 체리픽하고, 끌어서 순서를 바꿉니다. 스쿼시, 리셋, 되돌리기, 마지막 커밋 취소도 됩니다. 작업을 잃을 수 있는 동작은 먼저 묻고, 강제 푸시가 필요하면 미리 알립니다.
- **브랜치와 동기화**: 브랜치를 만들고 전환합니다. 전환할 때 변경 사항을 가져갈지 보관할지 고를 수 있습니다. 병합과 fetch·pull·push를 진행률과 함께 보여 주고, 백그라운드에서 fetch합니다. Garam에서 만든 태그는 다음 푸시 때 함께 올라가고, 태그를 원격에서까지 지울 수 있습니다.
- **앱 안에서 로그인**: HTTPS의 사용자 이름·토큰, SSH 키 암호, 처음 보는 서버의 호스트 키 확인을 Garam 창에서 묻습니다. Git 자격 증명 도우미가 없는 환경에서는 입력한 로그인을 시스템 키체인에 기억할 수 있습니다.
- **충돌 해결**: 병합, 리베이스, 체리픽, 되돌리기에서 생긴 충돌을 배너로 안내합니다. 파일마다 "내 변경 / 상대 변경"을 고르거나 외부 에디터에서 엽니다.
- **GitHub 계정**: 브라우저로 로그인하고 계정을 여러 개 등록할 수 있습니다. 저장소마다 계정을 고르면 푸시하는 계정과 커밋 작성자 이메일이 함께 맞춰집니다.
- **우리말로 쓰는 Git**: Git 오류를 해결 방법과 함께 우리말로 설명하고, 원문은 "자세히"에서 볼 수 있습니다. 한글 입력(IME) 조합 중 Enter 오작동이 없고, 한글 파일 이름도 제대로 다룹니다.
- **큰 저장소에서도 빠르게**: 파일 10만 개, 커밋 50만 개 저장소로 확인했습니다.

## 설치

[Releases](https://github.com/jihun-io/garam/releases)에서 최신 버전을 내려받으세요. 설치한 뒤에는 Garam이 스스로 업데이트합니다.

| 운영체제 | 파일                         | 참고                                                           |
| -------- | ---------------------------- | -------------------------------------------------------------- |
| macOS    | `Garam_<버전>_universal.dmg` | macOS 12 이상, Apple Silicon과 Intel 모두. 서명·공증됨.        |
| Windows  | `Garam_<버전>_x64-setup.exe` | Windows 10 이상. 아래 안내를 참고하세요.                       |
| Linux    | `.AppImage` 또는 `.deb`      | Ubuntu 22.04 이상이나 비슷한 배포판. 지금은 x86-64만 있습니다. |

Garam은 컴퓨터에 설치된 Git을 사용합니다. **Git 2.35 이상**이 필요합니다. Git이 없거나 버전이 낮으면 Garam이 설치 방법을 안내합니다.

- macOS: `xcode-select --install` 또는 `brew install git`
- Windows: [Git for Windows](https://git-scm.com/download/win)
- Linux: 배포판의 패키지 관리자. 예: `sudo apt install git`

**Windows에서 "Windows의 PC 보호" 창이 뜰 때**: Windows 설치 파일은 아직 코드 서명이 되어 있지 않아서 SmartScreen이 막을 수 있습니다. **추가 정보**를 누른 뒤 **실행**을 누르세요. 서명은 준비 중입니다.

**Linux**: AppImage는 실행 권한을 준 뒤(`chmod +x Garam_*.AppImage`) 실행하고, deb는 `sudo apt install ./Garam_*.deb`로 설치합니다.

## 소스에서 빌드하기

[Rust](https://rustup.rs)(버전은 `rust-toolchain.toml`에 고정되어 있어 rustup이 알아서 설치합니다), Node.js 22, pnpm 10, 그리고 운영체제별 [Tauri 준비 사항](https://tauri.app/start/prerequisites/)이 필요합니다. Ubuntu에서는 다음 패키지를 설치합니다.

```bash
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libxdo-dev build-essential libssl-dev
```

그다음 실행합니다.

```bash
pnpm install
pnpm tauri dev
```

설치 파일 없이 릴리스 빌드만 만들려면 `pnpm tauri build --no-bundle`을 실행합니다.

## 기여하기

버그 제보, 아이디어, 번역 모두 환영합니다. 풀 리퀘스트를 열기 전에 [CONTRIBUTING.md](CONTRIBUTING.md)를 읽어 주세요. 언어를 추가하거나 번역을 고치려면 [TRANSLATING.md](TRANSLATING.md)를 보세요.

설계 문서는 [`docs/`](docs)에 있습니다. [제품 명세](docs/SPEC.md), [아키텍처](docs/ARCHITECTURE.md), [로드맵](docs/ROADMAP.md), [디자인 원칙](docs/DESIGN.md), [UI 규칙](docs/UI.md), [용어 번역표](docs/GLOSSARY.md)가 있습니다.

## 라이선스

[MIT](LICENSE). 서드파티 고지는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 있습니다.

Garam은 독립 프로젝트이며 GitHub, Inc.와 제휴하거나 보증받은 관계가 아닙니다. GitHub는 GitHub, Inc.의 상표입니다.
