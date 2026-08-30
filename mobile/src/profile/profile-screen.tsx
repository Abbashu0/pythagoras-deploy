import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { demoProfileIdentity, ProfileAvatar } from '@/profile/profile-entry';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette, scaledFontSize, scaledLineHeight } from '@/theme';

export function ProfileScreen() {
  const { fontScale, resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        style={[styles.container, { backgroundColor: palette.background }]}
      >
        <ProfileAvatar
          accessibilityLabel={`الصورة الشخصية لـ ${demoProfileIdentity.displayName}`}
          identity={demoProfileIdentity}
          size={104}
          tintColor={palette.text}
        />
        <Text
          selectable
          style={[
            styles.name,
            {
              color: palette.text,
              fontSize: scaledFontSize(24, fontScale),
              lineHeight: scaledLineHeight(24, fontScale, 1.25),
            },
          ]}
        >
          {demoProfileIdentity.displayName}
        </Text>
        <Text
          selectable
          style={[
            styles.subtitle,
            {
              color: palette.textSecondary,
              fontSize: scaledFontSize(16, fontScale),
              lineHeight: scaledLineHeight(16, fontScale, 1.4),
            },
          ]}
        >
          طالب السادس العلمي
        </Text>
      </ScrollView>

      <StatusBar style={resolvedColorScheme === 'dark' ? 'light' : 'dark'} />
      <Stack.Screen
        options={{
          contentStyle: { backgroundColor: palette.background },
          headerBackButtonDisplayMode: 'minimal',
          headerShadowVisible: false,
          headerShown: true,
          headerTintColor: palette.text,
          headerTitleStyle: { color: palette.text },
          headerTransparent: true,
          title: 'الملف الشخصي',
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    alignItems: 'center',
    gap: 10,
    paddingBottom: 40,
    paddingHorizontal: 18,
    paddingTop: 32,
  },
  name: {
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  subtitle: {
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
