import type { ResolvedColorScheme } from '@/preferences/preferences-provider';
import { getPalette } from '@/theme';

export function getSettingsRouteOptions(resolvedColorScheme: ResolvedColorScheme) {
  const palette = getPalette(resolvedColorScheme);

  return {
    headerBackButtonDisplayMode: 'minimal' as const,
    contentStyle: { backgroundColor: palette.background },
    headerShadowVisible: false,
    headerShown: true,
    headerTintColor: palette.text,
    headerTitleStyle: { color: palette.text },
    headerTransparent: true,
  };
}

export function getSettingsSheetRouteOptions(resolvedColorScheme: ResolvedColorScheme) {
  const palette = getPalette(resolvedColorScheme);

  return {
    contentStyle: { backgroundColor: palette.background },
    gestureEnabled: true,
    headerShown: false,
    presentation: 'formSheet' as const,
    sheetAllowedDetents: [0.92],
    sheetGrabberVisible: false,
    sheetInitialDetentIndex: 'last' as const,
    sheetLargestUndimmedDetentIndex: 'none' as const,
  };
}
