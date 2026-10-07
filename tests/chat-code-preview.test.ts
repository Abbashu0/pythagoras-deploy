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
const fullscreen = read('ios/code/ENRMCodeFullscreenController.swift');
const gate = read('ios/code/ENRMCodeGestureGate.swift');

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
  assert.ok(view.includes('static NSString *const ENRMCodeCopySymbolName = @"square.on.square"'));
  assert.equal((view.match(/systemImageNamed:ENRMCodeCopySymbolName/gu) ?? []).length, 2);
  assert.ok(composer.includes("copied ? 'checkmark' : 'square.on.square'"));
  assert.ok(read('ios/utils/EditMenuUtils.m').includes('systemImageNamed:@"doc.on.doc"'));
  assert.ok(read('ios/views/TableContainerView.m').includes('systemImageNamed:@"doc.on.doc"'));
  assert.ok(read('ios/views/ENRMMathContainerView.m').includes('systemImageNamed:@"doc.on.doc"'));
});

test('header hierarchy and real native glass control preserve copy target and Source return geometry', () => {
  assert.ok(view.includes('_language.textColor = self.config.paragraphColor'));
  assert.match(fs.readFileSync('mobile/src/ai/assistant-enriched-markdown.ios.tsx', 'utf8'), /paragraph:\s*\{\s*color: palette\.text,/u);
  for (const snippet of ['UISegmentedControl', 'UIGlassEffect(style: .regular)', '#available(iOS 26.0, *)', 'UIBlurEffect(style: .systemThinMaterial)', 'isReduceTransparencyEnabled', 'chevron.left.forwardslash.chevron.right', 'play.fill', 'bounds.insetBy(dx: 0, dy: -4)']) assert.ok(preview.includes(snippet), snippet);
  assert.ok(view.includes('previewControlWidth = 88'));
  assert.ok(view.includes('44, MAX(44, headerHeight)'));
  assert.ok(view.includes('kCACornerCurveContinuous'));
  assert.equal(/setBackgroundImage|setDividerImage|selectedSegmentTintColor\s*=\s*\.clear/u.test(preview), false);
  assert.ok(preview.includes('selectedSegmentTintColor = selectedSurface')); // color UIKit's capsule, never replace it
  assert.ok(preview.includes('glass.isInteractive = false'));
  assert.equal(preview.includes('glass.isInteractive = true'), false);
  assert.ok(view.includes('CGFloat copySlot = 52'));
  assert.ok(view.includes('_copyButton.imageView.transform = CGAffineTransformMakeTranslation(1, 0)'));
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

test('short Source is intrinsic; long Source and Preview share a bounded visible-height contract', () => {
  const match = view.match(/return MAX\((\d+), MIN\((\d+), round\(width \* ([\d.]+)\)\)\)/u)!;
  const [low, high, ratio] = match.slice(1).map(Number);
  const cap = (width: number) => Math.max(low, Math.min(high, Math.round(width * ratio)));
  assert.deepEqual([cap(200), cap(350), cap(800)], [260, 298, 330]);
  const visible = (mode: string, measuredIntrinsic: number) => mode === 'Preview' ? cap(350) : Math.min(measuredIntrinsic, cap(350));
  assert.equal(visible('Source', 60), 60);
  for (const mode of ['Source', 'Preview', 'Source', 'Preview', 'Source']) assert.equal(44 + visible(mode, 5000), 342);
  const stress = CHAT_QUALITY_CASES.find(item => item.title.startsWith('Long Mermaid'))!;
  assert.ok(stress.markdown.split('\n').length > 120);
  assert.ok(stress.markdown.startsWith('```mermaid'));
  assert.ok(view.includes('return _previewing ? cap : MIN(_bodyHeight, cap)'));
  assert.ok(view.includes('CGFloat visibleBodyHeight = [self visibleBodyHeightForWidth:width]'));
  assert.ok(view.includes('_horizontalScroll.frame = CGRectMake(0, 0, width, visibleBodyHeight)'));
  assert.ok(view.includes('_horizontalScroll.contentSize = CGSizeMake(contentWidth, _bodyHeight)'));
  assert.ok(view.includes('contentWidth > width + 0.5 || verticalOverflow'));
  assert.ok(view.includes('_horizontalScroll.clipsToBounds = YES'));
  assert.ok(view.includes('MIN(MAX(0, offset.y), maximumY)'));
  assert.equal((view.match(/\[UIScrollView new\]/gu) ?? []).length, 1);
});

test('Preview surface starts below an unchanged header; native content cannot paint beyond Fabric bounds', () => {
  assert.ok(view.includes('_sourceSurface.frame = self.bounds'));
  assert.ok(view.includes('_sourceSurface.hidden = _previewing'));
  assert.ok(view.includes('_bodyContainer.frame = CGRectMake(0, headerHeight, width, visibleBodyHeight)'));
  assert.ok(view.includes('_previewController.view.frame = _bodyContainer.bounds'));
  assert.ok(view.includes('_bodyContainer.layer.cornerRadius = _previewing ? self.config.codeBlockBorderRadius : 0'));
  assert.ok(owner.includes('self.clipsToBounds = YES'));
  assert.ok(owner.includes('[self computeSegmentLayoutForWidth:self.bounds.size.width applyFrames:YES]'));
  assert.ok(owner.includes('return [view isKindOfClass:[ENRMCodeBlockContainerView class]]'));
  assert.match(fs.readFileSync('mobile/src/ai/assistant-enriched-markdown.ios.tsx', 'utf8'), /codeBlock:[\s\S]*?borderRadius: 21/u);
});

test('local viewport gate gives descendants priority over ancestor pans without cancelling WebKit/source touches', () => {
  for (const code of ['cancelsTouchesInView = false', 'shouldBeRequiredToFailBy', 'isAncestorScrollPan(otherGestureRecognizer)', 'if isAncestorScrollPan(otherGestureRecognizer) { return false }', 'otherView.isDescendant(of: viewport)', 'movementThreshold: CGFloat = 8', 'touched.count > 1', 'state == .possible ? .failed : .ended']) assert.ok(gate.includes(code), code);
  assert.equal(/scrollEnabled|isScrollEnabled|Timer|asyncAfter|runOnJS/u.test(gate), false);
  assert.ok(view.includes('_sourceGestureGate.enabled = !_previewing && verticalOverflow'));
  const scope = preview.slice(preview.indexOf('if !fullscreen {'), preview.indexOf('@objc public func prepareForPresentation'));
  assert.ok(scope.includes('if kind == "mermaid"'));
  assert.ok(scope.includes('let gate = ENRMCodeGestureGate(viewport: view)'));
  assert.ok(scope.includes('tap.require(toFail: gate)'));
  assert.ok(gate.includes('pan.require(toFail: self)'));
  assert.ok(gate.includes('boundAncestorPans.member(pan) == nil'));
  assert.ok(gate.includes('NSHashTable<UIGestureRecognizer>.weakObjects()'));
  assert.ok(gate.includes('guard isEnabled, let viewport = view, let touchedView = touch.view'));
  assert.ok(preview.includes('mermaidGate?.bindAncestorScrollViews()'));
  assert.ok(view.includes('if (self.window) [_sourceGestureGate bindAncestorScrollViews]'));
  assert.ok(scope.includes('let tap = UITapGestureRecognizer(target: self, action: #selector(openFullscreen))'));
  assert.ok(scope.includes('tap.numberOfTouchesRequired = 1'));
  assert.ok(scope.includes('tap.cancelsTouchesInView = false'));
  assert.ok(scope.includes('tap.delegate = self'));
  assert.ok(scope.includes('view.addGestureRecognizer(tap)'));
  assert.equal((preview.match(/UITapGestureRecognizer\(target:/gu) ?? []).length, 1);
  assert.equal(preview.includes(['allowable', 'Movement'].join('')), false);
  assert.ok(gate.includes('if state == .possible && touched.count > 1 { state = .began }'));
  assert.match(gate, /squareRoot\(\) >= movementThreshold \{\s*state = \.began/u);
  assert.ok(view.includes('if (!_previewing || !_previewLanguage || !self.window) return'));
});

test('Mermaid actual-render status is isolated, event-driven and fits only a fresh successful render', () => {
  assert.ok(preview.includes('minScale: 0.7, maxScale: 3.5'));
  assert.ok(preview.includes('minScale: 0.5, maxScale: 5'));
  assert.ok(preview.includes('controller: mermaidController'));
  const rendered = preview.slice(preview.indexOf('private func mermaidRendered()'), preview.indexOf('private func attachMermaidObservationIfNeeded()'));
  assert.ok(rendered.includes('loading.stopAnimating()')); assert.ok(rendered.includes('errorLabel.isHidden = true'));
  assert.ok(rendered.includes('if fitOnNextRender')); assert.ok(rendered.includes('fitOnNextRender = false'));
  assert.equal((preview.match(/mermaidController\.zoomToFit\(\)/gu) ?? []).length, 1);
  assert.ok(preview.includes('contentWorld: .defaultClient'));
  assert.ok(preview.includes('let status = message.body as? String'));
  assert.ok(preview.includes('case "rendered": onRendered?()'));
  assert.ok(preview.includes('case "interaction-began": onInteractionChanged?(true)'));
  assert.ok(preview.includes('case "interaction-ended": onInteractionChanged?(false)'));
  assert.ok(preview.includes('new MutationObserver(rendered)'));
  assert.ok(preview.includes('childList: true, subtree: true'));
  assert.equal(/attributes: true|setInterval|setTimeout/u.test(preview), false);
  assert.ok(preview.includes('upstream.webView?(webView, decidePolicyFor: navigationAction, decisionHandler: decisionHandler)'));
  assert.ok(preview.includes('else { decisionHandler(.cancel) }'));
  assert.ok(preview.includes('removeScriptMessageHandler(forName: Self.handler, contentWorld: .defaultClient)'));
});

test('late owned Mermaid WKWebView layout can attach once, replace safely and bootstrap an already rendered SVG', () => {
  const host = preview.slice(preview.indexOf('private final class ENRMMermaidHostingController'), preview.indexOf('/// One standard segmented control'));
  for (const hook of ['viewDidLayoutSubviews()', 'viewDidAppear(_ animated: Bool)', 'didMove(toParent parent: UIViewController?)', 'onOwnedLayout?()']) assert.ok(host.includes(hook));
  assert.ok(preview.includes('host.onOwnedLayout = { [weak self] in self?.attachMermaidObservationIfNeeded() }'));
  const attach = preview.slice(preview.indexOf('private func attachMermaidObservationIfNeeded()'), preview.indexOf('private static func ownedWebView'));
  assert.ok(attach.includes('Self.ownedWebView(in: host.view)'));
  assert.ok(attach.includes('if ownedWeb === observedMermaidWebView { return }'));
  assert.ok(attach.indexOf('mermaidObservation?.detach()') < attach.indexOf('mermaidObservation = ENRMMermaidObservation'));
  assert.equal(attach.includes('observedMermaidWebView == nil'), false);
  const layout = preview.slice(preview.indexOf('public override func viewDidLayoutSubviews()', preview.indexOf('public final class ENRMCodePreviewController')), preview.indexOf('@objc public func dispose()'));
  assert.equal(layout.includes('attachMermaidObservationIfNeeded()'), false);
  for (const text of ['host.onOwnedLayout = nil', 'bootstrap()', 'delete window.__pythagorasMermaidObserver', 'window.__pythagorasMermaidInteraction.dispose()', 'onRendered = nil', 'onInteractionChanged = nil']) assert.ok(preview.includes(text));
  assert.equal(/Timer|asyncAfter|setInterval|setTimeout/u.test(preview), false);
});

test('Mermaid success/error stop loading; fresh fit waits for rendering and an idle interaction', () => {
  const failure = preview.slice(preview.indexOf('private func showFailure()'), preview.indexOf('private func mermaidRendered()'));
  assert.ok(failure.includes('loading.stopAnimating()'));
  assert.ok(failure.includes('errorLabel.isHidden = false'));
  const fit = preview.slice(preview.indexOf('private func fitMermaidIfReady()'), preview.indexOf('private func attachMermaidObservationIfNeeded()'));
  assert.ok(fit.includes('guard !disposed, mermaidHasRendered, !mermaidInteractionActive else { return }'));
  assert.ok(fit.indexOf('fitOnNextRender = false') < fit.indexOf('mermaidController.zoomToFit()'));
  assert.ok(preview.includes('if !active { self?.fitMermaidIfReady() }'));
  assert.equal(failure.includes('error.localizedDescription'), false);
});

test('fullScreen uses an immutable exact source snapshot, native text segments and the shared secure preview', () => {
  assert.ok(fullscreen.includes('scroll.isDirectionalLockEnabled = true'));
  assert.equal(fullscreen.includes('scroll.directionalLockEnabled = true'), false);
  for (const code of ['modalPresentationStyle = .fullScreen', 'items: ["Code", "Preview"]', 'modes.selectedSegmentIndex = 1', 'systemName: "xmark"', 'width: 44, height: 44', 'content.fullscreen = true', 'ENRMCodePreviewController(kind: kind)', 'content.update(source: source.string', 'source.copy()', 'text.isSelectable = true', 'text.isScrollEnabled = false', 'text.textContainer.widthTracksTextView = false', 'text.textContainer.lineBreakMode = .byClipping', 'scroll.contentSize', 'ENRMSyntaxHighlighterBridge.requestColors(forSource: raw', 'textStorage.addAttribute(.foregroundColor']) assert.ok(fullscreen.includes(code), code);
  assert.equal(/WKWebViewConfiguration|loadHTMLString|loadFileURL|\.cdn\(|scrollTo|contentOffset\s*=|setTimeout|asyncAfter/u.test(fullscreen), false);
  assert.ok(fullscreen.includes('dismiss(animated: !UIAccessibility.isReduceMotionEnabled)'));
  assert.ok(fullscreen.includes('preview?.dispose()')); assert.ok(fullscreen.includes('preview?.removeFromParent()'));
  assert.ok(view.includes('initWithSource:[_codeView.attributedText copy]'));
});

test('manual reserve release reaches growth, terminal and gesture-end callers without new scroll writes', () => {
  const update = composer.slice(composer.indexOf('const updateAnchorBlankSpace'), composer.indexOf('const tryPositionPendingAnchor'));
  assert.equal(update.includes("if (!state.anchorTurnId || state.mode === 'user-scrolled-away') return"), false);
  assert.equal(/scrollTo|setTimeout|requestAnimationFrame/u.test(update), false);
  const end = composer.slice(composer.indexOf('const handleScrollEndDrag'), composer.indexOf('const handleEndVisible'));
  assert.equal((end.match(/updateAnchorBlankSpace\(\)/gu) ?? []).length, 2);
  const terminal = composer.slice(composer.indexOf('// Completion only validates capacity'), composer.indexOf('  return (', composer.indexOf('// Completion only validates capacity')));
  assert.ok(terminal.includes('updateAnchorBlankSpace()'));
  assert.equal(/scrollTo|setTimeout/u.test(terminal), false);
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
  const cases = CHAT_QUALITY_CASES.filter(item => item.title.startsWith('Mermaid ') || item.title.startsWith('Malformed Mermaid')).map(item => ({ malformed: item.title.startsWith('Malformed'), source: item.markdown.split('\n').slice(1, -1).join('\n') }));
  assert.equal(cases.length, 4);
  const nonce = randomUUID().replaceAll('-', '');
  const data = Buffer.from(JSON.stringify(cases)).toString('base64');
  const observer = preview.match(/private static let script = #"""([\s\S]*?)"""#/u)![1];
  const document = await browserDocument(`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><body><div id="result">pending</div><div id="container"></div><script nonce="${nonce}">${engine}</script><script nonce="${nonce}">window.renderStatuses=[];window.webkit={messageHandlers:{pythagorasMermaidRendered:{postMessage:m=>window.renderStatuses.push(m)}}};${observer}
(async()=>{mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'dark'});let ok=0;const cases=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('${data}'),c=>c.charCodeAt(0))));for(let i=0;i<cases.length;i++){try{const r=await mermaid.render('diagram-'+i,cases[i].source);if(!cases[i].malformed&&r.svg.includes('<svg')){ok++;document.getElementById('container').innerHTML=r.svg;await Promise.resolve();}}catch(_){if(cases[i].malformed)ok++;}}const svg=document.querySelector('#container svg');svg.style.transform='scale(1.1)';await Promise.resolve();const safe=window.renderStatuses.every(m=>m==='rendered');document.getElementById('result').textContent='completed:'+ok+':rendered:'+window.renderStatuses.length+':safe:'+safe;document.querySelectorAll('script').forEach(s=>s.remove());})();</script>`);
  assert.match(document, /id="result">completed:4:rendered:3:safe:true/u);
});

test('browser oracle: late SVG bootstrap, idempotent observation and replacement teardown deliver only fixed status', { skip: !chrome && 'Set PYTHAGORAS_PREVIEW_CHROME.' }, async () => {
  const observer = preview.match(/private static let script = #"""([\s\S]*?)"""#/u)![1];
  const nonce = randomUUID().replaceAll('-', '');
  const document = await browserDocument(`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'none'"><div id="result">pending</div><div id="container"><svg xmlns="http://www.w3.org/2000/svg"></svg></div><script nonce="${nonce}">window.renderStatuses=[];window.webkit={messageHandlers:{pythagorasMermaidRendered:{postMessage:m=>window.renderStatuses.push(m)}}};function bootstrap(){${observer}}
(async()=>{bootstrap();bootstrap();if(renderStatuses.length!==1)throw Error('late/idempotent bootstrap');window.__pythagorasMermaidObserver.disconnect();delete window.__pythagorasMermaidObserver;document.getElementById('container').innerHTML='<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';await Promise.resolve();if(renderStatuses.length!==1)throw Error('detached observer retained');bootstrap();if(renderStatuses.length!==2||!renderStatuses.every(v=>v==='rendered'))throw Error('replacement bootstrap');document.getElementById('result').textContent='late:1:replacement:1:quiet:true';})();</script>`);
  assert.match(document, /id="result">late:1:replacement:1:quiet:true/u);
});

test('browser oracle: owned correction intercepts pinned Mermaid handlers and keeps pinch/pan/clamps continuous', { skip: !(auditRoot && chrome) && 'Set PYTHAGORAS_MERMAID_AUDIT_ROOT and PYTHAGORAS_PREVIEW_CHROME.' }, async () => {
  const builder = fs.readFileSync(path.join(auditRoot!, 'Sources/MermaidKit/MermaidHTMLBuilder.swift'), 'utf8');
  const upstream = builder.slice(builder.indexOf('function setupGesturesOnce()'), builder.indexOf('// ---- Render lifecycle ----'));
  assert.ok(upstream.includes('k = ns / scale'));
  assert.ok(upstream.includes('tx = mX - (mX - tx) * k'));
  const script = preview.match(/private static let interactionScript = #"""([\s\S]*?)"""#/u)![1];
  for (const [minimum, maximum] of [[0.5, 5], [0.7, 3.5]]) {
    const interaction = script.replaceAll('__ENRM_MIN_SCALE__', String(minimum)).replaceAll('__ENRM_MAX_SCALE__', String(maximum));
    const nonce = randomUUID().replaceAll('-', '');
    const document = await browserDocument(`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'none'"><style>#viewport{position:relative;width:350px;height:298px}#stage{transform-origin:0 0}</style><div id="result">pending</div><div id="viewport"><div id="stage"><div id="container"><svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"></svg></div></div></div><script nonce="${nonce}">
window.renderStatuses=[];window.webkit={messageHandlers:{pythagorasMermaidRendered:{postMessage:m=>window.renderStatuses.push(m)}}};var scale=1,tx=20,ty=30,stage,viewport,gesturesReady=false,INTERACTIVE=true,TAPS=false,MINS=${minimum},MAXS=${maximum};function clampS(s){return Math.min(MAXS,Math.max(MINS,s));}function applyTransform(){stage.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')';}function hitTest(){};const surface=document.getElementById('viewport');surface.setPointerCapture=()=>{};surface.releasePointerCapture=()=>{};${upstream}
setupGesturesOnce();let upstreamMoves=0;surface.addEventListener('pointermove',()=>upstreamMoves++);function install(){${interaction}}
const matrix=()=>{const m=new DOMMatrixReadOnly(getComputedStyle(stage).transform);return{s:m.a,x:m.e,y:m.f};};const near=(a,b)=>{if(Math.abs(a-b)>0.001)throw Error('transform discontinuity '+a+' vs '+b);};function pointer(type,id,x,y){const r=surface.getBoundingClientRect();surface.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',clientX:r.left+x,clientY:r.top+y,bubbles:true,cancelable:true,buttons:type==='pointerup'?0:1}));}function seed(s,x,y){stage.style.transform='translate('+x+'px,'+y+'px) scale('+s+')';}function start(){pointer('pointerdown',1,50,100);pointer('pointerdown',2,150,100);}function end(){pointer('pointerup',2,200,130);pointer('pointerup',1,40,110);}install();install();
seed(1,20,30);start();pointer('pointermove',1,40,110);pointer('pointermove',2,200,130);const first=matrix(),ratio=Math.hypot(160,20)/100;near(first.s,ratio);near(first.x,120-(100-20)*ratio);near(first.y,120-(100-30)*ratio);pointer('pointermove',2,200,130);const repeat=matrix();near(repeat.x,first.x);near(repeat.y,first.y);pointer('pointerup',2,200,130);pointer('pointermove',1,43,114);const pan=matrix();near(pan.x,first.x+3);near(pan.y,first.y+4);near(pan.s,first.s);pointer('pointerup',1,43,114);
seed(1,20,30);start();pointer('pointermove',1,-200,50);pointer('pointermove',2,500,50);near(matrix().s,MAXS);pointer('pointermove',1,40,110);pointer('pointermove',2,200,130);const alternative=matrix();near(alternative.x,first.x);near(alternative.y,first.y);near(alternative.s,first.s);pointer('pointermove',2,40,110);near(matrix().s,MINS);end();
seed(1.3,17,29);start();pointer('pointermove',1,0,100);pointer('pointermove',2,200,100);const fit=matrix();near(fit.s,2.6);near(fit.x,100-(100-17)*2);near(fit.y,100-(100-29)*2);end();
const beforeTapStatuses=renderStatuses.length;seed(1,0,0);pointer('pointerdown',1,50,50);pointer('pointermove',1,52,53);pointer('pointerup',1,52,53);near(matrix().x,0);near(matrix().y,0);if(renderStatuses.length-beforeTapStatuses!==2||upstreamMoves!==0)throw Error('tap/idempotent/native capture');if(!renderStatuses.every(v=>v==='interaction-began'||v==='interaction-ended'))throw Error('raw status');window.__pythagorasMermaidInteraction.dispose();pointer('pointerdown',1,50,50);pointer('pointermove',1,100,100);pointer('pointerup',1,100,100);if(upstreamMoves!==1)throw Error('teardown did not restore upstream');document.getElementById('result').textContent='immutable:yes:midpoint:yes:rebase:yes:clamps:yes:fit:yes:tap:yes:capture:yes:teardown:yes';</script>`);
    assert.match(document, /id="result">immutable:yes:midpoint:yes:rebase:yes:clamps:yes:fit:yes:tap:yes:capture:yes:teardown:yes/u);
  }
});
