#!/usr/bin/env bash
set -euo pipefail

[ "$(uname -s)" = Darwin ] || { printf 'Native preview tests require macOS/Xcode.\n' >&2; exit 1; }
PREVIEW_REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PREVIEW_MOBILE_ROOT="$PREVIEW_REPO_ROOT/mobile"
PREVIEW_MODULE_ROOT="$PREVIEW_MOBILE_ROOT/modules/pythagoras-chat-preview"
PREVIEW_TOOL="$PREVIEW_REPO_ROOT/.github/scripts/ios-preview-test-report.py"
PREVIEW_TEST_REPORTS="${PREVIEW_TEST_REPORTS:-$(mktemp -d "${TMPDIR:-/tmp}/pythagoras-preview-tests.XXXXXX")}"
test -d "$PREVIEW_TEST_REPORTS"
[ -z "$(find "$PREVIEW_TEST_REPORTS" -mindepth 1 -maxdepth 1 -print -quit)" ] || { echo 'Refusing stale reports' >&2; exit 1; }
for preview_command in xcodebuild xcrun swift pod ruby python3 jq; do
  command -v "$preview_command" >/dev/null || { echo "Missing $preview_command" >&2; exit 1; }
done
ruby -rxcodeproj -e 'puts "xcodeproj #{Xcodeproj::VERSION}"'
xcodebuild -version | tee "$PREVIEW_TEST_REPORTS/xcode-version.txt"
xcodebuild -showsdks > "$PREVIEW_TEST_REPORTS/sdks.txt"
git -C "$PREVIEW_REPO_ROOT" rev-parse HEAD > "$PREVIEW_TEST_REPORTS/checkout-sha.txt"
python3 "$PREVIEW_TOOL" manifest --root "$PREVIEW_REPO_ROOT" --output "$PREVIEW_TEST_REPORTS/inventory.json"

# Foundation XCTest, not UIKit. Compilation/discovery/execution each fail hard.
swift test --package-path "$PREVIEW_MODULE_ROOT" --disable-swift-testing --list-tests \
  2>&1 | tee "$PREVIEW_TEST_REPORTS/foundation-discovery.txt"
PREVIEW_FOUNDATION_START="$(python3 -c 'import time; print(time.time())')"
swift test --package-path "$PREVIEW_MODULE_ROOT" --disable-swift-testing \
  --parallel --num-workers 1 \
  --xunit-output="$PREVIEW_TEST_REPORTS/foundation.xml" \
  2>&1 | tee "$PREVIEW_TEST_REPORTS/foundation.log"
PREVIEW_FOUNDATION_SECONDS="$(python3 -c 'import time,sys; print(time.time()-float(sys.argv[1]))' "$PREVIEW_FOUNDATION_START")"
python3 "$PREVIEW_TOOL" foundation --inventory "$PREVIEW_TEST_REPORTS/inventory.json" \
  --xml "$PREVIEW_TEST_REPORTS/foundation.xml" --discovery "$PREVIEW_TEST_REPORTS/foundation-discovery.txt" \
  --wall-seconds "$PREVIEW_FOUNDATION_SECONDS" --output "$PREVIEW_TEST_REPORTS/foundation-report.json"

# Test targets exist only in this newly generated project. Normal IPA workflow
# never invokes this generator. No production source/podspec/config is edited.
(cd "$PREVIEW_MOBILE_ROOT" && npx expo prebuild --platform ios --no-install) \
  2>&1 | tee "$PREVIEW_TEST_REPORTS/prebuild.log"
ruby "$PREVIEW_REPO_ROOT/.github/scripts/prepare-ios-preview-tests.rb" \
  | tee "$PREVIEW_TEST_REPORTS/generated-targets.json"
(cd "$PREVIEW_MOBILE_ROOT" && pod install --project-directory=ios) \
  2>&1 | tee "$PREVIEW_TEST_REPORTS/pods.log"
grep -Fq 'PythagorasChatPreview' "$PREVIEW_MOBILE_ROOT/ios/Podfile.lock"
PREVIEW_WORKSPACES=("$PREVIEW_MOBILE_ROOT"/ios/*.xcworkspace)
[ "${#PREVIEW_WORKSPACES[@]}" -eq 1 ] && test -d "${PREVIEW_WORKSPACES[0]}" || { echo 'Expected one generated workspace' >&2; exit 1; }
PREVIEW_WORKSPACE="${PREVIEW_WORKSPACES[0]}"
PREVIEW_DERIVED_DATA="$(mktemp -d "${TMPDIR:-/tmp}/pythagoras-preview-derived.XXXXXX")"

xcrun simctl list devices available --json > "$PREVIEW_TEST_REPORTS/devices.json"
xcrun simctl list runtimes --json > "$PREVIEW_TEST_REPORTS/runtimes.json"
python3 "$PREVIEW_TOOL" simulator --devices "$PREVIEW_TEST_REPORTS/devices.json" \
  --runtimes "$PREVIEW_TEST_REPORTS/runtimes.json" --output "$PREVIEW_TEST_REPORTS/destination.json"
PREVIEW_SIMULATOR_ID="$(jq -r '.udid' "$PREVIEW_TEST_REPORTS/destination.json")"
if [ "$(jq -r '.state' "$PREVIEW_TEST_REPORTS/destination.json")" != Booted ]; then
  xcrun simctl boot "$PREVIEW_SIMULATOR_ID"
fi
xcrun simctl bootstatus "$PREVIEW_SIMULATOR_ID" -b
PREVIEW_XCODE_ARGS=(-workspace "$PREVIEW_WORKSPACE" -scheme PythagorasPreviewTests \
  -configuration Debug -sdk iphonesimulator -destination "platform=iOS Simulator,id=$PREVIEW_SIMULATOR_ID" \
  -derivedDataPath "$PREVIEW_DERIVED_DATA" CODE_SIGNING_ALLOWED=NO ENABLE_TESTABILITY=YES)
xcodebuild "${PREVIEW_XCODE_ARGS[@]}" build-for-testing \
  2>&1 | tee "$PREVIEW_TEST_REPORTS/build-for-testing.log"
for preview_source in PythagorasChatPreviewModule.swift PythagorasFittedUserMessagePreview.swift FittedPreviewGeometry.swift FittedPreviewInkLayout.swift; do
  grep -Fq "$preview_source" "$PREVIEW_TEST_REPORTS/build-for-testing.log" || { echo "No compilation evidence for $preview_source" >&2; exit 1; }
done
xcodebuild "${PREVIEW_XCODE_ARGS[@]}" test-without-building -enumerate-tests \
  -test-enumeration-style flat -test-enumeration-format json \
  -test-enumeration-output-path "$PREVIEW_TEST_REPORTS/hosted-discovery.json" \
  2>&1 | tee "$PREVIEW_TEST_REPORTS/discovery.log"
python3 "$PREVIEW_TOOL" discovery --inventory "$PREVIEW_TEST_REPORTS/inventory.json" \
  --discovery "$PREVIEW_TEST_REPORTS/hosted-discovery.json" --output "$PREVIEW_TEST_REPORTS/discovered-tests.json"

PREVIEW_HOSTED_START="$(python3 -c 'import time; print(time.time())')"
set +e
xcodebuild "${PREVIEW_XCODE_ARGS[@]}" test-without-building -parallel-testing-enabled NO \
  -resultBundlePath "$PREVIEW_TEST_REPORTS/hosted.xcresult" \
  2>&1 | tee "$PREVIEW_TEST_REPORTS/hosted.log"
PREVIEW_TEST_PIPESTATUS=("${PIPESTATUS[@]}")
PREVIEW_TEST_EXIT=${PREVIEW_TEST_PIPESTATUS[0]}
PREVIEW_LOG_EXIT=${PREVIEW_TEST_PIPESTATUS[1]}
set -e
PREVIEW_HOSTED_SECONDS="$(python3 -c 'import time,sys; print(time.time()-float(sys.argv[1]))' "$PREVIEW_HOSTED_START")"
test -d "$PREVIEW_TEST_REPORTS/hosted.xcresult" || { echo 'Missing XCTest result bundle' >&2; exit 1; }
xcrun xcresulttool get test-results summary --path "$PREVIEW_TEST_REPORTS/hosted.xcresult" \
  > "$PREVIEW_TEST_REPORTS/hosted-summary.json"
xcrun xcresulttool get test-results tests --path "$PREVIEW_TEST_REPORTS/hosted.xcresult" \
  > "$PREVIEW_TEST_REPORTS/hosted-tree.json"
set +e
python3 "$PREVIEW_TOOL" hosted --inventory "$PREVIEW_TEST_REPORTS/inventory.json" \
  --discovery "$PREVIEW_TEST_REPORTS/hosted-discovery.json" --summary "$PREVIEW_TEST_REPORTS/hosted-summary.json" \
  --tree "$PREVIEW_TEST_REPORTS/hosted-tree.json" --destination "$PREVIEW_TEST_REPORTS/destination.json" \
  --wall-seconds "$PREVIEW_HOSTED_SECONDS" --output "$PREVIEW_TEST_REPORTS/hosted-report.json"
PREVIEW_REPORT_EXIT=$?
set -e
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    printf '## Native preview XCTest\n\n'
    printf 'Checkout: `%s`\n\n' "$(cat "$PREVIEW_TEST_REPORTS/checkout-sha.txt")"
    printf 'Destination: `%s`\n\n' "$PREVIEW_SIMULATOR_ID"
    printf 'Foundation and hosted counts/timings/slowest cases:\n\n```json\n'
    cat "$PREVIEW_TEST_REPORTS/foundation-report.json" "$PREVIEW_TEST_REPORTS/hosted-report.json"
    printf '\n```\n\nApp-owned rendering only; system ContextMenu mask is NOT exercised.\n'
  } >> "$GITHUB_STEP_SUMMARY"
fi
[ "$PREVIEW_TEST_EXIT" -eq 0 ] && [ "$PREVIEW_REPORT_EXIT" -eq 0 ] && [ "$PREVIEW_LOG_EXIT" -eq 0 ]
# Intentionally no archive, iphoneos build, export, zip, IPA or automatic retry.
