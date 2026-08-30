import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { fetchAppContent, type AppContentData } from '@/api/app-content';
import { MaterialActionCard } from '@/materials/material-action-card';
import { materialIcons } from '@/materials/material-icons';
import { getMaterialRouteOptions } from '@/materials/material-route-options';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette, scaledFontSize, scaledLineHeight } from '@/theme';

const ACTIONS = [
  { key: 'question-bank', label: 'بنك الأسئلة', icon: materialIcons.questionBank },
  { key: 'history', label: 'سجل الاختبارات', icon: materialIcons.history },
  { key: 'favorites', label: 'المفضلة', icon: materialIcons.favorites },
] as const;

function getSubjectKey(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function MaterialScreen() {
  const router = useRouter();
  const { subjectKey: rawSubjectKey } = useLocalSearchParams<{ subjectKey?: string | string[] }>();
  const subjectKey = getSubjectKey(rawSubjectKey);
  const { fontScale, resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const [content, setContent] = useState<AppContentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    fetchAppContent(controller.signal)
      .then((nextContent) => {
        if (mounted) setContent(nextContent);
      })
      .catch((error) => {
        if (mounted) setHasError(true);
        if (mounted && process.env.NODE_ENV !== 'production') {
          console.warn('[Pythagoras] Material content unavailable', error);
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  const material = content?.materials.find(
    (candidate) => candidate.available && candidate.subjectKey === subjectKey
  );

  return (
    <>
      <Stack.Screen
        options={{
          ...getMaterialRouteOptions(resolvedColorScheme),
          title: material?.label ?? 'المادة',
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        style={[styles.container, { backgroundColor: palette.background }]}
      >
        {loading ? (
          <Text
            selectable
            style={[
              styles.message,
              {
                color: palette.textSecondary,
                fontSize: scaledFontSize(17, fontScale),
                lineHeight: scaledLineHeight(17, fontScale, 1.4),
              },
            ]}
          >
            جارٍ تحميل المادة
          </Text>
        ) : material ? (
          <View style={styles.actionList}>
            <MaterialActionCard
              colorScheme={resolvedColorScheme}
              fontScale={fontScale}
              icon={materialIcons.quiz}
              label="اختبرني"
              onPress={() =>
                router.push(`/materials/${material.subjectKey}/quiz` as Href)
              }
              primary
            />
            <View
              style={[
                styles.secondaryActions,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
              ]}
            >
              {ACTIONS.map((action, index) => (
                <View key={action.key}>
                  <MaterialActionCard
                    colorScheme={resolvedColorScheme}
                    fontScale={fontScale}
                    grouped
                    icon={action.icon}
                    label={action.label}
                    onPress={() =>
                      router.push(`/materials/${material.subjectKey}/${action.key}` as Href)
                    }
                  />
                  {index < ACTIONS.length - 1 ? (
                    <View style={[styles.secondarySeparator, { backgroundColor: palette.separator }]} />
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        ) : (
          <Text
            selectable
            style={[
              styles.message,
              {
                color: palette.textSecondary,
                fontSize: scaledFontSize(17, fontScale),
                lineHeight: scaledLineHeight(17, fontScale, 1.4),
              },
            ]}
            >
            {hasError ? 'تعذر تحميل المادة' : 'هذه المادة غير متاحة حاليًا'}
          </Text>
        )}
      </ScrollView>
      <StatusBar style={resolvedColorScheme === 'dark' ? 'light' : 'dark'} />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingBottom: 40,
    paddingHorizontal: 18,
    paddingTop: 24,
  },
  actionList: {
    gap: 20,
  },
  secondaryActions: {
    borderCurve: 'continuous',
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 0,
    paddingVertical: 4,
  },
  secondarySeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 20,
  },
  message: {
    alignSelf: 'center',
    marginTop: 80,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
