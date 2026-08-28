import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';

export type AppearanceMode = 'system' | 'light' | 'dark';
export type ResolvedColorScheme = 'light' | 'dark';

const MIN_FONT_SCALE = 0.9;
const MAX_FONT_SCALE = 1.25;

type PreferencesContextValue = {
  appearanceMode: AppearanceMode;
  resolvedColorScheme: ResolvedColorScheme;
  fontScale: number;
  showDailySummary: boolean;
  setAppearanceMode: (mode: AppearanceMode) => void;
  setFontScale: (scale: number) => void;
  setShowDailySummary: (show: boolean) => void;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function clampFontScale(scale: number) {
  return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, scale));
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [appearanceMode, setAppearanceModeState] = useState<AppearanceMode>('system');
  const [fontScale, setFontScaleState] = useState(1);
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
      fontScale,
      showDailySummary,
      setAppearanceMode,
      setFontScale,
      setShowDailySummary,
    }),
    [
      appearanceMode,
      resolvedColorScheme,
      fontScale,
      showDailySummary,
      setAppearanceMode,
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
