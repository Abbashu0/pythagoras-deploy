import { Icon } from '@expo/ui';

export const materialIcons = {
  quiz: Icon.select({
    ios: 'questionmark.circle.fill',
    android: import('@expo/material-symbols/quiz.xml'),
  }),
  questionBank: Icon.select({
    ios: 'books.vertical.fill',
    android: import('@expo/material-symbols/menu_book.xml'),
  }),
  history: Icon.select({
    ios: 'clock.arrow.circlepath',
    android: import('@expo/material-symbols/history.xml'),
  }),
  favorites: Icon.select({
    ios: 'heart.fill',
    android: import('@expo/material-symbols/favorite.xml'),
  }),
  chevron: Icon.select({
    ios: 'chevron.left',
    android: import('@expo/material-symbols/chevron_left.xml'),
  }),
} as const;
