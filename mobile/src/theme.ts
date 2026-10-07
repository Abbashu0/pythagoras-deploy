import type { ResolvedColorScheme } from '@/preferences/preferences-provider';

export const palettes = {
  light: {
    background: '#FAF9F5',
    surface: '#F0EEE6',
    surfaceElevated: '#F5F4ED',
    surfaceInset: '#E8E6DC',
    surfacePressed: '#E3E1D8',
    text: '#1A1918',
    textSecondary: '#5E5D59',
    textTertiary: '#87867F',
    border: '#DEDCD1',
    separator: '#D1CFC5',
    accent: '#007AFF',
    selectionAccent: '#007AFF',
    accentSoft: '#DDEBFA',
    accentText: '#FFFFFF',
    strongButton: '#1A1918',
    strongButtonText: '#FAF9F5',
    progressTrack: '#D1CFC5',
    // Compact neutral chrome; primary/status actions keep their own roles.
    controlSurface: '#F0EEE6',
    controlSurfacePressed: '#E8E6DC',
    controlSurfaceSelected: '#E3E1D8',
    controlForeground: '#5E5D59',
    controlForegroundSelected: '#1A1918',
    controlBorder: '#D1CFC5',
    // Compatibility alias while remaining screens migrate to semantic levels.
    surfaceMuted: '#F5F4ED',
  },
  dark: {
    background: '#202020',
    surface: '#181818',
    surfaceElevated: '#2C2C2A',
    surfaceInset: '#131313',
    surfacePressed: '#242422',
    text: '#FAF9F5',
    textSecondary: '#B0AEA5',
    textTertiary: '#87867F',
    border: '#343432',
    separator: '#353533',
    accent: '#0A84FF',
    selectionAccent: '#0A84FF',
    accentSoft: '#193248',
    accentText: '#FFFFFF',
    strongButton: '#F9F9F7',
    strongButtonText: '#1A1918',
    progressTrack: '#3B3B39',
    controlSurface: '#272726',
    controlSurfacePressed: '#32312F',
    controlSurfaceSelected: '#454440',
    controlForeground: '#C3C2B7',
    controlForegroundSelected: '#FAF9F5',
    controlBorder: '#4E4E4A',
    // Compatibility alias while remaining screens migrate to semantic levels.
    surfaceMuted: '#2C2C2A',
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
