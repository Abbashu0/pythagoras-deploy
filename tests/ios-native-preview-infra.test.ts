import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

const reporter = path.resolve('.github/scripts/ios-preview-test-report.py');
const read = (file: string) => fs.readFileSync(file, 'utf8');
const hostedNames = [...read('mobile/modules/pythagoras-chat-preview/ios-tests/NativePreviewLayoutTests.swift')
  .matchAll(/^  func (test\w+)\(\)/gmu)].map(match => match[1]);
const foundationNames = [...read('mobile/modules/pythagoras-chat-preview/tests/FittedPreviewGeometryTests.swift')
  .matchAll(/^  func (test\w+)\(\)/gmu)].map(match => match[1]);

function fixtures(run: (directory: string) => void) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pythagoras-preview-infra-'));
  try { run(directory); } finally {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(resolved).startsWith('pythagoras-preview-infra-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

function write(directory: string, name: string, data: unknown) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data), 'utf8');
  return file;
}

test('real source inventory includes all 19 hosted and 13 Foundation cases, not private helpers', () => {
  fixtures(directory => {
    const output = path.join(directory, 'inventory.json');
    execFileSync('python', [reporter, 'manifest', '--root', '.', '--output', output]);
    const data = JSON.parse(read(output));
    assert.equal(data.hosted.length, 19);
    assert.equal(data.foundation.length, 13);
    assert.equal(data.hosted.includes('testWindow'), false);
    assert.ok(data.hosted.includes('testActualBoundedRasterKeepsAllInkWithoutOpticalHeuristics'));
    assert.ok(data.hosted.includes('testKnownWindowFailureIsNotUnavailableGeometryOrSuccessfulEmptyFit'));
    assert.equal(Object.keys(data.production_source_sha256).length, 4);
  });
});

test('Foundation gate requires compiled discovery plus executed passing XML cases', () => {
  fixtures(directory => {
    const inventory = write(directory, 'inventory.json', { foundation: foundationNames });
    const discovery = write(directory, 'discovery.txt', foundationNames
      .map(name => `PreviewGeometryTests.FittedPreviewGeometryTests/${name}`).join('\n'));
    const xml = write(directory, 'foundation.xml', `<testsuites><testsuite>${foundationNames.map(name =>
      `<testcase classname="PreviewGeometryTests.FittedPreviewGeometryTests" name="${name}" time="0.02"/>`).join('')}</testsuite></testsuites>`);
    const output = path.join(directory, 'report.json');
    const args = [reporter, 'foundation', '--inventory', inventory, '--discovery', discovery, '--xml', xml, '--output', output];
    assert.equal(spawnSync('python', args).status, 0);
    assert.equal(JSON.parse(read(output)).executed, 13);
    write(directory, 'foundation.xml', '<testsuite/>');
    assert.equal(spawnSync('python', args).status, 1);
    write(directory, 'foundation.xml', '<invalid');
    assert.equal(spawnSync('python', args).status, 1);
  });
});

test('hosted result gate rejects skips, failures, identity loss, wrong destination and inconsistent summary', () => {
  fixtures(directory => {
    const inventory = write(directory, 'inventory.json', { hosted: hostedNames });
    const discovery = write(directory, 'discovery.json', hostedNames.map(name => `PythagorasPreviewTests/NativePreviewLayoutTests/${name}()`));
    const destination = write(directory, 'destination.json', { udid: '12345678-1234-1234-1234-123456789ABC', name: 'iPhone' });
    const rows = hostedNames.map((name, index) => ({ nodeType: 'Test Case',
      nodeIdentifier: `NativePreviewLayoutTests/${name}()`, result: 'Passed', duration: `${index + 1}s` }));
    const tree = write(directory, 'tree.json', { testNodes: [{ children: rows }] });
    const counts = { totalTestCount: 19, passedTests: 19, failedTests: 0, skippedTests: 0,
      devicesAndConfigurations: [{ device: { deviceId: '12345678-1234-1234-1234-123456789ABC' } }] };
    const summary = write(directory, 'summary.json', counts);
    const output = path.join(directory, 'report.json');
    const args = [reporter, 'hosted', '--inventory', inventory, '--discovery', discovery,
      '--destination', destination, '--tree', tree, '--summary', summary, '--output', output, '--wall-seconds', '20'];
    assert.equal(spawnSync('python', args).status, 0);
    assert.equal(JSON.parse(read(output)).slowest[0].seconds, 19);
    assert.equal(JSON.parse(read(output)).invocation_wall_seconds, 20);
    for (const result of ['Failed', 'Skipped', 'Unknown']) {
      write(directory, 'tree.json', { testNodes: rows.map((row, index) => index ? row : { ...row, result }) });
      assert.equal(spawnSync('python', args).status, 1);
    }
    write(directory, 'tree.json', { testNodes: rows.slice(1) });
    assert.equal(spawnSync('python', args).status, 1);
    write(directory, 'tree.json', { testNodes: rows });
    write(directory, 'summary.json', { ...counts, passedTests: 18 });
    assert.equal(spawnSync('python', args).status, 1);
    write(directory, 'summary.json', { ...counts, devicesAndConfigurations: [] });
    assert.equal(spawnSync('python', args).status, 1);
    write(directory, 'summary.json', counts);
    write(directory, 'discovery.json', hostedNames.slice(1).map(name => `PythagorasPreviewTests/NativePreviewLayoutTests/${name}`));
    assert.equal(spawnSync('python', args).status, 1);
  });
});

test('simulator selection uses an installed available iPhone and actual runtime, never a guessed name', () => {
  fixtures(directory => {
    const old = { identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-0', version: '26.0', name: 'iOS 26.0', isAvailable: true };
    const current = { ...old, identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5', version: '26.5', name: 'iOS 26.5' };
    const runtimes = write(directory, 'runtimes.json', { runtimes: [old, current] });
    const device = { name: 'iPhone 17', state: 'Shutdown', isAvailable: true, udid: '12345678-1234-1234-1234-123456789ABC' };
    const devices = write(directory, 'devices.json', { devices: { [old.identifier]: [device],
      [current.identifier]: [{ ...device, name: 'iPad' }, device] } });
    const output = path.join(directory, 'destination.json');
    const args = [reporter, 'simulator', '--devices', devices, '--runtimes', runtimes, '--output', output];
    assert.equal(spawnSync('python', args).status, 0);
    assert.equal(JSON.parse(read(output)).runtime_version, '26.5');
    write(directory, 'devices.json', { devices: {} });
    assert.equal(spawnSync('python', args).status, 1);
  });
});

test('generated-only targets reuse the real pod, preserve app identity and provide a UIWindowScene host', () => {
  const generator = read('.github/scripts/prepare-ios-preview-tests.rb');
  for (const value of ['com.abbashu.pythagoras', 'com.abbashu.pythagoras.preview-test-host',
    'project.new_target(:unit_test_bundle', 'tests.add_dependency(host)', "'BUNDLE_LOADER' => '$(TEST_HOST)'",
    'scheme.configure_with_targets(host, tests, launch_target: true)',
    'snapshot.call(app.first) == original', 'snapshot.call(reloaded) == original',
    "pod 'PythagorasChatPreview', :path => '../modules/pythagoras-chat-preview/ios'", 'inherit! :search_paths',
    "properties['ios.useFrameworks']", 'entry.build_for_archiving = false',
  ]) assert.ok(generator.includes(value), value);
  assert.equal(/add_file_reference.*FittedPreview|cp\s|FileUtils\.cp/u.test(generator), false);
  const host = read('mobile/modules/pythagoras-chat-preview/ios-tests/host/PreviewTestHost.swift');
  assert.ok(host.includes('UIWindowSceneDelegate'));
  assert.ok(host.includes('UIWindow(windowScene: scene)'));
  assert.ok(host.includes('PythagorasChatPreviewModule.self'));
  assert.equal(/RCTRootView|URLSession|ExpoAppDelegate/u.test(host), false);
});

test('test-only workflow has fatal discovery/execution gates and no IPA or production dispatcher edits', () => {
  const workflow = read('.github/workflows/ios-preview-tests.yml');
  const driver = read('.github/scripts/ios-preview-tests.sh');
  assert.ok(workflow.includes('runs-on: macos-26'));
  assert.ok(workflow.includes('workflow_call:'));
  assert.ok(workflow.includes('workflow_dispatch:'));
  assert.ok(workflow.includes('ref: ios-dev-build-spike'));
  assert.ok(workflow.includes('PREVIEW_EXPECTED_SHA'));
  assert.ok(workflow.includes('Pythagoras-native-preview-tests-'));
  assert.equal(/ios-unsigned-build|\.ipa|exportArchive|generic\/platform=iOS/u.test(workflow), false);
  for (const value of ['build-for-testing', 'test-without-building', '-enumerate-tests',
    '-parallel-testing-enabled NO', 'get test-results summary', 'get test-results tests',
    'PREVIEW_TEST_EXIT', 'PREVIEW_REPORT_EXIT', 'PREVIEW_LOG_EXIT', '--disable-swift-testing']) assert.ok(driver.includes(value), value);
  assert.equal(/-retry-tests-on-failure|\barchive\s+2>|-exportArchive/u.test(driver), false);
});

test('Foundation XCTest XML uses the parallel runner with one worker, without changing discovery or hosted concurrency', () => {
  const driver = read('.github/scripts/ios-preview-tests.sh');
  const commands = driver.replace(/\\\r?\n\s*/gu, ' ').split(/\r?\n/u)
    .filter(line => line.startsWith('swift test '));
  assert.equal(commands.length, 2);
  const execution = commands.filter(line => line.includes('--xunit-output='));
  assert.equal(execution.length, 1);
  assert.match(execution[0], /(?:^|\s)--parallel(?:\s|$)/u);
  assert.match(execution[0], /(?:^|\s)--num-workers(?:=|\s+)1(?:\s|$)/u);
  assert.ok(execution[0].includes('--disable-swift-testing'));
  assert.ok(execution[0].includes('--xunit-output="$PREVIEW_TEST_REPORTS/foundation.xml"'));
  assert.equal(execution[0].includes('--list-tests'), false);
  const discovery = commands.find(line => line.includes('--list-tests'))!;
  assert.ok(discovery);
  assert.equal(/--parallel|--num-workers|--xunit-output/u.test(discovery), false);
  assert.ok(driver.includes('test-without-building -parallel-testing-enabled NO'));
  assert.ok(driver.includes('--xml "$PREVIEW_TEST_REPORTS/foundation.xml"'));
});
