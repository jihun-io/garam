import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

// Exercise the launcher under real Node: browser-oriented Vite transforms
// import.meta.url, whereas the CLI must resolve file URLs on every OS.
function devArgs(args, platform, node) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'import { devArgs } from "./scripts/tauri.mjs"; console.log(JSON.stringify(devArgs(...JSON.parse(process.argv[1]))));',
        JSON.stringify([args, platform, node ?? process.execPath]),
      ],
      { encoding: "utf8" },
    ),
  );
}

describe("Tauri development launcher", () => {
  it("does not change release, icon or CLI help arguments", () => {
    for (const args of [
      ["build", "--no-bundle"],
      ["build", "--config", "src-tauri/tauri.release.conf.json"],
      ["icon", "image.png"],
      ["--help"],
    ]) {
      expect(devArgs(args, "darwin")).toEqual(args);
    }
  });

  it("selects the development config on Windows and Linux without a signing runner", () => {
    for (const platform of ["win32", "linux"]) {
      const args = devArgs(["dev", "--release", "--", "--locked", "--", "my repo"], platform);
      expect(args).toEqual([
        "dev",
        "--release",
        "--config",
        expect.stringContaining("tauri.dev.conf.json"),
        "--",
        "--locked",
        "--",
        "my repo",
      ]);
    }
  });

  it("signs each macOS build and preserves Cargo/application arguments and spaces", () => {
    const args = devArgs(
      ["dev", "--no-watch", "--", "--locked", "--", "my repo", "--flag"],
      "darwin",
      "/path with spaces/node",
    );
    expect(args.slice(0, 4)).toEqual([
      "dev",
      "--no-watch",
      "--config",
      expect.stringContaining("tauri.dev.conf.json"),
    ]);
    expect(args.slice(-4)).toEqual(["--locked", "--", "my repo", "--flag"]);
    for (const target of ["aarch64", "x86_64"]) {
      const config = args.find((arg) => arg.startsWith(`target.${target}`));
      const runner = JSON.parse(config.slice(config.indexOf("=") + 1));
      expect(runner).toEqual([
        "/path with spaces/node",
        expect.stringMatching(/scripts[/\\]dev-macos\.mjs$/),
      ]);
    }
  });
});
