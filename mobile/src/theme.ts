import type { ResolvedColorScheme } from '@/preferences/preferences-provider';

export const palettes = {
  light: {
    background: '#F5F7F4',
    surface: '#FFFFFF',
    surfaceMuted: '#E8F0EB',
    text: '#17231E',
    textSecondary: '#5C6A63',
    textTertiary: '#849089',
    border: '#DCE5DF',
    accent: '#176B55',
    accentSoft: '#D8EDE3',
    accentText: '#FFFFFF',
    progressTrack: '#B8D8C9',
  },
  dark: {
    background: '#101613',
    surface: '#18211D',
    surfaceMuted: '#20352C',
    text: '#F1F5F2',
    textSecondary: '#B7C3BC',
    textTertiary: '#84938A',
    border: '#2B3A32',
    accent: '#8AD2B1',
    accentSoft: '#234638',
    accentText: '#0D241A',
    progressTrack: '#385B4A',
  },
} as const;

export type Palette = (typeof palettes)[ResolvedColorScheme];

export function getPalette(colorScheme: ResolvedColorScheme): Palette {
  return palettes[colorScheme];
}

export function scaledFontSize(baseSize: number, fontScale: number) {
  return Math.round(baseSize * fontScale);
}

export function scaledLineHeight(baseSize: number, fontScale: number, ratio = 1.35) {
  return Math.round(baseSize * fontScale * ratio);
}
