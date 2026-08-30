import { useState } from 'react';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { usePreferences } from '@/preferences/preferences-provider';
import { HomeCircularAction } from '@/profile/profile-entry';
import { SettingsInfoPopoverContent } from '@/settings/settings-info-popover-content';
import { SettingsSheetHeaderFrame } from '@/settings/settings-sheet-header-frame';
import { getPalette } from '@/theme';

export function SettingsSheetHeader() {
  const router = useRouter();
  const { fontScale, resolvedColorScheme } = usePreferences();
  const [isInfoPresented, setIsInfoPresented] = useState(false);
  const palette = getPalette(resolvedColorScheme);

  const infoControl = (
    <HomeCircularAction
      accessibilityHint="يفتح معلومات عن التطبيق"
      accessibilityLabel="معلومات عن التطبيق"
      onPress={() => setIsInfoPresented(true)}
      size={48}
    >
      <Image
        accessible={false}
        contentFit="contain"
        source="sf:info.circle"
        style={styles.infoSymbol}
        tintColor={palette.text}
      />
    </HomeCircularAction>
  );
  const closeControl = (
    <HomeCircularAction
      accessibilityHint="يغلق نافذة الإعدادات"
      accessibilityLabel="إغلاق الإعدادات"
      onPress={() => router.back()}
      size={48}
    >
      <Image
        accessible={false}
        contentFit="contain"
        source="sf:xmark"
        style={styles.infoSymbol}
        tintColor={palette.text}
      />
    </HomeCircularAction>
  );

  return (
    <>
      <SettingsSheetHeaderFrame
        closeControl={closeControl}
        fontScale={fontScale}
        infoControl={infoControl}
        palette={palette}
      />
      <Modal
        animationType="fade"
        onRequestClose={() => setIsInfoPresented(false)}
        transparent
        visible={isInfoPresented}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="إغلاق معلومات التطبيق"
            accessibilityRole="button"
            onPress={() => setIsInfoPresented(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.androidPanel,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <SettingsInfoPopoverContent fontScale={fontScale} palette={palette} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  androidPanel: {
    borderCurve: 'continuous',
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  infoSymbol: {
    height: 22,
    width: 22,
  },
  modalRoot: {
    alignItems: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.24)',
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 72,
  },
});
