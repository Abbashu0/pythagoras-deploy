import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const app = (file: string) => fs.readFileSync(file, 'utf8');
const native = (file: string) => app(path.join('mobile/node_modules/react-native-enriched-markdown', file));
const fields = ['Surface', 'SelectedSurface', 'PressedSurface', 'Foreground', 'SelectedForeground', 'Border'];
const themeExports: { palettes?: Record<'dark' | 'light', Record<string, string>> } = {};
vm.runInNewContext(ts.transpileModule(app('mobile/src/theme.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: themeExports });
const palettes = themeExports.palettes!;

test('neutral chrome has warm dark reference roles and independent warm light roles', () => {
  const roles = ['controlSurface', 'controlForeground', 'controlBorder', 'controlSurfacePressed', 'controlSurfaceSelected', 'controlForegroundSelected'] as const;
  assert.deepEqual(roles.map(role => palettes.dark[role]), ['#272726', '#C3C2B7', '#4E4E4A', '#32312F', '#454440', '#FAF9F5']);
  assert.deepEqual(roles.map(role => palettes.light[role]), ['#F0EEE6', '#5E5D59', '#D1CFC5', '#E8E6DC', '#E3E1D8', '#1A1918']);
  assert.equal(palettes.dark.background, '#202020');
  assert.equal(palettes.dark.surfaceElevated, '#2C2C2A');
  assert.equal(palettes.dark.accent, '#0A84FF');
});

test('Chat top and end controls retain native glass and fixed targets with neutral colors', () => {
  const top = app('mobile/src/ai/chat-top-controls.ios.tsx');
  const end = app('mobile/src/ai/chat-scroll-to-bottom.ios.tsx');
  assert.ok(top.includes("buttonStyle('glassProminent')"));
  assert.ok(top.includes('tint(surfaceColor)'));
  assert.ok(top.includes('seedColor={palette.controlSurface}'));
  assert.ok(app('mobile/app/chat.tsx').includes('foregroundColor={palette.controlForeground}'));
  assert.ok(end.includes("buttonStyle(nativeGlass ? 'glassProminent' : 'bordered')"));
  assert.ok(end.includes('nativeTint(palette.controlSurface)'));
  assert.ok(end.includes('composerHeight.get() - safeAreaBottom'));
  assert.ok(app('mobile/src/ai/chat-composer.ios.tsx').includes('tint={palette.controlForeground}'));
  for (const source of [top, end]) assert.ok(source.includes('width: 44, height: 44'));
});

test('composer recolors only neutral actions and preserves primary Send and geometry', () => {
  const controls = app('mobile/src/ai/chat-composer-controls.ios.tsx');
  const policy = app('mobile/src/ai/chat-composer-presentation.ts');
  assert.ok(controls.includes('hasSendableText ? palette.accent : palette.controlSurface'));
  assert.ok(controls.includes('hasSendableText ? palette.accentText : palette.controlForeground'));
  assert.ok(controls.includes('foregroundStyle(palette.controlSurface)'));
  assert.ok(controls.includes('interactive: true, tint: palette.surface'));
  for (const [name, value] of [['COMPOSER_COMPACT_HEIGHT', 48], ['COMPOSER_COMPACT_HORIZONTAL_INSET', 38], ['COMPOSER_COMPACT_CORNER_RADIUS', 24], ['COMPOSER_EXPANDED_MIN_HEIGHT', 94], ['COMPOSER_EXPANDED_HORIZONTAL_INSET', 16], ['COMPOSER_EXPANDED_CORNER_RADIUS', 28]]) {
    assert.match(policy + controls, new RegExp(name + '\\s*=\\s*' + value));
  }
  assert.ok(controls.includes('lineLimit({ min: 1, max: 5 })'));
  assert.equal(/Keyboard\.addListener/u.test(controls), false);
});

test('assistant actions stay unfilled and keep selected reaction semantics', () => {
  const parent = app('mobile/src/ai/chat-composer.ios.tsx');
  const actions = parent.slice(parent.indexOf('const ChatAssistantActions'), parent.indexOf('function ChatInlineNotice'));
  assert.ok(actions.includes("buttonStyle('plain')"));
  assert.ok(actions.includes("reaction === 'like' ? palette.text : palette.controlForeground"));
  assert.ok(actions.includes("reaction === 'dislike' ? palette.text : palette.controlForeground"));
  assert.equal(/background\(|Circle|glassEffect/u.test(actions), false);
});

test('optional semantic code colors cross public types, Fabric, config copy and native diff', () => {
  const style = app('mobile/src/ai/assistant-enriched-markdown.ios.tsx');
  const header = native('ios/styles/StyleConfig.h');
  const config = native('ios/styles/StyleConfig.mm');
  const diff = native('ios/utils/StylePropsUtils.h');
  const props = native('ios/generated/ReactCodegen/EnrichedMarkdownTextSpec/Props.h');
  for (const field of fields) {
    const name = 'control' + field + 'Color';
    assert.ok(style.includes(name + ': palette.control'));
    for (const file of ['src/types/MarkdownStyle.ts', 'lib/typescript/src/types/MarkdownStyle.d.ts', 'src/EnrichedMarkdownNativeComponent.ts', 'src/EnrichedMarkdownTextNativeComponent.ts']) assert.ok(native(file).includes(name + '?:'));
    assert.ok(header.includes('(nullable RCTUIColor *)codeBlockControl' + field + 'Color'));
    assert.ok(config.includes('copy->_codeBlockControl' + field + 'Color = [_codeBlockControl' + field + 'Color copy]'));
    assert.ok(diff.includes('RCTUIColorFromSharedColor(newStyle.codeBlock.' + name + ')'));
    assert.equal((props.match(new RegExp('SharedColor ' + name + '\\{\\};', 'gu')) ?? []).length, 2);
    assert.equal((props.match(new RegExp('result\\.' + name + '\\);', 'gu')) ?? []).length, 2);
  }
  assert.ok(native('src/styleUtils.ts').includes("key.toLowerCase().includes('color')"));
  assert.ok(style.includes('backgroundColor: palette.surfaceElevated'));
});

test('inline and fullscreen keep genuine shared native segmented selection and glass', () => {
  const preview = native('ios/code/ENRMCodePreviewController.swift');
  const chrome = preview.slice(0, preview.indexOf('@objc(ENRMCodePreviewController)'));
  const fullscreen = native('ios/code/ENRMCodeFullscreenController.swift');
  const view = native('ios/views/ENRMCodeBlockContainerView.m');
  assert.ok(chrome.includes('ENRMPreviewSegments: UISegmentedControl'));
  assert.ok(chrome.includes('selectedSegmentTintColor = selectedSurface'));
  assert.ok(chrome.includes('setTitleTextAttributes'));
  assert.ok(chrome.includes('UIGlassEffect(style: .regular)'));
  assert.ok(chrome.includes('glass.tintColor = controlSurface'));
  assert.ok(chrome.includes('glass.isInteractive = false'));
  assert.ok(chrome.includes('controlSurface ?? .secondarySystemBackground'));
  assert.equal(/setBackgroundImage|setDividerImage|#[0-9a-f]{6}|UIColor\(red:/iu.test(chrome), false);
  assert.ok(fullscreen.includes('modes.applyControlColors('));
  assert.ok(fullscreen.includes('configuration = .glass()'));
  assert.ok(fullscreen.includes('close.baseForegroundColor = controlForegroundColor ?? primaryColor'));
  assert.ok(view.includes('self.config.codeBlockControlForegroundColor ?: self.config.codeBlockColor'));
  for (const field of fields) assert.ok(view.includes('viewer.control' + field + 'Color = self.config.codeBlockControl' + field + 'Color'));
  assert.ok(view.includes('_language.textColor = self.config.paragraphColor'));
});

test('existing generic native normalization transports optional colors and leaves absent fields absent', () => {
  const exports: { mergeSubStyle?: (defaults: Record<string, unknown>, user?: Record<string, unknown>) => Record<string, unknown> } = {};
  const normalizedColors: string[] = [];
  vm.runInNewContext(ts.transpileModule(native('src/styleUtils.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, {
    exports,
    require: (name: string) => {
      assert.equal(name, 'react-native');
      return { Platform: { OS: 'ios' }, processColor: (color: string) => {
        normalizedColors.push(color);
        return color === '#272726' ? 0xff272726 : null;
      } };
    },
  });
  const merge = exports.mergeSubStyle!;
  const defaults = { padding: 12, borderRadius: 21 };
  const untouched = merge(defaults);
  assert.equal(untouched, defaults);
  assert.equal('controlSurfaceColor' in untouched, false);
  const styled = merge(defaults, { controlSurfaceColor: '#272726', controlForegroundColor: 'invalid' });
  assert.equal(styled.controlSurfaceColor, 0xff272726);
  assert.equal(styled.controlForegroundColor, undefined); // SharedColor nil -> native fallback
  assert.equal(styled.padding, 12);
  assert.equal(styled.borderRadius, 21);
  assert.deepEqual(normalizedColors, ['#272726', 'invalid']);
});
