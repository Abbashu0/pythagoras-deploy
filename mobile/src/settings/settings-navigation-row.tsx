import { Host, Icon, type IconName } from '@expo/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { settingsIcons } from '@/settings/settings-icons';
import type { Palette } from '@/theme';
import { scaledFontSize, scaledLineHeight } from '@/theme';

interface SettingsNavigationRowProps {
  fontScale: number;
  icon: IconName;
  label: string;
  onPress: () => void;
  palette: Palette;
  testID: string;
}

export function SettingsNavigationRow({
  fontScale,
  icon,
  label,
  onPress,
  palette,
  testID,
}: SettingsNavigationRowProps) {
  return (
    <Pressable
      accessibilityHint="يفتح هذا القسم"
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? palette.surfacePressed : palette.surface,
        },
      ]}
      testID={testID}
    >
      <View style={styles.iconSlot}>
        <Host
          layoutDirection="rightToLeft"
          matchContents
          style={styles.iconHost}
        >
          <Icon color={palette.textSecondary} name={icon} size={22} />
        </Host>
      </View>
      <Text
        selectable
        style={[
          styles.label,
          {
            color: palette.text,
            fontSize: scaledFontSize(17, fontScale),
            lineHeight: scaledLineHeight(17, fontScale, 1.35),
          },
        ]}
      >
        {label}
      </Text>
      <View style={styles.spacer} />
      <Host
        layoutDirection="rightToLeft"
        matchContents
        style={styles.chevronHost}
      >
        <Icon color={palette.textTertiary} name={settingsIcons.chevron} size={18} />
      </Host>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    direction: 'rtl',
    flexDirection: 'row',
    gap: 12,
    minHeight: 70,
    paddingHorizontal: 21,
  },
  iconSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
  },
  iconHost: {
    height: 24,
    width: 24,
  },
  label: {
    fontWeight: '500',
    flexShrink: 1,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  spacer: {
    flex: 1,
  },
  chevronHost: {
    height: 20,
    width: 20,
  },
});
