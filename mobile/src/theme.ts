import type { ResolvedColorScheme } from '@/preferences/preferences-provider';

export const palettes = {
  light: {
    background: '#F2F2F7',
    surface: '#FFFFFF',
    surfaceMuted: '#E5E5EA',
    text: '#1C1C1E',
    textSecondary: '#636366',
    textTertiary: '#8E8E93',
    border: '#D1D1D6',
    accent: '#8E8E93',
    accentSoft: '#E5E5EA',
    accentText: '#1C1C1E',
    progressTrack: '#D1D1D6',
  },
  dark: {
    background: '#000000',
    surface: '#1C1C1E',
    surfaceMuted: '#2C2C2E',
    text: '#F2F2F7',
    textSecondary: '#AEAEB2',
    textTertiary: '#8E8E93',
    border: '#38383A',
    accent: '#D1D1D6',
    accentSoft: '#38383A',
    accentText: '#1C1C1E',
    progressTrack: '#48484A',
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
