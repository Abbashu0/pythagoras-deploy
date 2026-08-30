import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { scaledFontSize, scaledLineHeight, type Palette } from '@/theme';

type SettingsInfoPopoverContentProps = {
  fontScale: number;
  palette: Palette;
};

const infoRows = [
  { icon: 'doc.text', label: 'سياسة الاستخدام المقبول' },
  { icon: 'doc.plaintext', label: 'شروط المستهلك' },
  { icon: 'lock.shield', label: 'سياسة الخصوصية' },
  { icon: 'books.vertical', label: 'التراخيص' },
] as const;

function getAppIdentityLabel() {
  const version = Constants.expoConfig?.version?.trim();

  return version ? `Pythagoras v${version}` : 'Pythagoras';
}

function InfoSymbol({ name, palette }: { name: string; palette: Palette }) {
  if (process.env.EXPO_OS !== 'ios') {
    return <View style={[styles.symbolFallback, { backgroundColor: palette.textSecondary }]} />;
  }

  return (
    <Image
      accessible={false}
      contentFit="contain"
      source={`sf:${name}`}
      style={styles.symbol}
      tintColor={palette.textSecondary}
    />
  );
}

export function SettingsInfoPopoverContent({
  fontScale,
  palette,
}: SettingsInfoPopoverContentProps) {
  const rowFontSize = scaledFontSize(14, fontScale);
  const rowLineHeight = scaledLineHeight(14, fontScale, 1.35);

  return (
    <View style={styles.content}>
      <View style={styles.identity}>
        <Text
          selectable
          style={[
            styles.identityLabel,
            {
              color: palette.text,
              fontSize: scaledFontSize(18, fontScale),
              lineHeight: scaledLineHeight(18, fontScale, 1.3),
            },
          ]}
        >
          {getAppIdentityLabel()}
        </Text>
      </View>

      <View style={styles.rows}>
        {infoRows.map((row) => (
          <View key={row.label} style={styles.row}>
            <InfoSymbol name={row.icon} palette={palette} />
            <Text
              selectable
              style={[
                styles.rowLabel,
                {
                  color: palette.text,
                  fontSize: rowFontSize,
                  lineHeight: rowLineHeight,
                },
              ]}
            >
              {row.label}
            </Text>
          </View>
        ))}
      </View>

      <View style={[styles.separator, { backgroundColor: palette.separator }]} />

      <View style={styles.row}>
        <InfoSymbol name="questionmark.circle" palette={palette} />
        <Text
          selectable
          style={[
            styles.rowLabel,
            {
              color: palette.text,
              fontSize: rowFontSize,
              lineHeight: rowLineHeight,
            },
          ]}
        >
          المساعدة والدعم
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 16,
    width: 300,
  },
  identity: {
    alignItems: 'center',
    paddingBottom: 4,
  },
  identityLabel: {
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: 'ltr',
  },
  rows: {
    gap: 2,
  },
  row: {
    alignItems: 'center',
    direction: 'rtl',
    flexDirection: 'row',
    gap: 12,
    minHeight: 36,
  },
  rowLabel: {
    flex: 1,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 2,
  },
  symbol: {
    height: 18,
    width: 18,
  },
  symbolFallback: {
    borderRadius: 999,
    height: 8,
    marginHorizontal: 5,
    width: 8,
  },
});
