import { Icon } from '@expo/ui';

export const settingsIcons = {
  information: Icon.select({
    ios: 'info.circle',
    android: import('@expo/material-symbols/info.xml'),
  }),
  faq: Icon.select({
    ios: 'questionmark.bubble',
    android: import('@expo/material-symbols/help.xml'),
  }),
  support: Icon.select({
    ios: 'headset',
    android: import('@expo/material-symbols/headset_mic.xml'),
  }),
  appearance: Icon.select({
    ios: 'circle.lefthalf.filled',
    android: import('@expo/material-symbols/contrast.xml'),
  }),
  chevron: Icon.select({
    ios: 'chevron.left',
    android: import('@expo/material-symbols/chevron_left.xml'),
  }),
} as const;
