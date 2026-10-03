import { useMemo } from 'react';
import { Text, View } from 'react-native';
import {
  Canvas,
  FontWeight,
  LinearGradient,
  Mask,
  Paragraph,
  Rect,
  Skia,
  TextAlign,
  TextDirection,
  useClock,
  vec,
} from '@shopify/react-native-skia';
import { useDerivedValue, useReducedMotion } from 'react-native-reanimated';

import type { Palette } from '@/theme';

const LABEL_WIDTH = 140;
const SWEEP_PERIOD_MS = 1_500;

export function ChatShimmerText({ text, palette }: { text: string; palette: Palette }) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) {
    return (
      <Text accessibilityRole="text" style={{ color: palette.textSecondary, fontSize: 16, fontWeight: '500' }}>
        {text}
      </Text>
    );
  }
  return <AnimatedShimmerText text={text} palette={palette} />;
}

function AnimatedShimmerText({ text, palette }: { text: string; palette: Palette }) {
  const paragraph = useMemo(() => {
    const builder = Skia.ParagraphBuilder.Make({
      textDirection: TextDirection.RTL,
      textAlign: TextAlign.Right,
      maxLines: 1,
      textStyle: {
        color: Skia.Color('#FFFFFF'),
        fontFamilies: ['System'],
        fontSize: 16,
        fontStyle: { weight: FontWeight.Medium },
      },
    });
    builder.pushStyle({
      color: Skia.Color('#FFFFFF'),
      fontFamilies: ['System'],
      fontSize: 16,
      fontStyle: { weight: FontWeight.Medium },
    });
    builder.addText(text);
    builder.pop();
    const result = builder.build();
    result.layout(LABEL_WIDTH);
    return result;
  }, [text]);
  const height = Math.max(1, Math.ceil(paragraph.getHeight()));
  const bandWidth = LABEL_WIDTH * 0.5;
  const sweepDistance = LABEL_WIDTH + bandWidth * 2;
  const clock = useClock();
  const gradientStartX = useDerivedValue(
    () => -bandWidth + ((clock.value % SWEEP_PERIOD_MS) / SWEEP_PERIOD_MS) * sweepDistance,
    [bandWidth, sweepDistance],
  );
  const gradientStart = useDerivedValue(() => vec(gradientStartX.value, 0));
  const gradientEnd = useDerivedValue(() => vec(gradientStartX.value + bandWidth, 0));

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={text} style={{ width: LABEL_WIDTH, height }}>
      <Canvas style={{ width: LABEL_WIDTH, height }}>
        <Mask
          mode="alpha"
          mask={<Paragraph paragraph={paragraph} x={0} y={0} width={LABEL_WIDTH} />}
        >
          <Rect x={0} y={0} width={LABEL_WIDTH} height={height}>
            <LinearGradient
              start={gradientStart}
              end={gradientEnd}
              colors={[
                Skia.Color(palette.textTertiary),
                Skia.Color(palette.text),
                Skia.Color(palette.textTertiary),
              ]}
              positions={[0, 0.5, 1]}
            />
          </Rect>
        </Mask>
      </Canvas>
    </View>
  );
}
