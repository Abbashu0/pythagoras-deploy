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
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeTouchEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  KeyboardChatScrollView,
  KeyboardStickyView,
  useGenericKeyboardHandler,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
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
  canPositionChatTranscriptAnchor,
  consumeChatTranscriptAnchorSpace,
  createChatTranscriptScrollState,
  positionChatTranscriptTurn,
  getChatTranscriptFollowTarget,
  getChatTranscriptEndTarget,
  shouldShowChatTranscriptScrollToBottom,
  updateChatTranscriptEndVisibility,
  type ChatTranscriptScrollState,
} from './chat-transcript-scroll-state';
import { chatGeometryDiagnosticKey, describeChatTurnGeometry, type ChatTurnGeometry } from './chat-layout-diagnostics';
import { beginChatSendTiming, reportChatSendTiming, beginChatPresentationTiming, reportChatPresentationTiming } from './chat-send-timing.dev';
import { presentUserMessage, USER_MESSAGE_PRESENTATION } from './user-message-presentation';
import { captureUserMessageCollapseAnchor, resolveUserMessageCollapseOffset, recordUserMessageHeight, userMessageHeightFloor, type UserMessageCollapseAnchor, type UserMessageHeightCache, type UserMessageMode, type UserMessageRowGeometry } from './user-message-layout';
import { ChatEdgeFades } from './chat-edge-fades.ios';
import { ChatScrollToBottomAffordance } from './chat-scroll-to-bottom.ios';
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
  const keyboardAnimation = useReanimatedKeyboardAnimation();
  const keyboardInMotion = useSharedValue(false);
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
  const endVisibleRef = useRef(true);
  const scrollToBottomVisibleRef = useRef(false);
  const explicitScrollToEndRef = useRef(false);
  const readerLeftEndRef = useRef(false);
  const activeTurnIdRef = useRef(activeTurnId);
  const activeTurnStatusRef = useRef<ChatTurn['assistantStatus']>(null);
  const textFieldRef = useRef<TextFieldRef | null>(null);
  const draftRef = useRef('');
  const transcriptTouchRef = useRef<TranscriptTouch | null>(null);
  const transcriptTouchMovedRef = useRef(false);
  const lastActiveAssistantLayoutRef = useRef<{ key: string; y: number; height: number; streaming: boolean } | null>(null);
  const lastFollowedAssistantBottomRef = useRef<{ key: string; bottom: number } | null>(null);
  const lastRequestedOffsetRef = useRef<number | null>(null);
  const controllerInsetShiftPendingRef = useRef(false);
  const geometryRef = useRef<ChatTurnGeometry>({ turnId: null, user: null, assistant: null });
  const lastGeometryDiagnosticRef = useRef('');
  const copyFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousLatestAttemptRef = useRef<{ turnId: string; attempt: number } | null>(null);
  const [hasSendableText, setHasSendableText] = useState(false);
  const [keyboardLiftEnabled, setKeyboardLiftEnabled] = useState(true);
  const [scrollToBottomVisible, setScrollToBottomVisible] = useState(false);
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
    if (geometryRef.current.turnId !== latestTurnId) {
      geometryRef.current = { turnId: latestTurnId, user: null, assistant: null };
    }
  }, [activeTurnId, latestTurnId, turns]);

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

  const getKeyboardObstruction = useCallback(() =>
    Math.max(0, -keyboardAnimation.height.get() - insets.bottom),
  [insets.bottom, keyboardAnimation.height]);
  const reportGeometryDiagnostic = useCallback((event: string) => {
    if (!__DEV__ || !layoutDiagnosticsEnabled) return;
    const values = {
      ...describeChatTurnGeometry(geometryRef.current, USER_TO_ASSISTANT_GAP),
      scrollOffsetY: scrollOffsetRef.current,
      contentHeight: contentHeightRef.current,
      viewportHeight: viewportHeightRef.current,
      blankSpace: blankSpaceRef.current,
      composerHeight: composerHeightRef.current,
      effectiveKeyboardInset: getKeyboardObstruction(),
      effectiveContentInsetBottom: keyboardInsetBottomRef.current,
      mode: scrollStateRef.current.mode,
      activeTurnId: activeTurnIdRef.current,
      streamActive: activeTurnIdRef.current !== null &&
        !['completed', 'incomplete', 'error'].includes(activeTurnStatusRef.current ?? ''),
    };
    const key = chatGeometryDiagnosticKey(values);
    if (lastGeometryDiagnosticRef.current === key) return;
    lastGeometryDiagnosticRef.current = key;
    if (values.overlapInvariantViolated || values.visualGapInvariantViolated || values.userHostHeightMismatch) console.warn('[Chat geometry invariant]', { event, at: Date.now(), ...values });
    else console.info('[Chat geometry]', { event, at: Date.now(), ...values });
  }, [getKeyboardObstruction, layoutDiagnosticsEnabled]);

  const updateScrollToBottomVisibility = useCallback((state: ChatTranscriptScrollState) => {
    const visible = shouldShowChatTranscriptScrollToBottom(state, endVisibleRef.current);
    if (scrollToBottomVisibleRef.current === visible) return;
    scrollToBottomVisibleRef.current = visible;
    setScrollToBottomVisible(visible);
  }, []);
  const setScrollState = useCallback((
    next: ChatTranscriptScrollState,
    reason: string,
  ) => {
    const previous = scrollStateRef.current;
    updateScrollToBottomVisibility(next);
    if (previous === next) return;
    scrollStateRef.current = next;
    const canLift = (state: ChatTranscriptScrollState) =>
      state.mode !== 'anchoring-new-turn' && state.mode !== 'user-scrolled-away';
    if (canLift(previous) !== canLift(next)) setKeyboardLiftEnabled(canLift(next));
    if (previous.mode !== next.mode || previous.anchorTurnId !== next.anchorTurnId) {
      reportLayoutDiagnostic('scroll-policy-transition', {
        reason,
        previousMode: previous.mode,
        nextMode: next.mode,
        nextAnchorTurnId: next.anchorTurnId,
      });
      reportGeometryDiagnostic('scroll-policy-transition');
    }
  }, [reportGeometryDiagnostic, reportLayoutDiagnostic, updateScrollToBottomVisibility]);

  const liveStreamActive = useCallback(() => {
    const status = activeTurnStatusRef.current;
    return activeTurnIdRef.current !== null &&
      status !== 'completed' && status !== 'incomplete' && status !== 'error';
  }, []);
  const updateAnchorBlankSpace = useCallback(() => {
    const state = scrollStateRef.current;
    if (!state.anchorTurnId || state.mode === 'user-scrolled-away') return;
    const targetOffset = anchorTargetOffsetRef.current;
    if (targetOffset === null || viewportHeightRef.current <= 0) return;
    const user = geometryRef.current.user;
    if (state.mode === 'anchoring-new-turn' && (!user || user.height <= 0 || contentHeightRef.current < user.y + user.height)) return;
    const requiredSpace = calculateChatTranscriptAnchorBlankSpace(
      targetOffset,
      contentHeightRef.current,
      viewportHeightRef.current,
      composerHeightRef.current,
    );
    const nextBlankSpace = consumeChatTranscriptAnchorSpace(
      state, blankSpaceRef.current, requiredSpace, scrollOffsetRef.current,
      contentHeightRef.current, viewportHeightRef.current, composerHeightRef.current,
    );
    if (Math.abs(blankSpaceRef.current - nextBlankSpace) < 1) return;
    blankSpaceRef.current = nextBlankSpace;
    blankSpace.set(nextBlankSpace);
    reportGeometryDiagnostic('blank-space-change');
  }, [blankSpace, reportGeometryDiagnostic]);

  const tryPositionPendingAnchor = useCallback(() => {
    const { turnId, user } = geometryRef.current;
    const targetOffset = anchorTargetOffsetRef.current;
    if (!turnId || !user || targetOffset === null || keyboardInMotion.get() || !canPositionChatTranscriptAnchor({
      state: scrollStateRef.current, turnId, userHeight: user.height, userBottom: user.y + user.height,
      contentHeight: contentHeightRef.current, viewportHeight: viewportHeightRef.current,
      targetOffset, contentInsetBottom: keyboardInsetBottomRef.current,
    })) return;
    // One atomic, non-animated anchor. A running UIKit scroll animation cannot
    // be overwritten by streaming layout callbacks because there is no tween.
    const assistant = lastActiveAssistantLayoutRef.current;
    if (assistant) lastFollowedAssistantBottomRef.current = { key: assistant.key, bottom: assistant.y + assistant.height };
    setScrollState(positionChatTranscriptTurn(scrollStateRef.current, turnId), 'new-user-row-measured-and-reachable');
    lastRequestedOffsetRef.current = targetOffset;
    transcriptScrollRef.current?.scrollTo({ y: targetOffset, animated: false });
    reportLayoutDiagnostic('new-turn-positioned', { turnId, targetOffsetY: targetOffset });
    reportGeometryDiagnostic('new-turn-positioned');
  }, [keyboardInMotion, reportGeometryDiagnostic, reportLayoutDiagnostic, setScrollState]);

  const userPresentationReadingRef = useRef(false);
  const userRowsRef = useRef(new Map<string, UserMessageRowGeometry>());
  const contentRevisionRef = useRef(0);
  const pendingUserCollapseRef = useRef<(UserMessageCollapseAnchor & { row: UserMessageRowGeometry | null; nativeHeight: number | null }) | null>(null);
  const handleUserPresentationChange = useCallback((turnId: string, mode: UserMessageMode) => {
    // Explicit reader action: pause auto-follow without resetting the transcript state machine.
    userPresentationReadingRef.current = true;
    const anchor = captureUserMessageCollapseAnchor(turnId, mode, userRowsRef.current.get(turnId), scrollOffsetRef.current, contentRevisionRef.current);
    pendingUserCollapseRef.current = anchor ? { ...anchor, row: null, nativeHeight: null } : null;
  }, []);
  const completeUserCollapse = useCallback(() => {
    const pending = pendingUserCollapseRef.current;
    if (!pending) return;
    if (manualScrollGestureRef.current || keyboardInMotion.get()) {
      pendingUserCollapseRef.current = null;
      return;
    }
    if (!pending.row) return;
    const target = resolveUserMessageCollapseOffset(pending, pending.row, pending.nativeHeight, {
      contentHeight: contentHeightRef.current, viewportHeight: viewportHeightRef.current,
      insetBottom: keyboardInsetBottomRef.current, contentRevision: contentRevisionRef.current,
    });
    if (target === null) return;
    // Consume BEFORE writing: only this explicit collapse may issue this one correction.
    pendingUserCollapseRef.current = null;
    lastRequestedOffsetRef.current = target;
    transcriptScrollRef.current?.scrollTo({ y: target, animated: false });
    reportLayoutDiagnostic('user-collapse-offset-write', { turnId: pending.turnId, viewportAnchorY: pending.viewportY, targetOffsetY: target });
  }, [keyboardInMotion, reportLayoutDiagnostic]);
  const followMeasuredAssistantGrowth = useCallback(() => {
    if (userPresentationReadingRef.current) return;
    const layout = lastActiveAssistantLayoutRef.current;
    if (!layout || !layout.streaming) return;
    const previous = lastFollowedAssistantBottomRef.current;
    const target = getChatTranscriptFollowTarget(scrollStateRef.current, {
      streamIsActive: liveStreamActive(), keyboardInMotion: keyboardInMotion.get(),
      userGestureActive: manualScrollGestureRef.current,
      controllerInsetShiftPending: controllerInsetShiftPendingRef.current,
      assistantBottom: layout.y + layout.height,
      previousAssistantBottom: previous?.key === layout.key ? previous.bottom : 0,
      contentHeight: contentHeightRef.current, viewportHeight: viewportHeightRef.current,
      scrollOffset: Math.max(scrollOffsetRef.current, lastRequestedOffsetRef.current ?? 0),
      bottomOcclusion: composerHeightRef.current + getKeyboardObstruction(),
      documentBottomGap: CHAT_TRANSCRIPT_COMPOSER_GAP,
    });
    if (target === null) return;
    lastFollowedAssistantBottomRef.current = { key: layout.key, bottom: layout.y + layout.height };
    lastRequestedOffsetRef.current = target;
    transcriptScrollRef.current?.scrollTo({ y: target, animated: false });
    reportLayoutDiagnostic('assistant-follow-offset-write', { targetOffsetY: target });
  }, [getKeyboardObstruction, keyboardInMotion, liveStreamActive, reportLayoutDiagnostic]);

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
    const oldInset = Math.max(blankSpaceRef.current, composerHeightRef.current + getKeyboardObstruction());
    composerHostHeightRef.current = nextHeight;
    composerHeightRef.current = nextHeight + insets.bottom;
    const nextInset = Math.max(blankSpaceRef.current, composerHeightRef.current + getKeyboardObstruction());
    // useExtraContentPadding can shift a reader at the end. Give the controller
    // exclusive ownership until its actual native scroll event acknowledges it.
    controllerInsetShiftPendingRef.current = Math.abs(oldInset - nextInset) > 0.5 && endVisibleRef.current &&
      scrollStateRef.current.mode !== 'anchoring-new-turn' && scrollStateRef.current.mode !== 'user-scrolled-away';
    composerScrollInset.set(composerHeightRef.current);
    reportLayoutDiagnostic('composer-layout', {
      composerHeight: composerHeightRef.current,
      composerHostHeight: nextHeight,
      composerScrollInset: composerHeightRef.current,
    });
  }, [composerScrollInset, getKeyboardObstruction, insets.bottom, reportLayoutDiagnostic]);
  const handleRootLayout = useCallback((event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    reportLayoutDiagnostic('chat-root-layout', { x, y, width, height });
  }, [reportLayoutDiagnostic]);
  const handleViewportLayout = useCallback((event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    viewportHeightRef.current = height;
    updateAnchorBlankSpace();
    tryPositionPendingAnchor();
    reportLayoutDiagnostic('transcript-viewport-layout', { x, y, width, height });
    reportGeometryDiagnostic('viewport-layout');
  }, [reportGeometryDiagnostic, reportLayoutDiagnostic, tryPositionPendingAnchor, updateAnchorBlankSpace]);
  const handleScroll = useCallback((event: ChatScrollEvent) => {
    const { contentOffset, contentSize, layoutMeasurement, contentInset } = event.nativeEvent;
    scrollOffsetRef.current = contentOffset.y;
    keyboardInsetBottomRef.current = contentInset.bottom;
    if (controllerInsetShiftPendingRef.current && Math.abs(contentInset.bottom -
      Math.max(blankSpaceRef.current, composerHeightRef.current + getKeyboardObstruction())) < 1) {
      controllerInsetShiftPendingRef.current = false;
      followMeasuredAssistantGrowth();
    }
    if (lastRequestedOffsetRef.current !== null && Math.abs(contentOffset.y - lastRequestedOffsetRef.current) < 1) {
      lastRequestedOffsetRef.current = null;
    }
    // Behavioural position tracking is always installed, even without diagnostics.
    if (manualScrollGestureRef.current && !keyboardInMotion.get()) {
      const atEnd = contentOffset.y + layoutMeasurement.height >= contentSize.height - 20;
      if (atEnd) userPresentationReadingRef.current = false;
      if (!atEnd) readerLeftEndRef.current = true;
      if (!atEnd || readerLeftEndRef.current) {
        setScrollState(updateChatTranscriptEndVisibility(scrollStateRef.current, atEnd, true), 'reader-scroll-position');
      }
    }
  }, [followMeasuredAssistantGrowth, getKeyboardObstruction, keyboardInMotion, setScrollState]);
  const handleScrollBeginDrag = useCallback(() => {
    explicitScrollToEndRef.current = false;
    pendingUserCollapseRef.current = null;
    manualScrollGestureRef.current = true;
    readerLeftEndRef.current = !endVisibleRef.current;
    lastRequestedOffsetRef.current = null;
    controllerInsetShiftPendingRef.current = false;
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
    reportGeometryDiagnostic('manual-scroll-end-drag');
  }, [reportGeometryDiagnostic, reportLayoutDiagnostic]);
  const handleMomentumScrollBegin = useCallback(() => {
    manualScrollGestureRef.current = true;
  }, []);
  const handleMomentumScrollEnd = useCallback(() => {
    manualScrollGestureRef.current = false;
    reportLayoutDiagnostic('manual-scroll-momentum-end', {});
    reportGeometryDiagnostic('manual-scroll-momentum-end');
  }, [reportGeometryDiagnostic, reportLayoutDiagnostic]);
  const handleEndVisible = useCallback((visible: boolean) => {
    endVisibleRef.current = visible;
    // The controller's whenAtEnd policy does not shift an off-end reader.
    // If growing content left the end before the padding reaction ran, there
    // is no controller scroll event to wait for: return ownership to growth.
    const releaseInsetOwner = !visible && controllerInsetShiftPendingRef.current;
    if (releaseInsetOwner) controllerInsetShiftPendingRef.current = false;
    setScrollState(
      updateChatTranscriptEndVisibility(
        scrollStateRef.current,
        visible,
        visible && explicitScrollToEndRef.current,
      ),
      visible ? 'passive-end-visible' : 'end-left-viewport',
    );
    if (visible && explicitScrollToEndRef.current) {
      explicitScrollToEndRef.current = false;
      userPresentationReadingRef.current = false;
    }
    if (visible) updateAnchorBlankSpace();
    if (releaseInsetOwner) followMeasuredAssistantGrowth();
    reportLayoutDiagnostic('transcript-end-visibility', { visible });
  }, [followMeasuredAssistantGrowth, reportLayoutDiagnostic, setScrollState, updateAnchorBlankSpace]);
  const handleScrollToBottom = useCallback(() => {
    const scrollView = transcriptScrollRef.current;
    const target = getChatTranscriptEndTarget({
      contentHeight: contentHeightRef.current, viewportHeight: viewportHeightRef.current,
      bottomOcclusion: composerHeightRef.current + getKeyboardObstruction(),
      contentInsetBottom: keyboardInsetBottomRef.current,
    });
    if (!scrollView || target === null) return;
    explicitScrollToEndRef.current = true;
    lastRequestedOffsetRef.current = target;
    // One reader-requested write. onEndVisible(true) re-arms the existing state.
    scrollView.scrollTo({ y: target, animated: false });
  }, [getKeyboardObstruction]);
  const handleContentSizeChange = useCallback((width: number, height: number) => {
    contentHeightRef.current = height;
    contentRevisionRef.current++;
    completeUserCollapse();
    updateAnchorBlankSpace();
    tryPositionPendingAnchor();
    followMeasuredAssistantGrowth();
    reportLayoutDiagnostic('transcript-content-size', { width, height });
    reportGeometryDiagnostic('content-size-change');
  }, [completeUserCollapse, followMeasuredAssistantGrowth, reportGeometryDiagnostic, reportLayoutDiagnostic, tryPositionPendingAnchor, updateAnchorBlankSpace]);
  const handleUserRowLayout = useCallback((
    turnId: string,
    layoutY: number,
    height: number,
  ) => {
    userRowsRef.current.set(turnId, { y: layoutY, height });
    const pending = pendingUserCollapseRef.current;
    if (pending?.turnId === turnId) {
      pending.row = { y: layoutY, height };
      completeUserCollapse();
    }
    if (geometryRef.current.turnId === turnId) geometryRef.current.user = { y: layoutY, height };
    reportLayoutDiagnostic('user-message-row-layout', {
      turnId,
      y: layoutY,
      height,
      visibleY: layoutY - scrollOffsetRef.current,
    });
    reportGeometryDiagnostic('user-row-layout');
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
    tryPositionPendingAnchor();
  }, [
    completeUserCollapse,
    reportLayoutDiagnostic,
    reportGeometryDiagnostic,
    tryPositionPendingAnchor,
    transcriptContentWidth,
    transcriptTopPadding,
    updateAnchorBlankSpace,
  ]);
  const handleUserNativeLayout = useCallback((turnId: string, width: number, height: number, mode: UserMessageMode) => {
    const pending = pendingUserCollapseRef.current;
    if (pending?.turnId === turnId && mode === 'collapsed') {
      pending.nativeHeight = height;
      completeUserCollapse();
    }
    if (geometryRef.current.turnId !== turnId) return;
    geometryRef.current.nativeUserHeight = height;
    reportLayoutDiagnostic('user-bubble-native-layout', { turnId, width, height });
    reportGeometryDiagnostic('user-bubble-native-layout');
  }, [completeUserCollapse, reportGeometryDiagnostic, reportLayoutDiagnostic]);
  const handleAssistantRowLayout = useCallback((
    streamKey: string,
    turnId: string,
    event: LayoutChangeEvent,
    streaming: boolean,
  ) => {
    const { y, height } = event.nativeEvent.layout;
    if (geometryRef.current.turnId === turnId) geometryRef.current.assistant = { y, height };
    reportLayoutDiagnostic('assistant-message-row-layout', {
      turnId,
      y,
      height,
      visibleY: y - scrollOffsetRef.current,
      streaming,
    });
    reportGeometryDiagnostic('assistant-row-layout');
    if (activeTurnIdRef.current !== turnId) return;
    lastActiveAssistantLayoutRef.current = { key: streamKey, y, height, streaming };
    followMeasuredAssistantGrowth();
  }, [followMeasuredAssistantGrowth, reportGeometryDiagnostic, reportLayoutDiagnostic]);
  const handleTextChange = useCallback((text: string) => {
    draftRef.current = text;
    setHasSendableText(text.trim().length > 0);
  }, []);
  const handleSend = useCallback(() => {
    const text = draftRef.current;
    if (!text.trim() || activeTurnId) return;
    const acceptedTurnId = onSend(text);
    if (acceptedTurnId) {
      pendingUserCollapseRef.current = null;
      userPresentationReadingRef.current = false;
      beginChatSendTiming(acceptedTurnId, text);
      anchorTargetOffsetRef.current = null;
      lastRequestedOffsetRef.current = null;
      lastActiveAssistantLayoutRef.current = null;
      lastFollowedAssistantBottomRef.current = null;
      geometryRef.current = { turnId: acceptedTurnId, user: null, assistant: null };
      setScrollState(
        beginChatTranscriptTurn(scrollStateRef.current, acceptedTurnId, turns.length > 0),
        'new-turn-accepted',
      );
      // Keep existing capacity until the new row/content measures. The exact
      // reserve is then computed; do not invent one full viewport of padding.
      reportGeometryDiagnostic('new-turn-accepted');
      draftRef.current = '';
      message.set('');
      setHasSendableText(false);
    }
  }, [
    activeTurnId,
    message,
    onSend,
    reportGeometryDiagnostic,
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
    keyboardInsetBottomRef.current = contentInset.bottom;
    tryPositionPendingAnchor();
  }, [tryPositionPendingAnchor]);

  const reportKeyboardBoundary = useCallback((event: string) => {
    reportGeometryDiagnostic(event);
    if (event === 'keyboard-end') tryPositionPendingAnchor();
  }, [reportGeometryDiagnostic, tryPositionPendingAnchor]);
  // Observe the SAME KeyboardProvider for arbitration/diagnostics. These
  // handlers do not set geometry, insets, offset or React state per frame.
  useGenericKeyboardHandler({
    onStart: () => { 'worklet'; keyboardInMotion.set(true); runOnJS(reportKeyboardBoundary)('keyboard-start'); },
    onInteractive: () => { 'worklet'; keyboardInMotion.set(true); },
    onEnd: () => { 'worklet'; keyboardInMotion.set(false); runOnJS(reportKeyboardBoundary)('keyboard-end'); },
  }, [keyboardInMotion, reportKeyboardBoundary]);
  useLayoutEffect(() => {
    // Completion only validates capacity; no terminal offset write or timer.
    if (activeTurnId === null && latestTurnId !== null) {
      updateAnchorBlankSpace();
      reportGeometryDiagnostic('terminal-completion');
    }
  }, [activeTurnId, latestTurnId, latestAssistantAttempt, reportGeometryDiagnostic, updateAnchorBlankSpace]);

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
        keyboardLiftBehavior={keyboardLiftEnabled ? 'whenAtEnd' : 'never'}
        offset={insets.bottom}
        extraContentPadding={composerScrollInset}
        blankSpace={blankSpace}
        // No native MVP writer: stable row separation + one explicit owner.
        applyWorkaroundForContentInsetHitTestBug={process.env.EXPO_OS === 'ios'}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        onLayout={handleViewportLayout}
        onContentSizeChange={handleContentSizeChange}
        onContentInsetChange={handleContentInsetChange}
        onEndVisible={handleEndVisible}
        onScroll={handleScroll}
        scrollEventThrottle={16}
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
                onLayout={handleUserRowLayout}
                onNativeLayout={handleUserNativeLayout}
                onPresentationChange={handleUserPresentationChange}
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

      <ChatEdgeFades background={palette.background} topHeight={transcriptTopPadding}
        composerHeight={composerScrollInset} safeAreaBottom={insets.bottom}
        keyboardProgress={keyboardAnimation.progress} breathingGap={CHAT_TRANSCRIPT_COMPOSER_GAP} />

      <KeyboardStickyView
        pointerEvents="box-none"
        style={styles.composerSticky}
        offset={{ closed: -insets.bottom, opened: 0 }}
      >
        <ChatScrollToBottomAffordance visible={scrollToBottomVisible}
          composerHeight={composerScrollInset} safeAreaBottom={insets.bottom}
          colorScheme={resolvedColorScheme} tint={palette.text}
          onPress={handleScrollToBottom} />
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

export const ChatUserMessageRow = memo(function ChatUserMessageRow({
  message,
  turnId,
  contentWidth,
  colorScheme,
  palette,
  onLayout,
  onNativeLayout,
  onPresentationChange,
  initiallyExpanded = false,
}: {
  message: ChatTurn['user'];
  turnId: string;
  contentWidth: number;
  colorScheme: 'light' | 'dark';
  palette: ReturnType<typeof getPalette>;
  onLayout: (turnId: string, y: number, height: number) => void;
  onNativeLayout: (turnId: string, width: number, height: number, mode: UserMessageMode) => void;
  onPresentationChange?: (turnId: string, mode: UserMessageMode) => void;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const { fontScale } = useWindowDimensions();
  const measurementContext = `${contentWidth}:${fontScale}`;
  const mode: UserMessageMode = expanded ? 'expanded' : 'collapsed';
  const presentation = useMemo(() => presentUserMessage(message.content, expanded), [message.content, expanded]);
  const [measuredHeights, setMeasuredHeights] = useState<UserMessageHeightCache>({ context: measurementContext, collapsed: null, expanded: null });
  const nativeHeight = userMessageHeightFloor(measuredHeights, measurementContext, mode);
  const togglePresentation = useCallback(() => {
    const nextMode = expanded ? 'collapsed' : 'expanded';
    beginChatPresentationTiming(turnId, nextMode, message.content.length, nativeHeight);
    onPresentationChange?.(turnId, nextMode);
    // Keep both trustworthy measurements; a mode switch never discards the floor.
    setExpanded(!expanded);
  }, [expanded, message.content.length, nativeHeight, onPresentationChange, turnId]);
  useLayoutEffect(() => {
    reportChatPresentationTiming(turnId, expanded ? 'expanded' : 'collapsed', 'commit', nativeHeight);
  }, [expanded, nativeHeight, turnId]);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    onLayout(turnId, y, height);
    reportChatSendTiming(turnId, 'react-row', height, presentation.collapsed);
    reportChatPresentationTiming(turnId, expanded ? 'expanded' : 'collapsed', 'react-row', height);
  }, [expanded, onLayout, presentation.collapsed, turnId]);
  const handleHostLayout = useCallback((event: { nativeEvent: { width: number; height: number } }) => {
    const { width, height } = event.nativeEvent;
    if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(width) || Math.abs(width - contentWidth) > 1) return;
    reportChatSendTiming(turnId, 'native-host', height, presentation.collapsed);
    reportChatPresentationTiming(turnId, expanded ? 'expanded' : 'collapsed', 'native-host', height);
    // This is actual SwiftUI content measurement, not a guessed text height.
    // A floor on BOTH containers prevents a delayed Fabric Host height from
    // leaving an RN sibling inside the user's painted native surface.
    setMeasuredHeights(previous => recordUserMessageHeight(previous, measurementContext, mode, height));
    onNativeLayout(turnId, width, height, mode);
  }, [contentWidth, expanded, measurementContext, mode, onNativeLayout, presentation.collapsed, turnId]);

  return (
    <View onLayout={handleLayout} style={{ width: contentWidth, alignSelf: 'stretch', minHeight: nativeHeight ?? undefined }}>
      <Host
        colorScheme={colorScheme}
        layoutDirection="leftToRight"
        // Transcript and Keyboard Controller already own all safe-area geometry.
        // SwiftUI must not position the bubble inside another inherited safe area.
        ignoreSafeArea="all"
        matchContents={{ vertical: true, horizontal: false }}
        style={{ width: contentWidth, minHeight: nativeHeight ?? undefined }}
        onLayoutContent={handleHostLayout}
      >
        <ChatUserBubble message={message} contentWidth={contentWidth} palette={palette} presentation={presentation} onToggle={togglePresentation} />
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
  presentation,
  onToggle,
}: {
  message: ChatTurn['user'];
  contentWidth: number;
  palette: ReturnType<typeof getPalette>;
  presentation: ReturnType<typeof presentUserMessage>;
  onToggle: () => void;
}) {
  const bubbleMaxWidth = contentWidth * 0.82;
  const messageAlignment = firstStrongTextDirection(message.content) === 'ltr' ? 'leading' : 'trailing';
  if (presentation.collapsible) return (
    <HStack alignment="top" spacing={0}>
      <Spacer minLength={0} />
      <VStack alignment="trailing" spacing={0} modifiers={[
        padding({ horizontal: 15, vertical: 11 }),
        background(palette.surfaceInset, shapes.roundedRectangle({ cornerRadius: CHAT_BUBBLE_CORNER_RADIUS, roundedCornerStyle: 'continuous' })),
        strokeBorder({ color: palette.border, style: { lineWidth: 0.8 }, shape: 'roundedRectangle', cornerRadius: CHAT_BUBBLE_CORNER_RADIUS }),
        frame({ maxWidth: bubbleMaxWidth, alignment: 'trailing' }),
      ]}>
        <Text modifiers={[font({ textStyle: 'body' }), foregroundStyle(palette.text), multilineTextAlignment(messageAlignment), lineSpacing(3), textSelection(true), fixedSize({ horizontal: false, vertical: true }), ...(presentation.collapsed ? [lineLimit(USER_MESSAGE_PRESENTATION.previewVisualLines)] : [])]}>{presentation.text}</Text>
        <Button onPress={onToggle} modifiers={[buttonStyle('plain'), accessibilityLabel(presentation.collapsed ? 'عرض الرسالة كاملة' : 'عرض الرسالة مختصرة'), foregroundStyle(palette.textSecondary)]}>
          <HStack spacing={6} modifiers={[padding({ top: 4 }), frame({ minHeight: 44, alignment: messageAlignment }), contentShape(shapes.rectangle())]}>
            <Image systemName={presentation.collapsed ? 'chevron.down' : 'chevron.up'} modifiers={[font({ size: 12, weight: 'semibold' })]} />
            <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' })]}>{presentation.collapsed ? 'عرض المزيد' : 'عرض أقل'}</Text>
          </HStack>
        </Button>
      </VStack>
    </HStack>
  );
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
      {status === 'thinking' ? 'يفكّر...' : 'جارٍ العمل...'}
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
