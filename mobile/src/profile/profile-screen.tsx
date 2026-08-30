import { useNavigation, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { demoProfileIdentity, ProfileAvatar } from '@/profile/profile-entry';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette, scaledFontSize, scaledLineHeight } from '@/theme';

export function ProfileScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const { fontScale, resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);

  const closeProfile = () => {
    const parentNavigation = navigation.getParent();

    if (parentNavigation?.canGoBack()) {
      parentNavigation.goBack();
      return;
    }

    router.back();
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        style={[styles.container, { backgroundColor: palette.background }]}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityHint="يغلق نافذة الملف الشخصي"
            accessibilityLabel="إغلاق الملف الشخصي"
            accessibilityRole="button"
            onPress={closeProfile}
            style={({ pressed }) => [
              styles.closeButton,
              {
                backgroundColor: pressed ? palette.surfacePressed : palette.surfaceElevated,
                borderColor: palette.border,
                opacity: pressed ? 0.82 : 1,
              },
            ]}
          >
            <Image
              accessible={false}
              contentFit="contain"
              source="sf:xmark"
              style={styles.closeSymbol}
              tintColor={palette.text}
            />
          </Pressable>
        </View>
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
    paddingTop: 18,
  },
  header: {
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    direction: 'ltr',
    flexDirection: 'row',
    height: 48,
    justifyContent: 'flex-start',
  },
  closeButton: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  closeSymbol: {
    height: 22,
    width: 22,
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
