import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function command(program, args) {
  const result = spawnSync(program, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} failed (${result.status ?? result.signal})`);
}

/** A real bundle gives Dock, LaunchServices and Keychain one stable app identity. */
function main() {
  const [executable, ...args] = process.argv.slice(2);
  if (!executable) throw new Error("Expected the Cargo executable path");
  const config = JSON.parse(readFileSync(join(root, "src-tauri/tauri.dev.conf.json"), "utf8"));
  const { version } = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const bundle = join(dirname(resolve(executable)), `${config.productName}.app`);
  const contents = join(bundle, "Contents");
  const resources = join(contents, "Resources");
  const binary = join(contents, "MacOS", "Garam");
  mkdirSync(dirname(binary), { recursive: true });
  mkdirSync(resources, { recursive: true });
  // Do not change Cargo's cached executable. Helpers use the signed copy
  // through current_exe(), just as they do in a release bundle.
  copyFileSync(executable, binary);
  for (const icon of ["icon.icns", "Assets.car"]) {
    copyFileSync(join(root, "src-tauri/icons/dev", icon), join(resources, icon));
  }
  writeFileSync(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>${config.identifier}</string>
  <key>CFBundleName</key><string>${config.productName}</string>
  <key>CFBundleDisplayName</key><string>${config.productName}</string>
  <key>CFBundleExecutable</key><string>Garam</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundleIconName</key><string>GaramDev</string>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleLocalizations</key><array><string>en</string><string>ko</string></array>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`,
  );
  const identity = process.env.GARAM_DEV_SIGNING_IDENTITY || "-";
  if (identity === "-") {
    console.warn(
      "Garam Dev: using ad-hoc signing. Set GARAM_DEV_SIGNING_IDENTITY or .signing/dev.json to keep Keychain access across rebuilds.",
    );
  }
  command("/usr/bin/codesign", [
    "--force",
    "--sign",
    identity,
    "--identifier",
    config.identifier,
    "--timestamp=none",
    bundle,
  ]);
  command("/usr/bin/codesign", ["--verify", "--strict", bundle]);
  // Replace the runner process so Tauri's watcher and Ctrl+C control the
  // app directly. This also preserves stdin/stdout for askpass helpers.
  process.execve(binary, [binary, ...args], process.env);
}

try {
  main();
} catch (error) {
  console.error(`Garam Dev: ${error.message}`);
  process.exitCode = 1;
}
