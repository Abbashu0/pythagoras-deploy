import { Host, RNHostView, TabView } from '@expo/ui/swift-ui';
import { Animation, animation, frame, tabViewStyle } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet, View } from 'react-native';

import { BannerArtworkPage } from '@/components/home/banner-artwork-page';
import { BannerPageIndicator } from '@/components/home/banner-page-indicator';
import type { HomeBannerPagerProps } from '@/components/home/home-banner-pager.types';

export function HomeBannerPager({
  banners,
  frameWidth,
  frameHeight,
  selectedIndex,
  onSelectionChange,
}: HomeBannerPagerProps) {
  if (banners.length === 0) return null;

  const handleSelectionChange = (selection: string) => {
    const nextIndex = Number(selection);
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= banners.length) return;

    onSelectionChange(nextIndex);
  };

  return (
    <View
      style={[styles.container, { height: frameHeight, width: frameWidth }]}
    >
      <Host ignoreSafeArea="all" layoutDirection="leftToRight" style={styles.host}>
        <TabView
          onSelectionChange={handleSelectionChange}
          selection={String(selectedIndex)}
          modifiers={[
            frame({ height: frameHeight, width: frameWidth }),
            tabViewStyle({ type: 'page', indexDisplayMode: 'never' }),
            animation(Animation.default, selectedIndex),
          ]}
        >
          {banners.map((banner, index) => (
            <TabView.Tab key={banner.id} value={String(index)}>
              <RNHostView>
                <BannerArtworkPage banner={banner} height={frameHeight} width={frameWidth} />
              </RNHostView>
            </TabView.Tab>
          ))}
        </TabView>
      </Host>
      <BannerPageIndicator count={banners.length} selectedIndex={selectedIndex} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    position: 'relative',
  },
  host: {
    flex: 1,
  },
});
