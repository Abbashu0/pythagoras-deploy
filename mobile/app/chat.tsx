import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Keyboard,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router/stack';
import * as Haptics from 'expo-haptics';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import ReanimatedDrawerLayout, {
  DrawerKeyboardDismissMode,
  DrawerPosition,
  DrawerType,
  type DrawerLayoutMethods,
} from 'react-native-gesture-handler/ReanimatedDrawerLayout';

import { ChatComposer } from '@/ai/chat-composer';
import { Agent1ChatApiError, sendAgent1DevChat } from '@/ai/agent-1-chat-api';
import {
  Agent1ChatRequestCoordinator,
  applyAgent1ChatStreamEvent,
  buildAgent1HistoryForNewTurn,
  buildAgent1HistoryForRegenerate,
  canRegenerateAgent1Turn,
  createAcceptedAgent1ChatTurn,
  failAgent1ChatTurn,
  resetAgent1ChatTurnAttempt,
} from '@/ai/agent-1-chat-state';
import { MAX_TEMP_CHAT_MESSAGES, type ChatMessage, type ChatTurn } from '@/ai/chat-types';
import { ChatTopControls } from '@/ai/chat-top-controls';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette } from '@/theme';

const StableChatTopControls = memo(ChatTopControls);

const CHAT_LAYOUT_TEST_CASES = ['short', 'biology', 'math', 'table', 'scroll', 'stream'] as const;
type ChatLayoutTestCase = typeof CHAT_LAYOUT_TEST_CASES[number];

export default function ChatScreen() {
  const { resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { layoutTest, layoutDiagnostics } = useLocalSearchParams<{
    layoutTest?: string;
    layoutDiagnostics?: string;
  }>();
  const isChatLayoutTest =
    __DEV__ &&
    process.env.EXPO_OS === 'ios' &&
    CHAT_LAYOUT_TEST_CASES.some((testCase) => testCase === layoutTest);
  const layoutTestCase = isChatLayoutTest ? layoutTest as ChatLayoutTestCase : null;
  const layoutDiagnosticsEnabled =
    __DEV__ &&
    process.env.EXPO_OS === 'ios' &&
    (isChatLayoutTest || layoutDiagnostics === '1');
  const drawerRef = useRef<DrawerLayoutMethods | null>(null);
  const drawerOpenRef = useRef(false);
  const messageSequenceRef = useRef(0);
  const [requestCoordinator] = useState(() => new Agent1ChatRequestCoordinator());
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const turnsRef = useRef<ChatTurn[]>([]);
  const mountedRef = useRef(false);
  const activeTurnIdRef = useRef<string | null>(null);
  const regenerationInProgressRef = useRef(false);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [transcriptWidth, setTranscriptWidth] = useState(0);
  const updateTurns = useCallback((update: (current: readonly ChatTurn[]) => ChatTurn[]) => {
    const next = update(turnsRef.current);
    turnsRef.current = next;
    setTurns(next);
  }, []);
  const updateActiveTurn = useCallback((turnId: string | null) => {
    activeTurnIdRef.current = turnId;
    setActiveTurnId(turnId);
  }, []);
  useEffect(() => {
    if (!layoutTestCase || requestCoordinator.isBusy) return;
    let cancelled = false;
    let stopFixtureStream = () => {};
    void import('@/ai/chat-layout-fixtures.dev').then(({ createChatLayoutTestTurn, getChatLayoutStreamChunks }) => {
      if (cancelled) return;
      const turn = createChatLayoutTestTurn(layoutTestCase);
      updateTurns(() => [turn]);
      if (layoutTestCase !== 'stream') {
        updateActiveTurn(null);
        return;
      }

      updateActiveTurn(turn.id);
      updateTurns((current) => applyAgent1ChatStreamEvent(current, turn.id, { type: 'started' }));
      let streamCancelled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let releasePendingDelay = () => {};
      const runFixtureStream = async () => {
        updateTurns((current) =>
          applyAgent1ChatStreamEvent(current, turn.id, { type: 'phase', phase: 'thinking' }),
        );
        for (const chunk of getChatLayoutStreamChunks()) {
          await new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              timer = null;
              resolve();
            };
            timer = setTimeout(finish, 180);
            releasePendingDelay = () => {
              if (timer !== null) clearTimeout(timer);
              finish();
            };
          });
          if (cancelled || streamCancelled) return;
          updateTurns((current) =>
            applyAgent1ChatStreamEvent(current, turn.id, { type: 'text_delta', text: chunk }),
          );
        }
        if (cancelled || streamCancelled) return;
        updateTurns((current) =>
          applyAgent1ChatStreamEvent(current, turn.id, { type: 'completed' }),
        );
        updateActiveTurn(null);
      };
      void runFixtureStream();
      stopFixtureStream = () => {
        streamCancelled = true;
        releasePendingDelay();
      };
    }).catch(() => {
      if (!cancelled) setSubmissionError('تعذر تحميل بيانات اختبار التخطيط التطويري.');
    });
    return () => {
      cancelled = true;
      stopFixtureStream();
    };
  }, [layoutTestCase, requestCoordinator, updateActiveTurn, updateTurns]);
  const handleForegroundLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    setTranscriptWidth((current) =>
      Math.abs(current - nextWidth) < 0.5 ? current : nextWidth,
    );
  }, []);
  const renderNavigationView = useCallback(
    () => <View style={[styles.sidebar, { backgroundColor: palette.surface }]} />,
    [palette.surface],
  );
  const handleDrawerOpen = useCallback(() => {
    if (drawerOpenRef.current) return;
    drawerOpenRef.current = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
  }, []);
  const handleDrawerClose = useCallback(() => {
    if (!drawerOpenRef.current) return;
    drawerOpenRef.current = false;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
  }, []);
  const handleMenuPress = useCallback(() => {
    // Expo UI's keyboard host forwards this blur request to the focused SwiftUI TextFieldRef.
    Keyboard.dismiss();
    drawerRef.current?.openDrawer();
  }, []);
  const handleBackPress = useCallback(() => router.back(), [router]);
  const executeAssistantTurn = useCallback(async (
    turnId: string,
    requestMessages: readonly Pick<ChatMessage, 'role' | 'content'>[],
    signal: AbortSignal,
    generation: number,
  ) => {
    let receivedTextCharacters = 0;
    try {
      await sendAgent1DevChat(requestMessages, signal, (event) => {
        if (!requestCoordinator.isCurrent(generation)) return;
        if (event.type === 'text_delta') receivedTextCharacters += event.text.length;
        updateTurns((current) => applyAgent1ChatStreamEvent(current, turnId, event));
      });
      if (__DEV__) {
        console.info('[Agent1 chat diagnostics] stream completed', {
          turnId,
          receivedTextCharacters,
        });
      }
    } catch (error) {
      if (signal.aborted || !requestCoordinator.isCurrent(generation)) return;
      if (__DEV__) {
        console.info('[Agent1 chat diagnostics] stream failed', {
          turnId,
          errorCode:
            error instanceof Agent1ChatApiError
              ? error.code
              : error instanceof Error
                ? error.name
                : 'UNKNOWN',
          receivedTextCharacters,
        });
      }
      updateTurns((current) =>
        failAgent1ChatTurn(current, turnId, agent1ChatErrorMessage(error)),
      );
    } finally {
      if (
        requestCoordinator.isCurrent(generation) &&
        activeTurnIdRef.current === turnId
      ) {
        updateActiveTurn(null);
      }
    }
  }, [requestCoordinator, updateActiveTurn, updateTurns]);

  const handleSend = useCallback((draft: string): string | null => {
    const content = draft.trim();
    if (!content || requestCoordinator.isBusy || regenerationInProgressRef.current) return null;
    if (!__DEV__ || process.env.EXPO_OS !== 'ios') {
      setSubmissionError('محادثة Agent 1 متاحة حاليًا في بيئة التطوير على iPhone فقط.');
      return null;
    }
    const currentTurns = turnsRef.current;
    const currentMessageCount = currentTurns.reduce(
      (count, turn) => count + 1 + (turn.assistant ? 1 : 0),
      0,
    );
    if (currentMessageCount >= MAX_TEMP_CHAT_MESSAGES) {
      setSubmissionError('انتهت سعة جلسة المحادثة المؤقتة. اخرج من الشات وارجع لبدء جلسة جديدة.');
      return null;
    }

    const turnId = `turn-${Date.now()}-${messageSequenceRef.current++}`;
    const turn = createAcceptedAgent1ChatTurn(turnId, content);
    const requestMessages = buildAgent1HistoryForNewTurn(currentTurns, turn.user);

    setSubmissionError(null);
    updateTurns((current) => [...current, turn]);
    updateActiveTurn(turnId);
    const started = requestCoordinator.start((signal, generation) =>
      executeAssistantTurn(turnId, requestMessages, signal, generation),
    );
    if (!started) {
      updateTurns((current) => current.filter((candidate) => candidate.id !== turnId));
      updateActiveTurn(null);
      setSubmissionError('تعذر بدء طلب جديد أثناء معالجة الطلب السابق. حاول مجددًا.');
      return null;
    }
    return turnId;
  }, [executeAssistantTurn, requestCoordinator, updateActiveTurn, updateTurns]);

  const handleRegenerate = useCallback((turnId: string) => {
    if (regenerationInProgressRef.current) return;
    const currentTurns = turnsRef.current;
    if (!canRegenerateAgent1Turn(currentTurns, turnId, activeTurnIdRef.current)) return;
    const requestMessages = buildAgent1HistoryForRegenerate(currentTurns, turnId);
    if (!requestMessages) return;

    regenerationInProgressRef.current = true;
    setSubmissionError(null);
    updateActiveTurn(turnId);
    const replacement = requestCoordinator.replace((signal, generation) =>
      executeAssistantTurn(turnId, requestMessages, signal, generation),
    );
    updateTurns((current) => resetAgent1ChatTurnAttempt(current, turnId));
    void replacement.finally(() => {
      regenerationInProgressRef.current = false;
      if (
        mountedRef.current &&
        !requestCoordinator.isBusy &&
        activeTurnIdRef.current === turnId
      ) {
        updateActiveTurn(null);
      }
    });
  }, [executeAssistantTurn, requestCoordinator, updateActiveTurn, updateTurns]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestCoordinator.cancelAll();
    };
  }, [requestCoordinator]);

  return (
    <>
      {process.env.EXPO_OS !== 'ios' ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            accessibilityLabel="فتح القائمة"
            icon="line.3.horizontal"
            onPress={handleMenuPress}
            separateBackground
            tintColor={palette.text}
          />
        </Stack.Toolbar>
      ) : null}
      <ReanimatedDrawerLayout
        ref={drawerRef}
        drawerPosition={DrawerPosition.RIGHT}
        drawerType={DrawerType.BACK}
        drawerWidth={width * 0.72}
        edgeWidth={Math.min(width, 64)}
        minSwipeDistance={10}
        drawerBackgroundColor={palette.surface}
        renderNavigationView={renderNavigationView}
        contentContainerStyle={[
          styles.drawerForegroundClip,
          { backgroundColor: palette.background },
        ]}
        overlayColor="transparent"
        keyboardDismissMode={DrawerKeyboardDismissMode.ON_DRAG}
        hideStatusBar={false}
        onDrawerOpen={handleDrawerOpen}
        onDrawerClose={handleDrawerClose}
      >
        {(drawerProgress) => (
          <ChatDrawerForeground
            drawerProgress={drawerProgress}
            onLayout={handleForegroundLayout}
          >
            <ChatComposer
              turns={turns}
              onSend={handleSend}
              onRegenerate={handleRegenerate}
              activeTurnId={activeTurnId}
              submissionError={submissionError}
              transcriptWidth={transcriptWidth}
              layoutDiagnosticsEnabled={layoutDiagnosticsEnabled}
            />
            {process.env.EXPO_OS === 'ios' ? (
              <StableChatTopControls
                colorScheme={resolvedColorScheme}
                foregroundColor={palette.text}
                onBack={handleBackPress}
                onMenu={handleMenuPress}
              />
            ) : null}
          </ChatDrawerForeground>
        )}
      </ReanimatedDrawerLayout>
      <StatusBar style={resolvedColorScheme === 'dark' ? 'light' : 'dark'} />
    </>
  );
}

function agent1ChatErrorMessage(error: unknown): string {
  if (!(error instanceof Agent1ChatApiError)) {
    return 'تعذر الاتصال بخادم التطوير. تحقق من اتصال iPhone بالشبكة المحلية.';
  }
  if (error.code === 'AGENT_1_DISABLED') {
    return 'Agent 1 متوقف. شغّله من صفحة التشغيل في لوحة الإدارة.';
  }
  if (error.code === 'AGENT_1_NOT_READY') {
    return 'النموذج الرئيسي غير جاهز. راجع إعداد Agent 1 والمزوّد في لوحة الإدارة.';
  }
  if (error.code === 'CHAT_TOO_LARGE' || error.code === 'CHAT_INVALID') {
    return 'تعذر إرسال هذا الطلب ضمن حدود جلسة التطوير المؤقتة.';
  }
  if (error.code === 'NETWORK_UNAVAILABLE') {
    return 'تعذر الوصول إلى خادم التطوير. تحقق من الشبكة المحلية وعنوان الخادم.';
  }
  return 'تعذر الحصول على رد من Agent 1. راجع جاهزية المزوّد وحاول مجددًا.';
}

function ChatDrawerForeground({
  drawerProgress,
  onLayout,
  children,
}: {
  drawerProgress?: SharedValue<number>;
  onLayout: (event: LayoutChangeEvent) => void;
  children: ReactNode;
}) {
  const animatedScrim = useAnimatedStyle(
    () => ({
      opacity: interpolate(
        drawerProgress?.value ?? 0,
        [0, 1],
        [0, 1],
        Extrapolation.CLAMP,
      ),
    }),
    [drawerProgress],
  );

  return (
    <Animated.View
      style={styles.container}
      onLayout={onLayout}
    >
      {children}
      <Animated.View
        pointerEvents="none"
        style={[styles.foregroundScrim, animatedScrim]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  drawerForegroundClip: {
    overflow: 'hidden',
    borderCurve: 'continuous',
    borderRadius: 32,
  },
  foregroundScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
  },
  sidebar: {
    flex: 1,
    direction: 'rtl',
  },
});
