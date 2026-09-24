import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useWindowDimensions,
} from 'react-native';
import {
  Button,
  Circle,
  HStack,
  Host,
  Image,
  ProgressView,
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
  controlSize,
  contentShape,
  disabled,
  defaultScrollAnchor,
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
  strokeBorder,
  textSelection,
  textFieldStyle,
} from '@expo/ui/swift-ui/modifiers';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ChatComposerProps, ChatMessage } from './chat-types';
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

export function ChatComposer({
  messages,
  onSend,
  sending = false,
  errorMessage,
}: ChatComposerProps) {
  const { resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const message = useNativeState('');
  const scrollPositionState = useNativeState<string | null>(null);
  const textFieldRef = useRef<TextFieldRef | null>(null);
  const draftRef = useRef('');
  const [hasSendableText, setHasSendableText] = useState(false);
  const latestMessageId = messages[messages.length - 1]?.id ?? null;

  const dismissKeyboard = useCallback(() => {
    void textFieldRef.current?.blur();
  }, []);
  const handleTextChange = useCallback((text: string) => {
    draftRef.current = text;
    setHasSendableText(text.trim().length > 0);
  }, []);
  const handleSend = useCallback(async () => {
    const text = draftRef.current;
    if (!text.trim() || sending) return;
    try {
      const sent = await onSend(text);
      if (sent) {
        draftRef.current = '';
        message.set('');
        setHasSendableText(false);
      }
    } catch {
      // Keep the native draft intact when a send does not complete.
    }
  }, [message, onSend, sending]);

  useEffect(() => {
    if (latestMessageId) scrollPositionState.set(latestMessageId);
  }, [latestMessageId, scrollPositionState]);

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
        <VStack
          alignment="leading"
          spacing={0}
          modifiers={[
            padding({ horizontal: 16, bottom: 10 }),
            containerRelativeFrame({ axes: 'horizontal' }),
          ]}
        >
          {messages.length > 0 || sending || errorMessage ? (
            <ScrollView
              showsIndicators={false}
              modifiers={[
                defaultScrollAnchor('bottom'),
                scrollPosition(scrollPositionState, { anchor: 'bottom' }),
                // Keep the approved tap-outside blur behavior while allowing normal native scrolling.
                // eslint-disable-next-line react-hooks/refs
                onTapGesture(dismissKeyboard),
              ]}
            >
              <VStack
                alignment="trailing"
                spacing={22}
                modifiers={[
                  scrollTargetLayout(),
                  padding({ top: insets.top + 68, horizontal: 5, bottom: 14 }),
                ]}
              >
                {messages.map((chatMessage) => (
                  <ChatTranscriptMessage
                    key={chatMessage.id}
                    message={chatMessage}
                    containerWidth={width}
                    palette={palette}
                  />
                ))}
                {sending ? (
                  <HStack alignment="center" spacing={9} modifiers={[id('agent-1-chat-pending')]}>
                    <Spacer minLength={0} />
                    <ProgressView
                      modifiers={[controlSize('small'), foregroundStyle(palette.textSecondary)]}
                    />
                    <Text
                      modifiers={[
                        foregroundStyle(palette.textSecondary),
                        font({ textStyle: 'subheadline' }),
                      ]}
                    >
                      يرد Agent 1...
                    </Text>
                  </HStack>
                ) : null}
                {errorMessage ? (
                  <HStack spacing={0} modifiers={[id('agent-1-chat-error')]}>
                    <Spacer minLength={0} />
                    <Text
                      modifiers={[
                        foregroundStyle(palette.textSecondary),
                        font({ textStyle: 'footnote' }),
                        multilineTextAlignment('trailing'),
                        fixedSize({ horizontal: false, vertical: true }),
                      ]}
                    >
                      {errorMessage}
                    </Text>
                  </HStack>
                ) : null}
              </VStack>
            </ScrollView>
          ) : (
            <Spacer />
          )}
          <VStack
            alignment="leading"
            spacing={0}
            modifiers={[
              fixedSize({ horizontal: false, vertical: true }),
              frame({ minHeight: COMPOSER_MIN_HEIGHT, alignment: 'topLeading' }),
              glassEffect({
                glass: { variant: 'regular', interactive: true, tint: palette.surface },
                shape: 'roundedRectangle',
                cornerRadius: COMPOSER_CORNER_RADIUS,
              }),
              strokeBorder({
                color: palette.border,
                style: { lineWidth: 0.6 },
                shape: 'roundedRectangle',
                cornerRadius: COMPOSER_CORNER_RADIUS,
              }),
            ]}
          >
            <TextField
              ref={textFieldRef}
              axis="vertical"
              text={message}
              onTextChange={handleTextChange}
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
                onPress={() => void handleSend()}
                modifiers={[
                  disabled(!hasSendableText || sending),
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
        </VStack>
      </ZStack>
    </Host>
  );
}

function ChatTranscriptMessage({
  message,
  containerWidth,
  palette,
}: {
  message: ChatMessage;
  containerWidth: number;
  palette: ReturnType<typeof getPalette>;
}) {
  const isUser = message.role === 'user';

  return (
    <HStack alignment="top" spacing={0} modifiers={[id(message.id)]}>
      <Spacer minLength={0} />
      <Text
        modifiers={[
          font({ textStyle: 'body' }),
          foregroundStyle(palette.text),
          multilineTextAlignment('trailing'),
          lineSpacing(3),
          textSelection(true),
          fixedSize({ horizontal: false, vertical: true }),
          frame({
            maxWidth: isUser ? containerWidth * 0.82 : containerWidth,
            alignment: 'trailing',
          }),
          ...(isUser
            ? [
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
              ]
            : []),
        ]}
      >
        {message.content}
      </Text>
    </HStack>
  );
}
