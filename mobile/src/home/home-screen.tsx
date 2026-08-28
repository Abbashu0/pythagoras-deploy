import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBannerCarousel } from '@/components/home/home-banner-carousel';
import { ProfileEntry } from '@/profile/profile-entry';

const HORIZONTAL_INSET = 18;
const PROFILE_TOP_BREATHING = 12;
const PROFILE_TO_CAROUSEL = 18;

export function HomeScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.profileArea,
          {
            paddingHorizontal: HORIZONTAL_INSET,
            paddingTop: insets.top + PROFILE_TOP_BREATHING,
          },
        ]}
      >
        <ProfileEntry />
      </View>

      <View
        style={[
          styles.carouselArea,
          {
            // The locked carousel already owns its top safe-area breathing room.
            // The profile row consumes that space above it, so cancel only the
            // duplicate host-level inset while leaving the carousel unchanged.
            marginTop: PROFILE_TO_CAROUSEL - (insets.top + PROFILE_TOP_BREATHING),
          },
        ]}
      >
        <HomeBannerCarousel />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000000',
    flex: 1,
  },
  profileArea: {
    backgroundColor: '#000000',
    paddingBottom: PROFILE_TO_CAROUSEL,
    position: 'relative',
    zIndex: 1,
  },
  carouselArea: {
    backgroundColor: '#000000',
    flex: 1,
    minHeight: 0,
  },
});
