import { Host, Icon, type IconName } from '@expo/ui';

import type { ResolvedColorScheme } from '@/preferences/preferences-provider';

interface MaterialNativeIconProps {
  color: string;
  colorScheme: ResolvedColorScheme;
  name: IconName;
  size: number;
}

export function MaterialNativeIcon({ color, colorScheme, name, size }: MaterialNativeIconProps) {
  return (
    <Host
      colorScheme={colorScheme}
      layoutDirection="rightToLeft"
      matchContents
      style={{ height: size, width: size }}
    >
      <Icon color={color} name={name} size={size} />
    </Host>
  );
}
