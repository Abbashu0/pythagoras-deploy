import { FieldGroup, Host } from '@expo/ui';
import { useRouter } from 'expo-router';

import { settingsIcons } from '@/settings/settings-icons';
import { SettingsNavigationRow } from '@/settings/settings-navigation-row';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette } from '@/theme';

export function SettingsScreen() {
  const router = useRouter();
  const { fontScale, resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);

  return (
    <Host
      colorScheme={resolvedColorScheme}
      layoutDirection="rightToLeft"
      style={{ backgroundColor: palette.background, flex: 1 }}>
      <FieldGroup>
        <FieldGroup.Section>
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
        </FieldGroup.Section>

        <FieldGroup.Section>
          <SettingsNavigationRow
            fontScale={fontScale}
            icon={settingsIcons.appearance}
            label="المظهر"
            onPress={() => router.push('/settings/appearance')}
            palette={palette}
            testID="settings-appearance"
          />
        </FieldGroup.Section>
      </FieldGroup>
    </Host>
  );
}
