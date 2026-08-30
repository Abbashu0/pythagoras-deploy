import { Icon } from '@expo/ui';

export const questionBankIcons = {
  heart: Icon.select({
    ios: 'heart',
    android: import('@expo/material-symbols/favorite.xml'),
  }),
  heartFill: Icon.select({
    ios: 'heart.fill',
    android: import('@expo/material-symbols/favorite.xml'),
  }),
  close: Icon.select({
    ios: 'xmark',
    android: import('@expo/material-symbols/close.xml'),
  }),
  search: Icon.select({
    ios: 'magnifyingglass',
    android: import('@expo/material-symbols/search.xml'),
  }),
  chevronDown: Icon.select({
    ios: 'chevron.down',
    android: import('@expo/material-symbols/expand.xml'),
  }),
  scrollToTop: Icon.select({
    ios: 'arrow.up',
    android: import('@expo/material-symbols/arrow_upward.xml'),
  }),
} as const;
