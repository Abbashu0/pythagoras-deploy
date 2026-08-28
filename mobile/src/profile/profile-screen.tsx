import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { demoProfileIdentity, ProfileAvatar } from '@/profile/profile-entry';
import { usePreferences } from '@/preferences/preferences-provider';
import { scaledFontSize, scaledLineHeight } from '@/theme';

export function ProfileScreen() {
  const { fontScale } = usePreferences();

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        style={styles.container}
      >
        <ProfileAvatar
          accessibilityLabel={`الصورة الشخصية لـ ${demoProfileIdentity.displayName}`}
          identity={demoProfileIdentity}
          size={104}
        />
        <Text
          selectable
          style={[
            styles.name,
            {
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
              fontSize: scaledFontSize(16, fontScale),
              lineHeight: scaledLineHeight(16, fontScale, 1.4),
            },
          ]}
        >
          طالب السادس العلمي
        </Text>
      </ScrollView>

      <StatusBar style="light" />
      <Stack.Screen
        options={{
          contentStyle: { backgroundColor: '#000000' },
          headerBackButtonDisplayMode: 'minimal',
          headerShadowVisible: false,
          headerShown: true,
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { color: '#FFFFFF' },
          headerTransparent: true,
          title: 'الملف الشخصي',
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000000',
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
    color: '#F4F4F5',
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  subtitle: {
    color: '#B8B8BE',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
