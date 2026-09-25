import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import * as Clipboard from 'expo-clipboard';
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
  padding,
  scrollPosition,
  scrollTargetLayout,
  shapes,
  symbolEffect,
  strokeBorder,
  textSelection,
  textFieldStyle,
} from '@expo/ui/swift-ui/modifiers';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { canRegenerateAgent1Turn, toggleChatReaction } from './agent-1-chat-state';
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
                  top: insets.top + 68,
                  horizontal: TRANSCRIPT_HORIZONTAL_INSET,
                  bottom: COMPOSER_MIN_HEIGHT + 24,
                }),
                ...(transcriptWidth > 0
                  ? [frame({ maxWidth: transcriptWidth, alignment: 'leading' as const })]
                  : []),
                scrollTargetLayout(),
              ]}
            >
              {turns.map((turn) => (
                <ChatTranscriptTurn
                  key={turn.id}
                  turn={turn}
                  isActive={activeTurnId === turn.id}
                  canRegenerate={canRegenerateAgent1Turn(turns, turn.id, activeTurnId)}
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
  isActive,
  canRegenerate,
  contentWidth,
  palette,
  reaction,
  copied,
  onCopy,
  onReaction,
  onRegenerate,
}: {
  turn: ChatTurn;
  isActive: boolean;
  canRegenerate: boolean;
  contentWidth: number;
  palette: ReturnType<typeof getPalette>;
  reaction?: ChatReaction;
  copied: boolean;
  onCopy: (messageId: string, content: string) => Promise<void>;
  onReaction: (messageId: string, reaction: ChatReaction) => void;
  onRegenerate: (turnId: string) => void;
}) {
  const assistant = turn.assistant;
  const isCompleted = turn.assistantStatus === 'completed' && Boolean(assistant);
  const isIncomplete = turn.assistantStatus === 'incomplete' && Boolean(assistant);
  const showRegenerateOnly = canRegenerate && (isActive || isIncomplete);
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

      {turn.assistantStatus === 'working' || turn.assistantStatus === 'thinking' ? (
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

      {turn.errorMessage ? (
        <ChatInlineNotice message={turn.errorMessage} contentWidth={contentWidth} palette={palette} />
      ) : null}

      {isCompleted && assistant ? (
        <ChatAssistantActions
          assistantId={assistant.id}
          content={assistant.content}
          palette={palette}
          reaction={reaction}
          copied={copied}
          showFeedback
          showRegenerate={canRegenerate}
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
  return (
    <HStack alignment="center" spacing={8}>
      <Image
        systemName="brain"
        size={16}
        color={palette.textSecondary}
        modifiers={[
          symbolEffect(
            { effect: 'breathe', style: 'pulse' },
            { options: { repeat: 'continuous', speed: 0.8 } },
          ),
        ]}
      />
      <Text
        modifiers={[
          foregroundStyle(palette.textSecondary),
          font({ textStyle: 'footnote' }),
        ]}
      >
        {status === 'thinking' ? 'Thinking' : 'Working'}
      </Text>
    </HStack>
  );
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
    <HStack alignment="center" spacing={8}>
      {showFeedback ? (
        <>
          <Button
            onPress={() => void onCopy(assistantId, content)}
            modifiers={[
              buttonStyle('plain'),
              frame({ width: ACTION_BUTTON_HIT_TARGET, height: ACTION_BUTTON_HIT_TARGET, alignment: 'center' }),
              contentShape(shapes.rectangle()),
              accessibilityLabel(copied ? 'تم نسخ الرد' : 'نسخ الرد'),
            ]}
          >
            <Image systemName={copied ? 'checkmark' : 'doc.on.doc'} size={18} color={palette.textSecondary} />
          </Button>
          <Button
            onPress={() => onReaction(assistantId, 'like')}
            modifiers={[
              buttonStyle('plain'),
              frame({ width: ACTION_BUTTON_HIT_TARGET, height: ACTION_BUTTON_HIT_TARGET, alignment: 'center' }),
              contentShape(shapes.rectangle()),
              accessibilityLabel(reaction === 'like' ? 'إعجاب، محدد' : 'إعجاب'),
            ]}
          >
            <Image systemName="hand.thumbsup" size={18} color={reaction === 'like' ? palette.text : palette.textSecondary} />
          </Button>
          <Button
            onPress={() => onReaction(assistantId, 'dislike')}
            modifiers={[
              buttonStyle('plain'),
              frame({ width: ACTION_BUTTON_HIT_TARGET, height: ACTION_BUTTON_HIT_TARGET, alignment: 'center' }),
              contentShape(shapes.rectangle()),
              accessibilityLabel(reaction === 'dislike' ? 'عدم إعجاب، محدد' : 'عدم إعجاب'),
            ]}
          >
            <Image systemName="hand.thumbsdown" size={18} color={reaction === 'dislike' ? palette.text : palette.textSecondary} />
          </Button>
        </>
      ) : null}
      {showRegenerate ? (
        <Button
          onPress={onRegenerate}
          modifiers={[
            buttonStyle('plain'),
            frame({ width: ACTION_BUTTON_HIT_TARGET, height: ACTION_BUTTON_HIT_TARGET, alignment: 'center' }),
            contentShape(shapes.rectangle()),
            accessibilityLabel('إعادة إنشاء الرد'),
          ]}
        >
          <Image systemName="arrow.clockwise" size={18} color={palette.textSecondary} />
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
