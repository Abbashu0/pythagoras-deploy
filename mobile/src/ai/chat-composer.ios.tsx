import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentRef,
  type RefObject,
} from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  AccessibilityInfo,
  Keyboard,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeTouchEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  KeyboardChatScrollView,
  KeyboardStickyView,
} from 'react-native-keyboard-controller';
import { useSharedValue } from 'react-native-reanimated';
import {
  Button,
  Circle,
  HStack,
  Host,
  Image,
  Rectangle,
  Spacer,
  Text,
  TextField,
  type TextFieldRef,
  VStack,
  ZStack,
  useNativeState,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  animation,
  Animation,
  background,
  containerRelativeFrame,
  buttonStyle,
  contentShape,
  disabled,
  fixedSize,
  font,
  frame,
  foregroundStyle,
  glassEffect,
  lineSpacing,
  lineLimit,
  multilineTextAlignment,
  onGeometryChange,
  onTapGesture,
  onAppear,
  opacity,
  padding,
  shapes,
  strokeBorder,
  textSelection,
  textFieldStyle,
} from '@expo/ui/swift-ui/modifiers';
import { getAgent1AssistantActionPolicy, toggleChatReaction } from './agent-1-chat-state';
import { Agent1ChatStreamStore, agent1ChatStreamKey } from './agent-1-chat-stream-store';
import {
  projectAgent1ChatRows,
  type Agent1ChatRenderRow,
} from './agent-1-chat-presentation';
import {
  beginChatTranscriptTurn,
  beginChatTranscriptUserDrag,
  calculateChatTranscriptAnchorBlankSpace,
  createChatTranscriptScrollState,
  positionChatTranscriptTurn,
  shouldFollowChatTranscript,
  shouldRecalculateChatAnchorSpace,
  updateChatTranscriptEndVisibility,
  type ChatTranscriptScrollState,
} from './chat-transcript-scroll-state';
import type { ChatComposerProps, ChatReaction, ChatTurn } from './chat-types';
import Agent1AssistantMarkdown from './assistant-enriched-markdown.ios';
import { firstStrongTextDirection } from './rich-response/text-direction';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const COMPOSER_MIN_HEIGHT = 94;
const COMPOSER_CORNER_RADIUS = 28;
const ACTION_BUTTON_DIAMETER = 36;
const ACTION_BUTTON_HIT_TARGET = 44;
const ACTION_ROW_BOTTOM_INSET = 5;
const COMPOSER_TEXT_FIELD_MIN_HEIGHT =
  COMPOSER_MIN_HEIGHT - ACTION_BUTTON_HIT_TARGET - ACTION_ROW_BOTTOM_INSET;
const CHAT_BUBBLE_CORNER_RADIUS = 24;
const TRANSCRIPT_HORIZONTAL_INSET = 22;
const CHAT_TURN_SPACING = 28;
const CHAT_TURN_CONTENT_SPACING = 10;
const USER_TO_ASSISTANT_GAP = 26;
const COPY_FEEDBACK_DURATION_MS = 1_300;
const CHAT_TOP_CONTROLS_HEIGHT = 44;
const CHAT_TRANSCRIPT_TOP_GAP = 20;
const CHAT_TRANSCRIPT_COMPOSER_GAP = 24;
const COMPOSER_BOTTOM_PADDING = 10;
const ASSISTANT_ACTION_LAYOUT_SIZE = 32;
const ASSISTANT_ACTION_ICON_SIZE = 17;
const ASSISTANT_ACTION_SPACING = 3;
const STATUS_SWEEP_HALF_CYCLE_MS = 700;
const STATUS_SWEEP_TRANSITION_SECONDS = 0.65;
const STATUS_SWEEP_WIDTH = 0.4;
const styles = StyleSheet.create({
  composerSticky: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
  },
});

type ChatLayoutDiagnosticValues = Record<
  string,
  string | number | boolean | null
>;
type ChatLayoutDiagnostic = (
  event: string,
  values: ChatLayoutDiagnosticValues,
) => void;
type ChatScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;
type TranscriptTouch = Pick<NativeTouchEvent, 'pageX' | 'pageY'> & { at: number };

export function ChatComposer({
  turns,
  streamStore,
  onSend,
  onRegenerate,
  activeTurnId,
  submissionError,
  transcriptWidth,
  layoutDiagnosticsEnabled = false,
}: ChatComposerProps) {
  const { resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const insets = useSafeAreaInsets();
  const transcriptTopPadding =
    insets.top + CHAT_TOP_CONTROLS_HEIGHT + CHAT_TRANSCRIPT_TOP_GAP;
  const transcriptContentWidth = Math.max(
    0,
    transcriptWidth - TRANSCRIPT_HORIZONTAL_INSET * 2,
  );
  const message = useNativeState('');
  const transcriptScrollRef = useRef<ComponentRef<typeof KeyboardChatScrollView> | null>(null);
  const blankSpace = useSharedValue(0);
  const composerScrollInset = useSharedValue(
    COMPOSER_MIN_HEIGHT + COMPOSER_BOTTOM_PADDING + insets.bottom,
  );
  const blankSpaceRef = useRef(0);
  const composerHostHeightRef = useRef(COMPOSER_MIN_HEIGHT + COMPOSER_BOTTOM_PADDING);
  const composerHeightRef = useRef(
    COMPOSER_MIN_HEIGHT + COMPOSER_BOTTOM_PADDING + insets.bottom,
  );
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const keyboardInsetBottomRef = useRef(0);
  const anchorTargetOffsetRef = useRef<number | null>(null);
  const scrollStateRef = useRef<ChatTranscriptScrollState>(createChatTranscriptScrollState());
  const manualScrollGestureRef = useRef(false);
  const activeTurnIdRef = useRef(activeTurnId);
  const activeTurnStatusRef = useRef<ChatTurn['assistantStatus']>(null);
  const textFieldRef = useRef<TextFieldRef | null>(null);
  const draftRef = useRef('');
  const transcriptTouchRef = useRef<TranscriptTouch | null>(null);
  const transcriptTouchMovedRef = useRef(false);
  const lastActiveAssistantLayoutRef = useRef<{ key: string; height: number } | null>(null);
  const copyFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousLatestAttemptRef = useRef<{ turnId: string; attempt: number } | null>(null);
  const [hasSendableText, setHasSendableText] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Record<string, ChatReaction>>({});
  const latestTurn = turns[turns.length - 1];
  const latestTurnId = latestTurn?.id ?? null;
  const latestAssistantAttempt = latestTurn?.assistantAttempt ?? null;
  const transcriptRows = useMemo(() => projectAgent1ChatRows(turns), [turns]);

  useLayoutEffect(() => {
    activeTurnIdRef.current = activeTurnId;
    activeTurnStatusRef.current =
      turns.find((turn) => turn.id === activeTurnId)?.assistantStatus ?? null;
  }, [activeTurnId, turns]);

  useEffect(() => {
    composerHeightRef.current = composerHostHeightRef.current + insets.bottom;
    composerScrollInset.set(composerHeightRef.current);
  }, [composerScrollInset, insets.bottom]);
  const reportLayoutDiagnostic = useCallback<ChatLayoutDiagnostic>(
    (event, values) => {
      if (!__DEV__ || !layoutDiagnosticsEnabled) return;
      console.info('[Chat layout diagnostics]', {
        at: Date.now(),
        event,
        scrollOffsetY: scrollOffsetRef.current,
        scrollMode: scrollStateRef.current.mode,
        anchorTurnId: scrollStateRef.current.anchorTurnId,
        latestTurnId,
        activeTurnId,
        contentHeight: contentHeightRef.current,
        viewportHeight: viewportHeightRef.current,
        composerHeight: composerHeightRef.current,
        composerHostHeight: composerHostHeightRef.current,
        composerScrollInset: composerHeightRef.current,
        safeAreaTop: insets.top,
        safeAreaBottom: insets.bottom,
        transcriptTopPadding,
        transcriptWidth,
        transcriptContentWidth,
        blankSpace: blankSpaceRef.current,
        ...values,
      });
    },
    [
      activeTurnId,
      insets.bottom,
      insets.top,
      latestTurnId,
      layoutDiagnosticsEnabled,
      transcriptContentWidth,
      transcriptTopPadding,
      transcriptWidth,
    ],
  );

  const setScrollState = useCallback((
    next: ChatTranscriptScrollState,
    reason: string,
  ) => {
    const previous = scrollStateRef.current;
    if (previous === next) return;
    scrollStateRef.current = next;
    if (previous.mode !== next.mode || previous.anchorTurnId !== next.anchorTurnId) {
      reportLayoutDiagnostic('scroll-policy-transition', {
        reason,
        previousMode: previous.mode,
        nextMode: next.mode,
        nextAnchorTurnId: next.anchorTurnId,
      });
    }
  }, [reportLayoutDiagnostic]);

  const liveStreamActive = useCallback(() => {
    const status = activeTurnStatusRef.current;
    return activeTurnIdRef.current !== null &&
      status !== 'completed' && status !== 'incomplete' && status !== 'error';
  }, []);
  const updateAnchorBlankSpace = useCallback(() => {
    const state = scrollStateRef.current;
    if (!shouldRecalculateChatAnchorSpace(state, liveStreamActive())) return;
    const targetOffset = anchorTargetOffsetRef.current;
    if (targetOffset === null || viewportHeightRef.current <= 0) return;
    const nextBlankSpace = calculateChatTranscriptAnchorBlankSpace(
      targetOffset,
      contentHeightRef.current,
      viewportHeightRef.current,
    );
    if (Math.abs(blankSpaceRef.current - nextBlankSpace) < 1) return;
    blankSpaceRef.current = nextBlankSpace;
    blankSpace.set(nextBlankSpace);
  }, [blankSpace, liveStreamActive]);

  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
    void textFieldRef.current?.blur();
  }, []);
  const focusTextField = useCallback(() => {
    reportLayoutDiagnostic('composer-focus-request', { activeTurnId });
    void textFieldRef.current?.focus();
  }, [activeTurnId, reportLayoutDiagnostic]);
  const handleComposerHeightChange = useCallback((nextHeight: number) => {
    if (nextHeight <= 0 || Math.abs(composerHostHeightRef.current - nextHeight) < 0.5) return;
    composerHostHeightRef.current = nextHeight;
    composerHeightRef.current = nextHeight + insets.bottom;
    composerScrollInset.set(composerHeightRef.current);
    reportLayoutDiagnostic('composer-layout', {
      composerHeight: composerHeightRef.current,
      composerHostHeight: nextHeight,
      composerScrollInset: composerHeightRef.current,
    });
  }, [composerScrollInset, insets.bottom, reportLayoutDiagnostic]);
  const handleRootLayout = useCallback((event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    reportLayoutDiagnostic('chat-root-layout', { x, y, width, height });
  }, [reportLayoutDiagnostic]);
  const handleViewportLayout = useCallback((event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    viewportHeightRef.current = height;
    updateAnchorBlankSpace();
    reportLayoutDiagnostic('transcript-viewport-layout', { x, y, width, height });
  }, [reportLayoutDiagnostic, updateAnchorBlankSpace]);
  const handleScroll = useCallback((event: ChatScrollEvent) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    scrollOffsetRef.current = contentOffset.y;
    if (!layoutDiagnosticsEnabled) return;
    reportLayoutDiagnostic('transcript-scroll', {
      offsetY: contentOffset.y,
      contentWidth: contentSize.width,
      nativeContentHeight: contentSize.height,
      viewportWidth: layoutMeasurement.width,
      viewportHeight: layoutMeasurement.height,
    });
  }, [layoutDiagnosticsEnabled, reportLayoutDiagnostic]);
  const handleScrollBeginDrag = useCallback(() => {
    manualScrollGestureRef.current = true;
    transcriptTouchMovedRef.current = true;
    setScrollState(
      beginChatTranscriptUserDrag(scrollStateRef.current),
      'manual-drag-began',
    );
    reportLayoutDiagnostic('manual-scroll-begin', {});
  }, [reportLayoutDiagnostic, setScrollState]);
  const handleScrollEndDrag = useCallback(() => {
    manualScrollGestureRef.current = false;
    reportLayoutDiagnostic('manual-scroll-end-drag', {});
  }, [reportLayoutDiagnostic]);
  const handleMomentumScrollBegin = useCallback(() => {
    manualScrollGestureRef.current = true;
  }, []);
  const handleMomentumScrollEnd = useCallback(() => {
    manualScrollGestureRef.current = false;
    reportLayoutDiagnostic('manual-scroll-momentum-end', {});
  }, [reportLayoutDiagnostic]);
  const handleEndVisible = useCallback((visible: boolean) => {
    setScrollState(
      updateChatTranscriptEndVisibility(
        scrollStateRef.current,
        visible,
        manualScrollGestureRef.current,
      ),
      visible ? 'user-returned-to-end' : 'end-left-viewport',
    );
    if (visible) updateAnchorBlankSpace();
    reportLayoutDiagnostic('transcript-end-visibility', { visible });
  }, [reportLayoutDiagnostic, setScrollState, updateAnchorBlankSpace]);
  const handleContentSizeChange = useCallback((width: number, height: number) => {
    contentHeightRef.current = height;
    updateAnchorBlankSpace();
    reportLayoutDiagnostic('transcript-content-size', { width, height });
  }, [reportLayoutDiagnostic, updateAnchorBlankSpace]);
  const handleUserRowLayout = useCallback((
    turnId: string,
    layoutY: number,
    height: number,
  ) => {
    reportLayoutDiagnostic('user-message-row-layout', {
      turnId,
      y: layoutY,
      height,
      visibleY: layoutY - scrollOffsetRef.current,
    });
    if (
      scrollStateRef.current.mode !== 'anchoring-new-turn' ||
      scrollStateRef.current.anchorTurnId !== turnId ||
      transcriptContentWidth <= 0
    ) {
      return;
    }
    const targetOffset = Math.max(0, layoutY - transcriptTopPadding);
    anchorTargetOffsetRef.current = targetOffset;
    updateAnchorBlankSpace();
    setScrollState(
      positionChatTranscriptTurn(scrollStateRef.current, turnId),
      'new-user-row-laid-out',
    );
    transcriptScrollRef.current?.scrollTo({ y: targetOffset, animated: true });
    reportLayoutDiagnostic('new-turn-positioned', { turnId, targetOffsetY: targetOffset });
  }, [
    reportLayoutDiagnostic,
    setScrollState,
    transcriptContentWidth,
    transcriptTopPadding,
    updateAnchorBlankSpace,
  ]);
  const handleAssistantRowLayout = useCallback((
    streamKey: string,
    turnId: string,
    event: LayoutChangeEvent,
    streaming: boolean,
  ) => {
    const { y, height } = event.nativeEvent.layout;
    reportLayoutDiagnostic('assistant-message-row-layout', {
      turnId,
      y,
      height,
      visibleY: y - scrollOffsetRef.current,
      streaming,
    });
    if (activeTurnIdRef.current !== turnId) return;
    const previous = lastActiveAssistantLayoutRef.current;
    lastActiveAssistantLayoutRef.current = { key: streamKey, height };
    if (
      !streaming ||
      activeTurnIdRef.current !== turnId ||
      !shouldFollowChatTranscript(scrollStateRef.current) ||
      (previous?.key === streamKey && Math.abs(previous.height - height) < 0.5)
    ) {
      return;
    }
    // Only the active assistant row's measured height can move a following reader.
    transcriptScrollRef.current?.scrollToEnd({ animated: false });
  }, [reportLayoutDiagnostic]);
  const handleTextChange = useCallback((text: string) => {
    draftRef.current = text;
    setHasSendableText(text.trim().length > 0);
  }, []);
  const handleSend = useCallback(() => {
    const text = draftRef.current;
    if (!text.trim() || activeTurnId) return;
    const acceptedTurnId = onSend(text);
    if (acceptedTurnId) {
      anchorTargetOffsetRef.current = null;
      setScrollState(
        beginChatTranscriptTurn(scrollStateRef.current, acceptedTurnId, turns.length > 0),
        'new-turn-accepted',
      );
      if (turns.length > 0) {
        const initialAnchorSpace = viewportHeightRef.current;
        blankSpaceRef.current = initialAnchorSpace;
        blankSpace.set(initialAnchorSpace);
        reportLayoutDiagnostic('new-turn-accepted', {
          turnId: acceptedTurnId,
          initialAnchorSpace,
        });
      }
      draftRef.current = '';
      message.set('');
      setHasSendableText(false);
    }
  }, [
    activeTurnId,
    blankSpace,
    message,
    onSend,
    reportLayoutDiagnostic,
    setScrollState,
    turns.length,
  ]);
  const handleTranscriptTouchStart = useCallback((event: NativeSyntheticEvent<NativeTouchEvent>) => {
    const { pageX, pageY } = event.nativeEvent;
    transcriptTouchRef.current = { pageX, pageY, at: Date.now() };
    transcriptTouchMovedRef.current = false;
  }, []);
  const handleTranscriptTouchMove = useCallback((event: NativeSyntheticEvent<NativeTouchEvent>) => {
    const start = transcriptTouchRef.current;
    if (!start) return;
    const { pageX, pageY } = event.nativeEvent;
    if (Math.abs(pageX - start.pageX) > 8 || Math.abs(pageY - start.pageY) > 8) {
      transcriptTouchMovedRef.current = true;
    }
  }, []);
  const handleTranscriptTouchEnd = useCallback(() => {
    const start = transcriptTouchRef.current;
    if (start && !transcriptTouchMovedRef.current && Date.now() - start.at < 350) {
      dismissKeyboard();
    }
    transcriptTouchRef.current = null;
    transcriptTouchMovedRef.current = false;
  }, [dismissKeyboard]);
  const handleTranscriptTouchCancel = useCallback(() => {
    transcriptTouchRef.current = null;
    transcriptTouchMovedRef.current = false;
  }, []);

  useEffect(() => {
    const previous = previousLatestAttemptRef.current;
    if (
      previous &&
      latestTurnId === previous.turnId &&
      latestAssistantAttempt !== null &&
      latestAssistantAttempt > previous.attempt
    ) {
      const previousAssistantId = `${previous.turnId}-assistant-${previous.attempt}`;
      setReactions((current) => {
        if (!(previousAssistantId in current)) return current;
        const next = { ...current };
        delete next[previousAssistantId];
        return next;
      });
      setCopiedMessageId((current) => current === previousAssistantId ? null : current);
    }
    previousLatestAttemptRef.current =
      latestTurnId !== null && latestAssistantAttempt !== null
        ? { turnId: latestTurnId, attempt: latestAssistantAttempt }
        : null;
  }, [latestAssistantAttempt, latestTurnId]);

  useEffect(() => () => {
    if (copyFeedbackTimeoutRef.current) clearTimeout(copyFeedbackTimeoutRef.current);
  }, []);

  const handleCopy = useCallback(async (messageId: string, content: string) => {
    try {
      const copiedSuccessfully = await Clipboard.setStringAsync(content);
      if (!copiedSuccessfully) return;
      setCopiedMessageId(messageId);
      if (copyFeedbackTimeoutRef.current) clearTimeout(copyFeedbackTimeoutRef.current);
      copyFeedbackTimeoutRef.current = setTimeout(() => {
        setCopiedMessageId((current) => current === messageId ? null : current);
        copyFeedbackTimeoutRef.current = null;
      }, COPY_FEEDBACK_DURATION_MS);
    } catch {
      setCopiedMessageId(null);
    }
  }, []);

  const handleReaction = useCallback((messageId: string, reaction: ChatReaction) => {
    setReactions((current) => {
      const nextReaction = toggleChatReaction(current[messageId], reaction);
      if (!nextReaction) {
        const next = { ...current };
        delete next[messageId];
        return next;
      }
      return { ...current, [messageId]: nextReaction };
    });
  }, []);

  const handleContentInsetChange = useCallback((contentInset: { top: number; bottom: number; left: number; right: number }) => {
    if (!layoutDiagnosticsEnabled) return;
    const previousBottom = keyboardInsetBottomRef.current;
    keyboardInsetBottomRef.current = contentInset.bottom;
    if (contentInset.bottom !== 0 && Math.abs(contentInset.bottom - previousBottom) < 48) return;
    reportLayoutDiagnostic('keyboard-content-inset', {
      top: contentInset.top,
      bottom: contentInset.bottom,
      left: contentInset.left,
      right: contentInset.right,
    });
  }, [layoutDiagnosticsEnabled, reportLayoutDiagnostic]);

  return (
    <View
      onLayout={layoutDiagnosticsEnabled ? handleRootLayout : undefined}
      style={{ flex: 1, backgroundColor: palette.background }}
    >
      <KeyboardChatScrollView
        ref={transcriptScrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: transcriptTopPadding,
          paddingHorizontal: TRANSCRIPT_HORIZONTAL_INSET,
          paddingBottom: CHAT_TRANSCRIPT_COMPOSER_GAP,
        }}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode={process.env.EXPO_OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        keyboardLiftBehavior="never"
        offset={insets.bottom}
        extraContentPadding={composerScrollInset}
        blankSpace={blankSpace}
        // Stable row order lets iOS preserve the visible row when older native Markdown remeasures.
        maintainVisibleContentPosition={
          process.env.EXPO_OS === 'ios' ? { minIndexForVisible: 0 } : undefined
        }
        applyWorkaroundForContentInsetHitTestBug={process.env.EXPO_OS === 'ios'}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        onLayout={handleViewportLayout}
        onContentSizeChange={handleContentSizeChange}
        onContentInsetChange={layoutDiagnosticsEnabled ? handleContentInsetChange : undefined}
        onEndVisible={handleEndVisible}
        onScroll={layoutDiagnosticsEnabled ? handleScroll : undefined}
        scrollEventThrottle={layoutDiagnosticsEnabled ? 100 : undefined}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollBegin={handleMomentumScrollBegin}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        onTouchStart={handleTranscriptTouchStart}
        onTouchMove={handleTranscriptTouchMove}
        onTouchEnd={handleTranscriptTouchEnd}
        onTouchCancel={handleTranscriptTouchCancel}
      >
        {transcriptRows.map((row: Agent1ChatRenderRow, index) => (
          <Fragment key={row.key}>
            {row.type === 'user-message' ? (
              <ChatUserMessageRow
                message={row.message}
                turnId={row.turnId}
                contentWidth={transcriptContentWidth}
                colorScheme={resolvedColorScheme}
                palette={palette}
                diagnosticsEnabled={layoutDiagnosticsEnabled}
                onLayoutDiagnostic={reportLayoutDiagnostic}
                onLayout={handleUserRowLayout}
              />
            ) : (
              <ChatAssistantMessageRow
                turn={row.turn}
                isLatest={index === transcriptRows.length - 1}
                isActive={activeTurnId === row.turn.id}
                contentWidth={transcriptContentWidth}
                colorScheme={resolvedColorScheme}
                palette={palette}
                streamStore={streamStore}
                reaction={row.turn.assistant ? reactions[row.turn.assistant.id] : undefined}
                copied={row.turn.assistant?.id === copiedMessageId}
                diagnosticsEnabled={layoutDiagnosticsEnabled &&
                  (index >= transcriptRows.length - 2 || activeTurnId === row.turn.id)}
                onLayout={handleAssistantRowLayout}
                onLayoutDiagnostic={reportLayoutDiagnostic}
                onCopy={handleCopy}
                onReaction={handleReaction}
                onRegenerate={onRegenerate}
              />
            )}
          </Fragment>
        ))}
        {submissionError ? (
          <View style={{ marginTop: turns.length > 0 ? CHAT_TURN_SPACING : 0 }}>
            <Host
              colorScheme={resolvedColorScheme}
              layoutDirection="leftToRight"
              matchContents={{ vertical: true, horizontal: false }}
              style={{ width: transcriptContentWidth }}
            >
              <ChatInlineNotice
                message={submissionError}
                contentWidth={transcriptContentWidth}
                palette={palette}
              />
            </Host>
          </View>
        ) : null}
      </KeyboardChatScrollView>

      <KeyboardStickyView
        pointerEvents="box-none"
        style={styles.composerSticky}
        offset={{ closed: -insets.bottom, opened: 0 }}
      >
        <Host
          colorScheme={resolvedColorScheme}
          layoutDirection="leftToRight"
          ignoreSafeArea="all"
          matchContents={{ vertical: true, horizontal: false }}
          pointerEvents="box-none"
          style={{ width: '100%' }}
        >
          <ChatComposerControls
            message={message}
            textFieldRef={textFieldRef}
            palette={palette}
            onComposerHeightChange={handleComposerHeightChange}
            hasSendableText={hasSendableText}
            sendDisabled={activeTurnId !== null}
            onTextChange={handleTextChange}
            onFocus={focusTextField}
            onSend={handleSend}
          />
        </Host>
      </KeyboardStickyView>
    </View>
  );
}

const ChatComposerControls = memo(function ChatComposerControls({
  message,
  textFieldRef,
  palette,
  onComposerHeightChange,
  hasSendableText,
  sendDisabled,
  onTextChange,
  onFocus,
  onSend,
}: {
  message: ReturnType<typeof useNativeState<string>>;
  textFieldRef: RefObject<TextFieldRef | null>;
  palette: ReturnType<typeof getPalette>;
  onComposerHeightChange: (height: number) => void;
  hasSendableText: boolean;
  sendDisabled: boolean;
  onTextChange: (text: string) => void;
  onFocus: () => void;
  onSend: () => void;
}) {
  return (
    <VStack
      alignment="leading"
      spacing={0}
      modifiers={[
        padding({ horizontal: 16, bottom: COMPOSER_BOTTOM_PADDING }),
        containerRelativeFrame({ axes: 'horizontal' }),
        onGeometryChange(({ height }) => onComposerHeightChange(height)),
      ]}
    >
      <ZStack
        alignment="topLeading"
        modifiers={[
          fixedSize({ horizontal: false, vertical: true }),
          frame({ minHeight: COMPOSER_MIN_HEIGHT, alignment: 'topLeading' }),
          glassEffect({
            glass: { variant: 'regular', interactive: true, tint: palette.surface },
            shape: 'roundedRectangle',
            cornerRadius: COMPOSER_CORNER_RADIUS,
          }),
        ]}
      >
        <Rectangle
          modifiers={[
            foregroundStyle('clear'),
            frame({ minHeight: COMPOSER_MIN_HEIGHT, alignment: 'topLeading' }),
            contentShape(shapes.rectangle()),
            onTapGesture(onFocus),
          ]}
        />
        <VStack alignment="leading" spacing={0}>
          <TextField
            ref={textFieldRef}
            axis="vertical"
            text={message}
            onTextChange={onTextChange}
            modifiers={[
              textFieldStyle('plain'),
              lineLimit({ min: 1, max: 5 }),
              fixedSize({ horizontal: false, vertical: true }),
              multilineTextAlignment('trailing'),
              font({ textStyle: 'body' }),
              padding({ top: 14, leading: 18, trailing: 18, bottom: 6 }),
              frame({ minHeight: COMPOSER_TEXT_FIELD_MIN_HEIGHT, alignment: 'topLeading' }),
              contentShape(shapes.rectangle()),
            ]}
          >
            <TextField.Placeholder>
              <Text
                modifiers={[
                  foregroundStyle(palette.textTertiary),
                  font({ textStyle: 'body' }),
                ]}
              >
                اكتب رسالتك...
              </Text>
            </TextField.Placeholder>
          </TextField>
          <HStack
            alignment="center"
            spacing={0}
            modifiers={[padding({ horizontal: 8, bottom: ACTION_ROW_BOTTOM_INSET })]}
          >
            <Button
              onPress={() => {}}
              modifiers={[
                frame({
                  width: ACTION_BUTTON_HIT_TARGET,
                  height: ACTION_BUTTON_HIT_TARGET,
                  alignment: 'center',
                }),
                contentShape(shapes.circle()),
                accessibilityLabel('إضافة مرفق'),
              ]}
            >
              <ZStack
                modifiers={[
                  frame({
                    width: ACTION_BUTTON_HIT_TARGET,
                    height: ACTION_BUTTON_HIT_TARGET,
                    alignment: 'center',
                  }),
                ]}
              >
                <Circle
                  modifiers={[
                    frame({ width: ACTION_BUTTON_DIAMETER, height: ACTION_BUTTON_DIAMETER }),
                    foregroundStyle(palette.surfaceInset),
                  ]}
                />
                <Image systemName="plus" size={18} color={palette.text} />
              </ZStack>
            </Button>
            <Spacer minLength={0} />
            <Button
              onPress={onSend}
              modifiers={[
                disabled(!hasSendableText || sendDisabled),
                frame({
                  width: ACTION_BUTTON_HIT_TARGET,
                  height: ACTION_BUTTON_HIT_TARGET,
                  alignment: 'center',
                }),
                contentShape(shapes.circle()),
                accessibilityLabel('إرسال'),
              ]}
            >
              <ZStack
                modifiers={[
                  frame({
                    width: ACTION_BUTTON_HIT_TARGET,
                    height: ACTION_BUTTON_HIT_TARGET,
                    alignment: 'center',
                  }),
                ]}
              >
                <Circle
                  modifiers={[
                    frame({ width: ACTION_BUTTON_DIAMETER, height: ACTION_BUTTON_DIAMETER }),
                    foregroundStyle(
                      hasSendableText ? palette.accent : palette.surfacePressed,
                    ),
                  ]}
                />
                <Image
                  systemName="arrow.up"
                  size={18}
                  color={hasSendableText ? palette.accentText : palette.textTertiary}
                />
              </ZStack>
            </Button>
          </HStack>
        </VStack>
      </ZStack>
    </VStack>
  );
});

const ChatUserMessageRow = memo(function ChatUserMessageRow({
  message,
  turnId,
  contentWidth,
  colorScheme,
  palette,
  diagnosticsEnabled,
  onLayoutDiagnostic,
  onLayout,
}: {
  message: ChatTurn['user'];
  turnId: string;
  contentWidth: number;
  colorScheme: 'light' | 'dark';
  palette: ReturnType<typeof getPalette>;
  diagnosticsEnabled: boolean;
  onLayoutDiagnostic: ChatLayoutDiagnostic;
  onLayout: (turnId: string, y: number, height: number) => void;
}) {
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    onLayout(turnId, y, height);
  }, [onLayout, turnId]);
  const handleHostLayout = useCallback((event: { nativeEvent: { width: number; height: number } }) => {
    if (!__DEV__ || !diagnosticsEnabled) return;
    onLayoutDiagnostic('user-bubble-native-layout', {
      turnId,
      width: event.nativeEvent.width,
      height: event.nativeEvent.height,
    });
  }, [diagnosticsEnabled, onLayoutDiagnostic, turnId]);

  return (
    <View onLayout={handleLayout} style={{ width: contentWidth, alignSelf: 'stretch' }}>
      <Host
        colorScheme={colorScheme}
        layoutDirection="leftToRight"
        matchContents={{ vertical: true, horizontal: false }}
        style={{ width: contentWidth }}
        onLayoutContent={diagnosticsEnabled ? handleHostLayout : undefined}
      >
        <ChatUserBubble message={message} contentWidth={contentWidth} palette={palette} />
      </Host>
    </View>
  );
});

const ChatAssistantMessageRow = memo(function ChatAssistantMessageRow({
  turn,
  isLatest,
  isActive,
  contentWidth,
  colorScheme,
  palette,
  streamStore,
  reaction,
  copied,
  diagnosticsEnabled,
  onLayout,
  onLayoutDiagnostic,
  onCopy,
  onReaction,
  onRegenerate,
}: {
  turn: ChatTurn;
  isLatest: boolean;
  isActive: boolean;
  contentWidth: number;
  colorScheme: 'light' | 'dark';
  palette: ReturnType<typeof getPalette>;
  streamStore: Agent1ChatStreamStore;
  reaction?: ChatReaction;
  copied: boolean;
  diagnosticsEnabled: boolean;
  onLayout: (
    streamKey: string,
    turnId: string,
    event: LayoutChangeEvent,
    streaming: boolean,
  ) => void;
  onLayoutDiagnostic: ChatLayoutDiagnostic;
  onCopy: (messageId: string, content: string) => Promise<void>;
  onReaction: (messageId: string, reaction: ChatReaction) => void;
  onRegenerate: (turnId: string) => void;
}) {
  const streamKey = agent1ChatStreamKey(turn.id, turn.assistantAttempt);
  // Strategy A: retain native rich Markdown while streaming; the external store
  // limits work to this stable assistant row instead of reparsing every turn.
  const subscribe = useCallback(
    (listener: () => void) => streamStore.subscribe(streamKey, listener),
    [streamKey, streamStore],
  );
  const getSnapshot = useCallback(
    () => streamStore.getSnapshot(streamKey),
    [streamKey, streamStore],
  );
  const streamSnapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const streamText = streamSnapshot.key === streamKey ? streamSnapshot.text : '';
  const assistant = turn.assistant ?? (streamText.length > 0
    ? { id: streamKey, role: 'assistant' as const, content: streamText }
    : null);
  const renderedTurn = assistant === turn.assistant ? turn : { ...turn, assistant };
  const actionPolicy = getAgent1AssistantActionPolicy(renderedTurn, isLatest, isActive);
  const showRegenerateOnly = actionPolicy.showRegenerate && !actionPolicy.showFeedback;
  const showStatus =
    (actionPolicy.showStatus &&
      (turn.assistantStatus === 'working' || turn.assistantStatus === 'thinking')) ||
    (isActive && turn.assistantStatus === 'streaming' && !assistant);
  const showError =
    Boolean(turn.errorMessage) &&
    (actionPolicy.showIncompleteNotice || actionPolicy.showError);
  const streaming = turn.assistantStatus === 'streaming';
  const showResponse = showStatus || Boolean(assistant) || showError || showRegenerateOnly;
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    onLayout(streamKey, turn.id, event, streaming);
  }, [onLayout, streaming, streamKey, turn.id]);
  const handleRegenerate = useCallback(() => onRegenerate(turn.id), [onRegenerate, turn.id]);
  const handleMarkdownDiagnostic = useCallback((event: string, values: ChatLayoutDiagnosticValues) => {
    if (!diagnosticsEnabled) return;
    onLayoutDiagnostic(event, { turnId: turn.id, ...values });
  }, [diagnosticsEnabled, onLayoutDiagnostic, turn.id]);

  if (!showResponse) return null;

  return (
    <View
      onLayout={handleLayout}
      style={{
        width: contentWidth,
        alignSelf: 'stretch',
        paddingTop: USER_TO_ASSISTANT_GAP,
        marginBottom: isLatest ? 0 : CHAT_TURN_SPACING,
        gap: CHAT_TURN_CONTENT_SPACING,
      }}
    >
      {showStatus ? (
        <Host
          colorScheme={colorScheme}
          layoutDirection="leftToRight"
          matchContents
          style={{ alignSelf: 'flex-start' }}
        >
          <Agent1TurnStatus
            status={turn.assistantStatus === 'thinking' ? 'thinking' : 'working'}
            palette={palette}
          />
        </Host>
      ) : null}

      {assistant ? (
        <Agent1AssistantMarkdown
          messageId={assistant.id}
          content={assistant.content}
          streaming={streaming}
          contentWidth={contentWidth}
          palette={palette}
          layoutDiagnosticsEnabled={diagnosticsEnabled}
          onLayoutDiagnostic={handleMarkdownDiagnostic}
        />
      ) : null}

      {showError ? (
        <Host
          colorScheme={colorScheme}
          layoutDirection="leftToRight"
          matchContents={{ vertical: true, horizontal: false }}
          style={{ width: contentWidth }}
        >
          <ChatInlineNotice
            message={turn.errorMessage!}
            contentWidth={contentWidth}
            palette={palette}
          />
        </Host>
      ) : null}

      {actionPolicy.showFeedback && assistant ? (
        <Host
          colorScheme={colorScheme}
          layoutDirection="leftToRight"
          matchContents
          style={{ alignSelf: 'flex-start' }}
        >
          <ChatAssistantActions
            assistantId={assistant.id}
            content={assistant.content}
            palette={palette}
            reaction={reaction}
            copied={copied}
            showFeedback
            showRegenerate={actionPolicy.showRegenerate}
            onCopy={onCopy}
            onReaction={onReaction}
            onRegenerate={handleRegenerate}
          />
        </Host>
      ) : showRegenerateOnly ? (
        <Host
          colorScheme={colorScheme}
          layoutDirection="leftToRight"
          matchContents
          style={{ alignSelf: 'flex-start' }}
        >
          <ChatAssistantActions
            assistantId={assistant?.id ?? streamKey}
            content=""
            palette={palette}
            reaction={reaction}
            copied={copied}
            showFeedback={false}
            showRegenerate
            onCopy={onCopy}
            onReaction={onReaction}
            onRegenerate={handleRegenerate}
          />
        </Host>
      ) : null}
    </View>
  );
});

const ChatUserBubble = memo(function ChatUserBubble({
  message,
  contentWidth,
  palette,
}: {
  message: ChatTurn['user'];
  contentWidth: number;
  palette: ReturnType<typeof getPalette>;
}) {
  const bubbleMaxWidth = contentWidth * 0.82;
  const messageAlignment = firstStrongTextDirection(message.content) === 'ltr' ? 'leading' : 'trailing';
  return (
    <HStack alignment="top" spacing={0}>
      <Spacer minLength={0} />
      <Text
        modifiers={[
          font({ textStyle: 'body' }),
          foregroundStyle(palette.text),
          multilineTextAlignment(messageAlignment),
          lineSpacing(3),
          textSelection(true),
          fixedSize({ horizontal: false, vertical: true }),
          padding({ horizontal: 15, vertical: 11 }),
          background(
            palette.surfaceInset,
            shapes.roundedRectangle({
              cornerRadius: CHAT_BUBBLE_CORNER_RADIUS,
              roundedCornerStyle: 'continuous',
            }),
          ),
          strokeBorder({
            color: palette.border,
            style: { lineWidth: 0.8 },
            shape: 'roundedRectangle',
            cornerRadius: CHAT_BUBBLE_CORNER_RADIUS,
          }),
          ...(contentWidth > 0
            ? [frame({ maxWidth: bubbleMaxWidth, alignment: 'trailing' as const })]
            : []),
        ]}
      >
        {message.content}
      </Text>
    </HStack>
  );
});

function Agent1TurnStatus({
  status,
  palette,
}: {
  status: 'working' | 'thinking';
  palette: ReturnType<typeof getPalette>;
}) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [visible, setVisible] = useState(false);
  const [sweepPhase, setSweepPhase] = useState(false);
  const handleAppear = useCallback(() => setVisible(true), []);

  useEffect(() => {
    let isMounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (isMounted) setReduceMotion(enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!visible || reduceMotion) return;
    const timeout = setTimeout(
      () => setSweepPhase((current) => !current),
      STATUS_SWEEP_HALF_CYCLE_MS,
    );
    return () => clearTimeout(timeout);
  }, [reduceMotion, sweepPhase, visible]);

  const gradientStart = sweepPhase ? 1 - STATUS_SWEEP_WIDTH : 0;
  const statusStyle = {
    type: 'linearGradient' as const,
    colors: [
      colorWithOpacity(palette.textSecondary, 0.62),
      colorWithOpacity(palette.textSecondary, 0.9),
      colorWithOpacity(palette.textSecondary, 0.62),
    ],
    startPoint: { x: gradientStart, y: 0.5 },
    endPoint: { x: gradientStart + STATUS_SWEEP_WIDTH, y: 0.5 },
  };

  return (
    <Text
      modifiers={[
        font({ textStyle: 'body' }),
        foregroundStyle(reduceMotion ? palette.textSecondary : statusStyle),
        opacity(visible ? (reduceMotion ? 0.62 : 1) : 0),
        ...(reduceMotion
          ? []
          : [
              animation(Animation.easeOut({ duration: 0.18 }), visible),
              animation(
                Animation.easeInOut({ duration: STATUS_SWEEP_TRANSITION_SECONDS }),
                sweepPhase,
              ),
            ]),
        onAppear(handleAppear),
      ]}
    >
      {status === 'thinking' ? 'Thinking' : 'Working'}
    </Text>
  );
}

function colorWithOpacity(color: string, opacityValue: number): string {
  const match = /^#([0-9a-f]{6})$/iu.exec(color);
  if (!match) return color;
  const hex = match[1];
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacityValue})`;
}

const ChatAssistantActions = memo(function ChatAssistantActions({
  assistantId,
  content,
  palette,
  reaction,
  copied,
  showFeedback,
  showRegenerate,
  onCopy,
  onReaction,
  onRegenerate,
}: {
  assistantId: string;
  content: string;
  palette: ReturnType<typeof getPalette>;
  reaction?: ChatReaction;
  copied: boolean;
  showFeedback: boolean;
  showRegenerate: boolean;
  onCopy: (messageId: string, content: string) => Promise<void>;
  onReaction: (messageId: string, reaction: ChatReaction) => void;
  onRegenerate: () => void;
}) {
  return (
    <HStack alignment="center" spacing={ASSISTANT_ACTION_SPACING}>
      {showFeedback ? (
        <>
          <Button
            onPress={() => void onCopy(assistantId, content)}
            modifiers={[
              buttonStyle('plain'),
              frame({
                width: ASSISTANT_ACTION_LAYOUT_SIZE,
                height: ASSISTANT_ACTION_LAYOUT_SIZE,
                alignment: 'center',
              }),
              contentShape(shapes.rectangle()),
              accessibilityLabel(copied ? 'تم نسخ الرد' : 'نسخ الرد'),
            ]}
          >
            <Image
              systemName={copied ? 'checkmark' : 'doc.on.doc'}
              size={ASSISTANT_ACTION_ICON_SIZE}
              color={palette.textSecondary}
            />
          </Button>
          <Button
            onPress={() => onReaction(assistantId, 'like')}
            modifiers={[
              buttonStyle('plain'),
              frame({
                width: ASSISTANT_ACTION_LAYOUT_SIZE,
                height: ASSISTANT_ACTION_LAYOUT_SIZE,
                alignment: 'center',
              }),
              contentShape(shapes.rectangle()),
              accessibilityLabel(reaction === 'like' ? 'إعجاب، محدد' : 'إعجاب'),
            ]}
          >
            <Image
              systemName="hand.thumbsup"
              size={ASSISTANT_ACTION_ICON_SIZE}
              color={reaction === 'like' ? palette.text : palette.textSecondary}
            />
          </Button>
          <Button
            onPress={() => onReaction(assistantId, 'dislike')}
            modifiers={[
              buttonStyle('plain'),
              frame({
                width: ASSISTANT_ACTION_LAYOUT_SIZE,
                height: ASSISTANT_ACTION_LAYOUT_SIZE,
                alignment: 'center',
              }),
              contentShape(shapes.rectangle()),
              accessibilityLabel(reaction === 'dislike' ? 'عدم إعجاب، محدد' : 'عدم إعجاب'),
            ]}
          >
            <Image
              systemName="hand.thumbsdown"
              size={ASSISTANT_ACTION_ICON_SIZE}
              color={reaction === 'dislike' ? palette.text : palette.textSecondary}
            />
          </Button>
        </>
      ) : null}
      {showRegenerate ? (
        <Button
          onPress={onRegenerate}
          modifiers={[
            buttonStyle('plain'),
            frame({
              width: ASSISTANT_ACTION_LAYOUT_SIZE,
              height: ASSISTANT_ACTION_LAYOUT_SIZE,
              alignment: 'center',
            }),
            contentShape(shapes.rectangle()),
            accessibilityLabel('إعادة إنشاء الرد'),
          ]}
        >
          <Image
            systemName="arrow.clockwise"
            size={ASSISTANT_ACTION_ICON_SIZE}
            color={palette.textSecondary}
          />
        </Button>
      ) : null}
    </HStack>
  );
});

function ChatInlineNotice({
  message,
  contentWidth,
  palette,
}: {
  message: string;
  contentWidth: number;
  palette: ReturnType<typeof getPalette>;
}) {
  return (
    <Text
      modifiers={[
        foregroundStyle(palette.textSecondary),
        font({ textStyle: 'footnote' }),
        multilineTextAlignment('leading'),
        fixedSize({ horizontal: false, vertical: true }),
        ...(contentWidth > 0
          ? [frame({ maxWidth: contentWidth, alignment: 'leading' as const })]
          : []),
      ]}
    >
      {message}
    </Text>
  );
}
