# Garam

**English** · [한국어](README.ko.md)

Garam (from 가람, an old Korean word for "river") is a free, open-source Git client for macOS, Windows and Linux. It keeps the everyday flow of changes, commit and push on one screen, and it speaks your language: the whole interface, Git's own error messages included, is translated. Korean and English are available today.

> [!NOTE]
> Garam 0.1.0 is the first release. Expect rough edges; the Linux builds in particular have had less testing than macOS and Windows. Please [report what you find](https://github.com/jihun-io/garam/issues).

## Features

- **Changes and commits**: stage whole files, hunks or single lines; discard changes to the trash rather than losing them; amend, co-authors, and a per-repository author.
- **History**: commit graph, search by message, author, hash or code, filter by path or branch, compare any two commits or branches, and get lost commits back from the reflog.
- **Rewriting with care**: cherry-pick by dragging commits onto a branch, reorder by dragging, squash, reset, revert and undo the last commit. Anything that can lose work asks first and warns about force pushes.
- **Branches and sync**: create, switch (bring changes along or stash them), merge, fetch, pull and push with progress, plus background fetch. Tags made in Garam go up with the next push, and tags can be deleted on the remote too.
- **Sign-in inside the app**: HTTPS usernames and tokens, SSH key passphrases and first-time host keys are asked in Garam's own windows. Without a Git credential helper, Garam can remember a login in the system keychain.
- **Conflicts**: a banner that follows merges, rebases, cherry-picks and reverts, with per-file "mine / theirs" and an external editor.
- **GitHub accounts**: sign in with your browser, keep several accounts, and pick one per repository so the right account pushes and the right email authors. GitHub Enterprise Server sign-in, with a personal access token, is in beta.
- **Your language**: Git's errors are explained in your language with the original output one click away. Korean input (IME) and Korean file names work as you'd expect.
- **Fast on big repositories**: tested with 100,000 files and 500,000 commits.

## Install

Download the latest version from [Releases](https://github.com/jihun-io/garam/releases). Garam updates itself after that.

| System  | File                            | Notes                                                                  |
| ------- | ------------------------------- | ---------------------------------------------------------------------- |
| macOS   | `Garam_<version>_universal.dmg` | macOS 12 or later, Apple silicon and Intel. Signed and notarized.      |
| Windows | `Garam_<version>_x64-setup.exe` | Windows 10 or later. See the note below.                               |
| Linux   | `.AppImage` or `.deb`           | Ubuntu 22.04 or later, or a similar distribution. x86-64 only for now. |

Garam uses the Git already installed on your computer, **version 2.35 or later**. If Git is missing or too old, Garam tells you how to install it:

- macOS: `xcode-select --install`, or `brew install git`
- Windows: [Git for Windows](https://git-scm.com/download/win)
- Linux: your package manager, e.g. `sudo apt install git`

**Windows: "Windows protected your PC"**. The Windows installer isn't code signed yet, so SmartScreen may stop it. Choose **More info**, then **Run anyway**. Signing is planned.

**Linux**: make the AppImage executable (`chmod +x Garam_*.AppImage`) and run it, or install the deb with `sudo apt install ./Garam_*.deb`.

## Build from source

You need [Rust](https://rustup.rs) (the version is pinned in `rust-toolchain.toml`, rustup installs it for you), Node.js 22.15+ and pnpm 10, plus the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your system. On Ubuntu:

```bash
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libxdo-dev build-essential libssl-dev
```

Then:

```bash
pnpm install
pnpm tauri dev
```

`pnpm tauri build --no-bundle` makes a release build without an installer.

## Contributing

Bug reports, ideas and translations are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and [TRANSLATING.md](TRANSLATING.md) to add or improve a language.

The design documents (in Korean) live in [`docs/`](docs): the product [spec](docs/SPEC.md), [architecture](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md), [design principles](docs/DESIGN.md) and [UI rules](docs/UI.md).

## License

[MIT](LICENSE). Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Garam is an independent project and is not affiliated with or endorsed by GitHub, Inc. GitHub is a trademark of GitHub, Inc.
