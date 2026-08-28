import type { ResolvedColorScheme } from '@/preferences/preferences-provider';
import { getPalette } from '@/theme';

export function getSettingsRouteOptions(resolvedColorScheme: ResolvedColorScheme) {
  const palette = getPalette(resolvedColorScheme);

  return {
    headerBackButtonDisplayMode: 'minimal' as const,
    headerShadowVisible: false,
    headerShown: true,
    headerTintColor: palette.text,
    headerTitleStyle: { color: palette.text },
    headerTransparent: true,
  };
}
