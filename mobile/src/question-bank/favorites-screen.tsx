import { createRef, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { FlatList, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import type { PublicQuestionSummary } from '@/question-bank/question-bank-api';
import { listFavorites, setFavorite, type FavoriteRecord } from '@/question-bank/question-favorites-store';
import { QUESTION_CARD_GAP, QUESTION_CARD_HEIGHT, QuestionCard } from '@/question-bank/question-card';
import { QuestionReaderOverlay, type QuestionSourceRect } from '@/question-bank/question-reader-overlay';
import { getMaterialRouteOptions } from '@/materials/material-route-options';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette, scaledFontSize, scaledLineHeight } from '@/theme';

type ActiveReader = {
  question: PublicQuestionSummary;
  bankNodeId: string;
  sourceRect: QuestionSourceRect | null;
};

function getSubjectKey(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function toSummary(record: FavoriteRecord): PublicQuestionSummary {
  return {
    questionId: record.questionId,
    ordinal: record.ordinal,
    primaryPreview: record.previewText,
    primaryPreviewRich: record.previewRich,
    taxonomyBreadcrumb: '',
    variantCount: 1,
    occurrenceCount: 0,
    sourceSummary: record.ministerialCount > 0 ? [{ sourceKind: 'ministerial', count: record.ministerialCount }] : [],
    hasAnswer: true,
  };
}

export function FavoritesScreen() {
  const { subjectKey: rawSubjectKey } = useLocalSearchParams<{ subjectKey?: string | string[] }>();
  const subjectKey = getSubjectKey(rawSubjectKey) ?? '';
  const { resolvedColorScheme, fontScale } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const [records, setRecords] = useState<FavoriteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeReader, setActiveReader] = useState<ActiveReader | null>(null);
  const cardRefs = useRef(new Map<string, RefObject<View | null>>());

  useEffect(() => {
    let mounted = true;
    void listFavorites(subjectKey)
      .then((next) => {
        if (mounted) setRecords(next);
      })
      .catch((reason) => {
        if (!mounted) return;
        setError(true);
        if (process.env.NODE_ENV !== 'production') console.warn('[Pythagoras] Favorites unavailable', reason);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [reloadKey, subjectKey]);

  const retry = useCallback(() => {
    setError(false);
    setLoading(true);
    setReloadKey((value) => value + 1);
  }, []);

  const getCardRef = useCallback((questionId: string) => {
    const existing = cardRefs.current.get(questionId);
    if (existing) return existing;
    const next = createRef<View>();
    cardRefs.current.set(questionId, next);
    return next;
  }, []);

  const openQuestion = useCallback((record: FavoriteRecord) => {
    const ref = getCardRef(record.questionId);
    Keyboard.dismiss();
    if (!ref.current) {
      setActiveReader({ bankNodeId: record.bankNodeId, question: toSummary(record), sourceRect: null });
      return;
    }
    ref.current.measureInWindow((x, y, width, height) => {
      setActiveReader({ bankNodeId: record.bankNodeId, question: toSummary(record), sourceRect: width > 0 && height > 0 ? { height, width, x, y } : null });
    });
  }, [getCardRef]);

  const handleFavoriteChange = useCallback(async (favorite: boolean) => {
    if (!activeReader) return;
    const { question, bankNodeId } = activeReader;
    await setFavorite(subjectKey, question.questionId, bankNodeId, favorite, {
      ordinal: question.ordinal,
      ministerialCount: question.sourceSummary.find((item) => item.sourceKind === 'ministerial')?.count ?? 0,
      previewText: question.primaryPreview,
      previewRich: question.primaryPreviewRich,
    });
    if (!favorite) setRecords((current) => current.filter((record) => record.questionId !== question.questionId));
  }, [activeReader, subjectKey]);

  const data = useMemo(() => records.map(toSummary), [records]);
  const emptyMessage = loading ? '' : error ? 'تعذر تحميل المفضلة' : 'لا توجد أسئلة مفضلة بعد';

  return (
    <>
      <Stack.Screen options={{ ...getMaterialRouteOptions(resolvedColorScheme), title: 'المفضلة' }} />
      <FlatList
        contentContainerStyle={[styles.content, { backgroundColor: palette.background }]}
        contentInsetAdjustmentBehavior="automatic"
        data={data}
        getItemLayout={(_, index) => ({ index, length: QUESTION_CARD_HEIGHT + QUESTION_CARD_GAP, offset: (QUESTION_CARD_HEIGHT + QUESTION_CARD_GAP) * index })}
        keyExtractor={(item) => item.questionId}
        ListEmptyComponent={emptyMessage ? <View style={styles.empty}><Text selectable style={[styles.emptyText, { color: palette.textTertiary, fontSize: scaledFontSize(16, fontScale), lineHeight: scaledLineHeight(16, fontScale, 1.45) }]}>{emptyMessage}</Text>{error ? <Pressable accessibilityRole="button" onPress={retry}><Text style={[styles.retry, { color: palette.textSecondary }]}>إعادة المحاولة</Text></Pressable> : null}</View> : null}
        renderItem={({ item }) => <QuestionCard cardRef={getCardRef(item.questionId)} fontScale={fontScale} onPress={() => { const record = records.find((candidate) => candidate.questionId === item.questionId); if (record) openQuestion(record); }} palette={palette} question={item} />}
        showsVerticalScrollIndicator={false}
        style={{ backgroundColor: palette.background }}
      />
      <StatusBar style={resolvedColorScheme === 'dark' ? 'light' : 'dark'} />
      {activeReader ? <QuestionReaderOverlay bankNodeId={activeReader.bankNodeId} initialFavorite onClosed={() => setActiveReader(null)} onFavoriteChange={handleFavoriteChange} question={activeReader.question} sourceRect={activeReader.sourceRect} subjectKey={subjectKey} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: QUESTION_CARD_GAP, paddingBottom: 40, paddingHorizontal: 17, paddingTop: 18 },
  empty: { alignItems: 'center', gap: 12, justifyContent: 'center', minHeight: 220, width: '100%' },
  emptyText: { textAlign: 'center', writingDirection: 'rtl' },
  retry: { fontWeight: '600', textAlign: 'center', writingDirection: 'rtl' },
});
