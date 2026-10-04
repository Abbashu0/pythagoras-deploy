import { StyleSheet, View } from 'react-native';
import { Button, Host, Image } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  frame,
  foregroundStyle,
} from '@expo/ui/swift-ui/modifiers';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ChatTopControlsProps } from './chat-top-controls.types';

export function ChatTopControls({
  colorScheme,
  foregroundColor,
  onBack,
  onMenu,
}: ChatTopControlsProps) {
  const insets = useSafeAreaInsets();

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <Host
        matchContents
        colorScheme={colorScheme}
        layoutDirection="leftToRight"
        seedColor={foregroundColor}
        style={[styles.buttonHost, { top: insets.top, left: insets.left + 16 }]}
      >
        <NativeGlassIconButton
          accessibilityName="رجوع"
          foregroundColor={foregroundColor}
          systemImage="chevron.left"
          onPress={onBack}
        />
      </Host>
      <Host
        matchContents
        colorScheme={colorScheme}
        layoutDirection="leftToRight"
        seedColor={foregroundColor}
        style={[styles.buttonHost, { top: insets.top, right: insets.right + 16 }]}
      >
        <NativeGlassIconButton
          accessibilityName="فتح القائمة"
          foregroundColor={foregroundColor}
          systemImage="line.3.horizontal"
          onPress={onMenu}
        />
      </Host>
    </View>
  );
}

function NativeGlassIconButton({
  accessibilityName,
  foregroundColor,
  systemImage,
  onPress,
}: {
  accessibilityName: string;
  foregroundColor: string;
  systemImage: 'chevron.left' | 'line.3.horizontal';
  onPress: () => void;
}) {
  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle('glass'),
        buttonBorderShape('circle'),
        controlSize('regular'),
        frame({ width: 44, height: 44, alignment: 'center' }),
        accessibilityLabel(accessibilityName),
      ]}
    >
      <Image
        systemName={systemImage}
        size={22}
        modifiers={[
          frame({ width: 32, height: 32, alignment: 'center' }),
          foregroundStyle(foregroundColor),
        ]}
      />
    </Button>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 1,
  },
  buttonHost: {
    position: 'absolute',
  },
});
