import type { ResolvedColorScheme } from '@/preferences/preferences-provider';
import { getMaterialRouteOptions } from '@/materials/material-route-options';
import { getPalette } from '@/theme';

export function getQuestionBankRouteOptions(resolvedColorScheme: ResolvedColorScheme) {
  const palette = getPalette(resolvedColorScheme);

  return {
    ...getMaterialRouteOptions(resolvedColorScheme),
    headerLargeTitleEnabled: false,
    headerStyle: { backgroundColor: palette.background },
    headerTransparent: false,
    title: 'بنك الأسئلة',
  };
}
