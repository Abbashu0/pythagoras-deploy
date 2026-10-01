import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  AccessibilityInfo,
  Dimensions,
  Keyboard,
  Pressable,
  ScrollView as RNScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ScrollView as RNScrollViewInstance,
} from 'react-native';
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

export function ChatComposer({
  turns,
  onSend,
  onRegenerate,
  activeTurnId,
  submissionError,
  transcriptWidth,
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
  const transcriptScrollRef = useRef<RNScrollViewInstance | null>(null);
  const turnLayoutYRef = useRef(new Map<string, number>());
  const pendingNewTurnScrollRef = useRef<string | null>(null);
  const composerHeightRef = useRef(COMPOSER_MIN_HEIGHT + COMPOSER_BOTTOM_PADDING);
  const [composerHeight, setComposerHeight] = useState(composerHeightRef.current);
  const textFieldRef = useRef<TextFieldRef | null>(null);
  const draftRef = useRef('');
  const copyFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousLatestAttemptRef = useRef<{ turnId: string; attempt: number } | null>(null);
  const [hasSendableText, setHasSendableText] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Record<string, ChatReaction>>({});
  const latestTurn = turns[turns.length - 1];
  const latestTurnId = latestTurn?.id ?? null;
  const latestAssistantAttempt = latestTurn?.assistantAttempt ?? null;

  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
    void textFieldRef.current?.blur();
  }, []);
  const focusTextField = useCallback(() => {
    void textFieldRef.current?.focus();
  }, []);
  const handleComposerHeightChange = useCallback((nextHeight: number) => {
    if (nextHeight <= 0 || Math.abs(composerHeightRef.current - nextHeight) < 0.5) return;
    composerHeightRef.current = nextHeight;
    setComposerHeight(nextHeight);
  }, []);
  const handleTurnLayout = useCallback((turnId: string, layoutY: number) => {
    turnLayoutYRef.current.set(turnId, layoutY);
    if (pendingNewTurnScrollRef.current !== turnId) return;
    pendingNewTurnScrollRef.current = null;
    transcriptScrollRef.current?.scrollTo({
      y: Math.max(0, layoutY - transcriptTopPadding),
      animated: true,
    });
  }, [transcriptTopPadding]);
  const handleTextChange = useCallback((text: string) => {
    draftRef.current = text;
    setHasSendableText(text.trim().length > 0);
  }, []);
  const handleSend = useCallback(() => {
    const text = draftRef.current;
    if (!text.trim() || activeTurnId) return;
    const acceptedTurnId = onSend(text);
    if (acceptedTurnId) {
      if (turns.length > 0) {
        pendingNewTurnScrollRef.current = acceptedTurnId;
      }
      draftRef.current = '';
      message.set('');
      setHasSendableText(false);
    }
  }, [activeTurnId, message, onSend, turns.length]);

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

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Host
        colorScheme={resolvedColorScheme}
        layoutDirection="leftToRight"
        pointerEvents="box-none"
        style={StyleSheet.absoluteFill}
      >
        <VStack alignment="leading" spacing={0}>
          <Spacer />
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
        </VStack>
      </Host>

      <ChatKeyboardViewport
        composerHeight={composerHeight}
        safeAreaBottom={insets.bottom}
      >
        <RNScrollView
          ref={transcriptScrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: transcriptTopPadding,
            paddingHorizontal: TRANSCRIPT_HORIZONTAL_INSET,
            paddingBottom: CHAT_TRANSCRIPT_COMPOSER_GAP,
            gap: CHAT_TURN_SPACING,
          }}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onTouchEnd={dismissKeyboard}
        >
          {turns.map((turn, index) => (
            <ChatTranscriptTurn
              key={turn.id}
              turn={turn}
              isLatest={index === turns.length - 1}
              isActive={activeTurnId === turn.id}
              contentWidth={transcriptContentWidth}
              colorScheme={resolvedColorScheme}
              palette={palette}
              reaction={turn.assistant ? reactions[turn.assistant.id] : undefined}
              copied={turn.assistant?.id === copiedMessageId}
              onLayout={(event) =>
                handleTurnLayout(turn.id, event.nativeEvent.layout.y)
              }
              onCopy={handleCopy}
              onReaction={handleReaction}
              onRegenerate={onRegenerate}
            />
          ))}
          {submissionError ? (
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
          ) : null}
        </RNScrollView>
      </ChatKeyboardViewport>
      </View>
  );
}

function ChatKeyboardViewport({
  children,
  composerHeight,
  safeAreaBottom,
}: {
  children: ReactNode;
  composerHeight: number;
  safeAreaBottom: number;
}) {
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardWillShow', (event) => {
      Keyboard.scheduleLayoutAnimation(event);
      const screenHeight = Dimensions.get('screen').height;
      setKeyboardInset(Math.max(0, screenHeight - event.endCoordinates.screenY));
    });
    const hideSubscription = Keyboard.addListener('keyboardWillHide', (event) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardInset(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  return (
    <View
      pointerEvents="box-none"
      style={[
        StyleSheet.absoluteFill,
        { bottom: Math.max(keyboardInset, safeAreaBottom) + composerHeight },
      ]}
    >
      {children}
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

const ChatTranscriptTurn = memo(function ChatTranscriptTurn({
  turn,
  isLatest,
  isActive,
  contentWidth,
  colorScheme,
  palette,
  reaction,
  copied,
  onLayout,
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
  reaction?: ChatReaction;
  copied: boolean;
  onLayout: (event: LayoutChangeEvent) => void;
  onCopy: (messageId: string, content: string) => Promise<void>;
  onReaction: (messageId: string, reaction: ChatReaction) => void;
  onRegenerate: (turnId: string) => void;
}) {
  const assistant = turn.assistant;
  const actionPolicy = getAgent1AssistantActionPolicy(turn, isLatest, isActive);
  const showRegenerateOnly = actionPolicy.showRegenerate && !actionPolicy.showFeedback;
  const showStatus =
    actionPolicy.showStatus &&
    (turn.assistantStatus === 'working' || turn.assistantStatus === 'thinking');
  const showError =
    Boolean(turn.errorMessage) &&
    (actionPolicy.showIncompleteNotice || actionPolicy.showError);
  const showResponse = showStatus || Boolean(assistant) || showError || showRegenerateOnly;
  const lastResponseLayoutDiagnosticRef = useRef('');
  const handleRegenerate = useCallback(() => onRegenerate(turn.id), [onRegenerate, turn.id]);
  const handleResponseLayout = useCallback((event: LayoutChangeEvent) => {
    if (__DEV__ && assistant && turn.assistantStatus !== 'streaming') {
      const height = event.nativeEvent.layout.height;
      const diagnosticKey = `${assistant.id}:${assistant.content.length}:${contentWidth}:${height}`;
      if (lastResponseLayoutDiagnosticRef.current !== diagnosticKey) {
        lastResponseLayoutDiagnosticRef.current = diagnosticKey;
        console.info('[Agent1 transcript diagnostics] response block', {
          messageId: assistant.id,
          sourceCharacters: assistant.content.length,
          contentWidth,
          blockHeight: height,
        });
      }
    }
  }, [assistant, contentWidth, turn.assistantStatus]);

  return (
    <View onLayout={onLayout} style={{ width: '100%', alignSelf: 'stretch' }}>
      <Host
        colorScheme={colorScheme}
        layoutDirection="leftToRight"
        matchContents={{ vertical: true, horizontal: false }}
        style={{ width: contentWidth }}
      >
        <ChatUserBubble message={turn.user} contentWidth={contentWidth} palette={palette} />
      </Host>

      {showResponse ? (
        <View
          onLayout={handleResponseLayout}
          style={{
            width: contentWidth,
            alignSelf: 'stretch',
            paddingTop: USER_TO_ASSISTANT_GAP,
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
                status={turn.assistantStatus as 'working' | 'thinking'}
                palette={palette}
              />
            </Host>
          ) : null}

          {assistant ? (
            <Agent1AssistantMarkdown
              messageId={assistant.id}
              content={assistant.content}
              streaming={turn.assistantStatus === 'streaming'}
              contentWidth={contentWidth}
              palette={palette}
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
                assistantId={assistant?.id ?? `${turn.id}-assistant-${turn.assistantAttempt}`}
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
