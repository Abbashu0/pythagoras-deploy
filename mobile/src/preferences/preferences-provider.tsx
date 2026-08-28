import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';

export type AppearanceMode = 'system' | 'light' | 'dark';
export type ResolvedColorScheme = 'light' | 'dark';
export type ThemeId = 'default';

export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.15;
export const FONT_SCALE_STEP = 0.05;
export const FONT_SCALE_DEFAULT = 1;
export const FONT_SCALE_POINTS = [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15] as const;

export function getFontScalePointIndex(scale: number) {
  return FONT_SCALE_POINTS.reduce(
    (closestIndex, point, index) =>
      Math.abs(point - scale) < Math.abs(FONT_SCALE_POINTS[closestIndex] - scale)
        ? index
        : closestIndex,
    0
  );
}

type PreferencesContextValue = {
  appearanceMode: AppearanceMode;
  resolvedColorScheme: ResolvedColorScheme;
  themeId: ThemeId;
  fontScale: number;
  showDailySummary: boolean;
  setAppearanceMode: (mode: AppearanceMode) => void;
  setThemeId: (themeId: ThemeId) => void;
  setFontScale: (scale: number) => void;
  setShowDailySummary: (show: boolean) => void;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function clampFontScale(scale: number) {
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, scale));
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [appearanceMode, setAppearanceModeState] = useState<AppearanceMode>('system');
  const [themeId, setThemeId] = useState<ThemeId>('default');
  const [fontScale, setFontScaleState] = useState(FONT_SCALE_DEFAULT);
  const [showDailySummary, setShowDailySummary] = useState(true);

  const resolvedColorScheme: ResolvedColorScheme =
    appearanceMode === 'system'
      ? systemColorScheme === 'dark'
        ? 'dark'
        : 'light'
      : appearanceMode;

  const setAppearanceMode = useCallback((mode: AppearanceMode) => {
    setAppearanceModeState(mode);
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  }, []);

  const setFontScale = useCallback((scale: number) => {
    setFontScaleState(clampFontScale(scale));
  }, []);

  const value = useMemo(
    () => ({
      appearanceMode,
      resolvedColorScheme,
      themeId,
      fontScale,
      showDailySummary,
      setAppearanceMode,
      setThemeId,
      setFontScale,
      setShowDailySummary,
    }),
    [
      appearanceMode,
      resolvedColorScheme,
      themeId,
      fontScale,
      showDailySummary,
      setAppearanceMode,
      setThemeId,
      setFontScale,
    ]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);

  if (!context) {
    throw new Error('usePreferences must be used inside PreferencesProvider');
  }

  return context;
}
