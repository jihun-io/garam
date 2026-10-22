import { describe, expect, it } from "vitest";

import type { DiffLine, Hunk } from "../../../ipc";
import { highlightHunks } from "./highlight";
import { languageFor } from "./language";
import { lineSegments } from "./segments";

describe("languageFor", () => {
  it("knows files by extension, the way GitHub does", () => {
    expect(languageFor("src/App.tsx")).toBe("tsx");
    expect(languageFor("crates/garam-git/src/lib.rs")).toBe("rust");
    expect(languageFor("docs/SPEC.md")).toBe("markdown");
    expect(languageFor("include/util.h")).toBe("cpp");
    expect(languageFor("Main.KT")).toBe("kotlin");
    expect(languageFor("icon.svg")).toBe("xml");
  });

  it("prefers whole file names and longer extensions", () => {
    expect(languageFor("Dockerfile")).toBe("docker");
    expect(languageFor("app/Makefile")).toBe("make");
    expect(languageFor("tsconfig.json")).toBe("jsonc");
    expect(languageFor("views/home.blade.php")).toBe("blade");
  });

  it("falls back to the shebang, then to plain text", () => {
    expect(languageFor("bin/release", "#!/usr/bin/env node")).toBe("javascript");
    expect(languageFor("bin/setup", "#!/bin/bash -e")).toBe("shellscript");
    expect(languageFor("tool", "#!/usr/bin/python3.12")).toBe("python");
    expect(languageFor("bin/setup")).toBeNull();
    expect(languageFor("notes.unknownext", "hello")).toBeNull();
  });
});

describe("lineSegments", () => {
  const tokens = [
    { text: "const", color: "k" },
    { text: " x = " },
    { text: "42", color: "c" },
    { text: ";" },
  ];

  it("cuts tokens at changed-word edges", () => {
    expect(lineSegments("const x = 42;", tokens, [[4, 11]])).toEqual([
      { start: 0, marked: false, tokens: [{ text: "cons", color: "k" }] },
      {
        start: 4,
        marked: true,
        tokens: [{ text: "t", color: "k" }, { text: " x = " }, { text: "4", color: "c" }],
      },
      { start: 11, marked: false, tokens: [{ text: "2", color: "c" }, { text: ";" }] },
    ]);
  });

  it("leaves text the tokens don't cover plain", () => {
    expect(lineSegments("const x = 42;\r", tokens)).toEqual([
      { start: 0, marked: false, tokens: [...tokens, { text: "\r" }] },
    ]);
    expect(lineSegments("let y;", tokens, [[0, 3]])).toEqual([
      { start: 0, marked: true, tokens: [{ text: "let" }] },
      { start: 3, marked: false, tokens: [{ text: " y;" }] },
    ]);
  });
});

describe("highlightHunks", () => {
  const line = (kind: DiffLine["kind"], text: string, n: number): DiffLine => ({
    kind,
    text,
    oldLine: kind === "added" ? null : n,
    newLine: kind === "deleted" ? null : n,
    noNewline: false,
    staged: false,
  });

  it("colors each side of a hunk as continuous code", async () => {
    const lines = [
      line("context", "/* a comment", 1),
      line("deleted", "   that goes on */ const a = 1;", 2),
      line("added", "   that ends */ const b = 2;", 2),
    ];
    const hunk: Hunk = { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, section: "", lines };
    const tokens = (await highlightHunks([hunk], "typescript", () => false))!;

    for (const l of lines)
      expect(
        tokens
          .get(l)!
          .map((t) => t.text)
          .join(""),
      ).toBe(l.text);
    const colorOf = (l: DiffLine, text: string) =>
      tokens.get(l)!.find((t) => t.text === text)?.color;
    expect(tokens.get(lines[0])![0].color).toBe("var(--color-syntax-comment)");
    // Still inside the comment that the first line opened.
    expect(tokens.get(lines[2])![0].color).toBe("var(--color-syntax-comment)");
    expect(colorOf(lines[2], "const")).toBe("var(--color-syntax-keyword)");
    expect(colorOf(lines[2], "2")).toBe("var(--color-syntax-constant)");
  });
});
