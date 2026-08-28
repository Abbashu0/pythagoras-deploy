import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';

import { usePreferences } from '@/preferences/preferences-provider';
import { scaledFontSize, scaledLineHeight } from '@/theme';

export interface ProfileIdentity {
  displayName: string;
  avatarUrl: string | null;
}

export const demoProfileIdentity: ProfileIdentity = {
  displayName: 'عباس',
  avatarUrl: null,
};

interface ProfileAvatarProps {
  accessibilityLabel?: string;
  identity: ProfileIdentity;
  onPress?: () => void;
  size?: number;
}

interface HomeCircularActionProps {
  accessibilityHint?: string;
  accessibilityLabel: string;
  children: ReactNode;
  onPress: () => void;
  size?: number;
}

interface CircularSurfaceProps {
  accessibilityHint?: string;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'image';
  children: ReactNode;
  onPress?: () => void;
  size: number;
}

type GlassAvailability = {
  api: boolean;
  liquid: boolean;
};

function getGlassAvailability(): GlassAvailability {
  if (process.env.EXPO_OS !== 'ios') return { api: false, liquid: false };

  try {
    return {
      api: isGlassEffectAPIAvailable(),
      liquid: isLiquidGlassAvailable(),
    };
  } catch {
    return { api: false, liquid: false };
  }
}

function useNativeGlassAvailability() {
  const [availability] = useState(getGlassAvailability);
  const [reduceTransparency, setReduceTransparency] = useState<boolean | null>(() =>
    process.env.EXPO_OS === 'ios' ? null : true
  );

  useEffect(() => {
    if (process.env.EXPO_OS !== 'ios') return;

    let mounted = true;
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (mounted) setReduceTransparency(enabled);
      })
      .catch(() => {
        if (mounted) setReduceTransparency(true);
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.info(
        `[Pythagoras] Home circular action Glass API: ${availability.api}; ` +
          `Liquid Glass: ${availability.liquid}`
      );
    }
  }, [availability.api, availability.liquid]);

  return availability.api && availability.liquid && reduceTransparency === false;
}

function AvatarArtwork({ identity, size }: { identity: ProfileIdentity; size: number }) {
  const imageSize = Math.max(1, size - 10);
  const hasAvatar = Boolean(identity.avatarUrl?.trim());

  if (hasAvatar) {
    return (
      <Image
        accessible={false}
        cachePolicy="memory-disk"
        contentFit="cover"
        source={{ uri: identity.avatarUrl as string }}
        style={{ borderRadius: imageSize / 2, height: imageSize, width: imageSize }}
      />
    );
  }

  if (process.env.EXPO_OS === 'ios') {
    return (
      <Image
        accessible={false}
        contentFit="contain"
        source="sf:person.crop.circle.fill"
        style={{ height: imageSize, width: imageSize }}
        tintColor="#F4F4F5"
      />
    );
  }

  return (
    <View
      style={[
        styles.initialAvatar,
        { borderRadius: imageSize / 2, height: imageSize, width: imageSize },
      ]}
    >
      <Text style={{ fontSize: Math.round(imageSize * 0.42) }}>ع</Text>
    </View>
  );
}

function CircularSurface({
  accessibilityHint,
  accessibilityLabel,
  accessibilityRole,
  children,
  onPress,
  size,
}: CircularSurfaceProps) {
  const useGlass = useNativeGlassAvailability();
  const dimensions = {
    borderRadius: size / 2,
    height: size,
    width: size,
  } as const;
  const content = onPress ? (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      onPress={onPress}
      style={styles.pressable}
    >
      {children}
    </Pressable>
  ) : (
    <View style={styles.pressable}>{children}</View>
  );

  if (useGlass) {
    return (
      <GlassView
        accessible={!onPress}
        accessibilityLabel={!onPress ? accessibilityLabel : undefined}
        accessibilityRole={!onPress ? accessibilityRole : undefined}
        isInteractive={Boolean(onPress)}
        style={[styles.glassShell, dimensions]}
      >
        {content}
      </GlassView>
    );
  }

  return (
    <View
      accessible={!onPress}
      accessibilityLabel={!onPress ? accessibilityLabel : undefined}
      accessibilityRole={!onPress ? accessibilityRole : undefined}
      style={[styles.fallbackShell, dimensions]}
    >
      {content}
    </View>
  );
}

export function HomeCircularAction({
  accessibilityHint,
  accessibilityLabel,
  children,
  onPress,
  size = 52,
}: HomeCircularActionProps) {
  return (
    <CircularSurface
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      size={size}
    >
      {children}
    </CircularSurface>
  );
}

export function ProfileAvatar({
  accessibilityLabel,
  identity,
  onPress,
  size = 52,
}: ProfileAvatarProps) {
  const artwork = <AvatarArtwork identity={identity} size={size} />;

  if (onPress) {
    return (
      <HomeCircularAction
        accessibilityHint="يفتح صفحة الملف الشخصي"
        accessibilityLabel={accessibilityLabel ?? 'فتح الملف الشخصي'}
        onPress={onPress}
        size={size}
      >
        {artwork}
      </HomeCircularAction>
    );
  }

  return (
    <CircularSurface
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      size={size}
    >
      {artwork}
    </CircularSurface>
  );
}

export function ProfileEntry({ identity = demoProfileIdentity }: { identity?: ProfileIdentity }) {
  const router = useRouter();
  const { fontScale } = usePreferences();

  return (
    <View style={styles.row}>
      <HomeCircularAction
        accessibilityHint="يفتح صفحة الإعدادات"
        accessibilityLabel="فتح الإعدادات"
        onPress={() => router.push('/settings')}
      >
        <Image
          accessible={false}
          contentFit="contain"
          source="sf:gearshape.fill"
          style={styles.actionSymbol}
          tintColor="#F4F4F5"
        />
      </HomeCircularAction>
      <View style={styles.profileCluster}>
        <Text
          selectable
          style={[
            styles.greeting,
            {
              fontSize: scaledFontSize(18, fontScale),
              lineHeight: scaledLineHeight(18, fontScale, 1.35),
            },
          ]}
        >
          مرحبًا، {identity.displayName}
        </Text>
        <ProfileAvatar
          accessibilityLabel="فتح الملف الشخصي"
          identity={identity}
          onPress={() => router.push('/profile')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    direction: 'ltr',
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  profileCluster: {
    alignItems: 'center',
    direction: 'ltr',
    flexDirection: 'row',
    gap: 10,
  },
  greeting: {
    color: '#F4F4F5',
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  glassShell: {
    alignItems: 'center',
    borderCurve: 'continuous',
    justifyContent: 'center',
  },
  fallbackShell: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderCurve: 'continuous',
    justifyContent: 'center',
  },
  pressable: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    width: '100%',
  },
  actionSymbol: {
    height: 26,
    width: 26,
  },
  initialAvatar: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    justifyContent: 'center',
  },
});
