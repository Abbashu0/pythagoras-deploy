import type { ResolvedColorScheme } from '@/preferences/preferences-provider';
import { getMaterialRouteOptions } from '@/materials/material-route-options';

export function getQuestionBankRouteOptions(resolvedColorScheme: ResolvedColorScheme) {
  return {
    ...getMaterialRouteOptions(resolvedColorScheme),
    headerLargeTitleEnabled: false,
    headerSearchBarOptions: {
      allowToolbarIntegration: false,
      autoCapitalize: 'none' as const,
      hideWhenScrolling: false,
      placement: 'stacked' as const,
      placeholder: 'ابحث في بنك الأسئلة',
    },
    title: 'بنك الأسئلة',
  };
}
