import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';
import { NATIVE_PREVIEW_TUNING, type NativePreviewTuning } from '../mobile/src/ai/native-preview-tuning.dev';

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
    'manager.drawGlyphs(forGlyphRange: glyphRange', 'layer.cornerRadius = resolved.scaledCornerRadius(input.cornerRadius)',
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
    'sizing.bind(view)', 'view.onSizingRecovery = { [weak self, weak view]',
    'guard let fit = view?.fit, fit.size == size else { return }',
    'self?.recovery = Recovery(input: input, geometry: fit)',
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

test('the native context-preview outline uses the fitted radius without a separate mask or unscaled capsule', () => {
  const body = geometry.match(/func scaledCornerRadius\(_ cornerRadius: CGFloat\) -> CGFloat \{\s*let radius = (.+)\s*return (.+)\s*\}/u)!;
  assert.ok(body);
  // Adapt CGFloat's isFinite/value coercion; evaluate the actual Swift expressions.
  const radiusFormula = vm.runInNewContext(`(cornerRadius, scale) => {
    const radius = ${body[1]}; return ${body[2]};
  }`, { max: Math.max }) as (value: { isFinite: boolean; valueOf: () => number }, scale: number) => number;
  const radius = (value: number, scale: number) => radiusFormula({ isFinite: Number.isFinite(value), valueOf: () => value }, scale);
  for (const height of [48, 1000, 20000, 1000000]) {
    const fit = fitFormula({ width: 320, height }, { width: 320, height: 400 });
    const result = radius(24, fit.scale);
    assert.equal(result, 24 * fit.scale);
    assert.ok(Math.abs(result / fit.width - 24 / 320) < 1e-10);
    assert.ok(result < fit.width / 2); // no default radius swallowing a narrow miniature
  }
  assert.equal(radius(24, 1), 24);
  for (const value of [-1, NaN, Infinity]) assert.equal(radius(value, 0.02), 0);
  for (const value of [
    'let geometry: FittedPreviewGeometry', 'recovery?.geometry.size',
    'return recovery.geometry.scaledCornerRadius(input.cornerRadius)',
    '.contentShape(.contextMenuPreview, RoundedRectangle(',
    'cornerRadius: sizing.recoveredCornerRadius(for: input) ?? 0, style: .continuous)',
    'layer.cornerRadius = resolved.scaledCornerRadius(input.cornerRadius)',
    'clipsToBounds = true',
  ]) assert.ok(native.includes(value), value);
  const surface = native.slice(native.indexOf('struct FittedPreviewSurface'), native.indexOf('private struct VectorPreviewRepresentable'));
  assert.ok(surface.indexOf('.frame(') < surface.indexOf('.contentShape('));
  assert.equal(/clipShape|mask\(|overlay\(|\.interaction/u.test(surface), false);
  assert.ok(read('ios-tests/NativePreviewLayoutTests.swift').includes('testPreviewOutlineMatchesTheScaledVectorBubble'));
  assert.ok(fs.readFileSync('mobile/node_modules/@expo/ui/ios/Modifiers/ContentShapeModifier.swift', 'utf8').includes('return .contextMenuPreview'));
});

type PreviewSize = { width: number; height: number };
type OpticalFit = { scale: number; size: PreviewSize; opticalInsets: PreviewSize };
const opticalSource = geometry.slice(geometry.indexOf('static func fitPreview('));
const opticalCondition = opticalSource.match(/let needsOpticalSafety = (.+)/u)![1];
const insetSource = geometry.slice(geometry.indexOf('func insets('), geometry.indexOf('struct FittedPreviewGeometry'));
const opticalInsets = insetSource.match(/CGSize\(width: (.+),\s*height: (.+)\)/u)!;
const opticalAvailable = opticalSource.match(/let innerAvailable = CGSize\(width: (.+),\s*height: (.+)\)/u)!;
const opticalOuter = opticalSource.match(/let outerSize = CGSize\(width: (.+),\s*height: (.+)\)/u)!;
const oversizedCondition = opticalSource.match(/if (.+) \{/u)![1];
const defaultEligibility = opticalSource.match(/guard (defaults.opticalSafetyEnabled.+) else/u)![1];
const nativeDefaults = Object.fromEntries(geometry.match(/static let defaults = PreviewOpticalTuning\(([\s\S]*?)\)/u)![1]
  .split(',').map(field => { const [key, value] = field.trim().split(':'); return [key, JSON.parse(value.trim())]; })) as NativePreviewTuning;
// Execute the actual Swift arithmetic with a thin optional/CGSize adapter.
// This is a portable geometry oracle, not a UIKit or Swift execution claim.
const opticalFormula = vm.runInNewContext(`(natural, available, radius, displayScale, tuning = defaults) => {
  if (![natural.width, natural.height, available.width, available.height, displayScale].every(value => Number.isFinite(value) && value > 0)) return null;
  const plain = fit(natural, available);
  const base = { scale: plain.scale, size: { width: plain.width, height: plain.height } };
  const pixel = 1 / displayScale;
  const needsOpticalSafety = ${opticalCondition};
  if (!needsOpticalSafety) return { ...base, opticalInsets: { width: 0, height: 0 } };
  const insetPolicy = tuning => {
    const { sideSafetyPixels, endSafetyWidthFactor, endSafetyExtraPixels } = tuning;
    const baseWidth = base.size.width;
    return { width: ${opticalInsets[1]}, height: ${opticalInsets[2]} };
  };
  let insets = insetPolicy(tuning);
  if (${oversizedCondition}) {
    if (JSON.stringify(tuning) === JSON.stringify(defaults)) return null;
    if (!(${defaultEligibility})) return { ...base, opticalInsets: { width: 0, height: 0 } };
    insets = insetPolicy(defaults);
    if (insets.width * 2 >= available.width || insets.height * 2 >= available.height) return null;
  }
  const innerAvailable = { width: ${opticalAvailable[1]}, height: ${opticalAvailable[2]} };
  if (![innerAvailable.width, innerAvailable.height].every(value => Number.isFinite(value) && value > 0)) return null;
  const inner = fit(natural, innerAvailable);
  const content = { scale: inner.scale, size: { width: inner.width, height: inner.height } };
  return { scale: content.scale, size: { width: ${opticalOuter[1]}, height: ${opticalOuter[2]} }, opticalInsets: insets };
}`, { fit: fitFormula, min: Math.min, defaults: nativeDefaults }) as (natural: PreviewSize, available: PreviewSize, radius: number, displayScale: number, tuning?: NativePreviewTuning) => OpticalFit | null;

test('optical safety leaves short and wide previews unchanged while protecting a complete narrow content box', () => {
  const available = { width: 300, height: 400 };
  for (const natural of [{ width: 90, height: 48 }, { width: 320, height: 800 }]) {
    const fit = opticalFormula(natural, available, 24, 3)!;
    const base = fitFormula(natural, available);
    assert.equal(fit.scale, base.scale);
    assert.equal(fit.size.width, base.width);
    assert.equal(fit.size.height, base.height);
    assert.equal(fit.opticalInsets.width, 0);
    assert.equal(fit.opticalInsets.height, 0);
  }
  for (const displayScale of [1, 2, 3]) {
    for (const height of [3000, 20000, 1000000]) {
      const natural = { width: 320, height };
      const fit = opticalFormula(natural, available, 24, displayScale)!;
      const pixel = 1 / displayScale;
      const contentWidth = fit.size.width - fit.opticalInsets.width * 2;
      const contentHeight = fit.size.height - fit.opticalInsets.height * 2;
      assert.equal(fit.opticalInsets.width, pixel);
      assert.ok(fit.opticalInsets.height >= fit.size.width + pixel);
      assert.ok(Math.abs(contentWidth - natural.width * fit.scale) < 1e-8);
      assert.ok(Math.abs(contentHeight - natural.height * fit.scale) < 1e-8);
      assert.ok(Math.abs(contentWidth / contentHeight - natural.width / natural.height) < 1e-8);
      assert.ok(fit.size.width <= available.width && fit.size.height <= available.height);
      assert.ok(fit.size.width > 0 && fit.size.height > 0 && Number.isFinite(fit.scale));
      assert.equal(JSON.stringify(opticalFormula(natural, available, 24, displayScale)), JSON.stringify(fit));
    }
  }
  for (const value of [0, -1, NaN, Infinity]) assert.equal(opticalFormula({ width: 320, height: 20000 }, available, 24, value), null);
  assert.equal(opticalFormula({ width: 320, height: 20000 }, { width: 1, height: 1 }, 24, 3), null);
});

test('native optical margins belong to measured preview bounds and glyph drawing, not transcript geometry', () => {
  for (const value of [
    'FittedPreviewGeometry.fitPreview(natural: natural, available: available',
    'sourceCornerRadius: input.cornerRadius, displayScale: displayScale, tuning: input.opticalTuning)',
    'positiveFinite(currentWindow?.screen.scale)', 'displayScale: window.screen.scale',
    'let sourceRect = CGRect(origin: .zero, size: fit.size)',
    'context.translateBy(x: fit.opticalInsets.width, y: fit.opticalInsets.height)',
    'let border = nonnegative(input.borderWidth) * fit.scale',
    'var fittedGlyphBounds: CGRect?', 'manager.boundingRect(forGlyphRange: glyphRange, in: container)',
  ]) assert.ok(native.includes(value), value);
  const drawing = native.slice(native.indexOf('override func draw('), native.indexOf('override func didMoveToWindow()'));
  assert.ok(drawing.indexOf('context.fillPath()') < drawing.indexOf('context.scaleBy('));
  assert.ok(drawing.indexOf('context.clip()') < drawing.indexOf('fit.opticalInsets.width'));
  assert.ok(geometry.includes('let content = fit(natural: natural, available: innerAvailable)'));
  assert.equal(/for\s|while\s|source\.count|source\.split/u.test(opticalSource), false);
  assert.ok(read('ios-tests/NativePreviewLayoutTests.swift').includes('testActualArabicGlyphBoundsStayOutsideOpticalCapsAndKeepTheEndMarker'));
});

test('five native Debug props, validated effective input and Release defaults preserve the existing optical policy', () => {
  assert.deepEqual(NATIVE_PREVIEW_TUNING, {
    opticalSafetyEnabled: true, sideSafetyPixels: 1, endSafetyWidthFactor: 1,
    endSafetyExtraPixels: 3, narrowEligibilityFactor: 2,
  });
  assert.deepEqual(nativeDefaults, NATIVE_PREVIEW_TUNING);
  for (const key of Object.keys(NATIVE_PREVIEW_TUNING)) assert.ok(native.includes(`@Field var ${key}:`), key);
  const boundary = native.slice(native.indexOf('var activeOpticalTuning:'), native.indexOf('struct PythagorasFittedUserMessagePreview'));
  assert.ok(boundary.includes('#if DEBUG\n    return .validated('));
  assert.ok(boundary.includes('#else\n    return .defaults\n    #endif'));
  assert.ok(native.includes('opticalTuning: props.activeOpticalTuning'));
  const input = native.slice(native.indexOf('struct PreviewInput: Equatable'), native.indexOf('// Local SwiftUI sizing state'));
  assert.ok(input.includes('var opticalTuning: PreviewOpticalTuning = .defaults'));
  assert.ok(native.includes('guard pendingInput != input else { return }'));
  assert.ok(read('ios-tests/NativePreviewLayoutTests.swift').includes('testChangedTuningInvalidatesFitOnTheSameNativeView'));
  assert.ok(fs.readFileSync('.github/scripts/ios-unsigned-build.sh', 'utf8').includes('-configuration Debug'));
  const wrapper = fs.readFileSync('mobile/src/ai/fitted-user-message-preview.ios.tsx', 'utf8');
  assert.ok(wrapper.includes('& Partial<NativePreviewTuning>'));
  assert.equal(/\.id\(|setTimeout|setInterval|onGeometryChange|onLayout/u.test(wrapper), false);
});

test('default tuning exactly matches the pre-parameter optical math; tuning changes only the fitted geometry', () => {
  for (const height of [48, 800, 3000, 20000, 1000000]) {
    for (const displayScale of [1, 2, 3]) {
      const natural = { width: 320, height }, available = { width: 300, height: 400 };
      const base = fitFormula(natural, available);
      const expected = base.scale < 1 && base.width <= 48
        ? (() => {
          const pixel = 1 / displayScale;
          const insets = { width: pixel, height: base.width + pixel * 3 };
          const inner = fitFormula(natural, { width: available.width - insets.width * 2, height: available.height - insets.height * 2 });
          return { scale: inner.scale, size: { width: Math.min(available.width, inner.width + insets.width * 2),
            height: Math.min(available.height, inner.height + insets.height * 2) }, opticalInsets: insets };
        })()
        : { scale: base.scale, size: { width: base.width, height: base.height }, opticalInsets: { width: 0, height: 0 } };
      assert.deepEqual(JSON.parse(JSON.stringify(opticalFormula(natural, available, 24, displayScale, NATIVE_PREVIEW_TUNING))), expected);
    }
  }
  const natural = { width: 320, height: 20000 }, available = { width: 300, height: 400 };
  const baseline = opticalFormula(natural, available, 24, 3)!;
  for (const patch of [{ sideSafetyPixels: 2 }, { endSafetyWidthFactor: 1.5 }, { endSafetyExtraPixels: 6 }, { opticalSafetyEnabled: false }]) {
    assert.notEqual(JSON.stringify(opticalFormula(natural, available, 24, 3, { ...NATIVE_PREVIEW_TUNING, ...patch })), JSON.stringify(baseline));
  }
  assert.equal(opticalFormula({ width: 320, height: 800 }, available, 24, 3)!.opticalInsets.width, 0);
  assert.ok(opticalFormula({ width: 320, height: 800 }, available, 24, 3, { ...NATIVE_PREVIEW_TUNING, narrowEligibilityFactor: 8 })!.opticalInsets.width > 0);
  const oversized = opticalFormula(natural, { width: 300, height: 20 }, 24, 3,
    { ...NATIVE_PREVIEW_TUNING, sideSafetyPixels: 8, endSafetyWidthFactor: 4, endSafetyExtraPixels: 32 });
  assert.equal(JSON.stringify(oversized), JSON.stringify(opticalFormula(natural, { width: 300, height: 20 }, 24, 3)));
});

test('native numeric normalization returns defaults for negative, nonfinite and excessive overrides', () => {
  const expression = geometry.match(/private static func bounded\([^\n]+\) -> CGFloat \{\s*(.+)\s*\}/u)![1];
  const bound = vm.runInNewContext(`(value, maximum, fallback) => Number(${expression})`) as
    (value: { isFinite: boolean; valueOf: () => number }, maximum: number, fallback: number) => number;
  for (const key of ['sideSafetyPixels', 'endSafetyWidthFactor', 'endSafetyExtraPixels', 'narrowEligibilityFactor'] as const) {
    const max = Number(geometry.match(new RegExp(`${key}: bounded\\(${key}, maximum: ([0-9]+),`))![1]);
    for (const value of [-1, NaN, Infinity, max + 1, 1e100]) {
      assert.equal(bound({ isFinite: Number.isFinite(value), valueOf: () => value }, max, nativeDefaults[key]), nativeDefaults[key]);
    }
    for (const value of [0, 0.5, max]) assert.equal(bound({ isFinite: true, valueOf: () => value }, max, nativeDefaults[key]), value);
  }
  // Largest accepted settings remain bounded; unusable experiments fall back.
  for (const height of [3000, 20000, 1000000]) {
    const fit = opticalFormula({ width: 320, height }, { width: 300, height: 400 }, 24, 3,
      { opticalSafetyEnabled: true, sideSafetyPixels: 8, endSafetyWidthFactor: 4, endSafetyExtraPixels: 32, narrowEligibilityFactor: 8 })!;
    assert.ok(Number.isFinite(fit.size.width) && Number.isFinite(fit.size.height));
    assert.ok(fit.size.width > 0 && fit.size.width <= 300 && fit.size.height > 0 && fit.size.height <= 400);
  }
});
