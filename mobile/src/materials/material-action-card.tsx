import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { IconName } from '@expo/ui';

import { materialIcons } from '@/materials/material-icons';
import { MaterialNativeIcon } from '@/materials/material-native-icon';
import type { ResolvedColorScheme } from '@/preferences/preferences-provider';
import { getPalette, scaledFontSize, scaledLineHeight } from '@/theme';

interface MaterialActionCardProps {
  colorScheme: ResolvedColorScheme;
  fontScale: number;
  icon: IconName;
  label: string;
  onPress: () => void;
  primary?: boolean;
}

export function MaterialActionCard({
  colorScheme,
  fontScale,
  icon,
  label,
  onPress,
  primary = false,
}: MaterialActionCardProps) {
  const palette = getPalette(colorScheme);
  const iconSize = primary ? 30 : 22;

  return (
    <Pressable
      accessibilityHint="فتح الوجهة"
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        primary ? styles.primaryCard : styles.secondaryCard,
        {
          backgroundColor: primary ? palette.surfaceMuted : palette.surface,
          opacity: pressed ? 0.86 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.actionIcon,
          primary ? styles.primaryIcon : styles.secondaryIcon,
          { backgroundColor: primary ? palette.surface : palette.surfaceMuted },
        ]}
      >
        <MaterialNativeIcon
          color={palette.text}
          colorScheme={colorScheme}
          name={icon}
          size={iconSize}
        />
      </View>
      <Text
        selectable
        style={[
          styles.label,
          {
            color: palette.text,
            fontSize: scaledFontSize(primary ? 22 : 17, fontScale),
            lineHeight: scaledLineHeight(primary ? 22 : 17, fontScale, 1.35),
          },
        ]}
      >
        {label}
      </Text>
      <View style={styles.spacer} />
      {!primary ? (
        <MaterialNativeIcon
          color={palette.textTertiary}
          colorScheme={colorScheme}
          name={materialIcons.chevron}
          size={18}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderCurve: 'continuous',
    flexDirection: 'row-reverse',
    gap: 14,
    overflow: 'hidden',
    paddingHorizontal: 18,
  },
  primaryCard: {
    borderRadius: 26,
    minHeight: 112,
  },
  secondaryCard: {
    borderRadius: 20,
    minHeight: 68,
  },
  actionIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryIcon: {
    borderRadius: 18,
    height: 58,
    width: 58,
  },
  secondaryIcon: {
    borderRadius: 14,
    height: 42,
    width: 42,
  },
  label: {
    flexShrink: 1,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  spacer: {
    flex: 1,
  },
});
