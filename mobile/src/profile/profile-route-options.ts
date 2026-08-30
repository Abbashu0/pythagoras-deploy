import type { ResolvedColorScheme } from '@/preferences/preferences-provider';
import { getPalette } from '@/theme';

export function getProfileSheetRouteOptions(resolvedColorScheme: ResolvedColorScheme) {
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
