#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Derive the development variant from the approved Icon Composer source.
developer_dir="$(xcode-select -p)"
icon_tool="$developer_dir/../Applications/Icon Composer.app/Contents/Executables/ictool"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/garam-dev-icons.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
cp -R src-tauri/icons/Garam.icon "$scratch/GaramDev.icon"
swift scripts/dev-icon-badge.swift "$scratch/GaramDev.icon/Assets/dev.png"
node --input-type=module - "$scratch/GaramDev.icon/icon.json" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
const file = process.argv[2];
const icon = JSON.parse(readFileSync(file, "utf8"));
icon.fill = { solid: "srgb:0.16,0.12,0.26,1" };
icon.groups.push({
  name: "Development",
  layers: [{ name: "DEV", "image-name": "dev.png", glass: false }],
  shadow: { kind: "neutral", opacity: 0 },
  specular: false,
  translucency: { enabled: false, value: 0 },
});
writeFileSync(file, JSON.stringify(icon, null, 2));
JS

xcrun actool "$scratch/GaramDev.icon" --compile "$scratch" \
  --output-format human-readable-text --notices --warnings \
  --output-partial-info-plist "$scratch/info.plist" \
  --app-icon GaramDev --include-all-app-icons --enable-on-demand-resources NO \
  --target-device mac --minimum-deployment-target 11.0 --platform macosx

"$icon_tool" "$scratch/GaramDev.icon" --export-image --output-file "$scratch/tile.png" \
  --platform macOS --rendition Default --width 824 --height 824 --scale 1 \
  --design-generation 27
swift scripts/pad-icon.swift "$scratch/tile.png" "$scratch/master.png"
pnpm tauri icon "$scratch/master.png" --output "$scratch/generated"
mkdir -p src-tauri/icons/dev
for icon in 32x32.png 128x128.png 128x128@2x.png icon.icns icon.ico; do
  cp "$scratch/generated/$icon" src-tauri/icons/dev/
done
cp "$scratch/master.png" src-tauri/icons/dev/icon.png
cp "$scratch/Assets.car" src-tauri/icons/dev/Assets.car
