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

const SCROLL_LAYOUT_TEST_PARAGRAPH =
  'يعرض هذا النص الطويل عدة فقرات عربية متتابعة كي نتحقق من أن React Native يقيس الارتفاع الكامل للرد، وأن موضع أزرار النسخ والتفاعل وإعادة الإنشاء يبقى بعد نهاية المحتوى لا في منتصفه. يجب أن تظل الأسطر قابلة للوصول بالتمرير الطبيعي، وأن تبقى المسافة الأخيرة واضحة فوق حقل الكتابة المثبت أسفل الشاشة.';

const SCROLL_LAYOUT_TEST_CONTENT = [
  '# اختبار ارتفاع transcript الطويل',
  '',
  'هذه إجابة تطويرية ثابتة لا ترسل أي طلب إلى Agent 1. الغرض منها فحص التمرير والارتفاع مع محتوى طويل ومنسق داخل شاشة المحادثة نفسها.',
  '',
  '## شرح الفكرة الأساسية',
  '',
  ...Array.from(
    { length: 12 },
    (_, index) => `الفقرة ${index + 1}: ${SCROLL_LAYOUT_TEST_PARAGRAPH}`,
  ),
  '',
  '## صيغ رياضية ضمن الشرح',
  '',
  'تظهر هنا معادلات قصيرة داخل السطر مثل $F(x)$ و$x^3$ و$3x^2$ مع بقاء الشرح العربي خارج حدود LaTeX.',
  '',
  '$$',
  '\\int_0^2 x\\,dx = \\left[\\frac{x^2}{2}\\right]_0^2 = 2',
  '$$',
  '',
  'وتبقى المعادلة التالية في كتلة مستقلة، ثم يستمر النص بعدها ضمن تدفق المستند نفسه:',
  '',
  '$$',
  '\\frac{d}{dx}x^3 = 3x^2',
  '$$',
  '',
  '## قائمة خطوات التحقق',
  '',
  '- يبدأ المحتوى تحت أدوات الرجوع والقائمة.',
  '- يلتف النص العربي بمحاذاة RTL الصحيحة.',
  '- تظهر الصيغ اللاتينية في مواضعها الطبيعية.',
  '- تظل كل فقرة قابلة للوصول عند السحب للأعلى والأسفل.',
  '- تبقى أزرار المساعد بعد آخر سطر من الرد.',
  '- تظل المسافة النهائية فوق Composer كافية وواضحة.',
  '',
  '## جدول الحالات',
  '',
  '| الحالة | السلوك المتوقع |',
  '| --- | --- |',
  '| رد قصير | يبدأ من أعلى transcript |',
  '| رد طويل | يتمدد ويزيد ارتفاع المحتوى |',
  '| بث حي | يتحدث قياس RN مع تغير الرد |',
  '| اكتمال الرد | تظهر الإجراءات بعد آخر كتلة |',
  '',
  ...Array.from(
    { length: 5 },
    (_, index) => `فقرة متابعة ${index + 1}: ${SCROLL_LAYOUT_TEST_PARAGRAPH}`,
  ),
  '',
  '## القسم الأخير للاختبار',
  '',
  'إذا وصلت إلى هذا العنوان بعد التمرير، فتابع حتى نهاية الفقرة والمعادلة. يجب أن يظهر صف الإجراءات بعدهما مباشرة، ثم تبقى مساحة مريحة قبل Composer، من دون أن يختفي أي جزء خلفه.',
  '',
  '$$',
  'F(x) = \\int_0^x 3t^2\\,dt = x^3',
  '$$',
].join('\n');

function createScrollLayoutTestTurn(): ChatTurn {
  return {
    id: 'development-scroll-layout-test',
    user: {
      id: 'development-scroll-layout-test-user',
      role: 'user',
      content: 'اعرض اختبار transcript الطويل',
    },
    assistantAttempt: 0,
    assistant: {
      id: 'development-scroll-layout-test-assistant',
      role: 'assistant',
      content: SCROLL_LAYOUT_TEST_CONTENT,
    },
    assistantStatus: 'completed',
    errorMessage: null,
  };
}

export default function ChatScreen() {
  const { resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { layoutTest } = useLocalSearchParams<{ layoutTest?: string }>();
  const isScrollLayoutTest =
    __DEV__ && process.env.EXPO_OS === 'ios' && layoutTest === 'scroll';
  const drawerRef = useRef<DrawerLayoutMethods | null>(null);
  const drawerOpenRef = useRef(false);
  const messageSequenceRef = useRef(0);
  const scrollTestLoadedRef = useRef(false);
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
  useEffect(() => {
    if (
      !isScrollLayoutTest ||
      scrollTestLoadedRef.current ||
      turnsRef.current.length > 0 ||
      requestCoordinator.isBusy
    ) {
      return;
    }

    scrollTestLoadedRef.current = true;
    updateTurns(() => [createScrollLayoutTestTurn()]);
  }, [isScrollLayoutTest, requestCoordinator, updateTurns]);
  const updateActiveTurn = useCallback((turnId: string | null) => {
    activeTurnIdRef.current = turnId;
    setActiveTurnId(turnId);
  }, []);
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
