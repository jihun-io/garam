// Builds src/features/changes/syntax/languages.json: which Shiki grammar
// highlights a file, decided the way GitHub does it (Linguist's file names,
// extensions and shebang interpreters). Run with `pnpm languages` after
// updating `shiki` or `linguist-languages`.
import { writeFile } from "node:fs/promises";

import * as linguist from "linguist-languages";
import { bundledLanguages, bundledLanguagesInfo } from "shiki";

const OUT = new URL("../src/features/changes/syntax/languages.json", import.meta.url);

// Extensions several languages claim, settled toward the common one (Linguist
// settles them by looking at the content, which a diff only partly has).
const PREFERRED = {
  h: "cpp",
  m: "objective-c",
  pl: "perl",
  ts: "typescript",
  md: "markdown",
  v: "verilog",
  cs: "csharp",
  sql: "sql",
  fs: "fsharp",
  pp: "puppet",
  r: "r",
  ex: "elixir",
  jsx: "jsx",
};

// Languages without a grammar of their own that read well in a related one.
const RELATED = {
  "Ant Build System": "xml",
  "Maven POM": "xml",
  SVG: "xml",
  "XML Property List": "xml",
  "HTML+PHP": "php",
  Cython: "python",
  "Jest Snapshot": "javascript",
  RMarkdown: "markdown",
  HiveQL: "sql",
  "Git Config": "ini",
  EditorConfig: "ini",
  Gradle: "groovy",
  "Gradle Kotlin DSL": "kotlin",
  Fortran: "fortran-fixed-form",
  Cuda: "cpp",
  HIP: "cpp",
  Metal: "cpp",
  OpenCL: "c",
  "Unix Assembly": "asm",
  Nunjucks: "jinja",
};

// Shiki grammar ids by every name they go by, including their TextMate scope.
const byName = new Map();
for (const info of bundledLanguagesInfo) {
  const grammars = (await bundledLanguages[info.id]()).default;
  const main = grammars.find((g) => g.name === info.id) ?? grammars.at(-1);
  for (const name of [main.scopeName, info.id, info.name, ...(info.aliases ?? [])]) {
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, info.id);
  }
}

const grammarOf = (language) =>
  [language.tmScope, language.name, language.name.replace(/\s+/g, "-"), ...(language.aliases ?? [])]
    .filter((name) => name && name !== "none")
    .map((name) => byName.get(name.toLowerCase()))
    .find(Boolean) ?? RELATED[language.name];

const filenames = {};
const extensions = {};
const interpreters = {};
const secondary = [];
let covered = 0;
const languages = Object.values(linguist);

for (const language of languages) {
  const id = grammarOf(language);
  if (!id) continue;
  covered += 1;
  for (const name of language.filenames ?? []) filenames[name] ??= id;
  for (const name of language.interpreters ?? []) interpreters[name] ??= id;
  // A language's first extension is its own; the rest yield to languages
  // whose first extension it is.
  const [primary, ...rest] = (language.extensions ?? []).map((e) => e.slice(1).toLowerCase());
  if (primary) extensions[primary] ??= id;
  for (const ext of rest) secondary.push([ext, id]);
}
for (const [ext, id] of secondary) extensions[ext] ??= id;
filenames["git-rebase-todo"] = "git-rebase";
for (const [ext, id] of Object.entries(PREFERRED)) {
  if (!bundledLanguages[id]) throw new Error(`no grammar ${id}`);
  extensions[ext] = id;
}

const sorted = (record) =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)));
await writeFile(
  OUT,
  `${JSON.stringify(
    {
      filenames: sorted(filenames),
      extensions: sorted(extensions),
      interpreters: sorted(interpreters),
    },
    null,
    2,
  )}\n`,
);
console.log(`${covered} of ${languages.length} Linguist languages have a grammar`);
