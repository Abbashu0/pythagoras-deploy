import type { ReactElement } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Button, ContextMenu, Text } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  contentShape,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  lineSpacing,
  multilineTextAlignment,
  padding,
  shapes,
  strokeBorder,
} from '@expo/ui/swift-ui/modifiers';

import type { Palette } from '@/theme';
import { firstStrongTextDirection } from './rich-response/text-direction';
import { hasFittedUserMessagePreview, PythagorasFittedUserMessagePreview } from './fitted-user-message-preview.ios';
import { NATIVE_PREVIEW_TUNING } from './native-preview-tuning.dev';

/** Must be rendered inside the row's existing SwiftUI Host.
 * The width constraint is outside the native menu interaction: its Trigger
 * owns only the painted bubble, never the row's Spacer or empty width.
 * Preview is a native slot, not another measured inline message. */
export function ChatUserMessageContextMenu({
  content,
  maxWidth,
  palette,
  cornerRadius,
  children,
}: {
  content: string;
  maxWidth?: number;
  palette: Palette;
  cornerRadius: number;
  children: ReactElement;
}) {
  const shape = shapes.roundedRectangle({ cornerRadius, roundedCornerStyle: 'continuous' });
  const widthConstraint = maxWidth === undefined
    ? []
    : [frame({ maxWidth, alignment: 'trailing' as const })];
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(content);
    } catch {
      // Clipboard failure must not alter the message, transcript or menu state.
    }
  };

  return (
    <ContextMenu modifiers={widthConstraint}>
      <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
      <ContextMenu.Items>
        <Button label="نسخ" systemImage="square.on.square" onPress={copy}
          modifiers={[accessibilityLabel('نسخ الرسالة كاملة')]} />
      </ContextMenu.Items>
      <ContextMenu.Preview>
        {hasFittedUserMessagePreview ? (
          <PythagorasFittedUserMessagePreview {...(__DEV__ ? NATIVE_PREVIEW_TUNING : {})}
            source={content} logicalMaxWidth={maxWidth}
            foregroundColor={palette.text} backgroundColor={palette.surfaceInset} borderColor={palette.border}
            direction={firstStrongTextDirection(content) === 'ltr' ? 'ltr' : 'rtl'} fontStyle="body" lineSpacing={3}
            horizontalPadding={15} verticalPadding={11} borderWidth={0.8} cornerRadius={cornerRadius} />
        ) : (
          <Text modifiers={[
          font({ textStyle: 'body' }),
          foregroundStyle(palette.text),
          multilineTextAlignment(firstStrongTextDirection(content) === 'ltr' ? 'leading' : 'trailing'),
          lineSpacing(3),
          fixedSize({ horizontal: false, vertical: true }),
          padding({ horizontal: 15, vertical: 11 }),
          background(palette.surfaceInset, shape),
          strokeBorder({ color: palette.border, style: { lineWidth: 0.8 }, shape: 'roundedRectangle', cornerRadius }),
          contentShape(shape, 'contextMenuPreview'),
          ...widthConstraint,
          ]}>{content}</Text>
        )}
      </ContextMenu.Preview>
    </ContextMenu>
  );
}
