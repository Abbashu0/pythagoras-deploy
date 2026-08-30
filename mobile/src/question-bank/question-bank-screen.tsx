import { createRef, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Host, Icon, type TextInputRef } from '@expo/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  fetchQuestionBankLayout,
  fetchQuestionPage,
  fetchQuestionSearchPage,
  QUESTION_PAGE_SIZE,
  QUESTION_SEARCH_PAGE_SIZE,
  type PublicQuestionPage,
  type PublicMaterialQuestionBankNode,
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
import {
  QUESTION_BANK_CONTROL_GAP,
  QUESTION_BANK_HORIZONTAL_INSET,
  QUESTION_BANK_SEARCH_MIN_WIDTH,
} from '@/question-bank/question-bank-control-geometry';
import { QuestionBankSearchInput } from '@/question-bank/question-bank-search-input';
import {
  ARABIC_SUBJECT_KEY,
  DEFAULT_GRAMMAR_TOPIC_NODE_KEY,
  getDefaultGrammarTopicNode,
  getGrammarTopicNodes,
} from '@/question-bank/question-bank-topics';
import { QuestionTopicSelector } from '@/question-bank/question-topic-selector';
import { HomeCircularAction } from '@/profile/profile-entry';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette, scaledFontSize, scaledLineHeight } from '@/theme';

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
  const { width: windowWidth } = useWindowDimensions();
  const { subjectKey: rawSubjectKey } = useLocalSearchParams<{
    subjectKey?: string | string[];
  }>();
  const subjectKey = getSubjectKey(rawSubjectKey) ?? '';
  const { fontScale, resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const isArabic = subjectKey === ARABIC_SUBJECT_KEY;
  const [query, setQuery] = useState('');
  const [grammarTopics, setGrammarTopics] = useState<PublicMaterialQuestionBankNode[]>([]);
  const [selectedTopicNodeKey, setSelectedTopicNodeKey] = useState(
    DEFAULT_GRAMMAR_TOPIC_NODE_KEY
  );
  const [layoutLoading, setLayoutLoading] = useState(isArabic);
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
  const normalRequestIdRef = useRef(0);
  const searchLoadingRef = useRef(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchRequestIdRef = useRef(0);
  const searchBarRef = useRef<TextInputRef | null>(null);
  const searchFocusedRef = useRef(false);
  const listRef = useRef<FlatList<QuestionListRow> | null>(null);
  const scrollToTopVisibleRef = useRef(false);
  const [showScrollToTop, setShowScrollToTop] = useState(false);

  const selectedTopic = useMemo(
    () => (isArabic ? grammarTopics.find((topic) => topic.nodeKey === selectedTopicNodeKey) ?? null : null),
    [grammarTopics, isArabic, selectedTopicNodeKey]
  );
  const bankNodeId = selectedTopic?.id ?? null;
  const selectedTopicAvailable = isArabic && selectedTopic?.available === true;
  const topicMaxWidth = Math.max(
    0,
    Math.round(
      windowWidth -
        QUESTION_BANK_HORIZONTAL_INSET * 2 -
        QUESTION_BANK_CONTROL_GAP -
        QUESTION_BANK_SEARCH_MIN_WIDTH
    )
  );
  const searchQuery = query.trim();

  useEffect(() => {
    if (!isArabic) {
      return;
    }

    const controller = new AbortController();
    let mounted = true;

    normalAbortRef.current?.abort();
    searchAbortRef.current?.abort();
    normalRequestIdRef.current += 1;
    searchRequestIdRef.current += 1;
    normalLoadingRef.current = false;
    searchLoadingRef.current = false;

    fetchQuestionBankLayout(subjectKey, controller.signal)
      .then((layout) => {
        if (!mounted) return;
        const topics = getGrammarTopicNodes(layout);
        const defaultTopic = getDefaultGrammarTopicNode(topics);
        setLayoutError(false);
        setGrammarTopics(topics);
        setSelectedTopicNodeKey(defaultTopic.nodeKey);
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
  }, [isArabic, layoutRetryKey, subjectKey]);

  const requestNormalPage = useCallback(
    async (offset: number): Promise<PublicQuestionPage | null> => {
      if (!bankNodeId || !selectedTopicAvailable || normalLoadingRef.current) return null;
      const requestId = normalRequestIdRef.current;
      normalLoadingRef.current = true;
      const controller = new AbortController();
      normalAbortRef.current = controller;

      try {
        const page = await fetchQuestionPage(
          subjectKey,
          bankNodeId,
          offset,
          QUESTION_PAGE_SIZE,
          controller.signal
        );
        if (controller.signal.aborted || requestId !== normalRequestIdRef.current) return null;
        return page;
      } catch (error) {
        if (
          !controller.signal.aborted &&
          requestId === normalRequestIdRef.current &&
          process.env.NODE_ENV !== 'production'
        ) {
          console.warn('[Pythagoras] Question Bank page unavailable', error);
        }
        return null;
      } finally {
        if (
          requestId === normalRequestIdRef.current &&
          normalAbortRef.current === controller
        ) {
          normalLoadingRef.current = false;
          normalAbortRef.current = null;
        }
      }
    },
    [bankNodeId, selectedTopicAvailable, subjectKey]
  );

  useEffect(() => {
    if (!bankNodeId || !selectedTopicAvailable || !isArabic || searchQuery) return;

    let mounted = true;
    const requestId = normalRequestIdRef.current;
    void requestNormalPage(0).then((page) => {
      if (!mounted || requestId !== normalRequestIdRef.current) return;
      if (!page) {
        setNormalError(true);
        return;
      }
      setNormalItems(page.items);
      setNormalTotal(page.total);
      setNormalNextOffset(page.offset + page.items.length);
      setNormalLoaded(true);
    });

    return () => {
      mounted = false;
      normalAbortRef.current?.abort();
      normalLoadingRef.current = false;
    };
  }, [bankNodeId, isArabic, requestNormalPage, searchQuery, selectedTopicAvailable]);

  useEffect(() => {
    if (!isArabic) return;

    let mounted = true;
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
    };
  }, [isArabic, subjectKey]);

  const handleSearchChange = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery);
      setSearchItems([]);
      setSearchTotal(0);
      setSearchNextOffset(0);
      setSearchError(false);
      setSearchLoading(Boolean(nextQuery.trim()) && selectedTopicAvailable);
      setSearchLoadingMore(false);
    },
    [selectedTopicAvailable]
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

  const handleTopicSelect = useCallback(
    (nodeKey: string) => {
      if (!isArabic) return;
      const nextTopic = grammarTopics.find((topic) => topic.nodeKey === nodeKey);
      if (!nextTopic || nextTopic.nodeKey === selectedTopicNodeKey) return;

      normalAbortRef.current?.abort();
      searchAbortRef.current?.abort();
      normalRequestIdRef.current += 1;
      searchRequestIdRef.current += 1;
      normalLoadingRef.current = false;
      searchLoadingRef.current = false;

      setSelectedTopicNodeKey(nextTopic.nodeKey);
      setNormalItems([]);
      setNormalTotal(0);
      setNormalNextOffset(0);
      setNormalLoaded(false);
      setNormalLoadingMore(false);
      setNormalError(false);
      setPaginationError(false);
      setSearchItems([]);
      setSearchTotal(0);
      setSearchNextOffset(0);
      setSearchLoading(Boolean(searchQuery) && nextTopic.available);
      setSearchLoadingMore(false);
      setSearchError(false);
      setActiveReader(null);
      scrollToTopVisibleRef.current = false;
      setShowScrollToTop(false);
      listRef.current?.scrollToOffset({ animated: false, offset: 0 });
    },
    [
      grammarTopics,
      isArabic,
      searchQuery,
      selectedTopicNodeKey,
    ]
  );

  useEffect(() => {
    searchAbortRef.current?.abort();
    searchRequestIdRef.current += 1;
    const requestId = searchRequestIdRef.current;

    if (!bankNodeId || !selectedTopicAvailable || !isArabic || !searchQuery) {
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
  }, [bankNodeId, isArabic, searchQuery, selectedTopicAvailable, subjectKey]);

  const layoutPending = isArabic && (layoutLoading || (grammarTopics.length === 0 && !layoutError));
  const normalInitialLoading =
    Boolean(bankNodeId) && selectedTopicAvailable && !searchQuery && !normalLoaded && !normalError;
  const initialListLoading = layoutPending || normalInitialLoading;

  const loadMoreNormal = useCallback(() => {
    if (
      !selectedTopicAvailable ||
      normalItems.length >= normalTotal ||
      normalInitialLoading ||
      normalLoadingMore
    ) return;
    const requestId = normalRequestIdRef.current;
    setNormalLoadingMore(true);
    setPaginationError(false);
    void requestNormalPage(normalNextOffset).then((page) => {
      if (requestId !== normalRequestIdRef.current) return;
      if (!page) {
        setPaginationError(true);
        return;
      }
      setNormalItems((current) => mergeByQuestionId(current, page.items));
      setNormalTotal(page.total);
      setNormalNextOffset(page.offset + page.items.length);
    }).finally(() => {
      if (requestId === normalRequestIdRef.current) setNormalLoadingMore(false);
    });
  }, [
    normalInitialLoading,
    normalItems.length,
    normalLoadingMore,
    normalNextOffset,
    normalTotal,
    requestNormalPage,
    selectedTopicAvailable,
  ]);

  const loadMoreSearch = useCallback(async () => {
    if (
      !bankNodeId ||
      !selectedTopicAvailable ||
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
    selectedTopicAvailable,
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

  const searchMode = Boolean(searchQuery) && isArabic && selectedTopicAvailable;
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
    if (!selectedTopicAvailable || !bankNodeId) return;
    setNormalLoaded(false);
    setNormalError(false);
    const requestId = normalRequestIdRef.current;
    void requestNormalPage(0).then((page) => {
      if (requestId !== normalRequestIdRef.current) return;
      if (!page) {
        setNormalError(true);
        return;
      }
      setNormalItems(page.items);
      setNormalTotal(page.total);
      setNormalNextOffset(page.offset + page.items.length);
      setNormalLoaded(true);
    });
  }, [bankNodeId, requestNormalPage, selectedTopicAvailable]);

  const retryLayout = useCallback(() => {
    normalAbortRef.current?.abort();
    searchAbortRef.current?.abort();
    normalRequestIdRef.current += 1;
    searchRequestIdRef.current += 1;
    normalLoadingRef.current = false;
    searchLoadingRef.current = false;
    setGrammarTopics([]);
    setSelectedTopicNodeKey(DEFAULT_GRAMMAR_TOPIC_NODE_KEY);
    setNormalItems([]);
    setNormalTotal(0);
    setNormalNextOffset(0);
    setNormalLoaded(false);
    setNormalError(false);
    setPaginationError(false);
    setSearchItems([]);
    setSearchTotal(0);
    setSearchNextOffset(0);
    setSearchLoading(false);
    setSearchLoadingMore(false);
    setSearchError(false);
    setActiveReader(null);
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
    } else if (isArabic && selectedTopic && !selectedTopicAvailable) {
      message = 'لم تُضف أسئلة هذا الموضوع بعد';
    } else if (normalError && !searchMode) {
      message = 'تعذر تحميل الأسئلة';
      actionLabel = 'إعادة المحاولة';
      onAction = retryNormal;
    } else if (searchError && searchMode) {
      message = 'تعذر البحث حاليًا';
    } else if (searchMode) {
      message = 'لا توجد نتائج مطابقة';
    } else if (!isArabic) {
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
  }, [
    fontScale,
    initialListLoading,
    isArabic,
    layoutError,
    normalError,
    palette,
    retryLayout,
    retryNormal,
    searchError,
    searchLoading,
    searchMode,
    selectedTopic,
    selectedTopicAvailable,
  ]);

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
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.controlRow}>
          <View style={styles.searchSlot}>
            <QuestionBankSearchInput
              fontScale={fontScale}
              onBlur={handleSearchBlur}
              onChangeText={handleSearchChange}
              onFocus={handleSearchFocus}
              palette={palette}
              query={query}
              ref={searchBarRef}
              resolvedColorScheme={resolvedColorScheme}
            />
          </View>
          {isArabic && grammarTopics.length > 0 ? (
            <View style={[styles.topicSlot, { maxWidth: topicMaxWidth }]}>
              <QuestionTopicSelector
                colorScheme={resolvedColorScheme}
                maxWidth={topicMaxWidth}
                onSelect={handleTopicSelect}
                secondaryTextColor={palette.textSecondary}
                selectedTopic={selectedTopic}
                tintColor={palette.surface}
                textColor={palette.text}
                topics={grammarTopics}
              />
            </View>
          ) : null}
        </View>
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
      </View>
      <StatusBar style={resolvedColorScheme === 'dark' ? 'light' : 'dark'} />
      {activeReader && bankNodeId && selectedTopicAvailable && (
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
  screen: {
    flex: 1,
    minWidth: 0,
  },
  container: {
    flex: 1,
  },
  controlRow: {
    alignItems: 'center',
    direction: 'ltr',
    flexDirection: 'row',
    gap: QUESTION_BANK_CONTROL_GAP,
    paddingBottom: 10,
    paddingHorizontal: QUESTION_BANK_HORIZONTAL_INSET,
    paddingTop: 10,
  },
  searchSlot: {
    flex: 1,
    minWidth: 0,
  },
  topicSlot: {
    flexGrow: 0,
    flexShrink: 0,
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
