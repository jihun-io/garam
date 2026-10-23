import { describe, expect, it } from "vitest";

import type { CommitSummary, Stash } from "../../ipc";
import { buildRows, graphNodes } from "./rows";

const commit = (oid: string, parents: string[] = []): CommitSummary => ({
  oid,
  parents,
  authorName: "A",
  authorEmail: "a@example.com",
  authoredAt: 0,
  summary: oid,
});

const stash = (oid: string, base: string): Stash => ({
  oid,
  base,
  name: "stash@{0}",
  branch: "main",
  message: "note",
  auto: false,
  hasUntracked: false,
  createdAt: 0,
});

describe("buildRows", () => {
  const own = [commit("b", ["a"]), commit("a")];
  const base = { own, incoming: [commit("i", ["a"])], stashes: [stash("s", "a")], head: "b" };

  it("puts changes, incoming commits and stashes where they belong", () => {
    const rows = buildRows({ ...base, changedFiles: 2, extras: true });
    expect(rows.map((r) => `${r.kind}:${r.id}`)).toEqual([
      "wip:wip",
      "commit:i",
      "commit:b",
      "stash:s",
      "commit:a",
    ]);
    expect(graphNodes(rows, "b")).toEqual([
      { id: "wip", parents: ["b"], dashed: true },
      { id: "i", parents: ["a"], dashed: false },
      { id: "b", parents: ["a"], dashed: false },
      { id: "s", parents: ["a"], dashed: true },
      { id: "a", parents: [], dashed: false },
    ]);
  });

  it("drops incoming commits the history already has, and repeated rows", () => {
    // Right after a pull: the history moved, the markers not yet.
    const pulled = [commit("m", ["b", "i"]), commit("i", ["a"]), ...own, own[0]];
    const rows = buildRows({ ...base, own: pulled, changedFiles: 0, extras: true });
    expect(rows.map((r) => r.id)).toEqual(["m", "i", "b", "s", "a"]);
    expect(
      buildRows({ ...base, own: pulled, changedFiles: 0, extras: false }).map((r) => r.id),
    ).toEqual(["m", "i", "b", "a"]);
  });

  it("lists only commits for a search or filter", () => {
    const rows = buildRows({ ...base, changedFiles: 2, extras: false });
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("has no changes row without changes or commits", () => {
    expect(buildRows({ ...base, changedFiles: 0, extras: true })[0].kind).toBe("commit");
    expect(buildRows({ ...base, changedFiles: 1, head: null, extras: true })[0].kind).toBe(
      "commit",
    );
  });
});
