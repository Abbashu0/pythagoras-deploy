import { memo, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { runOnJS } from 'react-native-reanimated';
import { BottomSheet, type BottomSheetMethods } from '@expo/ui/community/bottom-sheet';
import {
  Button, Circle, HStack, Host, Image, Rectangle, ScrollView, Spacer, Text, TextField,
  VStack, ZStack, type useNativeState, type TextFieldRef, type TextFieldSelection,
} from '@expo/ui/swift-ui';
import {
  accessibilityHidden, accessibilityLabel, animation, Animation, buttonStyle,
  containerRelativeFrame, contentShape, disabled, fixedSize, font, foregroundStyle,
  frame, glassEffect, hidden, lineLimit, multilineTextAlignment, onAppear,
  onGeometryChange, onTapGesture, padding, shapes, textFieldStyle,
} from '@expo/ui/swift-ui/modifiers';
import type { getPalette } from '@/theme';
import {
  ACTION_BUTTON_DIAMETER, ACTION_BUTTON_HIT_TARGET, ACTION_ROW_BOTTOM_INSET,
  COMPOSER_BOTTOM_PADDING, COMPOSER_COMPACT_CORNER_RADIUS, COMPOSER_COMPACT_HEIGHT,
  COMPOSER_COMPACT_HORIZONTAL_INSET, COMPOSER_EXPANDED_CORNER_RADIUS,
  COMPOSER_EXPANDED_HORIZONTAL_INSET, COMPOSER_EXPANDED_MIN_HEIGHT,
  getChatComposerPresentation, getChatComposerVisualOverflow, isChatComposerDraftSendable, type ComposerTextMeasurement,
} from './chat-composer-presentation';

type Palette = ReturnType<typeof getPalette>;
const TEXT_HORIZONTAL_PADDING = 18;
const EXPANDED_TEXT_FIELD_MIN_HEIGHT =
  COMPOSER_EXPANDED_MIN_HEIGHT - ACTION_BUTTON_HIT_TARGET - ACTION_ROW_BOTTOM_INSET;
const SHEET_SNAP_POINTS = ['100%'];
const styles = StyleSheet.create({ host: { width: '100%' }, editorHost: { flex: 1 } });

export const ChatComposerControls = memo(function ChatComposerControls({
  message, textFieldRef, palette, colorScheme, onComposerHeightChange,
  hasSendableText, sendDisabled, onTextChange, onFocus, onSend,
}: {
  message: ReturnType<typeof useNativeState<string>>;
  textFieldRef: RefObject<TextFieldRef | null>;
  palette: Palette;
  colorScheme: 'light' | 'dark';
  onComposerHeightChange: (height: number) => void;
  hasSendableText: boolean;
  sendDisabled: boolean;
  onTextChange: (text: string) => void;
  onFocus: () => void;
  onSend: () => boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [sheetPresented, setSheetPresented] = useState(false);
  // Read-only projection for the Text probes. Both editable fields bind ONLY message.
  const [draftSnapshot, setDraftSnapshot] = useState(() => message.get());
  const [visualOverflow, setVisualOverflow] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const mountedRef = useRef(true);
  const sendPendingRef = useRef(false);
  const selectionRef = useRef<TextFieldSelection | null>(null);
  const sheetRef = useRef<BottomSheetMethods | null>(null);
  const sheetFieldRef = useRef<TextFieldRef | null>(null);

  const syncNativeDraft = useCallback((text: string) => {
    if (!mountedRef.current) return;
    setDraftSnapshot(text);
    if (text.length === 0) {
      sendPendingRef.current = false;
      setVisualOverflow(false);
    }
  }, []);
  /* eslint-disable react-hooks/immutability -- Expo ObservableState is a native SharedObject; its supported subscription API assigns onChange. */
  useEffect(() => {
    mountedRef.current = true;
    // Includes programmatic Send clears, which TextField.onTextChange intentionally omits.
    message.onChange = (text: string) => {
      'worklet';
      runOnJS(syncNativeDraft)(text);
    };
    return () => {
      mountedRef.current = false;
      message.onChange = null;
    };
  }, [message, syncNativeDraft]);
  /* eslint-enable react-hooks/immutability */
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);

  const presentation = getChatComposerPresentation({
    focused, draftLength: draftSnapshot.length, sheetPresented, visualOverflow,
  });
  const compact = presentation.mode === 'compact';
  const minimumHeight = compact ? COMPOSER_COMPACT_HEIGHT : COMPOSER_EXPANDED_MIN_HEIGHT;
  const horizontalInset = compact ? COMPOSER_COMPACT_HORIZONTAL_INSET : COMPOSER_EXPANDED_HORIZONTAL_INSET;
  const cornerRadius = compact ? COMPOSER_COMPACT_CORNER_RADIUS : COMPOSER_EXPANDED_CORNER_RADIUS;
  const reportOverflow = useCallback((overflow: boolean) => {
    if (!mountedRef.current) return;
    setVisualOverflow(message.get().length > 0 && overflow);
  }, [message]);
  const openEditor = useCallback(() => {
    setSheetPresented(true);
    void textFieldRef.current?.blur();
  }, [textFieldRef]);
  const closeEditor = useCallback(() => {
    void sheetFieldRef.current?.blur();
    sheetRef.current?.close();
  }, []);
  const editorDismissed = useCallback(() => {
    setSheetPresented(false);
    void textFieldRef.current?.blur();
    const selection = selectionRef.current;
    if (selection) void textFieldRef.current?.setSelection(selection.start, selection.end);
  }, [textFieldRef]);
  const editorAppeared = useCallback(() => {
    const selection = selectionRef.current;
    if (selection) void sheetFieldRef.current?.setSelection(selection.start, selection.end);
  }, []);
  const focusEditor = useCallback(() => { void sheetFieldRef.current?.focus(); }, []);
  const submitDraft = useCallback(() => {
    if (sendPendingRef.current || sendDisabled) return;
    const draft = message.get();
    if (!isChatComposerDraftSendable(draft)) return;
    sendPendingRef.current = true;
    // Synchronize the existing draftRef immediately before the shared Send path.
    let accepted = false;
    try {
      onTextChange(draft);
      accepted = onSend();
    } finally {
      if (!accepted) sendPendingRef.current = false;
    }
    if (accepted && sheetPresented) closeEditor();
  }, [closeEditor, message, onSend, onTextChange, sendDisabled, sheetPresented]);

  return (
    <>
      <Host colorScheme={colorScheme} layoutDirection="leftToRight" ignoreSafeArea="all"
        matchContents={{ vertical: true, horizontal: false }} pointerEvents="box-none" style={styles.host}>
        <VStack alignment="leading" spacing={0} modifiers={[
          padding({ horizontal: horizontalInset, bottom: COMPOSER_BOTTOM_PADDING }),
          containerRelativeFrame({ axes: 'horizontal' }),
          animation(reduceMotion ? Animation.linear({ duration: 0 }) : Animation.spring({ duration: 0.28, bounce: 0 }), !compact),
          onGeometryChange(({ height }) => onComposerHeightChange(height)),
        ]}>
          <ZStack alignment="bottom" modifiers={[
            fixedSize({ horizontal: false, vertical: true }),
            frame({ minHeight: minimumHeight, alignment: 'topLeading' }),
            glassEffect({ glass: { variant: 'regular', interactive: true, tint: palette.surface },
              shape: 'roundedRectangle', cornerRadius }),
          ]}>
            <Rectangle modifiers={[foregroundStyle('clear'), frame({ minHeight: minimumHeight }),
              contentShape(shapes.rectangle()), onTapGesture(onFocus)]} />
            <VStack alignment="leading" spacing={0}>
              <TextField ref={textFieldRef} axis="vertical" text={message}
                onTextChange={onTextChange} onFocusChange={setFocused}
                onSelectionChange={selection => { if (!sheetPresented) selectionRef.current = selection; }}
                modifiers={[
                  textFieldStyle('plain'), lineLimit({ min: 1, max: 5 }),
                  fixedSize({ horizontal: false, vertical: true }), multilineTextAlignment('trailing'),
                  font({ textStyle: 'body' }),
                  padding({ top: compact ? 0 : 14, bottom: compact ? 0 : 6,
                    leading: compact ? 52 : TEXT_HORIZONTAL_PADDING,
                    trailing: compact ? 52 : TEXT_HORIZONTAL_PADDING + (presentation.showExpand ? ACTION_BUTTON_HIT_TARGET : 0) }),
                  frame({ minHeight: compact ? COMPOSER_COMPACT_HEIGHT : EXPANDED_TEXT_FIELD_MIN_HEIGHT,
                    alignment: compact ? 'center' : 'topLeading' }),
                  contentShape(shapes.rectangle()),
                ]}>
                <ComposerPlaceholder color={palette.textTertiary} />
              </TextField>
              <Rectangle modifiers={[foregroundStyle('clear'),
                frame({ height: compact ? 0 : ACTION_BUTTON_HIT_TARGET + ACTION_ROW_BOTTOM_INSET }), accessibilityHidden()]} />
            </VStack>
            <ComposerActionRow palette={palette} hasSendableText={hasSendableText}
              sendDisabled={sendDisabled} onSend={submitDraft} compact={compact} />
            {presentation.showExpand ? (
              <VStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topTrailing' })]}>
                <HStack modifiers={[frame({ maxWidth: Infinity, alignment: 'trailing' }), padding({ trailing: 4 })]}>
                  <Button onPress={openEditor} modifiers={[buttonStyle('plain'),
                    frame({ width: ACTION_BUTTON_HIT_TARGET, height: ACTION_BUTTON_HIT_TARGET }),
                    contentShape(shapes.rectangle()), accessibilityLabel('توسيع محرر الرسالة')]}>
                    <Image systemName="arrow.up.left.and.arrow.down.right" size={17} color={palette.controlForeground} />
                  </Button>
                </HStack>
                <Spacer minLength={0} />
              </VStack>
            ) : null}
            {!compact ? (
              <ChatComposerOverflowProbe draft={draftSnapshot} onOverflow={reportOverflow} />
            ) : null}
          </ZStack>
        </VStack>
      </Host>
      <BottomSheet ref={sheetRef} index={sheetPresented ? 0 : -1} snapPoints={SHEET_SNAP_POINTS}
        enableDynamicSizing={false} enablePanDownToClose={true} handleComponent={null}
        backgroundStyle={{ backgroundColor: palette.background }} onDismiss={editorDismissed}>
        {sheetPresented ? (
          <Host colorScheme={colorScheme} layoutDirection="leftToRight" ignoreSafeArea="container" style={styles.editorHost}>
            <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), padding({ top: 12 })]}>
              <HStack modifiers={[padding({ horizontal: 8 })]}>
                <Spacer minLength={0} />
                <Button onPress={closeEditor} modifiers={[buttonStyle('plain'),
                  frame({ width: ACTION_BUTTON_HIT_TARGET, height: ACTION_BUTTON_HIT_TARGET }),
                  contentShape(shapes.rectangle()), accessibilityLabel('تصغير محرر الرسالة')]}>
                  <Image systemName="arrow.down.right.and.arrow.up.left" size={18} color={palette.controlForeground} />
                </Button>
              </HStack>
              <ComposerEditorSurface onFocus={focusEditor}>
                <ComposerEditorField fieldRef={sheetFieldRef} message={message} onTextChange={onTextChange}
                  onSelectionChange={selection => { selectionRef.current = selection; }}
                  onAppeared={editorAppeared} placeholderColor={palette.textTertiary} />
              </ComposerEditorSurface>
              <ComposerActionRow palette={palette} hasSendableText={hasSendableText}
                sendDisabled={sendDisabled} onSend={submitDraft} compact={false} />
            </VStack>
          </Host>
        ) : null}
      </BottomSheet>
    </>
  );
});

function ComposerPlaceholder({ color }: { color: string }) {
  return <TextField.Placeholder><Text modifiers={[foregroundStyle(color), font({ textStyle: 'body' })]}>اكتب رسالتك...</Text></TextField.Placeholder>;
}

function ComposerEditorField({ fieldRef, message, onTextChange, onSelectionChange, onAppeared, placeholderColor }: {
  fieldRef: RefObject<TextFieldRef | null>; message: ReturnType<typeof useNativeState<string>>;
  onTextChange: (text: string) => void; onSelectionChange: (selection: TextFieldSelection) => void;
  onAppeared: () => void; placeholderColor: string;
}) {
  return (
    <TextField ref={fieldRef} text={message} axis="vertical" autoFocus
      onTextChange={onTextChange} onSelectionChange={onSelectionChange}
      modifiers={[textFieldStyle('plain'), lineLimit(), fixedSize({ horizontal: false, vertical: true }),
        multilineTextAlignment('trailing'), font({ textStyle: 'body' }),
        padding({ horizontal: TEXT_HORIZONTAL_PADDING, top: 12, bottom: 12 }),
        frame({ maxWidth: Infinity, alignment: 'topLeading' }), onAppear(onAppeared)]}>
      <ComposerPlaceholder color={placeholderColor} />
    </TextField>
  );
}

function ComposerEditorSurface({ children, onFocus }: { children: ReactNode; onFocus: () => void }) {
  return (
    <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }),
      contentShape(shapes.rectangle()), onTapGesture(onFocus)]}>{children}</ScrollView>
  );
}

function ComposerActionRow({ palette, hasSendableText, sendDisabled, onSend, compact }: {
  palette: Palette; hasSendableText: boolean; sendDisabled: boolean; onSend: () => void; compact: boolean;
}) {
  const hitTarget = [frame({ width: ACTION_BUTTON_HIT_TARGET, height: ACTION_BUTTON_HIT_TARGET }), contentShape(shapes.circle())];
  return (
    <HStack alignment="center" spacing={0} modifiers={[padding({ horizontal: compact ? 2 : 8, bottom: compact ? 2 : ACTION_ROW_BOTTOM_INSET })]}>
      <Button onPress={() => {}} modifiers={[...hitTarget, accessibilityLabel('إضافة مرفق')]}>
        <ZStack modifiers={[frame({ width: ACTION_BUTTON_HIT_TARGET, height: ACTION_BUTTON_HIT_TARGET })]}>
          <Circle modifiers={[frame({ width: ACTION_BUTTON_DIAMETER, height: ACTION_BUTTON_DIAMETER }), foregroundStyle(palette.controlSurface)]} />
          <Image systemName="plus" size={18} color={palette.controlForeground} />
        </ZStack>
      </Button>
      <Spacer minLength={0} />
      <Button onPress={onSend} modifiers={[disabled(!hasSendableText || sendDisabled), ...hitTarget, accessibilityLabel('إرسال')]}>
        <ZStack modifiers={[frame({ width: ACTION_BUTTON_HIT_TARGET, height: ACTION_BUTTON_HIT_TARGET })]}>
          <Circle modifiers={[frame({ width: ACTION_BUTTON_DIAMETER, height: ACTION_BUTTON_DIAMETER }),
            foregroundStyle(hasSendableText ? palette.accent : palette.controlSurface)]} />
          <Image systemName="arrow.up" size={18} color={hasSendableText ? palette.accentText : palette.controlForeground} />
        </ZStack>
      </Button>
    </HStack>
  );
}

const ChatComposerOverflowProbe = memo(function ChatComposerOverflowProbe({ draft, onOverflow }: {
  draft: string; onOverflow: (overflow: boolean) => void;
}) {
  const measurements = useRef<{ natural: ComposerTextMeasurement | null; fiveLines: ComposerTextMeasurement | null }>({ natural: null, fiveLines: null });
  const measure = (kind: 'natural' | 'fiveLines', geometry: ComposerTextMeasurement) => {
    measurements.current[kind] = geometry;
    const overflow = getChatComposerVisualOverflow(measurements.current.natural, measurements.current.fiveLines);
    if (overflow !== null) onOverflow(overflow);
  };
  // Fixed zero-height wrapper: neither natural Text height contributes to the card,
  // its hit testing, accessibility, or the measured transcript/composer inset.
  // SwiftUI proposes the regular editing width (card minus 18pt on each side).
  // Keep eligibility independent of the temporary expand-button gutter so deleting
  // back to five normal lines always removes it; never count newlines or guess glyph sizes.
  return (
    <ZStack modifiers={[padding({ horizontal: TEXT_HORIZONTAL_PADDING }), frame({ height: 0 }), hidden(), accessibilityHidden()]}>
      <ComposerMeasurementText draft={draft} capped={false} onMeasure={geometry => measure('natural', geometry)} />
      <ComposerMeasurementText draft={draft} capped={true} onMeasure={geometry => measure('fiveLines', geometry)} />
    </ZStack>
  );
});

function ComposerMeasurementText({ draft, capped, onMeasure }: {
  draft: string; capped: boolean; onMeasure: (geometry: ComposerTextMeasurement) => void;
}) {
  return (
    <Text modifiers={[font({ textStyle: 'body' }), multilineTextAlignment('trailing'),
      capped ? lineLimit(5, { reservesSpace: true }) : lineLimit(), fixedSize({ horizontal: false, vertical: true }),
      frame({ maxWidth: Infinity }), onGeometryChange(({ width, height }) => onMeasure({ width, height }))]}>{draft}</Text>
  );
}
