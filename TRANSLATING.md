# Translating Garam

Garam's goal is to let people use Git in their own language, so translations matter as much as code. This guide covers improving an existing translation and adding a new language.

## Where the text lives

Every string in the interface is in `src/locales/<language>/<namespace>.json`:

```
src/locales/
├── en/            ← the source language; every other language follows it
│   ├── common.json
│   ├── changes.json
│   ├── errors.json   ← Git and app error messages
│   ├── menu.json
│   └── ...
└── ko/
    └── ...
```

English is the source. A language must have exactly the same keys as English, no more and no fewer; `pnpm i18n:check` (also run in CI) lists any differences.

## Improving a translation

Edit the values in the language's JSON files and open a pull request. Say briefly why the new wording is better. If a term is used in many places, change it everywhere so the same action has the same name on every screen.

For Korean, follow the terms and style in [docs/GLOSSARY.md](docs/GLOSSARY.md).

## Adding a language

Take `xx` as the language code (use the [ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639_language_codes) code, e.g. `ja`, `de`).

1. Copy `src/locales/en` to `src/locales/xx` and translate the values.
2. Register it in `src/i18n/index.ts`: import each of the new JSON files, add them to `resources` under `xx`, and add `{ code: "xx", label: "<name in that language>" }` to `LANGUAGES`.
3. Add `xx` to `CFBundleLocalizations` in `src-tauri/Info.plist`, so the menu items macOS adds itself (Writing Tools, Emoji & Symbols) follow Garam's language.
4. Optional: if the Windows installer has your language, add its NSIS name (e.g. `"Japanese"`) to `bundle.windows.nsis.languages` in `src-tauri/tauri.conf.json`.
5. Check it:

   ```bash
   pnpm i18n:check && pnpm typecheck && pnpm test
   ```

6. Run `pnpm tauri dev`, pick the language in Settings > General, and go through the main screens (changes, history, branches, settings, a conflict, an error). Long words can break layouts; screenshots in the pull request help a lot.

Consider starting a short glossary for your language (like [docs/GLOSSARY.md](docs/GLOSSARY.md)) with the words Git uses most: repository, commit, branch, merge, push, pull, stash, rebase. It keeps later contributors consistent.

## Rules for the text

- **Keep placeholders as they are**: `{{count}}`, `{{branch}}`, `{{version}}`. Move them wherever your grammar needs them, but don't translate or remove them.
- **Plurals** use i18next suffixes: `_one` and `_other`. Keep both keys even if your language has a single form (give them the same text, as Korean does). Languages that need more forms (`_few`, `_many`) aren't supported by the key check yet; please open an issue.
- **Error messages** (`errors.json`) are keyed by the error's internal name (`merge_conflict`, `push_rejected`). Say what happened and what to do next. Git's original output is shown separately, so don't repeat it.
- **Keep a trailing ellipsis (…)** on menu items and buttons that open a dialog, as in `Clone Repository…`.
- **Keep Git's command names** where the text refers to the command itself (`git rebase`). Translate the explanation around it.
- **"Garam" stays "Garam"**.
- Match how apps on that system usually talk to people: short button labels, and the same politeness level throughout.

## Questions

Open an [issue](https://github.com/jihun-io/garam/issues) if a string is unclear out of context. Pointing to the screen where it appears is enough.
