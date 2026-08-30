import { Children, Fragment, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { settingsIcons } from '@/settings/settings-icons';
import { SettingsNavigationRow } from '@/settings/settings-navigation-row';
import { SettingsSheetHeader } from '@/settings/settings-sheet-header';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette, type Palette } from '@/theme';

function SettingsGroup({ children, palette }: { children: ReactNode; palette: Palette }) {
  const rows = Children.toArray(children);

  return (
    <View
      style={[
        styles.group,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      {rows.map((row, index) => (
        <Fragment key={index}>
          {row}
          {index < rows.length - 1 ? (
            <View style={[styles.separator, { backgroundColor: palette.separator }]} />
          ) : null}
        </Fragment>
      ))}
    </View>
  );
}

export function SettingsScreen() {
  const router = useRouter();
  const { fontScale, resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      style={[styles.container, { backgroundColor: palette.background }]}
    >
      <SettingsSheetHeader />
      <SettingsGroup palette={palette}>
          <SettingsNavigationRow
            fontScale={fontScale}
            icon={settingsIcons.information}
            label="معلومات"
            onPress={() => router.push('/settings/information')}
            palette={palette}
            testID="settings-information"
          />
          <SettingsNavigationRow
            fontScale={fontScale}
            icon={settingsIcons.faq}
            label="الأسئلة الشائعة"
            onPress={() => router.push('/settings/faq')}
            palette={palette}
            testID="settings-faq"
          />
          <SettingsNavigationRow
            fontScale={fontScale}
            icon={settingsIcons.support}
            label="الدعم الفني"
            onPress={() => router.push('/settings/support')}
            palette={palette}
            testID="settings-support"
          />
      </SettingsGroup>

      <SettingsGroup palette={palette}>
          <SettingsNavigationRow
            fontScale={fontScale}
            icon={settingsIcons.appearance}
            label="المظهر"
            onPress={() => router.push('/settings/appearance')}
            palette={palette}
            testID="settings-appearance"
          />
      </SettingsGroup>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    gap: 24,
    paddingBottom: 40,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  group: {
    borderCurve: 'continuous',
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 20,
  },
});
