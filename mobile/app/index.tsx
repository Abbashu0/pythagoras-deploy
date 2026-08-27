import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { Button, Host } from '@expo/ui';

export default function FoundationScreen() {
  const colorScheme = useColorScheme();
  const [pressCount, setPressCount] = useState(0);
  const isDark = colorScheme === 'dark';

  return (
    <>
      <Stack.Screen options={{ title: 'فيثاغورس' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          { backgroundColor: isDark ? '#111827' : '#f8fafc' },
        ]}
      >
        <View style={styles.contentInner}>
          <Text selectable style={[styles.productName, { color: isDark ? '#f9fafb' : '#111827' }]}>
            فيثاغورس
          </Text>
          <Text selectable style={[styles.status, { color: isDark ? '#e5e7eb' : '#374151' }]}>
            تم تشغيل تطبيق Pythagoras Native بنجاح
          </Text>
          <Text selectable style={[styles.version, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
            Expo SDK 57
          </Text>

          <Host
            matchContents
            layoutDirection="rightToLeft"
            style={styles.nativeControl}
          >
            <Button
              testID="native-foundation-button"
              label={pressCount === 0 ? 'اختبر الزر الأصلي' : `تم الضغط ${pressCount} مرة`}
              onPress={() => setPressCount((count) => count + 1)}
            />
          </Host>

          <Text selectable style={[styles.counter, { color: isDark ? '#d1d5db' : '#4b5563' }]}>
            عدد الضغطات: {pressCount}
          </Text>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  contentInner: {
    alignItems: 'center',
    gap: 16,
  },
  productName: {
    fontSize: 34,
    fontWeight: '700',
    textAlign: 'center',
  },
  status: {
    fontSize: 18,
    lineHeight: 28,
    textAlign: 'center',
  },
  version: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  nativeControl: {
    alignSelf: 'stretch',
    minHeight: 48,
  },
  counter: {
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
});
