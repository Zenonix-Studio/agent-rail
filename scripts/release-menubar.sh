#!/bin/bash
# Builds AgentRail.app in Release and packs it into dist/AgentRail-<version>.dmg.
#   DEVELOPER_ID="Developer ID Application: Name (TEAMID)" NOTARY_PROFILE=agent-rail scripts/release-menubar.sh
#     signs with Developer ID, notarizes and staples the DMG: it opens on any Mac without a warning.
#   scripts/release-menubar.sh --unsigned
#     ad-hoc signed, for trying the DMG locally; Gatekeeper blocks it on other Macs.
# One-time setup for the signed path:
#   1. Xcode > Settings > Accounts > Manage Certificates > + > Developer ID Application
#   2. xcrun notarytool store-credentials agent-rail --apple-id <apple id> --team-id <TEAMID>
#      (asks for an app-specific password from account.apple.com)
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p 'require("./.claude-plugin/plugin.json").version')
UNSIGNED=false
[ "${1:-}" = "--unsigned" ] && UNSIGNED=true
if ! $UNSIGNED && { [ -z "${DEVELOPER_ID:-}" ] || [ -z "${NOTARY_PROFILE:-}" ]; }; then
  sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
if $UNSIGNED; then
  SIGN=(CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM=)
else
  TEAM=$(sed -E 's/.*\(([A-Z0-9]+)\)$/\1/' <<<"$DEVELOPER_ID")
  # No get-task-allow (the debugger entitlement Xcode adds by default): notarization refuses it.
  SIGN=(CODE_SIGN_STYLE=Manual "CODE_SIGN_IDENTITY=$DEVELOPER_ID" "DEVELOPMENT_TEAM=$TEAM" "OTHER_CODE_SIGN_FLAGS=--timestamp" CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO)
fi

xcodebuild -project menubar/AgentRail.xcodeproj -scheme AgentRail -configuration Release \
  -destination 'generic/platform=macOS' -derivedDataPath "$WORK/build" \
  MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$VERSION" "${SIGN[@]}" -quiet build
APP="$WORK/build/Build/Products/Release/AgentRail.app"
codesign --verify --deep --strict "$APP"

# The DMG: the app beside an Applications link, to drag it across.
mkdir "$WORK/dmg"
cp -R "$APP" "$WORK/dmg/"
ln -s /Applications "$WORK/dmg/Applications"
NAME="AgentRail-$VERSION"
if $UNSIGNED; then NAME="$NAME-unsigned"; fi
hdiutil create -quiet -volname "AgentRail $VERSION" -srcfolder "$WORK/dmg" -fs HFS+ -format UDZO "$WORK/$NAME.dmg"

if ! $UNSIGNED; then
  codesign --sign "$DEVELOPER_ID" --timestamp "$WORK/$NAME.dmg"
  xcrun notarytool submit "$WORK/$NAME.dmg" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$WORK/$NAME.dmg"
  spctl --assess --type open --context context:primary-signature -v "$WORK/$NAME.dmg"
fi

mkdir -p dist
mv "$WORK/$NAME.dmg" dist/
shasum -a 256 "dist/$NAME.dmg"
$UNSIGNED && echo "Unsigned: Gatekeeper blocks this DMG on other Macs."
exit 0
