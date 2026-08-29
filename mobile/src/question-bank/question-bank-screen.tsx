import { createRef, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextInputFocusEventData,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { SearchBarCommands } from 'react-native-screens';
import { Host, Icon } from '@expo/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  fetchQuestionBankLayout,
  fetchQuestionPage,
  fetchQuestionSearchPage,
  findAvailableBank,
  QUESTION_PAGE_SIZE,
  QUESTION_SEARCH_PAGE_SIZE,
  type PublicQuestionPage,
  type PublicQuestionSearchItem,
  type PublicQuestionSummary,
} from '@/question-bank/question-bank-api';
import { listFavoriteIds, setFavorite } from '@/question-bank/question-favorites-store';
import {
  QUESTION_CARD_GAP,
  QUESTION_CARD_HEIGHT,
  QuestionCard,
  QuestionCardSkeleton,
} from '@/question-bank/question-card';
import {
  QuestionReaderOverlay,
  type QuestionSourceRect,
} from '@/question-bank/question-reader-overlay';
import { questionBankIcons } from '@/question-bank/question-bank-icons';
import { HomeCircularAction } from '@/profile/profile-entry';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette, scaledFontSize, scaledLineHeight } from '@/theme';

const ARABIC_SUBJECT_KEY = 'arabic';
const ISTIFHAM_NODE_KEY = 'arabic-grammar-istifham';
const SEARCH_DEBOUNCE_MS = 300;
const SCROLL_TO_TOP_THRESHOLD = 220;
const SKELETON_ROWS = [
  { id: 'skeleton-1', kind: 'skeleton' },
  { id: 'skeleton-2', kind: 'skeleton' },
  { id: 'skeleton-3', kind: 'skeleton' },
  { id: 'skeleton-4', kind: 'skeleton' },
  { id: 'skeleton-5', kind: 'skeleton' },
] as const;

type SkeletonRow = (typeof SKELETON_ROWS)[number];
type QuestionListRow = PublicQuestionSummary | PublicQuestionSearchItem | SkeletonRow;

type ActiveReader = {
  question: PublicQuestionSummary;
  sourceRect: QuestionSourceRect | null;
};

function getSubjectKey(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function mergeByQuestionId<T extends { questionId: string }>(current: T[], incoming: T[]) {
  const seen = new Set(current.map((item) => item.questionId));
  return [...current, ...incoming.filter((item) => !seen.has(item.questionId))];
}

function isSkeletonRow(row: QuestionListRow): row is SkeletonRow {
  return 'kind' in row && row.kind === 'skeleton';
}

export function QuestionBankScreen() {
  const insets = useSafeAreaInsets();
  const { subjectKey: rawSubjectKey } = useLocalSearchParams<{
    subjectKey?: string | string[];
  }>();
  const subjectKey = getSubjectKey(rawSubjectKey) ?? '';
  const { fontScale, resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const [query, setQuery] = useState('');
  const [bankNodeId, setBankNodeId] = useState<string | null>(null);
  const [layoutLoading, setLayoutLoading] = useState(subjectKey === ARABIC_SUBJECT_KEY);
  const [layoutError, setLayoutError] = useState(false);
  const [layoutRetryKey, setLayoutRetryKey] = useState(0);
  const [normalItems, setNormalItems] = useState<PublicQuestionSummary[]>([]);
  const [normalTotal, setNormalTotal] = useState(0);
  const [normalNextOffset, setNormalNextOffset] = useState(0);
  const [normalLoaded, setNormalLoaded] = useState(false);
  const [normalLoadingMore, setNormalLoadingMore] = useState(false);
  const [normalError, setNormalError] = useState(false);
  const [paginationError, setPaginationError] = useState(false);
  const [searchItems, setSearchItems] = useState<PublicQuestionSearchItem[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchNextOffset, setSearchNextOffset] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [activeReader, setActiveReader] = useState<ActiveReader | null>(null);
  const cardRefs = useRef(new Map<string, RefObject<View | null>>());
  const normalLoadingRef = useRef(false);
  const normalAbortRef = useRef<AbortController | null>(null);
  const searchLoadingRef = useRef(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchRequestIdRef = useRef(0);
  const searchBarRef = useRef<SearchBarCommands | null>(null);
  const searchFocusedRef = useRef(false);
  const listRef = useRef<FlatList<QuestionListRow> | null>(null);
  const scrollToTopVisibleRef = useRef(false);
  const [showScrollToTop, setShowScrollToTop] = useState(false);

  useEffect(() => {
    if (subjectKey !== ARABIC_SUBJECT_KEY) {
      return;
    }

    const controller = new AbortController();
    let mounted = true;

    fetchQuestionBankLayout(subjectKey, controller.signal)
      .then((layout) => {
        if (!mounted) return;
        const bank = findAvailableBank(layout, ISTIFHAM_NODE_KEY);
        if (!bank) throw new Error('The published Istifham bank is unavailable.');
        setBankNodeId(bank.id);
      })
      .catch((error) => {
        if (!mounted || controller.signal.aborted) return;
        setLayoutError(true);
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[Pythagoras] Question Bank layout unavailable', error);
        }
      })
      .finally(() => {
        if (mounted) setLayoutLoading(false);
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [layoutRetryKey, subjectKey]);

  const requestNormalPage = useCallback(
    async (offset: number): Promise<PublicQuestionPage | null> => {
      if (!bankNodeId || normalLoadingRef.current) return null;
      normalLoadingRef.current = true;
      const controller = new AbortController();
      normalAbortRef.current = controller;

      try {
        return await fetchQuestionPage(
          subjectKey,
          bankNodeId,
          offset,
          QUESTION_PAGE_SIZE,
          controller.signal
        );
      } catch (error) {
        if (!controller.signal.aborted && process.env.NODE_ENV !== 'production') {
          console.warn('[Pythagoras] Question Bank page unavailable', error);
        }
        return null;
      } finally {
        normalLoadingRef.current = false;
      }
    },
    [bankNodeId, subjectKey]
  );

  useEffect(() => {
    if (!bankNodeId || subjectKey !== ARABIC_SUBJECT_KEY) return;

    let mounted = true;
    void requestNormalPage(0).then((page) => {
      if (!mounted) return;
      if (!page) {
        setNormalError(true);
        return;
      }
      setNormalItems(page.items);
      setNormalTotal(page.total);
      setNormalNextOffset(page.offset + page.items.length);
      setNormalLoaded(true);
    });
    listFavoriteIds(subjectKey)
      .then((ids) => {
        if (mounted) setFavoriteIds(new Set(ids));
      })
      .catch((error) => {
        if (mounted && process.env.NODE_ENV !== 'production') {
          console.warn('[Pythagoras] Question favorites unavailable', error);
        }
      });

    return () => {
      mounted = false;
      normalAbortRef.current?.abort();
      normalLoadingRef.current = false;
    };
  }, [bankNodeId, requestNormalPage, subjectKey]);

  const searchQuery = query.trim();

  const handleSearchChange = useCallback(
    (event: NativeSyntheticEvent<TextInputFocusEventData>) => {
      const nextQuery = event.nativeEvent.text;
      setQuery(nextQuery);
      setSearchItems([]);
      setSearchTotal(0);
      setSearchNextOffset(0);
      setSearchError(false);
      setSearchLoading(Boolean(nextQuery.trim()));
      setSearchLoadingMore(false);
    },
    []
  );

  const handleSearchFocus = useCallback(() => {
    searchFocusedRef.current = true;
  }, []);

  const handleSearchBlur = useCallback(() => {
    searchFocusedRef.current = false;
  }, []);

  const handleListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const shouldShow = event.nativeEvent.contentOffset.y > SCROLL_TO_TOP_THRESHOLD;
    if (shouldShow === scrollToTopVisibleRef.current) return;

    scrollToTopVisibleRef.current = shouldShow;
    setShowScrollToTop(shouldShow);
  }, []);

  const scrollToTop = useCallback(() => {
    listRef.current?.scrollToOffset({ animated: true, offset: 0 });
  }, []);

  useEffect(() => {
    searchAbortRef.current?.abort();
    searchRequestIdRef.current += 1;
    const requestId = searchRequestIdRef.current;

    if (!bankNodeId || subjectKey !== ARABIC_SUBJECT_KEY || !searchQuery) {
      return;
    }

    const controller = new AbortController();
    searchAbortRef.current = controller;

    const timer = setTimeout(() => {
      setSearchLoading(true);
      setSearchError(false);
      void fetchQuestionSearchPage(
        subjectKey,
        bankNodeId,
        searchQuery,
        0,
        QUESTION_SEARCH_PAGE_SIZE,
        controller.signal
      )
        .then((page) => {
          if (controller.signal.aborted || requestId !== searchRequestIdRef.current) return;
          setSearchItems(page.items);
          setSearchTotal(page.total);
          setSearchNextOffset(page.offset + page.items.length);
        })
        .catch((error) => {
          if (controller.signal.aborted || requestId !== searchRequestIdRef.current) return;
          setSearchError(true);
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[Pythagoras] Question Bank search unavailable', error);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted && requestId === searchRequestIdRef.current) {
            setSearchLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [bankNodeId, searchQuery, subjectKey]);

  const layoutPending = subjectKey === ARABIC_SUBJECT_KEY && layoutLoading;
  const normalInitialLoading = Boolean(bankNodeId) && !normalLoaded && !normalError;
  const initialListLoading = layoutPending || normalInitialLoading;

  const loadMoreNormal = useCallback(() => {
    if (normalItems.length >= normalTotal || normalInitialLoading || normalLoadingMore) return;
    setNormalLoadingMore(true);
    setPaginationError(false);
    void requestNormalPage(normalNextOffset).then((page) => {
      if (!page) {
        setPaginationError(true);
        return;
      }
      setNormalItems((current) => mergeByQuestionId(current, page.items));
      setNormalTotal(page.total);
      setNormalNextOffset(page.offset + page.items.length);
    }).finally(() => setNormalLoadingMore(false));
  }, [normalInitialLoading, normalItems.length, normalLoadingMore, normalNextOffset, normalTotal, requestNormalPage]);

  const loadMoreSearch = useCallback(async () => {
    if (
      !bankNodeId ||
      !searchQuery ||
      searchItems.length >= searchTotal ||
      searchLoading ||
      searchLoadingMore ||
      searchLoadingRef.current
    ) {
      return;
    }

    searchLoadingRef.current = true;
    const requestId = searchRequestIdRef.current;
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearchLoadingMore(true);

    try {
      const page = await fetchQuestionSearchPage(
        subjectKey,
        bankNodeId,
        searchQuery,
        searchNextOffset,
        QUESTION_SEARCH_PAGE_SIZE,
        controller.signal
      );
      if (controller.signal.aborted || requestId !== searchRequestIdRef.current) return;
      setSearchItems((current) => mergeByQuestionId(current, page.items));
      setSearchTotal(page.total);
      setSearchNextOffset(page.offset + page.items.length);
    } catch (error) {
      if (controller.signal.aborted || requestId !== searchRequestIdRef.current) return;
      setSearchError(true);
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[Pythagoras] Question Bank search page unavailable', error);
      }
    } finally {
      searchLoadingRef.current = false;
      if (requestId === searchRequestIdRef.current) setSearchLoadingMore(false);
    }
  }, [
    bankNodeId,
    searchItems.length,
    searchNextOffset,
    searchQuery,
    searchLoading,
    searchLoadingMore,
    searchTotal,
    subjectKey,
  ]);

  const getCardRef = useCallback((questionId: string) => {
    const existing = cardRefs.current.get(questionId);
    if (existing) return existing;
    const next = createRef<View>();
    cardRefs.current.set(questionId, next);
    return next;
  }, []);

  const openQuestion = useCallback(
    (question: PublicQuestionSummary) => {
      if (searchFocusedRef.current) {
        searchFocusedRef.current = false;
        searchBarRef.current?.blur();
        Keyboard.dismiss();
        return;
      }
      const ref = getCardRef(question.questionId);
      Keyboard.dismiss();

      if (!ref.current) {
        setActiveReader({ question, sourceRect: null });
        return;
      }

      ref.current.measureInWindow((x, y, width, height) => {
        setActiveReader({
          question,
          sourceRect: width > 0 && height > 0 ? { height, width, x, y } : null,
        });
      });
    },
    [getCardRef]
  );

  const handleFavoriteChange = useCallback(
    async (favorite: boolean) => {
      if (!bankNodeId || !activeReader) return;
      const questionId = activeReader.question.questionId;
      setFavoriteIds((current) => {
        const next = new Set(current);
        if (favorite) next.add(questionId);
        else next.delete(questionId);
        return next;
      });

      try {
        await setFavorite(subjectKey, questionId, bankNodeId, favorite, {
          ordinal: activeReader.question.ordinal,
          ministerialCount: activeReader.question.sourceSummary.find((item) => item.sourceKind === 'ministerial')?.count ?? 0,
          previewText: activeReader.question.primaryPreview,
          previewRich: activeReader.question.primaryPreviewRich,
        });
      } catch (error) {
        setFavoriteIds((current) => {
          const next = new Set(current);
          if (favorite) next.delete(questionId);
          else next.add(questionId);
          return next;
        });
        throw error;
      }
    },
    [activeReader, bankNodeId, subjectKey]
  );

  const handleReaderClosed = useCallback(() => {
    setActiveReader(null);
  }, []);

  const searchMode = Boolean(searchQuery) && subjectKey === ARABIC_SUBJECT_KEY;
  const listData = useMemo<QuestionListRow[]>(() => {
    if (searchMode) {
      if (searchLoading && searchItems.length === 0) return [...SKELETON_ROWS];
      return searchItems;
    }
    if (initialListLoading && normalItems.length === 0) {
      return [...SKELETON_ROWS];
    }
    return normalItems;
  }, [initialListLoading, normalItems, searchItems, searchLoading, searchMode]);

  const renderItem = useCallback(
    ({ item }: { item: QuestionListRow }) => {
      if (isSkeletonRow(item)) return <QuestionCardSkeleton palette={palette} />;
      const ordinal = 'bankOrdinal' in item ? item.bankOrdinal : item.ordinal;
      const question: PublicQuestionSummary = { ...item, ordinal };
      return (
        <QuestionCard
          cardRef={getCardRef(question.questionId)}
          fontScale={fontScale}
          hidden={activeReader?.question.questionId === question.questionId}
          isFavorite={favoriteIds.has(question.questionId)}
          onPress={() => openQuestion(question)}
          palette={palette}
          question={question}
        />
      );
    },
    [activeReader?.question.questionId, favoriteIds, fontScale, getCardRef, openQuestion, palette]
  );

  const retryNormal = useCallback(() => {
    setNormalLoaded(false);
    setNormalError(false);
    void requestNormalPage(0).then((page) => {
      if (!page) {
        setNormalError(true);
        return;
      }
      setNormalItems(page.items);
      setNormalTotal(page.total);
      setNormalNextOffset(page.offset + page.items.length);
      setNormalLoaded(true);
    });
  }, [requestNormalPage]);

  const retryLayout = useCallback(() => {
    setBankNodeId(null);
    setNormalItems([]);
    setNormalTotal(0);
    setNormalNextOffset(0);
    setNormalLoaded(false);
    setNormalError(false);
    setPaginationError(false);
    setLayoutLoading(true);
    setLayoutError(false);
    setLayoutRetryKey((value) => value + 1);
  }, []);

  const renderEmpty = useCallback(() => {
    let message = 'لا توجد أسئلة متاحة حاليًا';
    let actionLabel: string | undefined;
    let onAction: (() => void) | undefined;

    if (initialListLoading || searchLoading) return null;
    if (layoutError) {
      message = 'تعذر تحميل بنك الأسئلة';
      actionLabel = 'إعادة المحاولة';
      onAction = retryLayout;
    } else if (normalError && !searchMode) {
      message = 'تعذر تحميل الأسئلة';
      actionLabel = 'إعادة المحاولة';
      onAction = retryNormal;
    } else if (searchError && searchMode) {
      message = 'تعذر البحث حاليًا';
    } else if (searchMode) {
      message = 'لا توجد نتائج مطابقة';
    } else if (subjectKey !== ARABIC_SUBJECT_KEY) {
      message = 'لا يتوفر بنك أسئلة لهذه المادة حاليًا';
    }

    return (
      <View style={styles.emptyState}>
        <Text
          selectable
          style={[
            styles.emptyMessage,
            {
              color: palette.textTertiary,
              fontSize: scaledFontSize(16, fontScale),
              lineHeight: scaledLineHeight(16, fontScale, 1.45),
            },
          ]}
        >
          {message}
        </Text>
        {actionLabel && onAction && (
          <Pressable accessibilityRole="button" onPress={onAction}>
            <Text
              style={[
                styles.retryText,
                {
                  color: palette.textSecondary,
                  fontSize: scaledFontSize(15, fontScale),
                },
              ]}
            >
              {actionLabel}
            </Text>
          </Pressable>
        )}
      </View>
    );
  }, [fontScale, initialListLoading, layoutError, normalError, palette, retryLayout, retryNormal, searchError, searchLoading, searchMode, subjectKey]);

  const listFooter = useMemo(() => {
    if (searchMode) {
      if (searchLoadingMore) {
        return <ActivityIndicator color={palette.textTertiary} size="small" />;
      }
      return searchError && searchItems.length > 0 ? (
        <Pressable accessibilityRole="button" onPress={() => void loadMoreSearch()}>
          <Text style={[styles.footerRetry, { color: palette.textSecondary }]}>إعادة المحاولة</Text>
        </Pressable>
      ) : null;
    }
    if (normalLoadingMore) {
      return <ActivityIndicator color={palette.textTertiary} size="small" />;
    }
    if (paginationError) {
      return (
        <Pressable accessibilityRole="button" onPress={() => void loadMoreNormal()}>
          <Text style={[styles.footerRetry, { color: palette.textSecondary }]}>إعادة المحاولة</Text>
        </Pressable>
      );
    }
    return null;
  }, [
    loadMoreNormal,
    loadMoreSearch,
    normalLoadingMore,
    paginationError,
    palette.textSecondary,
    palette.textTertiary,
    searchError,
    searchItems.length,
    searchLoadingMore,
    searchMode,
  ]);

  return (
    <>
      <FlatList
        contentContainerStyle={[
          styles.content,
          { backgroundColor: palette.background },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        data={listData}
        getItemLayout={(_, index) => ({
          index,
          length: QUESTION_CARD_HEIGHT_WITH_GAP,
          offset: QUESTION_CARD_HEIGHT_WITH_GAP * index,
        })}
        initialNumToRender={12}
        keyExtractor={(item) => (isSkeletonRow(item) ? item.id : item.questionId)}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={listFooter}
        onEndReached={searchMode ? loadMoreSearch : loadMoreNormal}
        onEndReachedThreshold={0.65}
        onScroll={handleListScroll}
        renderItem={renderItem}
        ref={listRef}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        style={[styles.container, { backgroundColor: palette.background }]}
        windowSize={7}
      />
      {showScrollToTop ? (
        <View
          pointerEvents="box-none"
          style={[styles.scrollToTopSlot, { bottom: Math.max(insets.bottom + 16, 24) }]}
        >
          <HomeCircularAction
            accessibilityHint="يعيد قائمة الأسئلة إلى بدايتها"
            accessibilityLabel="العودة إلى بداية بنك الأسئلة"
            onPress={scrollToTop}
          >
            <Host
              colorScheme={resolvedColorScheme}
              layoutDirection="rightToLeft"
              matchContents
              style={styles.scrollToTopIconHost}
            >
              <Icon color={palette.text} name={questionBankIcons.scrollToTop} size={22} />
            </Host>
          </HomeCircularAction>
        </View>
      ) : null}
      <Stack.SearchBar
        allowToolbarIntegration={false}
        autoCapitalize="none"
        hideWhenScrolling={false}
        onBlur={handleSearchBlur}
        onChangeText={handleSearchChange}
        onFocus={handleSearchFocus}
        placement="stacked"
        placeholder="ابحث في بنك الأسئلة"
        ref={searchBarRef}
      />
      <StatusBar style={resolvedColorScheme === 'dark' ? 'light' : 'dark'} />
      {activeReader && bankNodeId && (
        <QuestionReaderOverlay
          bankNodeId={bankNodeId}
          initialFavorite={favoriteIds.has(activeReader.question.questionId)}
          onClosed={handleReaderClosed}
          onFavoriteChange={handleFavoriteChange}
          question={activeReader.question}
          sourceRect={activeReader.sourceRect}
          subjectKey={subjectKey}
        />
      )}
    </>
  );
}

const QUESTION_CARD_HEIGHT_WITH_GAP = QUESTION_CARD_HEIGHT + QUESTION_CARD_GAP;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    gap: QUESTION_CARD_GAP,
    paddingBottom: 40,
    paddingHorizontal: 17,
    paddingTop: 18,
  },
  emptyState: {
    alignItems: 'center',
    gap: 12,
    justifyContent: 'center',
    minHeight: 180,
    width: '100%',
  },
  emptyMessage: {
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  retryText: {
    fontWeight: '600',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  footerRetry: {
    paddingVertical: 12,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  scrollToTopSlot: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 10,
  },
  scrollToTopIconHost: {
    height: 24,
    width: 24,
  },
});
