import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { scaledFontSize, scaledLineHeight, type Palette } from '@/theme';

type SettingsSheetHeaderFrameProps = {
  closeControl: ReactNode;
  fontScale: number;
  infoControl: ReactNode;
  palette: Palette;
};

export function SettingsSheetHeaderFrame({
  closeControl,
  fontScale,
  infoControl,
  palette,
}: SettingsSheetHeaderFrameProps) {
  return (
    <View style={styles.header}>
      <View style={styles.controlSlot}>{closeControl}</View>

      <Text
        numberOfLines={1}
        selectable
        style={[
          styles.title,
          {
            color: palette.text,
            fontSize: scaledFontSize(19, fontScale),
            lineHeight: scaledLineHeight(19, fontScale, 1.3),
          },
        ]}
      >
        الإعدادات
      </Text>

      <View style={styles.controlSlot}>{infoControl}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    direction: 'ltr',
    flexDirection: 'row',
    height: 52,
    justifyContent: 'space-between',
    position: 'relative',
    width: '100%',
  },
  controlSlot: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  title: {
    left: 0,
    position: 'absolute',
    right: 0,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
