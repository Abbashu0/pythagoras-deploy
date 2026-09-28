#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MOBILE_ROOT="$REPO_ROOT/mobile"
IOS_ROOT="$MOBILE_ROOT/ios"
EXPECTED_BUNDLE_ID="com.abbashu.pythagoras"
DERIVED_DATA="$RUNNER_TEMP/pythagoras-derived-data"
XCODE_LIST="$RUNNER_TEMP/pythagoras-xcode-list.json"
XCODE_LOG="$RUNNER_TEMP/pythagoras-xcodebuild.log"

printf '%s\n' '=== Host diagnostics ==='
sw_vers
uname -a
xcodebuild -version
node --version
npm --version
printf 'Expo CLI: '
(cd "$MOBILE_ROOT" && npx expo --version)
ENRICHED_VERSION="$(cd "$MOBILE_ROOT" && node -p "require('./node_modules/react-native-enriched-markdown/package.json').version")"
DEV_CLIENT_VERSION="$(cd "$MOBILE_ROOT" && node -p "require('./node_modules/expo-dev-client/package.json').version")"
printf 'react-native-enriched-markdown: %s\n' "$ENRICHED_VERSION"
printf 'expo-dev-client: %s\n' "$DEV_CLIENT_VERSION"

if [ "$ENRICHED_VERSION" != '0.7.4' ]; then
  fail "Expected react-native-enriched-markdown 0.7.4; found $ENRICHED_VERSION"
fi
if [ "$DEV_CLIENT_VERSION" != '57.0.19' ]; then
  fail "Expected Expo SDK 57 expo-dev-client 57.0.19; found $DEV_CLIENT_VERSION"
fi

test -f "$MOBILE_ROOT/app/renderer-lab.tsx" || fail 'Development renderer lab is missing from the checked-out experiment branch.'
test -f "$MOBILE_ROOT/src/ai/assistant-enriched-markdown.ios.tsx" || fail 'Candidate renderer is missing from the checked-out experiment branch.'
test -d "$IOS_ROOT" || fail 'Expo prebuild did not create mobile/ios.'
test -f "$IOS_ROOT/Podfile.lock" || fail 'CocoaPods did not create mobile/ios/Podfile.lock.'

grep -qi 'ReactNativeEnrichedMarkdown' "$IOS_ROOT/Podfile.lock" || fail 'ReactNativeEnrichedMarkdown is absent from Podfile.lock.'
grep -qi 'expo-dev-launcher' "$IOS_ROOT/Podfile.lock" || fail 'expo-dev-launcher is absent from Podfile.lock.'
grep -qi 'expo-dev-menu' "$IOS_ROOT/Podfile.lock" || fail 'expo-dev-menu is absent from Podfile.lock.'

printf '%s\n' '=== Generated iOS project containers ==='
printf '%s\n' 'Top-level generated Xcode containers:'
find "$IOS_ROOT" -maxdepth 1 \
  \( -name '*.xcworkspace' -o -name '*.xcodeproj' \) \
  -type d \
  -print
WORKSPACE_LIST="$(
  find "$IOS_ROOT" \
    -maxdepth 1 \
    -type d \
    -name '*.xcworkspace' \
    -print
)"
PROJECT_LIST="$(
  find "$IOS_ROOT" \
    -maxdepth 1 \
    -type d \
    -name '*.xcodeproj' \
    -print
)"
WORKSPACE_COUNT="$(printf '%s\n' "$WORKSPACE_LIST" | awk 'NF { count++ } END { print count + 0 }')"
PROJECT_COUNT="$(printf '%s\n' "$PROJECT_LIST" | awk 'NF { count++ } END { print count + 0 }')"
CONTAINER_KIND=''
CONTAINER_PATH=''

if [ "$WORKSPACE_COUNT" -eq 1 ]; then
  CONTAINER_KIND='workspace'
  CONTAINER_PATH="$(printf '%s\n' "$WORKSPACE_LIST" | sed -n '1p')"
elif [ "$WORKSPACE_COUNT" -gt 1 ]; then
  printf '%s\n' "$WORKSPACE_LIST"
  fail "Expected one generated app workspace; discovered $WORKSPACE_COUNT."
elif [ "$PROJECT_COUNT" -eq 1 ]; then
  CONTAINER_KIND='project'
  CONTAINER_PATH="$(printf '%s\n' "$PROJECT_LIST" | sed -n '1p')"
else
  printf 'Workspaces:\n%s\nProjects:\n%s\n' "$WORKSPACE_LIST" "$PROJECT_LIST"
  fail "Could not identify one generated workspace or project (workspaces=$WORKSPACE_COUNT, projects=$PROJECT_COUNT)."
fi

printf 'Generated %s: %s\n' "$CONTAINER_KIND" "$CONTAINER_PATH"

run_xcodebuild() {
  if [ "$CONTAINER_KIND" = 'workspace' ]; then
    xcodebuild -workspace "$CONTAINER_PATH" "$@"
  else
    xcodebuild -project "$CONTAINER_PATH" "$@"
  fi
}

printf '%s\n' '=== Available Apple SDKs ==='
SDK_LIST="$(xcodebuild -showsdks)"
printf '%s\n' "$SDK_LIST"
printf '%s\n' "$SDK_LIST" | grep -q 'iphoneos' || fail 'The selected Xcode has no iphoneos SDK.'

if ! run_xcodebuild -list -json >"$XCODE_LIST" 2>&1; then
  cat "$XCODE_LIST"
  fail 'xcodebuild -list -json failed for the generated project container.'
fi

printf '%s\n' '=== Actual generated Xcode schemes ==='
cat "$XCODE_LIST"
command -v jq >/dev/null 2>&1 || fail 'jq is required to inspect xcodebuild -list -json output.'
SCHEME_LIST="$(jq -r '(.workspace // .project).schemes[]?' "$XCODE_LIST")"
if [ -z "$SCHEME_LIST" ]; then
  fail 'No schemes were reported by the generated Xcode workspace/project.'
fi

MATCHED_SCHEME=''
MATCH_COUNT=0
SCHEME_INDEX=0
while IFS= read -r CANDIDATE_SCHEME; do
  [ -n "$CANDIDATE_SCHEME" ] || continue
  SCHEME_INDEX=$((SCHEME_INDEX + 1))
  SETTINGS_FILE="$RUNNER_TEMP/pythagoras-settings-$SCHEME_INDEX.txt"
  printf 'Checking discovered scheme: %s\n' "$CANDIDATE_SCHEME"
  if ! run_xcodebuild -showBuildSettings \
    -scheme "$CANDIDATE_SCHEME" \
    -configuration Debug \
    -destination 'generic/platform=iOS' \
    -sdk iphoneos >"$SETTINGS_FILE" 2>&1; then
    cat "$SETTINGS_FILE"
    continue
  fi

  if grep -Fq "PRODUCT_BUNDLE_IDENTIFIER = $EXPECTED_BUNDLE_ID" "$SETTINGS_FILE" \
    && grep -Eq 'SDKROOT = iphoneos' "$SETTINGS_FILE" \
    && grep -Eq 'SUPPORTED_PLATFORMS = .*iphoneos' "$SETTINGS_FILE" \
    && grep -Eq 'TARGETED_DEVICE_FAMILY = .*1' "$SETTINGS_FILE"; then
    MATCHED_SCHEME="$CANDIDATE_SCHEME"
    MATCH_COUNT=$((MATCH_COUNT + 1))
  fi
done < <(printf '%s\n' "$SCHEME_LIST")

if [ "$MATCH_COUNT" -ne 1 ]; then
  printf 'Schemes reported: %s\n' "$SCHEME_LIST"
  fail "Expected exactly one Debug scheme for bundle $EXPECTED_BUNDLE_ID that supports iphoneos/iPhone; found $MATCH_COUNT. No guessed scheme will be built."
fi

printf 'Discovered physical-device Debug scheme: %s\n' "$MATCHED_SCHEME"
SETTINGS_FILE="$RUNNER_TEMP/pythagoras-selected-settings.txt"
run_xcodebuild -showBuildSettings \
  -scheme "$MATCHED_SCHEME" \
  -configuration Debug \
  -destination 'generic/platform=iOS' \
  -sdk iphoneos >"$SETTINGS_FILE" 2>&1
grep -E 'Build settings for|ARCHS =|VALID_ARCHS =|ONLY_ACTIVE_ARCH =|SDKROOT =|SUPPORTED_PLATFORMS =|TARGETED_DEVICE_FAMILY =|PRODUCT_BUNDLE_IDENTIFIER =' "$SETTINGS_FILE" || true

grep -Eq "PRODUCT_BUNDLE_IDENTIFIER = $EXPECTED_BUNDLE_ID" "$SETTINGS_FILE" || fail 'The selected Debug scheme does not resolve to the expected bundle identifier.'
grep -Eq 'SDKROOT = .*iphoneos' "$SETTINGS_FILE" || fail 'The selected Debug scheme did not resolve to the iphoneos SDK.'
grep -Eq 'SUPPORTED_PLATFORMS = .*iphoneos' "$SETTINGS_FILE" || fail 'The selected Debug scheme does not support iphoneos.'
grep -Eq 'TARGETED_DEVICE_FAMILY = .*1' "$SETTINGS_FILE" || fail 'The selected Debug scheme is not configured for iPhone devices.'

ARCHS_LINES="$(grep -E '^[[:space:]]*ARCHS = ' "$SETTINGS_FILE" || true)"
if [ -n "$ARCHS_LINES" ] \
  && ! printf '%s\n' "$ARCHS_LINES" | grep -Eq 'ARCHS = .*arm64|ARCHS = \$\(ARCHS_STANDARD(_64_BIT)?\)'; then
  printf '%s\n' "$ARCHS_LINES"
  fail 'Resolved ARCHS does not include arm64 or use an accepted Xcode standard architecture variable.'
fi
printf '%s\n' 'Physical-device architecture validation passed via the generic iOS destination.'

printf '%s\n' '=== Destinations for the discovered scheme ==='
DESTINATIONS_FILE="$RUNNER_TEMP/pythagoras-destinations.txt"
if ! run_xcodebuild -showdestinations -scheme "$MATCHED_SCHEME" -configuration Debug >"$DESTINATIONS_FILE" 2>&1; then
  cat "$DESTINATIONS_FILE"
  fail 'xcodebuild -showdestinations failed for the discovered scheme.'
fi
cat "$DESTINATIONS_FILE"
grep -E 'Any iOS Device|iOS [0-9].* (arm64|Any iOS Device)' "$DESTINATIONS_FILE" || true

printf '%s\n' '=== Build unsigned physical-device app ==='
set -o pipefail
run_xcodebuild \
  -scheme "$MATCHED_SCHEME" \
  -configuration Debug \
  -destination 'generic/platform=iOS' \
  -sdk iphoneos \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY= \
  build 2>&1 | tee "$XCODE_LOG"

PRODUCTS_DIR="$DERIVED_DATA/Build/Products/Debug-iphoneos"
APP_PATH=''
APP_MATCH_COUNT=0
while IFS= read -r CANDIDATE_APP; do
  [ -n "$CANDIDATE_APP" ] || continue
  [ -f "$CANDIDATE_APP/Info.plist" ] || continue
  APP_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$CANDIDATE_APP/Info.plist" 2>/dev/null || true)"
  if [ "$APP_BUNDLE_ID" = "$EXPECTED_BUNDLE_ID" ]; then
    APP_PATH="$CANDIDATE_APP"
    APP_MATCH_COUNT=$((APP_MATCH_COUNT + 1))
  fi
done < <(find "$PRODUCTS_DIR" -maxdepth 2 -type d -name '*.app' -print)

if [ "$APP_MATCH_COUNT" -ne 1 ]; then
  find "$PRODUCTS_DIR" -type d -name '*.app' -print
  fail "Expected one built .app with bundle ID $EXPECTED_BUNDLE_ID; found $APP_MATCH_COUNT."
fi

printf 'Built app: %s\n' "$APP_PATH"
printf 'Bundle ID: %s\n' "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist")"
printf 'Local network permission: %s\n' "$(/usr/libexec/PlistBuddy -c 'Print :NSLocalNetworkUsageDescription' "$APP_PATH/Info.plist")"
printf 'Bonjour services:\n'
/usr/libexec/PlistBuddy -c 'Print :NSBonjourServices' "$APP_PATH/Info.plist"

if [ -e "$APP_PATH/embedded.mobileprovision" ]; then
  fail 'An embedded provisioning profile was found; refusing to package a signed/provisioned app.'
fi
if /usr/bin/codesign --verify "$APP_PATH" >"$RUNNER_TEMP/pythagoras-codesign.txt" 2>&1; then
  cat "$RUNNER_TEMP/pythagoras-codesign.txt"
  fail 'The generated app has a code signature even though unsigned build flags were requested.'
else
  printf '%s\n' 'App bundle has no valid code signature or embedded provisioning profile.'
fi

APP_EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_PATH/Info.plist")"
FRAMEWORK_BINARY="$APP_PATH/Frameworks/ReactNativeEnrichedMarkdown.framework/ReactNativeEnrichedMarkdown"
if [ ! -f "$FRAMEWORK_BINARY" ]; then
  /usr/bin/otool -L "$APP_PATH/$APP_EXECUTABLE" >"$RUNNER_TEMP/pythagoras-linked-libraries.txt" 2>&1
  if ! grep -q 'ReactNativeEnrichedMarkdown.framework' "$RUNNER_TEMP/pythagoras-linked-libraries.txt"; then
    cat "$RUNNER_TEMP/pythagoras-linked-libraries.txt"
    fail 'The built app does not link the ReactNativeEnrichedMarkdown native framework.'
  fi
fi
printf '%s\n' 'Verified ReactNativeEnrichedMarkdown native code in the built app.'

PACKAGE_ROOT="$RUNNER_TEMP/pythagoras-ipa"
IPA_PATH="$MOBILE_ROOT/Pythagoras-dev-unsigned.ipa"
if [ -e "$PACKAGE_ROOT" ]; then
  fail 'Unexpected IPA staging directory already exists on the runner.'
fi
mkdir -p "$PACKAGE_ROOT/Payload"
cp -R "$APP_PATH" "$PACKAGE_ROOT/Payload/"
(cd "$PACKAGE_ROOT" && /usr/bin/zip -qr "$IPA_PATH" Payload)
test -s "$IPA_PATH" || fail 'Unsigned IPA packaging did not produce a non-empty artifact.'
/usr/bin/unzip -Z1 "$IPA_PATH" | grep -Eq '^Payload/[^/]+\.app/Info.plist$' || fail 'IPA does not contain Payload/<app>.app/Info.plist.'
printf 'Unsigned IPA: %s\n' "$IPA_PATH"
printf 'Artifact size: %s bytes\n' "$(stat -f '%z' "$IPA_PATH")"

{
  printf '%s\n' '## Unsigned iOS development build'
  printf '%s\n' "- Runner: $(sw_vers -productName) $(sw_vers -productVersion)"
  printf '%s\n' "- Xcode: $(xcodebuild -version | tr '\n' ' ')"
  printf '%s\n' "- Generated container: $CONTAINER_PATH"
  printf '%s\n' "- Discovered scheme: $MATCHED_SCHEME"
  printf '%s\n' "- Destination: generic/platform=iOS (iphoneos arm64)"
  printf '%s\n' "- Bundle ID: $EXPECTED_BUNDLE_ID"
  printf '%s\n' "- Native renderer: react-native-enriched-markdown $ENRICHED_VERSION"
  printf '%s\n' "- Development client: expo-dev-client $DEV_CLIENT_VERSION"
  printf '%s\n' "- IPA: Pythagoras-dev-unsigned.ipa"
} >>"$GITHUB_STEP_SUMMARY"
