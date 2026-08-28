import {
  Column,
  FieldGroup,
  Host,
  Picker,
  Row,
  Slider,
  Spacer,
  Switch,
  Text as NativeText,
} from '@expo/ui';

import { type AppearanceMode, usePreferences } from '@/preferences/preferences-provider';
import { getPalette, scaledFontSize, scaledLineHeight } from '@/theme';

const appearanceOptions: { label: string; value: AppearanceMode }[] = [
  { label: 'تلقائي', value: 'system' },
  { label: 'فاتح', value: 'light' },
  { label: 'داكن', value: 'dark' },
];

export function SettingsScreen() {
  const {
    appearanceMode,
    fontScale,
    resolvedColorScheme,
    setAppearanceMode,
    setFontScale,
    setShowDailySummary,
    showDailySummary,
  } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const previewSize = scaledFontSize(17, fontScale);
  const previewLineHeight = scaledLineHeight(17, fontScale, 1.45);

  return (
    <Host
      colorScheme={resolvedColorScheme}
      layoutDirection="rightToLeft"
      style={{ flex: 1 }}>
      <FieldGroup>
        <FieldGroup.Section title="المظهر">
          <Row alignment="center" spacing={10}>
            <NativeText
              textStyle={{
                color: palette.text,
                fontSize: scaledFontSize(17, fontScale),
                textAlign: 'right',
              }}>
              المظهر
            </NativeText>
            <Spacer flexible />
            <Picker<AppearanceMode>
              selectedValue={appearanceMode}
              onValueChange={setAppearanceMode}
              appearance="menu"
              testID="appearance-picker">
              {appearanceOptions.map((option) => (
                <Picker.Item key={option.value} label={option.label} value={option.value} />
              ))}
            </Picker>
          </Row>
        </FieldGroup.Section>

        <FieldGroup.Section title="النص والعرض">
          <Row alignment="center" spacing={10}>
            <NativeText
              textStyle={{
                color: palette.text,
                fontSize: scaledFontSize(17, fontScale),
                textAlign: 'right',
              }}>
              حجم النص
            </NativeText>
            <Spacer flexible />
            <NativeText
              textStyle={{
                color: palette.textSecondary,
                fontSize: scaledFontSize(15, fontScale),
                textAlign: 'right',
              }}>
              {`${Math.round(fontScale * 100)}٪`}
            </NativeText>
          </Row>
          <Slider
            value={fontScale}
            min={0.9}
            max={1.25}
            step={0.05}
            onValueChange={setFontScale}
            testID="font-scale-slider"
          />
          <FieldGroup.SectionFooter>
            <Column alignment="end" spacing={8}>
              <Row alignment="center">
                <NativeText
                  textStyle={{
                    color: palette.textTertiary,
                    fontSize: scaledFontSize(12, fontScale),
                    textAlign: 'right',
                  }}>
                  A
                </NativeText>
                <Spacer flexible />
                <NativeText
                  textStyle={{
                    color: palette.textTertiary,
                    fontSize: scaledFontSize(21, fontScale),
                    fontWeight: '600',
                    textAlign: 'right',
                  }}>
                  A
                </NativeText>
              </Row>
              <NativeText
                textStyle={{
                  color: palette.textSecondary,
                  fontSize: previewSize,
                  lineHeight: previewLineHeight,
                  textAlign: 'right',
                }}>
                هكذا سيظهر النص داخل فيثاغورس
              </NativeText>
            </Column>
          </FieldGroup.SectionFooter>
        </FieldGroup.Section>

        <FieldGroup.Section title="الرئيسية">
          <Switch
            label="إظهار ملخص اليوم"
            value={showDailySummary}
            onValueChange={setShowDailySummary}
            testID="daily-summary-switch"
          />
        </FieldGroup.Section>

        <FieldGroup.Section title="حول التطبيق">
          <Column alignment="end" spacing={4}>
            <NativeText
              textStyle={{
                color: palette.text,
                fontSize: scaledFontSize(17, fontScale),
                fontWeight: '600',
                textAlign: 'right',
              }}>
              Pythagoras
            </NativeText>
            <NativeText
              textStyle={{
                color: palette.textSecondary,
                fontSize: scaledFontSize(14, fontScale),
                lineHeight: scaledLineHeight(14, fontScale, 1.35),
                textAlign: 'right',
              }}>
              نسخة تجريبية Native
            </NativeText>
          </Column>
        </FieldGroup.Section>
      </FieldGroup>
    </Host>
  );
}
