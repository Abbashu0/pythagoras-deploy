import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';

const moduleRoot = 'mobile/modules/pythagoras-chat-preview';
const read = (file: string) => fs.readFileSync(path.join(moduleRoot, file), 'utf8');
const native = read('ios/PythagorasFittedUserMessagePreview.swift');
const geometry = read('ios/FittedPreviewGeometry.swift');

test('local module resolves as a named ExpoUIView SwiftUI child through SDK 57 autolinking', () => {
  const data = JSON.parse(execFileSync(process.execPath, [
    'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js',
    'resolve', '--platform', 'apple', '--json',
  ], { cwd: path.resolve('mobile'), encoding: 'utf8', maxBuffer: 8_000_000 }));
  const found = data.modules.find((m: { packageName: string }) => m.packageName === 'pythagoras-chat-preview');
  assert.ok(found);
  assert.equal(found.pods[0].podName, 'PythagorasChatPreview');
  assert.deepEqual(found.swiftModuleNames, ['PythagorasChatPreview']);
  assert.equal(found.modules[0].class, 'PythagorasChatPreviewModule');
  assert.ok(found.coreFeatures.includes('swiftui'));
  assert.ok(read('ios/PythagorasChatPreviewModule.swift').includes('ExpoUIView(PythagorasFittedUserMessagePreview.self)'));
  assert.ok(native.includes('FittedUserMessageProps: UIBaseViewProps'));
  assert.ok(native.includes('PythagorasFittedUserMessagePreview: ExpoSwiftUI.View'));
  const core = fs.readFileSync('mobile/node_modules/expo-modules-core/ios/Core/Views/SwiftUI/SwiftUIVirtualView.swift', 'utf8');
  assert.ok(core.includes('as? (any ExpoSwiftUI.View)'));
  assert.ok(fs.readFileSync('mobile/node_modules/@expo/ui/ios/SlotView.swift', 'utf8').includes('Children()'));
  const pod = read('ios/PythagorasChatPreview.podspec');
  for (const value of ["s.dependency 'ExpoModulesCore'", "s.dependency 'ExpoUI'", "s.source_files = '*.swift'"]) assert.ok(pod.includes(value));
});

test('JS availability gate preserves installed IPA and loads the named native view only when linked', () => {
  const source = fs.readFileSync('mobile/src/ai/fitted-user-message-preview.ios.tsx', 'utf8');
  for (const available of [false, true]) {
    const requested: unknown[][] = [];
    const exports: { hasFittedUserMessagePreview?: boolean; PythagorasFittedUserMessagePreview?: (props: unknown) => { props: unknown } } = {};
    vm.runInNewContext(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, {
      exports,
      require: (name: string) => {
        if (name === 'expo') return {
          requireOptionalNativeModule: () => available ? {} : null,
          requireNativeView: (...args: unknown[]) => { requested.push(args); return 'NativePreview'; },
        };
        if (name === 'react/jsx-runtime') return { jsx: (type: unknown, props: unknown) => ({ type, props }) };
        throw new Error(name);
      },
    });
    assert.equal(exports.hasFittedUserMessagePreview, available);
    const props = { source: ' نَصّ\r\n\t😀 PYTHAGORAS_LONG_MESSAGE_END_2026 ' };
    if (available) {
      assert.deepEqual(requested, [['PythagorasChatPreview', 'PythagorasFittedUserMessagePreview']]);
      assert.deepEqual(JSON.parse(JSON.stringify(exports.PythagorasFittedUserMessagePreview!(props).props)), props);
    } else {
      assert.equal(requested.length, 0);
      assert.throws(() => exports.PythagorasFittedUserMessagePreview!(props), /Development Build/u);
    }
  }
});

// Evaluate the exact arithmetic expressions read from Swift, not a duplicate
// sizing implementation. This is portable formula validation, NOT Swift/UIKit.
const scaleExpression = geometry.match(/let scale = (.+)/u)![1];
const dimensions = geometry.match(/let size = CGSize\(width: (.+), height: (.+)\)/u)!;
const fitFormula = vm.runInNewContext(
  `(natural, available) => { const scale = ${scaleExpression}; return { scale, width: ${dimensions[1]}, height: ${dimensions[2]} }; }`,
  { min: Math.min },
) as (natural: { width: number; height: number }, available: { width: number; height: number }) => { scale: number; width: number; height: number };

test('native fitting expressions keep short text unscaled and fit medium/long/extreme source uniformly', () => {
  const short = fitFormula({ width: 90, height: 48 }, { width: 320, height: 500 });
  assert.equal(short.scale, 1);
  assert.equal(short.width, 90);
  assert.equal(short.height, 48);
  for (const height of [900, 20000, 1000000]) {
    const natural = { width: 320, height };
    const fit = fitFormula(natural, { width: 300, height: 400 });
    assert.ok(fit.width > 0 && fit.width <= 300);
    assert.ok(fit.height > 0 && fit.height <= 400);
    assert.ok(Number.isFinite(fit.height));
    assert.ok(Math.abs(fit.width / fit.height - natural.width / natural.height) < 1e-9);
    assert.equal(fit.width, natural.width * fit.scale);
    assert.equal(fit.height, natural.height * fit.scale);
  }
});

test('native budget uses actual safe viewport and reserves the unscaled action menu; nil is not infinity', () => {
  const reserve = geometry.match(/let reserve = (.+)/u)![1];
  const size = geometry.match(/return CGSize\(width: (.+), height: (.+)\)/u)!;
  const formula = vm.runInNewContext(`(resolved, horizontal, vertical, line) => {
    const reserve = ${reserve};
    return { width: ${size[1]}, height: ${size[2]} };
  }`, { max: Math.max }) as (viewport: { width: number; height: number }, horizontal: number, vertical: number, line: number) => { width: number; height: number };
  const portrait = formula({ width: 390, height: 760 }, 32, 20, 22);
  assert.equal(portrait.height, 494);
  assert.equal(portrait.width, 358);
  const landscape = formula({ width: 700, height: 250 }, 32, 20, 60);
  assert.equal(landscape.height, 50);
  for (const viewport of [{ width: 320, height: 180 }, { width: 430, height: 850 }]) {
    for (const line of [17, 50, 100]) {
      const budget = formula(viewport, 32, 20, line);
      assert.ok(Number.isFinite(budget.width) && Number.isFinite(budget.height));
      assert.ok(budget.height >= 1 && budget.height < viewport.height);
    }
  }
  assert.ok(geometry.includes('else { return nil } // unknown geometry'));
  assert.ok(native.includes('func fittedSize(proposal _: ProposedViewSize)'));
  assert.equal(/proposal\.(width|height)/u.test(native), false);
  assert.ok(native.includes('safeAreaLayoutGuide.layoutFrame'));
  assert.ok(native.includes('safe.intersection(window.keyboardLayoutGuide.layoutFrame)'));
  assert.ok(native.includes('keys.count == 1 ? keys[0] : nil'));
  assert.equal(/UIScreen\.main/u.test(native), false);
});

test('TextKit measures complete styled source at fixed logical width without string-height heuristics', () => {
  for (const value of [
    'NSTextStorage(string: input.source', 'UIFont.preferredFont(forTextStyle: input.fontStyle',
    'preferredContentSizeCategory: input.category', 'paragraph.lineSpacing', 'paragraph.baseWritingDirection = .natural',
    'textContainer.maximumNumberOfLines = 0', 'layout.ensureLayout(for: textContainer)',
    'layout.usedRect(for: textContainer)', 'NSMaxRange(covered) == textStorage.length',
    'layout.extraLineFragmentRect.maxY', 'occupiedWidth + horizontal * 2',
  ]) assert.ok(native.includes(value), value);
  assert.equal(/source\.(prefix|suffix|count|split|substring)|boundingRect.*source\.count/u.test(native), false);
  assert.equal(/#[a-f0-9]{6}|UIColor\(red:/iu.test(native), false);
});

test('vector draw and sizeThatFits report fitted bounds, never a full-height bitmap/view frame', () => {
  for (const value of [
    'uiView.fittedSize(proposal: proposal)', 'intrinsicContentSize: CGSize { fittedSize(proposal: .unspecified) }',
    'return resolved.size', 'context.scaleBy(x: fit.scale, y: fit.scale)',
    'manager.drawGlyphs(forGlyphRange: glyphRange', 'layer.cornerRadius = nonnegative(input.cornerRadius) * resolved.scale',
    '.continuous).path(in: sourceRect).cgPath', 'context.setLineWidth(border)',
  ]) assert.ok(native.includes(value), value);
  assert.equal(/UIGraphicsImageRenderer|UIImage|drawHierarchy|render\(in:|drawingGroup|scaleEffect|frame.*naturalSize/u.test(native), false);
});

test('per-presentation cache is frozen across repeated sizing and released on teardown, with no transcript updates', () => {
  assert.ok(native.indexOf('if let fit { return fit.size }') < native.indexOf('let natural = measure'));
  assert.ok(native.includes('if measurementAttempted { return .zero }'));
  assert.ok(native.includes('measurementAttempted = false'));
  assert.ok(native.includes('endPresentation()'));
  assert.ok(native.includes('static func dismantleUIView'));
  assert.ok(native.includes('storage.removeLayoutManager(manager)'));
  assert.ok(native.includes('pendingInput = nil'));
  assert.equal(/shadowNodeProxy|setViewSize|onLayoutContent|onGeometryChange|Timer|DispatchQueue|gestureRecognizer|Haptic|contextMenu\(/u.test(native), false);
  assert.equal(/snapshot = input/u.test(native), true);
});

test('initial unavailable sizing recovers through observed SwiftUI fitted bounds, not drawing alone', () => {
  for (const value of [
    '@StateObject private var sizing = PreviewSizingState()', '@Published private var recovery: Recovery?',
    '.frame(width: recovered?.width, height: recovered?.height)',
    'sizing.bind(view)', 'view.onSizingRecovery = { [weak self]',
    'self?.recovery = Recovery(input: input, size: size)',
    'override func didMoveToWindow()', 'override func safeAreaInsetsDidChange()',
    'override func layoutSubviews()', 'recoverSizingIfNeeded()',
    'guard fit != nil else { return }', 'onSizingRecovery?(input, size)',
    'notifiedFit = true', 'notifiedFit = false', 'invalidateIntrinsicContentSize()',
  ]) assert.ok(native.includes(value), value);
  const recovery = native.slice(native.indexOf('private func recoverSizingIfNeeded()'), native.indexOf('func beginPresentation()', native.indexOf('private func recoverSizingIfNeeded()')));
  assert.ok(recovery.indexOf('guard fit != nil') < recovery.indexOf('onSizingRecovery?'));
  assert.ok(recovery.includes('notifiedFit'));
  assert.equal(/setNeedsLayout|setNeedsDisplay/u.test(recovery), false);
  // No publishing from sizeThatFits, updateUIView, or intrinsic sizing itself.
  const fitting = native.slice(native.indexOf('func fittedSize('), native.indexOf('private func nonnegative'));
  assert.equal(/onSizingRecovery\?|recovery =/u.test(fitting), false);
});

test('native appearance boundaries and actual input/window keys prevent stale reuse without proposal churn', () => {
  for (const value of [
    '.onAppear(perform: sizing.beginPresentation)', '.onDisappear(perform: sizing.endPresentation)',
    'guard !presentationActive else { return }', 'guard pendingInput != input else { return }',
    'struct PreviewInput: Equatable', 'recovery?.input == input',
    'ObjectIdentifier(window)', 'window.bounds.size', 'window.safeAreaInsets', 'window.layoutMargins',
    'if measuredWindowGeometry != geometry { resetPresentation() }', 'onSizingRecovery = nil',
    'weak var view: VectorPreviewView?',
  ]) assert.ok(native.includes(value), value);
  assert.equal(/\.id\(|NotificationCenter|Task\s*\{|DispatchQueue|Timer|UIScreen\.main/u.test(native), false);
  const tests = read('ios-tests/NativePreviewLayoutTests.swift');
  for (const value of [
    'UIWindow(windowScene: scene)', 'allowsKeyWindowFallback = false', 'rootViewController',
    'testUnavailableSizingRecoversAfterAttachment', 'testRepresentableRecoversThroughSwiftUILayout',
    'testDetachReattachAndChangedStyle', 'removeFromSuperview()', 'UIHostingController',
  ]) assert.ok(tests.includes(value), value);
  assert.equal(/makeKeyAndVisible/u.test(tests), false);
});
