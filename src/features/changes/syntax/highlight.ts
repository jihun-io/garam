// Syntax highlighting for diffs. Shiki (TextMate grammars, the same family
// GitHub uses) is loaded on first use, one grammar at a time, with its
// JavaScript regex engine so no WebAssembly is needed.

import { useEffect, useState } from "react";
import type { HighlighterCore, ThemeRegistrationRaw } from "shiki/core";

import type { DiffLine, Hunk } from "../../../ipc";
import { languageFor } from "./language";

/** A stretch of a line in one color. `color` is unset for plain text. */
export type SyntaxToken = { text: string; color?: string; italic?: boolean; bold?: boolean };

export type LineTokens = Map<DiffLine, SyntaxToken[]>;

/** Diffs longer than this stay plain; highlighting them costs more than it helps. */
const MAX_LINES = 20_000;
/** Longer lines are left plain after this many characters (minified files). */
const MAX_LINE_LENGTH = 2_000;
/** Work this long before letting the page respond again. */
const SLICE_MS = 12;

const color = (name: string) => `var(--color-syntax-${name})`;
const PLAIN = "var(--color-ink)";

// Scopes grouped into the few colors in tokens.css (docs/DESIGN.md 1.1).
// Later rules win over earlier ones when both match.
const THEME: ThemeRegistrationRaw = {
  name: "garam",
  type: "light",
  settings: [
    { settings: { foreground: PLAIN, background: "var(--color-surface)" } },
    {
      scope: ["keyword", "storage", "entity.name.tag", "markup.heading"],
      settings: { foreground: color("keyword") },
    },
    {
      scope: [
        "keyword.operator",
        "punctuation",
        "meta.embedded",
        "source.groovy.embedded",
        "meta.template.expression",
      ],
      settings: { foreground: PLAIN },
    },
    {
      scope: [
        "keyword.operator.expression",
        "keyword.operator.word",
        "keyword.operator.logical.python",
        "keyword.operator.new",
        "keyword.operator.instanceof",
        "keyword.operator.sizeof",
        "punctuation.definition.template-expression",
        "punctuation.section.embedded",
        "punctuation.definition.tag",
        "punctuation.definition.heading",
      ],
      settings: { foreground: color("keyword") },
    },
    {
      scope: [
        "string",
        "punctuation.definition.string",
        "string.regexp",
        "markup.inline.raw",
        "markup.fenced_code",
        "markup.underline.link",
      ],
      settings: { foreground: color("string") },
    },
    {
      scope: [
        "constant",
        "support.constant",
        "variable.language",
        "variable.other.constant",
        "variable.other.enummember",
        "entity.other.attribute-name",
        "support.type.property-name",
        "meta.object-literal.key",
        "meta.property-name",
        "entity.name.label",
      ],
      settings: { foreground: color("constant") },
    },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call.generic",
        "entity.name.method",
        "variable.function",
        "entity.name.selector",
        "entity.other.attribute-name.class.css",
        "entity.other.attribute-name.id.css",
        "meta.decorator",
        "meta.attribute",
      ],
      settings: { foreground: color("function") },
    },
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "entity.name.struct",
        "entity.name.enum",
        "entity.name.interface",
        "entity.name.trait",
        "entity.name.namespace",
        "entity.name.module",
        "entity.other.inherited-class",
        "support.type",
        "support.class",
        "storage.type.java",
        "storage.type.cs",
      ],
      settings: { foreground: color("type") },
    },
    {
      scope: [
        "comment",
        "punctuation.definition.comment",
        "string.quoted.docstring",
        "markup.quote",
      ],
      settings: { foreground: color("comment") },
    },
    { scope: ["markup.heading", "markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
  ],
};

let highlighter: Promise<HighlighterCore> | null = null;
const loaded = new Map<string, Promise<boolean>>();

function getHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return highlighter;
  const created = (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);
    return createHighlighterCore({
      themes: [THEME],
      langs: [],
      // Skip the few patterns this engine can't run instead of failing the grammar.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  })();
  // A failed load (a chunk that couldn't be fetched) is tried again next time.
  created.catch(() => {
    if (highlighter === created) highlighter = null;
  });
  highlighter = created;
  return created;
}

/** Loads the grammar for `lang`; false when it can't be had. */
function loadLanguage(h: HighlighterCore, lang: string): Promise<boolean> {
  let done = loaded.get(lang);
  if (!done) {
    done = import("shiki/langs").then(async ({ bundledLanguages }) => {
      const grammar = bundledLanguages[lang as keyof typeof bundledLanguages];
      if (!grammar) return false;
      await h.loadLanguage(grammar);
      return true;
    });
    const current = done;
    loaded.set(lang, current);
    current.catch(() => {
      if (loaded.get(lang) === current) loaded.delete(lang);
    });
  }
  return done;
}

const yieldToPage = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Tokens for every line of `hunks`. Each side of a hunk (the lines before and
 * after the change) is read as one piece of code, so a comment or string that
 * spans lines keeps its color. Returns null if `cancelled` turns true.
 */
export async function highlightHunks(
  hunks: Hunk[],
  lang: string,
  cancelled: () => boolean,
): Promise<LineTokens | null> {
  const h = await getHighlighter();
  if (!(await loadLanguage(h, lang)) || cancelled()) return null;

  const tokens: LineTokens = new Map();
  let sliceStart = performance.now();
  for (const hunk of hunks) {
    for (const side of ["old", "new"] as const) {
      const lines = hunk.lines.filter((l) => l.kind !== (side === "old" ? "added" : "deleted"));
      const result = h.codeToTokensBase(lines.map((l) => l.text).join("\n"), {
        lang,
        theme: THEME.name,
        tokenizeMaxLineLength: MAX_LINE_LENGTH,
      });
      lines.forEach((line, i) => {
        // Unchanged lines are shown once, colored as they read after the change.
        if (side === "old" && line.kind === "context") return;
        tokens.set(
          line,
          (result[i] ?? []).map((t) => ({
            text: t.content,
            color: t.color && t.color !== PLAIN ? t.color : undefined,
            italic: (t.fontStyle ?? 0) & 1 ? true : undefined,
            bold: (t.fontStyle ?? 0) & 2 ? true : undefined,
          })),
        );
      });
    }
    if (performance.now() - sliceStart > SLICE_MS) {
      await yieldToPage();
      if (cancelled()) return null;
      sliceStart = performance.now();
    }
  }
  return tokens;
}

/** The file's first line, when the diff shows it. */
function firstLine(hunks: Hunk[]): string | undefined {
  const lines = hunks[0]?.lines ?? [];
  return (lines.find((l) => l.newLine === 1) ?? lines.find((l) => l.oldLine === 1))?.text;
}

/**
 * Syntax tokens for the lines of a diff of `path`; null while they're being
 * worked out, and for files with no grammar (shown as plain text).
 */
export function useSyntaxTokens(path: string | undefined, hunks: Hunk[]): LineTokens | null {
  const [result, setResult] = useState<{ for: Hunk[]; tokens: LineTokens } | null>(null);

  useEffect(() => {
    if (!path) return;
    const lang = languageFor(path, firstLine(hunks));
    const count = hunks.reduce((n, h) => n + h.lines.length, 0);
    if (!lang || count > MAX_LINES) return;
    let cancelled = false;
    highlightHunks(hunks, lang, () => cancelled)
      .then((tokens) => {
        if (tokens && !cancelled) setResult({ for: hunks, tokens });
      })
      // A grammar that fails to load or run leaves the diff as plain text.
      .catch((error: unknown) => console.warn(`highlighting ${path} failed`, error));
    return () => {
      cancelled = true;
    };
  }, [path, hunks]);

  return result?.for === hunks ? result.tokens : null;
}
