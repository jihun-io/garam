import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { run } from "@tauri-apps/cli";

const root = new URL("../", import.meta.url);

/** Keep build/icon/bindings commands unchanged; only dev selects the dev identity. */
export function devArgs(args, platform = process.platform, node = process.execPath) {
  if (args[0] !== "dev") return args;
  const separator = args.indexOf("--");
  const options = separator < 0 ? args : args.slice(0, separator);
  const cargo = separator < 0 ? [] : args.slice(separator + 1);
  const result = [
    ...options,
    "--config",
    fileURLToPath(new URL("src-tauri/tauri.dev.conf.json", root)),
  ];
  if (platform === "darwin") {
    // Cargo's array form preserves spaces in Node and checkout paths. The
    // runner runs after every Rust rebuild, including `dev --release`.
    const runner = JSON.stringify([node, fileURLToPath(new URL("scripts/dev-macos.mjs", root))]);
    result.push(
      "--",
      "--config",
      `target.aarch64-apple-darwin.runner=${runner}`,
      "--config",
      `target.x86_64-apple-darwin.runner=${runner}`,
      ...cargo,
    );
  } else if (separator >= 0) {
    result.push("--", ...cargo);
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  process.env.VITE_GARAM_DEV = args[0] === "dev" ? "true" : "false";
  if (
    args[0] === "dev" &&
    process.platform === "darwin" &&
    !process.env.GARAM_DEV_SIGNING_IDENTITY
  ) {
    const file = new URL(".signing/dev.json", root);
    try {
      const { identity } = JSON.parse(readFileSync(file, "utf8"));
      if (typeof identity !== "string" || !identity.trim()) {
        throw new Error("Expected a non-empty identity in .signing/dev.json");
      }
      process.env.GARAM_DEV_SIGNING_IDENTITY = identity;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await run(devArgs(args), "pnpm tauri");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
