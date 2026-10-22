#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Regeneration needs Xcode 27+. Regular app builds use the checked-in assets.
developer_dir="$(xcode-select -p)"
icon_tool="$developer_dir/../Applications/Icon Composer.app/Contents/Executables/ictool"
icon_source="src-tauri/icons/Garam.icon"
icon_output="src-tauri/icons"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/garam-icons.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT

xcrun actool "$icon_source" --compile "$scratch" \
  --output-format human-readable-text --notices --warnings \
  --output-partial-info-plist "$scratch/info.plist" \
  --app-icon Garam --include-all-app-icons --enable-on-demand-resources NO \
  --target-device mac --minimum-deployment-target 11.0 --platform macosx

"$icon_tool" "$icon_source" --export-image --output-file "$scratch/tile.png" \
  --platform macOS --rendition Default --width 824 --height 824 --scale 1 \
  --design-generation 27
swift scripts/pad-icon.swift "$scratch/tile.png" "$scratch/master.png"
pnpm tauri icon "$scratch/master.png" --output "$scratch/generated"

# Only desktop outputs: do not introduce unrelated Android/iOS assets.
for icon in "$scratch/generated/"*.png "$scratch/generated/"*.ico "$scratch/generated/"*.icns; do
  cp "$icon" "$icon_output/"
done
cp "$scratch/master.png" "$icon_output/icon.png"
cp "$scratch/Assets.car" "$icon_output/Assets.car"

# Linux packagers can select their native size without scaling a 32px icon up.
pnpm tauri icon "$scratch/master.png" --output "$icon_output" \
  --png 16 --png 48 --png 64 --png 256 --png 512 --png 1024
