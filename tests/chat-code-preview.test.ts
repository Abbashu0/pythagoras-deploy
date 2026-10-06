import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { CHAT_QUALITY_CASES } from '../mobile/src/ai/renderer-quality-fixtures.dev';

const root = path.join(process.cwd(), 'mobile/node_modules/react-native-enriched-markdown');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const view = read('ios/views/ENRMCodeBlockContainerView.m');
const preview = read('ios/code/ENRMCodePreviewController.swift');
const owner = read('ios/EnrichedMarkdown.mm');
const composer = fs.readFileSync('mobile/src/ai/chat-composer.ios.tsx', 'utf8');

test('preview eligibility uses exact original HTML/Mermaid metadata, never highlight/display aliases', () => {
  const languages = read('ios/utils/ENRMCodeLanguage.m');
  const capability = languages.slice(languages.indexOf('NSString *ENRMCodePreviewLanguage'), languages.indexOf('NSString *ENRMRawCodeContent'));
  const allowed = [...capability.matchAll(/@"(html|mermaid)"/gu)].map(match => match[1]);
  assert.deepEqual(allowed, ['html', 'mermaid']);
  const eligible = (metadata: string) => allowed.includes(metadata.trim().toLowerCase());
  for (const language of ['html', 'HTML', ' Mermaid ']) assert.ok(eligible(language));
  for (const language of ['', 'xml', 'xhtml', 'htm', 'jsx', 'tsx', 'javascript', 'markdown', 'html\u202e', 'html script']) assert.equal(eligible(language), false, language);
  assert.equal(/Highlight|Label\(/u.test(capability), false);
});

test('Source is default and source/copy identity survives mode changes', () => {
  assert.ok(view.includes('BOOL _previewing;')); // zero-initialized; no automatic preview
  assert.ok(view.includes('_rawCode = [ENRMRawCodeContent(node) copy]'));
  assert.ok(view.includes('copyStringToPasteboard(_rawCode)'));
  const toggle = view.slice(view.indexOf('- (void)previewModeChanged:', view.indexOf('@implementation')), view.indexOf('- (void)updatePreviewPresentation', view.indexOf('@implementation')));
  assert.equal(/_rawCode\s*=|applyCodeNode|parse|signature|key\s*=/u.test(toggle), false);
  assert.ok(toggle.includes('_copyButton.hidden = _previewing'));
  assert.ok(view.includes('static NSString *const ENRMCodeCopySymbolName = @"doc.on.doc"'));
  assert.equal((view.match(/systemImageNamed:ENRMCodeCopySymbolName/gu) ?? []).length, 2);
  assert.ok(composer.includes("copied ? 'checkmark' : 'doc.on.doc'"));
});

test('header hierarchy and real native glass control preserve copy target and Source return geometry', () => {
  assert.ok(view.includes('_language.textColor = self.config.paragraphColor'));
  assert.match(fs.readFileSync('mobile/src/ai/assistant-enriched-markdown.ios.tsx', 'utf8'), /paragraph:\s*\{\s*color: palette\.text,/u);
  for (const snippet of ['UISegmentedControl', 'UIGlassEffect(style: .regular)', '#available(iOS 26.0, *)', 'UIBlurEffect(style: .systemThinMaterial)', 'isReduceTransparencyEnabled', 'chevron.left.forwardslash.chevron.right', 'play.fill', 'bounds.insetBy(dx: 0, dy: -4)']) assert.ok(preview.includes(snippet), snippet);
  assert.ok(view.includes('previewControlWidth = 88'));
  assert.ok(view.includes('44, MAX(44, headerHeight)'));
  assert.ok(view.includes('kCACornerCurveContinuous'));
});

test('HTML has no content JS, persistent data, native bridge, external navigation or permissive CSP', () => {
  const html = preview.slice(preview.indexOf('if kind == "html" {'), preview.indexOf('@objc(updateWithSource:'));
  for (const snippet of ['websiteDataStore = .nonPersistent()', 'allowsContentJavaScript = false', 'javaScriptCanOpenWindowsAutomatically = false']) assert.ok(html.includes(snippet), snippet);
  assert.equal(/userContentController\.add\(|addUserScript|evaluateJavaScript|loadFileURL/u.test(html), false);
  const csp = preview.match(/htmlCSP = "([^"]+)"/u)![1];
  for (const directive of ["default-src 'none'", "script-src 'none'", "style-src 'unsafe-inline'", "img-src 'none'", "connect-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(csp.includes(directive));
  assert.ok(preview.includes('web.loadHTMLString(document, baseURL: nil)'));
  assert.ok(preview.includes('url?.absoluteString == "about:blank"'));
  assert.ok(preview.includes('navigationAction.targetFrame?.isMainFrame == true'));
  assert.ok(preview.includes('decisionHandler(allowed ? .allow : .cancel, preferences)'));
  assert.equal(/print\(|NSLog|console\.log/u.test(preview), false);
});

test('Mermaid is pinned, offline and strict; external links and node actions stay inactive', () => {
  const spec = read('ReactNativeEnrichedMarkdown.podspec');
  for (const snippet of ["https://github.com/braddschick/MermaidKit.git", "kind: 'revision', revision: 'a6a5c15f3c91ff4061780c235a44716a988dc475'", "products: ['MermaidKit']", 'PythagorasCodePreviewNotices']) assert.ok(spec.includes(snippet), snippet);
  assert.ok(preview.includes('securityLevel: .strict, source: .bundledDefault'));
  assert.ok(preview.includes('onLinkActivated: { _ in }'));
  assert.equal(/\.cdn\(|onNodeTap:|exportSVG|exportPNG|exportPDF/u.test(preview), false);
  assert.ok(read('ios/code/PythagorasPreview-LICENSE.txt').includes('Copyright (c) 2026 Bradd Schick'));
  assert.ok(read('ios/code/PythagorasPreview-LICENSE.txt').includes('Knut Sveidqvist'));
});

test('lazy previews use real controller containment and explicit handler/resource teardown', () => {
  const construction = view.slice(view.indexOf('- (void)updatePreviewPresentation', view.indexOf('@implementation')), view.indexOf('- (void)detachPreviewController', view.indexOf('@implementation')));
  assert.ok(construction.includes('if (!_previewing || !_previewLanguage || !self.window) return'));
  assert.ok(construction.includes('[self reactViewController]'));
  assert.ok(construction.includes('[parent addChildViewController:_previewController]'));
  assert.ok(construction.includes('didMoveToParentViewController:parent'));
  assert.ok(preview.includes('addChild(host)')); assert.ok(preview.includes('host.didMove(toParent: self)'));
  const teardown = preview.slice(preview.indexOf('@objc public func dispose()'));
  for (const snippet of ['stopLoading()', 'navigationDelegate = nil', 'removeAllScriptMessageHandlers()', 'removeAllUserScripts()', 'host.rootView = AnyView(EmptyView())', 'host.willMove(toParent: nil)', 'host.removeFromParent()', 'mermaidHost = nil']) assert.ok(teardown.includes(snippet), snippet);
  assert.ok(view.includes('if (!newWindow) [self disposePreviewController]'));
  assert.ok(view.includes('else [self detachPreviewController]'));
});

test('preview height changes enter the reviewed native validation path with no transcript writes', () => {
  assert.ok(view.includes('MAX(260, MIN(330, round(width * 0.85)))'));
  assert.ok(view.includes('self.onIntrinsicPresentationChanged()'));
  assert.ok(owner.includes('[currentOwner codeBlockPresentationDidChange]'));
  const invalidation = owner.slice(owner.indexOf('- (void)codeBlockPresentationDidChange\n'), owner.indexOf('// Upstream issue #824'));
  for (const snippet of ['_renderRevision++', '_pendingHeightValidation = YES', '[self validateHeightForCurrentWidth:self.bounds.size.width]']) assert.ok(invalidation.includes(snippet), snippet);
  assert.equal(/requestHeightUpdate|scrollTo|setTimeout|dispatch_after/u.test(invalidation), false);
  assert.equal(/scrollTo|setTimeout|Timer|asyncAfter|measureInWindow/u.test(preview), false);
});

test('scroll affordance uses existing reader/end state and never becomes measured Composer padding', () => {
  const affordance = fs.readFileSync('mobile/src/ai/chat-scroll-to-bottom.ios.tsx', 'utf8');
  assert.ok(composer.includes('shouldShowChatTranscriptScrollToBottom(state, endVisibleRef.current)'));
  assert.ok(composer.includes('if (scrollToBottomVisibleRef.current === visible) return'));
  assert.ok(composer.includes('visible && explicitScrollToEndRef.current'));
  const press = composer.slice(composer.indexOf('const handleScrollToBottom'), composer.indexOf('const handleContentSizeChange'));
  assert.equal((press.match(/scrollView\.scrollTo\(/gu) ?? []).length, 1);
  assert.equal(/setScrollState|blankSpace\.set|composerScrollInset\.set|setTimeout/u.test(press), false);
  for (const snippet of ['position: \'absolute\'', "buttonStyle(nativeGlass ? 'glass' : 'bordered')", "systemImage=\"arrow.down\"", 'width: 44, height: 44', 'composerHeight.get() - safeAreaBottom']) assert.ok(affordance.includes(snippet), snippet);
  assert.equal(/Keyboard\.addListener|onGeometryChange|onLayout=|onScroll=/u.test(affordance), false);
});

const auditRoot = process.env.PYTHAGORAS_MERMAID_AUDIT_ROOT;
const chrome = process.env.PYTHAGORAS_PREVIEW_CHROME;
const run = promisify(execFile);
async function browserDocument(document: string) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pythagoras-preview-oracle-'));
  const file = path.join(folder, 'oracle.html');
  fs.writeFileSync(file, document);
  const { stdout } = await run(chrome!, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--user-data-dir=' + path.join(folder, 'profile'), '--dump-dom', '--virtual-time-budget=5000', new URL('file:///' + file.replaceAll('\\', '/')).href], { maxBuffer: 12 * 1024 * 1024, timeout: 60000 });
  return stdout;
}

test('HTML CSP oracle blocks model scripts and all attempted network resources', { skip: !chrome && 'Set PYTHAGORAS_PREVIEW_CHROME to a local Chrome executable.' }, async () => {
  let requests = 0;
  const server = http.createServer((_req, response) => { requests++; response.end('unexpected network'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const csp = preview.match(/htmlCSP = "([^"]+)"/u)![1];
    const source = CHAT_QUALITY_CASES.find(item => item.title.includes('blocked network'))!.markdown.split('\n').slice(1, -1).join('\n').replaceAll('https://example.invalid', `http://127.0.0.1:${port}`);
    const template = preview.match(/let document = ("(?:[^"\\]|\\.)*") \+ source \+ ("(?:[^"\\]|\\.)*")/u)!;
    const prefix = JSON.parse(template[1].replaceAll('\\(Self.htmlCSP)', csp).replaceAll('\\(background)', '#202020').replaceAll('\\(foreground)', '#FAF9F5')) as string;
    const document = await browserDocument(prefix + source + JSON.parse(template[2]));
    assert.match(document, /id="script-proof">JavaScript must not execute/u);
    assert.equal(requests, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('exact pinned official Mermaid engine renders flowchart/sequence/class and rejects malformed input under offline CSP', { skip: !(auditRoot && chrome) && 'Set PYTHAGORAS_MERMAID_AUDIT_ROOT and PYTHAGORAS_PREVIEW_CHROME.' }, async () => {
  const engine = fs.readFileSync(path.join(auditRoot!, 'Sources/MermaidKit/Resources/mermaid.min.js'), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(createHash('sha256').update(engine).digest('hex'), '70137e77bb273bb2ef972b86e8b0400cca8be53cb25bfc45911a186dc98665de');
  const kit = fs.readFileSync(path.join(auditRoot!, 'Sources/MermaidKit/MermaidHTMLBuilder.swift'), 'utf8');
  for (const clause of ["default-src 'none'", "script-src 'nonce-", "img-src data: blob:", "form-action 'none'"]) assert.ok(kit.includes(clause));
  assert.ok(fs.readFileSync(path.join(auditRoot!, 'Sources/MermaidKit/MermaidWebView.swift'), 'utf8').includes('removeAllScriptMessageHandlers()'));
  const cases = CHAT_QUALITY_CASES.filter(item => item.title.includes('Mermaid')).map(item => ({ malformed: item.title.startsWith('Malformed'), source: item.markdown.split('\n').slice(1, -1).join('\n') }));
  assert.equal(cases.length, 4);
  const nonce = randomUUID().replaceAll('-', '');
  const data = Buffer.from(JSON.stringify(cases)).toString('base64');
  const document = await browserDocument(`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><body><div id="result">pending</div><script nonce="${nonce}">${engine}</script><script nonce="${nonce}">(async()=>{mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'dark'});let ok=0;const cases=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('${data}'),c=>c.charCodeAt(0))));for(let i=0;i<cases.length;i++){try{const r=await mermaid.render('diagram-'+i,cases[i].source);if(!cases[i].malformed&&r.svg.includes('<svg'))ok++;}catch(_){if(cases[i].malformed)ok++;}}document.getElementById('result').textContent='completed:'+ok;document.querySelectorAll('script').forEach(s=>s.remove());})();</script>`);
  assert.match(document, /id="result">completed:4/u);
});
