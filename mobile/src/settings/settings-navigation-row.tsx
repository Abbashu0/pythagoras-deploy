import { Icon, Row, Spacer, Text as NativeText, type IconName } from '@expo/ui';

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
    <Row alignment="center" onPress={onPress} spacing={12} testID={testID}>
      <Icon color={palette.textSecondary} name={icon} size={22} />
      <NativeText
        textStyle={{
          color: palette.text,
          fontSize: scaledFontSize(17, fontScale),
          fontWeight: '500',
          lineHeight: scaledLineHeight(17, fontScale, 1.35),
          textAlign: 'right',
        }}>
        {label}
      </NativeText>
      <Spacer flexible />
      <Icon color={palette.textTertiary} name={settingsIcons.chevron} size={18} />
    </Row>
  );
}
