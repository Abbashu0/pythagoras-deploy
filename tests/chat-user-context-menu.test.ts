import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { presentUserMessage } from '../mobile/src/ai/user-message-presentation';
import { firstStrongTextDirection } from '../mobile/src/ai/rich-response/text-direction';
import { LONG_USER_FIXTURE } from '../mobile/src/ai/renderer-quality-fixtures.dev';

const owner = fs.readFileSync('mobile/src/ai/chat-composer.ios.tsx', 'utf8').replace(/\r\n/g, '\n');
const helper = fs.readFileSync('mobile/src/ai/chat-user-context-menu.ios.tsx', 'utf8').replace(/\r\n/g, '\n');
const bubbleSource = owner.slice(owner.indexOf('const ChatUserBubble'), owner.indexOf('function Agent1TurnStatus'));
type Modifier = { name: string; args: unknown[] };
type NativeNode = {
  type: unknown;
  props: { [name: string]: unknown; children?: NativeNode | NativeNode[] | string; modifiers?: Modifier[]; label?: string; systemImage?: string; onPress?: () => Promise<void> };
};

function fixture(content: string, inline: NativeNode, failCopy = false, nativeAvailable = false) {
  const writes: string[] = [];
  const menuType = Object.assign(() => {}, { Trigger: 'NativeTrigger', Items: 'NativeItems', Preview: 'NativePreview' });
  const modifiers = new Proxy({
    shapes: { roundedRectangle: (shape: unknown) => shape },
  }, { get(target, name) {
    if (name === 'shapes') return target.shapes;
    return (...args: unknown[]) => ({ name, args });
  } });
  const moduleExports: { ChatUserMessageContextMenu?: (props: Record<string, unknown>) => NativeNode } = {};
  vm.runInNewContext(ts.transpileModule(helper, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports: moduleExports,
    require: (name: string) => {
      if (name === 'expo-clipboard') return { setStringAsync: async (value: string) => {
        writes.push(value);
        if (failCopy) throw new Error('unavailable');
        return true;
      } };
      if (name === '@expo/ui/swift-ui') return { Button: 'NativeButton', ContextMenu: menuType, Text: 'NativeText' };
      if (name === '@expo/ui/swift-ui/modifiers') return modifiers;
      if (name === './rich-response/text-direction') return { firstStrongTextDirection };
      if (name === './fitted-user-message-preview.ios') return { hasFittedUserMessagePreview: nativeAvailable, PythagorasFittedUserMessagePreview: 'NativeFittedPreview' };
      if (name === 'react/jsx-runtime') return { jsx: (type: unknown, props: NativeNode['props']) => ({ type, props }), jsxs: (type: unknown, props: NativeNode['props']) => ({ type, props }) };
      throw new Error('unexpected import: ' + name);
    },
  });
  const tree = moduleExports.ChatUserMessageContextMenu!({
    content, maxWidth: 320, cornerRadius: 24,
    palette: { text: '#FAF9F5', border: '#343432', surfaceInset: '#131313' },
    children: inline,
  });
  const slots = tree.props.children as NativeNode[];
  const slot = (type: string) => slots.find(node => node.type === type)!;
  return {
    tree, writes,
    trigger: slot('NativeTrigger'),
    preview: slot('NativePreview').props.children as NativeNode,
    action: slot('NativeItems').props.children as NativeNode,
  };
}

test('native trigger owns one real bubble; native menu owns exactly one Copy action and a separate preview', () => {
  const inline: NativeNode = { type: 'VisibleBubble', props: {} };
  const f = fixture('مرحبا', inline);
  assert.equal((f.tree.props.children as NativeNode[]).length, 3);
  assert.equal(f.trigger.props.children, inline);
  assert.equal(f.action.type, 'NativeButton');
  assert.equal(f.action.props.label, 'نسخ');
  assert.equal(f.action.props.systemImage, 'square.on.square');
  assert.equal(f.preview.type, 'NativeText');
  assert.equal(f.preview.props.children, 'مرحبا');
  assert.equal(f.tree.props.modifiers?.[0].name, 'frame'); // width remains outside activationElement.contextMenu
  assert.equal(f.trigger.props.modifiers, undefined);
});

test('the real Copy callback preserves complete Unicode, CRLF, tabs, whitespace and fenced source', async () => {
  for (const content of ['مرحبا', '  نَصّ عربي + API\r\n\t😀 👨‍👩‍👧‍👦\n\n', '\x60\x60\x60ts\n\tconst π = "مرحبا";  \n\x60\x60\x60\n', LONG_USER_FIXTURE]) {
    const f = fixture(content, { type: 'VisibleBubble', props: {} });
    await f.action.props.onPress!();
    assert.deepEqual(f.writes, [content]);
    assert.equal(f.preview.props.children, content);
  }
});

test('collapsed inline text stays collapsed while the separate preview and Copy receive the full source', async () => {
  const content = '  مرحبا نَصّ طويل 👋\n\t API '.repeat(450);
  const presentation = presentUserMessage(content, false);
  assert.equal(presentation.collapsed, true);
  assert.notEqual(presentation.text, content);
  const inline: NativeNode = { type: 'VisibleCollapsedBubble', props: { children: presentation.text } };
  const before = JSON.stringify(inline);
  const f = fixture(content, inline);
  assert.equal(f.preview.props.children, content);
  await f.action.props.onPress!();
  assert.equal(JSON.stringify(f.trigger.props.children), before);
  assert.deepEqual(f.writes, [content]);
  assert.equal(presentUserMessage(content, false).collapsed, true);
});

test('medium and very long source reach the native preview and clipboard with the final marker byte-exact', async () => {
  const marker = 'PYTHAGORAS_LONG_MESSAGE_END_2026';
  for (const content of [
    ('نَصّ متوسط + API\r\n\t😀 ').repeat(45) + marker + '\r\n  ',
    ('رسالة طويلة جدًا 👨‍👩‍👧‍👦\r\n\tCode + Arabic\n').repeat(1600) + marker + '\r\n  ',
  ]) {
    for (const expanded of [false, true]) {
      const presentation = presentUserMessage(content, expanded);
      const inline: NativeNode = { type: 'VisibleBubble', props: { children: presentation.text } };
      const before = JSON.stringify(inline);
      const f = fixture(content, inline);
      assert.equal(f.preview.props.children, content); // source integrity only; this does not prove native viewport fitting
      assert.ok((f.preview.props.children as string).includes(marker));
      await f.action.props.onPress!();
      assert.deepEqual(Buffer.from(f.writes[0], 'utf8'), Buffer.from(content, 'utf8'));
      assert.equal(f.writes[0].endsWith(marker + '\r\n  '), true);
      assert.equal(JSON.stringify(inline), before);
    }
  }
});

test('legacy-build fallback retains full-source native typography until the new fitting module is installed', () => {
  for (const content of ['مرحبا', 'API + عربي', LONG_USER_FIXTURE]) {
    const f = fixture(content, { type: 'VisibleBubble', props: {} });
    const mods = f.preview.props.modifiers!;
    const get = (name: string) => mods.find(m => m.name === name)!.args;
    assert.equal((get('font')[0] as { textStyle: string }).textStyle, 'body');
    assert.equal(get('multilineTextAlignment')[0], firstStrongTextDirection(content) === 'ltr' ? 'leading' : 'trailing');
    assert.equal(get('lineSpacing')[0], 3);
    assert.equal((get('fixedSize')[0] as { vertical: boolean }).vertical, true);
    const width = get('frame')[0] as Record<string, unknown>;
    assert.equal(width.maxWidth, 320);
    assert.equal('height' in width || 'maxHeight' in width, false);
    assert.equal((get('contentShape')[0] as { cornerRadius: number; roundedCornerStyle: string }).cornerRadius, 24);
    assert.equal((get('contentShape')[0] as { roundedCornerStyle: string }).roundedCornerStyle, 'continuous');
    assert.equal(get('contentShape')[1], 'contextMenuPreview');
    assert.equal(mods.some(m => ['lineLimit', 'scaleEffect', 'onGeometryChange', 'onLayout'].includes(m.name)), false);
  }
});

test('registered fitting module receives exact source/style props; Copy remains outside the fitted preview', async () => {
  const source = ('نَصّ كامل 👨‍👩‍👧‍👦\r\n\t API ').repeat(900) + 'PYTHAGORAS_LONG_MESSAGE_END_2026\n  ';
  const inline: NativeNode = { type: 'VisibleBubble', props: { children: presentUserMessage(source).text } };
  const f = fixture(source, inline, false, true);
  assert.equal(f.preview.type, 'NativeFittedPreview');
  assert.equal(f.preview.props.source, source);
  assert.equal(f.preview.props.logicalMaxWidth, 320);
  assert.equal(f.preview.props.direction, firstStrongTextDirection(source));
  assert.equal(f.preview.props.fontStyle, 'body');
  assert.equal(f.preview.props.horizontalPadding, 15);
  assert.equal(f.preview.props.verticalPadding, 11);
  assert.equal(f.preview.props.cornerRadius, 24);
  assert.equal(f.preview.props.borderWidth, 0.8);
  assert.equal(f.preview.props.foregroundColor, '#FAF9F5');
  assert.equal(f.preview.props.backgroundColor, '#131313');
  assert.equal(f.preview.props.borderColor, '#343432');
  assert.equal(f.preview.props.onLayout, undefined);
  assert.equal(f.preview.props.onGeometryChange, undefined);
  assert.equal(f.action.props.label, 'نسخ');
  await f.action.props.onPress!();
  assert.deepEqual(Buffer.from(f.writes[0]), Buffer.from(source));
  assert.equal(f.trigger.props.children, inline);
});

test('owner keeps Spacer/Host/row outside the menu and preserves both inline text-selection and disclosure taps', () => {
  assert.ok(bubbleSource.includes('<ChatUserMessageContextMenu content={message.content}'));
  assert.ok(bubbleSource.indexOf('<Spacer minLength={0} />') < bubbleSource.indexOf('<ChatUserMessageContextMenu'));
  assert.ok(bubbleSource.includes('const bubble = presentation.collapsible ?'));
  assert.ok(bubbleSource.includes('{bubble}\n      </ChatUserMessageContextMenu>'));
  const syntax = ts.createSourceFile('Bubble.tsx', bubbleSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let choice: ts.ConditionalExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(syntax) === 'bubble' && node.initializer && ts.isConditionalExpression(node.initializer)) choice = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  assert.ok(choice);
  const rootTag = (value: ts.Expression) => {
    const expression = ts.isParenthesizedExpression(value) ? value.expression : value;
    assert.ok(ts.isJsxElement(expression));
    return expression.openingElement.tagName.getText(syntax);
  };
  assert.deepEqual([rootTag(choice.whenTrue), rootTag(choice.whenFalse)], ['VStack', 'Text']);
  assert.equal((bubbleSource.match(/textSelection\(true\)/gu) ?? []).length, 2);
  assert.equal((bubbleSource.match(/contentShape\(bubbleShape, \['interaction', 'contextMenuPreview'\]\)/gu) ?? []).length, 2);
  assert.ok(bubbleSource.includes('<Button onPress={onToggle}'));
  assert.ok(bubbleSource.includes('>{presentation.text}</Text>'));
  assert.ok(bubbleSource.includes('const bubbleMaxWidth = contentWidth * 0.82'));
  assert.equal(/setExpanded|onPresentationChange|scrollTo|onLayout|onGeometryChange/u.test(bubbleSource), false);
  const row = owner.slice(owner.indexOf('export const ChatUserMessageRow'), owner.indexOf('const ChatAssistantMessageRow'));
  assert.ok(row.includes('matchContents={{ vertical: true, horizontal: false }}'));
  assert.ok(row.includes('onLayoutContent={handleHostLayout}'));
  assert.ok(row.includes('minHeight: nativeHeight ?? undefined'));
  assert.equal(row.includes('ContextMenu'), false);
  const assistant = owner.slice(owner.indexOf('const ChatAssistantMessageRow'), owner.indexOf('const ChatUserBubble'));
  assert.equal(assistant.includes('ContextMenu'), false);
});

test('installed Expo native implementation owns preview presentation, lift shape and transient interaction', () => {
  const swift = fs.readFileSync('mobile/node_modules/@expo/ui/ios/ContextMenu/ContextMenu.swift', 'utf8');
  assert.ok(swift.includes('activationElement.contextMenu(menuItems:'));
  assert.ok(swift.includes('}, preview: {\n        preview'));
  assert.ok(swift.includes('props.children?.slot("preview")'));
  assert.ok(helper.includes("import { Button, ContextMenu, Text } from '@expo/ui/swift-ui'"));
  assert.equal(/setTimeout|setInterval|useState|useEffect|Haptics|Modal|BlurView|ScrollView|onLongPress|onLayout|onGeometryChange|scaleEffect|scrollTo|setTurns/u.test(helper), false);
  assert.equal(/presentation\.text|trim\(|normalize\(|slice\(|substring\(|Date\./u.test(helper), false);
});

test('clipboard failure cannot mutate source, inline presentation or transcript state', async () => {
  const content = '  عَرَبِيّ\n\t API 👋 ';
  const inline: NativeNode = { type: 'VisibleBubble', props: { children: content } };
  const f = fixture(content, inline, true);
  await assert.doesNotReject(f.action.props.onPress!());
  assert.equal(f.trigger.props.children, inline);
  assert.equal(f.preview.props.children, content);
  assert.deepEqual(f.writes, [content]);
});
