import { useState } from 'react';
import { Button, Host, Image as SwiftUIImage, Popover, RNHostView } from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  clipShape,
  controlSize,
  frame,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { useNavigation, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { usePreferences } from '@/preferences/preferences-provider';
import { SettingsInfoPopoverContent } from '@/settings/settings-info-popover-content';
import { SettingsSheetHeaderFrame } from '@/settings/settings-sheet-header-frame';
import { getPalette } from '@/theme';

type NativeSettingsButtonProps = {
  accessibilityHintText: string;
  accessibilityLabelText: string;
  onPress: () => void;
  palette: ReturnType<typeof getPalette>;
  systemImage: 'info.circle' | 'xmark';
};

function NativeSettingsButton({
  accessibilityHintText,
  accessibilityLabelText,
  onPress,
  palette,
  systemImage,
}: NativeSettingsButtonProps) {
  return (
    <Button
      modifiers={[
        buttonStyle('glass'),
        buttonBorderShape('circle'),
        controlSize('large'),
        tint(palette.text),
        accessibilityLabel(accessibilityLabelText),
        accessibilityHint(accessibilityHintText),
        frame({ height: 48, width: 48 }),
        clipShape('circle'),
      ]}
      onPress={onPress}
    >
      <SwiftUIImage color={palette.text} size={22} systemName={systemImage} />
    </Button>
  );
}

export function SettingsSheetHeader() {
  const navigation = useNavigation();
  const router = useRouter();
  const { fontScale, resolvedColorScheme } = usePreferences();
  const [isInfoPresented, setIsInfoPresented] = useState(false);
  const palette = getPalette(resolvedColorScheme);

  const closeSettings = () => {
    const parentNavigation = navigation.getParent();

    if (parentNavigation?.canGoBack()) {
      parentNavigation.goBack();
      return;
    }

    router.back();
  };

  const closeControl = (
    <Host colorScheme={resolvedColorScheme} style={styles.nativeControlHost}>
      <NativeSettingsButton
        accessibilityHintText="يغلق نافذة الإعدادات"
        accessibilityLabelText="إغلاق الإعدادات"
        onPress={closeSettings}
        palette={palette}
        systemImage="xmark"
      />
    </Host>
  );

  const infoControl = (
    <Host
      colorScheme={resolvedColorScheme}
      layoutDirection="leftToRight"
      style={styles.infoHost}
    >
      <Popover
        arrowEdge="trailing"
        attachmentAnchor="trailing"
        isPresented={isInfoPresented}
        onIsPresentedChange={setIsInfoPresented}
      >
        <Popover.Trigger>
          <NativeSettingsButton
            accessibilityHintText="يفتح معلومات عن التطبيق"
            accessibilityLabelText="معلومات عن التطبيق"
            onPress={() => setIsInfoPresented(true)}
            palette={palette}
            systemImage="info.circle"
          />
        </Popover.Trigger>
        <Popover.Content>
          <RNHostView matchContents>
            <SettingsInfoPopoverContent fontScale={fontScale} palette={palette} />
          </RNHostView>
        </Popover.Content>
      </Popover>
    </Host>
  );

  return (
    <SettingsSheetHeaderFrame
      closeControl={closeControl}
      fontScale={fontScale}
      infoControl={infoControl}
      palette={palette}
    />
  );
}

const styles = StyleSheet.create({
  infoHost: {
    height: 48,
    width: 48,
  },
  nativeControlHost: {
    height: 48,
    width: 48,
  },
});
