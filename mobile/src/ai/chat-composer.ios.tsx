import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import * as Clipboard from 'expo-clipboard';
import { AccessibilityInfo } from 'react-native';
import {
  Button,
  Circle,
  HStack,
  Host,
  Image,
  Rectangle,
  ScrollView,
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
  defaultScrollAnchorForRole,
  fixedSize,
  font,
  frame,
  foregroundStyle,
  glassEffect,
  id,
  lineSpacing,
  lineLimit,
  multilineTextAlignment,
  onTapGesture,
  onAppear,
  opacity,
  padding,
  scrollPosition,
  scrollTargetLayout,
  shapes,
  strokeBorder,
  textSelection,
  textFieldStyle,
} from '@expo/ui/swift-ui/modifiers';
import { getAgent1AssistantActionPolicy, toggleChatReaction } from './agent-1-chat-state';
import type { ChatComposerProps, ChatReaction, ChatTurn } from './chat-types';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette } from '@/theme';

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
const COPY_FEEDBACK_DURATION_MS = 1_300;
const CHAT_TOP_CONTROLS_HEIGHT = 44;
const CHAT_TRANSCRIPT_TOP_GAP = 20;
const ASSISTANT_ACTION_LAYOUT_SIZE = 32;
const ASSISTANT_ACTION_ICON_SIZE = 17;
const ASSISTANT_ACTION_SPACING = 3;
const STATUS_SWEEP_HALF_CYCLE_MS = 700;
const STATUS_SWEEP_TRANSITION_SECONDS = 0.65;
const STATUS_SWEEP_WIDTH = 0.4;
const STATUS_USER_MESSAGE_EXTRA_GAP = 5;

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
  const transcriptContentWidth = Math.max(
    0,
    transcriptWidth - TRANSCRIPT_HORIZONTAL_INSET * 2,
  );
  const message = useNativeState('');
  const scrollPositionState = useNativeState<string | null>(null);
  const textFieldRef = useRef<TextFieldRef | null>(null);
  const draftRef = useRef('');
  const pendingScrollTurnIdRef = useRef<string | null>(null);
  const copyFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousLatestAttemptRef = useRef<{ turnId: string; attempt: number } | null>(null);
  const [hasSendableText, setHasSendableText] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Record<string, ChatReaction>>({});
  const latestTurn = turns[turns.length - 1];
  const latestTurnId = latestTurn?.id ?? null;
  const latestAssistantAttempt = latestTurn?.assistantAttempt ?? null;

  const dismissKeyboard = useCallback(() => {
    void textFieldRef.current?.blur();
  }, []);
  const focusTextField = useCallback(() => {
    void textFieldRef.current?.focus();
  }, []);
  const handleTextChange = useCallback((text: string) => {
    draftRef.current = text;
    setHasSendableText(text.trim().length > 0);
  }, []);
  const handleSend = useCallback(() => {
    const text = draftRef.current;
    if (!text.trim() || activeTurnId) return;
    const acceptedTurnId = onSend(text);
    if (acceptedTurnId) {
      if (turns.length > 0) pendingScrollTurnIdRef.current = acceptedTurnId;
      draftRef.current = '';
      message.set('');
      setHasSendableText(false);
    }
  }, [activeTurnId, message, onSend, turns.length]);

  useEffect(() => {
    const targetId = pendingScrollTurnIdRef.current;
    if (!targetId || targetId !== latestTurnId) return;
    pendingScrollTurnIdRef.current = null;
    scrollPositionState.set(targetId);
  }, [latestTurnId, scrollPositionState]);

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
    <Host
      colorScheme={resolvedColorScheme}
      layoutDirection="leftToRight"
      modifiers={[background(palette.background)]}
      style={{ flex: 1 }}
    >
      <ZStack>
        <Rectangle
          modifiers={[
            foregroundStyle('clear'),
            contentShape(shapes.rectangle()),
            // Expo UI stores this callback for native SwiftUI tap events; it is not run during render.
            // eslint-disable-next-line react-hooks/refs
            onTapGesture(dismissKeyboard),
          ]}
        />
        {turns.length > 0 || submissionError ? (
          <ScrollView
            showsIndicators={false}
            modifiers={[
              defaultScrollAnchorForRole('top', 'initialOffset'),
              defaultScrollAnchorForRole(null, 'sizeChanges'),
              defaultScrollAnchorForRole('top', 'alignment'),
              scrollPosition(scrollPositionState, { anchor: 'top' }),
              // Keep the approved tap-outside blur behavior while allowing normal native scrolling.
              // eslint-disable-next-line react-hooks/refs
              onTapGesture(dismissKeyboard),
            ]}
          >
            <VStack
              alignment="leading"
              spacing={CHAT_TURN_SPACING}
              modifiers={[
                padding({
                  top: CHAT_TOP_CONTROLS_HEIGHT + CHAT_TRANSCRIPT_TOP_GAP,
                  horizontal: TRANSCRIPT_HORIZONTAL_INSET,
                  bottom: COMPOSER_MIN_HEIGHT + 24,
                }),
                ...(transcriptWidth > 0
                  ? [frame({ maxWidth: transcriptWidth, alignment: 'leading' as const })]
                  : []),
                scrollTargetLayout(),
              ]}
            >
              {turns.map((turn, index) => (
                <ChatTranscriptTurn
                  key={turn.id}
                  turn={turn}
                  isLatest={index === turns.length - 1}
                  isActive={activeTurnId === turn.id}
                  contentWidth={transcriptContentWidth}
                  palette={palette}
                  reaction={turn.assistant ? reactions[turn.assistant.id] : undefined}
                  copied={turn.assistant?.id === copiedMessageId}
                  onCopy={handleCopy}
                  onReaction={handleReaction}
                  onRegenerate={onRegenerate}
                />
              ))}
              {submissionError ? (
                <ChatInlineNotice message={submissionError} contentWidth={transcriptContentWidth} palette={palette} />
              ) : null}
            </VStack>
          </ScrollView>
        ) : null}
        <ChatComposerControls
          message={message}
          textFieldRef={textFieldRef}
          palette={palette}
          hasSendableText={hasSendableText}
          sendDisabled={activeTurnId !== null}
          onTextChange={handleTextChange}
          onFocus={focusTextField}
          onSend={handleSend}
        />
      </ZStack>
    </Host>
  );
}

const ChatComposerControls = memo(function ChatComposerControls({
  message,
  textFieldRef,
  palette,
  hasSendableText,
  sendDisabled,
  onTextChange,
  onFocus,
  onSend,
}: {
  message: ReturnType<typeof useNativeState<string>>;
  textFieldRef: RefObject<TextFieldRef | null>;
  palette: ReturnType<typeof getPalette>;
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
        padding({ horizontal: 16, bottom: 10 }),
        containerRelativeFrame({ axes: 'horizontal' }),
      ]}
    >
      <Spacer />
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
                  multilineTextAlignment('trailing'),
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
  palette,
  reaction,
  copied,
  onCopy,
  onReaction,
  onRegenerate,
}: {
  turn: ChatTurn;
  isLatest: boolean;
  isActive: boolean;
  contentWidth: number;
  palette: ReturnType<typeof getPalette>;
  reaction?: ChatReaction;
  copied: boolean;
  onCopy: (messageId: string, content: string) => Promise<void>;
  onReaction: (messageId: string, reaction: ChatReaction) => void;
  onRegenerate: (turnId: string) => void;
}) {
  const assistant = turn.assistant;
  const actionPolicy = getAgent1AssistantActionPolicy(turn, isLatest, isActive);
  const showRegenerateOnly = actionPolicy.showRegenerate && !actionPolicy.showFeedback;
  const handleRegenerate = useCallback(() => onRegenerate(turn.id), [onRegenerate, turn.id]);

  return (
    <VStack
      alignment="leading"
      spacing={CHAT_TURN_CONTENT_SPACING}
      modifiers={[
        id(turn.id),
        ...(contentWidth > 0
          ? [frame({ maxWidth: contentWidth, alignment: 'leading' as const })]
          : []),
      ]}
    >
      <ChatUserBubble message={turn.user} contentWidth={contentWidth} palette={palette} />

      {actionPolicy.showStatus &&
      (turn.assistantStatus === 'working' || turn.assistantStatus === 'thinking') ? (
        <Agent1TurnStatus status={turn.assistantStatus} palette={palette} />
      ) : null}

      {assistant ? (
        <Text
          modifiers={[
            font({ textStyle: 'body' }),
            foregroundStyle(palette.text),
            multilineTextAlignment('leading'),
            lineSpacing(3),
            textSelection(true),
            fixedSize({ horizontal: false, vertical: true }),
            ...(contentWidth > 0
              ? [frame({ maxWidth: contentWidth, alignment: 'leading' as const })]
              : []),
          ]}
        >
          {assistant.content}
        </Text>
      ) : null}

      {turn.errorMessage && (actionPolicy.showIncompleteNotice || actionPolicy.showError) ? (
        <ChatInlineNotice message={turn.errorMessage} contentWidth={contentWidth} palette={palette} />
      ) : null}

      {actionPolicy.showFeedback && assistant ? (
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
      ) : showRegenerateOnly ? (
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
      ) : null}
    </VStack>
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
  return (
    <HStack alignment="top" spacing={0}>
      <Spacer minLength={0} />
      <Text
        modifiers={[
          font({ textStyle: 'body' }),
          foregroundStyle(palette.text),
          multilineTextAlignment('trailing'),
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
        padding({ top: STATUS_USER_MESSAGE_EXTRA_GAP }),
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
