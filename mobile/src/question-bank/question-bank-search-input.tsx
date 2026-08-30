import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Host, Icon, TextInput as NativeTextInput, type TextInputRef } from '@expo/ui';

import { questionBankIcons } from '@/question-bank/question-bank-icons';
import { QUESTION_BANK_CONTROL_HEIGHT } from '@/question-bank/question-bank-control-geometry';
import type { Palette } from '@/theme';
import { scaledFontSize, scaledLineHeight } from '@/theme';

interface QuestionBankSearchInputProps {
  fontScale: number;
  onBlur: () => void;
  onChangeText: (text: string) => void;
  onFocus: () => void;
  palette: Palette;
  query: string;
  resolvedColorScheme: 'light' | 'dark';
}

export const QuestionBankSearchInput = forwardRef<
  TextInputRef,
  QuestionBankSearchInputProps
>(function QuestionBankSearchInput(
  {
    fontScale,
    onBlur,
    onChangeText,
    onFocus,
    palette,
    query,
    resolvedColorScheme,
  },
  ref
) {
  const inputRef = useRef<TextInputRef>(null);

  useImperativeHandle(
    ref,
    () => ({
      blur: () => inputRef.current?.blur(),
      clear: () => inputRef.current?.clear(),
      focus: () => inputRef.current?.focus(),
      isFocused: () => inputRef.current?.isFocused() ?? false,
      setSelection: (start, end) => inputRef.current?.setSelection(start, end) ?? Promise.resolve(),
    }),
    []
  );

  const hasQuery = query.length > 0;

  return (
    <View
      style={[
        styles.field,
        {
          backgroundColor: palette.surface,
          borderColor: palette.border,
        },
      ]}
    >
      <Host colorScheme={resolvedColorScheme} style={styles.inputHost}>
        <NativeTextInput
          autoCapitalize="none"
          autoCorrect={false}
          cursorColor={palette.accent}
          defaultValue=""
          onBlur={onBlur}
          onChangeText={onChangeText}
          onFocus={onFocus}
          placeholder="ابحث في بنك الأسئلة"
          placeholderTextColor={palette.textTertiary}
          ref={inputRef}
          returnKeyType="search"
          style={{
            ...styles.input,
            paddingLeft: hasQuery ? 42 : 38,
            paddingRight: 14,
          }}
          textAlign="right"
          textStyle={{
            color: palette.text,
            fontSize: scaledFontSize(16, fontScale),
            lineHeight: scaledLineHeight(16, fontScale, 1.25),
          }}
        />
      </Host>
      {!hasQuery ? (
        <View pointerEvents="none" style={styles.leadingIconSlot}>
          <Host
            colorScheme={resolvedColorScheme}
            matchContents
            style={styles.iconHost}
          >
            <Icon color={palette.textSecondary} name={questionBankIcons.search} size={19} />
          </Host>
        </View>
      ) : (
        <Pressable
          accessibilityLabel="مسح البحث"
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => {
            inputRef.current?.clear();
            onChangeText('');
          }}
          style={styles.clearButton}
        >
          <Host
            colorScheme={resolvedColorScheme}
            matchContents
            style={styles.iconHost}
          >
            <Icon color={palette.textSecondary} name={questionBankIcons.close} size={17} />
          </Host>
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  field: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    height: QUESTION_BANK_CONTROL_HEIGHT,
    justifyContent: 'center',
    minWidth: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  input: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    height: QUESTION_BANK_CONTROL_HEIGHT,
    width: '100%',
  },
  inputHost: {
    flex: 1,
    height: QUESTION_BANK_CONTROL_HEIGHT,
    minWidth: 0,
  },
  leadingIconSlot: {
    alignItems: 'center',
    height: QUESTION_BANK_CONTROL_HEIGHT,
    justifyContent: 'center',
    left: 10,
    position: 'absolute',
    top: 0,
    width: 24,
  },
  clearButton: {
    alignItems: 'center',
    height: QUESTION_BANK_CONTROL_HEIGHT,
    justifyContent: 'center',
    left: 4,
    position: 'absolute',
    top: 0,
    width: 36,
  },
  iconHost: {
    height: 22,
    width: 22,
  },
});
