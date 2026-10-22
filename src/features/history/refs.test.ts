import { describe, expect, it } from "vitest";

import type { RefLabel } from "../../ipc";
import { groupRefs } from "./refs";

const ref = (oid: string, kind: RefLabel["kind"], name: string, current = false): RefLabel => ({
  oid,
  kind,
  name,
  current,
});

describe("groupRefs", () => {
  it("folds a remote branch into the local branch at the same commit", () => {
    const badges = groupRefs([
      ref("a", "branch", "main", true),
      ref("a", "remote", "origin/main"),
      ref("a", "remote", "upstream/main"),
      ref("a", "tag", "v1"),
    ]).get("a");
    expect(badges).toEqual([
      { kind: "branch", name: "main", current: true, remotes: ["origin/main", "upstream/main"] },
      { kind: "tag", name: "v1", current: false, remotes: [] },
    ]);
  });

  it("keeps remote branches apart when they point elsewhere", () => {
    const groups = groupRefs([
      ref("a", "branch", "feature/x"),
      ref("b", "remote", "origin/feature/x"),
      ref("a", "remote", "origin/other"),
    ]);
    expect(groups.get("a")?.map((b) => b.name)).toEqual(["feature/x", "origin/other"]);
    expect(groups.get("b")?.map((b) => b.name)).toEqual(["origin/feature/x"]);
  });

  it("puts the current ref first", () => {
    const badges = groupRefs([
      ref("a", "tag", "v1"),
      ref("a", "branch", "other"),
      ref("a", "head", "HEAD", true),
    ]).get("a");
    expect(badges?.map((b) => b.name)).toEqual(["HEAD", "other", "v1"]);
  });
});
