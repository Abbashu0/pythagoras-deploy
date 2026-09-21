import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useEffect } from 'react';
import { useRouter, useSegments } from 'expo-router';

import {
  getLastNormalTab,
  rememberNormalTab,
  resolveNormalTabFromSegments,
} from '@/navigation/last-normal-tab';

export default function TabsLayout() {
  const isIOS = process.env.EXPO_OS === 'ios';
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    const normalTab = resolveNormalTabFromSegments(segments);
    if (normalTab) rememberNormalTab(normalTab);
  }, [segments]);

  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'house', selected: 'house.fill' }}
          md="home"
        />
        <NativeTabs.Trigger.Label>الرئيسية</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="materials">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'books.vertical', selected: 'books.vertical.fill' }}
          md="menu_book"
        />
        <NativeTabs.Trigger.Label>المواد</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="tools">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'wrench', selected: 'wrench.fill' }}
          md="build"
        />
        <NativeTabs.Trigger.Label>الأدوات</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="lectures">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'play.rectangle', selected: 'play.rectangle.fill' }}
          md="video_library"
        />
        <NativeTabs.Trigger.Label>المحاضرات</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger
        name="ai"
        role={isIOS ? 'search' : undefined}
        hidden={!isIOS}
        disabled={isIOS}
        accessibilityLabel="الذكاء الاصطناعي"
        listeners={{
          tabPress: () => {
            if (isIOS) {
              router.push({
                pathname: '/chat',
                params: { returnTab: getLastNormalTab() },
              });
            }
          },
        }}
      >
        <NativeTabs.Trigger.Icon sf="sparkles" md="auto_awesome" />
        <NativeTabs.Trigger.Label>الذكاء الاصطناعي</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
