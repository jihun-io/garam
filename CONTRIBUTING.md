# Contributing to Garam

Thanks for helping. Garam is maintained in spare time, so replies can take a while. These notes save us both time.

## Before you start

- **Bugs**: open an [issue](https://github.com/jihun-io/garam/issues) with your OS, Git version (`git --version`), Garam version, what you did and what happened. Git's original output is under "Details" in Garam's error messages; please include it.
- **Small fixes** (typos, an obvious bug, a translation): send a pull request directly.
- **Anything larger** (a new feature, a change in behavior, a new dependency): open an issue first so we can agree on the approach before you spend time on it. Check [docs/ROADMAP.md](docs/ROADMAP.md) to see what's planned.
- **Translations**: see [TRANSLATING.md](TRANSLATING.md).

## Setting up

See [Build from source](README.md#build-from-source) in the README. `pnpm tauri dev` runs the app with hot reload for both the frontend and Rust.

## How the code is organized

| Path                   | What's there                                                           |
| ---------------------- | ---------------------------------------------------------------------- |
| `src/`                 | React + TypeScript frontend, one folder per feature in `src/features/` |
| `src-tauri/`           | Tauri commands. Kept thin: logic belongs in `garam-git`                |
| `crates/garam-git/`    | The Git engine. It runs the system `git` and doesn't depend on Tauri   |
| `crates/garam-github/` | GitHub sign-in and API                                                 |
| `src/locales/`         | Translations                                                           |
| `docs/`                | Design documents, in Korean                                            |

The design documents explain the reasons behind most rules. Read the ones that touch your change: [ARCHITECTURE.md](docs/ARCHITECTURE.md) for the engine and IPC, [DESIGN.md](docs/DESIGN.md) and [UI.md](docs/UI.md) before changing a screen.

## Rules the code follows

- **Every git call goes through the `GitCommand` builder.** Never `std::process::Command::new("git")` directly. The builder sets the locale, turns off terminal prompts, passes arguments without a shell and treats paths literally (ARCHITECTURE.md 2.2).
- **Every user-visible string is a translation key.** Add new keys to both `src/locales/en` and `src/locales/ko`; if you can't write the Korean, copy the English and say so in the pull request.
- **Rust doesn't build sentences for users.** Errors go to the frontend as an `ErrorKind` (or `AppErrorKind`) with params, and the frontend translates them. Error keys are the `snake_case` name of the kind.
- **`src/ipc/bindings.ts` is generated.** Don't edit it by hand: run `pnpm bindings` after changing a Tauri command or its types, and commit the result.
- **Anything that can lose data asks first**, with a confirmation dialog.
- **Enter-style shortcuts in text fields ignore IME composition** (`event.nativeEvent.isComposing`), or Korean, Japanese and Chinese input breaks.
- **Code, comments, identifiers and commit messages are in English.** Documents in `docs/` are in Korean.

## Tests and checks

Run these before you open a pull request; CI runs the same on macOS, Windows and Linux.

For documentation-only changes (`*.md`, `*.mdx`, `docs/**` or `LICENSE*`), run Prettier on the files you changed. CI keeps the required check names but skips the code setup, build and test steps.

```bash
cargo test --workspace
```

```bash
cargo clippy --workspace --all-targets --all-features -- -D warnings
```

```bash
cargo fmt --all --check
```

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm i18n:check && pnpm test
```

- Git engine features get an integration test that builds a real repository with the `TestRepo` fixture (the `testing` feature of `garam-git`).
- If you changed the UI, run the app with `pnpm tauri dev` and try it, in both light and dark themes. Screenshots in the pull request help.

## Branches

Garam follows [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow): `main` is the only long-lived branch, and every change reaches it through a pull request. Maintainers work the same way.

- **`main` is always green.** Nobody pushes to it directly; a pull request merges only after CI passes on macOS, Windows and Linux.
- **Branch from `main`, keep it short.** Name the branch after the change, with the Conventional Commits type as a prefix: `feat/checks-icon`, `fix/editor-picker`, `docs/roadmap`. Merge within days, not weeks; rebase on `main` or merge it in if you fall behind.
- **Pull requests are squash-merged.** The pull request title becomes the commit on `main`, so write it as a commit message. Commits inside your branch can be as messy as you like. The branch is deleted after the merge.
- **Releases are tags on `main`.** Pushing a `v*` tag builds and publishes the release; there's no release branch.
- **Patch releases for an older version** get a maintenance branch only when `main` has already moved on: branch `release/0.2` from the `v0.2.0` tag, cherry-pick the fix, tag `v0.2.1` there, and make sure the fix is on `main` too.

## Commits and pull requests

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org): `fix(history): draw only the visible files of a commit`. Explain _why_ in the body when it isn't obvious.
- The same goes for pull request titles, since the title becomes the squashed commit.
- Keep a pull request to one change. Say what you tested, and on which OS.

## Code from GitHub Desktop

[GitHub Desktop](https://github.com/desktop/desktop) is MIT licensed, and for hard parts (status and diff parsing, partial patches, progress parsing, error patterns) it's fine to study how it does things. Then write it to fit Garam's structure rather than copying.

- If you do need to bring over a substantial piece of code or data nearly as is, put a source comment at the top of the file and add GitHub Desktop's copyright and MIT notice to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Don't use GitHub's or GitHub Desktop's names, logos, icons or distinctive visual design: those are trademarks, outside the MIT license.
- Mention in the pull request which files you looked at.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
