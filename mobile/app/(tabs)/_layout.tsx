import { NativeTabs } from 'expo-router/unstable-native-tabs';

export default function TabsLayout() {
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

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'gearshape', selected: 'gearshape.fill' }}
          md="settings"
        />
        <NativeTabs.Trigger.Label>الإعدادات</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
